# Watcher

`ConfigWatcher` provides polling-based config file change detection. It returns
a `Stream` of `ConfigFileChange` events whenever watched files differ from their
previous values. Use it for live config reloading, triggering rebuilds on config
changes, or monitoring config file health.

## Overview

The watcher polls a fixed set of file paths at a configurable interval (default
5 seconds). On each poll, it loads each path through the `ConfigFileService`
pipeline (parse, decode, validate), compares the result to the previous value
via `JSON.stringify`, and emits a `ConfigFileChange` event for any diff.

## Quick Start

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema, Stream } from "effect";
import {
  ConfigFile,
  ConfigWatcher,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

const AppConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
});
type AppConfig = typeof AppConfig.Type;

// Create tags
const AppConfigFile = ConfigFile.Tag<AppConfig>("app/Config");
const AppConfigWatcher = ConfigWatcher.Tag<AppConfig>("app/Watcher");

// Config layer
const ConfigLayer = ConfigFile.Live({
  tag: AppConfigFile,
  schema: AppConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./config.json")],
});

// Watcher layer -- depends on ConfigFileService
const WatcherLayer = ConfigWatcher.Live({
  tag: AppConfigWatcher,
  configTag: AppConfigFile,
  paths: ["./config.json"],
});

const program = Effect.gen(function* () {
  const watcher = yield* AppConfigWatcher;

  // Start watching with default 5-second interval
  const changes = watcher.watch();

  yield* Stream.runForEach(changes, (change) =>
    Effect.sync(() => {
      console.log(`Config changed at ${change.path}`);
      console.log("  Previous:", change.previous);
      console.log("  Current:", change.current);
      console.log("  At:", change.timestamp);
    }),
  );
});

Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.provide(
        Layer.merge(ConfigLayer, WatcherLayer),
        NodeFileSystem.layer,
      ),
    ),
  ),
);
```

## ConfigWatcher.Tag

```typescript
ConfigWatcher.Tag<A>(id: string): Context.Tag<ConfigWatcherService<A>>
```

Creates a unique `Context.Tag` for a `ConfigWatcherService<A>`. Internally
calls `Context.GenericTag` with the identifier
`"config-file-effect/ConfigWatcher/${id}"`.

## ConfigWatcher.Live

```typescript
ConfigWatcher.Live<A>(options: {
  readonly tag: Context.Tag<ConfigWatcherService<A>, ConfigWatcherService<A>>;
  readonly configTag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
  readonly paths: ReadonlyArray<string>;
}): Layer<ConfigWatcherService<A>, never, ConfigFileService<A>>
```

Builds a live `ConfigWatcherService` layer. The layer depends on
`ConfigFileService<A>` (provided by the `configTag`), which it uses to load
and parse each watched path.

**Parameters:**

- **`tag`** -- The watcher's own service tag (created with `ConfigWatcher.Tag`).
- **`configTag`** -- The `ConfigFile` service tag used for loading files.
- **`paths`** -- Fixed list of file paths to monitor.

## ConfigWatcherService

```typescript
interface ConfigWatcherService<A> {
  readonly watch: (options?: WatchOptions) => Stream<ConfigFileChange<A>, ConfigError>;
}
```

The service has a single `watch` method that returns a `Stream` of change
events.

## WatchOptions

```typescript
interface WatchOptions {
  readonly interval?: Duration.DurationInput;
  readonly signal?: AbortSignal;
}
```

- **`interval`** -- How often to poll. Defaults to 5 seconds. Accepts any
  `Duration.DurationInput` (e.g., `Duration.seconds(10)`,
  `Duration.millis(500)`, `"3 seconds"`).
- **`signal`** -- An `AbortSignal` for cancellation.

```typescript
import { Duration } from "effect";

// Poll every 10 seconds
const changes = watcher.watch({ interval: Duration.seconds(10) });

