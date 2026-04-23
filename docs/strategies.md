# Strategies

After the resolver chain runs, all discovered sources are passed to a strategy
that produces a single config value. config-file-effect ships with two
strategies: `FirstMatch` and `LayeredMerge`.

## The ConfigWalkStrategy Interface

```typescript
interface ConfigWalkStrategy<A> {
  readonly resolve: (
    sources: ReadonlyArray<ConfigSource<A>>,
  ) => Effect<A, ConfigError>;
}
```

The `sources` array is ordered from highest to lowest priority (matching the
order of the resolver array). Each source carries context about where it came
from:

```typescript
interface ConfigSource<A> {
  readonly path: string;  // filesystem path
  readonly tier: string;  // resolver name (e.g., "explicit", "walk", "git")
  readonly value: A;      // parsed + validated value
}
```

Both built-in strategies fail with `ConfigError` when the source list is empty
(no config file was found anywhere).

Both `FirstMatch` and `LayeredMerge` are exported as
`ConfigWalkStrategy<any>` for ergonomics -- the type parameter is not enforced
at compile time. Type safety for your config shape comes from the `schema`
field in `ConfigFileOptions`, not from the strategy.

## FirstMatch

Returns the value from the first source -- the highest-priority resolver that
found a file. Lower-priority sources are ignored entirely.

```typescript
import { FirstMatch } from "config-file-effect";

const layer = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [
    ExplicitPath("./local.json"),
    StaticDir({ dir: "/etc/myapp", filename: "config.json" }),
  ],
});
```

Use `FirstMatch` when:

- You want the most specific config to win completely.
- Config files are self-contained (not partial fragments).
- You need fast resolution with no merge overhead.

## LayeredMerge

Deep-merges all sources. The lowest-priority source is used as the base, and
higher-priority sources are applied on top:

- **Nested objects** are merged recursively.
- **Scalar values** (string, number, boolean, array) from the higher-priority
  source win when there is a conflict.
- Keys that exist only in the lower-priority source are preserved.

```typescript
import { LayeredMerge } from "config-file-effect";

const layer = ConfigFile.Live({
  tag: MyConfigFile,
  schema: MyConfig,
  codec: TomlCodec,
  strategy: LayeredMerge,
  resolvers: [
    UpwardWalk({ filename: "config.toml" }),          // project (high priority)
    StaticDir({ dir: "/etc/myapp", filename: "config.toml" }), // system (low priority)
  ],
});
```

Use `LayeredMerge` when:

- Config files are partial -- each source contributes some fields.
- You want a cascade (project overrides system defaults).
- The config schema has deeply nested objects that benefit from recursive merge.

## Concrete Example

Suppose two config files are found during a resolver walk:

- **Project-level** (higher priority):
  `{ port: 3000, debug: true }`
- **System-level** (lower priority):
  `{ port: 8080, name: "production" }`

**FirstMatch** returns:

```json
{ "port": 3000, "debug": true }
```

The project-level file wins entirely. The system-level `name` field is lost.

**LayeredMerge** returns:

```json
{ "port": 3000, "debug": true, "name": "production" }
```

The project-level `port` wins the conflict. The system-level `name` is
preserved because it does not conflict.

### Nested Object Merge

With nested objects, LayeredMerge merges recursively:

- **Project-level**: `{ database: { port: 5433 } }`
- **System-level**: `{ database: { port: 5432, host: "localhost" } }`

**LayeredMerge** returns:

```json
{ "database": { "port": 5433, "host": "localhost" } }
```

The project-level `port` wins, but the system-level `host` is preserved.

## Writing a Custom Strategy

Implement the `ConfigWalkStrategy` interface to create custom resolution logic.

### StrictFirst -- Fail on Multiple Sources

This strategy fails if more than one config source is found, enforcing that
only one source should exist:

```typescript
import { Effect } from "effect";
import { ConfigError } from "config-file-effect";
import type { ConfigWalkStrategy, ConfigSource } from "config-file-effect";

const StrictFirst: ConfigWalkStrategy<any> = {
  resolve: (sources: ReadonlyArray<ConfigSource<any>>) => {
    if (sources.length === 0) {
      return Effect.fail(
        new ConfigError({
          operation: "resolve",
          reason: "no config sources found",
        }),
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

### LatestModified -- Use the Most Recently Changed File

This strategy could sort by file modification time (requires additional
filesystem calls):

```typescript
const LatestModified: ConfigWalkStrategy<any> = {
  resolve: (sources) => {
    if (sources.length === 0) {
      return Effect.fail(
        new ConfigError({
          operation: "resolve",
          reason: "no config sources found",
        }),
      );
    }
    // In practice, you would check fs.stat for each source.path
    // For simplicity, this returns the last source
    return Effect.succeed(sources[sources.length - 1]!.value);
  },
};
```

## Testing Strategies in Isolation

Strategies do not require `FileSystem` -- they operate on in-memory
`ConfigSource` arrays. Test them directly without any filesystem setup:

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { FirstMatch, LayeredMerge } from "config-file-effect";
import type { ConfigSource } from "config-file-effect";

interface TestConfig {
  name: string;
  debug?: boolean;
  nested?: { port: number; host?: string };
}

const sources: ReadonlyArray<ConfigSource<TestConfig>> = [
  {
    path: "/project/config.json",
    tier: "walk",
    value: { name: "project", debug: true, nested: { port: 8080 } },
  },
  {
    path: "/home/.config/app/config.json",
    tier: "static",
    value: {
      name: "global",
      nested: { port: 3000, host: "localhost" },
    },
  },
];

describe("FirstMatch", () => {
  it("returns the first source value", async () => {
    const result = await Effect.runPromise(FirstMatch.resolve(sources));
    expect(result.name).toBe("project");
  });

  it("fails when sources are empty", async () => {
    const result = await Effect.runPromiseExit(FirstMatch.resolve([]));
    expect(result._tag).toBe("Failure");
  });
});

describe("LayeredMerge", () => {
  it("deep merges with first source winning conflicts", async () => {
    const result = await Effect.runPromise(
      LayeredMerge.resolve(sources),
    );
    expect(result.name).toBe("project");
    expect(result.debug).toBe(true);
    expect(result.nested?.port).toBe(8080);
    expect(result.nested?.host).toBe("localhost");
  });
});
```

---

[Previous: Resolvers](./resolvers.md) |
[Next: Events](./events.md)
