import { Schema } from "effect";

export const ConfigEventPayload = Schema.Union(
	Schema.TaggedStruct("Discovered", {
		path: Schema.String,
		tier: Schema.String,
	}),
	Schema.TaggedStruct("DiscoveryFailed", {
		tier: Schema.String,
		reason: Schema.String,
	}),
	Schema.TaggedStruct("Resolved", {
		path: Schema.String,
		tier: Schema.String,
		strategy: Schema.String,
	}),
	Schema.TaggedStruct("ResolutionFailed", {
		reason: Schema.String,
	}),
	Schema.TaggedStruct("Parsed", {
		path: Schema.String,
		codec: Schema.String,
	}),
	Schema.TaggedStruct("ParseFailed", {
		path: Schema.String,
		codec: Schema.String,
		reason: Schema.String,
	}),
	Schema.TaggedStruct("Stringified", {
		path: Schema.String,
		codec: Schema.String,
	}),
	Schema.TaggedStruct("StringifyFailed", {
		codec: Schema.String,
		reason: Schema.String,
	}),
	Schema.TaggedStruct("Validated", {
		path: Schema.String,
	}),
	Schema.TaggedStruct("ValidationFailed", {
		path: Schema.String,
		reason: Schema.String,
	}),
	Schema.TaggedStruct("Loaded", {
		path: Schema.String,
	}),
	Schema.TaggedStruct("Saved", {
		path: Schema.String,
	}),
	Schema.TaggedStruct("Updated", {
		path: Schema.String,
	}),
	Schema.TaggedStruct("NotFound", {}),
	Schema.TaggedStruct("Written", {
		path: Schema.String,
	}),
);

export class ConfigEvent extends Schema.Class<ConfigEvent>("ConfigEvent")({
	timestamp: Schema.DateTimeUtc,
	event: ConfigEventPayload,
}) {}
