import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import {
  backupFile,
  backupPathFor,
  writeFileEnsuringDir,
} from './fileOps';
import { hasLocalMarker, markAsLocal } from './localMarker';

/**
 * Portable pack format — `agentcohort export` / `import`.
 *
 * What goes in:
 *   - Every file under `.claude/agents/` and `.claude/commands/` that
 *     carries `_agentcohort_local: true` (local-new AND local-override).
 *   - Optionally, `.agentcohort.json` (the user's resolved model /
 *     gate config).
 *
 * What does NOT go in:
 *   - Bundled files that the user hand-edited but never marked local.
 *     Those are "drift" — the right tool is `add --override` to mark
 *     them as intentional customizations, then they become portable.
 *   - Empty subdirectories. The user owns `.claude/` and may have
 *     other tooling there.
 *
 * Pack format is a single JSON document — no archive dep, no external
 * binary tooling. Agents/commands are pure markdown, file count is
 * tens at most; inlining keeps the artifact one `cat | jq` away from
 * being inspectable.
 */

export const PACK_SCHEMA_VERSION = 1;

export type PackFileKind = 'agent' | 'command';

export interface PackFile {
  kind: PackFileKind;
  /** Bare name without `.md`. */
  name: string;
  /** True when a bundled file shares this name (local-override). */
  isOverride: boolean;
  /** UTF-8 file body, exactly as it sits on disk. */
  content: string;
}

export interface Pack {
  schemaVersion: typeof PACK_SCHEMA_VERSION;
  /** The agentcohort version that produced the pack (informational). */
  agentcohort: string;
  /** ISO 8601 timestamp. */
  exportedAt: string;
  /**
   * Parsed `.agentcohort.json` content (an arbitrary JSON object) or
   * `null` when there was none / the user opted out via `--no-config`.
   */
  config: Record<string, unknown> | null;
  files: PackFile[];
}

// ============================================================================
// Export
// ============================================================================

export interface ExportOptions {
  cwd: string;
  templatesDir: string;
  /** When null, the caller decides what to do with the pack (e.g. stdout). */
  outPath: string | null;
  /** Include `.agentcohort.json` in the pack. */
  includeConfig: boolean;
  now?: () => Date;
  /** Override the agentcohort version stamp (testing). */
  version: string;
}

export interface ExportResult {
  cwd: string;
  outPath: string | null;
  pack: Pack;
  /** Number of files included (agents + commands). */
  fileCount: number;
  /** True when the config was included. */
  configIncluded: boolean;
  /** 0 success, 1 nothing-to-export (still produces a valid empty pack), 2 internal. */
  exitCode: 0 | 1 | 2;
}

export function runExport(opts: ExportOptions): ExportResult {
  const now = opts.now ?? (() => new Date());
  const files: PackFile[] = [];
  files.push(
    ...collectLocalFiles({
      cwd: opts.cwd,
      templatesDir: opts.templatesDir,
      kind: 'agent',
    })
  );
  files.push(
    ...collectLocalFiles({
      cwd: opts.cwd,
      templatesDir: opts.templatesDir,
      kind: 'command',
    })
  );

  let config: Record<string, unknown> | null = null;
  if (opts.includeConfig) {
    config = readConfigIfPresent(opts.cwd);
  }

  const pack: Pack = {
    schemaVersion: PACK_SCHEMA_VERSION,
    agentcohort: opts.version,
    exportedAt: now().toISOString(),
    config,
    files,
  };

  if (opts.outPath !== null) {
    writeFileEnsuringDir(opts.outPath, JSON.stringify(pack, null, 2) + '\n');
  }

  // exit 1 when the pack would be empty — informational, not an error.
  const isEmpty = files.length === 0 && config === null;
  return {
    cwd: opts.cwd,
    outPath: opts.outPath,
    pack,
    fileCount: files.length,
    configIncluded: config !== null,
    exitCode: isEmpty ? 1 : 0,
  };
}

