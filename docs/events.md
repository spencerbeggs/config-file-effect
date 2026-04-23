# Events

config-file-effect includes a PubSub event system for pipeline observability.
When enabled, the `ConfigFile` service emits structured events at each stage of
the load/save pipeline. Events are opt-in -- when not configured, event emission
is a no-op with zero overhead.

## Overview

The event system has three parts:

1. **ConfigEvent** -- A `Schema.Class` wrapping a UTC timestamp and an event
   payload.
2. **ConfigEventPayload** -- A union of 15 `Schema.TaggedStruct` variants, one
   for each pipeline stage.
3. **ConfigEvents** -- A namespace with `Tag` and `Live` factories for creating
   and providing the event service.

## Setting Up Events

### 1. Create an Events Tag

```typescript
import { ConfigEvents } from "config-file-effect";

const AppEvents = ConfigEvents.Tag("my-app");
```

This creates a unique `Context.Tag<ConfigEventsService>` for your application.

### 2. Create the Events Layer

```typescript
const EventsLayer = ConfigEvents.Live(AppEvents);
```

This creates a `Layer` that provides an unbounded `PubSub<ConfigEvent>`.

### 3. Pass the Events Tag to ConfigFile.Live

```typescript
import {
  ConfigFile,
  ConfigEvents,
  JsonCodec,
  FirstMatch,
  ExplicitPath,
} from "config-file-effect";

const AppConfigFile = ConfigFile.Tag<AppConfig>("app/Config");
const AppEvents = ConfigEvents.Tag("app/Events");

const ConfigLayer = ConfigFile.Live({
  tag: AppConfigFile,
  schema: AppConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./config.json")],
  events: AppEvents,  // <-- opt-in to events
});

const EventsLayer = ConfigEvents.Live(AppEvents);
```

### 4. Subscribe to Events

```typescript
import { Effect, PubSub, Stream } from "effect";

const program = Effect.gen(function* () {
  // Get the events service
  const eventsService = yield* AppEvents;

  // Subscribe to the PubSub
  const subscription = yield* PubSub.subscribe(eventsService.events);

  // Process events as a stream
  const eventStream = Stream.fromQueue(subscription);

  // Or consume events in a fiber
  yield* Stream.runForEach(eventStream, (event) =>
    Effect.sync(() => {
      console.log(
        `[${event.timestamp}] ${event.event._tag}`,
        event.event,
      );
    }),
  ).pipe(Effect.fork);

  // Now load config -- events will be emitted
  const configFile = yield* AppConfigFile;
  const config = yield* configFile.load;
});
```

## Full Example

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, PubSub, Schema, Stream } from "effect";
import {
  ConfigEvents,
  ConfigFile,
  ExplicitPath,
  FirstMatch,
  JsonCodec,
} from "config-file-effect";

const AppConfig = Schema.Struct({
  name: Schema.String,
  port: Schema.Number,
});
type AppConfig = typeof AppConfig.Type;

const AppConfigFile = ConfigFile.Tag<AppConfig>("app/Config");
const AppEvents = ConfigEvents.Tag("app/Events");

const ConfigLayer = ConfigFile.Live({
  tag: AppConfigFile,
  schema: AppConfig,
  codec: JsonCodec,
  strategy: FirstMatch,
  resolvers: [ExplicitPath("./app.config.json")],
  events: AppEvents,
});

const EventsLayer = ConfigEvents.Live(AppEvents);

