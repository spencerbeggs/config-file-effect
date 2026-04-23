---
status: current
module: config-file-effect
category: architecture
created: 2026-04-23
updated: 2026-04-23
last-synced: 2026-04-23
completeness: 95
related: []
dependencies: []
---

# config-file-effect - Architecture

Composable config file loading for Effect with pluggable codecs, resolution
strategies, and merge behaviors.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [System Architecture](#system-architecture)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Related Documentation](#related-documentation)

---

## Overview

config-file-effect solves the problem of composable, testable config file
management in Effect applications. Rather than writing ad-hoc file loading
logic, the library provides a pluggable pipeline of codecs (how to
parse/write), resolvers (where to look), and strategies (how to merge
multiple sources).

The library is generic -- it has zero coupling to XDG directories or any
specific config convention. It was extracted from xdg-effect as a standalone
package so that any Effect application can use config file management without
adopting the full XDG stack.

**Key Design Principles:**

- **Pluggable pipeline:** Codecs, resolvers, and strategies are interfaces
  with built-in implementations. Consumers can provide custom implementations
  without forking.
- **Effect-native dependency injection:** The ConfigFile service is an Effect
  `Context.Tag` value. Layers compose via `Layer.provide`. No globals, no
  singletons.
- **Platform abstraction:** All filesystem and path operations use
  `@effect/platform` (`FileSystem`, `Path`), enabling multi-runtime support
  (Node, Bun, Deno). `Path.layer` is provided internally by ConfigFileLive.
- **Type-safe generics:** `ConfigFile.Tag<A>(id)` creates uniquely-keyed tags
  for each config schema. Multiple ConfigFile services can coexist in the same
  layer graph.
- **Error-absorbing resolvers:** All errors inside resolvers are caught and
  converted to `Option.none()`, so a permission-denied error or missing
  directory does not abort the resolver chain.

**When to reference this document:**

- When adding new codecs, resolvers, or strategies
- When modifying the service or layer implementation
- When integrating config-file-effect into a consuming application
- When debugging layer wiring or service resolution issues

---

## Current State

### Module Structure

Single package with a barrel export at `src/index.ts`. No internal barrel
files. The source tree is organized by responsibility:

```text
src/
  index.ts              # Single barrel export
  codecs/               # Pluggable config file format parsers
  errors/               # Data.TaggedError types with Base exports
  layers/               # Layer.Layer implementations (Live + Test)
  resolvers/            # Config file location strategies
  services/             # Context.Tag service interface + factories
  strategies/           # Config resolution merge strategies
```

### System Components

#### Component 1: ConfigFile Service

**Location:** `src/services/ConfigFile.ts`

**Purpose:** Namespace providing factory functions for creating typed config
file service tags and layers.

**Responsibilities:**

- `ConfigFile.Tag<A>(id)` -- create a unique `Context.Tag` for a config type
- `ConfigFile.Live<A>(options)` -- build a live layer from codecs, resolvers,
  and strategy
- `ConfigFile.Test<A>(options)` -- build a scoped test layer with
  pre-populated temp files

**Key interfaces/APIs:**

```typescript
interface ConfigFileService<A> {
  readonly load: Effect.Effect<A, ConfigError>;
  readonly loadFrom: (path: string) => Effect.Effect<A, ConfigError>;
  readonly discover: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigError>;
  readonly write: (value: A, path: string) => Effect.Effect<void, ConfigError>;
  readonly loadOrDefault: (defaultValue: A) => Effect.Effect<A, ConfigError>;
  readonly save: (value: A) => Effect.Effect<string, ConfigError>;
  readonly update: (fn: (current: A) => A, defaultValue?: A) => Effect.Effect<A, ConfigError>;
  readonly validate: (value: unknown) => Effect.Effect<A, ConfigError>;
}
```

**Dependencies:**

- Depends on: ConfigFileLive (layer implementation)
- Used by: Consumer applications

#### Component 2: ConfigFileLive

**Location:** `src/layers/ConfigFileLive.ts`

**Purpose:** Production implementation of ConfigFileService.

**Responsibilities:**

- Orchestrate resolver chain to discover config files
- Parse file content using pluggable codecs
- Validate parsed data against an Effect Schema
- Resolve multiple sources into a single value using a strategy
- Write/save config files back to disk with encode + serialize
- Create parent directories for save operations

**Dependencies:**

- Depends on: FileSystem (`@effect/platform`)
- Used by: ConfigFile.Live factory

**Layer type:** `Layer.Layer<ConfigFileService<A>, never, FileSystem.FileSystem>`

#### Component 3: ConfigFileTest

**Location:** `src/layers/ConfigFileTest.ts`

**Purpose:** Test layer that pre-populates files in temp directories with
automatic cleanup.

**Responsibilities:**

- Create temp files from a `files: Record<string, string>` map
- Provide NodeFileSystem.layer automatically
- Clean up written files via Effect finalizers on scope close

**Dependencies:**

- Depends on: NodeFileSystem (`@effect/platform-node`), Scope
- Used by: ConfigFile.Test factory, test suites

**Layer type:** `Layer.Layer<ConfigFileService<A>, never, Scope.Scope>`

### Pluggable Extension Points

#### Codecs

Interface `ConfigCodec` (at `src/codecs/ConfigCodec.ts`) with two built-in
implementations:

| Codec | File | Extensions |
| ----- | ---- | ---------- |
| `JsonCodec` | `src/codecs/JsonCodec.ts` | `.json` |
| `TomlCodec` | `src/codecs/TomlCodec.ts` | `.toml` |

Each codec provides `parse(raw) -> Effect<unknown, CodecError>` and
`stringify(value) -> Effect<string, CodecError>`. TomlCodec uses `smol-toml`
as the only runtime dependency.

#### Resolvers

Interface `ConfigResolver<R>` (at `src/resolvers/ConfigResolver.ts`) with five
built-in implementations:

| Resolver | File | Requirements | Strategy |
| -------- | ---- | ------------ | -------- |
| `ExplicitPath` | `src/resolvers/ExplicitPath.ts` | FileSystem | Check if a specific path exists |
| `StaticDir` | `src/resolvers/StaticDir.ts` | FileSystem | Check for filename in a known directory |
| `UpwardWalk` | `src/resolvers/UpwardWalk.ts` | FileSystem | Walk up from cwd looking for filename |
| `WorkspaceRoot` | `src/resolvers/WorkspaceRoot.ts` | FileSystem | Find monorepo root, check ordered subpaths |
| `GitRoot` | `src/resolvers/GitRoot.ts` | FileSystem | Find git root (.git dir or file), check ordered subpaths |

Each resolver returns `Effect<Option<string>, never, R>` -- errors are caught
and treated as "not found". The `R` type parameter captures requirements so
they flow through to the layer graph.

`WorkspaceRoot` and `GitRoot` both accept `subpaths?: ReadonlyArray<string>`.
Each subpath is tried in order; first file found wins. `"."` means the root
itself. When `subpaths` is omitted, the root is checked directly.

#### Strategies

Interface `ConfigWalkStrategy<A>` (at `src/strategies/ConfigWalkStrategy.ts`)
with two built-in implementations:

| Strategy | File | Behavior |
| -------- | ---- | -------- |
| `FirstMatch` | `src/strategies/FirstMatch.ts` | Return value from highest-priority source |
| `LayeredMerge` | `src/strategies/LayeredMerge.ts` | Deep-merge all sources, higher-priority wins |

### Error Types

All errors extend `Data.TaggedError` and export a `Base` class for
api-extractor compatibility:

| Error | Tag | Key Fields |
| ----- | --- | ---------- |
| `ConfigError` | `"ConfigError"` | `operation`, `path?`, `reason` |
| `CodecError` | `"CodecError"` | `codec`, `operation`, `reason` |

### Architecture Diagram

```text
           Consumer Application
                   |
                   v
           ConfigFile.Live(options)
                   |
     +-------------+-------------+
     |             |             |
  Resolvers     Codec       Strategy
  [0..N]       (1)          (1)
     |             |             |
     v             v             v
  Option<path>   parse/     resolve(
     |           stringify   sources)
     v             |             |
  FileSystem       v             v
  (@effect/    CodecError    ConfigError
   platform)
```

---

## Rationale

### Architectural Decisions

#### Decision 1: `@effect/platform` for all filesystem operations

**Context:** The library needs to read/write files and check paths.

**Options considered:**

1. **`@effect/platform` FileSystem (Chosen):**
   - Pros: Platform-agnostic, testable, aligns with Effect ecosystem
   - Cons: Requires consumers to provide `NodeFileSystem.layer`
   - Why chosen: Enables future Bun/Deno support and consistent Effect patterns

2. **Node.js `fs` module directly:**
   - Pros: No extra dependency
   - Cons: Locks to Node.js, harder to test
   - Why rejected: Defeats the purpose of building on Effect

#### Decision 2: `Context.GenericTag` for ConfigFile type parameter

**Context:** `ConfigFileService<A>` is generic over the configuration type.
Effect's `Context.Tag` does not support type parameters at the class level.

**Options considered:**

1. **`Context.GenericTag` factory (Chosen):**
   - Pros: Each config schema gets its own uniquely-keyed tag, type-safe,
     multiple ConfigFile services can coexist
   - Cons: Requires a factory function, slightly unusual API
   - Why chosen: The only mechanism Effect provides for type-parameterized
     context entries

2. **Fixed tag with runtime cast:**
   - Pros: Simpler API
   - Cons: Loses type safety, only one ConfigFile per application
   - Why rejected: Unsafe and limiting

#### Decision 3: `any` erasure on resolver and defaultPath requirements

**Context:** Resolvers carry their requirements as a type parameter `R` (e.g.,
`FileSystem`). The `ConfigFileOptions.resolvers` array needs to accept
resolvers with heterogeneous requirements.

**Options considered:**

1. **`ReadonlyArray<ConfigResolver<any>>` (Chosen):**
   - Pros: Ergonomic -- consumers can mix resolvers freely
   - Cons: Requirements are not type-checked at the options level
   - Why chosen: Layer composition ensures all requirements are satisfied at
     runtime. Type-level threading of heterogeneous union types through an
     array is not practical in TypeScript

2. **Variadic generics:**
   - Pros: Full type safety
   - Cons: TypeScript does not support this pattern ergonomically
   - Why rejected: Not feasible

#### Decision 4: Error-absorbing resolvers

**Context:** A resolver that fails (e.g., permission denied) should not abort
the entire config loading pipeline. Missing files are expected.

**Approach:** Every resolver wraps its logic in
`Effect.catchAll(() => Effect.succeed(Option.none()))`, converting all errors
to "not found". This means consumers can list resolvers without worrying about
order-dependent failures.

### Design Patterns Used

#### Pattern 1: Service/Layer separation

- **Where used:** ConfigFile service + ConfigFileLive/ConfigFileTest layers
- **Why used:** Separates interface from implementation. Enables testing with
  alternate implementations.

#### Pattern 2: Factory functions for parameterized layers

- **Where used:** `ConfigFile.Tag<A>(id)`, `ConfigFile.Live<A>(options)`,
  `ConfigFile.Test<A>(options)`
- **Why used:** Layers that need configuration at construction time cannot be
  static constants.

#### Pattern 3: Error-absorbing resolvers

- **Where used:** All ConfigResolver implementations
- **Why used:** Missing config files are normal; filesystem errors should not
  abort the resolver chain.

### Constraints and Trade-offs

#### Trade-off: Runtime dependency on smol-toml

- **What we gained:** TOML config file support out of the box
- **What we sacrificed:** One bundled runtime dependency
- **Why it is worth it:** TOML is the natural format for CLI tool configuration.
  smol-toml is small (~15KB) and zero-dependency.

#### Trade-off: Optional @effect/platform-node peer

- **What we gained:** The Test layer works out of the box with Node.js
- **What we sacrificed:** The Test layer imports from @effect/platform-node
  directly, coupling it to Node
- **Why it is worth it:** Tests overwhelmingly run on Node. Future platform
  layers can provide alternative test implementations.

---

## System Architecture

### Config File Loading Pipeline

The core pipeline runs when `ConfigFileService.load` is called:

1. **Discover:** Iterate over the resolver array. Each resolver's `resolve`
   effect runs, returning `Option<path>`.
2. **Read:** For each found path, read the file content via FileSystem.
3. **Parse:** Pass raw content to the codec's `parse` method.
4. **Decode:** Decode the parsed value against the Effect Schema.
5. **Validate:** Run the optional `validate` callback (post-decode hook).
6. **Collect:** Build `ConfigSource<A>` entries with path, tier, and value.
7. **Resolve:** Pass all sources to the strategy for final resolution.

Errors at steps 2-4 are wrapped in `ConfigError` with context (operation,
path, reason).

### Component Interactions

```text
Resolver[0]    Resolver[1]    Resolver[N]
  |               |               |
  v               v               v
Option<path>   Option<path>   Option<path>
  |               |               |
  v               v               v
FileSystem.readFileString   (for each Some)
  |               |
  v               v
Codec.parse     Codec.parse
  |               |
  v               v
Schema.decode   Schema.decode
  |               |
  +-------+-------+
          |
          v
   Strategy.resolve([sources])
          |
          v
   Final config value A
```

### Error Handling Strategy

All errors are `Data.TaggedError` subclasses, enabling pattern matching via
`Effect.catchTag`:

- **ConfigError** carries the operation (read/parse/validate/encode/stringify/
  write/save/resolve) and optional file path for precise diagnostics
- **CodecError** wraps parse/stringify failures from JSON or TOML codecs

ConfigFileLive maps CodecErrors to ConfigErrors at each pipeline stage,
preserving the original error as the `reason` string.

---

## Data Flow

### Data Model

```typescript
// Input: consumer provides this to configure ConfigFile
interface ConfigFileOptions<A> {
  readonly tag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
  readonly schema: Schema.Schema<A, any>;
  readonly codec: ConfigCodec;
  readonly strategy: ConfigWalkStrategy<A>;
  readonly resolvers: ReadonlyArray<ConfigResolver<any>>;
  readonly defaultPath?: Effect<string, ConfigError, any>;
  readonly validate?: (value: A) => Effect<A, ConfigError>;
}

// Intermediate: discovered during resolver chain
interface ConfigSource<A> {
  readonly path: string;   // filesystem path
  readonly tier: string;   // resolver name
  readonly value: A;       // parsed + validated value
}
```

### Write Flow

```text
[ConfigFileService.save(value)]
        |
        v
[Resolve defaultPath Effect]
        |
        v
[FileSystem.makeDirectory(dirname, recursive)]
        |
        v
[Schema.encodeUnknown(schema)(value)]
        |
        v
[Codec.stringify(encoded)]
        |
        v
[FileSystem.writeFileString(path, serialized)]
        |
        v
[Return path]
```

### State Management

- **ConfigFile:** Stateless -- reads filesystem on every call. No caching of
  resolved config values. Each `load` call runs the full resolver chain.

---

## Integration Points

### Internal Integrations

#### Integration: @effect/platform FileSystem

**How it integrates:** ConfigFileLive requires `FileSystem.FileSystem` in its
layer type. Consumers provide `NodeFileSystem.layer` from
`@effect/platform-node`.

**Data exchange:** File content as strings, directory existence checks, file
writes, directory creation.

### External Integrations

#### Integration: smol-toml

**Purpose:** Parse and stringify TOML configuration files.

**Protocol:** Direct function calls (`parse()`, `stringify()`)

**Error handling:** Parse errors are caught and wrapped in `CodecError`.

#### Integration: xdg-effect (downstream consumer)

**Purpose:** xdg-effect imports config-file-effect and provides XDG-specific
adapters (XdgConfig resolver, XdgSavePath helper) that compose with the
generic ConfigFile system.

**Protocol:** Implements ConfigResolver interface with AppDirs requirements.

---

## Testing Strategy

### Component Isolation

- Integration tests use `mkdtempSync` for unique temp directories with
  `afterEach` cleanup via `rmSync`
- Fixture files in `__test__/integration/fixtures/` provide reusable config
  data (JSON files read via `readFixture` helper)
- Snapshot assertions (`toMatchSnapshot()`) validate complex output structures
- ConfigFile.Test layer pre-populates files and provides automatic cleanup
  via Effect finalizers
- Codec and strategy tests are pure unit tests (no filesystem)

### Test Files

| File | Tests | Type |
| ---- | ----- | ---- |
| `__test__/errors.test.ts` | 2 | Unit: ConfigError + CodecError _tag and message |
| `__test__/codecs.test.ts` | 8 | Unit: JsonCodec + TomlCodec parse/stringify/metadata |
| `__test__/strategies.test.ts` | 4 | Unit: FirstMatch + LayeredMerge with inline sources |
| `__test__/integration/resolvers.int.test.ts` | 13 | Integration: ExplicitPath, StaticDir, UpwardWalk, WorkspaceRoot |
| `__test__/integration/git-root.int.test.ts` | 6 | Integration: GitRoot with .git dir, file (worktree), subpaths |
| `__test__/integration/config-file.int.test.ts` | 20 | Integration: full service pipeline, validate hook/method, Test layer |

### Test Patterns

**Fixtures and helpers:**

Shared test utilities live in `__test__/integration/utils/helpers.ts`:
`FsLayer`, `run` (Effect runner with FileSystem), `readFixture` (loads
fixture JSON from `__test__/integration/fixtures/`).

**mkdtempSync for temp directories:**

Integration tests create unique temp directories via `mkdtempSync(join(tmpdir(),
"cfg-prefix-"))` and clean up in `afterEach`. No hardcoded `/tmp` paths.

**Snapshot assertions:**

Complex output structures (loaded configs, discovered sources, merge results)
use `toMatchSnapshot()` for deterministic assertion without manual `expect`
chains.

---

## Future Enhancements

### Short-term

- **Config file watching:** Add an optional `watch` method that returns a
  `Stream` of config changes using filesystem polling or native watchers.
- **YAML codec:** Add a built-in YAML codec for broader config format support.

### Medium-term

- **Config migration system:** Add schema versioning and migration so config
  files can be upgraded between versions automatically.
- **Platform-agnostic Test layer:** Decouple ConfigFileTest from
  `@effect/platform-node` by accepting a FileSystem layer parameter.

### Potential Refactoring

- **Type-safe resolver requirements:** Thread resolver requirements through
  the options type instead of using `any` erasure. This would require
  variadic generics or a builder pattern.
- **Migrate from GenericTag:** When Effect adds native type-parameterized
  tags, update ConfigFile.Tag to use the new mechanism.

---

## Related Documentation

**User-Facing Documentation:**

- `README.md` -- Landing page with install, quick example, and API reference
- `docs/01-getting-started.md` -- Installation and Effect concepts
- `docs/02-config-files.md` -- Codecs, resolvers, strategies, ConfigFile API
- `docs/03-testing.md` -- Test layer and patterns
- `docs/04-error-handling.md` -- Tagged error types and recovery
- `docs/05-api-reference.md` -- Complete API surface reference

**External Resources:**

- [Effect Documentation](https://effect.website/)
- [@effect/platform API](https://github.com/Effect-TS/effect/tree/main/packages/platform)
- [smol-toml](https://github.com/nicolo-ribaudo/smol-toml)

**Upstream:**

- [xdg-effect](https://github.com/spencerbeggs/xdg-effect) -- the library
  this package was extracted from. xdg-effect provides XDG-specific adapters
  (XdgConfig resolver, XdgSavePath helper) on top of config-file-effect.

---

**Document Status:** Current at 95% completeness. All sections synced with
the implementation including GitRoot resolver, WorkspaceRoot multi-subpath
support, validate hook/method, @effect/platform Path usage, and integration
test pattern with fixtures and snapshots.
