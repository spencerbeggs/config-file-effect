import type { Effect } from "effect";
import { Context } from "effect";
import type { ConfigError } from "../errors/ConfigError.js";
import type { ConfigFileOptions } from "../layers/ConfigFileLive.js";
import { makeConfigFileLiveImpl } from "../layers/ConfigFileLive.js";
import type { ConfigFileTestOptions } from "../layers/ConfigFileTest.js";
import { ConfigFileTestImpl } from "../layers/ConfigFileTest.js";
import type { ConfigSource } from "../strategies/ConfigWalkStrategy.js";

/**
 * Service interface for loading, discovering, and writing configuration files.
 *
 * @remarks
 * Generic over the configuration value type `A`. Use {@link ConfigFile.Tag}
 * to create a unique `Context.Tag` for each config schema.
 *
 * @public
 */
export interface ConfigFileService<A> {
	readonly load: Effect.Effect<A, ConfigError>;
	readonly loadFrom: (path: string) => Effect.Effect<A, ConfigError>;
	readonly discover: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigError>;
	/** Writes to an explicit path. Parent directory must already exist; use {@link save} for automatic directory creation. */
	readonly write: (value: A, path: string) => Effect.Effect<void, ConfigError>;
	readonly loadOrDefault: (defaultValue: A) => Effect.Effect<A, ConfigError>;
	readonly save: (value: A) => Effect.Effect<string, ConfigError>;
	readonly update: (fn: (current: A) => A, defaultValue?: A) => Effect.Effect<A, ConfigError>;
	readonly validate: (value: unknown) => Effect.Effect<A, ConfigError>;
}

/**
 * Namespace for creating config file service tags and layers.
 *
 * @remarks
 * Because `Context.Tag` does not support type parameters directly, this
 * namespace provides factory methods for creating parameterised tags and layers.
 *
 * @public
 */
export const ConfigFile = {
	/**
	 * Creates a unique `Context.Tag` for a {@link ConfigFileService} parameterised by `A`.
	 */
	Tag: <A>(id: string) => Context.GenericTag<ConfigFileService<A>>(`config-file-effect/ConfigFile/${id}`),

	/**
	 * Builds a live {@link ConfigFileService} layer from codecs, resolvers, and walk strategy.
	 */
	Live: <A>(options: ConfigFileOptions<A>) => makeConfigFileLiveImpl(options),

	/**
	 * Builds a scoped test {@link ConfigFileService} layer that pre-populates files
	 * in a temp directory and cleans up on scope close.
	 */
	Test: <A>(options: ConfigFileTestOptions<A>) => ConfigFileTestImpl(options),
};
