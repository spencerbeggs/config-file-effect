import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ConfigError,
	ConfigFile,
	ExplicitPath,
	FirstMatch,
	JsonCodec,
	LayeredMerge,
	StaticDir,
} from "../../src/index.js";
import { readFixture } from "./utils/helpers.js";

const TestConfigSchema = Schema.Struct({
	name: Schema.String,
	port: Schema.optional(Schema.Number),
});
type TestConfig = typeof TestConfigSchema.Type;

const TestConfig = ConfigFile.Tag<TestConfig>("test/Config");

describe("ConfigFile", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-test-"));
		mkdirSync(join(tmpDir, "project"), { recursive: true });
		mkdirSync(join(tmpDir, "xdg-config"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("loads config from explicit path with FirstMatch", async () => {
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, readFixture("app-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.load;
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toMatchSnapshot();
	});

	it("loadFrom loads directly from a path bypassing resolvers", async () => {
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, readFixture("app-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.loadFrom(configPath);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toMatchSnapshot();
	});

	it("discovers multiple sources", async () => {
		const projectConfig = join(tmpDir, "project", "app.config.json");
		const xdgConfig = join(tmpDir, "xdg-config", "app.config.json");
		writeFileSync(projectConfig, readFixture("project-config.json"));
		writeFileSync(xdgConfig, readFixture("global-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [
				StaticDir({ dir: join(tmpDir, "project"), filename: "app.config.json" }),
				StaticDir({ dir: join(tmpDir, "xdg-config"), filename: "app.config.json" }),
			],
		});

		const sources = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.discover;
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(sources.length).toBe(2);
		expect(sources[0]?.tier).toBe("static");
		expect(sources.map((s) => s.value)).toMatchSnapshot();
	});

	it("deep merges with LayeredMerge strategy", async () => {
		const highPriority = join(tmpDir, "project", "app.config.json");
		const lowPriority = join(tmpDir, "xdg-config", "app.config.json");
		writeFileSync(highPriority, readFixture("partial-config.json"));
		writeFileSync(lowPriority, readFixture("global-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: LayeredMerge,
			resolvers: [
				StaticDir({ dir: join(tmpDir, "project"), filename: "app.config.json" }),
				StaticDir({ dir: join(tmpDir, "xdg-config"), filename: "app.config.json" }),
			],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.load;
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toMatchSnapshot();
	});

	it("writes config to a file", async () => {
		const outputPath = join(tmpDir, "output.json");
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, readFixture("app-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					yield* config.write({ name: "written", port: 9090 }, outputPath);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);

		const written = JSON.parse(readFileSync(outputPath, "utf-8"));
		expect(written.name).toBe("written");
	});

	it("loadOrDefault returns default when no config file exists", async () => {
		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [StaticDir({ dir: join(tmpDir, "nonexistent"), filename: "app.config.json" })],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.loadOrDefault({ name: "default-name" });
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("default-name");
	});

	it("loadOrDefault returns parsed value when config file exists", async () => {
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, JSON.stringify({ name: "from-file", port: 4000 }));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.loadOrDefault({ name: "default-name" });
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("from-file");
		expect(result.port).toBe(4000);
	});

	it("loadOrDefault propagates parse errors for corrupt files", async () => {
		const configPath = join(tmpDir, "project", "corrupt.json");
		writeFileSync(configPath, readFixture("corrupt.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.loadOrDefault({ name: "default-name" }).pipe(Effect.flip);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result._tag).toBe("ConfigError");
		expect(result.operation).toBe("parse");
	});

	it("save writes to defaultPath and returns the path", async () => {
		const savePath = join(tmpDir, "save-target", "app.config.json");
		const dummySourcePath = join(tmpDir, "project", "app.config.json");
		writeFileSync(dummySourcePath, readFixture("app-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(dummySourcePath)],
			defaultPath: Effect.succeed(savePath),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.save({ name: "saved", port: 5000 });
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toBe(savePath);

		const written = JSON.parse(readFileSync(savePath, "utf-8"));
		expect(written.name).toBe("saved");
		expect(written.port).toBe(5000);
	});

	it("save creates parent directories if they do not exist", async () => {
		const savePath = join(tmpDir, "deep", "nested", "dir", "app.config.json");

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [],
			defaultPath: Effect.succeed(savePath),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.save({ name: "deep-save" });
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toBe(savePath);

		const written = JSON.parse(readFileSync(savePath, "utf-8"));
		expect(written.name).toBe("deep-save");
	});

	it("save fails with ConfigError when no defaultPath configured", async () => {
		const dummySourcePath = join(tmpDir, "project", "app.config.json");
		writeFileSync(dummySourcePath, readFixture("app-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(dummySourcePath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.save({ name: "no-path" }).pipe(Effect.flip);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result._tag).toBe("ConfigError");
		expect(result.operation).toBe("save");
		expect(result.reason).toBe("no default path configured");
	});

	it("update modifies existing config and saves", async () => {
		const savePath = join(tmpDir, "update-target", "app.config.json");
		const sourcePath = join(tmpDir, "project", "app.config.json");
		writeFileSync(sourcePath, JSON.stringify({ name: "original", port: 3000 }));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(sourcePath)],
			defaultPath: Effect.succeed(savePath),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.update((current) => ({ ...current, port: 9090 }));
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toMatchSnapshot();

		const written = JSON.parse(readFileSync(savePath, "utf-8"));
		expect(written.name).toBe("original");
		expect(written.port).toBe(9090);
	});

	it("update uses defaultValue when no config file exists", async () => {
		const savePath = join(tmpDir, "update-new", "app.config.json");

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [StaticDir({ dir: join(tmpDir, "nonexistent"), filename: "app.config.json" })],
			defaultPath: Effect.succeed(savePath),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.update((current) => ({ ...current, port: 7070 }), { name: "default-name" });
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result).toMatchSnapshot();

		const written = JSON.parse(readFileSync(savePath, "utf-8"));
		expect(written.name).toBe("default-name");
		expect(written.port).toBe(7070);
	});

	it("update fails when no file exists and no defaultValue provided", async () => {
		const savePath = join(tmpDir, "update-fail", "app.config.json");

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [StaticDir({ dir: join(tmpDir, "nonexistent"), filename: "app.config.json" })],
			defaultPath: Effect.succeed(savePath),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.update((current) => ({ ...current, port: 1 })).pipe(Effect.flip);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result._tag).toBe("ConfigError");
		expect(result.operation).toBe("resolve");
	});

	it("validate hook runs after schema decode", async () => {
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, JSON.stringify({ name: "test", port: 99 }));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
			validate: (value) =>
				value.port !== undefined && value.port < 1024
					? Effect.fail(new ConfigError({ operation: "validate", reason: "port must be >= 1024" }))
					: Effect.succeed(value),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.load.pipe(Effect.flip);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result._tag).toBe("ConfigError");
		expect(result.operation).toBe("validate");
		expect(result.reason).toBe("port must be >= 1024");
	});

	it("validate hook can transform the value", async () => {
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, readFixture("app-config.json"));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
			validate: (value) => Effect.succeed({ ...value, name: value.name.toUpperCase() }),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.load;
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("EXPLICIT");
		expect(result.port).toBe(3000);
	});

	it("works without validate hook (optional)", async () => {
		const configPath = join(tmpDir, "project", "app.config.json");
		writeFileSync(configPath, JSON.stringify({ name: "no-hook", port: 5000 }));

		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.load;
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("no-hook");
	});

	it("validate method decodes unknown input", async () => {
		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.validate({ name: "validated", port: 8080 });
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("validated");
		expect(result.port).toBe(8080);
	});

	it("validate method fails on invalid schema input", async () => {
		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.validate({ port: "not-a-number" }).pipe(Effect.flip);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result._tag).toBe("ConfigError");
		expect(result.operation).toBe("validate");
	});

	it("validate method runs the validate hook", async () => {
		const ConfigLayer = ConfigFile.Live({
			tag: TestConfig,
			schema: TestConfigSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [],
			validate: (value) =>
				value.port !== undefined && value.port < 1024
					? Effect.fail(new ConfigError({ operation: "validate", reason: "port must be >= 1024" }))
					: Effect.succeed(value),
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* TestConfig;
					return yield* config.validate({ name: "test", port: 80 }).pipe(Effect.flip);
				}),
				Layer.provide(ConfigLayer, NodeFileSystem.layer),
			),
		);
		expect(result._tag).toBe("ConfigError");
		expect(result.reason).toBe("port must be >= 1024");
	});
});

describe("ConfigFile.Test", () => {
	it("loads pre-populated files", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "cfg-scoped-"));
		const filePath = join(tmpDir, "app.json");
		const tag = ConfigFile.Tag<TestConfig>("test/Scoped");
		try {
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
								schema: TestConfigSchema,
								codec: JsonCodec,
								strategy: FirstMatch,
								resolvers: [ExplicitPath(filePath)],
								files: {
									[filePath]: readFixture("project-config.json"),
								},
							}),
							NodeFileSystem.layer,
						),
					),
				),
			);
			expect(result).toMatchSnapshot();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns default when no files pre-populated", async () => {
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
							schema: TestConfigSchema,
							codec: JsonCodec,
							strategy: FirstMatch,
							resolvers: [StaticDir({ dir: "/nonexistent", filename: "app.json" })],
						}),
						NodeFileSystem.layer,
					),
				),
			),
		);
		expect(result.name).toBe("fallback");
	});
});
