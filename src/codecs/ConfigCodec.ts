import type { Effect } from "effect";
import type { CodecError } from "../errors/CodecError.js";

/**
 * Interface for pluggable configuration file codecs.
 *
 * @remarks
 * Each codec knows how to parse raw file content into a structured value and
 * stringify a structured value back into file content. The `extensions` array
 * is used to match file paths to the appropriate codec.
 *
 * @public
 */
export interface ConfigCodec {
	readonly name: string;
	readonly extensions: ReadonlyArray<string>;
	readonly parse: (raw: string) => Effect.Effect<unknown, CodecError>;
	readonly stringify: (value: unknown) => Effect.Effect<string, CodecError>;
}
