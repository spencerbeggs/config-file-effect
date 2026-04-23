# Errors

config-file-effect uses Effect's typed error channel with `Data.TaggedError` for
every failure mode. Each error type carries structured context so you can handle
failures precisely using pattern matching.

## Error Types

Both error types extend `Data.TaggedError`, which attaches a `_tag`
discriminant. Both expose a computed `message` getter that formats the fields
into a human-readable string.

| Error | Tag | Fields |
| ----- | --- | ------ |
| `ConfigError` | `"ConfigError"` | `operation`, `path?`, `reason` |
| `CodecError` | `"CodecError"` | `codec`, `operation`, `reason` |

## ConfigError

`ConfigError` is the primary error type. It is raised by the `ConfigFileService`
at every stage of the pipeline.

```typescript
import { ConfigError } from "config-file-effect";

const error = new ConfigError({
  operation: "read",
  path: "/home/user/.config/my-app/config.json",
  reason: "EACCES: permission denied",
});

console.log(error._tag);    // "ConfigError"
console.log(error.message);
// Config read failed at "/home/user/.config/my-app/config.json": EACCES: permission denied
```

### Operation Values

The `operation` field tells you exactly which pipeline step failed:

| Operation | Meaning |
| --------- | ------- |
| `"read"` | File exists but could not be read (permissions, I/O error) |
| `"parse"` | File was read but the codec failed to parse it |
| `"validate"` | File parsed but failed schema decode or the `validate` hook |
| `"encode"` | Value could not be encoded through the schema for writing |
| `"stringify"` | Encoded value could not be serialized by the codec |
| `"write"` | Serialized content could not be written to disk |
| `"save"` | No `defaultPath` configured, or directory creation failed |
| `"resolve"` | No config sources found by any resolver |
| `"migration"` | A migration version read/write failed (from `VersionAccess`) |

The optional `path` field is present when the error relates to a specific file.
For the `"resolve"` operation, `path` is absent because no file was found.

## CodecError

`CodecError` is raised by codecs when parsing or stringifying fails. The `codec`
field identifies the format and `operation` is either `"parse"` or
`"stringify"`.

```typescript
import { CodecError } from "config-file-effect";

const error = new CodecError({
  codec: "json",
  operation: "parse",
  reason: "Unexpected token } in JSON at position 5",
});

console.log(error._tag);    // "CodecError"
console.log(error.message); // json parse failed: Unexpected token } in JSON at position 5
```

### Codec Values

| Codec | Source |
| ----- | ------ |
| `"json"` | `JsonCodec` |
| `"toml"` | `TomlCodec` |
| `"encrypted(json)"` | `EncryptedCodec(JsonCodec, key)` |
| `"encrypted(toml)"` | `EncryptedCodec(TomlCodec, key)` |

### CodecError in Practice

In the load pipeline, `ConfigFileLive` catches `CodecError` and re-raises it as
a `ConfigError` with `operation: "parse"` and the codec error's message as the
`reason`. This means you typically handle `ConfigError` in application code, not
`CodecError` directly.

`CodecError` is most relevant when:

- Writing custom codecs (you construct and return `CodecError` from `parse` and
  `stringify`).
- Working with `ConfigMigration`, which maps migration errors to `CodecError`.

## Error Handling with catchTag

`Effect.catchTag` lets you recover from one specific error type while letting
everything else propagate:

```typescript
import { Effect } from "effect";

const loadConfig = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;
  return yield* configFile.load;
}).pipe(
  Effect.catchTag("ConfigError", (error) => {
    if (error.operation === "resolve") {
      console.log("No config found, using defaults");
      return Effect.succeed(defaults);
    }
    return Effect.fail(error);
  }),
);
```

A `ConfigError` with `operation === "resolve"` means no config file was found --
none of the resolvers matched an existing file. This is the safe case to
substitute defaults. Other operations mean a file was found but is broken.

### Distinguishing "Not Found" from "Broken File"

The distinction between `operation: "resolve"` and all other operations is
central to correct error handling:

```typescript
Effect.catchTag("ConfigError", (error) => {
  switch (error.operation) {
    case "resolve":
      // No config file exists anywhere -- safe to use defaults
      return Effect.succeed(defaults);
    case "parse":
      // File exists but has invalid syntax
      console.error(`Syntax error in ${error.path}: ${error.reason}`);
      return Effect.fail(error);
    case "validate":
      // File parsed but doesn't match schema
      console.error(`Invalid config in ${error.path}: ${error.reason}`);
      return Effect.fail(error);
    default:
      // read, write, encode, stringify, save, migration
      return Effect.fail(error);
  }
});
```

