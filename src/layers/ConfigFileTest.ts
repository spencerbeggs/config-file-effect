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
					yield* fs.makeDirectory(platformPath.dirname(filePath), { recursive: true }).pipe(Effect.orDie);
					yield* fs.writeFileString(filePath, content).pipe(Effect.orDie);
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
