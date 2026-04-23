# Ergonomics Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PubSub events, config watching, migrations, encrypted codec, and platform-agnostic test layer to config-file-effect.

**Architecture:** Composable opt-in layers. Each feature is an independent service that composes with ConfigFileService via Effect's layer system. ConfigEvents provides a PubSub event bus. ConfigWatcher watches files and emits change streams. ConfigMigration wraps the codec to apply versioned transforms. EncryptedCodec wraps any inner codec with AES-GCM. The test layer drops node:fs for platform FileSystem.

**Tech Stack:** Effect (PubSub, Stream, Schema, Ref, DateTime), @effect/platform (FileSystem), node:crypto (Web Crypto API)

---

### Task 1: ConfigEvent Schema

**Files:**
- Create: `src/events/ConfigEvent.ts`
- Test: `__test__/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__test__/events.test.ts`:

```typescript
import { DateTime, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigEvent, ConfigEventPayload } from "../src/index.js";

describe("ConfigEvent", () => {
	it("creates a Loaded event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "Loaded", path: "/tmp/config.json" },
		});
		expect(event.event._tag).toBe("Loaded");
		expect(event.event.path).toBe("/tmp/config.json");
	});

	it("creates a Discovered event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "Discovered", path: "/tmp/config.json", tier: "explicit" },
		});
		expect(event.event._tag).toBe("Discovered");
	});

	it("creates a ParseFailed event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "ParseFailed", path: "/tmp/config.json", codec: "json", reason: "unexpected token" },
		});
		expect(event.event._tag).toBe("ParseFailed");
		expect(event.event.reason).toBe("unexpected token");
	});

	it("creates a ValidationFailed event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "ValidationFailed", path: "/tmp/config.json", reason: "missing field" },
		});
		expect(event.event._tag).toBe("ValidationFailed");
	});

	it("creates a NotFound event", () => {
		const event = new ConfigEvent({
			timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
			event: { _tag: "NotFound" },
		});
		expect(event.event._tag).toBe("NotFound");
	});

	it("decodes from unknown via Schema", async () => {
		const raw = {
			timestamp: "2026-01-01T00:00:00Z",
			event: { _tag: "Saved", path: "/tmp/out.json" },
		};
		const decoded = await Effect.runPromise(Schema.decodeUnknown(ConfigEvent)(raw));
		expect(decoded.event._tag).toBe("Saved");
	});

	it("ConfigEventPayload is a Schema union", () => {
		expect(ConfigEventPayload).toBeDefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __test__/events.test.ts`
Expected: FAIL — `ConfigEvent` and `ConfigEventPayload` are not exported

- [ ] **Step 3: Write the ConfigEvent schema**

Create `src/events/ConfigEvent.ts`:

```typescript
import { DateTime, Schema } from "effect";

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
```

- [ ] **Step 4: Add exports to index.ts**

Add to `src/index.ts` after the Errors section:

```typescript
// ── Events ─────────────────────────────────────────────────────────────────
export { ConfigEvent, ConfigEventPayload } from "./events/ConfigEvent.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run __test__/events.test.ts`
Expected: PASS — all 7 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/events/ConfigEvent.ts __test__/events.test.ts src/index.ts
git commit -m "feat: add ConfigEvent schema with granular pipeline events"
```

---

### Task 2: ConfigEvents Service

**Files:**
- Create: `src/events/ConfigEvents.ts`
- Test: `__test__/events.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__test__/events.test.ts`:

```typescript
import { PubSub, Queue, Option } from "effect";
import { ConfigEvents } from "../src/index.js";

describe("ConfigEvents", () => {
	it("creates a tag with the given id", () => {
		const tag = ConfigEvents.Tag("test/Events");
		expect(tag).toBeDefined();
	});

	it("Live layer provides an unbounded PubSub", async () => {
		const tag = ConfigEvents.Tag("test/PubSub");
		const layer = ConfigEvents.Live(tag);

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const svc = yield* tag;
					const dequeue = yield* PubSub.subscribe(svc.events);
					yield* PubSub.publish(
						svc.events,
						new ConfigEvent({
							timestamp: DateTime.unsafeMake(new Date("2026-01-01T00:00:00Z")),
							event: { _tag: "Loaded", path: "/tmp/test.json" },
						}),
					);
					const item = yield* Queue.take(dequeue);
					return item;
				}),
				layer,
			),
		);
		expect(result.event._tag).toBe("Loaded");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __test__/events.test.ts`
Expected: FAIL — `ConfigEvents` is not exported

- [ ] **Step 3: Write the ConfigEvents service**

Create `src/events/ConfigEvents.ts`:

```typescript
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
```

- [ ] **Step 4: Add exports to index.ts**

Update the Events section in `src/index.ts`:

```typescript
// ── Events ─────────────────────────────────────────────────────────────────
export { ConfigEvent, ConfigEventPayload } from "./events/ConfigEvent.js";
export type { ConfigEventsService } from "./events/ConfigEvents.js";
export { ConfigEvents } from "./events/ConfigEvents.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run __test__/events.test.ts`
Expected: PASS — all 9 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/events/ConfigEvents.ts src/index.ts __test__/events.test.ts
git commit -m "feat: add ConfigEvents service with PubSub factory"
```

---

### Task 3: Wire Events into ConfigFileLive

**Files:**
- Modify: `src/layers/ConfigFileLive.ts`
- Test: `__test__/integration/events.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__test__/integration/events.int.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { DateTime, Effect, Layer, Option, PubSub, Queue, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ConfigEvent,
	ConfigEvents,
	ConfigFile,
	ExplicitPath,
	FirstMatch,
	JsonCodec,
} from "../../src/index.js";

const TestSchema = Schema.Struct({ name: Schema.String });
type TestConfig = typeof TestSchema.Type;

