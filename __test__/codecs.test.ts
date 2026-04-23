import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { JsonCodec, TomlCodec } from "../src/index.js";

describe("JsonCodec", () => {
	it("parses valid JSON", async () => {
		const result = await Effect.runPromise(JsonCodec.parse('{"key": "value"}'));
		expect(result).toEqual({ key: "value" });
	});

	it("fails on invalid JSON", async () => {
		const result = await Effect.runPromiseExit(JsonCodec.parse("{invalid}"));
		expect(result._tag).toBe("Failure");
	});

	it("stringifies to JSON", async () => {
		const result = await Effect.runPromise(JsonCodec.stringify({ key: "value" }));
		const parsed = JSON.parse(result);
		expect(parsed).toEqual({ key: "value" });
	});

	it("has correct name and extensions", () => {
		expect(JsonCodec.name).toBe("json");
		expect(JsonCodec.extensions).toEqual([".json"]);
	});
});

describe("TomlCodec", () => {
	it("parses valid TOML", async () => {
		const result = await Effect.runPromise(TomlCodec.parse('key = "value"'));
		expect(result).toEqual({ key: "value" });
	});

	it("fails on invalid TOML", async () => {
		const result = await Effect.runPromiseExit(TomlCodec.parse("[invalid\nbroken"));
		expect(result._tag).toBe("Failure");
	});

	it("stringifies to TOML", async () => {
		const result = await Effect.runPromise(TomlCodec.stringify({ key: "value" }));
		expect(result).toContain("key");
		expect(result).toContain("value");
	});

	it("has correct name and extensions", () => {
		expect(TomlCodec.name).toBe("toml");
		expect(TomlCodec.extensions).toEqual([".toml"]);
	});
});
