# Testing

config-file-effect is designed for testability. Every service reads
configuration through Effect's dependency injection, so you can swap
implementations in tests without touching the real filesystem.

## ConfigFile.Test

`ConfigFile.Test` creates a scoped test layer that optionally pre-populates
files on disk and cleans them up when the scope closes. It accepts all
`ConfigFileOptions` fields plus an optional `files` map:

```typescript
ConfigFile.Test<A>(options: ConfigFileTestOptions<A>)
```

```typescript
interface ConfigFileTestOptions<A> extends ConfigFileOptions<A> {
  readonly files?: Record<string, string>;
}
```

The `files` map is a dictionary of absolute paths to file contents. Before the
layer is constructed, each file is written to disk (parent directories are
created automatically). When the scope closes, the files are deleted via Effect
finalizers.

### Layer Type

```typescript
Layer<ConfigFileService<A>, never, FileSystem.FileSystem | Scope.Scope>
```

The test layer requires two things from the environment:

- **`FileSystem`** -- You must provide a platform-specific filesystem layer
  (e.g., `NodeFileSystem.layer` from `@effect/platform-node` or
  `BunFileSystem.layer` from `@effect/platform-bun`).
- **`Scope`** -- Required for file cleanup. Wrap test effects in
  `Effect.scoped` to ensure cleanup runs.

This design decouples the test layer from any specific runtime, enabling
testing on Node.js, Bun, or Deno.

### When to Use ConfigFile.Test

- Use `ConfigFile.Test` for most tests -- it handles file lifecycle and wiring
  automatically, so you write less boilerplate.
- Use custom layers when you need specific control over the environment
  (explicit directory paths, testing error conditions).
- `ConfigFile.Test` exercises the real service logic -- it is integration-style,
  not a mock.

### Basic Example

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ConfigFile,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

const TestConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.optional(Schema.Number),
});
type TestConfig = typeof TestConfig.Type;

describe("my config tests", () => {
  it("loads pre-populated config files", async () => {
    const tag = ConfigFile.Tag<TestConfig>("test/Config");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            const config = yield* tag;
            return yield* config.load;
          }),
          Layer.provide(
            ConfigFile.Test({
              tag,
              schema: TestConfig,
              codec: JsonCodec,
              strategy: FirstMatch,
              resolvers: [ExplicitPath("/tmp/test-config/app.json")],
              files: {
                "/tmp/test-config/app.json": JSON.stringify({
                  name: "pre-populated",
                  port: 8080,
                }),
              },
            }),
            NodeFileSystem.layer,
          ),
        ),
      ),
    );

    expect(result.name).toBe("pre-populated");
    expect(result.port).toBe(8080);
  });
});
```

All `ConfigFile.Test` layers require `Scope` because they manage file
lifetimes. Wrap test effects in `Effect.scoped` to ensure cleanup.

### Testing with Defaults

When no files are pre-populated, use `loadOrDefault` to verify default
behavior:

```typescript
it("returns default when no files exist", async () => {
  const tag = ConfigFile.Tag<TestConfig>("test/Default");

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const config = yield* tag;
          return yield* config.loadOrDefault({ name: "fallback" });
        }),
        Layer.provide(
          ConfigFile.Test({
            tag,
            schema: TestConfig,
            codec: JsonCodec,
            strategy: FirstMatch,
            resolvers: [ExplicitPath("/nonexistent/app.json")],
          }),
          NodeFileSystem.layer,
        ),
      ),
    ),
  );

  expect(result.name).toBe("fallback");
});
```

## Testing with ConfigFile.Live and NodeFileSystem

For tests that need more control, use `ConfigFile.Live` directly with
`NodeFileSystem.layer` and manage test files yourself:

```typescript
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigFile,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

const TestConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.optional(Schema.Number),
});
type TestConfig = typeof TestConfig.Type;

const TestConfigTag = ConfigFile.Tag<TestConfig>("test/Manual");

describe("ConfigFile with manual setup", () => {
  const tmpBase = `/tmp/config-test-${Date.now()}`;

  beforeEach(() => {
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("loads config from explicit path", async () => {
    const configPath = join(tmpBase, "app.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ name: "manual", port: 3000 }),
    );

    const ConfigLayer = ConfigFile.Live({
      tag: TestConfigTag,
      schema: TestConfig,
      codec: JsonCodec,
      strategy: FirstMatch,
      resolvers: [ExplicitPath(configPath)],
    });

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const config = yield* TestConfigTag;
          return yield* config.load;
        }),
        Layer.provide(ConfigLayer, NodeFileSystem.layer),
      ),
    );

    expect(result.name).toBe("manual");
    expect(result.port).toBe(3000);
  });
});
```

## Testing with Scoped Temp Directories

`@effect/platform`'s `FileSystem` provides `makeTempDirectoryScoped`, which
creates an isolated temp directory that is cleaned up automatically when the
scope closes. This avoids manual `beforeEach`/`afterEach` setup:

```typescript
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import {
  ConfigFile,
  ExplicitPath,
  FirstMatch,
  TomlCodec,
} from "config-file-effect";

const TestConfig = Schema.Struct({ name: Schema.String });
type TestConfig = typeof TestConfig.Type;