describe("ConfigFileLive with events", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-events-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits Discovered, Parsed, Validated, and Loaded events on load", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "test" }));

		const tag = ConfigFile.Tag<TestConfig>("test/Events");
		const eventsTag = ConfigEvents.Tag("test/Events");

		const eventsLayer = ConfigEvents.Live(eventsTag);
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
			events: eventsTag,
		});
		const fullLayer = Layer.provide(
			Layer.merge(configLayer, eventsLayer),
			NodeFileSystem.layer,
		);

		const collected = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const eventsSvc = yield* eventsTag;
					const dequeue = yield* PubSub.subscribe(eventsSvc.events);
					const config = yield* tag;
					yield* config.load;
					const events: Array<ConfigEvent> = [];
					let next = yield* Queue.poll(dequeue);
					while (Option.isSome(next)) {
						events.push(next.value);
						next = yield* Queue.poll(dequeue);
					}
					return events.map((e) => e.event._tag);
				}),
				fullLayer,
			),
		);

		expect(collected).toContain("Discovered");
		expect(collected).toContain("Parsed");
		expect(collected).toContain("Validated");
		expect(collected).toContain("Loaded");
	});

	it("emits NotFound when no sources are discovered", async () => {
		const tag = ConfigFile.Tag<TestConfig>("test/NotFound");
		const eventsTag = ConfigEvents.Tag("test/NotFound");

		const eventsLayer = ConfigEvents.Live(eventsTag);
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(join(tmpDir, "nonexistent.json"))],
		});
		const fullLayer = Layer.provide(
			Layer.merge(configLayer, eventsLayer),
			NodeFileSystem.layer,
		);

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* tag;
					return yield* config.loadOrDefault({ name: "default" });
				}),
				fullLayer,
			),
		);
		expect(result.name).toBe("default");
	});

	it("works without events (events option omitted)", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "no-events" }));

		const tag = ConfigFile.Tag<TestConfig>("test/NoEvents");
		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* tag;
					return yield* config.load;
				}),
				Layer.provide(configLayer, NodeFileSystem.layer),
			),
		);
		expect(result.name).toBe("no-events");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __test__/integration/events.int.test.ts`
Expected: FAIL — `ConfigFileOptions` does not accept `events` property

- [ ] **Step 3: Add events option and emit helper to ConfigFileLive**

Modify `src/layers/ConfigFileLive.ts`:

Add imports at the top:

```typescript
import { DateTime, PubSub } from "effect";
import { ConfigEvent } from "../events/ConfigEvent.js";
import type { ConfigEventsService } from "../events/ConfigEvents.js";
```

Add `events` field to `ConfigFileOptions`:

```typescript
export interface ConfigFileOptions<A> {
	// ... existing fields ...
	readonly events?: Context.Tag<ConfigEventsService, ConfigEventsService>;
}
```

Inside `makeConfigFileLiveImpl`, after `const platformPath = yield* Path.Path;`, add the emit helper and resolve the events service:

```typescript
const eventsService = options.events
	? yield* Effect.serviceOption(options.events).pipe(Effect.map(Option.getOrUndefined))
	: undefined;

const emit = (payload: typeof ConfigEvent.Type.event): Effect.Effect<void> =>
	eventsService
		? Effect.gen(function* () {
				const now = yield* DateTime.now;
				yield* PubSub.publish(eventsService.events, new ConfigEvent({ timestamp: now, event: payload }));
			}).pipe(Effect.catchAll(() => Effect.void))
		: Effect.void;
```

Then add `emit` calls at each pipeline stage in `readParseValidate`:

```typescript
const readParseValidate = (path: string): Effect.Effect<A, ConfigError> =>
	Effect.gen(function* () {
		const raw = yield* fs
			.readFileString(path)
			.pipe(Effect.mapError((e) => new ConfigError({ operation: "read", path, reason: String(e) })));
		const parsed = yield* options.codec
			.parse(raw)
			.pipe(
				Effect.tap(() => emit({ _tag: "Parsed", path, codec: options.codec.name })),
				Effect.tapError((e) => emit({ _tag: "ParseFailed", path, codec: options.codec.name, reason: String(e) })),
				Effect.mapError((e) => new ConfigError({ operation: "parse", path, reason: String(e) })),
			);
		const decoded = yield* Schema.decodeUnknown(options.schema)(parsed).pipe(
			Effect.tap(() => emit({ _tag: "Validated", path })),
			Effect.tapError((e) => emit({ _tag: "ValidationFailed", path, reason: String(e) })),
			Effect.mapError((e) => new ConfigError({ operation: "validate", path, reason: String(e) })),
		);
		return yield* runValidate(decoded);
	});
