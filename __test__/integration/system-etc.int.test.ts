import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SystemEtc } from "../../src/index.js";
import { readFixture, run } from "./utils/helpers.js";

describe("SystemEtc", () => {
	let etcDir: string;

	beforeEach(() => {
		// Stand in for /etc — we cannot write to the real system directory.
		etcDir = mkdtempSync(join(tmpdir(), "cfg-etc-"));
		mkdirSync(join(etcDir, "myapp"), { recursive: true });
	});

	afterEach(() => {
		rmSync(etcDir, { recursive: true, force: true });
	});

	it("returns Some when /etc/<app>/<filename> exists (via dir override)", async () => {
		writeFileSync(join(etcDir, "myapp", "config.toml"), readFixture("app-config.json"));
		const resolver = SystemEtc({ app: "myapp", filename: "config.toml", dir: etcDir });
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(etcDir, "myapp", "config.toml"));
	});

	it("returns None when the file does not exist", async () => {
		const resolver = SystemEtc({ app: "myapp", filename: "missing.toml", dir: etcDir });
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});

	it("returns None on Windows even when the file exists", async () => {
		writeFileSync(join(etcDir, "myapp", "config.toml"), readFixture("app-config.json"));
		const original = Object.getOwnPropertyDescriptor(process, "platform");
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });
		try {
			const resolver = SystemEtc({ app: "myapp", filename: "config.toml", dir: etcDir });
			const result = await run(resolver.resolve);
			expect(Option.isNone(result)).toBe(true);
		} finally {
			if (original) {
				Object.defineProperty(process, "platform", original);
			}
		}
	});
});