## Error Handling with mapError

When you own the error boundary, `Effect.mapError` converts config-file-effect
errors into your application's error type:

```typescript
import { Data, Effect } from "effect";

class AppError extends Data.TaggedError("AppError")<{
  readonly message: string;
}> {}

const loadConfig = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;
  return yield* configFile.load;
}).pipe(
  Effect.mapError(
    (error) =>
      new AppError({ message: `Config failed: ${error.message}` }),
  ),
);
```

Because every config-file-effect error has a `message` getter, the mapping
works uniformly.

## loadOrDefault as an Alternative

For simple "use defaults when no config exists" scenarios, prefer
`loadOrDefault` over manual `catchTag` handling:

```typescript
const program = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;

  // Returns defaults if no config file is found
  // Still fails on parse/validate errors for existing files
  const config = yield* configFile.loadOrDefault({
    name: "my-tool",
    port: 3000,
    debug: false,
  });
});
```

`loadOrDefault` returns the default value only when zero sources are
discovered. If a file is found but is corrupt or fails validation, the error
propagates normally.

## Error Pipeline

Understanding where each error originates helps with debugging:

```text
Resolver chain
  -> "resolve" error if no sources found

For each found file:
  FileSystem.readFileString
    -> "read" error (permissions, I/O)
  Codec.parse
    -> "parse" error (invalid syntax)
  Schema.decodeUnknown
    -> "validate" error (schema mismatch)
  validate hook
    -> "validate" error (custom validation)

For write/save:
  Schema.encodeUnknown
    -> "encode" error (encoding failure)
  Codec.stringify
    -> "stringify" error (serialization failure)
  FileSystem.writeFileString
    -> "write" error (permissions, I/O)
  Directory creation
    -> "save" error (mkdir failure)
```

## EncryptedCodec Errors

`EncryptedCodec` produces `CodecError` for:

- Key derivation failures (PBKDF2 errors)
- Base64 decode/encode errors
- AES-GCM decrypt/encrypt failures

These have `codec: "encrypted(json)"` (or whatever the inner codec is) and
appear as `operation: "parse"` or `operation: "stringify"`.

## Migration Errors

`ConfigMigration.make` maps all migration errors to `CodecError`:

- Version read failures: `reason: "migration version read failed: ..."`
- Migration step failures: `reason: 'migration "name" (v2) failed: ...'`
- Version write failures: `reason: "migration version write failed after ..."`

These flow through the same pipeline as codec errors and are wrapped into
`ConfigError` with `operation: "parse"` by `ConfigFileLive`.

## Event Emission Errors

Event emission failures are silently swallowed
(`Effect.catchAll(() => Effect.void)`). Observability never aborts the data
pipeline. If a PubSub publish fails, the config operation continues normally.

## ConfigErrorBase / CodecErrorBase

```typescript
const ConfigErrorBase: typeof Data.TaggedError("ConfigError");
const CodecErrorBase: typeof Data.TaggedError("CodecError");
```

These are internal base classes exported for TypeScript declaration bundling
compatibility. Use `ConfigError` and `CodecError` directly in application code.

## Runnable Example

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import {
  ConfigFile,
  JsonCodec,
  FirstMatch,
  UpwardWalk,
  StaticDir,
} from "config-file-effect";

const MyToolConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
  debug: Schema.optional(Schema.Boolean, { default: () => false }),
});
type MyToolConfig = typeof MyToolConfig.Type;

const MyToolConfigFile = ConfigFile.Tag<MyToolConfig>("my-tool/Config");

const defaults: MyToolConfig = {
  name: "my-tool",
  port: 3000,
  debug: false,
};

const loadConfigSafe = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;
  return yield* configFile.load;
}).pipe(
  Effect.catchTag("ConfigError", (error) => {
    if (error.operation === "resolve") {
      console.log("No config found, using defaults");
      return Effect.succeed(defaults);
    }
    console.error(
      `Config error at ${error.path}: ${error.reason}`,
    );
    return Effect.fail(error);
  }),
);

const ConfigLayer = ConfigFile.Live({
  tag: MyToolConfigFile,
  schema: MyToolConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [
    UpwardWalk({ filename: "my-tool.config.json" }),
    StaticDir({ dir: "/etc/my-tool", filename: "config.json" }),
  ],
});

Effect.runPromise(
  loadConfigSafe.pipe(
    Effect.provide(
      Layer.provide(ConfigLayer, NodeFileSystem.layer),
    ),
  ),
).then((config) => console.log("Loaded:", config));
```

---

[Previous: Testing](./testing.md)
