# Migrations

`ConfigMigration` provides schema versioning and migration for config files.
It wraps a `ConfigCodec` to apply versioned migration steps post-parse,
pre-schema-decode. This lets you evolve your config schema over time without
breaking existing config files.

## How It Works

`ConfigMigration.make(options)` returns a new `ConfigCodec` that:

1. Parses with the inner codec (e.g., JsonCodec, TomlCodec).
2. Reads the current version from the parsed data via `VersionAccess.get`.
3. Filters migrations to find those with a `version` greater than the current.
4. Applies pending migrations in ascending version order.
5. After each migration, updates the version via `VersionAccess.set`.
6. Returns the migrated data for schema decode.

The `stringify` method is passed through unchanged -- migrations only apply on
read.

## Quick Start

```typescript
import { Effect, Schema } from "effect";
import {
  ConfigFile,
  ConfigMigration,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";
import { ConfigError } from "config-file-effect";

// Current schema (version 2)
const AppConfig = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  port: Schema.Number,
  host: Schema.String,
});
type AppConfig = typeof AppConfig.Type;

const AppConfigFile = ConfigFile.Tag<AppConfig>("app/Config");

// Migration from v1 to v2: split "address" into "host" and "port"
const migrations = [
  {
    version: 2,
    name: "split-address",
    up: (raw: unknown) =>
      Effect.gen(function* () {
        const obj = raw as Record<string, unknown>;
        const address = obj.address as string | undefined;
        if (address) {
          const [host, portStr] = address.split(":");
          return {
            ...obj,
            host: host ?? "localhost",
            port: Number(portStr) || 3000,
            address: undefined,
          };
        }
        return { ...obj, host: "localhost", port: 3000 };
      }),
  },
];

const migratingCodec = ConfigMigration.make({
  codec: JsonCodec,
  migrations,
});

const ConfigLayer = ConfigFile.Live({
  tag: AppConfigFile,
  schema: AppConfig,
  codec: migratingCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./config.json")],
});
```

With this setup, a v1 config file:

```json
{ "version": 1, "name": "my-app", "address": "localhost:8080" }
```

is automatically migrated to v2 format before schema decode:

```json
{ "version": 2, "name": "my-app", "host": "localhost", "port": 8080 }
```

## The ConfigFileMigration Interface

```typescript
interface ConfigFileMigration {
  readonly version: number;
  readonly name: string;
  readonly up: (raw: unknown) => Effect<unknown, ConfigError>;
  readonly down?: (raw: unknown) => Effect<unknown, ConfigError>;
}
```

- **`version`** -- The target version number for this migration. Migrations are
  applied in ascending `version` order. A migration is pending when its
  `version` is greater than the current version in the config data.
- **`name`** -- Human-readable identifier for the migration (used in error
  messages).
- **`up`** -- Transform function that migrates data from the previous version to
  this version. Receives the parsed config as `unknown` and returns the
  transformed config.
- **`down`** -- Optional reverse transform. Defined in the interface but not
  currently invoked by `ConfigMigration.make`. Reserved for future downgrade
  support.

## VersionAccess

`VersionAccess` controls how version numbers are read from and written to the
parsed config data. The default implementation reads and writes a top-level
`version` field.

```typescript
interface VersionAccess {
  readonly get: (raw: unknown) => Effect<number, ConfigError>;
  readonly set: (raw: unknown, version: number) => Effect<unknown, ConfigError>;
}
```

### Default VersionAccess

`VersionAccess.default` expects a top-level `version` field on the config
object:

```typescript
import { VersionAccess } from "config-file-effect";

// This is used automatically when versionAccess is not specified
const access = VersionAccess.default;
```

It reads `(raw as object).version` and fails with `ConfigError` if the field
is missing or not a number. It writes by spreading the object and setting the
`version` field.

### Custom VersionAccess

Supply a custom `VersionAccess` to store the version in a nested field, a
`_meta` envelope, or any other location:

