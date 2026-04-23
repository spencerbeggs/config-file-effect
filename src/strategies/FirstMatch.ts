import { Effect } from "effect";
import { ConfigError } from "../errors/ConfigError.js";
import type { ConfigWalkStrategy } from "./ConfigWalkStrategy.js";

/**
 * Walk strategy that returns the value from the first (highest-priority)
 * config source. Fails with {@link ConfigError} when the source list is empty.
 *
 * @public
 */
// biome-ignore lint/suspicious/noExplicitAny: strategy must accept any config shape
export const FirstMatch: ConfigWalkStrategy<any> = {
	name: "first-match",
	resolve: (sources) => {
		const first = sources[0];
		if (!first) {
			return Effect.fail(
				new ConfigError({
					operation: "resolve",
					reason: "no config sources found",
				}),
			);
		}
		return Effect.succeed(first.value);
	},
};
