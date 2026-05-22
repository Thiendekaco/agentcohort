import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelsConfig } from './config';
import { renderAgentTemplate } from './render';
import { stampTemplate, compareIntegrity } from './stamp';
import { unifiedDiff } from './textDiff';
import { hasLocalMarker } from './localMarker';

/**
 * `agentcohort diff` — read-only file-level diff between installed
 * templates and what the package currently bundles.
 *
 * Compared to `upgrade --dry-run --diff`, this command is pure
 * inspection: no policy decisions ("refresh vs conflict"), no prompts,
 * no concept of "kept" or "applied". Just: per file, what is the
 * difference, right now?
 *
 * Exit code is conventional CI-friendly: 0 = no diffs, 1 = differences
 * exist (or query target not found), 2 = internal failure.
 *
 * Pure with respect to side effects: filesystem reads only.
 */

export type DiffKind = 'agent' | 'command';
export type DiffScope = 'all' | 'agents' | 'commands';

export type DiffStatus =
  | 'unchanged' // installed body matches the current bundled body
  | 'outdated' // installed stamp matches an older bundled body
  | 'user-edited' // installed body diverges from its stamp
  | 'unstamped' // installed has no stamp (pre-0.4.0)
  | 'missing' // bundled but not installed locally
  | 'extra' // installed, no marker, no bundled equivalent
  | 'local' // installed user-authored, no bundled equivalent
  | 'local-override'; // installed user-authored override of a bundled file

export interface DiffFileEntry {
  kind: DiffKind;
  name: string;
  installedPath: string;
  bundledPath: string;
  installedExists: boolean;
  bundledExists: boolean;
  status: DiffStatus;
  /** Pre-diff text (installed body, or "" when status='missing'). */
  oldText: string;
  /** Post-diff text (bundled rendered+stamped, or "" when status='extra'). */
  newText: string;
  /** Unified diff text; empty when status is 'unchanged' or 'extra'. */
  diff: string;
}

export interface DiffResult {
  cwd: string;
  /** When non-null, the user passed `agentcohort diff <name>` for a single file. */
  query: string | null;
  /** When the query carried an `agent/` or `command/` prefix. */
  restrictTo?: DiffKind;
  scope: DiffScope;
  /** Files with status !== 'unchanged'. Always sorted by kind then name. */
  files: DiffFileEntry[];
  /** Count of files that matched (or all bundled files when no query) and are unchanged. */
  unchangedCount: number;
  /** True when a single-name query produced no agent or command match at all. */
  notFound: boolean;
  /** 0 no diffs, 1 has diffs (or not-found query), 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface DiffOptions {
  cwd: string;
  templatesDir: string;
  /** When null, scan everything under .claude/agents and .claude/commands. */
  query: string | null;
  scope: DiffScope;
  models: ModelsConfig;
}

export function runDiff(opts: DiffOptions): DiffResult {
  const { kind: restrictTo, name: targetName } = parseQuery(opts.query);
  const effectiveScope: DiffScope = restrictTo
    ? restrictTo === 'agent'
      ? 'agents'
      : 'commands'
    : opts.scope;

  const kindsToScan: DiffKind[] = (() => {
    if (effectiveScope === 'agents') return ['agent'];
    if (effectiveScope === 'commands') return ['command'];
    return ['agent', 'command'];
  })();

  const entries: DiffFileEntry[] = [];
  for (const kind of kindsToScan) {
    entries.push(
      ...scanKind({
        kind,
        cwd: opts.cwd,
        templatesDir: opts.templatesDir,
        models: opts.models,
        targetName,
      })
    );
  }

  // When the user queried a specific name, distinguish "not found at
  // all" from "found and clean" — those are different signals.
  const queryWasMatch = targetName === null || entries.length > 0;
  const notFound = !queryWasMatch;

  const differing = entries.filter((e) => e.status !== 'unchanged');
  differing.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'agent' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const unchangedCount = entries.length - differing.length;

  const result: DiffResult = {
    cwd: opts.cwd,
    query: opts.query,
    scope: opts.scope,
    files: differing,
    unchangedCount,
    notFound,
    exitCode: notFound || differing.length > 0 ? 1 : 0,
  };
  if (restrictTo !== undefined) result.restrictTo = restrictTo;
  return result;
}

