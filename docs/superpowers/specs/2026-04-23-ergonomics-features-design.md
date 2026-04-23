# Ergonomics Features Design

PubSub events, config watching, migrations, encrypted codec, and
platform-agnostic test layer for config-file-effect. Implements all 5 features
from issue #4.

## Architecture Approach

Composable layers. Each feature is an independent, opt-in service that composes
with the existing ConfigFileService via Effect's layer system. No changes to the
core ConfigFileService interface except for an optional events hook.

## Feature 1: ConfigEvents (PubSub Event System)

### Files

- `src/events/ConfigEvent.ts` -- event schema definitions
- `src/events/ConfigEvents.ts` -- service tag and factory

### Event Schema

Uses `Schema.TaggedStruct` union with a timestamp wrapper, matching the
SqliteCache pattern from xdg-effect.

Payload variants:

- Discovery phase: `Discovered(path, tier)`, `DiscoveryFailed(tier, reason)`
- Resolution phase: `Resolved(path, tier, strategy)`, `ResolutionFailed(reason)`
- Codec phase: `Parsed(path, codec)`, `ParseFailed(path, codec, reason)`,
  `Stringified(path, codec)`, `StringifyFailed(codec, reason)`
- Validation phase: `Validated(path)`, `ValidationFailed(path, reason)`
- High-level operations: `Loaded(path)`, `Saved(path)`, `Updated(path)`,
  `NotFound()`, `Written(path)`

Wrapper class:

```text
ConfigEvent {
  timestamp: DateTimeUtc
  event: ConfigEventPayload
}
```

### Service Interface

```text
ConfigEventsService<A> {
  events: PubSub.PubSub<ConfigEvent>
}
```

### Factory

- `ConfigEvents.Tag<A>(id)` -- creates a parameterized Context.Tag
- `ConfigEvents.Live<A>(tag)` -- creates a layer with an unbounded PubSub

ConfigFileLive gains an optional `events?: ConfigEventsService<A>` in its
options. When provided, it emits events at each pipeline stage.

### Consumption

```text
const dequeue = yield* PubSub.subscribe(configEvents.events);
```

## Feature 2: ConfigWatcher (File Watching)

### Files

- `src/watcher/ConfigFileChange.ts` -- change event type
- `src/watcher/ConfigWatcher.ts` -- service tag and factory

### Change Event Type

```text
ConfigFileChange<A> {
  path: string
  previous: Option.Option<A>
  current: Option.Option<A>
  timestamp: DateTime.Utc
}
```

Both `previous` and `current` are `Option` to handle file creation
(previous=none), deletion (current=none), and modification (both some).

### Service Interface

```text
ConfigWatcherService<A> {
  watch(options?: WatchOptions): Stream.Stream<ConfigFileChange<A>, ConfigError>
}

WatchOptions {
  interval?: Duration.DurationInput   -- polling interval, default 2s
  signal?: AbortSignal                -- external cancellation
}
```

### Implementation

- Uses `@effect/platform` `FileSystem.watch` where available, with
  `Stream.retry` and polling fallback
- Runs discovered paths through `ConfigFileService.load` on each change to
  produce validated values
- Uses `Stream.changes` with structural equality for deduplication
- Tracks previous value via `Ref` to produce old/new pairs
- Emits events into ConfigEvents PubSub when available (optional dependency)

### Factory

- `ConfigWatcher.Tag<A>(id)` -- parameterized Context.Tag
- `ConfigWatcher.Live<A>(options)` -- takes ConfigFileService tag and resolver
  list so it knows which paths to watch; depends on FileSystem from context

## Feature 3: ConfigMigration (Versioned Config Transforms)

### Files

- `src/migrations/ConfigMigration.ts` -- migration types and runner

### Migration Type

```text
ConfigFileMigration {
  version: number
  name: string
  up: (raw: unknown) => Effect.Effect<unknown, ConfigError>
  down?: (raw: unknown) => Effect.Effect<unknown, ConfigError>
}
```

Migrations operate on the raw parsed object (post-codec, pre-schema-decode).
This lets them reshape data before the current schema validates it.

### Version Access (Pluggable)

```text
VersionAccess {
  get: (raw: unknown) => Effect.Effect<number, ConfigError>
  set: (raw: unknown, version: number) => Effect.Effect<unknown, ConfigError>
}
```

Default implementation reads and writes a `version` field on the top-level
object. Consumer can override to use a different field name, a nested path, a
sidecar mechanism, or anything else. If `get` fails (no version field, user
did not configure it), the error propagates.

### Pipeline Integration

Implemented as a codec-level transformation, not a separate layer. The
`ConfigMigration.make` factory wraps the inner codec's `parse` method to inject
the migration pipeline:

