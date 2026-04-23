import { Effect } from "effect";
import { CodecError } from "../errors/CodecError.js";
import type { ConfigCodec } from "./ConfigCodec.js";

/**
 * JSON configuration codec.
 *
 * @remarks
 * Parses and stringifies JSON configuration files. Output uses tab indentation
 * for readability.
 *
 * @public
 */
export const JsonCodec: ConfigCodec = {
	name: "json",
	extensions: [".json"],
	parse: (raw) =>
		Effect.try({
			try: () => JSON.parse(raw) as unknown,
			catch: (error) =>
				new CodecError({
					codec: "json",
					operation: "parse",
					reason: String(error),
				}),
		}),
	stringify: (value) =>
		Effect.try({
			try: () => JSON.stringify(value, null, "\t"),
			catch: (error) =>
				new CodecError({
					codec: "json",
					operation: "stringify",
					reason: String(error),
				}),
		}),
};
