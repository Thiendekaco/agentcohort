import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelsConfig } from './config';
import { renderAgentTemplate } from './render';
import { stampTemplate, compareIntegrity } from './stamp';
import {
  backupFile,
  backupPathFor,
  writeFileEnsuringDir,
} from './fileOps';

/**
 * `agentcohort reset <name>` — revert ONE installed file to the
 * currently-bundled body (render + stamp). Targeted, mutating
 * complement to the read-only `diff` / `show` commands.
 *
 * Safety policy:
 *   - No bulk reset. The user must name a file. (`agentcohort upgrade`
 *     is the right tool for project-wide refresh; reset is for "fix
 *     this one specific file.")
 *   - Refuse when the file is `extra` (installed locally but not in
 *     the bundled set) — there is no bundled version to reset to.
 *   - Refuse when a bare name matches both an agent and a command —
 *     the user must disambiguate with `agent/<name>` or
 *     `command/<name>`. Too risky to silently pick one.
 *   - `dryRun` short-circuits writes; the result still describes what
 *     WOULD happen, so the CLI can preview accurately.
 *   - `backup` writes a `<file>.backup-YYYYMMDD-HHMMSS` next to the
 *     original before overwriting.
 *
 * Pure with respect to the algorithm; performs filesystem reads
 * always and writes only when `dryRun === false` AND the disposition
 * is `reset` or `installed`.
 */

export type ResetKind = 'agent' | 'command';

export type ResetDisposition =
  | 'noop' // file already matches the current bundled body
  | 'reset' // installed file overwritten with bundled (was outdated / user-edited / unstamped)
  | 'installed' // bundled file did not exist locally; written fresh
  | 'refused-extra' // file installed locally but not part of the bundled set
  | 'refused-not-found' // no match in either kind
  | 'refused-ambiguous'; // bare name matched both an agent and a command

export type ResetPreStatus =
  | 'unchanged'
  | 'outdated'
  | 'user-edited'
  | 'unstamped'
  | 'missing'
  | 'extra'
  | 'not-found';

export interface ResetAction {
  kind: ResetKind | null;
  /** Resolved bare name (without `.md` extension). */
  name: string;
  preStatus: ResetPreStatus;
  disposition: ResetDisposition;
  installedPath: string | null;
  bundledPath: string | null;
  /** Set when `backup=true` and disposition is `reset`. */
  backupPath?: string;
  /** Content before the operation (empty for missing / not-found / ambiguous). */
  oldText: string;
  /** Content the operation would write (empty for refused-*). */
  newText: string;
  dryRun: boolean;
}

export interface ResetCandidate {
  kind: ResetKind;
  name: string;
  installedExists: boolean;
  bundledExists: boolean;
}

