import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import type { ConfigResolver } from "./ConfigResolver.js";

/**
 * Resolver that finds the git repository root and looks for a file there.
 *
 * @remarks
 * Walks up from `cwd` looking for a `.git` directory or file (worktrees use
 * a `.git` file pointing to the real repository). When found, checks whether
 * `filename` exists at the root or under each entry in `subpaths` (tried in
 * order, first match wins). When `subpaths` is omitted, checks the root
 * directly. Returns `Option.some(fullPath)` when found, `Option.none()`
 * otherwise. Filesystem errors are caught and treated as "not found".
 *
 * @public
 */
export const GitRoot = (options: {
	readonly filename: string;
	readonly subpaths?: ReadonlyArray<string>;
	readonly cwd?: string;
}): ConfigResolver<FileSystem.FileSystem> => ({
	name: "git",
	resolve: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const platformPath = yield* Path.Path;
		let current = options.cwd ?? globalThis.process?.cwd?.() ?? "/";

		let gitRoot: string | undefined;
		while (true) {
			if (yield* fs.exists(platformPath.join(current, ".git"))) {
				gitRoot = current;
				break;
			}
			const parent = platformPath.dirname(current);
			if (parent === current) break;
			current = parent;
		}

		if (!gitRoot) return Option.none();

		const subpaths = options.subpaths ?? ["."];
		for (const sub of subpaths) {
			const fullPath =
				sub === "." ? platformPath.join(gitRoot, options.filename) : platformPath.join(gitRoot, sub, options.filename);
			if (yield* fs.exists(fullPath)) {
				return Option.some(fullPath);
			}
		}

		return Option.none();
	}).pipe(
		Effect.provide(Path.layer),
		Effect.catchAll(() => Effect.succeed(Option.none())),
	),
});