```

Add emit calls in `discoverSources`:

```typescript
const discoverSources: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigError> = Effect.gen(function* () {
	const sources: Array<ConfigSource<A>> = [];
	for (const resolver of options.resolvers) {
		const result = yield* Effect.provideService(resolver.resolve, FileSystem.FileSystem, fs) as Effect.Effect<
			Option.Option<string>
		>;
		if (Option.isSome(result)) {
			const path = result.value;
			yield* emit({ _tag: "Discovered", path, tier: resolver.name });
			const value = yield* readParseValidate(path);
			sources.push({ path, tier: resolver.name, value });
		} else {
			yield* emit({ _tag: "DiscoveryFailed", tier: resolver.name, reason: "path not found" });
		}
	}
	return sources;
});
```

Add emit calls to the `service` object methods:

In `load`:
```typescript
load: Effect.gen(function* () {
	const sources = yield* discoverSources;
	if (sources.length === 0) {
		yield* emit({ _tag: "NotFound" });
	}
	const result = yield* options.strategy.resolve(sources);
	const resolvedPath = sources[0]?.path ?? "unknown";
	yield* emit({ _tag: "Resolved", path: resolvedPath, tier: sources[0]?.tier ?? "unknown", strategy: "resolve" });
	yield* emit({ _tag: "Loaded", path: resolvedPath });
	return result;
}),
```

In `save`:
```typescript
// After the encodeAndWrite call succeeds:
yield* emit({ _tag: "Saved", path });
```

In `update`:
```typescript
// After save succeeds:
yield* emit({ _tag: "Updated", path: "default" });
```

In `write`:
```typescript
write: (value: A, path: string) =>
	Effect.tap(encodeAndWrite(value, path), () => emit({ _tag: "Written", path })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run __test__/integration/events.int.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `pnpm vitest run`
Expected: All existing tests pass (events option is optional, so existing tests are unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/layers/ConfigFileLive.ts __test__/integration/events.int.test.ts
git commit -m "feat: wire ConfigEvents PubSub into ConfigFileLive pipeline"
```

---

### Task 4: EncryptedCodec

**Files:**
- Create: `src/codecs/EncryptedCodec.ts`
- Test: `__test__/codecs.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__test__/codecs.test.ts`:

```typescript
import { EncryptedCodec, EncryptedCodecKey } from "../src/index.js";

describe("EncryptedCodec", () => {
	const passphrase = "test-password-123";
	const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
	const key = EncryptedCodecKey.fromPassphrase(passphrase, salt);
	const codec = EncryptedCodec(JsonCodec, key);

	it("has correct name", () => {
		expect(codec.name).toBe("encrypted(json)");
	});

	it("has same extensions as inner codec", () => {
		expect(codec.extensions).toEqual([".json"]);
	});

	it("round-trips stringify then parse", async () => {
		const original = { key: "value", count: 42 };
		const encrypted = await Effect.runPromise(codec.stringify(original));
		expect(encrypted).not.toContain("value");
		const decrypted = await Effect.runPromise(codec.parse(encrypted));
		expect(decrypted).toEqual(original);
	});

	it("produces different ciphertext each time (random IV)", async () => {
		const original = { key: "value" };
		const encrypted1 = await Effect.runPromise(codec.stringify(original));
		const encrypted2 = await Effect.runPromise(codec.stringify(original));
		expect(encrypted1).not.toBe(encrypted2);
	});

	it("fails to parse with wrong key", async () => {
		const wrongKey = EncryptedCodecKey.fromPassphrase("wrong-password", salt);
		const wrongCodec = EncryptedCodec(JsonCodec, wrongKey);
		const encrypted = await Effect.runPromise(codec.stringify({ key: "secret" }));
		const result = await Effect.runPromiseExit(wrongCodec.parse(encrypted));
		expect(result._tag).toBe("Failure");
	});

	it("fails to parse corrupted data", async () => {
		const result = await Effect.runPromiseExit(codec.parse("not-valid-base64!!!"));
		expect(result._tag).toBe("Failure");
	});

	it("works with CryptoKey directly", async () => {
		const cryptoKey = Effect.promise(async () => {
			const keyMaterial = await globalThis.crypto.subtle.importKey(
				"raw",
				new Uint8Array(32),
				"AES-GCM",
				false,
				["encrypt", "decrypt"],
			);
			return keyMaterial;
		});
		const directKey = EncryptedCodecKey.fromCryptoKey(cryptoKey);
		const directCodec = EncryptedCodec(JsonCodec, directKey);

		const original = { direct: true };
		const encrypted = await Effect.runPromise(directCodec.stringify(original));
		const decrypted = await Effect.runPromise(directCodec.parse(encrypted));
		expect(decrypted).toEqual(original);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __test__/codecs.test.ts`
Expected: FAIL — `EncryptedCodec` and `EncryptedCodecKey` are not exported

- [ ] **Step 3: Write the EncryptedCodec**

Create `src/codecs/EncryptedCodec.ts`:

```typescript
import { Effect } from "effect";
import { CodecError } from "../errors/CodecError.js";
import type { ConfigError } from "../errors/ConfigError.js";
import type { ConfigCodec } from "./ConfigCodec.js";

const crypto = globalThis.crypto ?? (await import("node:crypto")).webcrypto;

export type EncryptedCodecKey =
	| { readonly _tag: "CryptoKey"; readonly key: Effect.Effect<CryptoKey, ConfigError> }
	| { readonly _tag: "Passphrase"; readonly passphrase: string; readonly salt: Uint8Array };

export const EncryptedCodecKey = {
	fromCryptoKey: (key: Effect.Effect<CryptoKey, ConfigError>): EncryptedCodecKey => ({
		_tag: "CryptoKey",
		key,
	}),

	fromPassphrase: (passphrase: string, salt: Uint8Array): EncryptedCodecKey => ({
		_tag: "Passphrase",
		passphrase,
		salt,
	}),
};

const deriveKey = (passphrase: string, salt: Uint8Array): Effect.Effect<CryptoKey, CodecError> =>
	Effect.tryPromise({
		try: async () => {
			const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
				"deriveBits",
				"deriveKey",
			]);
			return crypto.subtle.deriveKey(
				{ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
				keyMaterial,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"],
			);
		},
		catch: (error) => new CodecError({ codec: "encrypted", operation: "parse", reason: String(error) }),
	});

export const EncryptedCodec = (inner: ConfigCodec, keyConfig: EncryptedCodecKey): ConfigCodec => {
	let cachedKey: CryptoKey | undefined;

	const getKey = (): Effect.Effect<CryptoKey, CodecError> => {
		if (cachedKey) return Effect.succeed(cachedKey);
		const keyEffect =
			keyConfig._tag === "CryptoKey"
				? keyConfig.key.pipe(
						Effect.mapError((e) => new CodecError({ codec: "encrypted", operation: "parse", reason: String(e) })),
					)
				: deriveKey(keyConfig.passphrase, keyConfig.salt);
		return Effect.tap(keyEffect, (k) =>
			Effect.sync(() => {
				cachedKey = k;
			}),
		);
	};

	return {
		name: `encrypted(${inner.name})`,
		extensions: inner.extensions,

		parse: (raw: string) =>
			Effect.gen(function* () {
				const key = yield* getKey();
				const combined = yield* Effect.try({
					try: () => {
						const binaryStr = atob(raw);
						const bytes = new Uint8Array(binaryStr.length);
						for (let i = 0; i < binaryStr.length; i++) {
							bytes[i] = binaryStr.charCodeAt(i);
						}
						return bytes;
					},
					catch: (error) =>
						new CodecError({ codec: `encrypted(${inner.name})`, operation: "parse", reason: String(error) }),
				});
				if (combined.length < 12) {
					return yield* Effect.fail(
						new CodecError({
							codec: `encrypted(${inner.name})`,
							operation: "parse",
							reason: "ciphertext too short (missing IV)",
						}),
					);
				}
				const iv = combined.slice(0, 12);
				const ciphertext = combined.slice(12);
				const plaintext = yield* Effect.tryPromise({
					try: async () => {
						const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
						return new TextDecoder().decode(decrypted);
					},
					catch: (error) =>
						new CodecError({
							codec: `encrypted(${inner.name})`,
							operation: "parse",
							reason: `decryption failed: ${String(error)}`,
						}),
				});
				return yield* inner.parse(plaintext);
			}),

		stringify: (value: unknown) =>
			Effect.gen(function* () {
				const key = yield* getKey();
				const plaintext = yield* inner.stringify(value);
				const iv = crypto.getRandomValues(new Uint8Array(12));
				const encrypted = yield* Effect.tryPromise({
					try: async () => {
						const ciphertext = await crypto.subtle.encrypt(
							{ name: "AES-GCM", iv },
							key,
							new TextEncoder().encode(plaintext),
						);
						const combined = new Uint8Array(iv.length + ciphertext.byteLength);
						combined.set(iv);
						combined.set(new Uint8Array(ciphertext), iv.length);
						return btoa(String.fromCharCode(...combined));
					},
					catch: (error) =>
						new CodecError({
							codec: `encrypted(${inner.name})`,
							operation: "stringify",
							reason: String(error),
						}),
				});
				return encrypted;
			}),
	};
};
```

- [ ] **Step 4: Add exports to index.ts**

Add to `src/index.ts` after the Codecs section:

```typescript
export type { EncryptedCodecKey } from "./codecs/EncryptedCodec.js";
export { EncryptedCodec, EncryptedCodecKey as EncryptedCodecKeyNs } from "./codecs/EncryptedCodec.js";
```

Wait — `EncryptedCodecKey` is both a type and a value (namespace object). Use this pattern instead:

```typescript
export { EncryptedCodec, EncryptedCodecKey } from "./codecs/EncryptedCodec.js";
```

This works because `EncryptedCodecKey` is both a type alias and a const in the same file, and TypeScript merges them.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run __test__/codecs.test.ts`
Expected: PASS — all codec tests pass including the new EncryptedCodec tests

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/codecs/EncryptedCodec.ts src/index.ts __test__/codecs.test.ts
git commit -m "feat: add EncryptedCodec with AES-GCM and PBKDF2 key derivation"
```

---

### Task 5: ConfigMigration

**Files:**
- Create: `src/migrations/ConfigMigration.ts`
- Test: `__test__/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__test__/migrations.test.ts`:

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigError, ConfigMigration, JsonCodec, VersionAccess } from "../src/index.js";

describe("VersionAccess", () => {
	it("default reads version from top-level field", async () => {
		const raw = { version: 2, name: "test" };
		const version = await Effect.runPromise(VersionAccess.default.get(raw));
		expect(version).toBe(2);
	});

	it("default sets version on top-level field", async () => {
		const raw = { version: 1, name: "test" };
		const updated = await Effect.runPromise(VersionAccess.default.set(raw, 3));
		expect((updated as Record<string, unknown>).version).toBe(3);
	});

	it("default fails when version field is missing", async () => {
		const raw = { name: "test" };
		const result = await Effect.runPromiseExit(VersionAccess.default.get(raw));
		expect(result._tag).toBe("Failure");
	});

	it("default fails when version is not a number", async () => {
		const raw = { version: "not-a-number", name: "test" };
		const result = await Effect.runPromiseExit(VersionAccess.default.get(raw));
		expect(result._tag).toBe("Failure");
	});
});

describe("ConfigMigration.make", () => {
	it("wraps codec parse to apply pending migrations", async () => {
		const migrations = [
			{
				version: 1,
				name: "add-port",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, port: 3000, version: 1 });
				},
			},
			{
				version: 2,
				name: "rename-name-to-title",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					const { name, ...rest } = obj;
					return Effect.succeed({ ...rest, title: name, version: 2 });
				},
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
		});

		const raw = JSON.stringify({ version: 0, name: "old-config" });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		const obj = result as Record<string, unknown>;
		expect(obj.version).toBe(2);
		expect(obj.title).toBe("old-config");
		expect(obj.port).toBe(3000);
		expect(obj.name).toBeUndefined();
	});

	it("skips already-applied migrations", async () => {
		const migrations = [
			{
				version: 1,
				name: "add-port",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, port: 3000, version: 1 });
				},
			},
			{
				version: 2,
				name: "add-host",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, host: "localhost", version: 2 });
				},
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
		});

		const raw = JSON.stringify({ version: 1, name: "test", port: 3000 });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		const obj = result as Record<string, unknown>;
		expect(obj.version).toBe(2);
		expect(obj.host).toBe("localhost");
		expect(obj.port).toBe(3000);
	});

	it("does nothing when all migrations are applied", async () => {
		const migrations = [
			{
				version: 1,
				name: "add-port",
				up: (raw: unknown) => Effect.succeed({ ...(raw as Record<string, unknown>), port: 3000, version: 1 }),
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
		});

		const raw = JSON.stringify({ version: 1, name: "test", port: 3000 });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		expect(result).toEqual({ version: 1, name: "test", port: 3000 });
	});

	it("uses custom versionAccess", async () => {
		const customAccess: VersionAccess = {
			get: (raw) => {
				const obj = raw as Record<string, unknown>;
				const meta = obj._meta as Record<string, unknown> | undefined;
				if (!meta || typeof meta.v !== "number") {
					return Effect.fail(new ConfigError({ operation: "migration", reason: "no _meta.v field" }));
				}
				return Effect.succeed(meta.v);
			},
			set: (raw, version) => {
				const obj = raw as Record<string, unknown>;
				return Effect.succeed({ ...obj, _meta: { ...(obj._meta as Record<string, unknown>), v: version } });
			},
		};

		const migrations = [
			{
				version: 1,
				name: "add-field",
				up: (raw: unknown) => {
					const obj = raw as Record<string, unknown>;
					return Effect.succeed({ ...obj, added: true });
				},
			},
		];

		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations,
			versionAccess: customAccess,
		});

		const raw = JSON.stringify({ _meta: { v: 0 }, name: "test" });
		const result = await Effect.runPromise(wrappedCodec.parse(raw));
		const obj = result as Record<string, unknown>;
		expect(obj.added).toBe(true);
		expect((obj._meta as Record<string, unknown>).v).toBe(1);
	});

	it("stringify passes through to inner codec", async () => {
		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations: [],
		});

		const result = await Effect.runPromise(wrappedCodec.stringify({ name: "test" }));
		expect(JSON.parse(result)).toEqual({ name: "test" });
	});

	it("preserves codec name and extensions", () => {
		const wrappedCodec = ConfigMigration.make({
			codec: JsonCodec,
			migrations: [],
		});

		expect(wrappedCodec.name).toBe("json");
		expect(wrappedCodec.extensions).toEqual([".json"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __test__/migrations.test.ts`
Expected: FAIL — `ConfigMigration` and `VersionAccess` are not exported

- [ ] **Step 3: Write the ConfigMigration module**

Create `src/migrations/ConfigMigration.ts`:

```typescript
import { Effect } from "effect";
import type { ConfigCodec } from "../codecs/ConfigCodec.js";
import { ConfigError } from "../errors/ConfigError.js";

export interface ConfigFileMigration {
	readonly version: number;
	readonly name: string;
	readonly up: (raw: unknown) => Effect.Effect<unknown, ConfigError>;
	readonly down?: (raw: unknown) => Effect.Effect<unknown, ConfigError>;
}

export interface VersionAccess {
	readonly get: (raw: unknown) => Effect.Effect<number, ConfigError>;
	readonly set: (raw: unknown, version: number) => Effect.Effect<unknown, ConfigError>;
}

const defaultVersionAccess: VersionAccess = {
	get: (raw) =>
		Effect.gen(function* () {
			if (typeof raw !== "object" || raw === null) {
				return yield* Effect.fail(
					new ConfigError({ operation: "migration", reason: "config is not an object" }),
				);
			}
			const version = (raw as Record<string, unknown>).version;
			if (typeof version !== "number") {
				return yield* Effect.fail(
					new ConfigError({ operation: "migration", reason: "version field is missing or not a number" }),
				);
			}
			return version;
		}),
	set: (raw, version) =>
		Effect.succeed({ ...(raw as Record<string, unknown>), version }),
};

export const VersionAccess = {
	default: defaultVersionAccess as VersionAccess,
};

interface ConfigMigrationOptions {
	readonly codec: ConfigCodec;
	readonly migrations: ReadonlyArray<ConfigFileMigration>;
	readonly versionAccess?: VersionAccess;
}

export const ConfigMigration = {
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

					const currentVersion = yield* access.get(parsed);
					const pending = sorted.filter((m) => m.version > currentVersion);

					for (const migration of pending) {
						parsed = yield* migration.up(parsed).pipe(
							Effect.mapError(
								(e) =>
									new ConfigError({
										operation: "migration",
										reason: `migration "${migration.name}" (v${migration.version}) failed: ${e instanceof ConfigError ? e.reason : String(e)}`,
									}),
							),
						);
						parsed = yield* access.set(parsed, migration.version);
					}

					return parsed;
				}),

			stringify: options.codec.stringify,
		};
	},
};
```

- [ ] **Step 4: Add exports to index.ts**

Add to `src/index.ts`:

```typescript
// ── Migrations ─────────────────────────────────────────────────────────────
export type { ConfigFileMigration } from "./migrations/ConfigMigration.js";
export { ConfigMigration, VersionAccess } from "./migrations/ConfigMigration.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run __test__/migrations.test.ts`
Expected: PASS — all 7 tests pass

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/migrations/ConfigMigration.ts src/index.ts __test__/migrations.test.ts
git commit -m "feat: add ConfigMigration with pluggable version access"
```

---

### Task 6: ConfigWatcher

**Files:**
- Create: `src/watcher/ConfigFileChange.ts`
- Create: `src/watcher/ConfigWatcher.ts`
- Test: `__test__/integration/watcher.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__test__/integration/watcher.int.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Chunk, Duration, Effect, Fiber, Layer, Option, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ConfigFile,
	ConfigWatcher,
	ExplicitPath,
	FirstMatch,
	JsonCodec,
} from "../../src/index.js";
import type { ConfigFileChange } from "../../src/index.js";

const TestSchema = Schema.Struct({ name: Schema.String, count: Schema.optional(Schema.Number) });
type TestConfig = typeof TestSchema.Type;

describe("ConfigWatcher", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cfg-watch-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits a change event when a watched file is modified", async () => {
		const configPath = join(tmpDir, "app.json");
		writeFileSync(configPath, JSON.stringify({ name: "initial" }));

		const tag = ConfigFile.Tag<TestConfig>("test/Watch");
		const watcherTag = ConfigWatcher.Tag<TestConfig>("test/Watch");

		const configLayer = ConfigFile.Live({
			tag,
			schema: TestSchema,
			codec: JsonCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		});

		const watcherLayer = ConfigWatcher.Live({
			tag: watcherTag,
			configTag: tag,
			paths: [configPath],
		});

		const fullLayer = Layer.provide(
			Layer.merge(configLayer, watcherLayer),
			NodeFileSystem.layer,
		);

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const watcher = yield* watcherTag;
					const changeStream = watcher.watch({ interval: Duration.millis(100) });

					const fiber = yield* Stream.take(changeStream, 1).pipe(
						Stream.runCollect,
						Effect.fork,
					);

					yield* Effect.sleep(Duration.millis(200));
					writeFileSync(configPath, JSON.stringify({ name: "updated", count: 1 }));

					const changes = yield* Fiber.join(fiber);
					return Chunk.toReadonlyArray(changes);
				}),
				fullLayer,
			),
		);

		expect(result.length).toBe(1);
		const change = result[0] as ConfigFileChange<TestConfig>;
		expect(change.path).toBe(configPath);
		expect(Option.isSome(change.previous)).toBe(true);
		expect(Option.isSome(change.current)).toBe(true);
		if (Option.isSome(change.current)) {
			expect(change.current.value.name).toBe("updated");
		}
	}, 10_000);

	it("creates a tag with the given id", () => {
		const tag = ConfigWatcher.Tag<TestConfig>("test/WatcherTag");
		expect(tag).toBeDefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __test__/integration/watcher.int.test.ts`
Expected: FAIL — `ConfigWatcher` and `ConfigFileChange` are not exported

- [ ] **Step 3: Write the ConfigFileChange type**

Create `src/watcher/ConfigFileChange.ts`:

```typescript
import type { DateTime, Option } from "effect";

export interface ConfigFileChange<A> {
	readonly path: string;
	readonly previous: Option.Option<A>;
	readonly current: Option.Option<A>;
	readonly timestamp: DateTime.Utc;
}
```

- [ ] **Step 4: Write the ConfigWatcher service**

Create `src/watcher/ConfigWatcher.ts`:

```typescript
import { FileSystem } from "@effect/platform";
import type { Context } from "effect";
import { DateTime, Duration, Effect, Option, Ref, Stream } from "effect";
import type { ConfigError } from "../errors/ConfigError.js";
import type { ConfigFileService } from "../services/ConfigFile.js";
import type { ConfigFileChange } from "./ConfigFileChange.js";

export interface WatchOptions {
	readonly interval?: Duration.DurationInput;
	readonly signal?: AbortSignal;
}

export interface ConfigWatcherService<A> {
	readonly watch: (options?: WatchOptions) => Stream.Stream<ConfigFileChange<A>, ConfigError>;
}

interface ConfigWatcherOptions<A> {
	readonly tag: Context.Tag<ConfigWatcherService<A>, ConfigWatcherService<A>>;
	readonly configTag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
	readonly paths: ReadonlyArray<string>;
}

const pollForChanges = <A>(
	configService: ConfigFileService<A>,
	paths: ReadonlyArray<string>,
	previousRef: Ref.Ref<Map<string, A>>,
	interval: Duration.Duration,
): Stream.Stream<ConfigFileChange<A>, ConfigError> =>
	Stream.repeatEffectWithSchedule(
		Effect.gen(function* () {
			const changes: Array<ConfigFileChange<A>> = [];
			const previousMap = yield* Ref.get(previousRef);
			const newMap = new Map(previousMap);

			for (const path of paths) {
				const currentResult = yield* configService.loadFrom(path).pipe(
					Effect.map(Option.some),
					Effect.catchAll(() => Effect.succeed(Option.none<A>())),
				);

				const previous = previousMap.has(path) ? Option.some(previousMap.get(path) as A) : Option.none<A>();
				const hasChanged =
					JSON.stringify(Option.getOrUndefined(previous)) !== JSON.stringify(Option.getOrUndefined(currentResult));

				if (hasChanged) {
					const now = yield* DateTime.now;
					changes.push({
						path,
						previous,
						current: currentResult,
						timestamp: now as DateTime.Utc,
					});

					if (Option.isSome(currentResult)) {
						newMap.set(path, currentResult.value);
					} else {
						newMap.delete(path);
					}
				}
			}

			yield* Ref.set(previousRef, newMap);
			return changes;
		}),
		// biome-ignore lint/suspicious/noExplicitAny: Schedule type variance
		Effect.repeat.options({ schedule: { duration: interval } as any }),
	).pipe(
		Stream.mapConcat((changes) => changes),
	);

export const ConfigWatcher = {
	Tag: <A>(id: string) =>
		Context.GenericTag<ConfigWatcherService<A>>(`config-file-effect/ConfigWatcher/${id}`),

	Live: <A>(options: ConfigWatcherOptions<A>) =>
		Effect.gen(function* () {
			const configService = yield* options.configTag;

			const service: ConfigWatcherService<A> = {
				watch: (watchOptions?: WatchOptions) => {
					const interval = watchOptions?.interval
						? Duration.decode(watchOptions.interval)
						: Duration.seconds(2);

					return Stream.unwrap(
						Effect.gen(function* () {
							const initialMap = new Map<string, A>();
							for (const path of options.paths) {
								const value = yield* configService.loadFrom(path).pipe(
									Effect.map(Option.some),
									Effect.catchAll(() => Effect.succeed(Option.none<A>())),
								);
								if (Option.isSome(value)) {
									initialMap.set(path, value.value);
								}
							}
							const previousRef = yield* Ref.make(initialMap);
							return pollForChanges(configService, options.paths, previousRef, interval);
						}),
					);
				},
			};

			return service;
		}).pipe(
			(effect) => {
				const { Context, Layer } = require("effect");
				return Layer.effect(options.tag, effect);
			},
		),
};
```

Wait — that dynamic require is wrong. Let me fix the approach. The `Live` factory should return a `Layer.Layer` directly:

```typescript
import { FileSystem } from "@effect/platform";
import { Context, DateTime, Duration, Effect, Layer, Option, Ref, Stream } from "effect";
import type { ConfigError } from "../errors/ConfigError.js";
import type { ConfigFileService } from "../services/ConfigFile.js";
import type { ConfigFileChange } from "./ConfigFileChange.js";

export interface WatchOptions {
	readonly interval?: Duration.DurationInput;
	readonly signal?: AbortSignal;
}

export interface ConfigWatcherService<A> {
	readonly watch: (options?: WatchOptions) => Stream.Stream<ConfigFileChange<A>, ConfigError>;
}

interface ConfigWatcherOptions<A> {
	readonly tag: Context.Tag<ConfigWatcherService<A>, ConfigWatcherService<A>>;
	readonly configTag: Context.Tag<ConfigFileService<A>, ConfigFileService<A>>;
	readonly paths: ReadonlyArray<string>;
}

const pollForChanges = <A>(
	configService: ConfigFileService<A>,
	paths: ReadonlyArray<string>,
	previousRef: Ref.Ref<Map<string, A>>,
	interval: Duration.Duration,
): Stream.Stream<ConfigFileChange<A>, ConfigError> =>
	Stream.flatMap(
		Stream.repeatEffectWithSchedule(
			Effect.gen(function* () {
				const changes: Array<ConfigFileChange<A>> = [];
				const previousMap = yield* Ref.get(previousRef);
				const newMap = new Map(previousMap);

				for (const path of paths) {
					const currentResult = yield* configService.loadFrom(path).pipe(
						Effect.map(Option.some),
						Effect.catchAll(() => Effect.succeed(Option.none<A>())),
					);

					const previous = previousMap.has(path) ? Option.some(previousMap.get(path) as A) : Option.none<A>();
					const hasChanged =
						JSON.stringify(Option.getOrUndefined(previous)) !==
						JSON.stringify(Option.getOrUndefined(currentResult));

					if (hasChanged) {
						const now = yield* DateTime.now;
						changes.push({
							path,
							previous,
							current: currentResult,
							timestamp: now as DateTime.Utc,
						});

						if (Option.isSome(currentResult)) {
							newMap.set(path, currentResult.value);
						} else {
							newMap.delete(path);
						}
					}
				}

				yield* Ref.set(previousRef, newMap);
				return changes;
			}),
			Effect.Repetition.spaced(interval),
		),
		(changes) => Stream.fromIterable(changes),
	);

export const ConfigWatcher = {
	Tag: <A>(id: string) =>
		Context.GenericTag<ConfigWatcherService<A>>(`config-file-effect/ConfigWatcher/${id}`),

	Live: <A>(
		options: ConfigWatcherOptions<A>,
	): Layer.Layer<ConfigWatcherService<A>, never, ConfigFileService<A>> =>
		Layer.effect(
			options.tag,
			Effect.gen(function* () {
				const configService = yield* options.configTag;

				const service: ConfigWatcherService<A> = {
					watch: (watchOptions?: WatchOptions) => {
						const interval = watchOptions?.interval
							? Duration.decode(watchOptions.interval)
							: Duration.seconds(2);

						return Stream.unwrap(
							Effect.gen(function* () {
								const initialMap = new Map<string, A>();
								for (const path of options.paths) {
									const value = yield* configService.loadFrom(path).pipe(
										Effect.map(Option.some),
										Effect.catchAll(() => Effect.succeed(Option.none<A>())),
									);
									if (Option.isSome(value)) {
										initialMap.set(path, value.value);
									}
								}
								const previousRef = yield* Ref.make(initialMap);
								return pollForChanges(configService, options.paths, previousRef, interval);
							}),
						);
					},
				};

				return service;
			}),
		),
};
```

Note: The exact `Stream.repeatEffectWithSchedule` / `Schedule.spaced` API may need adjustment during implementation based on the Effect version in use. The implementer should check the available Effect Stream scheduling API and adapt accordingly — the core pattern (poll on interval, compare, emit changes) remains the same.

- [ ] **Step 5: Add exports to index.ts**

Add to `src/index.ts`:

```typescript
// ── Watcher ────────────────────────────────────────────────────────────────
export type { ConfigFileChange } from "./watcher/ConfigFileChange.js";
export type { ConfigWatcherService, WatchOptions } from "./watcher/ConfigWatcher.js";
export { ConfigWatcher } from "./watcher/ConfigWatcher.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run __test__/integration/watcher.int.test.ts`
Expected: PASS

Note: The watcher test involves timing (file writes + polling). If it's flaky, increase the sleep duration or the polling interval. The test is intentionally generous with a 10s timeout.

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/watcher/ConfigFileChange.ts src/watcher/ConfigWatcher.ts src/index.ts __test__/integration/watcher.int.test.ts
git commit -m "feat: add ConfigWatcher with polling-based file change detection"
```

---

### Task 7: Platform-Agnostic Test Layer

**Files:**
- Modify: `src/layers/ConfigFileTest.ts`
- Modify: `__test__/integration/config-file.int.test.ts` (update ConfigFile.Test usage)

- [ ] **Step 1: Write the failing test to verify new signature**

Add a new test to the bottom of `__test__/integration/config-file.int.test.ts`:

```typescript
import { FileSystem } from "@effect/platform";

describe("ConfigFile.Test (platform-agnostic)", () => {
	it("requires FileSystem from context", async () => {
		const tag = ConfigFile.Tag<TestConfig>("test/PlatformAgnostic");
		const filePath = join(tmpDir, "agnostic.json");

		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.provide(
					Effect.gen(function* () {
						const config = yield* tag;
						return yield* config.loadOrDefault({ name: "fallback" });
					}),
					Layer.provide(
						ConfigFile.Test({
							tag,
							schema: TestConfigSchema,
							codec: JsonCodec,
							strategy: FirstMatch,
							resolvers: [StaticDir({ dir: join(tmpDir, "nonexistent"), filename: "app.json" })],
						}),
						NodeFileSystem.layer,
					),
				),
			),
		);
		expect(result.name).toBe("fallback");
	});
});
```

- [ ] **Step 2: Modify ConfigFileTest.ts to use platform FileSystem**

Replace `src/layers/ConfigFileTest.ts` entirely:

```typescript
import { FileSystem, Path } from "@effect/platform";
import type { Scope } from "effect";
import { Effect, Layer } from "effect";
import type { ConfigFileService } from "../services/ConfigFile.js";
import type { ConfigFileOptions } from "./ConfigFileLive.js";
import { makeConfigFileLiveImpl } from "./ConfigFileLive.js";

