import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import type { ConfigResolver } from "./ConfigResolver.js";

/**
 * Resolver that checks whether a specific file path exists.
 *
 * @remarks
 * Returns `Option.some(path)` when the file exists, `Option.none()` otherwise.
 * Filesystem errors are caught and treated as "not found".
 *
 * @public
 */
export const ExplicitPath = (path: string): ConfigResolver<FileSystem.FileSystem> => ({
	name: "explicit",
	resolve: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const exists = yield* fs.exists(path);
		return exists ? Option.some(path) : Option.none();
	}).pipe(Effect.catchAll(() => Effect.succeed(Option.none()))),
});
