import { Data } from "effect";

/**
 * Tagged error base for {@link CodecError}.
 *
 * @remarks
 * Exported because TypeScript declaration bundling requires the base class to be
 * accessible wherever `CodecError` appears in a public type signature; it carries
 * no fields of its own. Prefer constructing and catching {@link CodecError} directly.
 *
 * @public
 */
export const CodecErrorBase = Data.TaggedError("CodecError");

/**
 * Raised when a codec serialization or deserialization operation fails.
 *
 * @remarks
 * The `codec` field identifies the codec format (e.g. `"json"`, `"toml"`),
 * `operation` indicates whether parsing or stringifying failed, and `reason`
 * describes the underlying cause. Use `Effect.catchTag` with the
 * `"CodecError"` tag to handle this error selectively.
 *
 * @public
 */
export class CodecError extends CodecErrorBase<{
	readonly codec: string;
	readonly operation: "parse" | "stringify" | "key-derivation";
	readonly reason: string;
}> {
	get message(): string {
		return `${this.codec} ${this.operation} failed: ${this.reason}`;
	}
}
