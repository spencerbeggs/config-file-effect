import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import type { ConfigResolver } from "./ConfigResolver.js";

/**
 * Resolver that finds the workspace root and looks for a file there.
 *
 * @remarks
 * Walks up from `cwd` looking for a monorepo workspace root (indicated by
 * `pnpm-workspace.yaml` or a `package.json` with a `workspaces` field). When
 * found, checks whether `filename` exists at the root or under each entry in
 * `subpaths` (tried in order, first match wins). When `subpaths` is omitted,
 * checks the root directly. Returns `Option.some(fullPath)` when found,
 * `Option.none()` otherwise. Filesystem errors are caught and treated as
 * "not found".
 *
 * @public
 */
export const WorkspaceRoot = (options: {
	readonly filename: string;
	readonly subpaths?: ReadonlyArray<string>;
	readonly cwd?: string;
}): ConfigResolver<FileSystem.FileSystem> => ({
	name: "workspace",
	resolve: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const platformPath = yield* Path.Path;
		let current = options.cwd ?? globalThis.process?.cwd?.() ?? "/";

		let workspaceRoot: string | undefined;
		while (true) {
			if (yield* fs.exists(platformPath.join(current, "pnpm-workspace.yaml"))) {
				workspaceRoot = current;
				break;
			}
			const pkgPath = platformPath.join(current, "package.json");
			if (yield* fs.exists(pkgPath)) {
				const content = yield* fs.readFileString(pkgPath);
				try {
					const pkg = JSON.parse(content) as Record<string, unknown>;
					if ("workspaces" in pkg) {
						workspaceRoot = current;
						break;
					}
				} catch {
					// Not valid JSON, skip
				}
			}
			const parent = platformPath.dirname(current);
			if (parent === current) break;
			current = parent;
		}

		if (!workspaceRoot) return Option.none();

		const subpaths = options.subpaths ?? ["."];
		for (const sub of subpaths) {
			const fullPath =
				sub === "."
					? platformPath.join(workspaceRoot, options.filename)
					: platformPath.join(workspaceRoot, sub, options.filename);
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
