import { FileSystem, Path } from "@effect/platform";
import type { Context } from "effect";
import { Effect, Layer, Option, Schema } from "effect";
import type { ConfigCodec } from "../codecs/ConfigCodec.js";
import { ConfigError } from "../errors/ConfigError.js";
import type { ConfigResolver } from "../resolvers/ConfigResolver.js";
import type { ConfigFileService } from "../services/ConfigFile.js";
import type { ConfigSource, ConfigWalkStrategy } from "../strategies/ConfigWalkStrategy.js";

/**
 * Options for {@link makeConfigFileLive}.
 *
 * @public
 */
export interface ConfigFileOptions<A> {
	readonly tag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
	// biome-ignore lint/suspicious/noExplicitAny: Encoded type varies per schema; `any` allows all Schema.Struct shapes
	readonly schema: Schema.Schema<A, any>;
	readonly codec: ConfigCodec;
	readonly strategy: ConfigWalkStrategy<A>;
	// biome-ignore lint/suspicious/noExplicitAny: resolvers may carry heterogeneous requirements
	readonly resolvers: ReadonlyArray<ConfigResolver<any>>;
	// biome-ignore lint/suspicious/noExplicitAny: defaultPath may carry heterogeneous requirements
	readonly defaultPath?: Effect.Effect<string, ConfigError, any>;
	readonly validate?: (value: A) => Effect.Effect<A, ConfigError>;
}

/**
 * Builds a live {@link ConfigFileService} layer from the provided codecs,
 * resolvers, and walk strategy.
 *
 * @remarks
 * The returned layer requires `FileSystem.FileSystem` which is satisfied by
 * platform-specific layers such as `NodeFileSystem.layer`.
 *
 * @public
 */
export const makeConfigFileLiveImpl = <A>(
	options: ConfigFileOptions<A>,
): Layer.Layer<ConfigFileService<A>, never, FileSystem.FileSystem> =>
	Layer.effect(
		options.tag,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const platformPath = yield* Path.Path;

			const runValidate = (value: A): Effect.Effect<A, ConfigError> =>
				options.validate ? options.validate(value) : Effect.succeed(value);

			const readParseValidate = (path: string): Effect.Effect<A, ConfigError> =>
				Effect.gen(function* () {
					const raw = yield* fs
						.readFileString(path)
						.pipe(Effect.mapError((e) => new ConfigError({ operation: "read", path, reason: String(e) })));
					const parsed = yield* options.codec
						.parse(raw)
						.pipe(Effect.mapError((e) => new ConfigError({ operation: "parse", path, reason: String(e) })));
					const decoded = yield* Schema.decodeUnknown(options.schema)(parsed).pipe(
						Effect.mapError((e) => new ConfigError({ operation: "validate", path, reason: String(e) })),
					);
					return yield* runValidate(decoded);
				});

			const encodeAndWrite = (value: A, path: string): Effect.Effect<void, ConfigError> =>
				Effect.gen(function* () {
					const encoded = yield* Schema.encodeUnknown(options.schema)(value).pipe(
						Effect.mapError((e) => new ConfigError({ operation: "encode", path, reason: String(e) })),
					);
					const serialized = yield* options.codec
						.stringify(encoded)
						.pipe(Effect.mapError((e) => new ConfigError({ operation: "stringify", path, reason: String(e) })));
					yield* fs
						.writeFileString(path, serialized)
						.pipe(Effect.mapError((e) => new ConfigError({ operation: "write", path, reason: String(e) })));
				});

			const discoverSources: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigError> = Effect.gen(function* () {
				const sources: Array<ConfigSource<A>> = [];
				for (const resolver of options.resolvers) {
					const result = yield* Effect.provideService(resolver.resolve, FileSystem.FileSystem, fs) as Effect.Effect<
						Option.Option<string>
					>;
					if (Option.isSome(result)) {
						const path = result.value;
						const value = yield* readParseValidate(path);
						sources.push({ path, tier: resolver.name, value });
					}
				}
				return sources;
			});

			const service: ConfigFileService<A> = {
				load: Effect.flatMap(discoverSources, (sources) => options.strategy.resolve(sources)),
				loadFrom: readParseValidate,
				discover: discoverSources,
				loadOrDefault: (defaultValue: A) =>
					Effect.gen(function* () {
						const sources = yield* discoverSources;
						if (sources.length === 0) {
							return defaultValue;
						}
						return yield* options.strategy.resolve(sources);
					}),
				write: (value: A, path: string) => encodeAndWrite(value, path),
				save: (value: A) =>
					Effect.gen(function* () {
						if (!options.defaultPath) {
							return yield* Effect.fail(
								new ConfigError({
									operation: "save",
									reason: "no default path configured",
								}),
							);
						}
						// Requirements of defaultPath are satisfied at layer construction; cast away R here
						const path = yield* options.defaultPath as Effect.Effect<string, ConfigError>;
						yield* fs
							.makeDirectory(platformPath.dirname(path), { recursive: true })
							.pipe(
								Effect.catchAll((e) => Effect.fail(new ConfigError({ operation: "save", path, reason: String(e) }))),
							);
						yield* encodeAndWrite(value, path);
						return path;
					}),
				update: (fn: (current: A) => A, defaultValue?: A) =>
					Effect.gen(function* () {
						const current =
							defaultValue !== undefined ? yield* service.loadOrDefault(defaultValue) : yield* service.load;
						const updated = fn(current);
						yield* service.save(updated);
						return updated;
					}),
				validate: (value: unknown) =>
					Effect.gen(function* () {
						const decoded = yield* Schema.decodeUnknown(options.schema)(value).pipe(
							Effect.mapError((e) => new ConfigError({ operation: "validate", reason: String(e) })),
						);
						return yield* runValidate(decoded);
					}),
			};
			return service;
		}),
	).pipe(Layer.provide(Path.layer));
