import { Effect } from "effect";
import type { ConfigCodec } from "../codecs/ConfigCodec.js";
import { CodecError } from "../errors/CodecError.js";
import { ConfigError } from "../errors/ConfigError.js";

/**
 * A single versioned migration step for a config file.
 *
 * @remarks
 * Each migration has a monotonically increasing `version` number. The `up`
 * function transforms the parsed config from the previous version to this
 * version. The optional `down` function reverses the transformation.
 *
 * @public
 */
export interface ConfigFileMigration {
	readonly version: number;
	readonly name: string;
	readonly up: (raw: unknown) => Effect.Effect<unknown, ConfigError>;
	readonly down?: (raw: unknown) => Effect.Effect<unknown, ConfigError>;
}

/**
 * Controls how version numbers are read from and written to the parsed config.
 *
 * @remarks
 * The default implementation reads and writes a top-level `version` field.
 * Supply a custom `VersionAccess` to store the version in a nested field,
 * a `_meta` envelope, or any other location.
 *
 * @public
 */
export interface VersionAccess {
	readonly get: (raw: unknown) => Effect.Effect<number, ConfigError>;
	readonly set: (raw: unknown, version: number) => Effect.Effect<unknown, ConfigError>;
}

const defaultVersionAccess: VersionAccess = {
	get: (raw) =>
		Effect.gen(function* () {
			if (typeof raw !== "object" || raw === null) {
				return yield* Effect.fail(new ConfigError({ operation: "migration", reason: "config is not an object" }));
			}
			const version = (raw as Record<string, unknown>).version;
			if (typeof version !== "number") {
				return yield* Effect.fail(
					new ConfigError({
						operation: "migration",
						reason: "version field is missing or not a number",
					}),
				);
			}
			return version;
		}),
	set: (raw, version) => Effect.succeed({ ...(raw as Record<string, unknown>), version }),
};

/**
 * Namespace and interface for pluggable version tracking in {@link ConfigMigration}.
 *
 * @public
 */
export const VersionAccess = {
	/**
	 * Reads/writes the version from a top-level `version` field on the config
	 * object.
	 */
	default: defaultVersionAccess as VersionAccess,
};

export interface ConfigMigrationOptions {
	readonly codec: ConfigCodec;
	readonly migrations: ReadonlyArray<ConfigFileMigration>;
	readonly versionAccess?: VersionAccess;
}

/**
 * Wraps a {@link ConfigCodec} to apply versioned migrations on parsed data.
 *
 * @remarks
 * Migrations are applied in ascending version order, skipping any that have
 * already been applied (i.e. whose version is not greater than the current
 * version). Each migration's `up` function receives the parsed config and
 * returns the transformed config. After each migration, the version is updated
 * via `VersionAccess.set`.
 *
 * Migration errors are wrapped into {@link CodecError} so that the returned
 * codec satisfies the {@link ConfigCodec} interface.
 *
 * @public
 */
export const ConfigMigration = {
	/**
	 * Create a new {@link ConfigCodec} that applies the given migrations after
	 * parsing.
	 */
	make: (options: ConfigMigrationOptions): ConfigCodec => {
		const access = options.versionAccess ?? VersionAccess.default;
		const sorted = [...options.migrations].sort((a, b) => a.version - b.version);

		return {
			name: options.codec.name,
			extensions: options.codec.extensions,

			parse: (raw: string) =>
				Effect.gen(function* () {
					let parsed = yield* options.codec.parse(raw);
					if (sorted.length === 0) return parsed;

					const currentVersion = yield* access.get(parsed).pipe(
						Effect.mapError(
							(e) =>
								new CodecError({
									codec: options.codec.name,
									operation: "parse",
									reason: `migration version read failed: ${e.reason}`,
								}),
						),
					);

					const pending = sorted.filter((m) => m.version > currentVersion);

					for (const migration of pending) {
						parsed = yield* migration.up(parsed).pipe(
							Effect.mapError(
								(e) =>
									new CodecError({
										codec: options.codec.name,
										operation: "parse",
										reason: `migration "${migration.name}" (v${migration.version}) failed: ${e instanceof ConfigError ? e.reason : String(e)}`,
									}),
							),
						);
						parsed = yield* access.set(parsed, migration.version).pipe(
							Effect.mapError(
								(e) =>
									new CodecError({
										codec: options.codec.name,
										operation: "parse",
										reason: `migration version write failed after "${migration.name}" (v${migration.version}): ${e.reason}`,
									}),
							),
						);
					}

					return parsed;
				}),

			stringify: options.codec.stringify,
		};
	},
};
