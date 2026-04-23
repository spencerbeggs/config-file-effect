---
"config-file-effect": minor
---

## Features

Initial release of `config-file-effect` as a standalone package, extracted from `xdg-effect`. The package provides composable, Effect-native configuration file loading with pluggable codecs, resolution strategies, and merge behaviors.

### ConfigFile service

`ConfigFile` is the central namespace for creating typed configuration services. It exposes three factory members:

- `ConfigFile.Tag<A>(id)` — creates a unique `Context.Tag` for a `ConfigFileService<A>`, keyed by a string identifier
- `ConfigFile.Live<A>(options)` — builds a live `Layer` from codecs, resolvers, and a walk strategy; requires `FileSystem.FileSystem`
- `ConfigFile.Test<A>(options)` — builds a scoped test `Layer` that pre-populates a temp directory and cleans up on scope close

The `ConfigFileService<A>` interface provides:

- `load` — discover sources and resolve them through the configured strategy
- `loadFrom(path)` — load from an explicit filesystem path
- `discover` — return the raw list of `ConfigSource<A>` objects without resolving
- `loadOrDefault(defaultValue)` — fall back to a default when no sources are found
- `write(value, path)` — encode and write to an explicit path (parent directory must already exist)
- `save(value)` — encode and write to the configured default path, creating parent directories automatically
- `update(fn, defaultValue?)` — load the current value, apply a transform, and save the result
- `validate(value)` — run schema decode and optional validate callback without file I/O

An optional `validate` callback on `ConfigFileOptions` runs after schema decode in every load path, enabling custom semantic validation or value transformation.

### Codecs

Two built-in codecs for serialization and deserialization:

- `JsonCodec` — parses and stringifies JSON
- `TomlCodec` — parses and stringifies TOML via `smol-toml`

The `ConfigCodec` interface is exported for implementing custom codecs.

### Resolvers

Five built-in resolvers control where config files are looked up:

- `ExplicitPath(path)` — resolves if the given absolute path exists
- `StaticDir(options)` — looks for a filename inside a fixed directory
- `UpwardWalk(options)` — walks up from a starting directory until the filename is found or the filesystem root is reached
- `WorkspaceRoot(options)` — locates a monorepo workspace root (detected by `pnpm-workspace.yaml` or a `package.json` with a `workspaces` field) and checks an ordered list of `subpaths` for the file
- `GitRoot(options)` — locates the git repository root (`.git` directory or worktree file) and checks an ordered list of `subpaths` for the file

`WorkspaceRoot` and `GitRoot` both accept `subpaths?: ReadonlyArray<string>` to check subdirectories of the root in priority order.

The `ConfigResolver` interface is exported for implementing custom resolvers.

### Merge strategies

Two built-in strategies control how multiple discovered sources are combined:

- `FirstMatch` — returns the first (highest-priority) source and ignores the rest
- `LayeredMerge` — deep-merges all sources with higher-priority sources winning on key conflicts; nested objects are merged recursively

The `ConfigWalkStrategy` and `ConfigSource` types are exported for implementing custom strategies.

### Tagged errors

- `ConfigError` — raised for any file operation failure (`read`, `parse`, `validate`, `encode`, `stringify`, `write`, `save`, `resolve`); carries `operation`, optional `path`, and `reason` fields
- `CodecError` — raised by codec implementations when parsing or stringification fails

Both errors are Effect `Data.TaggedError` subclasses and can be caught with `Effect.catchTag`.

### Getting started

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import {
  ConfigFile,
  JsonCodec,
  FirstMatch,
  StaticDir,
} from "config-file-effect";

const MyConfig = Schema.Struct({ port: Schema.Number });
type MyConfig = Schema.Schema.Type<typeof MyConfig>;

const Tag = ConfigFile.Tag<MyConfig>("app/config");

const ConfigLayer = ConfigFile.Live({
  tag: Tag,
  schema: MyConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [StaticDir({ dir: "/etc/myapp", filename: "config.json" })],
});

const program = Effect.gen(function* () {
  const config = yield* Tag;
  const loaded = yield* config.load;
  console.log(loaded.port);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(ConfigLayer),
    Effect.provide(NodeFileSystem.layer),
  ),
);
```
