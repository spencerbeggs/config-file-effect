import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Option, PubSub, Queue, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConfigEvent } from "../../src/index.js";
import { ConfigEvents, ConfigFile, ExplicitPath, FirstMatch, JsonCodec } from "../../src/index.js";

const TestSchema = Schema.Struct({ name: Schema.String });
type TestConfig = typeof TestSchema.Type;

describe("ConfigFileLive with events", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-events-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits Discovered, Parsed, Validated, and Loaded events on load", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "test" }));

		const tag = ConfigFile.Tag<TestConfig>("test/Events");
		const eventsTag = ConfigEvents.Tag("test/Events");

		const eventsLayer = ConfigEvents.Live(eventsTag);
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
			events: eventsTag,
		});
		const fullLayer = Layer.provide(Layer.merge(configLayer, eventsLayer), NodeFileSystem.layer);

		const collected = await Effect.runPromise(
			Effect.provide(
				Effect.scoped(
					Effect.gen(function* () {
						const eventsSvc = yield* eventsTag;
						const dequeue = yield* PubSub.subscribe(eventsSvc.events);
						const config = yield* tag;
						yield* config.load;
						const events: Array<ConfigEvent> = [];
						let next = yield* Queue.poll(dequeue);
						while (Option.isSome(next)) {
							events.push(next.value);
							next = yield* Queue.poll(dequeue);
						}
						return events.map((e) => e.event._tag);
					}),
				),
				fullLayer,
			),
		);

		expect(collected).toContain("Discovered");
		expect(collected).toContain("Parsed");
		expect(collected).toContain("Validated");
		expect(collected).toContain("Loaded");
	});

	it("works without events (events option omitted)", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "no-events" }));

		const tag = ConfigFile.Tag<TestConfig>("test/NoEvents");
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* tag;
					return yield* config.load;
				}),
				Layer.provide(configLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("no-events");
	});

	it("emits DiscoveryFailed when resolver finds no config", async () => {
		const tag = ConfigFile.Tag<TestConfig>("test/DiscoveryFailed");
		const eventsTag = ConfigEvents.Tag("test/DiscoveryFailed");

		const eventsLayer = ConfigEvents.Live(eventsTag);
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(join(tmpDir, "nonexistent.json"))],
			events: eventsTag,
		});
		const fullLayer = Layer.provide(Layer.merge(configLayer, eventsLayer), NodeFileSystem.layer);

		const collected = await Effect.runPromise(
			Effect.provide(
				Effect.scoped(
					Effect.gen(function* () {
						const eventsSvc = yield* eventsTag;
						const dequeue = yield* PubSub.subscribe(eventsSvc.events);
						const config = yield* tag;
						// load will fail because no sources, but events should still have been emitted
						yield* config.load.pipe(Effect.ignore);
						const events: Array<ConfigEvent> = [];
						let next = yield* Queue.poll(dequeue);
						while (Option.isSome(next)) {
							events.push(next.value);
							next = yield* Queue.poll(dequeue);
						}
						return events.map((e) => e.event._tag);
					}),
				),
				fullLayer,
			),
		);

		expect(collected).toContain("DiscoveryFailed");
	});

	it("emits Saved event after successful save", async () => {
		const savePath = join(tmpDir, "saved.json");
		const tag = ConfigFile.Tag<TestConfig>("test/Saved");
		const eventsTag = ConfigEvents.Tag("test/Saved");

		const eventsLayer = ConfigEvents.Live(eventsTag);
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [],
			defaultPath: Effect.succeed(savePath),
			events: eventsTag,
		});
		const fullLayer = Layer.provide(Layer.merge(configLayer, eventsLayer), NodeFileSystem.layer);

		const collected = await Effect.runPromise(
			Effect.provide(
				Effect.scoped(
					Effect.gen(function* () {
						const eventsSvc = yield* eventsTag;
						const dequeue = yield* PubSub.subscribe(eventsSvc.events);
						const config = yield* tag;
						yield* config.save({ name: "saved-config" });
						const events: Array<ConfigEvent> = [];
						let next = yield* Queue.poll(dequeue);
						while (Option.isSome(next)) {
							events.push(next.value);
							next = yield* Queue.poll(dequeue);
						}
						return events.map((e) => e.event._tag);
					}),
				),
				fullLayer,
			),
		);

		expect(collected).toContain("Written");
		expect(collected).toContain("Saved");
	});
});