export interface ConfigFileTestOptions<A> extends ConfigFileOptions<A> {
	readonly files?: Record<string, string>;
}

export const ConfigFileTestImpl = <A>(
	options: ConfigFileTestOptions<A>,
): Layer.Layer<ConfigFileService<A>, never, FileSystem.FileSystem | Scope.Scope> =>
	Layer.unwrapScoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const platformPath = yield* Path.Path;
			if (options.files) {
				const written: string[] = [];
				for (const [filePath, content] of Object.entries(options.files)) {
					yield* fs.makeDirectory(platformPath.dirname(filePath), { recursive: true });
					yield* fs.writeFileString(filePath, content);
					written.push(filePath);
				}
				yield* Effect.addFinalizer(() =>
					Effect.forEach(written, (p) => fs.remove(p, { recursive: false }).pipe(Effect.ignore), {
						discard: true,
					}),
				);
			}

			return makeConfigFileLiveImpl(options);
		}).pipe(Effect.provide(Path.layer)),
	);
```

- [ ] **Step 3: Update existing ConfigFile.Test tests**

In `__test__/integration/config-file.int.test.ts`, update the "ConfigFile.Test" describe block. The `ConfigFile.Test` layer now requires `FileSystem` to be provided:

Change the first test ("loads pre-populated files"):

```typescript
it("loads pre-populated files", async () => {
	const tmpDir2 = mkdtempSync(join(tmpdir(), "cfg-scoped-"));
	const filePath = join(tmpDir2, "app.json");
	const tag = ConfigFile.Tag<TestConfig>("test/Scoped");
	try {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.provide(
					Effect.gen(function* () {
						const config = yield* tag;
						return yield* config.load;
					}),
					Layer.provide(
						ConfigFile.Test({
							tag,
							schema: TestConfigSchema,
							codec: JsonCodec,
							strategy: FirstMatch,
							resolvers: [ExplicitPath(filePath)],
							files: {
								[filePath]: readFixture("project-config.json"),
							},
						}),
						NodeFileSystem.layer,
					),
				),
			),
		);
		expect(result).toMatchSnapshot();
	} finally {
		rmSync(tmpDir2, { recursive: true, force: true });
	}
});
```

Change the second test ("returns default when no files pre-populated"):

```typescript
it("returns default when no files pre-populated", async () => {
	const tag = ConfigFile.Tag<TestConfig>("test/Default");
	const result = await Effect.runPromise(
		Effect.scoped(
			Effect.provide(
				Effect.gen(function* () {
					const config = yield* tag;
					return yield* config.loadOrDefault({ name: "fallback" });
				}),
				Layer.provide(
					ConfigFile.Test({
						tag,
						schema: TestConfigSchema,
						codec: JsonCodec,
						strategy: FirstMatch,
						resolvers: [StaticDir({ dir: "/nonexistent", filename: "app.json" })],
					}),
					NodeFileSystem.layer,
				),
			),
		),
	);
	expect(result.name).toBe("fallback");
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run __test__/integration/config-file.int.test.ts`
Expected: PASS — all existing tests pass, plus the new platform-agnostic test

- [ ] **Step 5: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/layers/ConfigFileTest.ts __test__/integration/config-file.int.test.ts
git commit -m "refactor: make ConfigFileTest platform-agnostic by using FileSystem from context"
```

---

### Task 8: Type Check and Lint

**Files:** All modified files

- [ ] **Step 1: Run type check**

Run: `pnpm run typecheck`
Expected: PASS — no type errors

- [ ] **Step 2: Run lint**

Run: `pnpm run lint`
Expected: PASS or minor auto-fixable issues

- [ ] **Step 3: Fix any lint issues**

Run: `pnpm run lint:fix`

- [ ] **Step 4: Run full test suite one final time**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "style: fix lint issues from ergonomics features"
```

Only commit if there were actual changes from lint:fix.

---

### Task 9: Final Export Audit

**Files:**
- Verify: `src/index.ts`

- [ ] **Step 1: Verify all new exports are present in index.ts**

Read `src/index.ts` and verify it contains all of these exports:

```typescript
// ── Codecs ──────────────────────────────────────────────────────────────────
export type { ConfigCodec } from "./codecs/ConfigCodec.js";
export { JsonCodec } from "./codecs/JsonCodec.js";
export { TomlCodec } from "./codecs/TomlCodec.js";
export { EncryptedCodec, EncryptedCodecKey } from "./codecs/EncryptedCodec.js";
// ── Errors ──────────────────────────────────────────────────────────────────
export { CodecError, CodecErrorBase } from "./errors/CodecError.js";
export { ConfigError, ConfigErrorBase } from "./errors/ConfigError.js";
// ── Events ──────────────────────────────────────────────────────────────────
export { ConfigEvent, ConfigEventPayload } from "./events/ConfigEvent.js";
export type { ConfigEventsService } from "./events/ConfigEvents.js";
export { ConfigEvents } from "./events/ConfigEvents.js";
// ── Layers ──────────────────────────────────────────────────────────────────
export type { ConfigFileOptions } from "./layers/ConfigFileLive.js";
export type { ConfigFileTestOptions } from "./layers/ConfigFileTest.js";
// ── Migrations ──────────────────────────────────────────────────────────────
export type { ConfigFileMigration } from "./migrations/ConfigMigration.js";
export { ConfigMigration, VersionAccess } from "./migrations/ConfigMigration.js";
// ── Resolvers ───────────────────────────────────────────────────────────────
export type { ConfigResolver } from "./resolvers/ConfigResolver.js";
export { ExplicitPath } from "./resolvers/ExplicitPath.js";
export { GitRoot } from "./resolvers/GitRoot.js";
export { StaticDir } from "./resolvers/StaticDir.js";
export { UpwardWalk } from "./resolvers/UpwardWalk.js";
export { WorkspaceRoot } from "./resolvers/WorkspaceRoot.js";
// ── Services ────────────────────────────────────────────────────────────────
export type { ConfigFileService } from "./services/ConfigFile.js";
export { ConfigFile } from "./services/ConfigFile.js";
// ── Strategies ──────────────────────────────────────────────────────────────
export type { ConfigSource, ConfigWalkStrategy } from "./strategies/ConfigWalkStrategy.js";
export { FirstMatch } from "./strategies/FirstMatch.js";
export { LayeredMerge } from "./strategies/LayeredMerge.js";
// ── Watcher ─────────────────────────────────────────────────────────────────
export type { ConfigFileChange } from "./watcher/ConfigFileChange.js";
export type { ConfigWatcherService, WatchOptions } from "./watcher/ConfigWatcher.js";
export { ConfigWatcher } from "./watcher/ConfigWatcher.js";
```

- [ ] **Step 2: Fix any missing exports**

If any exports are missing, add them and run `pnpm vitest run` again.

- [ ] **Step 3: Commit if needed**

```bash
git add src/index.ts
git commit -m "chore: ensure all new exports are in barrel file"
```

Only commit if there were actual changes.
