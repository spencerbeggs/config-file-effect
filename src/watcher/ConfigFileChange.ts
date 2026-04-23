import type { DateTime, Option } from "effect";

/**
 * Represents a change detected in a watched configuration file.
 *
 * @remarks
 * Emitted by {@link ConfigWatcherService.watch} whenever a polled file
 * differs from its previous value. Both `previous` and `current` are
 * `Option` so the watcher can represent files appearing or disappearing.
 *
 * @public
 */
export interface ConfigFileChange<A> {
	readonly path: string;
	readonly previous: Option.Option<A>;
	readonly current: Option.Option<A>;
	readonly timestamp: DateTime.Utc;
}
