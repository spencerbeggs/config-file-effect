# Config Files

config-file-effect's config file system is built from three pluggable
components: codecs (how to parse/write), resolvers (where to look), and
strategies (how to merge multiple sources). Together they power the `ConfigFile`
service.

## Defining a Config Schema

> **Effect concept: Schema** -- `Schema.Struct` defines the shape of a value
> and gives Effect tools to parse, validate, and encode it. Schemas are the
> source of truth for both runtime validation and static types. See the
> [Effect Schema docs](https://effect.website/docs/schema/introduction) for
> more.

Use `Schema.Struct` to describe the shape of your config. Fields wrapped in
`Schema.optional` are not required at parse time; the `default` option provides
a fallback value when the field is absent.

```typescript
import { Schema } from "effect";

const MyToolConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
  debug: Schema.optional(Schema.Boolean, { default: () => false }),
  allowedHosts: Schema.optional(Schema.Array(Schema.String), {
    default: () => [],
  }),
});
type MyToolConfig = typeof MyToolConfig.Type;
```

The `type MyToolConfig = typeof MyToolConfig.Type` idiom extracts a TypeScript
type from an Effect Schema definition, giving you a regular TypeScript type for
annotations and generics.

`Schema.Struct` describes a plain object with typed fields. `Schema.optional`
marks a field as not required when decoding -- if the field is missing from the
parsed file, the default function is called and its return value is used instead.

## Codecs

A codec knows how to parse raw file content into a JavaScript value and
serialize a value back into file content. The `ConfigCodec` interface is:

```typescript
interface ConfigCodec {
  readonly name: string;
  readonly extensions: ReadonlyArray<string>;
  readonly parse: (raw: string) => Effect<unknown, CodecError>;
  readonly stringify: (value: unknown) => Effect<string, CodecError>;
}
```

Both `parse` and `stringify` return `Effect` values so that errors are captured
as typed `CodecError` failures rather than thrown exceptions.

### JsonCodec

Parses with `JSON.parse` and serializes with `JSON.stringify` using tab
indentation. Handles files with the `.json` extension.

### TomlCodec

Parses and serializes with the `smol-toml` library. Handles files with the
`.toml` extension. TOML's syntax -- with its sections and key-value pairs -- is
a natural fit for CLI tool configuration (used by Cargo, Python's
`pyproject.toml`, and many other developer tools).

### Custom Codecs

To support another format (YAML, INI, etc.), implement the `ConfigCodec`
interface directly. Return `Effect.succeed` for successful operations and
`Effect.fail(new CodecError(...))` for parse or serialization failures.

```typescript
import { Effect } from "effect";
import { CodecError } from "config-file-effect";
import type { ConfigCodec } from "config-file-effect";

const YamlCodec: ConfigCodec = {
  name: "yaml",
  extensions: [".yaml", ".yml"],
  parse: (raw) =>
    Effect.try({
      try: () => parseYaml(raw),
      catch: (error) =>
        new CodecError({ codec: "yaml", operation: "parse", reason: String(error) }),
    }),
  stringify: (value) =>
    Effect.try({
      try: () => stringifyYaml(value),
      catch: (error) =>
        new CodecError({ codec: "yaml", operation: "stringify", reason: String(error) }),
    }),
};
```

## Resolvers

A resolver encapsulates one strategy for locating a config file on disk. The
`ConfigResolver` interface is:

```typescript
interface ConfigResolver<R = never> {
  readonly name: string;
  readonly resolve: Effect<Option<string>, never, R>;
}
```

The `R` type parameter captures what services the resolver needs (typically
`FileSystem`). The effect returns `Option.some(path)` when a file is found, and
`Option.none()` when it is not.

Each resolver carries its requirements in the `R` type parameter -- for example,
`ExplicitPath` has `R = FileSystem`. The `ConfigFileOptions.resolvers` array
uses `ReadonlyArray<ConfigResolver<any>>`, which erases `R` for ergonomics.
Layer composition ensures all requirements are satisfied at runtime.

**Key design:** all errors inside a resolver are caught and converted to
`Option.none()`. A permission-denied error, a missing directory, or any other
filesystem problem is treated as "not found" rather than aborting the resolver
chain. This means you can list resolvers without worrying about order-dependent
failures.

### Built-in Resolvers

| Resolver | Use case | Requirements |
| -------- | -------- | ------------ |
| `ExplicitPath` | `--config` CLI flag | `FileSystem` |
| `StaticDir` | System-wide config (e.g., `/etc/my-tool/`) | `FileSystem` |
| `UpwardWalk` | Project-local config | `FileSystem` |
| `WorkspaceRoot` | Shared monorepo config | `FileSystem` |
| `GitRoot` | Config at git repository root | `FileSystem` |

**ExplicitPath(path: string)** -- Checks whether a specific file path exists.
Returns the path if it does, `Option.none()` if it does not. Use this when the
user has passed a `--config` flag pointing at a known location.

```typescript
import { ExplicitPath } from "config-file-effect";

ExplicitPath("./my-tool.config.toml")
ExplicitPath(argv.config) // from parsed CLI flags
```

**StaticDir({ dir, filename })** -- Joins a known directory and filename, then
checks for the file's existence. Use this for system-wide config locations that
are fixed at deploy time.

```typescript
import { StaticDir } from "config-file-effect";

StaticDir({ dir: "/etc/my-tool", filename: "config.toml" })
```

**UpwardWalk({ filename, cwd?, stopAt? })** -- Starts from `cwd` (defaults to
`process.cwd()`) and walks toward the filesystem root, checking each directory
for `filename`. Stops when the file is found, the root is reached, or the
optional `stopAt` boundary is hit. Use this for project-local config files that
live next to a project's source.

```typescript
import { UpwardWalk } from "config-file-effect";

UpwardWalk({ filename: "my-tool.config.toml" })
UpwardWalk({ filename: "my-tool.config.toml", stopAt: "/home/user" })
```

**WorkspaceRoot({ filename, subpaths?, cwd? })** -- Walks up from `cwd` looking
for a monorepo workspace root, identified by a `pnpm-workspace.yaml` file or a
`package.json` with a `workspaces` field. When found, checks for `filename`
under each entry in `subpaths` (tried in order, first match wins). Use `"."` to
check the root itself. When `subpaths` is omitted the root is checked directly.
Use this for config shared across all packages in a monorepo.

```typescript
import { WorkspaceRoot } from "config-file-effect";

// Finds monorepo root, checks for config file at the root
const resolver = WorkspaceRoot({ filename: ".myapprc.json" });

// With subpaths -- tries each subdirectory in order, first match wins
// "." means the root itself
const resolver2 = WorkspaceRoot({
  filename: "config.toml",
  subpaths: [".config", "config", "."],
});
```

**GitRoot({ filename, subpaths?, cwd? })** -- Walks up from `cwd` looking for a
`.git` directory or file (git worktrees use a `.git` file pointing to the real
repository). When found, checks for `filename` under each entry in `subpaths`
(tried in order, first match wins). Use `"."` to check the root itself. When
`subpaths` is omitted the root is checked directly. Use this when your tool's
config lives at the root of a git repository that may not be a monorepo.

```typescript
import { GitRoot } from "config-file-effect";

// Finds git root, checks for config file there
const resolver = GitRoot({ filename: ".myapprc.json" });

// With subpaths -- tries .config/, config/, then root
const resolver2 = GitRoot({
  filename: "config.toml",
  subpaths: [".config", "config", "."],
});
```

### Typical Resolver Chain

A common pattern is to combine `WorkspaceRoot`, `GitRoot`, and `UpwardWalk` so
that config is found in whichever context the project lives in -- monorepo, git
repo, or standalone directory:

```typescript
import { WorkspaceRoot, GitRoot, UpwardWalk } from "config-file-effect";

resolvers: [
  WorkspaceRoot({ filename: "tool.toml", subpaths: [".config", "config", "."] }),
  GitRoot({ filename: "tool.toml", subpaths: [".config", "config", "."] }),
  UpwardWalk({ filename: "tool.toml" }),
]
```

The resolvers are tried in order. The first resolver to find a file produces the
highest-priority source. In a monorepo, `WorkspaceRoot` finds the workspace
root's config. In a plain git repo, `GitRoot` picks it up. `UpwardWalk` acts as
a fallback for any directory structure.

## Strategies

After the resolver chain runs, all discovered sources are passed to a strategy
that produces a single config value. The relevant types are:

```typescript
interface ConfigSource<A> {
  readonly path: string;
  readonly tier: string;
  readonly value: A;
}

interface ConfigWalkStrategy<A> {
  readonly resolve: (sources: ReadonlyArray<ConfigSource<A>>) => Effect<A, ConfigError>;
}
```

`sources` is ordered from highest to lowest priority (the order of the resolver
array). `tier` is the resolver's `name` field, useful for logging which source
contributed which value.

Both built-in strategies fail with `ConfigError` when the source list is empty
(no config file was found anywhere).

> **Note:** Both `FirstMatch` and `LayeredMerge` are exported as
> `ConfigWalkStrategy<any>` for ergonomics -- the type parameter is not enforced
> at compile time. Type safety for your config shape comes from the `schema`
> field in `ConfigFileOptions`, not from the strategy.

### FirstMatch

Returns the value from the first source -- that is, the highest-priority
resolver that found a file. This is fast and simple. Lower-priority sources are
ignored entirely.

### LayeredMerge

Deep-merges all sources. The lowest-priority source is used as the base, and
higher-priority sources are applied on top. For nested objects, keys are merged
recursively. For any scalar value (string, number, boolean, array), the
higher-priority source wins when there is a conflict. Sources are processed from
lowest to highest priority. For each key, if the higher-priority source already
has a value, it is preserved.

### Concrete Example

Suppose two config files are found during a resolver walk:

- Project-level (higher priority): `{ port: 3000, debug: true }`
- User-level (lower priority): `{ port: 8080, name: "production" }`

**FirstMatch** returns: `{ port: 3000, debug: true }` -- the project-level file
only.

**LayeredMerge** returns: `{ port: 3000, debug: true, name: "production" }` --
merged with the project-level value winning the `port` conflict and the
user-level value contributing `name`.

### Custom Strategies

Implement the `ConfigWalkStrategy` interface to create custom resolution logic.
This example fails if multiple config sources are found, enforcing that only one
source should exist.

```typescript
import { Effect } from "effect";
import { ConfigError } from "config-file-effect";
import type { ConfigWalkStrategy, ConfigSource } from "config-file-effect";

const StrictFirst: ConfigWalkStrategy<any> = {
  resolve: (sources: ReadonlyArray<ConfigSource<any>>) => {
    if (sources.length === 0) {
      return Effect.fail(
        new ConfigError({ operation: "resolve", reason: "no config sources found" }),
      );
    }
    if (sources.length > 1) {
      return Effect.fail(
        new ConfigError({
          operation: "resolve",
          reason: `expected exactly one config source, found ${sources.length}`,
        }),
      );
    }
    return Effect.succeed(sources[0]!.value);
  },
};
```

## Putting It Together

### ConfigFile.Tag

```typescript
ConfigFile.Tag<A>(id: string)
// equivalent to: Context.GenericTag<ConfigFileService<A>>("config-file-effect/ConfigFile/${id}")
```

Creates a unique `Context.Tag` for a `ConfigFileService<A>`. This factory is
necessary because Effect's `Context.Tag` does not support type parameters
directly -- `Context.GenericTag` is the internal mechanism that allows each
config schema to have its own uniquely-keyed tag. Multiple `ConfigFile` services
can coexist in the same layer graph as long as each has a distinct `id`.

### ConfigFile.Live

Creates the live layer from a `ConfigFileOptions` object:

```typescript
ConfigFile.Live<A>(options: ConfigFileOptions<A>)
```

```typescript
interface ConfigFileOptions<A> {
  readonly tag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
  readonly schema: Schema.Schema<A, any>;
  readonly codec: ConfigCodec;
  readonly strategy: ConfigWalkStrategy<A>;
  readonly resolvers: ReadonlyArray<ConfigResolver<any>>;
  readonly defaultPath?: Effect<string, ConfigError, any>;
  readonly validate?: (value: A) => Effect<A, ConfigError>;
}
```

The optional `defaultPath` field is an Effect that resolves to a file path. When
provided, it enables the `save` and `update` methods on the resulting service.

The optional `validate` field is a callback that runs after schema decoding on
every load path (`load`, `loadFrom`, `loadOrDefault`, and `discover`). It
receives the decoded value and returns an `Effect` that can reject it with a
`ConfigError` or transform it. Use this for cross-field validation, environment
checks, or value normalization that goes beyond what the schema can express:

```typescript
import { Effect } from "effect";
import { ConfigError } from "config-file-effect";

ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: TomlCodec,
  strategy: FirstMatch,
  resolvers: [UpwardWalk({ filename: "config.toml" })],
  defaultPath: Effect.succeed("/home/user/.config/my-app/config.toml"),
  validate: (value) =>
    value.port < 1024
      ? Effect.fail(
          new ConfigError({
            operation: "validate",
            reason: `port ${value.port} requires root privileges`,
          }),
        )
      : Effect.succeed(value),
});
```

### ConfigFileService

```typescript
interface ConfigFileService<A> {
  readonly load: Effect<A, ConfigError>;
  readonly loadFrom: (path: string) => Effect<A, ConfigError>;
  readonly discover: Effect<ReadonlyArray<ConfigSource<A>>, ConfigError>;
  readonly write: (value: A, path: string) => Effect<void, ConfigError>;
  readonly loadOrDefault: (defaultValue: A) => Effect<A, ConfigError>;
  readonly save: (value: A) => Effect<string, ConfigError>;
  readonly update: (fn: (current: A) => A, defaultValue?: A) => Effect<A, ConfigError>;
  readonly validate: (value: unknown) => Effect<A, ConfigError>;
}
```

- **`load`** -- runs the full resolver chain, parses each found file, validates
  against the schema (and the `validate` hook, if configured), and applies the
  strategy to produce a single merged value.
- **`loadFrom`** -- bypasses the resolver chain and loads directly from a known
  path. Useful when you already know where the file is.
- **`discover`** -- runs the resolver chain and returns all found sources
  without merging. Useful for inspecting which files contribute to the final
  config.
- **`write`** -- encodes the value through the schema, serializes it with the
  codec, and writes the result to the given path. The parent directory must
  already exist.
- **`loadOrDefault`** -- runs the resolver chain; if no sources are found,
  returns the provided default value instead of failing with a `ConfigError`.
  Parse and validation errors for existing files are still propagated.
- **`save`** -- encodes the value and writes it to the `defaultPath`. Fails with
  `ConfigError` if no `defaultPath` was configured. Creates parent directories
  automatically. Returns the path that was written to.
- **`update`** -- loads the current config (using `loadOrDefault` if a
  `defaultValue` is provided, otherwise `load`), applies the transformation
  function `fn`, then `save`s the result. Returns the updated value.
- **`validate`** -- decodes an unknown value through the schema and runs the
  `validate` hook (if configured), without any file I/O. Useful for validating
  user-supplied values or testing schema conformance programmatically.

### Full Example

The following program wires a 3-resolver chain, TOML codec, and `LayeredMerge`
strategy:

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import {
  ConfigFile,
  TomlCodec,
  LayeredMerge,
  UpwardWalk,
  StaticDir,
  ExplicitPath,
} from "config-file-effect";

// Config schema
const MyToolConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
  debug: Schema.optional(Schema.Boolean, { default: () => false }),
  allowedHosts: Schema.optional(Schema.Array(Schema.String), {
    default: () => [],
  }),
});
type MyToolConfig = typeof MyToolConfig.Type;

