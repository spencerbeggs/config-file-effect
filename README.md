# config-file-effect

[![npm version](https://img.shields.io/npm/v/config-file-effect)](https://www.npmjs.com/package/config-file-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Effect](https://img.shields.io/badge/Effect-3.21+-black)](https://effect.website/)

Composable config file loading for [Effect](https://effect.website/) with
pluggable codecs, resolution strategies, and merge behaviors.

## What is config-file-effect?

config-file-effect is a generic [Effect](https://effect.website/) library for
loading, merging, and writing configuration files. You define a schema, pick a
codec (JSON, TOML, or bring your own), choose how to find files (explicit path,
static directory, upward walk, workspace root, git root), and select a merge
strategy (first match or layered merge). Everything composes as Effect `Layers`.
Adopt only what you need.

## Features

- **Pluggable codecs** -- JSON and TOML out of the box; bring your own via the
  `ConfigCodec` interface
- **Encrypted storage** -- AES-GCM codec wrapper with passphrase (PBKDF2) or
  direct CryptoKey support
- **Schema migrations** -- Versioned transforms applied post-parse via codec
  wrapping with pluggable `VersionAccess`
- **Five resolvers** -- `ExplicitPath`, `StaticDir`, `UpwardWalk`,
  `WorkspaceRoot`, and `GitRoot` cover common lookup patterns
- **Two merge strategies** -- `FirstMatch` returns the highest-priority file;
  `LayeredMerge` deep-merges all sources
- **Schema-validated** -- Every loaded config is decoded through an Effect
  `Schema` with an optional `validate` hook
- **Lifecycle events** -- Opt-in PubSub event system with 15 granular pipeline
  events for observability
- **Config watching** -- Polling-based file watcher returning
  `Stream<ConfigFileChange>` with old/new values
- **Read and write** -- `load`, `save`, `update`, `discover`, `write`, and
  `validate` operations on a single service
- **Platform-agnostic** -- Built on `@effect/platform` for Node, Bun, and Deno
  support

## Installation

```bash
npm install config-file-effect effect @effect/platform
# or
pnpm add config-file-effect effect @effect/platform
```

For Node.js, also install the platform-specific filesystem layer:

```bash
npm install @effect/platform-node
```

## Quick start

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import {
  ConfigFile,
  TomlCodec,
  FirstMatch,
  WorkspaceRoot,
  GitRoot,
  UpwardWalk,
} from "config-file-effect";

// 1. Define your config schema
const MyConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
  debug: Schema.optional(Schema.Boolean, { default: () => false }),
});
type MyConfig = typeof MyConfig.Type;

// 2. Create a typed service tag
const MyConfigFile = ConfigFile.Tag<MyConfig>("my-tool/Config");

// 3. Build a layer with codec, strategy, and resolvers
const ConfigLive = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: TomlCodec,
  strategy: FirstMatch,
  resolvers: [
    WorkspaceRoot({ filename: "my-tool.config.toml", subpaths: [".config", "."] }),
    GitRoot({ filename: "my-tool.config.toml", subpaths: [".config", "."] }),
    UpwardWalk({ filename: "my-tool.config.toml" }),
  ],
});

// 4. Load config
const program = Effect.gen(function* () {
  const config = yield* MyConfigFile;
  const value = yield* config.load;
  console.log(value);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(ConfigLive),
    Effect.provide(NodeFileSystem.layer),
  ),
);
```

## Resolvers

Resolvers determine where to look for config files. Each returns
`Option<path>` -- errors are caught and treated as "not found".

| Resolver | Strategy |
| -------- | -------- |
| `ExplicitPath(path)` | Check if a specific file path exists |
| `StaticDir({ dir, filename })` | Check for filename in a known directory |
| `UpwardWalk({ filename, cwd?, stopAt? })` | Walk up from cwd looking for filename |
| `WorkspaceRoot({ filename, subpaths?, cwd? })` | Find monorepo root, check ordered subpaths |
| `GitRoot({ filename, subpaths?, cwd? })` | Find `.git` root, check ordered subpaths |

Resolvers are tried in array order. `WorkspaceRoot` and `GitRoot` accept a
`subpaths` array -- each subpath is tried in order, and `"."` means the root
itself.

## Merge strategies

| Strategy | Behavior |
| -------- | -------- |
| `FirstMatch` | Return the value from the highest-priority source |
| `LayeredMerge` | Deep-merge all sources; higher-priority keys win |

## Codecs

### Built-in format codecs

| Codec | Format | Runtime dependency |
| ----- | ------ | ------------------ |
| `JsonCodec` | JSON | None |
| `TomlCodec` | TOML | `smol-toml` |

### EncryptedCodec

Wraps any `ConfigCodec` with AES-GCM encryption. Supports passphrase-based
key derivation (PBKDF2, 100k iterations, SHA-256) or a direct `CryptoKey`.

```typescript
import { EncryptedCodec, EncryptedCodecKey, JsonCodec } from "config-file-effect";

