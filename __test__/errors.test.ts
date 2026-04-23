import { describe, expect, it } from "vitest";
import { CodecError, ConfigError } from "../src/index.js";

describe("ConfigError", () => {
	it("has correct _tag and message", () => {
		const error = new ConfigError({
			operation: "load",
			path: "/etc/config.json",
			reason: "not found",
		});
		expect(error._tag).toBe("ConfigError");
		expect(error.message).toContain("load");
		expect(error.message).toContain("/etc/config.json");
	});
});

describe("CodecError", () => {
	it("has correct _tag and message", () => {
		const error = new CodecError({
			codec: "json",
			operation: "parse",
			reason: "unexpected token",
		});
		expect(error._tag).toBe("CodecError");
		expect(error.message).toContain("json");
		expect(error.message).toContain("parse");
	});
});
