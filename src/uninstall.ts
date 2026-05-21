import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import { removeSection, hasSection } from './claudeMd';
import {
  backupFile,
  backupPathFor,
  writeFileEnsuringDir,
} from './fileOps';

/**
 * `agentcohort uninstall` — remove the bundled-set files (agents +
 * commands) from `.claude/`, optionally strip the CLAUDE.md routing
 * section, and optionally remove `.agentcohort.json`.
 *
 * Strong safety contract:
 *
 *  - **User-authored files are NEVER touched.** A file in
 *    `.claude/agents/` whose name is not in the bundled set is left
 *    alone (recorded as `kept-user-file`).
 *  - **CLAUDE.md content outside the routing section is preserved.**
 *    Only the agentcohort section is removed; the rest of the file
 *    keeps its byte content (modulo whitespace collapsing at the
 *    section boundary, see `removeSection` in src/claudeMd.ts).
 *  - **Directories are NOT removed**, even if empty after the run.
 *    The user owns `.claude/` and may have other tooling there.
 *  - **Backups** (when enabled) are per-file `<file>.backup-YYYYMMDD-
 *    HHMMSS`, same convention as `upgrade` / `reset`.
 *  - **dryRun** short-circuits every write; the result still describes
 *    what WOULD happen.
 *
 * Pure with respect to algorithm; performs filesystem reads and (when
 * `dryRun === false`) writes.
 */

export type UninstallActionKind =
  | 'removed-bundled-file' // a bundled agent / command file removed from .claude/
  | 'kept-user-file' // user-authored file left alone (not in bundled set)
  | 'removed-routing-section' // CLAUDE.md routing section stripped, rest preserved
  | 'kept-claude-md' // CLAUDE.md left untouched (either no section, or --keep-claude-md)
  | 'removed-config' // .agentcohort.json removed
  | 'kept-config'; // .agentcohort.json preserved (default for --yes)

export interface UninstallEntry {
  path: string;
  kind: UninstallActionKind;
  /** Set when the entry involved a backup (only for `removed-*`). */
  backupPath?: string;
}

export interface UninstallSummary {
  removedFiles: number;
  keptUserFiles: number;
  sectionRemoved: boolean;
  configRemoved: boolean;
  backupCount: number;
}

export interface UninstallResult {
  cwd: string;
  dryRun: boolean;
  entries: UninstallEntry[];
  summary: UninstallSummary;
  /** 0 success, 1 nothing-to-do (empty project — informational), 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface UninstallOptions {
  cwd: string;
  templatesDir: string;
  dryRun: boolean;
  backup: boolean;
  /** When true, the agentcohort routing section is stripped from CLAUDE.md. */
  removeClaudeSection: boolean;
  /** When true, `.agentcohort.json` is removed. */
  removeConfig: boolean;
  now?: () => Date;
}

export function runUninstall(opts: UninstallOptions): UninstallResult {
  const now = opts.now ?? (() => new Date());
  const entries: UninstallEntry[] = [];

  // --- 1. Plan + execute: bundled file removal ---
  entries.push(...planAndApplyFiles({
    cwd: opts.cwd,
    templatesDir: opts.templatesDir,
    subdir: 'agents',
    dryRun: opts.dryRun,
    backup: opts.backup,
    now,
  }));
  entries.push(...planAndApplyFiles({
    cwd: opts.cwd,
    templatesDir: opts.templatesDir,
    subdir: 'commands',
    dryRun: opts.dryRun,
    backup: opts.backup,
    now,
  }));

  // --- 2. CLAUDE.md routing section ---
  const claudeMdPath = join(opts.cwd, 'CLAUDE.md');
  if (existsSync(claudeMdPath) && statSync(claudeMdPath).isFile()) {
    const text = readFileSync(claudeMdPath, 'utf8');
    if (opts.removeClaudeSection && hasSection(text)) {
      const stripped = removeSection(text) ?? text;
      let backupPath: string | undefined;
      if (opts.backup) {
        backupPath = uniqueBackupPath(claudeMdPath, now());
        if (!opts.dryRun) backupFile(claudeMdPath, backupPath);
      }
      if (!opts.dryRun) writeFileEnsuringDir(claudeMdPath, stripped);
      const entry: UninstallEntry = {
        path: claudeMdPath,
        kind: 'removed-routing-section',
      };
      if (backupPath !== undefined) entry.backupPath = backupPath;
      entries.push(entry);
    } else {
      entries.push({ path: claudeMdPath, kind: 'kept-claude-md' });
    }
  }

  // --- 3. .agentcohort.json ---
  const configPath = join(opts.cwd, CONFIG_FILENAME);
  if (existsSync(configPath) && statSync(configPath).isFile()) {
    if (opts.removeConfig) {
      let backupPath: string | undefined;
      if (opts.backup) {
        backupPath = uniqueBackupPath(configPath, now());
        if (!opts.dryRun) backupFile(configPath, backupPath);
      }
      if (!opts.dryRun) unlinkSync(configPath);
      const entry: UninstallEntry = {
        path: configPath,
        kind: 'removed-config',
      };
      if (backupPath !== undefined) entry.backupPath = backupPath;
      entries.push(entry);
    } else {
      entries.push({ path: configPath, kind: 'kept-config' });
    }
  }

  // --- 4. Summary ---
  const summary: UninstallSummary = {
    removedFiles: entries.filter((e) => e.kind === 'removed-bundled-file').length,
    keptUserFiles: entries.filter((e) => e.kind === 'kept-user-file').length,
    sectionRemoved: entries.some((e) => e.kind === 'removed-routing-section'),
    configRemoved: entries.some((e) => e.kind === 'removed-config'),
    backupCount: entries.filter((e) => e.backupPath !== undefined).length,
  };

  // exit 1 = "nothing to uninstall" (no bundled files removed AND no
  // section AND no config touched). That's an informational signal —
  // not an error.
  const didAnything =
    summary.removedFiles > 0 || summary.sectionRemoved || summary.configRemoved;
  return {
    cwd: opts.cwd,
    dryRun: opts.dryRun,
    entries,
    summary,
    exitCode: didAnything ? 0 : 1,
  };
}

function planAndApplyFiles(args: {
  cwd: string;
  templatesDir: string;
  subdir: 'agents' | 'commands';
  dryRun: boolean;
  backup: boolean;
  now: () => Date;
}): UninstallEntry[] {
  const installedDir = join(args.cwd, '.claude', args.subdir);
  const bundledDir = join(args.templatesDir, args.subdir);

  if (!isDir(installedDir)) return [];
  const installedFiles = readdirSync(installedDir).filter((f) =>
    f.endsWith('.md')
  );
  const bundledSet = isDir(bundledDir)
    ? new Set(readdirSync(bundledDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();

  const entries: UninstallEntry[] = [];
  for (const f of installedFiles.sort()) {
    const path = join(installedDir, f);
    if (!bundledSet.has(f)) {
      entries.push({ path, kind: 'kept-user-file' });
      continue;
    }
    let backupPath: string | undefined;
    if (args.backup) {
      backupPath = uniqueBackupPath(path, args.now());
      if (!args.dryRun) backupFile(path, backupPath);
    }
    if (!args.dryRun) unlinkSync(path);
    const entry: UninstallEntry = { path, kind: 'removed-bundled-file' };
    if (backupPath !== undefined) entry.backupPath = backupPath;
    entries.push(entry);
  }
  return entries;
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