// From a passphrase
const codec = EncryptedCodec(
  JsonCodec,
  EncryptedCodecKey.fromPassphrase("my-secret", new Uint8Array([1, 2, 3, 4])),
);

// From a pre-derived CryptoKey
const codec2 = EncryptedCodec(
  JsonCodec,
  EncryptedCodecKey.fromCryptoKey(Effect.succeed(myCryptoKey)),
);
```

Files are stored as base64. The first 12 bytes of the decoded buffer are
the random IV; the remainder is AES-GCM ciphertext. Derived keys are
cached after first use.

### ConfigMigration

Wraps a `ConfigCodec` to apply versioned schema migrations post-parse.
Migrations run in ascending version order, skipping already-applied versions.

```typescript
import { ConfigMigration, VersionAccess, TomlCodec } from "config-file-effect";
import { Effect } from "effect";

const migratedCodec = ConfigMigration.make({
  codec: TomlCodec,
  migrations: [
    {
      version: 2,
      name: "rename-field",
      up: (raw) =>
        Effect.succeed({
          ...(raw as Record<string, unknown>),
          newField: (raw as Record<string, unknown>).oldField,
        }),
    },
    {
      version: 3,
      name: "add-defaults",
      up: (raw) =>
        Effect.succeed({
          ...(raw as Record<string, unknown>),
          timeout: 30,
        }),
    },
  ],
  // Optional: customize where version is stored (default: top-level `version` field)
  versionAccess: VersionAccess.default,
});
```

Codec wrappers compose. For encrypted configs with migrations:

```typescript
const codec = ConfigMigration.make({
  codec: EncryptedCodec(JsonCodec, key),
  migrations,
});
```

## ConfigFile service

The `ConfigFileService<A>` interface provides:

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `load` | `Effect<A, ConfigError>` | Discover, parse, validate, and resolve |
| `loadFrom` | `(path: string) => Effect<A, ConfigError>` | Load from a specific path |
| `loadOrDefault` | `(defaultValue: A) => Effect<A, ConfigError>` | Load or fall back to a default |
| `discover` | `Effect<ReadonlyArray<ConfigSource<A>>, ConfigError>` | List all found sources |
| `save` | `(value: A) => Effect<string, ConfigError>` | Save to `defaultPath`, creating directories |
| `write` | `(value: A, path: string) => Effect<void, ConfigError>` | Write to a specific path |
| `update` | `(fn: (current: A) => A, defaultValue?: A) => Effect<A, ConfigError>` | Load, transform, save |
| `validate` | `(value: unknown) => Effect<A, ConfigError>` | Validate against the schema |

## ConfigEvents

Opt-in PubSub event system for observability into the config pipeline. When
the `events` tag is provided in `ConfigFileOptions`, the service emits
structured events at each pipeline stage. When absent, event emission is a
no-op with zero overhead.

```typescript
import { ConfigFile, ConfigEvents, TomlCodec, FirstMatch } from "config-file-effect";
import { Effect, PubSub, Stream } from "effect";

// 1. Create an events tag and layer
const MyEvents = ConfigEvents.Tag("my-tool");
const EventsLive = ConfigEvents.Live(MyEvents);

// 2. Pass the events tag to ConfigFile.Live
const ConfigLive = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: TomlCodec,
  strategy: FirstMatch,
  resolvers: [/* ... */],
  events: MyEvents, // opt-in
});

