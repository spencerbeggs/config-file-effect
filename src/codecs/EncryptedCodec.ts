import { Effect } from "effect";
import { CodecError } from "../errors/CodecError.js";
import type { ConfigCodec } from "./ConfigCodec.js";

/**
 * Key source union for {@link EncryptedCodec}.
 *
 * @remarks
 * Use {@link EncryptedCodecKey.fromCryptoKey} to supply a pre-derived
 * `CryptoKey`, or {@link EncryptedCodecKey.fromPassphrase} to derive one via
 * PBKDF2 at first use.
 *
 * @public
 */
export type EncryptedCodecKey =
	| { readonly _tag: "CryptoKey"; readonly key: Effect.Effect<CryptoKey, CodecError> }
	| {
			readonly _tag: "Passphrase";
			readonly passphrase: string;
			readonly salt: Uint8Array;
	  };

/**
 * Convenience constructors for {@link EncryptedCodecKey}.
 *
 * @public
 */
export const EncryptedCodecKey = {
	/**
	 * Use a pre-derived `CryptoKey` effect directly.
	 *
	 * @remarks
	 * The effect is evaluated once and the resulting key is reused for every
	 * encrypt/decrypt operation on the codec instance.
	 */
	fromCryptoKey: (key: Effect.Effect<CryptoKey, CodecError>): EncryptedCodecKey => ({
		_tag: "CryptoKey",
		key,
	}),

	/**
	 * Derive a `CryptoKey` from a passphrase and salt via PBKDF2.
	 *
	 * @remarks
	 * Key derivation runs lazily on the first encrypt/decrypt call and the
	 * result is cached for subsequent operations.
	 */
	fromPassphrase: (passphrase: string, salt: Uint8Array): EncryptedCodecKey => ({
		_tag: "Passphrase",
		passphrase,
		salt,
	}),
};

const IV_LENGTH = 12;

/**
 * Copy a Uint8Array into a fresh Uint8Array<ArrayBuffer>, which is required
 * by Web Crypto APIs that accept BufferSource.
 */
function toArrayBufferView(src: Uint8Array): Uint8Array<ArrayBuffer> {
	const buf = new ArrayBuffer(src.length);
	const view = new Uint8Array(buf);
	view.set(src);
	return view;
}

/**
 * Build an Effect that resolves to an AES-GCM CryptoKey.
 *
 * For the Passphrase variant the derivation is cached after first evaluation.
 */
function resolveKey(keySource: EncryptedCodecKey): Effect.Effect<CryptoKey, CodecError> {
	if (keySource._tag === "CryptoKey") {
		return keySource.key;
	}

	// Cache the derived key so PBKDF2 only runs once per codec instance.
	let cached: CryptoKey | undefined;

	return Effect.tryPromise({
		try: async () => {
			if (cached !== undefined) {
				return cached;
			}
			const enc = new TextEncoder();
			const keyMaterial = await globalThis.crypto.subtle.importKey(
				"raw",
				enc.encode(keySource.passphrase),
				"PBKDF2",
				false,
				["deriveKey"],
			);
			const derived = await globalThis.crypto.subtle.deriveKey(
				{
					name: "PBKDF2",
					// Copy into Uint8Array<ArrayBuffer> — required by PBKDF2Params.salt
					salt: toArrayBufferView(keySource.salt),
					iterations: 100_000,
					hash: "SHA-256",
				},
				keyMaterial,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"],
			);
			cached = derived;
			return derived;
		},
		catch: (error) =>
			new CodecError({
				codec: "encrypted",
				operation: "parse",
				reason: `Key derivation failed: ${String(error)}`,
			}),
	});
}

/**
 * Wraps any {@link ConfigCodec} with AES-GCM encryption.
 *
 * @remarks
 * `parse` expects base64-encoded ciphertext produced by `stringify`. The first
 * 12 bytes of the decoded buffer are the random IV; the remainder is the
 * ciphertext. After decryption the plaintext is passed to the inner codec's
 * `parse` method.
 *
 * `stringify` serialises with the inner codec, generates a random 12-byte IV,
 * encrypts the plaintext, prepends the IV to the ciphertext, and base64-encodes
 * the result.
 *
 * @public
 */
export function EncryptedCodec(inner: ConfigCodec, keySource: EncryptedCodecKey): ConfigCodec {
	const getKey = resolveKey(keySource);
	const codecName = `encrypted(${inner.name})`;

	return {
		name: codecName,
		extensions: inner.extensions,

		parse: (raw) =>
			Effect.gen(function* () {
				const key = yield* getKey;

				const combined = yield* Effect.try({
					try: () => {
						// atob is available in all modern environments (Node 20+, Bun, Deno)
						const binary = atob(raw);
						const buf = new ArrayBuffer(binary.length);
						const bytes = new Uint8Array(buf);
						for (let i = 0; i < binary.length; i++) {
							bytes[i] = binary.charCodeAt(i);
						}
						return bytes;
					},
					catch: (error) =>
						new CodecError({
							codec: codecName,
							operation: "parse",
							reason: `Base64 decode failed: ${String(error)}`,
						}),
				});

				if (combined.length <= IV_LENGTH) {
					return yield* Effect.fail(
						new CodecError({
							codec: codecName,
							operation: "parse",
							reason: "Ciphertext too short to contain IV",
						}),
					);
				}

				const iv = combined.slice(0, IV_LENGTH);
				const ciphertext = combined.slice(IV_LENGTH);

				const plaintext = yield* Effect.tryPromise({
					try: () => globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
					catch: (error) =>
						new CodecError({
							codec: codecName,
							operation: "parse",
							reason: `Decryption failed: ${String(error)}`,
						}),
				});

				const decoded = new TextDecoder().decode(plaintext);
				return yield* inner.parse(decoded);
			}),

		stringify: (value) =>
			Effect.gen(function* () {
				const key = yield* getKey;
				const serialised = yield* inner.stringify(value);

				const encoded = new TextEncoder().encode(serialised);
				const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LENGTH)));

				const ciphertext = yield* Effect.tryPromise({
					try: () => globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
					catch: (error) =>
						new CodecError({
							codec: codecName,
							operation: "stringify",
							reason: `Encryption failed: ${String(error)}`,
						}),
				});

				const combined = yield* Effect.try({
					try: () => {
						const ciphertextBytes = new Uint8Array(ciphertext);
						const resultBuf = new ArrayBuffer(IV_LENGTH + ciphertextBytes.length);
						const result = new Uint8Array(resultBuf);
						result.set(iv, 0);
						result.set(ciphertextBytes, IV_LENGTH);
						// btoa is available in all modern environments (Node 20+, Bun, Deno)
						let binary = "";
						for (let i = 0; i < result.length; i++) {
							binary += String.fromCharCode(result[i] as number);
						}
						return btoa(binary);
					},
					catch: (error) =>
						new CodecError({
							codec: codecName,
							operation: "stringify",
							reason: `Base64 encode failed: ${String(error)}`,
						}),
				});

				return combined;
			}),
	};
}
