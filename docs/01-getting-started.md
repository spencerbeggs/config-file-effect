# Getting Started

config-file-effect provides composable config file loading for Effect
applications. It lets you define a config schema once, then load, merge, and
write config files using pluggable codecs (JSON, TOML, custom), resolution
strategies (explicit path, directory walk, workspace root), and merge behaviors
(first match, layered merge).

## Prerequisites

- Node.js 24+
- A package manager (pnpm, npm, or yarn)
- Basic TypeScript familiarity (generics, async/await)
- Effect experience is helpful but not required; this guide introduces the
  concepts you need

## Installation

```bash
pnpm add config-file-effect effect @effect/platform @effect/platform-node
```

`effect` and `@effect/platform` are peer dependencies. `@effect/platform-node`
is an optional peer dependency required when running on Node.js (provides the
`NodeFileSystem` layer).

## Core Concepts

### Effect

> **Effect concept: Effect** -- An `Effect<A, E, R>` is a description of a
> program that produces a value `A`, can fail with error `E`, and requires
> services `R` to run. Effects are lazy and do nothing until explicitly executed.
> See the [Effect docs](https://effect.website/) for more.

[Effect](https://effect.website/) is a TypeScript library for building
type-safe, composable programs. Rather than executing side effects directly, you
describe what your program should do and let the Effect runtime handle
execution, error propagation, and resource management. The three type parameters
tell you everything about a program at a glance: what it returns, what can go
wrong, and what it needs.

For example, `Effect<AppConfig, ConfigError, ConfigFileService<AppConfig>>` is a
program that returns an `AppConfig`, may fail with `ConfigError`, and requires
the `ConfigFileService<AppConfig>` service.

### Schema

> **Effect concept: Schema** -- `Schema.Struct` defines the shape of a value
> and gives Effect tools to parse, validate, and encode it. Schemas are the
> source of truth for both runtime validation and static types. See the
> [Effect Schema docs](https://effect.website/docs/schema/introduction) for
> more.

config-file-effect uses Effect `Schema` to validate parsed config files at
runtime and derive TypeScript types statically. You define the schema once, and
the library uses it for both parsing (decode) and writing (encode).

### Services and Context.Tag

> **Effect concept: Service** -- A service is a named interface that defines a
> capability. `Context.Tag` gives each service a unique identity so Effect can
> look it up in the runtime context. See the
> [Effect docs on Services](https://effect.website/docs/requirements-management/services)
> for more.

config-file-effect defines one service: `ConfigFileService<A>`. Because
Effect's `Context.Tag` does not support type parameters directly,
`ConfigFile.Tag<A>(id)` is a factory that creates a unique tag for each config
schema. Multiple `ConfigFile` services can coexist in the same layer graph as
long as each has a distinct `id`.

### Layers

> **Effect concept: Layer** -- A `Layer<A, E, R>` is a recipe for constructing
> service `A`. It may fail with `E` and may require services `R` as inputs. See
> the
> [Effect docs on Layers](https://effect.website/docs/requirements-management/layers)
> for more.

`ConfigFile.Live(options)` builds a layer that provides
`ConfigFileService<A>`. The layer requires `FileSystem` from
`@effect/platform`, which you satisfy by providing `NodeFileSystem.layer`.

### Effect.gen and Effect.provide

> **Effect concept: Effect.gen** -- `Effect.gen` lets you write effectful code
> with generator syntax. `yield*` inside a generator extracts values from
> effects, pausing execution until each effect resolves. See the
> [Effect docs on Effect.gen](https://effect.website/docs/getting-started/using-generators)
> for more.

`Effect.gen` lets you write effectful code with generator syntax. `yield*`
inside a generator extracts values from effects -- similar to `await` in async
functions. `Effect.provide` wires services into an effect, satisfying its `R`
requirement. `Effect.runPromise` executes the final effect and returns a
`Promise`.

## Quick Start

The following program defines a config schema, loads a JSON config file from an
explicit path, and prints the result:

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { ConfigFile, ExplicitPath, FirstMatch, JsonCodec } from "config-file-effect";

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

## What's Next

- [Config Files](./02-config-files.md) -- Codecs, resolvers, strategies, full
  examples
- [Testing](./03-testing.md) -- ConfigFile.Test layer and test patterns
- [Error Handling](./04-error-handling.md) -- Typed errors and recovery patterns
- [API Reference](./05-api-reference.md) -- Complete export reference

---

[Next: Config Files](./02-config-files.md)
