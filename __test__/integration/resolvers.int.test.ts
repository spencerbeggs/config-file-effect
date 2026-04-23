import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExplicitPath, StaticDir, UpwardWalk, WorkspaceRoot } from "../../src/index.js";
import { readFixture, run } from "./utils/helpers.js";

describe("ExplicitPath", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-explicit-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns Some when file exists", async () => {
		const tmpFile = join(tmpDir, "config.json");
		writeFileSync(tmpFile, readFixture("app-config.json"));
		const resolver = ExplicitPath(tmpFile);
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(tmpFile);
	});

	it("returns None when file does not exist", async () => {
		const resolver = ExplicitPath(join(tmpDir, "does-not-exist.json"));
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});
});

describe("StaticDir", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-static-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns Some when file exists in directory", async () => {
		writeFileSync(join(tmpDir, "config.json"), readFixture("app-config.json"));
		const resolver = StaticDir({ dir: tmpDir, filename: "config.json" });
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, "config.json"));
	});

	it("returns None when file does not exist in directory", async () => {
		const resolver = StaticDir({ dir: tmpDir, filename: "missing.json" });
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});
});

describe("UpwardWalk", () => {
	let tmpDir: string;
	let nested: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-walk-"));
		nested = join(tmpDir, "a", "b", "c");
		mkdirSync(nested, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds config file in parent directory", async () => {
		writeFileSync(join(tmpDir, "app.config.json"), readFixture("app-config.json"));
		const resolver = UpwardWalk({ filename: "app.config.json", cwd: nested });
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, "app.config.json"));
	});

	it("returns None when file is not found", async () => {
		const resolver = UpwardWalk({
			filename: "nonexistent.json",
			cwd: nested,
			stopAt: tmpDir,
		});
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});

	it("respects stopAt boundary", async () => {
		writeFileSync(join(tmpDir, "app.config.json"), readFixture("app-config.json"));
		const resolver = UpwardWalk({
			filename: "app.config.json",
			cwd: nested,
			stopAt: join(tmpDir, "a"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});
});

describe("WorkspaceRoot", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-workspace-"));
		mkdirSync(join(tmpDir, ".config"), { recursive: true });
		mkdirSync(join(tmpDir, "packages", "my-pkg"), { recursive: true });
		writeFileSync(join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds file at root when subpaths is omitted", async () => {
		writeFileSync(join(tmpDir, "tool.config.json"), readFixture("app-config.json"));
		const resolver = WorkspaceRoot({
			filename: "tool.config.json",
			cwd: join(tmpDir, "packages", "my-pkg"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, "tool.config.json"));
	});

	it("tries subpaths in order and returns first match", async () => {
		writeFileSync(join(tmpDir, ".config", "tool.config.json"), readFixture("app-config.json"));
		const resolver = WorkspaceRoot({
			filename: "tool.config.json",
			subpaths: [".config", "config", "."],
			cwd: join(tmpDir, "packages", "my-pkg"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, ".config/tool.config.json"));
	});

	it("checks root when '.' is in subpaths", async () => {
		writeFileSync(join(tmpDir, "tool.config.json"), readFixture("app-config.json"));
		const resolver = WorkspaceRoot({
			filename: "tool.config.json",
			subpaths: ["nonexistent", "."],
			cwd: join(tmpDir, "packages", "my-pkg"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, "tool.config.json"));
	});

	it("returns None when no subpath matches", async () => {
		const resolver = WorkspaceRoot({
			filename: "tool.config.json",
			subpaths: ["nonexistent", "also-missing"],
			cwd: join(tmpDir, "packages", "my-pkg"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});

	it("returns None when no workspace root found", async () => {
		const isolated = mkdtempSync(join(tmpdir(), "cfg-no-ws-"));
		try {
			const resolver = WorkspaceRoot({
				filename: "tool.config.json",
				cwd: isolated,
			});
			const result = await run(resolver.resolve);
			expect(Option.isNone(result)).toBe(true);
		} finally {
			rmSync(isolated, { recursive: true, force: true });
		}
	});
});
