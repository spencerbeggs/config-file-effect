# config-file-effect

[![npm version](https://img.shields.io/npm/v/config-file-effect)](https://www.npmjs.com/package/config-file-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Effect](https://img.shields.io/badge/Effect-3.21+-black)](https://effect.website/)

Composable config file loading for [Effect](https://effect.website/) with pluggable codecs, resolution strategies, and merge behaviors.

## What is config-file-effect?

config-file-effect is a generic [Effect](https://effect.website/) library for loading, merging, and writing configuration files. You define a schema, pick a codec (JSON or TOML), choose how to find files (explicit path, static directory, upward walk, workspace root), and select a merge strategy (first match or layered merge). Everything composes as Effect `Layers`. Adopt only what you need.

## Features

- **Pluggable codecs** -- JSON and TOML out of the box, bring your own via the `ConfigCodec` interface
- **Five resolvers** -- `ExplicitPath`, `StaticDir`, `UpwardWalk`, `WorkspaceRoot`, and `GitRoot` cover common lookup patterns
- **Two merge strategies** -- `FirstMatch` returns the highest-priority file; `LayeredMerge` deep-merges all sources
- **Schema-validated** -- Every loaded config is decoded through an Effect `Schema` with an optional `validate` hook for custom checks
- **Read and write** -- `load`, `save`, `update`, `discover`, `write`, and `validate` operations on a single service

## Installation

```bash
npm install config-file-effect effect @effect/platform
```

For the `ConfigFile.Test` layer (scoped temp-directory helper), also install the optional peer dependency:

```bash
npm install @effect/platform-node
```

## Quick Example

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
    WorkspaceRoot({ filename: "my-tool.config.toml", subpaths: [".config", "config", "."] }),
    GitRoot({ filename: "my-tool.config.toml", subpaths: [".config", "config", "."] }),
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

## Documentation

- [Getting Started](./docs/01-getting-started.md)
- [Config Files](./docs/02-config-files.md)
- [Testing](./docs/03-testing.md)
- [Error Handling](./docs/04-error-handling.md)
- [API Reference](./docs/05-api-reference.md)

## License

[MIT](./LICENSE)
