/**
 * Programmatic API.
 *
 * `agentcrew` is primarily a CLI, but the core install logic is exported
 * so it can be embedded in other tooling and exercised directly by tests.
 */
export { runInit } from './installer';
export type {
  InitOptions,
  InitResult,
  ActionRecord,
  Disposition,
} from './installer';
export { buildManifest } from './manifest';
export type { ManifestEntry, EntryKind } from './manifest';
export {
  upsertSection,
  hasSection,
  sectionMatches,
  buildInitialClaudeMd,
  SECTION_TITLE,
} from './claudeMd';
export { formatBackupSuffix, backupPathFor } from './fileOps';
export { getVersion, getTemplatesDir } from './paths';
export { createLogger } from './logger';
export type { Logger } from './logger';
export { createInteractiveResolver, fixedResolver } from './prompt';
export type { ConflictResolver, ConflictDecision, Choice } from './prompt';
