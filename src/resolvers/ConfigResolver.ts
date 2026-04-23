import type { Effect, Option } from "effect";

/**
 * A composable config file resolver.
 *
 * @remarks
 * Each resolver encapsulates one lookup strategy (explicit path, static
 * directory, upward walk, workspace root, git root). The `resolve` effect
 * returns `Option.some(path)` when a config file is found, or `Option.none()`
 * when it is not. Errors (e.g. permission denied) are caught and treated as
 * "not found" rather than propagated.
 *
 * The `R` type parameter captures the requirements of the resolver (e.g.
 * `FileSystem`). Defaults to `never` for resolvers with no
 * requirements.
 *
 * @public
 */
export interface ConfigResolver<R = never> {
	readonly name: string;
	readonly resolve: Effect.Effect<Option.Option<string>, never, R>;
}
