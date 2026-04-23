---
"config-file-effect": minor
---

## Features

- **ConfigEvents** — opt-in PubSub event system for the config file pipeline. Pass a `ConfigEvents` tag to `ConfigFileOptions.events` to receive granular lifecycle events. Provides 15 event types covering every pipeline stage: `Discovered`, `DiscoveryFailed`, `Parsed`, `ParseFailed`, `Validated`, `ValidationFailed`, `Loaded`, `LoadFailed`, `Written`, `WriteFailed`, `Saved`, `SaveFailed`, `MigrationApplied`, `Watching`, and `NotFound`. Use `ConfigEvents.Tag(id)` to create a scoped tag and `ConfigEvents.Live(tag)` to build the layer.

- **EncryptedCodec** — AES-GCM encrypted codec wrapper. `EncryptedCodec(inner, key)` returns a `ConfigCodec` that transparently encrypts on stringify and decrypts on parse. Keys are provided via `EncryptedCodecKey.fromPassphrase(passphrase, salt)` (PBKDF2 key derivation) or `EncryptedCodecKey.fromCryptoKey(effect)` for direct `CryptoKey` injection. Ciphertext uses a random IV per write so identical plaintexts produce different outputs.

- **ConfigMigration** — versioned schema transform system. `ConfigMigration.make({ codec, migrations, versionAccess? })` wraps any `ConfigCodec` and applies numbered `up` transforms in sequence during parse, skipping migrations whose version is already met. Implement `VersionAccess` to control where the version field lives; a default implementation reads and writes a top-level `version` number field.

- **ConfigWatcher** — polling-based file watcher that emits a `Stream<ConfigFileChange<A>>` whenever a watched path changes between polls. Use `ConfigWatcher.Tag(id)` and `ConfigWatcher.Live({ tag, configTag, paths })` to build the layer, then call `watcher.watch({ interval })` to obtain the stream. Each `ConfigFileChange` carries the file path and `Option`-wrapped previous and current parsed values.

## Breaking Changes

- `ConfigFile.Test` no longer bundles `NodeFileSystem` internally. Callers must now provide `FileSystem` from context by wrapping the layer with `Layer.provide(..., NodeFileSystem.layer)`. This makes the test utility platform-agnostic and composable with any `FileSystem` implementation. This change only affects test code and has no impact on production layers.

  ```typescript
  // Before
  Effect.provide(
    effect,
    ConfigFile.Test({ tag, schema, codec, strategy, resolvers, files }),
  )

  // After
  Effect.provide(
    effect,
    Layer.provide(
      ConfigFile.Test({ tag, schema, codec, strategy, resolvers, files }),
      NodeFileSystem.layer,
    ),
  )
  ```