export interface ResetResult {
  cwd: string;
  query: string;
  /** Set when the query carried an `agent/` or `command/` prefix. */
  restrictTo?: ResetKind;
  action: ResetAction;
  /** When disposition is `refused-ambiguous`, the candidates that fired. */
  candidates?: ResetCandidate[];
  /** 0 success (noop / reset / installed), 1 refused, 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface ResetOptions {
  cwd: string;
  templatesDir: string;
  query: string;
  dryRun: boolean;
  backup: boolean;
  models: ModelsConfig;
  now?: () => Date;
}

export function runReset(opts: ResetOptions): ResetResult {
  const { kind: restrictTo, name } = parseQuery(opts.query);
  const kindsToScan: ResetKind[] = restrictTo
    ? [restrictTo]
    : ['agent', 'command'];

  // Discover all candidates matching the name. Either kind counts —
  // installed-only (extra) and bundled-only (missing) both surface.
  const candidates: ResetCandidate[] = [];
  for (const kind of kindsToScan) {
    const cand = locateCandidate(kind, name, opts.cwd, opts.templatesDir);
    if (cand !== null) candidates.push(cand);
  }

  if (candidates.length === 0) {
    return {
      cwd: opts.cwd,
      query: opts.query,
      ...(restrictTo !== undefined ? { restrictTo } : {}),
      action: refusalAction({
        kind: restrictTo ?? null,
        name,
        preStatus: 'not-found',
        disposition: 'refused-not-found',
        dryRun: opts.dryRun,
      }),
      exitCode: 1,
    };
  }

  if (candidates.length > 1 && restrictTo === undefined) {
    return {
      cwd: opts.cwd,
      query: opts.query,
      action: refusalAction({
        kind: null,
        name,
        preStatus: 'not-found',
        disposition: 'refused-ambiguous',
        dryRun: opts.dryRun,
      }),
      candidates,
      exitCode: 1,
    };
  }

  // Exactly one candidate from here on (or one per restricted kind).
  const cand = candidates[0]!;
  return performReset({
    cand,
    cwd: opts.cwd,
    templatesDir: opts.templatesDir,
    query: opts.query,
    restrictTo,
    dryRun: opts.dryRun,
    backup: opts.backup,
    models: opts.models,
    now: opts.now ?? (() => new Date()),
  });
}

function parseQuery(query: string): { kind?: ResetKind; name: string } {
  if (query.startsWith('agent/')) {
    return { kind: 'agent', name: stripMd(query.slice('agent/'.length)) };
  }
  if (query.startsWith('agents/')) {
    return { kind: 'agent', name: stripMd(query.slice('agents/'.length)) };
  }
  if (query.startsWith('command/')) {
    return { kind: 'command', name: stripMd(query.slice('command/'.length)) };
  }
  if (query.startsWith('commands/')) {
    return { kind: 'command', name: stripMd(query.slice('commands/'.length)) };
  }
  return { name: stripMd(query) };
}

function stripMd(s: string): string {
  return s.replace(/\.md$/, '');
}

function locateCandidate(
  kind: ResetKind,
  name: string,
  cwd: string,
  templatesDir: string
): ResetCandidate | null {
  const subdir = kind === 'agent' ? 'agents' : 'commands';
  const filename = `${name}.md`;
  const installedPath = join(cwd, '.claude', subdir, filename);
  const bundledPath = join(templatesDir, subdir, filename);
  const installedExists = existsSync(installedPath);
  const bundledExists = existsSync(bundledPath);
  if (!installedExists && !bundledExists) return null;
  return { kind, name, installedExists, bundledExists };
}

function performReset(args: {
  cand: ResetCandidate;
  cwd: string;
  templatesDir: string;
  query: string;
  restrictTo: ResetKind | undefined;
  dryRun: boolean;
  backup: boolean;
  models: ModelsConfig;
  now: () => Date;
}): ResetResult {
  const subdir = args.cand.kind === 'agent' ? 'agents' : 'commands';
  const filename = `${args.cand.name}.md`;
  const installedPath = join(args.cwd, '.claude', subdir, filename);
  const bundledPath = join(args.templatesDir, subdir, filename);

  // Extra: refuse — there is nothing to reset to.
  if (args.cand.installedExists && !args.cand.bundledExists) {
    return {
      cwd: args.cwd,
      query: args.query,
      ...(args.restrictTo !== undefined ? { restrictTo: args.restrictTo } : {}),
      action: {
        kind: args.cand.kind,
        name: args.cand.name,
        preStatus: 'extra',
        disposition: 'refused-extra',
        installedPath,
        bundledPath,
        oldText: '',
        newText: '',
        dryRun: args.dryRun,
      },
      exitCode: 1,
    };
  }

  // From here on the bundled body exists. Build the canonical replacement
  // (rendered for agents, stamped in both cases) so writes match exactly
  // what `init` / `upgrade` would produce today.
  const bundledRaw = readFileSync(bundledPath, 'utf8');
  const rendered =
    args.cand.kind === 'agent'
      ? renderAgentTemplate(bundledRaw, args.models)
      : bundledRaw;
  const newText = stampTemplate(rendered);

  // Missing: install fresh.
  if (!args.cand.installedExists) {
    if (!args.dryRun) writeFileEnsuringDir(installedPath, newText);
    return {
      cwd: args.cwd,
      query: args.query,
      ...(args.restrictTo !== undefined ? { restrictTo: args.restrictTo } : {}),
      action: {
        kind: args.cand.kind,
        name: args.cand.name,
        preStatus: 'missing',
        disposition: 'installed',
        installedPath,
        bundledPath,
        oldText: '',
        newText,
        dryRun: args.dryRun,
      },
      exitCode: 0,
    };
  }

  // Installed: compare integrity. If unchanged, no-op silently.
  const installed = readFileSync(installedPath, 'utf8');
  const verdict = compareIntegrity(installed, newText);
  if (verdict === 'unchanged') {
    return {
      cwd: args.cwd,
      query: args.query,
      ...(args.restrictTo !== undefined ? { restrictTo: args.restrictTo } : {}),
      action: {
        kind: args.cand.kind,
        name: args.cand.name,
        preStatus: 'unchanged',
        disposition: 'noop',
        installedPath,
        bundledPath,
        oldText: installed,
        newText,
        dryRun: args.dryRun,
      },
      exitCode: 0,
    };
  }

  // Overwrite. Optionally back up first.
  let backupPath: string | undefined;
  if (args.backup) {
    backupPath = uniqueBackupPath(installedPath, args.now());
    if (!args.dryRun) backupFile(installedPath, backupPath);
  }
  if (!args.dryRun) writeFileEnsuringDir(installedPath, newText);
  const action: ResetAction = {
    kind: args.cand.kind,
    name: args.cand.name,
    preStatus: verdict,
    disposition: 'reset',
    installedPath,
    bundledPath,
    oldText: installed,
    newText,
    dryRun: args.dryRun,
  };
  if (backupPath !== undefined) action.backupPath = backupPath;
  return {
    cwd: args.cwd,
    query: args.query,
    ...(args.restrictTo !== undefined ? { restrictTo: args.restrictTo } : {}),
    action,
    exitCode: 0,
  };
}

function uniqueBackupPath(target: string, date: Date): string {
  const base = backupPathFor(target, date);
  if (!existsSync(base)) return base;
  let i = 1;
  while (existsSync(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function refusalAction(args: {
  kind: ResetKind | null;
  name: string;
  preStatus: ResetPreStatus;
  disposition: ResetDisposition;
  dryRun: boolean;
}): ResetAction {
  return {
    kind: args.kind,
    name: args.name,
    preStatus: args.preStatus,
    disposition: args.disposition,
    installedPath: null,
    bundledPath: null,
    oldText: '',
    newText: '',
    dryRun: args.dryRun,
  };
}