function parseQuery(query: string | null): {
  kind?: DiffKind;
  name: string | null;
} {
  if (query === null) return { name: null };
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

function scanKind(args: {
  kind: DiffKind;
  cwd: string;
  templatesDir: string;
  models: ModelsConfig;
  targetName: string | null;
}): DiffFileEntry[] {
  const subdir = args.kind === 'agent' ? 'agents' : 'commands';
  const installedDir = join(args.cwd, '.claude', subdir);
  const bundledDir = join(args.templatesDir, subdir);

  const installedFiles = isDir(installedDir)
    ? new Set(readdirSync(installedDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();
  const bundledFiles = isDir(bundledDir)
    ? new Set(readdirSync(bundledDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();

  const union = new Set<string>([...installedFiles, ...bundledFiles]);
  const out: DiffFileEntry[] = [];
  for (const f of union) {
    const name = f.replace(/\.md$/, '');
    if (args.targetName !== null && name !== args.targetName) continue;
    out.push(
      buildEntry({
        kind: args.kind,
        name,
        filename: f,
        installedDir,
        bundledDir,
        installedExists: installedFiles.has(f),
        bundledExists: bundledFiles.has(f),
        models: args.models,
      })
    );
  }
  return out;
}

function buildEntry(args: {
  kind: DiffKind;
  name: string;
  filename: string;
  installedDir: string;
  bundledDir: string;
  installedExists: boolean;
  bundledExists: boolean;
  models: ModelsConfig;
}): DiffFileEntry {
  const installedPath = join(args.installedDir, args.filename);
  const bundledPath = join(args.bundledDir, args.filename);

  // Render + stamp bundled now so all comparisons are apples-to-apples
  // with whatever the user actually has installed.
  let bundledRenderedStamped = '';
  if (args.bundledExists) {
    const raw = readFileSync(bundledPath, 'utf8');
    const rendered =
      args.kind === 'agent' ? renderAgentTemplate(raw, args.models) : raw;
    bundledRenderedStamped = stampTemplate(rendered);
  }
  const installed = args.installedExists
    ? readFileSync(installedPath, 'utf8')
    : '';

  const isLocal = args.installedExists && hasLocalMarker(installed);
  let status: DiffStatus;
  if (!args.installedExists && args.bundledExists) status = 'missing';
  else if (args.installedExists && !args.bundledExists) {
    status = isLocal ? 'local' : 'extra';
  } else if (isLocal) {
    // Local override of a bundled file — diff is still meaningful so the
    // user can see what their override changed, but it is not "drift".
    status = 'local-override';
  } else {
    const verdict = compareIntegrity(installed, bundledRenderedStamped);
    status = verdict; // 'unchanged' | 'outdated' | 'user-edited' | 'unstamped'
  }

  let diff = '';
  if (status === 'unchanged' || status === 'extra' || status === 'local') {
    diff = '';
  } else if (status === 'missing') {
    diff = unifiedDiff('', bundledRenderedStamped, {
      oldLabel: '(not installed)',
      newLabel: `bundled/${args.filename}`,
    });
  } else if (status === 'local-override') {
    diff = unifiedDiff(installed, bundledRenderedStamped, {
      oldLabel: `installed/${args.filename} (local override)`,
      newLabel: `bundled/${args.filename}`,
    });
  } else {
    diff = unifiedDiff(installed, bundledRenderedStamped, {
      oldLabel: `installed/${args.filename}`,
      newLabel: `bundled/${args.filename}`,
    });
  }

  return {
    kind: args.kind,
    name: args.name,
    installedPath,
    bundledPath,
    installedExists: args.installedExists,
    bundledExists: args.bundledExists,
    status,
    oldText: installed,
    newText: bundledRenderedStamped,
    diff,
  };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
