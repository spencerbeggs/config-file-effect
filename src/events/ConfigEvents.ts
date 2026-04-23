import { Context, Effect, Layer, PubSub } from "effect";
import type { ConfigEvent } from "./ConfigEvent.js";

export interface ConfigEventsService {
	readonly events: PubSub.PubSub<ConfigEvent>;
}

export const ConfigEvents = {
	Tag: (id: string) => Context.GenericTag<ConfigEventsService>(`config-file-effect/ConfigEvents/${id}`),

	Live: (tag: Context.Tag<ConfigEventsService, ConfigEventsService>) =>
		Layer.effect(
			tag,
			Effect.gen(function* () {
				const pubsub = yield* PubSub.unbounded<ConfigEvent>();
				return { events: pubsub };
			}),
		),
};
