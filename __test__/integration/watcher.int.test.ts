import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Chunk, Duration, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConfigFileChange } from "../../src/index.js";
import { ConfigFile, ConfigWatcher, ExplicitPath, FirstMatch, JsonCodec } from "../../src/index.js";

const TestSchema = Schema.Struct({ name: Schema.String, count: Schema.optional(Schema.Number) });
type TestConfig = typeof TestSchema.Type;

describe("ConfigWatcher", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-watch-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits a change event when a watched file is modified", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "initial" }));

		const tag = ConfigFile.Tag<TestConfig>("test/Watch");
		const watcherTag = ConfigWatcher.Tag<TestConfig>("test/Watch");

		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const watcherLayer = ConfigWatcher.Live({
			tag: watcherTag,
			configTag: tag,
			paths: [configPath],
		});

		const fullLayer = Layer.provide(
			Layer.merge(configLayer, Layer.provide(watcherLayer, configLayer)),
			NodeFileSystem.layer,
		);

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const watcher = yield* watcherTag;
					const changeStream = watcher.watch({ interval: Duration.millis(100) });

					const fiber = yield* Stream.take(changeStream, 1).pipe(Stream.runCollect, Effect.fork);

					yield* Effect.sleep(Duration.millis(200));
					writeFileSync(configPath, JSON.stringify({ name: "updated", count: 1 }));

					const changes = yield* Fiber.join(fiber);
					return Chunk.toReadonlyArray(changes);
				}),
				fullLayer,
			),
		);

		expect(result.length).toBe(1);
		const change = result[0] as ConfigFileChange<TestConfig>;
		expect(change.path).toBe(configPath);
		expect(Option.isSome(change.previous)).toBe(true);
		expect(Option.isSome(change.current)).toBe(true);
		if (Option.isSome(change.current)) {
			expect(change.current.value.name).toBe("updated");
		}
	}, 10_000);

	it("stops polling when AbortSignal fires", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "initial" }));

		const tag = ConfigFile.Tag<TestConfig>("test/Signal");
		const watcherTag = ConfigWatcher.Tag<TestConfig>("test/Signal");

		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const watcherLayer = ConfigWatcher.Live({
			tag: watcherTag,
			configTag: tag,
			paths: [configPath],
		});

		const fullLayer = Layer.provide(
			Layer.merge(configLayer, Layer.provide(watcherLayer, configLayer)),
			NodeFileSystem.layer,
		);

		const controller = new AbortController();

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const watcher = yield* watcherTag;
					const changeStream = watcher.watch({
						interval: Duration.millis(100),
						signal: controller.signal,
					});

					const fiber = yield* Stream.runCollect(changeStream).pipe(Effect.fork);

					yield* Effect.sleep(Duration.millis(200));
					controller.abort();
					yield* Effect.sleep(Duration.millis(100));

					const exit = yield* Fiber.await(fiber);
					return exit;
				}),
				fullLayer,
			),
		);

		// Stream should have been interrupted by the AbortSignal
		expect(Exit.isInterrupted(result)).toBe(true);
	}, 10_000);

	it("creates a tag with the given id", () => {
		const tag = ConfigWatcher.Tag<TestConfig>("test/WatcherTag");
		expect(tag).toBeDefined();
	});
});
