# Getting Started

config-file-effect provides composable config file loading for Effect
applications. It lets you define a config schema once, then load, merge, and
write config files using pluggable codecs (JSON, TOML, encrypted, custom),
resolution strategies (explicit path, directory walk, workspace root, git root),
and merge behaviors (first match, layered merge).

## Prerequisites

- Node.js 20+ (or Bun / Deno with `@effect/platform` support)
- A package manager (pnpm, npm, or yarn)
- Basic TypeScript familiarity (generics, async/await)
- Effect experience is helpful but not required; this guide introduces the
  concepts you need

## Installation

```bash
pnpm add config-file-effect effect @effect/platform @effect/platform-node
```

`effect` and `@effect/platform` are peer dependencies. `@effect/platform-node`
provides the `NodeFileSystem` layer required when running on Node.js. For Bun,
use `@effect/platform-bun` instead.

## Core Concepts

### Effect

[Effect](https://effect.website/) is a TypeScript library for building
type-safe, composable programs. An `Effect<A, E, R>` is a lazy description of a
program that produces a value `A`, can fail with error `E`, and requires
services `R` to run. Effects do nothing until explicitly executed.

For example, `Effect<AppConfig, ConfigError, ConfigFileService<AppConfig>>` is a
program that returns an `AppConfig`, may fail with `ConfigError`, and requires
the `ConfigFileService<AppConfig>` service.

### Schema

config-file-effect uses Effect `Schema` to validate parsed config files at
runtime and derive TypeScript types statically. You define the schema once, and
the library uses it for both parsing (decode) and writing (encode). See the
[Effect Schema docs](https://effect.website/docs/schema/introduction) for more.

### Services and Context.Tag

A service is a named interface that defines a capability. `Context.Tag` gives
each service a unique identity so Effect can look it up in the runtime context.

config-file-effect defines one core service: `ConfigFileService<A>`. Because
Effect's `Context.Tag` does not support type parameters directly,
`ConfigFile.Tag<A>(id)` is a factory that creates a unique tag for each config
schema. Multiple `ConfigFile` services can coexist in the same layer graph as
long as each has a distinct `id`.

### Layers

A `Layer<A, E, R>` is a recipe for constructing service `A`. It may fail with
`E` and may require services `R` as inputs.

`ConfigFile.Live(options)` builds a layer that provides
`ConfigFileService<A>`. The layer requires `FileSystem` from
`@effect/platform`, which you satisfy by providing `NodeFileSystem.layer`.

## Quick Start

The following program defines a config schema, loads a JSON config file from an
explicit path, and prints the result:

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import {
  ConfigFile,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

// 1. Define the config schema
const AppConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
  debug: Schema.optional(Schema.Boolean, { default: () => false }),
});
type AppConfig = typeof AppConfig.Type;

// 2. Create a unique service tag
const AppConfigFile = ConfigFile.Tag<AppConfig>("app/Config");

// 3. Build the live layer
const ConfigLayer = ConfigFile.Live({
  tag: AppConfigFile,
  schema: AppConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./app.config.json")],
});

// 4. Use the service
const program = Effect.gen(function* () {
  const configFile = yield* AppConfigFile;
  const config = yield* configFile.load;
  console.log("Loaded config:", config);
});

// 5. Provide layers and run
Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.provide(ConfigLayer, NodeFileSystem.layer)),
  ),
);
```

Create an `app.config.json` file in the project root:

```json
{
  "name": "my-app",
  "port": 3000
}
```

Running the program produces:

```text
Loaded config: { name: 'my-app', port: 3000, debug: false }
```

The `debug` field defaults to `false` because it was not present in the file
and the schema specifies `default: () => false`.

## The Pipeline at a Glance

Every `configFile.load` call runs this pipeline:

1. **Resolve** -- Each resolver checks for a config file and returns
   `Option.some(path)` or `Option.none()`.
2. **Read** -- For each found path, read the file content from disk.
3. **Parse** -- Pass the raw string to the codec's `parse` method.
4. **Decode** -- Validate the parsed value against the Effect Schema.
5. **Validate** -- Run the optional `validate` hook (if configured).
6. **Merge** -- Pass all discovered sources to the strategy for final
   resolution.

## ConfigFileService Methods

Once you have a `ConfigFileService<A>`, these methods are available:

| Method | Description |
| ------ | ----------- |
| `load` | Run full resolver chain, parse, validate, merge |
| `loadFrom(path)` | Load from a specific path, bypassing resolvers |
| `discover` | Return all found sources without merging |
| `write(value, path)` | Encode and write to a specific path |
| `loadOrDefault(default)` | Load, or return default if no sources found |
| `save(value)` | Encode and write to `defaultPath` (creates directories) |
| `update(fn, default?)` | Load, transform, save atomically |
| `validate(value)` | Decode and validate without file I/O |

## What's Next

- [Codecs](./codecs.md) -- JsonCodec, TomlCodec, EncryptedCodec, custom codecs
- [Resolvers](./resolvers.md) -- All 5 resolvers, resolution mechanics, custom
  resolvers
- [Strategies](./strategies.md) -- FirstMatch vs LayeredMerge, custom strategies
- [Events](./events.md) -- PubSub event system for pipeline observability
- [Migrations](./migrations.md) -- Versioned config transforms
- [Watcher](./watcher.md) -- Polling-based file change detection
- [Testing](./testing.md) -- ConfigFile.Test, test patterns
- [Errors](./errors.md) -- ConfigError, CodecError, error handling patterns