function collectLocalFiles(args: {
  cwd: string;
  templatesDir: string;
  kind: PackFileKind;
}): PackFile[] {
  const subdir = args.kind === 'agent' ? 'agents' : 'commands';
  const installedDir = join(args.cwd, '.claude', subdir);
  const bundledDir = join(args.templatesDir, subdir);
  if (!isDir(installedDir)) return [];
  const bundledSet = isDir(bundledDir)
    ? new Set(readdirSync(bundledDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();

  const out: PackFile[] = [];
  const files = readdirSync(installedDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  for (const f of files) {
    const path = join(installedDir, f);
    const content = readFileSync(path, 'utf8');
    if (!hasLocalMarker(content)) continue;
    out.push({
      kind: args.kind,
      name: f.replace(/\.md$/, ''),
      isOverride: bundledSet.has(f),
      content,
    });
  }
  return out;
}

function readConfigIfPresent(cwd: string): Record<string, unknown> | null {
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ============================================================================
// Import
// ============================================================================

export type ImportFileDisposition =
  | 'created' // new local file written
  | 'overwritten' // existing local file replaced (--force or interactive yes)
  | 'refused-exists' // existing file at target, no --force
  | 'refused-bundled-collision'; // imported as NEW but a bundled file shares the name

export interface ImportFileEntry {
  kind: PackFileKind;
  name: string;
  installedPath: string;
  isOverride: boolean;
  disposition: ImportFileDisposition;
  /** Set when an existing file was backed up before overwrite. */
  backupPath?: string;
}

export interface ImportResult {
  cwd: string;
  packPath: string;
  packSchemaVersion: number;
  packAgentcohortVersion: string;
  files: ImportFileEntry[];
  configHandled:
    | 'written'
    | 'overwritten'
    | 'refused-exists'
    | 'skipped'
    | 'none-in-pack';
  configPath: string | null;
  configBackupPath?: string;
  dryRun: boolean;
  /** 0 success, 1 partial (any `refused-*`), 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface ImportOptions {
  cwd: string;
  templatesDir: string;
  /** Absolute or relative path to the `.agentcohort-pack.json` file. */
  packPath: string;
  /** Overwrite existing local files at the target path. */
  force: boolean;
  /** Apply `.agentcohort.json` from the pack. */
  importConfig: boolean;
  dryRun: boolean;
  backup: boolean;
  now?: () => Date;
}

export class PackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackValidationError';
  }
}

/** Parse + validate a pack file body. Throws on malformed/unsupported. */
export function parsePack(text: string): Pack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new PackValidationError(
      'Pack file is not valid JSON: ' +
        (err instanceof Error ? err.message : String(err))
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PackValidationError('Pack root must be a JSON object.');
  }
  const o = parsed as Record<string, unknown>;
  if (o.schemaVersion !== PACK_SCHEMA_VERSION) {
    throw new PackValidationError(
      `Unsupported pack schema version ${JSON.stringify(o.schemaVersion)} — this CLI supports ${PACK_SCHEMA_VERSION}.`
    );
  }
  if (typeof o.agentcohort !== 'string') {
    throw new PackValidationError('Pack is missing the `agentcohort` version field.');
  }
  if (typeof o.exportedAt !== 'string') {
    throw new PackValidationError('Pack is missing the `exportedAt` timestamp.');
  }
  if (!Array.isArray(o.files)) {
    throw new PackValidationError('Pack `files` must be an array.');
  }
  const files: PackFile[] = [];
  for (let i = 0; i < o.files.length; i += 1) {
    const f = o.files[i];
    if (f === null || typeof f !== 'object' || Array.isArray(f)) {
      throw new PackValidationError(`files[${i}] must be an object.`);
    }
    const fo = f as Record<string, unknown>;
    if (fo.kind !== 'agent' && fo.kind !== 'command') {
      throw new PackValidationError(
        `files[${i}].kind must be 'agent' or 'command' (got ${JSON.stringify(fo.kind)}).`
      );
    }
    if (typeof fo.name !== 'string' || fo.name.length === 0) {
      throw new PackValidationError(`files[${i}].name must be a non-empty string.`);
    }
    if (typeof fo.isOverride !== 'boolean') {
      throw new PackValidationError(`files[${i}].isOverride must be a boolean.`);
    }
    if (typeof fo.content !== 'string') {
      throw new PackValidationError(`files[${i}].content must be a string.`);
    }
    files.push({
      kind: fo.kind,
      name: fo.name,
      isOverride: fo.isOverride,
      content: fo.content,
    });
  }

  let config: Record<string, unknown> | null = null;
  if (o.config === null || o.config === undefined) {
    config = null;
  } else if (typeof o.config === 'object' && !Array.isArray(o.config)) {
    config = o.config as Record<string, unknown>;
  } else {
    throw new PackValidationError('Pack `config` must be an object or null.');
  }

  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    agentcohort: o.agentcohort,
    exportedAt: o.exportedAt,
    config,
    files,
  };
}