// 3. Subscribe to events
const program = Effect.gen(function* () {
  const { events } = yield* MyEvents;
  const dequeue = yield* PubSub.subscribe(events);

  // Process events as a stream
  yield* Stream.fromQueue(dequeue).pipe(
    Stream.tap((event) => Effect.log(`${event.event._tag} at ${event.timestamp}`)),
    Stream.runDrain,
  );
});
```

### Event types

| Event | Emitted when |
| ----- | ------------ |
| `Discovered` | Resolver finds a file |
| `DiscoveryFailed` | Resolver fails or returns none |
| `Resolved` | Strategy selects a source |
| `ResolutionFailed` | Strategy fails |
| `Parsed` / `ParseFailed` | Codec parse succeeds/fails |
| `Stringified` / `StringifyFailed` | Codec stringify succeeds/fails |
| `Validated` / `ValidationFailed` | Schema decode succeeds/fails |
| `Loaded` | Config value fully loaded |
| `Saved` | Config saved to default path |
| `Updated` | Config updated (load + save) |
| `Written` | File written to disk |
| `NotFound` | No config sources found |

## ConfigWatcher

Polling-based file watcher that returns a `Stream` of changes whenever
watched files differ from their previous values.

```typescript
import { ConfigFile, ConfigWatcher, TomlCodec, FirstMatch } from "config-file-effect";
import { Duration, Effect, Stream } from "effect";

const MyWatcher = ConfigWatcher.Tag<MyConfig>("my-tool/Watcher");

const WatcherLive = ConfigWatcher.Live({
  tag: MyWatcher,
  configTag: MyConfigFile,
  paths: ["/etc/my-tool/config.toml", "./my-tool.config.toml"],
});

const program = Effect.gen(function* () {
  const watcher = yield* MyWatcher;
  yield* watcher
    .watch({ interval: Duration.seconds(10) })
    .pipe(
      Stream.tap((change) =>
        Effect.log(`${change.path} changed at ${change.timestamp}`),
      ),
      Stream.runDrain,
    );
});
```

Each `ConfigFileChange<A>` carries `path`, `previous` (Option), `current`
(Option), and `timestamp`. File appearance and disappearance are represented
via `Option.some`/`Option.none`.

## Testing

`ConfigFile.Test` creates a scoped test layer that pre-populates files in a
temp directory and cleans up on scope close. The test layer is
platform-agnostic -- you provide the filesystem layer.

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { ConfigFile, JsonCodec, FirstMatch, ExplicitPath } from "config-file-effect";

const TestConfig = Schema.Struct({ name: Schema.String });
type TestConfig = typeof TestConfig.Type;
const TestTag = ConfigFile.Tag<TestConfig>("test/Config");

const TestLayer = ConfigFile.Test({
  tag: TestTag,
  schema: TestConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("/tmp/test-config/config.json")],
  files: {
    "/tmp/test-config/config.json": JSON.stringify({ name: "test" }),
  },
});

const program = Effect.gen(function* () {
  const config = yield* TestTag;
  const value = yield* config.load;
  console.log(value.name); // "test"
});

// Provide both the test layer and a platform FileSystem
await Effect.runPromise(
  program.pipe(
    Effect.provide(TestLayer),
    Effect.provide(NodeFileSystem.layer),
    Effect.scoped,
  ),
);
```

## Error handling

All errors extend `Data.TaggedError` for pattern matching with
`Effect.catchTag`:

```typescript
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const config = yield* MyConfigFile;
  const value = yield* config.load.pipe(
    Effect.catchTag("ConfigError", (e) =>
      Effect.succeed({ name: "fallback", port: 3000, debug: false }),
    ),
  );
});
```

| Error | Tag | Key fields |
| ----- | --- | ---------- |
| `ConfigError` | `"ConfigError"` | `operation`, `path?`, `reason` |
| `CodecError` | `"CodecError"` | `codec`, `operation`, `reason` |

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Codecs](./docs/codecs.md) -- JsonCodec, TomlCodec, EncryptedCodec, custom
  codecs
- [Resolvers](./docs/resolvers.md) -- All 5 resolvers, resolution mechanics,
  custom resolvers
- [Strategies](./docs/strategies.md) -- FirstMatch vs LayeredMerge, custom
  strategies
- [Events](./docs/events.md) -- PubSub event system for pipeline observability
- [Migrations](./docs/migrations.md) -- Versioned config transforms
- [Watcher](./docs/watcher.md) -- Polling-based file change detection
- [Testing](./docs/testing.md) -- ConfigFile.Test, test patterns
- [Errors](./docs/errors.md) -- ConfigError, CodecError, error handling patterns

## License

[MIT](./LICENSE)
