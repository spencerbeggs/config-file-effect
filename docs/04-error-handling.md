# Error Handling

config-file-effect uses Effect's typed error channel with `Data.TaggedError` for
every failure mode. Each error type carries structured context (operation, path,
reason) so you can handle failures precisely.

## Error Types

Both error types are exported from `config-file-effect`. Each extends
`Data.TaggedError`, which attaches a `_tag` discriminant used for pattern
matching. Both errors expose a computed `message` getter that formats the fields
into a human-readable string.

| Error | Tag | Fields | Raised When |
| ----- | --- | ------ | ----------- |
| `ConfigError` | `"ConfigError"` | `operation`, `path?`, `reason` | Config read/parse/validate/write/save fails |
| `CodecError` | `"CodecError"` | `codec`, `operation` (`"parse"` \| `"stringify"`), `reason` | JSON/TOML parse or stringify fails |

### ConfigError

`ConfigError` is the primary error type. The `operation` field tells you exactly
which step failed:

| Operation | Meaning |
| --------- | ------- |
| `"read"` | File exists but could not be read (permissions, I/O error) |
| `"parse"` | File was read but the codec failed to parse it |
| `"validate"` | File parsed but failed schema validation |
| `"encode"` | Value could not be encoded through the schema for writing |
| `"stringify"` | Encoded value could not be serialized by the codec |
| `"write"` | Serialized content could not be written to disk |
| `"save"` | No `defaultPath` configured, or directory creation failed |
| `"resolve"` | No config sources found by any resolver |

The optional `path` field is present when the error relates to a specific file.
For the `"resolve"` operation, `path` is absent because no file was found.

```typescript
import { ConfigError } from "config-file-effect";

const error = new ConfigError({
  operation: "read",
  path: "/home/user/.config/my-app/config.json",
  reason: "EACCES: permission denied",
});

console.log(error._tag);    // "ConfigError"
console.log(error.message); // Config read failed at "/home/user/.config/my-app/config.json": EACCES: permission denied
```

### CodecError

`CodecError` is raised by codecs when parsing or stringifying fails. The
`codec` field identifies the format (e.g., `"json"`, `"toml"`) and `operation`
is either `"parse"` or `"stringify"`.

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

In practice, `CodecError` is wrapped by `ConfigError` during the load pipeline.
When a codec parse fails, the `ConfigFile` service catches the `CodecError` and
re-raises it as a `ConfigError` with `operation: "parse"` and the codec error's
message as the `reason`. This means you typically handle `ConfigError` in
application code, not `CodecError` directly.

## catchTag Patterns

`Effect.catchTag` lets you recover from one specific error type while letting
everything else propagate:

```typescript
import { Effect } from "effect";
import { ConfigFile } from "config-file-effect";

// Assuming MyToolConfigFile is defined elsewhere
const loadConfig = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;
  return yield* configFile.load;
}).pipe(
  Effect.catchTag("ConfigError", (error) => {
    if (error.operation === "resolve") {
      console.log("No config found, using defaults");
      return Effect.succeed({ name: "my-tool", port: 3000, debug: false });
    }
    return Effect.fail(error);
  }),
);
```

A `ConfigError` with `operation === "resolve"` means no config file was found --
none of the resolvers matched an existing file. This is the safe case to swallow
and substitute defaults.

Other operations (`"parse"`, `"validate"`, `"read"`) mean a file was found but
is broken. Re-throwing with `Effect.fail(error)` ensures those propagate to the
caller. Keeping the distinction in the `operation` field is what makes this
pattern possible without separate error types.

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
      // read, write, encode, stringify, save
      return Effect.fail(error);
  }
});
```

## mapError for App-Specific Errors

When you own the error boundary (for example, at a service layer or a command
handler), `Effect.mapError` converts any config-file-effect error into your
application's error type:

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
    (error) => new AppError({ message: `Config failed: ${error.message}` }),
  ),
);
```

Because every config-file-effect error has a `message` getter, the mapping works
uniformly without a switch statement. The resulting effect has `AppError` in its
error channel instead of the library-specific type.

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

`loadOrDefault` returns the default value only when zero sources are discovered.
If a file is found but is corrupt or fails validation, the error propagates
normally. This is the recommended approach when you have sensible defaults and
want broken files to be reported as errors.

## Runnable Example

The following program loads a JSON config file with a graceful fallback when no
config file exists, and a hard fail when the file exists but is broken:

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

const defaults: MyToolConfig = { name: "my-tool", port: 3000, debug: false };

const loadConfigSafe = Effect.gen(function* () {
  const configFile = yield* MyToolConfigFile;
  return yield* configFile.load;
}).pipe(
  Effect.catchTag("ConfigError", (error) => {
    if (error.operation === "resolve") {
      console.log("No config found, using defaults");
      return Effect.succeed(defaults);
    }
    console.error(`Config error at ${error.path}: ${error.reason}`);
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
    Effect.provide(Layer.provide(ConfigLayer, NodeFileSystem.layer)),
  ),
).then((config) => console.log("Loaded:", config));
```

---

[Previous: Testing](./03-testing.md) | [Next: API Reference](./05-api-reference.md)
