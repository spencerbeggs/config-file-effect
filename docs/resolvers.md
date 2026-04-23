# Resolvers

A resolver encapsulates one strategy for locating a config file on disk. During
a `load` call, the resolver chain runs in order -- each resolver either finds a
file and returns its path, or reports "not found" and the next resolver tries.

## The ConfigResolver Interface

```typescript
interface ConfigResolver<R = never> {
  readonly name: string;
  readonly resolve: Effect<Option<string>, never, R>;
}
```

- **`name`** -- Human-readable identifier (e.g., `"explicit"`, `"walk"`,
  `"git"`). Appears in `ConfigSource.tier` and event payloads.
- **`resolve`** -- An effect that returns `Option.some(path)` when a file is
  found, or `Option.none()` when it is not.

The `R` type parameter captures the resolver's service requirements (typically
`FileSystem`). The `ConfigFileOptions.resolvers` array uses
`ReadonlyArray<ConfigResolver<any>>` to allow mixing resolvers with
heterogeneous requirements. Layer composition ensures all requirements are
satisfied at runtime.

### Error Absorption

All errors inside a resolver are caught and converted to `Option.none()`. A
permission-denied error, a missing directory, or any other filesystem problem is
treated as "not found" rather than aborting the resolver chain. This means you
can list resolvers freely without worrying about order-dependent failures.

## Built-in Resolvers

| Resolver | Name | Use Case |
| -------- | ---- | -------- |
| `ExplicitPath` | `"explicit"` | `--config` CLI flag |
| `StaticDir` | `"static"` | System-wide config (e.g., `/etc/my-tool/`) |
| `UpwardWalk` | `"walk"` | Project-local config |
| `WorkspaceRoot` | `"workspace"` | Shared monorepo config |
| `GitRoot` | `"git"` | Config at git repository root |

All built-in resolvers require `FileSystem` from `@effect/platform`.

### ExplicitPath

Checks whether a specific file path exists. Returns the path if it does,
`Option.none()` if it does not.

```typescript
ExplicitPath(path: string): ConfigResolver<FileSystem>
```

Use this when the user has passed a `--config` flag pointing at a known
location:

```typescript
import { ExplicitPath } from "config-file-effect";

ExplicitPath("./my-tool.config.toml");
ExplicitPath(argv.config); // from parsed CLI flags
```

### StaticDir

Joins a known directory and filename, then checks for the file's existence.

```typescript
StaticDir(options: {
  readonly dir: string;
  readonly filename: string;
}): ConfigResolver<FileSystem>
```

Use this for system-wide config locations that are fixed at deploy time:

```typescript
import { StaticDir } from "config-file-effect";

StaticDir({ dir: "/etc/my-tool", filename: "config.toml" });
StaticDir({ dir: "/opt/myapp/conf", filename: "settings.json" });
```

### UpwardWalk

Starting from `cwd` (defaults to `process.cwd()`), walks toward the filesystem
root, checking each directory for `filename`. Stops when the file is found, the
root is reached, or the `stopAt` boundary is hit.

```typescript
UpwardWalk(options: {
  readonly filename: string;
  readonly cwd?: string;
  readonly stopAt?: string;
}): ConfigResolver<FileSystem>
```

Use this for project-local config files that live next to a project's source:

```typescript
import { UpwardWalk } from "config-file-effect";

// Walk up from cwd looking for config file
UpwardWalk({ filename: "my-tool.config.toml" });

// With a boundary -- stop at the user's home directory
UpwardWalk({
  filename: "my-tool.config.toml",
  stopAt: "/home/user",
});

// Start from a specific directory
UpwardWalk({
  filename: ".toolrc.json",
  cwd: "/projects/my-app/src/components",
});
```

### WorkspaceRoot

Walks up from `cwd` looking for a monorepo workspace root, identified by either:

- A `pnpm-workspace.yaml` file, or
- A `package.json` with a `workspaces` field

When found, checks for `filename` under each entry in `subpaths` (tried in
order, first match wins). Use `"."` to check the root itself. When `subpaths`
is omitted, the root is checked directly.

```typescript
WorkspaceRoot(options: {
  readonly filename: string;
  readonly subpaths?: ReadonlyArray<string>;
  readonly cwd?: string;
}): ConfigResolver<FileSystem>
```

Use this for config shared across all packages in a monorepo:

