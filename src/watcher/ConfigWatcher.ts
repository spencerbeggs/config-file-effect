import { Context, DateTime, Duration, Effect, Layer, Option, Ref, Schedule, Stream } from "effect";
import type { ConfigError } from "../errors/ConfigError.js";
import type { ConfigFileService } from "../services/ConfigFile.js";
import type { ConfigFileChange } from "./ConfigFileChange.js";

/**
 * Options controlling polling behaviour for a {@link ConfigWatcherService}.
 *
 * @public
 */
export interface WatchOptions {
	readonly interval?: Duration.DurationInput;
	readonly signal?: AbortSignal;
}

/**
 * Service that emits a {@link Stream} of {@link ConfigFileChange} events
 * whenever the contents of any watched path differ from the previous poll.
 *
 * @public
 */
export interface ConfigWatcherService<A> {
	readonly watch: (options?: WatchOptions) => Stream.Stream<ConfigFileChange<A>, ConfigError>;
}

/**
 * Factory options for {@link ConfigWatcher.Live}.
 *
 * @public
 */
export interface ConfigWatcherOptions<A> {
	readonly tag: Context.Tag<ConfigWatcherService<A>, ConfigWatcherService<A>>;
	readonly configTag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
	readonly paths: ReadonlyArray<string>;
}

/**
 * Namespace containing factories for creating and providing
 * {@link ConfigWatcherService} instances.
 *
 * @public
 */
export const ConfigWatcher = {
	/**
	 * Creates a unique `Context.Tag` for a {@link ConfigWatcherService} parameterised by `A`.
	 */
	Tag: <A>(id: string) => Context.GenericTag<ConfigWatcherService<A>>(`config-file-effect/ConfigWatcher/${id}`),

	/**
	 * Builds a live {@link ConfigWatcherService} layer that polls each path at the
	 * configured interval and emits {@link ConfigFileChange} events for any diff.
	 *
	 * @remarks
	 * Change detection uses {@link JSON.stringify} for structural equality.
	 * The layer depends on the provided `configTag` being available in the context.
	 */
	Live: <A>(options: ConfigWatcherOptions<A>): Layer.Layer<ConfigWatcherService<A>, never, ConfigFileService<A>> =>
		Layer.effect(
			options.tag,
			Effect.gen(function* () {
				const configService = yield* options.configTag;

				const service: ConfigWatcherService<A> = {
					watch: (watchOptions?: WatchOptions) => {
						const interval = watchOptions?.interval ?? Duration.seconds(5);

						const initState: Effect.Effect<Ref.Ref<Map<string, Option.Option<A>>>, ConfigError> = Effect.gen(
							function* () {
								const initial = new Map<string, Option.Option<A>>();
								for (const path of options.paths) {
									const value = yield* configService.loadFrom(path).pipe(
										Effect.map(Option.some<A>),
										Effect.catchAll(() => Effect.succeed(Option.none<A>())),
									);
									initial.set(path, value);
								}
								return yield* Ref.make(initial);
							},
						);

						const makeStream = (
							stateRef: Ref.Ref<Map<string, Option.Option<A>>>,
						): Stream.Stream<ConfigFileChange<A>, ConfigError> => {
							const pollEffect: Effect.Effect<ReadonlyArray<ConfigFileChange<A>>, ConfigError> = Effect.gen(
								function* () {
									const now = yield* DateTime.now;
									const previousMap = yield* Ref.get(stateRef);
									const changes: Array<ConfigFileChange<A>> = [];

									for (const path of options.paths) {
										const current = yield* configService.loadFrom(path).pipe(
											Effect.map(Option.some<A>),
											Effect.catchAll(() => Effect.succeed(Option.none<A>())),
										);
										const previous = previousMap.get(path) ?? Option.none<A>();
										const prevJson = JSON.stringify(Option.getOrUndefined(previous));
										const currJson = JSON.stringify(Option.getOrUndefined(current));
										if (prevJson !== currJson) {
											changes.push({ path, previous, current, timestamp: now });
										}
									}

									if (changes.length > 0) {
										const nextMap = new Map(previousMap);
										for (const change of changes) {
											nextMap.set(change.path, change.current);
										}
										yield* Ref.set(stateRef, nextMap);
									}

									return changes;
								},
							);

							const pollStream = Stream.repeatEffectWithSchedule(pollEffect, Schedule.spaced(interval));
							return Stream.mapConcat(pollStream, (changes) => changes);
						};

						const baseStream = Stream.fromEffect(initState).pipe(Stream.flatMap(makeStream));

						if (watchOptions?.signal) {
							const abortEffect = Effect.async<never, never>((cb) => {
								watchOptions.signal?.addEventListener("abort", () => cb(Effect.interrupt), { once: true });
							});
							return baseStream.pipe(Stream.interruptWhen(abortEffect));
						}

						return baseStream;
					},
				};

				return service;
			}),
		),
};
