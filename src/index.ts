/**
 * config-file-effect
 *
 * Composable config file loading for Effect with pluggable codecs,
 * resolution strategies, and merge behaviors.
 *
 * @packageDocumentation
 */

// ── Codecs ──────────────────────────────────────────────────────────────────
export type { ConfigCodec } from "./codecs/ConfigCodec.js";
export { JsonCodec } from "./codecs/JsonCodec.js";
export { TomlCodec } from "./codecs/TomlCodec.js";
// ── Errors ──────────────────────────────────────────────────────────────────
export { CodecError, CodecErrorBase } from "./errors/CodecError.js";
export { ConfigError, ConfigErrorBase } from "./errors/ConfigError.js";
// ── Layers ──────────────────────────────────────────────────────────────────
export type { ConfigFileOptions } from "./layers/ConfigFileLive.js";
export type { ConfigFileTestOptions } from "./layers/ConfigFileTest.js";
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
