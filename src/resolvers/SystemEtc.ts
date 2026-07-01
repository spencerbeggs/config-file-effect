import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import type { ConfigResolver } from "./ConfigResolver.js";

/**
 * Resolver that looks for a system-level config file under `/etc`.
 *
 * @remarks
 * Probes `<dir>/<app>/<filename>`, where `dir` defaults to `/etc`. Returns
 * `Option.some(path)` when the file exists, `Option.none()` otherwise.
 * On Windows `/etc` is meaningless, so the resolver short-circuits to
 * `Option.none()` rather than probing a surprising drive-relative path.
 * Filesystem errors are caught and treated as "not found".
 *
 * @public
 */
export const SystemEtc = (options: {
	readonly app: string;
	readonly filename: string;
	/**
	 * System config root. Defaults to `/etc`. Overridable primarily so tests
	 * can point at a writable temp directory — the real `/etc` is not writable
	 * in test environments — and as an escape hatch for non-standard layouts.
	 */
	readonly dir?: string;
}): ConfigResolver<FileSystem.FileSystem> => ({
	name: "system",
	resolve: Effect.gen(function* () {
		// `/etc` has no meaning on Windows; short-circuit to "not found".
		if (globalThis.process?.platform === "win32") {
			return Option.none();
		}
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const base = options.dir ?? "/etc";
		const fullPath = path.join(base, options.app, options.filename);
		const exists = yield* fs.exists(fullPath);
		return exists ? Option.some(fullPath) : Option.none();
	}).pipe(
		Effect.provide(Path.layer),
		Effect.catchAll(() => Effect.succeed(Option.none())),
	),
});
