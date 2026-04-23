import { Effect } from "effect";
import { ConfigError } from "../errors/ConfigError.js";
import type { ConfigWalkStrategy } from "./ConfigWalkStrategy.js";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (key in result && isPlainObject(result[key]) && isPlainObject(source[key])) {
			result[key] = deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
		} else if (!(key in result)) {
			result[key] = source[key];
		}
	}
	return result;
};

/**
 * Walk strategy that deep-merges all config sources, with earlier
 * (higher-priority) sources winning on key conflicts. Nested objects are
 * merged recursively; non-object values from the higher-priority source
 * take precedence. Fails with {@link ConfigError} when the source list is
 * empty.
 *
 * @public
 */
// biome-ignore lint/suspicious/noExplicitAny: strategy must accept any config shape
export const LayeredMerge: ConfigWalkStrategy<any> = {
	name: "layered-merge",
	resolve: (sources) => {
		if (sources.length === 0) {
			return Effect.fail(
				new ConfigError({
					operation: "resolve",
					reason: "no config sources found",
				}),
			);
		}

		const reversed = [...sources].reverse();
		let merged: unknown = reversed[0]?.value;
		for (const source of reversed.slice(1)) {
			const current = source.value;
			if (isPlainObject(merged) && isPlainObject(current)) {
				merged = deepMerge(current as Record<string, unknown>, merged as Record<string, unknown>);
			} else {
				merged = current;
			}
		}

		return Effect.succeed(merged);
	},
};
