import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Path } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
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
): Layer.Layer<ConfigFileService<A>, never, Scope.Scope> =>
	Layer.unwrapScoped(
		Effect.gen(function* () {
			const platformPath = yield* Path.Path;
			if (options.files) {
				const written: string[] = [];
				for (const [filePath, content] of Object.entries(options.files)) {
					mkdirSync(platformPath.dirname(filePath), { recursive: true });
					writeFileSync(filePath, content);
					written.push(filePath);
				}
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						for (const p of written) rmSync(p, { force: true });
					}),
				);
			}

			return makeConfigFileLiveImpl(options).pipe(Layer.provide(NodeFileSystem.layer));
		}).pipe(Effect.provide(Path.layer)),
	);
