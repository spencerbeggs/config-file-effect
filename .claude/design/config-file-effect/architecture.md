---
status: current
module: config-file-effect
category: architecture
created: 2026-04-23
updated: 2026-04-23
last-synced: 2026-04-23
completeness: 97
related: []
dependencies: []
---

# config-file-effect - Architecture

Composable config file loading for Effect with pluggable codecs, resolution
strategies, and merge behaviors.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [System Architecture](#system-architecture)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Related Documentation](#related-documentation)
10. [Changelog](#changelog)

---

## Overview

config-file-effect solves the problem of composable, testable config file
management in Effect applications. Rather than writing ad-hoc file loading
logic, the library provides a pluggable pipeline of codecs (how to
parse/write), resolvers (where to look), and strategies (how to merge
multiple sources). It also supports config file watching, encrypted storage,
schema migrations, and a PubSub event system for observability.

The library is generic -- it has zero coupling to XDG directories or any
specific config convention. It was extracted from xdg-effect as a standalone
package so that any Effect application can use config file management without
adopting the full XDG stack.

**Key Design Principles:**

- **Pluggable pipeline:** Codecs, resolvers, and strategies are interfaces
  with built-in implementations. Consumers can provide custom implementations
  without forking.
- **Effect-native dependency injection:** The ConfigFile service is an Effect
  `Context.Tag` value. Layers compose via `Layer.provide`. No globals, no
  singletons.
- **Platform abstraction:** All filesystem and path operations use
  `@effect/platform` (`FileSystem`, `Path`), enabling multi-runtime support
  (Node, Bun, Deno). `Path.layer` is provided internally by ConfigFileLive.
- **Type-safe generics:** `ConfigFile.Tag<A>(id)` creates uniquely-keyed tags
  for each config schema. Multiple ConfigFile services can coexist in the same
  layer graph.
- **Error-absorbing resolvers:** All errors inside resolvers are caught and
  converted to `Option.none()`, so a permission-denied error or missing
  directory does not abort the resolver chain.
- **Optional observability:** The event system is opt-in. Providing an
  `events` tag in ConfigFileOptions enables structured lifecycle events via
  PubSub without affecting the core pipeline.
- **Codec composition:** Codecs can be wrapped (encryption, migration) to
  build layered processing pipelines while preserving the ConfigCodec
  interface.

**When to reference this document:**

- When adding new codecs, resolvers, or strategies
- When modifying the service or layer implementation
- When integrating config-file-effect into a consuming application
- When debugging layer wiring or service resolution issues
- When implementing encryption, migrations, or event handling
- When setting up config file watching

---

## Current State

### Module Structure

Single package with a barrel export at `src/index.ts`. No internal barrel
files. The source tree is organized by responsibility:

```text
src/
  index.ts              # Single barrel export
  codecs/               # Pluggable config file format parsers + encryption
  errors/               # Data.TaggedError types with Base exports
  events/               # PubSub event system for lifecycle observability
  layers/               # Layer.Layer implementations (Live + Test)
  migrations/           # Schema versioning and migration pipeline
  resolvers/            # Config file location strategies
  services/             # Context.Tag service interface + factories
  strategies/           # Config resolution merge strategies
  watcher/              # Polling-based config file change detection
```

### System Components

#### Component 1: ConfigFile Service

**Location:** `src/services/ConfigFile.ts`

**Purpose:** Namespace providing factory functions for creating typed config
file service tags and layers.

**Responsibilities:**

- `ConfigFile.Tag<A>(id)` -- create a unique `Context.Tag` for a config type
- `ConfigFile.Live<A>(options)` -- build a live layer from codecs, resolvers,
  and strategy
- `ConfigFile.Test<A>(options)` -- build a scoped test layer with
  pre-populated temp files

**Key interfaces/APIs:**

```typescript
interface ConfigFileService<A> {
  readonly load: Effect.Effect<A, ConfigError>;
  readonly loadFrom: (path: string) => Effect.Effect<A, ConfigError>;
  readonly discover: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigError>;
  readonly write: (value: A, path: string) => Effect.Effect<void, ConfigError>;
  readonly loadOrDefault: (defaultValue: A) => Effect.Effect<A, ConfigError>;
  readonly save: (value: A) => Effect.Effect<string, ConfigError>;
  readonly update: (fn: (current: A) => A, defaultValue?: A) => Effect.Effect<A, ConfigError>;
  readonly validate: (value: unknown) => Effect.Effect<A, ConfigError>;
}
```

**Dependencies:**

- Depends on: ConfigFileLive (layer implementation)
- Used by: Consumer applications

#### Component 2: ConfigFileLive

**Location:** `src/layers/ConfigFileLive.ts`

**Purpose:** Production implementation of ConfigFileService.

**Responsibilities:**

- Orchestrate resolver chain to discover config files
- Parse file content using pluggable codecs
- Validate parsed data against an Effect Schema
- Resolve multiple sources into a single value using a strategy
- Write/save config files back to disk with encode + serialize
- Create parent directories for save operations

**Dependencies:**

- Depends on: FileSystem (`@effect/platform`)
- Used by: ConfigFile.Live factory

**Layer type:** `Layer.Layer<ConfigFileService<A>, never, FileSystem.FileSystem>`

#### Component 3: ConfigFileTest (Platform-Agnostic)

**Location:** `src/layers/ConfigFileTest.ts`

**Purpose:** Test layer that pre-populates files in temp directories with
automatic cleanup. Platform-agnostic -- the consumer provides the platform
layer.

**Responsibilities:**

- Create temp files from a `files: Record<string, string>` map
- Clean up written files via Effect finalizers on scope close
- Use `FileSystem` and `Path` from `@effect/platform` (not platform-node)

**Dependencies:**

- Depends on: FileSystem (`@effect/platform`), Scope
- Used by: ConfigFile.Test factory, test suites
- Consumer provides: `NodeFileSystem.layer` or `BunFileSystem.layer`, etc.

**Layer type:**
`Layer.Layer<ConfigFileService<A>, never, FileSystem.FileSystem | Scope.Scope>`

**Breaking change (0.x):** Previously imported `@effect/platform-node`
directly and provided `NodeFileSystem.layer` internally. Now requires the
consumer to provide a platform-specific `FileSystem` layer. This decouples
the test layer from Node.js and enables Bun/Deno test environments.

#### Component 4: ConfigEvents (PubSub Event System)

**Location:** `src/events/ConfigEvent.ts`, `src/events/ConfigEvents.ts`

**Purpose:** Structured lifecycle event system for observability. Emits
events at each stage of the config loading/saving pipeline via Effect PubSub.

**Responsibilities:**

- Define 15 event payload variants as `Schema.TaggedStruct` types
- Wrap each payload in a `ConfigEvent` Schema.Class with a UTC timestamp
- Provide `ConfigEventsService` interface with a single `events` PubSub field
- Provide `ConfigEvents.Tag(id)` and `ConfigEvents.Live(tag)` factories

**Event payload variants:**

| Event | Fields | Emitted When |
| ----- | ------ | ------------ |
| `Discovered` | path, tier | Resolver finds a file |
| `DiscoveryFailed` | tier, reason | Resolver fails or returns none |
| `Resolved` | path, tier, strategy | Strategy selects a source |
| `ResolutionFailed` | reason | Strategy fails |
| `Parsed` | path, codec | Codec parse succeeds |
| `ParseFailed` | path, codec, reason | Codec parse fails |
| `Stringified` | path, codec | Codec stringify succeeds |
| `StringifyFailed` | codec, reason | Codec stringify fails |
| `Validated` | path | Schema decode + validate succeeds |
| `ValidationFailed` | path, reason | Schema decode or validate fails |
| `Loaded` | path | Config value fully loaded |
| `Saved` | path | Config saved to default path |
| `Updated` | path | Config updated (load + save) |
| `NotFound` | (none) | No config sources found |
| `Written` | path | File written to disk |

**Integration with ConfigFileLive:** The `ConfigFileOptions` interface has an
optional `events` field accepting a `Context.Tag<ConfigEventsService>`. When
provided, ConfigFileLive emits events at each pipeline stage. When absent, the
emit function is a no-op (`Effect.void`). Events are resolved via
`Effect.serviceOption` so a missing service in the context does not cause
failures.

**Dependencies:**

- Depends on: PubSub (`effect`), Schema (`effect`)
- Used by: ConfigFileLive (optional), consumer subscriptions

**Layer type:** `Layer.Layer<ConfigEventsService, never, never>`

#### Component 5: EncryptedCodec

**Location:** `src/codecs/EncryptedCodec.ts`

**Purpose:** Codec wrapper that adds AES-GCM encryption to any ConfigCodec.

**Responsibilities:**

- Accept an inner ConfigCodec and an EncryptedCodecKey (CryptoKey or
  Passphrase)
- On `parse`: base64-decode, extract 12-byte IV, decrypt with AES-GCM, pass
  plaintext to inner codec's `parse`
- On `stringify`: serialize with inner codec, generate random 12-byte IV,
  encrypt with AES-GCM, prepend IV, base64-encode
- Cache derived keys after first PBKDF2 derivation (Passphrase variant)

**Key types:**

```typescript
type EncryptedCodecKey =
  | { _tag: "CryptoKey"; key: Effect<CryptoKey, CodecError> }
  | { _tag: "Passphrase"; passphrase: string; salt: Uint8Array };

// Convenience constructors
EncryptedCodecKey.fromCryptoKey(key)
EncryptedCodecKey.fromPassphrase(passphrase, salt)

// Wrapper function
EncryptedCodec(inner: ConfigCodec, keySource: EncryptedCodecKey): ConfigCodec
```

**Crypto details:**

- Algorithm: AES-GCM with 256-bit keys
- IV: 12 bytes, randomly generated per `stringify` call
- Key derivation (Passphrase): PBKDF2 with SHA-256, 100,000 iterations
- Runtime: Uses `globalThis.crypto` (Web Crypto API) -- works in Node 20+,
  Bun, and Deno

**Dependencies:**

- Depends on: inner ConfigCodec, Web Crypto API
- Used by: consumer applications needing encrypted config storage

#### Component 6: ConfigMigration

**Location:** `src/migrations/ConfigMigration.ts`

**Purpose:** Schema versioning and migration system. Wraps a ConfigCodec to
apply versioned migration steps post-parse, pre-schema-decode.

**Responsibilities:**

- Define `ConfigFileMigration` interface: version, name, up(), optional down()
- Define `VersionAccess` interface: pluggable get/set for version field
  location (default reads/writes a top-level `version` field)
- `ConfigMigration.make(options)` returns a new ConfigCodec that:
  1. Parses with the inner codec
  2. Reads the current version via VersionAccess.get
  3. Applies pending migrations (version > current) in ascending order
  4. Updates the version after each migration via VersionAccess.set
  5. Returns the migrated data for schema decode

**Key types:**

```typescript
interface ConfigFileMigration {
  readonly version: number;
  readonly name: string;
  readonly up: (raw: unknown) => Effect<unknown, ConfigError>;
  readonly down?: (raw: unknown) => Effect<unknown, ConfigError>;
}

interface VersionAccess {
  readonly get: (raw: unknown) => Effect<number, ConfigError>;
  readonly set: (raw: unknown, version: number) => Effect<unknown, ConfigError>;
}
```

**Error mapping:** Migration errors (ConfigError) are mapped to CodecError so
the returned codec satisfies the ConfigCodec interface. This keeps the error
surface uniform from the caller's perspective.

**Dependencies:**

- Depends on: inner ConfigCodec
- Used by: consumer applications needing config schema evolution

#### Component 7: ConfigWatcher

**Location:** `src/watcher/ConfigFileChange.ts`, `src/watcher/ConfigWatcher.ts`

**Purpose:** Polling-based config file change detection. Returns a Stream of
ConfigFileChange events whenever watched files differ from their previous
values.

**Responsibilities:**

- Define `ConfigFileChange<A>` interface: path, previous Option, current
  Option, timestamp
- Define `ConfigWatcherService<A>` interface: `watch(options?)` returns
  `Stream<ConfigFileChange<A>, ConfigError>`
- Poll each watched path at a configurable interval (default 5 seconds)
- Track previous values via `Ref<Map<string, Option<A>>>`
- Detect changes via `JSON.stringify` structural comparison
- Represent file appearance/disappearance via Option values

**Key types:**

```typescript
interface ConfigFileChange<A> {
  readonly path: string;
  readonly previous: Option.Option<A>;
  readonly current: Option.Option<A>;
  readonly timestamp: DateTime.Utc;
}

interface WatchOptions {
  readonly interval?: Duration.DurationInput;
  readonly signal?: AbortSignal;
}

// Factories
ConfigWatcher.Tag<A>(id): Context.Tag<ConfigWatcherService<A>>
ConfigWatcher.Live<A>(options): Layer.Layer<ConfigWatcherService<A>, never, ConfigFileService<A>>
```

**Dependencies:**

- Depends on: ConfigFileService (uses `loadFrom` to poll each path)
- Used by: consumer applications needing live config reloading

### Pluggable Extension Points

#### Codecs

Interface `ConfigCodec` (at `src/codecs/ConfigCodec.ts`) with two built-in
format implementations and two codec wrappers:

| Codec | File | Type | Extensions |
| ----- | ---- | ---- | ---------- |
| `JsonCodec` | `src/codecs/JsonCodec.ts` | Format | `.json` |
| `TomlCodec` | `src/codecs/TomlCodec.ts` | Format | `.toml` |
| `EncryptedCodec` | `src/codecs/EncryptedCodec.ts` | Wrapper | (inherits inner) |
| `ConfigMigration.make` | `src/migrations/ConfigMigration.ts` | Wrapper | (inherits inner) |

Each format codec provides `parse(raw) -> Effect<unknown, CodecError>` and
`stringify(value) -> Effect<string, CodecError>`. TomlCodec uses `smol-toml`
as the only runtime dependency.

Wrapper codecs compose around a format codec, transforming data in the parse
and/or stringify pipeline while preserving the ConfigCodec interface.
`EncryptedCodec` adds AES-GCM encryption. `ConfigMigration.make` applies
versioned migrations post-parse.

#### Resolvers

Interface `ConfigResolver<R>` (at `src/resolvers/ConfigResolver.ts`) with five
built-in implementations:

| Resolver | File | Requirements | Strategy |
| -------- | ---- | ------------ | -------- |
| `ExplicitPath` | `src/resolvers/ExplicitPath.ts` | FileSystem | Check if a specific path exists |
| `StaticDir` | `src/resolvers/StaticDir.ts` | FileSystem | Check for filename in a known directory |
| `UpwardWalk` | `src/resolvers/UpwardWalk.ts` | FileSystem | Walk up from cwd looking for filename |
| `WorkspaceRoot` | `src/resolvers/WorkspaceRoot.ts` | FileSystem | Find monorepo root, check ordered subpaths |
| `GitRoot` | `src/resolvers/GitRoot.ts` | FileSystem | Find git root (.git dir or file), check ordered subpaths |

Each resolver returns `Effect<Option<string>, never, R>` -- errors are caught
and treated as "not found". The `R` type parameter captures requirements so
they flow through to the layer graph.

`WorkspaceRoot` and `GitRoot` both accept `subpaths?: ReadonlyArray<string>`.
Each subpath is tried in order; first file found wins. `"."` means the root
itself. When `subpaths` is omitted, the root is checked directly.

#### Strategies

Interface `ConfigWalkStrategy<A>` (at `src/strategies/ConfigWalkStrategy.ts`)
with two built-in implementations:

| Strategy | File | Behavior |
| -------- | ---- | -------- |
| `FirstMatch` | `src/strategies/FirstMatch.ts` | Return value from highest-priority source |
| `LayeredMerge` | `src/strategies/LayeredMerge.ts` | Deep-merge all sources, higher-priority wins |

### Error Types

All errors extend `Data.TaggedError` and export a `Base` class for
api-extractor compatibility:

| Error | Tag | Key Fields |
| ----- | --- | ---------- |
| `ConfigError` | `"ConfigError"` | `operation`, `path?`, `reason` |
| `CodecError` | `"CodecError"` | `codec`, `operation`, `reason` |

### Architecture Diagram

```text
           Consumer Application
                   |
                   v
           ConfigFile.Live(options)
                   |
     +------+------+------+------+
     |      |      |      |      |
  Resolvers Codec  Strategy Events  Watcher
  [0..N]   (1)    (1)     (opt)   (opt)
     |      |      |      |        |
     v      v      v      v        v
  Option  parse/ resolve PubSub  Stream<
  <path>  strfy  (srcs)  <Event> Change>
     |      |      |
     v      v      v
  FileSystem    ConfigError
  (@effect/
   platform)

  Codec composition (optional):
  EncryptedCodec(inner) -> AES-GCM layer
  ConfigMigration.make({codec}) -> migration layer
```

---

## Rationale

### Architectural Decisions

#### Decision 1: `@effect/platform` for all filesystem operations

**Context:** The library needs to read/write files and check paths.

**Options considered:**

1. **`@effect/platform` FileSystem (Chosen):**
   - Pros: Platform-agnostic, testable, aligns with Effect ecosystem
   - Cons: Requires consumers to provide `NodeFileSystem.layer`
   - Why chosen: Enables future Bun/Deno support and consistent Effect patterns

2. **Node.js `fs` module directly:**
   - Pros: No extra dependency
   - Cons: Locks to Node.js, harder to test
   - Why rejected: Defeats the purpose of building on Effect

#### Decision 2: `Context.GenericTag` for ConfigFile type parameter

**Context:** `ConfigFileService<A>` is generic over the configuration type.
Effect's `Context.Tag` does not support type parameters at the class level.

**Options considered:**

1. **`Context.GenericTag` factory (Chosen):**
   - Pros: Each config schema gets its own uniquely-keyed tag, type-safe,
     multiple ConfigFile services can coexist
   - Cons: Requires a factory function, slightly unusual API
   - Why chosen: The only mechanism Effect provides for type-parameterized
     context entries

2. **Fixed tag with runtime cast:**
   - Pros: Simpler API
   - Cons: Loses type safety, only one ConfigFile per application
   - Why rejected: Unsafe and limiting

#### Decision 3: `any` erasure on resolver and defaultPath requirements

**Context:** Resolvers carry their requirements as a type parameter `R` (e.g.,
`FileSystem`). The `ConfigFileOptions.resolvers` array needs to accept
resolvers with heterogeneous requirements.

**Options considered:**

1. **`ReadonlyArray<ConfigResolver<any>>` (Chosen):**
   - Pros: Ergonomic -- consumers can mix resolvers freely
   - Cons: Requirements are not type-checked at the options level
   - Why chosen: Layer composition ensures all requirements are satisfied at
     runtime. Type-level threading of heterogeneous union types through an
     array is not practical in TypeScript

2. **Variadic generics:**
   - Pros: Full type safety
   - Cons: TypeScript does not support this pattern ergonomically
   - Why rejected: Not feasible

#### Decision 4: Error-absorbing resolvers

**Context:** A resolver that fails (e.g., permission denied) should not abort
the entire config loading pipeline. Missing files are expected.

**Approach:** Every resolver wraps its logic in
`Effect.catchAll(() => Effect.succeed(Option.none()))`, converting all errors
to "not found". This means consumers can list resolvers without worrying about
order-dependent failures.

#### Decision 5: PubSub for config lifecycle events

**Context:** Consumers need observability into the config loading pipeline
(which files were found, what failed, when saves happen) without modifying the
core return types.

**Options considered:**

1. **Effect PubSub with opt-in tag (Chosen):**
   - Pros: Zero overhead when not used (emit is `Effect.void`), subscribers
     decouple from producers, multiple listeners possible, no return type
     changes
   - Cons: Events are fire-and-forget, no backpressure
   - Why chosen: PubSub is the idiomatic Effect broadcast mechanism. Opt-in
     via `events` field in options means zero cost for consumers who do not
     need observability

2. **Return events alongside data (tuple return types):**
   - Pros: Events are part of the type-safe pipeline
   - Cons: Breaking API change, every consumer must destructure results
   - Why rejected: Would break all existing consumers and add noise

3. **Effect fiber-local logging:**
   - Pros: Built-in to Effect
   - Cons: Unstructured, not subscribable, harder to filter programmatically
   - Why rejected: Events need structured payloads for downstream processing

#### Decision 6: Codec wrapper pattern for encryption and migration

**Context:** Both encryption and migration need to intercept the parse and/or
stringify pipeline without changing the ConfigCodec interface.

**Approach:** `EncryptedCodec(inner, key)` and `ConfigMigration.make({codec})`
both accept a ConfigCodec and return a new ConfigCodec. This allows arbitrary
composition: `ConfigMigration.make({ codec: EncryptedCodec(JsonCodec, key) })`.
Errors are mapped to CodecError to maintain interface conformance.

#### Decision 7: Polling-based watcher with JSON.stringify comparison

**Context:** Config file watching needs to detect changes across platforms
without native filesystem watcher dependencies.

**Options considered:**

1. **Polling with JSON.stringify comparison (Chosen):**
   - Pros: Works on all platforms, no native dependencies, simple
     implementation, handles Option values naturally
   - Cons: Not instant, CPU cost scales with poll frequency and file count
   - Why chosen: Config files change infrequently. A 5-second default poll
     interval is sufficient for most use cases. The implementation is
     portable and testable

2. **Native fs.watch / inotify:**
   - Pros: Instant notifications, no CPU overhead
   - Cons: Platform-specific behavior, unreliable cross-platform (macOS vs
     Linux vs Windows), requires native bindings
   - Why rejected: Violates platform abstraction principle

### Design Patterns Used

#### Pattern 1: Service/Layer separation

- **Where used:** ConfigFile service + ConfigFileLive/ConfigFileTest layers
- **Why used:** Separates interface from implementation. Enables testing with
  alternate implementations.

#### Pattern 2: Factory functions for parameterized layers

- **Where used:** `ConfigFile.Tag<A>(id)`, `ConfigFile.Live<A>(options)`,
  `ConfigFile.Test<A>(options)`
- **Why used:** Layers that need configuration at construction time cannot be
  static constants.

#### Pattern 3: Error-absorbing resolvers

- **Where used:** All ConfigResolver implementations
- **Why used:** Missing config files are normal; filesystem errors should not
  abort the resolver chain.

#### Pattern 4: Codec wrapper composition

- **Where used:** EncryptedCodec, ConfigMigration.make
- **Why used:** Both features need to intercept the parse/stringify pipeline
  without altering the ConfigCodec interface. Wrapping produces a new
  ConfigCodec that composes naturally with the rest of the system.

#### Pattern 5: Opt-in PubSub events via serviceOption

- **Where used:** ConfigFileLive event emission
- **Why used:** `Effect.serviceOption` allows ConfigFileLive to look up the
  events service without failing if it is absent. This makes events truly
  optional -- no event tag means no events, no error.

#### Pattern 6: Ref-based state in streaming pipelines

- **Where used:** ConfigWatcher polling loop
- **Why used:** `Ref<Map<string, Option<A>>>` tracks previous values across
  poll iterations. Pure functional state management compatible with Effect's
  concurrency model.

### Constraints and Trade-offs

#### Trade-off: Runtime dependency on smol-toml

- **What we gained:** TOML config file support out of the box
- **What we sacrificed:** One bundled runtime dependency
- **Why it is worth it:** TOML is the natural format for CLI tool configuration.
  smol-toml is small (~15KB) and zero-dependency.

#### Trade-off: Web Crypto API for encryption

- **What we gained:** AES-GCM encryption with no native dependencies
- **What we sacrificed:** Requires `globalThis.crypto.subtle` -- available in
  Node 20+, Bun, and Deno, but not older Node versions
- **Why it is worth it:** The library already targets modern runtimes. Web
  Crypto is standardized, audited, and does not require shipping native
  binaries.

#### Trade-off: Platform-agnostic Test layer (formerly Node-coupled)

- **What we gained:** The Test layer now works with any platform
  (Node, Bun, Deno) by accepting `FileSystem` from `@effect/platform`
- **What we sacrificed:** Consumers must now explicitly provide a
  platform-specific FileSystem layer (e.g., `NodeFileSystem.layer`)
- **Why it is worth it:** Decouples the library from Node.js entirely.
  The added consumer boilerplate is minimal (one `Layer.provide` call) and
  enables true multi-platform testing. This was a breaking change at 0.x.

---

## System Architecture

### Config File Loading Pipeline

The core pipeline runs when `ConfigFileService.load` is called:

1. **Discover:** Iterate over the resolver array. Each resolver's `resolve`
   effect runs, returning `Option<path>`. Emits `Discovered` or
   `DiscoveryFailed` events.
2. **Read:** For each found path, read the file content via FileSystem.
3. **Parse:** Pass raw content to the codec's `parse` method. If the codec is
   wrapped (encrypted, migrated), those transformations run here. Emits
   `Parsed` or `ParseFailed` events.
4. **Decode:** Decode the parsed value against the Effect Schema.
5. **Validate:** Run the optional `validate` callback (post-decode hook).
   Emits `Validated` or `ValidationFailed` events.
6. **Collect:** Build `ConfigSource<A>` entries with path, tier, and value.
7. **Resolve:** Pass all sources to the strategy for final resolution.
   Emits `Resolved` event. If no sources, emits `NotFound`.
8. **Complete:** Emits `Loaded` event with the resolved path.

Errors at steps 2-5 are wrapped in `ConfigError` with context (operation,
path, reason). Events at each step are only emitted when the `events` tag
is provided in ConfigFileOptions.

### Component Interactions

```text
Resolver[0]    Resolver[1]    Resolver[N]
  |               |               |
  v               v               v
Option<path>   Option<path>   Option<path>
  |               |               |           Events (opt-in)
  v               v               v              |
FileSystem.readFileString   (for each Some)      v
  |               |                           PubSub<ConfigEvent>
  v               v                              ^
Codec.parse     Codec.parse  ---- emit Parsed ---+
  |               |               (or ParseFailed)
  v               v
Schema.decode   Schema.decode --- emit Validated -+
  |               |               (or ValidationFailed)
  +-------+-------+
          |
          v
   Strategy.resolve([sources]) -- emit Resolved --+
          |
          v
   Final config value A ------- emit Loaded ------+
```

### Codec Composition Pipeline

When codecs are wrapped, the parse pipeline becomes layered:

```text
Raw file content (string)
     |
     v
EncryptedCodec.parse (optional)
  base64-decode -> extract IV -> AES-GCM decrypt
     |
     v
ConfigMigration.parse (optional)
  read version -> apply pending migrations -> update version
     |
     v
Inner codec parse (JsonCodec / TomlCodec)
     |
     v
Parsed unknown value -> Schema.decode -> validate
```

### Error Handling Strategy

All errors are `Data.TaggedError` subclasses, enabling pattern matching via
`Effect.catchTag`:

- **ConfigError** carries the operation (read/parse/validate/encode/stringify/
  write/save/resolve/migration) and optional file path for precise diagnostics
- **CodecError** wraps parse/stringify failures from JSON, TOML, or encrypted
  codecs

ConfigFileLive maps CodecErrors to ConfigErrors at each pipeline stage,
preserving the original error as the `reason` string.

ConfigMigration maps ConfigErrors from migration `up()` functions to
CodecErrors so the wrapped codec satisfies the ConfigCodec interface.

EncryptedCodec produces CodecErrors for key derivation failures, base64
decode/encode errors, and AES-GCM decrypt/encrypt failures.

Event emission failures are silently swallowed (`Effect.catchAll(() =>
Effect.void)`) -- observability must never abort the data pipeline.

---

## Data Flow

### Data Model

```typescript
// Input: consumer provides this to configure ConfigFile
interface ConfigFileOptions<A> {
  readonly tag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
  readonly schema: Schema.Schema<A, any>;
  readonly codec: ConfigCodec;
  readonly strategy: ConfigWalkStrategy<A>;
  readonly resolvers: ReadonlyArray<ConfigResolver<any>>;
  readonly defaultPath?: Effect<string, ConfigError, any>;
  readonly validate?: (value: A) => Effect<A, ConfigError>;
  readonly events?: Context.Tag<ConfigEventsService, ConfigEventsService>; // opt-in
}

// Intermediate: discovered during resolver chain
interface ConfigSource<A> {
  readonly path: string;   // filesystem path
  readonly tier: string;   // resolver name
  readonly value: A;       // parsed + validated value
}

// Event system
class ConfigEvent {
  timestamp: DateTime.Utc;
  event: ConfigEventPayload; // Union of 15 TaggedStruct variants
}

// Watcher output
interface ConfigFileChange<A> {
  readonly path: string;
  readonly previous: Option.Option<A>;
  readonly current: Option.Option<A>;
  readonly timestamp: DateTime.Utc;
}

// Migration definition
interface ConfigFileMigration {
  readonly version: number;
  readonly name: string;
  readonly up: (raw: unknown) => Effect<unknown, ConfigError>;
  readonly down?: (raw: unknown) => Effect<unknown, ConfigError>;
}
```

### Write Flow

```text
[ConfigFileService.save(value)]
        |
        v
[Resolve defaultPath Effect]
        |
        v
[FileSystem.makeDirectory(dirname, recursive)]
        |
        v
[Schema.encodeUnknown(schema)(value)]
        |
        v
[Codec.stringify(encoded)]  -- (if encrypted: encrypt -> base64-encode)
        |
        v
[FileSystem.writeFileString(path, serialized)]
        |                          emit Written
        v
[emit Saved]
        |
        v
[Return path]
```

### Event Subscription Flow

```text
[ConfigEvents.Tag("my-app")]     [ConfigEvents.Live(tag)]
            |                              |
            v                              v
    Context.Tag<Service>          Layer with unbounded PubSub
            |
            +--- pass as options.events to ConfigFile.Live
            |
            v
[ConfigFileLive emits events at each pipeline stage]
            |
            v
[Consumer subscribes via PubSub.subscribe(service.events)]
            |
            v
[Stream of ConfigEvent with timestamp + payload]
```

### Watcher Flow

```text
[ConfigWatcher.Live({ tag, configTag, paths })]
        |
        v
[Initialize: loadFrom each path, store in Ref<Map>]
        |
        v
[Poll loop: Schedule.spaced(interval)]
        |
        v
[For each path: loadFrom -> compare JSON.stringify with previous]
        |
   changed?
   yes |        no
       v         v
[Emit ConfigFileChange]  [Skip]
       |
       v
[Update Ref with new values]
        |
        v
[Stream.mapConcat -> flatten to individual change events]
```

### State Management

- **ConfigFile:** Stateless -- reads filesystem on every call. No caching of
  resolved config values. Each `load` call runs the full resolver chain.
- **ConfigWatcher:** Maintains a `Ref<Map<string, Option<A>>>` tracking the
  last-known value for each watched path. State is scoped to the watcher
  layer lifetime.
- **EncryptedCodec (Passphrase):** Caches the derived CryptoKey after first
  PBKDF2 derivation via a closure-scoped `let cached` variable. One key per
  codec instance.

---

## Integration Points

### Internal Integrations

#### Integration: @effect/platform FileSystem

**How it integrates:** ConfigFileLive requires `FileSystem.FileSystem` in its
layer type. Consumers provide `NodeFileSystem.layer` from
`@effect/platform-node`.

**Data exchange:** File content as strings, directory existence checks, file
writes, directory creation.

### External Integrations

#### Integration: smol-toml

**Purpose:** Parse and stringify TOML configuration files.

**Protocol:** Direct function calls (`parse()`, `stringify()`)

**Error handling:** Parse errors are caught and wrapped in `CodecError`.

#### Integration: xdg-effect (downstream consumer)

**Purpose:** xdg-effect imports config-file-effect and provides XDG-specific
adapters (XdgConfig resolver, XdgSavePath helper) that compose with the
generic ConfigFile system.

**Protocol:** Implements ConfigResolver interface with AppDirs requirements.

---

## Testing Strategy

### Component Isolation

- Integration tests use `mkdtempSync` for unique temp directories with
  `afterEach` cleanup via `rmSync`
- Fixture files in `__test__/integration/fixtures/` provide reusable config
  data (JSON files read via `readFixture` helper)
- Snapshot assertions (`toMatchSnapshot()`) validate complex output structures
- ConfigFile.Test layer pre-populates files and provides automatic cleanup
  via Effect finalizers
- Codec and strategy tests are pure unit tests (no filesystem)

### Test Files

| File | Tests | Type |
| ---- | ----- | ---- |
| `__test__/errors.test.ts` | 2 | Unit: ConfigError + CodecError _tag and message |
| `__test__/codecs.test.ts` | 8 | Unit: JsonCodec + TomlCodec parse/stringify/metadata |
| `__test__/strategies.test.ts` | 4 | Unit: FirstMatch + LayeredMerge with inline sources |
| `__test__/integration/resolvers.int.test.ts` | 13 | Integration: ExplicitPath, StaticDir, UpwardWalk, WorkspaceRoot |
| `__test__/integration/git-root.int.test.ts` | 6 | Integration: GitRoot with .git dir, file (worktree), subpaths |
| `__test__/integration/config-file.int.test.ts` | 20 | Integration: full service pipeline, validate hook/method, Test layer |

### Test Patterns

**Fixtures and helpers:**

Shared test utilities live in `__test__/integration/utils/helpers.ts`:
`FsLayer`, `run` (Effect runner with FileSystem), `readFixture` (loads
fixture JSON from `__test__/integration/fixtures/`).

**mkdtempSync for temp directories:**

Integration tests create unique temp directories via `mkdtempSync(join(tmpdir(),
"cfg-prefix-"))` and clean up in `afterEach`. No hardcoded `/tmp` paths.

**Snapshot assertions:**

Complex output structures (loaded configs, discovered sources, merge results)
use `toMatchSnapshot()` for deterministic assertion without manual `expect`
chains.

---

## Future Enhancements

### Short-term

- **YAML codec:** Add a built-in YAML codec for broader config format support.
- **Native filesystem watcher backend:** Add an optional native watcher
  backend for ConfigWatcher that uses `fs.watch`/inotify alongside polling,
  for lower latency when platform support is available.

### Medium-term

- **Downward migrations:** The `ConfigFileMigration.down()` function is
  defined in the interface but not yet invoked by ConfigMigration.make.
  Implement a `downgrade(targetVersion)` flow.
- **Event filtering and replay:** Add helper utilities for filtering event
  streams by payload tag and replaying events from a bounded buffer.

### Potential Refactoring

- **Type-safe resolver requirements:** Thread resolver requirements through
  the options type instead of using `any` erasure. This would require
  variadic generics or a builder pattern.
- **Migrate from GenericTag:** When Effect adds native type-parameterized
  tags, update ConfigFile.Tag to use the new mechanism.

### Completed (feat/ergonomics branch)

- ~~Config file watching~~ -- Implemented as ConfigWatcher (polling-based)
- ~~Config migration system~~ -- Implemented as ConfigMigration.make
- ~~Platform-agnostic Test layer~~ -- ConfigFileTest decoupled from
  @effect/platform-node
- **Added:** ConfigEvents PubSub event system
- **Added:** EncryptedCodec (AES-GCM encryption wrapper)

---

## Related Documentation

**User-Facing Documentation:**

- `README.md` -- Landing page with install, quick example, and API reference
- `docs/getting-started.md` -- Installation, Effect concepts, quick start
- `docs/codecs.md` -- JsonCodec, TomlCodec, EncryptedCodec, custom codecs
- `docs/resolvers.md` -- All 5 resolvers, resolution mechanics, custom resolvers
- `docs/strategies.md` -- FirstMatch vs LayeredMerge, custom strategies
- `docs/events.md` -- ConfigEvents PubSub setup, event types, subscribing
- `docs/migrations.md` -- ConfigMigration, VersionAccess, writing migrations
- `docs/watcher.md` -- ConfigWatcher setup, WatchOptions, change detection
- `docs/testing.md` -- ConfigFile.Test, platform-agnostic setup, test patterns
- `docs/errors.md` -- ConfigError, CodecError, error handling patterns

**External Resources:**

- [Effect Documentation](https://effect.website/)
- [@effect/platform API](https://github.com/Effect-TS/effect/tree/main/packages/platform)
- [smol-toml](https://github.com/nicolo-ribaudo/smol-toml)

**Upstream:**

- [xdg-effect](https://github.com/spencerbeggs/xdg-effect) -- the library
  this package was extracted from. xdg-effect provides XDG-specific adapters
  (XdgConfig resolver, XdgSavePath helper) on top of config-file-effect.

---

### Public API Surface (barrel export)

The single barrel export at `src/index.ts` re-exports the following:

| Category | Exports | Type |
| -------- | ------- | ---- |
| Codecs | `ConfigCodec` (type), `JsonCodec`, `TomlCodec`, `EncryptedCodec`, `EncryptedCodecKey` | interface + values |
| Errors | `ConfigError`, `ConfigErrorBase`, `CodecError`, `CodecErrorBase` | classes |
| Events | `ConfigEvent`, `ConfigEventPayload`, `ConfigEventsService` (type), `ConfigEvents` | Schema.Class + value |
| Layers | `ConfigFileOptions` (type), `ConfigFileTestOptions` (type) | interfaces |
| Migrations | `ConfigFileMigration` (type), `ConfigMigration`, `VersionAccess` | interface + values |
| Resolvers | `ConfigResolver` (type), `ExplicitPath`, `StaticDir`, `UpwardWalk`, `WorkspaceRoot`, `GitRoot` | interface + values |
| Services | `ConfigFileService` (type), `ConfigFile` | interface + namespace |
| Strategies | `ConfigSource` (type), `ConfigWalkStrategy` (type), `FirstMatch`, `LayeredMerge` | interfaces + values |
| Watcher | `ConfigFileChange` (type), `ConfigWatcherService` (type), `WatchOptions` (type), `ConfigWatcher` | interfaces + namespace |

---

## Changelog

### 2026-04-23 (feat/ergonomics branch sync)

**New subsystems added:**

- **ConfigEvents** -- PubSub event system with 15 lifecycle event variants,
  opt-in via `events` field in ConfigFileOptions
- **EncryptedCodec** -- AES-GCM encrypted codec wrapper with CryptoKey and
  Passphrase key sources
- **ConfigMigration** -- Schema versioning and migration pipeline wrapping
  ConfigCodec, with pluggable VersionAccess
- **ConfigWatcher** -- Polling-based config file change detection returning
  `Stream<ConfigFileChange<A>>`

**Breaking changes:**

- **ConfigFileTest** -- Removed `@effect/platform-node` dependency. Layer
  type changed from `Layer.Layer<..., never, Scope.Scope>` to
  `Layer.Layer<..., never, FileSystem.FileSystem | Scope.Scope>`. Consumer
  must provide platform-specific FileSystem layer.

**Architecture changes:**

- ConfigFileOptions gained optional `events` field
- ConfigFileLive emits structured events at each pipeline stage when events
  tag is provided
- Codec composition pattern established (EncryptedCodec, ConfigMigration.make)
- New directories: `src/events/`, `src/migrations/`, `src/watcher/`

---

**Document Status:** Current at 97% completeness. All sections synced with
the implementation including the five new subsystems from feat/ergonomics:
ConfigEvents, EncryptedCodec, ConfigMigration, ConfigWatcher, and
platform-agnostic ConfigFileTest.
