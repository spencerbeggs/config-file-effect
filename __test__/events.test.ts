import { DateTime, Effect, PubSub, Queue, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigEvent, ConfigEventPayload, ConfigEvents } from "../src/index.js";

describe("ConfigEvent", () => {
	it("creates a Loaded event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "Loaded", path: "/tmp/config.json" },
		});
		expect(event.event._tag).toBe("Loaded");
		if (event.event._tag === "Loaded") {
			expect(event.event.path).toBe("/tmp/config.json");
		}
	});

	it("creates a Discovered event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "Discovered", path: "/tmp/config.json", tier: "explicit" },
		});
		expect(event.event._tag).toBe("Discovered");
	});

	it("creates a ParseFailed event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "ParseFailed", path: "/tmp/config.json", codec: "json", reason: "unexpected token" },
		});
		expect(event.event._tag).toBe("ParseFailed");
		if (event.event._tag === "ParseFailed") {
			expect(event.event.reason).toBe("unexpected token");
		}
	});

	it("creates a ValidationFailed event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "ValidationFailed", path: "/tmp/config.json", reason: "missing field" },
		});
		expect(event.event._tag).toBe("ValidationFailed");
	});

	it("creates a NotFound event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "NotFound" },
		});
		expect(event.event._tag).toBe("NotFound");
	});

	it("decodes from unknown via Schema", async () => {
		const raw = {
			timestamp: "2026-01-01T00:00:00Z",
			event: { _tag: "Saved", path: "/tmp/out.json" },
		};
		const decoded = await Effect.runPromise(Schema.decodeUnknown(ConfigEvent)(raw));
		expect(decoded.event._tag).toBe("Saved");
	});

	it("ConfigEventPayload is a Schema union", () => {
		expect(ConfigEventPayload).toBeDefined();
	});
});

describe("ConfigEvents", () => {
	it("creates a tag with the given id", () => {
		const tag = ConfigEvents.Tag("test/Events");
		expect(tag).toBeDefined();
	});

	it("Live layer provides an unbounded PubSub", async () => {
		const tag = ConfigEvents.Tag("test/PubSub");
		const layer = ConfigEvents.Live(tag);

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.scoped(
					Effect.gen(function* () {
						const svc = yield* tag;
						const dequeue = yield* PubSub.subscribe(svc.events);
						yield* PubSub.publish(
							svc.events,
							new ConfigEvent({
								timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
								event: { _tag: "Loaded", path: "/tmp/test.json" },
							}),
						);
						const item = yield* Queue.take(dequeue);
						return item;
					}),
				),
				layer,
			),
		);
		expect(result.event._tag).toBe("Loaded");
	});
});