const withTempConfig = (configContent: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tmpDir = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${tmpDir}/config.toml`, configContent);
    return tmpDir;
  });

const test = Effect.gen(function* () {
  const tmpDir = yield* withTempConfig('name = "scoped"\n');
  const tag = ConfigFile.Tag<TestConfig>("test/Scoped");

  const configLayer = ConfigFile.Live({
    tag,
    schema: TestConfig,
    codec: TomlCodec,
    strategy: FirstMatch,
    resolvers: [ExplicitPath(`${tmpDir}/config.toml`)],
  });

  return yield* Effect.provide(
    Effect.gen(function* () {
      const config = yield* tag;
      return yield* config.load;
    }),
    configLayer,
  );
}).pipe(
  Effect.scoped,
  Effect.provide(NodeFileSystem.layer),
);
```

`makeTempDirectoryScoped` ties the directory's lifetime to the current
`Effect.scoped` scope. When the scope closes, the directory and its contents
are deleted.

## Testing Strategies in Isolation

Strategies do not require `FileSystem` -- they operate on in-memory
`ConfigSource` arrays. Test them directly without filesystem setup:

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
    value: {
      name: "project",
      debug: true,
      nested: { port: 8080 },
    },
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
    const result = await Effect.runPromise(
      FirstMatch.resolve(sources),
    );
    expect(result.name).toBe("project");
  });

  it("fails when sources are empty", async () => {
    const result = await Effect.runPromiseExit(
      FirstMatch.resolve([]),
    );
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

## Testing Resolvers in Isolation

Resolvers require `FileSystem`. Provide `NodeFileSystem.layer` and test against
real temp files:

```typescript
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExplicitPath, UpwardWalk } from "config-file-effect";
import type { FileSystem } from "@effect/platform";

const FsLayer = NodeFileSystem.layer;

const run = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem>,
) => Effect.runPromise(Effect.provide(effect, FsLayer));

describe("UpwardWalk", () => {
  const tmpBase = `/tmp/walk-test-${Date.now()}`;
  const nested = join(tmpBase, "a", "b", "c");

  beforeEach(() => {
    mkdirSync(nested, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("finds config file in parent directory", async () => {
    writeFileSync(join(tmpBase, "app.config.json"), "{}");
    const resolver = UpwardWalk({
      filename: "app.config.json",
      cwd: nested,
    });
    const result = await run(resolver.resolve);
    expect(Option.isSome(result)).toBe(true);
    expect(Option.getOrThrow(result)).toBe(
      join(tmpBase, "app.config.json"),
    );
  });

  it("respects stopAt boundary", async () => {
    writeFileSync(join(tmpBase, "app.config.json"), "{}");
    const resolver = UpwardWalk({
      filename: "app.config.json",
      cwd: nested,
      stopAt: join(tmpBase, "a"),
    });
    const result = await run(resolver.resolve);
    expect(Option.isNone(result)).toBe(true);
  });
});
```

## Testing Error Scenarios

Test that parse errors propagate correctly:

```typescript
it("propagates parse errors for corrupt files", async () => {
  const tag = ConfigFile.Tag<TestConfig>("test/Corrupt");

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const config = yield* tag;
          return yield* config
            .loadOrDefault({ name: "default" })
            .pipe(Effect.flip);
        }),
        Layer.provide(
          ConfigFile.Test({
            tag,
            schema: TestConfig,
            codec: JsonCodec,
            strategy: FirstMatch,
            resolvers: [ExplicitPath("/tmp/corrupt-test/app.json")],
            files: {
              "/tmp/corrupt-test/app.json": "not valid json {{{",
            },
          }),
          NodeFileSystem.layer,
        ),
      ),
    ),
  );

  expect(result._tag).toBe("ConfigError");
  expect(result.operation).toBe("parse");
});
```

`Effect.flip` swaps the success and error channels, letting you assert on the
error value directly.

## Testing Migrations

Migration `up` functions are pure `Effect` values. Test them directly:

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const migration = {
  version: 2,
  name: "split-address",
  up: (raw: unknown) =>
    Effect.gen(function* () {
      const obj = raw as Record<string, unknown>;
      const address = obj.address as string;
      const [host, port] = address.split(":");
      return { ...obj, host, port: Number(port) };
    }),
};

describe("migration v2", () => {
  it("splits address into host and port", async () => {
    const v1 = { version: 1, name: "app", address: "localhost:8080" };
    const v2 = await Effect.runPromise(migration.up(v1));
    expect(v2).toMatchObject({
      host: "localhost",
      port: 8080,
    });
  });
});
```

## Testing with Events

Test that the event system emits expected events:

```typescript
import { Effect, Layer, PubSub, Schema, Stream } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import {
  ConfigEvents,
  ConfigFile,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

it("emits Loaded event on successful load", async () => {
  const tag = ConfigFile.Tag<TestConfig>("test/Events");
  const eventsTag = ConfigEvents.Tag("test/Events");

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const eventsService = yield* eventsTag;
          const sub = yield* PubSub.subscribe(eventsService.events);

          const config = yield* tag;
          yield* config.load;

          // Collect events that were published
          const events = yield* Stream.fromQueue(sub).pipe(
            Stream.takeUntil(
              (e) => e.event._tag === "Loaded",
            ),
            Stream.runCollect,
          );

          return [...events];
        }),
        Layer.provide(
          Layer.mergeAll(
            ConfigFile.Test({
              tag,
              schema: TestConfig,
              codec: JsonCodec,
              strategy: FirstMatch,
              resolvers: [ExplicitPath("/tmp/events-test/app.json")],
              files: {
                "/tmp/events-test/app.json": JSON.stringify({
                  name: "test",
                }),
              },
              events: eventsTag,
            }),
            ConfigEvents.Live(eventsTag),
          ),
          NodeFileSystem.layer,
        ),
      ),
    ),
  );

  const tags = result.map((e) => e.event._tag);
  expect(tags).toContain("Loaded");
});
```

---

[Previous: Watcher](./watcher.md) |
[Next: Errors](./errors.md)
