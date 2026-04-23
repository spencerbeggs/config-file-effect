# API Reference

Complete reference for all config-file-effect exports, organized by category.
Each entry links to the guide that covers it in depth.

## Services

| Service | Tag | Guide |
| ------- | --- | ----- |
| `ConfigFileService<A>` | via `ConfigFile.Tag(id)` | [Config Files](./02-config-files.md) |

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

## Layers

| Layer | Provides | Requires | Guide |
| ----- | -------- | -------- | ----- |
| `ConfigFile.Live(options)` | `ConfigFileService<A>` | `FileSystem` | [Config Files](./02-config-files.md) |
| `ConfigFile.Test(options)` | `ConfigFileService<A>` | `Scope` | [Testing](./03-testing.md) |

### ConfigFile.Live

```typescript
ConfigFile.Live<A>(options: ConfigFileOptions<A>): Layer<ConfigFileService<A>, never, FileSystem>
```

Builds a live `ConfigFileService` layer. Requires `FileSystem` from
`@effect/platform`, satisfied by `NodeFileSystem.layer` on Node.js.

### ConfigFile.Test

```typescript
ConfigFile.Test<A>(options: ConfigFileTestOptions<A>): Layer<ConfigFileService<A>, never, Scope>
```

Builds a scoped test layer. Pre-populates files from `options.files` and
cleans them up when the scope closes. Provides `NodeFileSystem.layer`
internally.

## Tags

### ConfigFile.Tag

```typescript
ConfigFile.Tag<A>(id: string): Context.Tag<ConfigFileService<A>, ConfigFileService<A>>
```

Creates a unique `Context.Tag` for a `ConfigFileService<A>`. Internally calls
`Context.GenericTag` with the identifier
`"config-file-effect/ConfigFile/${id}"`.

## Codecs

| Codec | Format | Extensions | Guide |
| ----- | ------ | ---------- | ----- |
| `JsonCodec` | JSON | `.json` | [Config Files](./02-config-files.md) |
| `TomlCodec` | TOML | `.toml` | [Config Files](./02-config-files.md) |

### ConfigCodec (interface)

```typescript
interface ConfigCodec {
  readonly name: string;
  readonly extensions: ReadonlyArray<string>;
  readonly parse: (raw: string) => Effect<unknown, CodecError>;
  readonly stringify: (value: unknown) => Effect<string, CodecError>;
}
```

### JsonCodec

```typescript
const JsonCodec: ConfigCodec
```

Parses with `JSON.parse`, stringifies with `JSON.stringify` using tab
indentation. Extension: `.json`.

### TomlCodec

```typescript
const TomlCodec: ConfigCodec
```

Parses and stringifies with the `smol-toml` library. Extension: `.toml`.

## Resolvers

| Resolver | Name | Requirements | Guide |
| -------- | ---- | ------------ | ----- |
| `ExplicitPath(path)` | `"explicit"` | `FileSystem` | [Config Files](./02-config-files.md) |
| `StaticDir({ dir, filename })` | `"static"` | `FileSystem` | [Config Files](./02-config-files.md) |
| `UpwardWalk({ filename, cwd?, stopAt? })` | `"walk"` | `FileSystem` | [Config Files](./02-config-files.md) |
| `WorkspaceRoot({ filename, subpaths?, cwd? })` | `"workspace"` | `FileSystem` | [Config Files](./02-config-files.md) |
| `GitRoot({ filename, subpaths?, cwd? })` | `"git"` | `FileSystem` | [Config Files](./02-config-files.md) |

### ConfigResolver (interface)

```typescript
interface ConfigResolver<R = never> {
  readonly name: string;
  readonly resolve: Effect<Option<string>, never, R>;
}
```

### ExplicitPath

```typescript
ExplicitPath(path: string): ConfigResolver<FileSystem>
```

Checks whether a specific file path exists. Returns `Option.some(path)` when
found, `Option.none()` otherwise.

### StaticDir

```typescript
StaticDir(options: { dir: string; filename: string }): ConfigResolver<FileSystem>
```

Joins `dir` and `filename`, checks whether the resulting path exists. Returns
`Option.some(fullPath)` when found, `Option.none()` otherwise.

