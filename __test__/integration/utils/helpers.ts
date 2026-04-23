import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");

export const FsLayer = NodeFileSystem.layer;

export const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(effect, FsLayer));

export const readFixture = (name: string): string => readFileSync(join(fixturesDir, name), "utf-8");
