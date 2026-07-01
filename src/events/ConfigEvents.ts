import { Context, Effect, Layer, PubSub } from "effect";
import type { ConfigEvent } from "./ConfigEvent.js";

/**
 * Service shape backing {@link ConfigEvents}: the shared PubSub of
 * {@link ConfigEvent} messages that consumers subscribe to.
 *
 * @public
 */
export interface ConfigEventsService {
	readonly events: PubSub.PubSub<ConfigEvent>;
}

/**
 * Namespace for creating and providing {@link ConfigEventsService} tags and layers.
 *
 * @public
 */
export const ConfigEvents = {
	/**
	 * Creates a unique `Context.Tag` for a {@link ConfigEventsService} instance.
	 */
	Tag: (id: string) => Context.GenericTag<ConfigEventsService>(`config-file-effect/ConfigEvents/${id}`),

	/**
	 * Builds a live {@link ConfigEventsService} layer backed by an unbounded PubSub.
	 */
	Live: (tag: Context.Tag<ConfigEventsService, ConfigEventsService>) =>
		Layer.effect(
			tag,
			Effect.gen(function* () {
				const pubsub = yield* PubSub.unbounded<ConfigEvent>();
				return { events: pubsub };
			}),
		),
};