```typescript
import { WorkspaceRoot } from "config-file-effect";

// Check the workspace root directly
WorkspaceRoot({ filename: ".myapprc.json" });

// Try subdirectories in order, then the root
WorkspaceRoot({
  filename: "config.toml",
  subpaths: [".config", "config", "."],
});
```

### GitRoot

Walks up from `cwd` looking for a `.git` directory or file (git worktrees use a
`.git` file pointing to the real repository). When found, checks for `filename`
under each entry in `subpaths` (tried in order, first match wins). Use `"."` to
check the root itself. When `subpaths` is omitted, the root is checked directly.

```typescript
GitRoot(options: {
  readonly filename: string;
  readonly subpaths?: ReadonlyArray<string>;
  readonly cwd?: string;
}): ConfigResolver<FileSystem>
```

Use this when your tool's config lives at the root of a git repository that may
not be a monorepo:

```typescript
import { GitRoot } from "config-file-effect";

// Check the git root directly
GitRoot({ filename: ".myapprc.json" });

// Try .config/, config/, then root
GitRoot({
  filename: "config.toml",
  subpaths: [".config", "config", "."],
});
```

## Resolver Priority and Ordering

The resolver array determines source priority: the first resolver that finds a
file produces the highest-priority source. When using `FirstMatch`, only that
source is used. When using `LayeredMerge`, all sources contribute with
higher-priority sources winning key conflicts.

A typical ordering goes from most-specific to least-specific:

```typescript
resolvers: [
  ExplicitPath(argv.config),     // CLI flag (highest priority)
  UpwardWalk({ filename: "tool.toml" }),  // project-local
  WorkspaceRoot({ filename: "tool.toml" }),  // monorepo root
  StaticDir({ dir: "/etc/tool", filename: "config.toml" }),  // system-wide
]
```

## Typical Resolver Chain

A common pattern is to combine `WorkspaceRoot`, `GitRoot`, and `UpwardWalk` so
config is found regardless of project structure -- monorepo, git repo, or
standalone directory:

```typescript
import {
  WorkspaceRoot,
  GitRoot,
  UpwardWalk,
} from "config-file-effect";

resolvers: [
  WorkspaceRoot({
    filename: "tool.toml",
    subpaths: [".config", "config", "."],
  }),
  GitRoot({
    filename: "tool.toml",
    subpaths: [".config", "config", "."],
  }),
  UpwardWalk({ filename: "tool.toml" }),
]
```

In a monorepo, `WorkspaceRoot` finds the workspace root's config. In a plain
git repo, `GitRoot` picks it up. `UpwardWalk` acts as a fallback for any
directory structure.

## Writing a Custom Resolver

Implement the `ConfigResolver` interface to create custom lookup logic. The key
rule: wrap your logic so that all errors are caught and returned as
`Option.none()`.

```typescript
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import type { ConfigResolver } from "config-file-effect";

const EnvVarPath = (
  envVar: string,
): ConfigResolver<FileSystem.FileSystem> => ({
  name: "env",
  resolve: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = process.env[envVar];
    if (!path) return Option.none();
    const exists = yield* fs.exists(path);
    return exists ? Option.some(path) : Option.none();
  }).pipe(
    Effect.catchAll(() => Effect.succeed(Option.none())),
  ),
});

// Usage
resolvers: [
  EnvVarPath("MY_TOOL_CONFIG"),
  UpwardWalk({ filename: "config.toml" }),
]
```

The `Effect.catchAll(() => Effect.succeed(Option.none()))` at the end ensures
the resolver never throws, following the error-absorption pattern used by all
built-in resolvers.

## How Resolution Works in the Pipeline

When `configFile.load` is called:

1. Each resolver's `resolve` effect runs in order.
2. For each `Option.some(path)`, the file is read, parsed, decoded, and
   validated.
3. All successful sources are collected as `ConfigSource<A>` entries with
   `path`, `tier` (the resolver's `name`), and `value`.
4. The source array is passed to the strategy for final resolution.
5. If no resolver finds a file, a `ConfigError` with
   `operation: "resolve"` is raised.

When events are enabled, each resolver emits a `Discovered` or
`DiscoveryFailed` event. See [Events](./events.md) for details.

---

[Previous: Codecs](./codecs.md) |
[Next: Strategies](./strategies.md)