### UpwardWalk

```typescript
UpwardWalk(options: {
  filename: string;
  cwd?: string;
  stopAt?: string;
}): ConfigResolver<FileSystem>
```

Walks from `cwd` (defaults to `process.cwd()`) toward the filesystem root,
checking each directory for `filename`. Stops when found, at root, or at
`stopAt`.

### WorkspaceRoot

```typescript
WorkspaceRoot(options: {
  filename: string;
  subpaths?: ReadonlyArray<string>;
  cwd?: string;
}): ConfigResolver<FileSystem>
```

Walks up from `cwd` looking for a monorepo workspace root (`pnpm-workspace.yaml`
or `package.json` with `workspaces` field). When found, checks for `filename`
under each entry in `subpaths` (tried in order, first match wins). `"."` checks
the root itself. When `subpaths` is omitted the root is checked directly.

### GitRoot

```typescript
GitRoot(options: {
  filename: string;
  subpaths?: ReadonlyArray<string>;
  cwd?: string;
}): ConfigResolver<FileSystem>
```

Walks up from `cwd` looking for a `.git` directory or file (worktrees use a
`.git` file pointing to the real repository). When found, checks for `filename`
under each entry in `subpaths` (tried in order, first match wins). `"."` checks
the root itself. When `subpaths` is omitted the root is checked directly.
Resolver name: `"git"`.

## Strategies

| Strategy | Behavior | Guide |
| -------- | -------- | ----- |
| `FirstMatch` | Returns value from highest-priority source | [Config Files](./02-config-files.md) |
| `LayeredMerge` | Deep-merges all sources, highest priority wins conflicts | [Config Files](./02-config-files.md) |

### ConfigWalkStrategy (interface)

```typescript
interface ConfigWalkStrategy<A> {
  readonly resolve: (sources: ReadonlyArray<ConfigSource<A>>) => Effect<A, ConfigError>;
}
```

### ConfigSource (interface)

```typescript
interface ConfigSource<A> {
  readonly path: string;
  readonly tier: string;
  readonly value: A;
}
```

### FirstMatch

```typescript
const FirstMatch: ConfigWalkStrategy<any>
```

Returns `sources[0].value`. Fails with `ConfigError` when sources is empty.

### LayeredMerge

```typescript
const LayeredMerge: ConfigWalkStrategy<any>
```

Deep-merges all sources from lowest to highest priority. Nested objects are
merged recursively; scalar values from higher-priority sources win on
conflict. Fails with `ConfigError` when sources is empty.

## Errors

| Error | Tag | Fields | Guide |
| ----- | --- | ------ | ----- |
| `ConfigError` | `"ConfigError"` | `operation`, `path?`, `reason` | [Error Handling](./04-error-handling.md) |
| `CodecError` | `"CodecError"` | `codec`, `operation`, `reason` | [Error Handling](./04-error-handling.md) |

### ConfigError

```typescript
class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly operation: string;
  readonly path?: string;
  readonly reason: string;
}>
```

The `message` getter produces:
`Config ${operation} failed at "${path}": ${reason}` (or without the path
portion when `path` is absent).

### CodecError

```typescript
class CodecError extends Data.TaggedError("CodecError")<{
  readonly codec: string;
  readonly operation: "parse" | "stringify";
  readonly reason: string;
}>
```

The `message` getter produces: `${codec} ${operation} failed: ${reason}`.

### ConfigErrorBase / CodecErrorBase

```typescript
const ConfigErrorBase: typeof Data.TaggedError("ConfigError")
const CodecErrorBase: typeof Data.TaggedError("CodecError")
```

Internal base classes exported for TypeScript declaration bundling. Use
`ConfigError` and `CodecError` directly in application code.

## Options Types

### ConfigFileOptions

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

The optional `validate` callback runs after schema decoding on every load path.
It receives the decoded value and can reject it with a `ConfigError` or return a
transformed value. The `validate` method on `ConfigFileService` also invokes
this callback after decoding.

### ConfigFileTestOptions

```typescript
interface ConfigFileTestOptions<A> extends ConfigFileOptions<A> {
  readonly files?: Record<string, string>;
}
```

---

[Previous: Error Handling](./04-error-handling.md)
