import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigError, ConfigMigration, JsonCodec, VersionAccess } from "../src/index.js";

describe("VersionAccess", () => {
	it("default reads version from top-level field", async () => {
		const raw = { version: 2, name: "test" };
		const version = await Effect.runPromise(VersionAccess.default.get(raw));
		expect(version).toBe(2);
	});

	it("default sets version on top-level field", async () => {
		const raw = { version: 1, name: "test" };
		const updated = await Effect.runPromise(VersionAccess.default.set(raw, 3));
		expect((updated as Record<string, unknown>).version).toBe(3);
	});

	it("default fails when version field is missing", async () => {
		const raw = { name: "test" };
		const result = await Effect.runPromiseExit(VersionAccess.default.get(raw));
		expect(result._tag).toBe("Failure");
	});

	it("default fails when version is not a number", async () => {
		const raw = { version: "not-a-number", name: "test" };
		const result = await Effect.runPromiseExit(VersionAccess.default.get(raw));
		expect(result._tag).toBe("Failure");
	});
});

describe("ConfigMigration.make", () => {
	it("wraps codec parse to apply pending migrations", async () => {
		const migrations = [
			{
				version: 1,
				name: "add-port",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, port: 3000, version: 1 });
				},
			},
			{
				version: 2,
				name: "rename-name-to-title",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					const { name, ...rest } = obj;
					return Effect.succeed({ ...rest, title: name, version: 2 });
				},
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
		});

		const raw = JSON.stringify({ version: 0, name: "old-config" });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		const obj = result as Record<string, unknown>;
		expect(obj.version).toBe(2);
		expect(obj.title).toBe("old-config");
		expect(obj.port).toBe(3000);
		expect(obj.name).toBeUndefined();
	});

	it("skips already-applied migrations", async () => {
		const migrations = [
			{
				version: 1,
				name: "add-port",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, port: 3000, version: 1 });
				},
			},
			{
				version: 2,
				name: "add-host",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, host: "localhost", version: 2 });
				},
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
		});

		const raw = JSON.stringify({ version: 1, name: "test", port: 3000 });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		const obj = result as Record<string, unknown>;
		expect(obj.version).toBe(2);
		expect(obj.host).toBe("localhost");
		expect(obj.port).toBe(3000);
	});

	it("does nothing when all migrations are applied", async () => {
		const migrations = [
			{
				version: 1,
				name: "add-port",
				up: (raw: unknown) => Effect.succeed({ ...(raw as Record<string, unknown>), port: 3000, version: 1 }),
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
		});

		const raw = JSON.stringify({ version: 1, name: "test", port: 3000 });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		expect(result).toEqual({ version: 1, name: "test", port: 3000 });
	});

	it("uses custom versionAccess", async () => {
		const customAccess: VersionAccess = {
			get: (raw) => {
				const obj = raw as Record<string, unknown>;
				const meta = obj._meta as Record<string, unknown> | undefined;
				if (!meta || typeof meta.v !== "number") {
					return Effect.fail(new ConfigError({ operation: "migration", reason: "no _meta.v field" }));
				}
				return Effect.succeed(meta.v);
			},
			set: (raw, version) => {
				const obj = raw as Record<string, unknown>;
				return Effect.succeed({ ...obj, _meta: { ...(obj._meta as Record<string, unknown>), v: version } });
			},
		};

		const migrations = [
			{
				version: 1,
				name: "add-field",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, added: true });
				},
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
			versionAccess: customAccess,
		});

		const raw = JSON.stringify({ _meta: { v: 0 }, name: "test" });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		const obj = result as Record<string, unknown>;
		expect(obj.added).toBe(true);
		expect((obj._meta as Record<string, unknown>).v).toBe(1);
	});

	it("stringify passes through to inner codec", async () => {
		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations: [],
		});

		const result = await Effect.runPromise(wrappedCodec.stringify({ name: "test" }));
		expect(JSON.parse(result)).toEqual({ name: "test" });
	});

	it("preserves codec name and extensions", () => {
		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations: [],
		});

		expect(wrappedCodec.name).toBe("json");
		expect(wrappedCodec.extensions).toEqual([".json"]);
	});
});