- On load: inner codec parses raw string to object, `VersionAccess.get` reads
  current version, applies pending `up` migrations in order,
  `VersionAccess.set` stamps new version, returns migrated object for schema
  decode
- On save: after schema encode and codec stringify, the version is already
  embedded via `set`
- Migrations are sorted by `version` number and applied sequentially

### Factory

`ConfigMigration.make<A>(options)` returns a modified `ConfigFileOptions<A>`
with the migration pipeline injected. It wraps the codec's `parse` to intercept
and apply migrations before the data reaches schema validation.

Usage:

```text
const options = ConfigMigration.make({
  migrations: [
    { version: 1, name: "add-theme", up: (raw) => ... },
    { version: 2, name: "rename-color", up: (raw) => ..., down: (raw) => ... },
  ],
  versionAccess: VersionAccess.default,
  options: baseConfigFileOptions,
});

const layer = ConfigFile.Live(options);
```

## Feature 4: EncryptedCodec (AES-GCM Codec Wrapper)

### Files

- `src/codecs/EncryptedCodec.ts` -- codec wrapper and key types

### Key Input Union

```text
EncryptedCodecKey =
  | { _tag: "CryptoKey", key: Effect.Effect<CryptoKey, ConfigError> }
  | { _tag: "Passphrase", passphrase: string, salt: Uint8Array }
```

Convenience constructors: `EncryptedCodecKey.fromCryptoKey(effect)` and
`EncryptedCodecKey.fromPassphrase(passphrase, salt)`.

### Factory

```text
EncryptedCodec(inner: ConfigCodec, key: EncryptedCodecKey): ConfigCodec
```

Returns a `ConfigCodec` satisfying the existing interface. No new abstractions.

### Implementation

- `parse(raw)`: base64-decode, extract IV (first 12 bytes) and ciphertext,
  AES-GCM decrypt, pass plaintext to `inner.parse`
- `stringify(value)`: `inner.stringify`, generate random 12-byte IV, AES-GCM
  encrypt, prepend IV, base64-encode
- Passphrase mode: derives CryptoKey via PBKDF2 (SHA-256, 100k iterations)
  from passphrase and salt, cached after first derivation
- Uses `globalThis.crypto` with `node:crypto` webcrypto fallback for portability
- `name` property: `"encrypted(inner.name)"`
- `extensions` property: passes through inner codec's extensions
- Decrypt failures produce CodecError with operation "parse"

## Feature 5: Platform-Agnostic Test Layer

### Modified File

`src/layers/ConfigFileTest.ts`

### Changes

- Remove all `node:fs` imports
- Use `FileSystem` from `@effect/platform` obtained from context
- Replace sync fs calls with effectful equivalents: `FileSystem.makeDirectory`,
  `FileSystem.writeFileString`, `FileSystem.remove`
- Drop automatic `NodeFileSystem.layer` provision

### Updated Type Signature

```text
-- Before
Layer.Layer<ConfigFileService<A>, never, Scope.Scope>

-- After
Layer.Layer<ConfigFileService<A>, never, FileSystem.FileSystem | Scope.Scope>
```

The `FileSystem` requirement surfaces in the type, making it explicit that the
consumer must provide a platform layer.

### Usage

```text
-- Consumer provides platform
const layer = ConfigFile.Test({ tag, schema, codec, ... }).pipe(
  Layer.provide(NodeFileSystem.layer)
);
```

### Test Impact

Existing integration tests already compose with `NodeFileSystem.layer` via
their helpers. They need a minor update to provide it to the test layer.

## Public API

### New Exports from index.ts

Events:

- `ConfigEvent`, `ConfigEventPayload` (schema classes)
- `ConfigEvents` (service namespace with Tag, Live)
- `ConfigEventsService` (type)

Watcher:

- `ConfigWatcher` (service namespace with Tag, Live)
- `ConfigWatcherService`, `WatchOptions`, `ConfigFileChange` (types)

Migrations:

- `ConfigMigration` (namespace with make)
- `ConfigFileMigration`, `VersionAccess` (types and default implementation)

Encrypted Codec:

- `EncryptedCodec` (factory function)
- `EncryptedCodecKey` (type and constructors)

### New Source Tree

```text
src/
  codecs/
    EncryptedCodec.ts          (new)
  events/
    ConfigEvent.ts             (new)
    ConfigEvents.ts            (new)
  migrations/
    ConfigMigration.ts         (new)
  watcher/
    ConfigFileChange.ts        (new)
    ConfigWatcher.ts           (new)
  layers/
    ConfigFileTest.ts          (modified)
```

### Dependencies

No new npm dependencies. Everything uses effect, @effect/platform, and
node:crypto (already available).

### Breaking Changes

The only change to existing API surface is ConfigFileTest's layer type gaining
a `FileSystem` requirement. Since this is a test utility and the package is at
0.x, this is acceptable.
