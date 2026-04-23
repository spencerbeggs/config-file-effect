# Codecs

A codec knows how to parse raw file content into a JavaScript value and
serialize a value back into file content. config-file-effect ships with two
format codecs (JSON, TOML) and one wrapper codec (EncryptedCodec). Codecs can be
composed -- wrap a format codec with encryption or migration to build layered
processing pipelines.

## The ConfigCodec Interface

```typescript
interface ConfigCodec {
  readonly name: string;
  readonly extensions: ReadonlyArray<string>;
  readonly parse: (raw: string) => Effect<unknown, CodecError>;
  readonly stringify: (value: unknown) => Effect<string, CodecError>;
}
```

- **`name`** -- Human-readable identifier (e.g., `"json"`, `"toml"`,
  `"encrypted(json)"`).
- **`extensions`** -- File extensions this codec handles (e.g., `[".json"]`).
- **`parse`** -- Takes raw file content and returns a parsed value, or fails
  with `CodecError`.
- **`stringify`** -- Takes a structured value and returns serialized file
  content, or fails with `CodecError`.

Both `parse` and `stringify` return `Effect` values so that errors are captured
as typed `CodecError` failures rather than thrown exceptions.

## JsonCodec

Parses with `JSON.parse` and serializes with `JSON.stringify` using tab
indentation. Handles files with the `.json` extension.

```typescript
import { JsonCodec } from "config-file-effect";

// JsonCodec is a ready-to-use ConfigCodec value
const layer = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./config.json")],
});
```

**Properties:**

| Field | Value |
| ----- | ----- |
| `name` | `"json"` |
| `extensions` | `[".json"]` |
| Parse engine | `JSON.parse` |
| Stringify format | `JSON.stringify(value, null, "\t")` (tab-indented) |

## TomlCodec

