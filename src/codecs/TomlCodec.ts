import { Effect } from "effect";
import { parse, stringify } from "smol-toml";
import { CodecError } from "../errors/CodecError.js";
import type { ConfigCodec } from "./ConfigCodec.js";

/**
 * TOML configuration codec.
 *
 * @remarks
 * Parses and stringifies TOML configuration files using the `smol-toml`
 * library.
 *
 * @public
 */
export const TomlCodec: ConfigCodec = {
	name: "toml",
	extensions: [".toml"],
	parse: (raw) =>
		Effect.try({
			try: () => parse(raw) as unknown,
			catch: (error) =>
				new CodecError({
					codec: "toml",
					operation: "parse",
					reason: String(error),
				}),
		}),
	stringify: (value) =>
		Effect.try({
			try: () => stringify(value as Record<string, unknown>),
			catch: (error) =>
				new CodecError({
					codec: "toml",
					operation: "stringify",
					reason: String(error),
				}),
		}),
};
