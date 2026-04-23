import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ConfigSource } from "../src/index.js";
import { FirstMatch, LayeredMerge } from "../src/index.js";

interface TestConfig {
	name: string;
	debug?: boolean;
	nested?: { port: number; host?: string };
}

const sources: ReadonlyArray<ConfigSource<TestConfig>> = [
	{
		path: "/project/app.config.json",
		tier: "walk",
		value: { name: "project", debug: true, nested: { port: 8080 } },
	},
	{
		path: "/home/.config/app/config.json",
		tier: "xdg",
		value: { name: "global", nested: { port: 3000, host: "localhost" } },
	},
];

describe("FirstMatch", () => {
	it("returns the first source value", async () => {
		const result = await Effect.runPromise(FirstMatch.resolve(sources));
		expect(result.name).toBe("project");
		expect(result.debug).toBe(true);
	});

	it("fails when sources are empty", async () => {
		const result = await Effect.runPromiseExit(FirstMatch.resolve([]));
		expect(result._tag).toBe("Failure");
	});
});

describe("LayeredMerge", () => {
	it("deep merges sources with first source taking priority", async () => {
		const result = await Effect.runPromise(LayeredMerge.resolve(sources));
		expect(result.name).toBe("project");
		expect(result.debug).toBe(true);
		expect(result.nested?.port).toBe(8080);
		expect(result.nested?.host).toBe("localhost");
	});

	it("fails when sources are empty", async () => {
		const result = await Effect.runPromiseExit(LayeredMerge.resolve([]));
		expect(result._tag).toBe("Failure");
	});
});