Parses and stringifies with the [`smol-toml`](https://github.com/nicolo-ribaudo/smol-toml)
library. Handles files with the `.toml` extension. TOML is a natural fit for CLI
tool configuration -- it is used by Cargo, Python's `pyproject.toml`, and many
other developer tools.

```typescript
import { TomlCodec } from "config-file-effect";

const layer = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: TomlCodec,
  strategy: FirstMatch,
  resolvers: [UpwardWalk({ filename: "config.toml" })],
});
```

**Properties:**

| Field | Value |
| ----- | ----- |
| `name` | `"toml"` |
| `extensions` | `[".toml"]` |
| Parse engine | `smol-toml` `parse()` |
| Stringify engine | `smol-toml` `stringify()` |

## EncryptedCodec

`EncryptedCodec` wraps any `ConfigCodec` with AES-GCM encryption. It is a
function, not a standalone codec -- you pass it an inner codec and a key source,
and it returns a new `ConfigCodec` that encrypts on write and decrypts on read.

```typescript
import { EncryptedCodec, EncryptedCodecKey, JsonCodec } from "config-file-effect";

const key = EncryptedCodecKey.fromPassphrase(
  "my-secret-passphrase",
  new TextEncoder().encode("my-app-salt-value"),
);

const codec = EncryptedCodec(JsonCodec, key);
// codec is a ConfigCodec with name "encrypted(json)"
```

### How It Works

**On parse (reading an encrypted file):**

1. Base64-decode the raw file content.
2. Extract the first 12 bytes as the initialization vector (IV).
3. Decrypt the remaining bytes with AES-GCM using the provided key.
4. Pass the decrypted plaintext to the inner codec's `parse` method.

**On stringify (writing an encrypted file):**

1. Serialize the value with the inner codec's `stringify` method.
2. Generate a random 12-byte IV.
3. Encrypt the serialized string with AES-GCM.
4. Prepend the IV to the ciphertext.
5. Base64-encode the combined buffer.

### Key Sources

`EncryptedCodecKey` is a tagged union with two variants and convenience
constructors:

```typescript
type EncryptedCodecKey =
  | { _tag: "CryptoKey"; key: Effect<CryptoKey, CodecError> }
  | { _tag: "Passphrase"; passphrase: string; salt: Uint8Array };
```

**`EncryptedCodecKey.fromCryptoKey(effect)`** -- Use a pre-derived `CryptoKey`.
The effect is evaluated once per codec instance.

```typescript
import { Effect } from "effect";
import { EncryptedCodecKey } from "config-file-effect";

// From an existing CryptoKey
const key = EncryptedCodecKey.fromCryptoKey(
  Effect.promise(() =>
    globalThis.crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    ),
  ),
);
```

**`EncryptedCodecKey.fromPassphrase(passphrase, salt)`** -- Derive a key from a
passphrase via PBKDF2. Key derivation runs lazily on the first encrypt/decrypt
call and the result is cached for subsequent operations.

```typescript
import { EncryptedCodecKey } from "config-file-effect";

const key = EncryptedCodecKey.fromPassphrase(
  process.env.CONFIG_SECRET!,
  new TextEncoder().encode("my-app-unique-salt"),
);
```

### Crypto Details

| Parameter | Value |
| --------- | ----- |
| Algorithm | AES-GCM |
| Key length | 256 bits |
| IV length | 12 bytes (randomly generated per write) |
| Key derivation (Passphrase) | PBKDF2, SHA-256, 100,000 iterations |
| Runtime requirement | `globalThis.crypto.subtle` (Web Crypto API) |

The Web Crypto API is available in Node.js 20+, Bun, and Deno. No native
dependencies are required.

### Full Example

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import {
  ConfigFile,
  EncryptedCodec,
  EncryptedCodecKey,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

const SecretConfig = Schema.Struct({
  apiKey: Schema.String,
  dbPassword: Schema.String,
});
type SecretConfig = typeof SecretConfig.Type;

const SecretConfigFile = ConfigFile.Tag<SecretConfig>("app/Secrets");

const encryptionKey = EncryptedCodecKey.fromPassphrase(
  process.env.CONFIG_SECRET!,
  new TextEncoder().encode("my-app-salt"),
);

const ConfigLayer = ConfigFile.Live({
  tag: SecretConfigFile,
  schema: SecretConfig,
  codec: EncryptedCodec(JsonCodec, encryptionKey),
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./secrets.enc")],
  defaultPath: Effect.succeed("./secrets.enc"),
});

const program = Effect.gen(function* () {
  const secrets = yield* SecretConfigFile;

  // Save encrypted config
  yield* secrets.save({ apiKey: "sk-abc123", dbPassword: "hunter2" });

  // Load and decrypt
  const config = yield* secrets.load;
  console.log("Decrypted:", config);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.provide(ConfigLayer, NodeFileSystem.layer)),
  ),
);
```

### Composing with Migrations

EncryptedCodec composes naturally with ConfigMigration. Wrap in the order you
want the pipeline to execute:

```typescript
import { ConfigMigration, EncryptedCodec, JsonCodec } from "config-file-effect";

// Decrypt first, then apply migrations
const codec = ConfigMigration.make({
  codec: EncryptedCodec(JsonCodec, key),
  migrations: [/* ... */],
});
```

See [Migrations](./migrations.md) for details on the migration system.

## Writing a Custom Codec

To support another format (YAML, INI, etc.), implement the `ConfigCodec`
interface. Return `Effect.succeed` for successful operations and
`Effect.fail(new CodecError(...))` for failures.

```typescript
import { Effect } from "effect";
import { CodecError } from "config-file-effect";
import type { ConfigCodec } from "config-file-effect";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const YamlCodec: ConfigCodec = {
  name: "yaml",
  extensions: [".yaml", ".yml"],
  parse: (raw) =>
    Effect.try({
      try: () => parseYaml(raw),
      catch: (error) =>
        new CodecError({
          codec: "yaml",
          operation: "parse",
          reason: String(error),
        }),
    }),
  stringify: (value) =>
    Effect.try({
      try: () => stringifyYaml(value),
      catch: (error) =>
        new CodecError({
          codec: "yaml",
          operation: "stringify",
          reason: String(error),
        }),
    }),
};
```

The custom codec plugs directly into `ConfigFile.Live`:

```typescript
const layer = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: YamlCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./config.yaml")],
});
```

## Codec Composition

Codecs compose via the wrapper pattern. A wrapper codec accepts an inner
`ConfigCodec` and returns a new `ConfigCodec`, intercepting the parse and/or
stringify pipeline:

```text
Raw file content (string)
     |
     v
EncryptedCodec.parse (optional)
  base64-decode -> extract IV -> AES-GCM decrypt
     |
     v
ConfigMigration.parse (optional)
  read version -> apply pending migrations -> update version
     |
     v
Inner codec parse (JsonCodec / TomlCodec)
     |
     v
Parsed unknown value -> Schema.decode -> validate
```

Both `EncryptedCodec` and `ConfigMigration.make` preserve the `ConfigCodec`
interface, so you can stack them in any order. Errors from wrappers are mapped to
`CodecError` to keep the error surface uniform.

---

[Back to Getting Started](./getting-started.md) |
[Next: Resolvers](./resolvers.md)