```typescript
import { Effect } from "effect";
import { ConfigError, ConfigMigration, JsonCodec } from "config-file-effect";

const metaVersionAccess = {
  get: (raw: unknown) =>
    Effect.gen(function* () {
      const obj = raw as Record<string, unknown>;
      const meta = obj._meta as Record<string, unknown> | undefined;
      if (!meta || typeof meta.version !== "number") {
        return yield* Effect.fail(
          new ConfigError({
            operation: "migration",
            reason: "_meta.version is missing or not a number",
          }),
        );
      }
      return meta.version;
    }),
  set: (raw: unknown, version: number) =>
    Effect.succeed({
      ...(raw as Record<string, unknown>),
      _meta: {
        ...((raw as Record<string, unknown>)._meta as object),
        version,
      },
    }),
};

const codec = ConfigMigration.make({
  codec: JsonCodec,
  migrations: [/* ... */],
  versionAccess: metaVersionAccess,
});
```

## ConfigMigration.make

```typescript
ConfigMigration.make(options: {
  readonly codec: ConfigCodec;
  readonly migrations: ReadonlyArray<ConfigFileMigration>;
  readonly versionAccess?: VersionAccess;
}): ConfigCodec
```

Returns a new `ConfigCodec` that applies migrations during `parse`. The
returned codec:

- Has the same `name` and `extensions` as the inner codec.
- On `parse`: runs the inner codec's parse, reads the version, applies pending
  migrations, returns the migrated data.
- On `stringify`: delegates directly to the inner codec (no transformation).

## Error Handling

Migration errors are mapped to `CodecError` so the returned codec satisfies the
`ConfigCodec` interface. This keeps the error surface uniform from the caller's
perspective.

If a migration's `up` function fails with a `ConfigError`, the error is wrapped
as:

```text
CodecError {
  codec: "json",
  operation: "parse",
  reason: 'migration "split-address" (v2) failed: <original reason>'
}
```

If version reading fails:

```text
CodecError {
  codec: "json",
  operation: "parse",
  reason: "migration version read failed: version field is missing or not a number"
}
```

## Writing Multiple Migrations

Migrations are sorted by `version` automatically. Write each migration as a
separate step:

```typescript
const migrations = [
  {
    version: 2,
    name: "add-host-field",
    up: (raw: unknown) =>
      Effect.succeed({
        ...(raw as Record<string, unknown>),
        host: "localhost",
      }),
  },
  {
    version: 3,
    name: "rename-debug-to-verbose",
    up: (raw: unknown) =>
      Effect.gen(function* () {
        const obj = raw as Record<string, unknown>;
        const { debug, ...rest } = obj;
        return { ...rest, verbose: debug ?? false };
      }),
  },
  {
    version: 4,
    name: "add-tls-config",
    up: (raw: unknown) =>
      Effect.succeed({
        ...(raw as Record<string, unknown>),
        tls: { enabled: false, certPath: null },
      }),
  },
];
```

A v1 config file will have all three migrations applied in order (2, 3, 4). A
v3 config file will only have migration 4 applied.

## Composing with EncryptedCodec

Migrations compose naturally with encryption. Wrap in the order you want the
pipeline to execute:

```typescript
import {
  ConfigMigration,
  EncryptedCodec,
  EncryptedCodecKey,
  JsonCodec,
} from "config-file-effect";

const key = EncryptedCodecKey.fromPassphrase("secret", salt);

// Decrypt first, then apply migrations
const codec = ConfigMigration.make({
  codec: EncryptedCodec(JsonCodec, key),
  migrations,
});
```

The parse pipeline becomes:

```text
Raw file (base64 ciphertext)
  -> EncryptedCodec.parse (decrypt)
  -> ConfigMigration.parse (apply migrations)
  -> JsonCodec.parse (parse JSON)
  -> Schema.decode (validate)
```

## Best Practices

1. **Always include a `version` field in your schema** -- even if you do not
   have migrations yet. Adding it later requires a migration itself.

2. **Make migrations idempotent when possible** -- if a migration adds a field,
   check whether it already exists before setting it.

3. **Keep migrations simple** -- each migration should do one thing. Complex
   transforms are harder to debug.

4. **Test migrations independently** -- migration `up` functions are pure
   `Effect` values that can be tested without filesystem setup:

   ```typescript
   it("migrates v1 to v2", async () => {
     const v1 = { version: 1, name: "app", address: "localhost:8080" };
     const v2 = await Effect.runPromise(migrations[0].up(v1));
     expect(v2).toMatchObject({ host: "localhost", port: 8080 });
   });
   ```

5. **Never remove old migrations** -- new installations may encounter old
   config files. The migration chain should always start from v1.

---

[Previous: Events](./events.md) |
[Next: Watcher](./watcher.md)