// Poll every 500ms (for development)
const fastChanges = watcher.watch({ interval: Duration.millis(500) });
```

## ConfigFileChange

```typescript
interface ConfigFileChange<A> {
  readonly path: string;
  readonly previous: Option.Option<A>;
  readonly current: Option.Option<A>;
  readonly timestamp: DateTime.Utc;
}
```

- **`path`** -- The file path that changed.
- **`previous`** -- The previous parsed value, or `Option.none()` if the file
  did not exist before.
- **`current`** -- The current parsed value, or `Option.none()` if the file no
  longer exists.
- **`timestamp`** -- When the change was detected (UTC).

The `Option` values let you detect all three change types:

| Previous | Current | Meaning |
| -------- | ------- | ------- |
| `none()` | `some(v)` | File appeared |
| `some(v)` | `some(v')` | File content changed |
| `some(v)` | `none()` | File disappeared |

## How Change Detection Works

1. **Initialization** -- On the first call to `watch`, the watcher loads each
   path via `configService.loadFrom`. Errors (missing files, parse failures)
   are caught and stored as `Option.none()`. These initial values are stored in
   a `Ref<Map<string, Option<A>>>`.

2. **Poll loop** -- At each interval tick (via `Schedule.spaced`), every path is
   loaded again. The new value is compared to the stored value using
   `JSON.stringify` for structural equality.

3. **Change emission** -- If `JSON.stringify(previous) !== JSON.stringify(current)`,
   a `ConfigFileChange` is emitted and the stored value is updated.

4. **Stream output** -- Poll results (which may contain zero or more changes)
   are flattened into individual change events via `Stream.mapConcat`.

## Practical Patterns

### Hot Reload

```typescript
const program = Effect.gen(function* () {
  const configFile = yield* AppConfigFile;
  const watcher = yield* AppConfigWatcher;

  // Load initial config
  let config = yield* configFile.load;
  console.log("Initial config:", config);

  // Watch for changes
  yield* Stream.runForEach(watcher.watch(), (change) =>
    Effect.gen(function* () {
      if (Option.isSome(change.current)) {
        config = change.current.value;
        console.log("Config reloaded:", config);
      } else {
        console.warn("Config file disappeared!");
      }
    }),
  );
});
```

### Watching Multiple Files

The `paths` array can contain multiple files. Each is polled independently:

```typescript
const WatcherLayer = ConfigWatcher.Live({
  tag: AppConfigWatcher,
  configTag: AppConfigFile,
  paths: [
    "./config.json",
    "/etc/myapp/config.json",
    "/home/user/.config/myapp/config.json",
  ],
});
```

### Combining with Events

The watcher uses `ConfigFileService.loadFrom` internally, which emits events
when the events system is configured. This means each poll triggers
`Parsed`, `Validated`, etc. events for every watched path. If this is too
noisy, consider using a longer poll interval or filtering events by `_tag`.

## Design Decisions

### Why Polling?

The watcher uses polling rather than native filesystem watchers (`fs.watch`,
inotify) because:

- **Portability** -- Works identically on all platforms (macOS, Linux, Windows,
  Bun, Deno).
- **Reliability** -- Native watchers have well-documented cross-platform
  inconsistencies (macOS FSEvents vs Linux inotify vs Windows ReadDirectoryChangesW).
- **Simplicity** -- No native dependencies, no platform-specific code paths.
- **Sufficient for config files** -- Config files change infrequently. A
  5-second poll interval is appropriate for most use cases.

### Why JSON.stringify for Comparison?

`JSON.stringify` provides structural equality comparison without requiring the
config type to implement `Equals`. It handles nested objects, arrays, and
primitive values correctly. The tradeoff is that property order matters -- but
since values are loaded through the same codec and schema each time, ordering
is deterministic.

## State Management

The watcher maintains a `Ref<Map<string, Option<A>>>` tracking the last-known
value for each watched path. This state is scoped to the watcher layer's
lifetime. When the layer is released, the state is garbage collected.

The `ConfigFileService` itself is stateless -- each `loadFrom` call reads from
disk. The watcher adds the stateful comparison layer on top.

---

[Previous: Migrations](./migrations.md) |
[Next: Testing](./testing.md)