const program = Effect.gen(function* () {
  const eventsService = yield* AppEvents;
  const sub = yield* PubSub.subscribe(eventsService.events);

  // Log events in background
  yield* Stream.runForEach(
    Stream.fromQueue(sub),
    (event) =>
      Effect.sync(() =>
        console.log(`[${event.event._tag}]`, event.event),
      ),
  ).pipe(Effect.fork);

  const configFile = yield* AppConfigFile;
  const config = yield* configFile.load;
  console.log("Config:", config);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.provide(
        Layer.merge(ConfigLayer, EventsLayer),
        NodeFileSystem.layer,
      ),
    ),
  ),
);
```

## Event Types

Each event has a `_tag` discriminant for pattern matching. All events are
wrapped in a `ConfigEvent` with a UTC `timestamp`.

### Discovery Events

| Event | Fields | Emitted When |
| ----- | ------ | ------------ |
| `Discovered` | `path`, `tier` | A resolver finds a config file |
| `DiscoveryFailed` | `tier`, `reason` | A resolver finds nothing or fails |

### Resolution Events

| Event | Fields | Emitted When |
| ----- | ------ | ------------ |
| `Resolved` | `path`, `tier`, `strategy` | Strategy selects a source |
| `ResolutionFailed` | `reason` | Strategy fails |
| `NotFound` | (none) | No config sources found by any resolver |

### Codec Events

| Event | Fields | Emitted When |
| ----- | ------ | ------------ |
| `Parsed` | `path`, `codec` | Codec parse succeeds |
| `ParseFailed` | `path`, `codec`, `reason` | Codec parse fails |
| `Stringified` | `path`, `codec` | Codec stringify succeeds |
| `StringifyFailed` | `codec`, `reason` | Codec stringify fails |

### Validation Events

| Event | Fields | Emitted When |
| ----- | ------ | ------------ |
| `Validated` | `path` | Schema decode + validate hook succeeds |
| `ValidationFailed` | `path`, `reason` | Schema decode or validate hook fails |

### Lifecycle Events

| Event | Fields | Emitted When |
| ----- | ------ | ------------ |
| `Loaded` | `path` | Config value fully loaded |
| `Saved` | `path` | Config saved to default path |
| `Updated` | `path` | Config updated (load + save) |
| `Written` | `path` | File written to disk |

## The ConfigEventsService Interface

```typescript
interface ConfigEventsService {
  readonly events: PubSub.PubSub<ConfigEvent>;
}
```

The service exposes a single `events` field -- an Effect `PubSub` that
broadcasts `ConfigEvent` instances to all subscribers.

## How Events Are Emitted

When the `events` tag is provided in `ConfigFileOptions`, `ConfigFileLive` uses
`Effect.serviceOption` to look up the events service. If the service is present,
events are published to the PubSub at each pipeline stage. If the service is
absent (tag provided but no layer), the emission is silently skipped.

Event emission failures are swallowed (`Effect.catchAll(() => Effect.void)`) --
observability never aborts the data pipeline.

## Filtering Events

Use the `_tag` field to filter for specific event types:

```typescript
const parseErrors = Stream.fromQueue(subscription).pipe(
  Stream.filter(
    (event) => event.event._tag === "ParseFailed",
  ),
);
```

Or use pattern matching:

```typescript
Stream.runForEach(
  Stream.fromQueue(subscription),
  (event) =>
    Effect.sync(() => {
      switch (event.event._tag) {
        case "Discovered":
          console.log(`Found: ${event.event.path} (${event.event.tier})`);
          break;
        case "ParseFailed":
          console.error(`Parse error: ${event.event.reason}`);
          break;
        case "Loaded":
          console.log(`Loaded from: ${event.event.path}`);
          break;
      }
    }),
);
```

## Event Flow During a Load

A typical `load` call with two resolvers (one finds a file, one does not)
produces this event sequence:

```text
1. Discovered       { path: "/project/config.json", tier: "walk" }
2. Parsed           { path: "/project/config.json", codec: "json" }
3. Validated        { path: "/project/config.json" }
4. DiscoveryFailed  { tier: "static", reason: "not found" }
5. Resolved         { path: "/project/config.json", tier: "walk", strategy: "strategy" }
6. Loaded           { path: "/project/config.json" }
```

## Event Flow During a Save

A `save` call produces:

```text
1. Written          { path: "/home/user/.config/app/config.json" }
2. Saved            { path: "/home/user/.config/app/config.json" }
```

## When Not to Use Events

If you only need simple logging, `loadOrDefault` or `catchTag` error handling
may be sufficient. Events are most valuable when:

- You need structured observability (metrics, dashboards).
- Multiple subscribers need to react to config changes.
- You want to trace the full pipeline for debugging.
- You are building tooling on top of config-file-effect.

---

[Previous: Strategies](./strategies.md) |
[Next: Migrations](./migrations.md)