// Typed service tag
const MyToolConfigFile = ConfigFile.Tag<MyToolConfig>("my-tool/Config");

// Layer with 3-resolver chain (highest to lowest priority)
const ConfigLayer = ConfigFile.Live({
  tag: MyToolConfigFile,
  schema: MyToolConfig,
  codec: TomlCodec,
  strategy: LayeredMerge,
  resolvers: [
    ExplicitPath("./my-tool.config.toml"),   // project-local (highest)
    UpwardWalk({ filename: "my-tool.config.toml" }), // walk up
    StaticDir({ dir: "/etc/my-tool", filename: "config.toml" }), // system (lowest)
  ],
});

const program = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;

  // Load merged config from all sources
  const config = yield* configFile.load;
  console.log("Loaded config:", config);

  // Or discover all sources without merging
  const sources = yield* configFile.discover;
  for (const source of sources) {
    console.log(`Found ${source.tier} config at ${source.path}`);
  }
});

Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.provide(ConfigLayer, NodeFileSystem.layer)),
  ),
);
```

The resolver array determines priority: the first resolver that finds a file
produces the highest-priority source. With `LayeredMerge`, all found sources
contribute to the result. With `FirstMatch`, only the first resolver's file is
used.

## Writing Config Files

Use `configFile.write` to serialize a value and write it to disk. The codec
controls the output format -- `TomlCodec` produces TOML, `JsonCodec` produces
indented JSON:

```typescript
const program = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;
  yield* configFile.write(
    { name: "my-tool", port: 3000, debug: false, allowedHosts: [] },
    "/home/user/.config/my-tool/config.toml",
  );
});
```

The value is first encoded through the schema (applying any transforms defined
there), then serialized by the codec, then written to the given path. If the
parent directory does not exist, the write will fail with a `ConfigError`;
create the directory first if needed.

**Note:** `write` writes to a single specified path. If you used `LayeredMerge`
to load from multiple sources, `write` does not update all discovered sources --
it only writes to the path you provide.

## Save and Update

The `save` and `update` methods require a `defaultPath` in `ConfigFileOptions`.
Unlike `write`, `save` creates parent directories automatically.

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import {
  ConfigFile,
  FirstMatch,
  TomlCodec,
  UpwardWalk,
} from "config-file-effect";

const AppConfigSchema = Schema.Struct({
  name: Schema.String,
  port: Schema.optional(Schema.Number),
});
type AppConfig = typeof AppConfigSchema.Type;
const AppConfig = ConfigFile.Tag<AppConfig>("myapp/Config");

const savePath = "/home/user/.config/myapp/config.toml";

const ConfigLayer = ConfigFile.Live({
  tag: AppConfig,
  schema: AppConfigSchema,
  codec: TomlCodec,
  strategy: FirstMatch,
  resolvers: [UpwardWalk({ filename: "myapp.toml" })],
  defaultPath: Effect.succeed(savePath),
});

const program = Effect.gen(function* () {
  const config = yield* AppConfig;

  // Load with fallback if file doesn't exist yet
  const current = yield* config.loadOrDefault({ name: "myapp" });
  console.log("Current config:", current);

  // Update atomically: load -> transform -> save
  const updated = yield* config.update(
    (c) => ({ ...c, port: 8080 }),
    { name: "myapp" },
  );
  console.log("Updated config:", updated);

  // Or save a value directly; returns the path written to
  const savedPath = yield* config.save({ name: "myapp", port: 3000 });
  console.log("Saved to:", savedPath);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.provide(ConfigLayer, NodeFileSystem.layer)),
  ),
);
```

If `defaultPath` is omitted from `ConfigFile.Live`, calling `save` or `update`
fails with a `ConfigError`.

---

[Previous: Getting Started](./01-getting-started.md) | [Next: Testing](./03-testing.md)
