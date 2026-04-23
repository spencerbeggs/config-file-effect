import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EncryptedCodec, EncryptedCodecKey, JsonCodec, TomlCodec } from "../src/index.js";

describe("JsonCodec", () => {
	it("parses valid JSON", async () => {
		const result = await Effect.runPromise(JsonCodec.parse('{"key": "value"}'));
		expect(result).toEqual({ key: "value" });
	});

	it("fails on invalid JSON", async () => {
		const result = await Effect.runPromiseExit(JsonCodec.parse("{invalid}"));
		expect(result._tag).toBe("Failure");
	});

	it("stringifies to JSON", async () => {
		const result = await Effect.runPromise(JsonCodec.stringify({ key: "value" }));
		const parsed = JSON.parse(result);
		expect(parsed).toEqual({ key: "value" });
	});

	it("has correct name and extensions", () => {
		expect(JsonCodec.name).toBe("json");
		expect(JsonCodec.extensions).toEqual([".json"]);
	});
});

describe("TomlCodec", () => {
	it("parses valid TOML", async () => {
		const result = await Effect.runPromise(TomlCodec.parse('key = "value"'));
		expect(result).toEqual({ key: "value" });
	});

	it("fails on invalid TOML", async () => {
		const result = await Effect.runPromiseExit(TomlCodec.parse("[invalid\nbroken"));
		expect(result._tag).toBe("Failure");
	});

	it("stringifies to TOML", async () => {
		const result = await Effect.runPromise(TomlCodec.stringify({ key: "value" }));
		expect(result).toContain("key");
		expect(result).toContain("value");
	});

	it("has correct name and extensions", () => {
		expect(TomlCodec.name).toBe("toml");
		expect(TomlCodec.extensions).toEqual([".toml"]);
	});
});

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
			const keyMaterial = await globalThis.crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
				"encrypt",
				"decrypt",
			]);
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
