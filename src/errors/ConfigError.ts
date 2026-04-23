import { Data } from "effect";

/**
 * Tagged error base for {@link ConfigError}.
 *
 * @privateRemarks
 * Exported because TypeScript declaration bundling requires the base class to be
 * accessible when `ConfigError` appears in public type signatures.
 * Consumers should use {@link ConfigError} directly.
 *
 * @internal
 */
export const ConfigErrorBase = Data.TaggedError("ConfigError");

/**
 * Raised when a configuration file operation fails.
 *
 * @remarks
 * The `operation` field indicates which config operation triggered the failure
 * (e.g. `"load"`, `"save"`, `"validate"`), `path` is the optional filesystem
 * path involved, and `reason` describes the underlying cause.
 * Use `Effect.catchTag` with the `"ConfigError"` tag to handle this error
 * selectively.
 *
 * @public
 */
export class ConfigError extends ConfigErrorBase<{
	readonly operation: string;
	readonly path?: string;
	readonly reason: string;
}> {
	get message(): string {
		const location = this.path ? ` at "${this.path}"` : "";
		return `Config ${this.operation} failed${location}: ${this.reason}`;
	}
}
