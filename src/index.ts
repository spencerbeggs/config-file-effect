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
export { EncryptedCodec, EncryptedCodecKey } from "./codecs/EncryptedCodec.js";
export { JsonCodec } from "./codecs/JsonCodec.js";
export { TomlCodec } from "./codecs/TomlCodec.js";
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
export type { ConfigFileMigration, ConfigMigrationOptions } from "./migrations/ConfigMigration.js";
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
// ── Watcher ──────────────────────────────────────────────────────────────────
export type { ConfigFileChange } from "./watcher/ConfigFileChange.js";
export type { ConfigWatcherOptions, ConfigWatcherService, WatchOptions } from "./watcher/ConfigWatcher.js";
export { ConfigWatcher } from "./watcher/ConfigWatcher.js";
