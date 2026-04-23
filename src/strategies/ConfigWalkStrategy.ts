import type { Effect } from "effect";
import type { ConfigError } from "../errors/ConfigError.js";

/**
 * A single configuration source discovered during a resolver chain pass.
 *
 * @public
 */
export interface ConfigSource<A> {
	readonly path: string;
	readonly tier: string;
	readonly value: A;
}

/**
 * Strategy for resolving multiple {@link ConfigSource} entries into a single
 * configuration value.
 *
 * @public
 */
export interface ConfigWalkStrategy<A> {
	readonly resolve: (sources: ReadonlyArray<ConfigSource<A>>) => Effect.Effect<A, ConfigError>;
}
