import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitRoot } from "../../src/index.js";
import { readFixture, run } from "./utils/helpers.js";

describe("GitRoot", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-git-"));
		mkdirSync(join(tmpDir, ".git"), { recursive: true });
		mkdirSync(join(tmpDir, ".config"), { recursive: true });
		mkdirSync(join(tmpDir, "src", "deep", "nested"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds file at git root when subpaths is omitted", async () => {
		writeFileSync(join(tmpDir, "tool.config.json"), readFixture("app-config.json"));
		const resolver = GitRoot({
			filename: "tool.config.json",
			cwd: join(tmpDir, "src", "deep", "nested"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, "tool.config.json"));
	});

	it("tries subpaths in order and returns first match", async () => {
		writeFileSync(join(tmpDir, ".config", "tool.config.json"), readFixture("app-config.json"));
		const resolver = GitRoot({
			filename: "tool.config.json",
			subpaths: [".config", "config", "."],
			cwd: join(tmpDir, "src", "deep", "nested"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, ".config/tool.config.json"));
	});

	it("checks root when '.' is in subpaths", async () => {
		writeFileSync(join(tmpDir, "tool.config.json"), readFixture("app-config.json"));
		const resolver = GitRoot({
			filename: "tool.config.json",
			subpaths: ["nonexistent", "."],
			cwd: join(tmpDir, "src", "deep", "nested"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result)).toBe(join(tmpDir, "tool.config.json"));
	});

	it("returns None when no subpath matches", async () => {
		const resolver = GitRoot({
			filename: "tool.config.json",
			subpaths: ["nonexistent", "also-missing"],
			cwd: join(tmpDir, "src", "deep", "nested"),
		});
		const result = await run(resolver.resolve);
		expect(Option.isNone(result)).toBe(true);
	});

	it("returns None when no git root found", async () => {
		const isolated = mkdtempSync(join(tmpdir(), "cfg-no-git-"));
		try {
			const resolver = GitRoot({
				filename: "tool.config.json",
				cwd: isolated,
			});
			const result = await run(resolver.resolve);
			expect(Option.isNone(result)).toBe(true);
		} finally {
			rmSync(isolated, { recursive: true, force: true });
		}
	});

	it("detects .git file (worktree)", async () => {
		const worktreeDir = mkdtempSync(join(tmpdir(), "cfg-worktree-"));
		writeFileSync(join(worktreeDir, ".git"), "gitdir: /some/other/path/.git/worktrees/branch");
		writeFileSync(join(worktreeDir, "tool.config.json"), readFixture("app-config.json"));
		try {
			const resolver = GitRoot({
				filename: "tool.config.json",
				cwd: worktreeDir,
			});
			const result = await run(resolver.resolve);
			expect(Option.isSome(result)).toBe(true);
			expect(Option.getOrThrow(result)).toBe(join(worktreeDir, "tool.config.json"));
		} finally {
			rmSync(worktreeDir, { recursive: true, force: true });
		}
	});
});