export function runImport(opts: ImportOptions): ImportResult {
  const now = opts.now ?? (() => new Date());
  if (!existsSync(opts.packPath) || !statSync(opts.packPath).isFile()) {
    throw new PackValidationError(`Pack file not found: ${opts.packPath}`);
  }
  const pack = parsePack(readFileSync(opts.packPath, 'utf8'));

  const fileEntries: ImportFileEntry[] = [];
  for (const f of pack.files) {
    fileEntries.push(applyPackFile({ ...opts, file: f, now }));
  }

  // Config handling.
  let configHandled: ImportResult['configHandled'] = 'none-in-pack';
  let configPath: string | null = null;
  let configBackupPath: string | undefined;
  if (pack.config === null) {
    configHandled = 'none-in-pack';
  } else if (!opts.importConfig) {
    configHandled = 'skipped';
    configPath = join(opts.cwd, CONFIG_FILENAME);
  } else {
    const target = join(opts.cwd, CONFIG_FILENAME);
    configPath = target;
    const existed = existsSync(target) && statSync(target).isFile();
    if (existed && !opts.force) {
      configHandled = 'refused-exists';
    } else {
      if (existed && opts.backup) {
        configBackupPath = uniqueBackupPath(target, now());
        if (!opts.dryRun) backupFile(target, configBackupPath);
      }
      if (!opts.dryRun) {
        writeFileEnsuringDir(
          target,
          JSON.stringify(pack.config, null, 2) + '\n'
        );
      }
      configHandled = existed ? 'overwritten' : 'written';
    }
  }

  const hasRefused = fileEntries.some((e) =>
    e.disposition.startsWith('refused-')
  );
  const configRefused = configHandled === 'refused-exists';
  const exitCode: 0 | 1 | 2 = hasRefused || configRefused ? 1 : 0;

  const result: ImportResult = {
    cwd: opts.cwd,
    packPath: opts.packPath,
    packSchemaVersion: pack.schemaVersion,
    packAgentcohortVersion: pack.agentcohort,
    files: fileEntries,
    configHandled,
    configPath,
    dryRun: opts.dryRun,
    exitCode,
  };
  if (configBackupPath !== undefined) result.configBackupPath = configBackupPath;
  return result;
}

function applyPackFile(args: {
  cwd: string;
  templatesDir: string;
  file: PackFile;
  force: boolean;
  dryRun: boolean;
  backup: boolean;
  now: () => Date;
}): ImportFileEntry {
  const subdir = args.file.kind === 'agent' ? 'agents' : 'commands';
  const installedPath = join(
    args.cwd,
    '.claude',
    subdir,
    `${args.file.name}.md`
  );
  const installedExists = existsSync(installedPath);

  // Ensure the imported body carries the local marker — defense in
  // depth against hand-crafted packs whose authors forgot to mark.
  const body = hasLocalMarker(args.file.content)
    ? args.file.content
    : markAsLocal(args.file.content);

  if (installedExists && !args.force) {
    return {
      kind: args.file.kind,
      name: args.file.name,
      installedPath,
      isOverride: args.file.isOverride,
      disposition: 'refused-exists',
    };
  }

  let backupPath: string | undefined;
  if (installedExists && args.backup) {
    backupPath = uniqueBackupPath(installedPath, args.now());
    if (!args.dryRun) backupFile(installedPath, backupPath);
  }
  if (!args.dryRun) {
    writeFileEnsuringDir(installedPath, body);
  }
  const entry: ImportFileEntry = {
    kind: args.file.kind,
    name: args.file.name,
    installedPath,
    isOverride: args.file.isOverride,
    disposition: installedExists ? 'overwritten' : 'created',
  };
  if (backupPath !== undefined) entry.backupPath = backupPath;
  return entry;
}

function uniqueBackupPath(target: string, date: Date): string {
  const base = backupPathFor(target, date);
  if (!existsSync(base)) return base;
  let i = 1;
  while (existsSync(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
