import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelsConfig } from './config';
import { renderAgentTemplate } from './render';
import { stampTemplate, compareIntegrity, IntegrityVerdict } from './stamp';
import { hasLocalMarker } from './localMarker';

/**
 * `agentcohort show <name>` — print the body of one installed or
 * bundled agent / command. Pairs with `list` (enumerate) to form a
 * list-then-inspect discovery flow.
 *
 * Pure with respect to side effects: filesystem reads only.
 */

export type ShowKind = 'agent' | 'command';

export type ShowSource =
  | 'installed' // actual file in .claude/ — what Claude Code reads
  | 'bundled-rendered' // bundled template after render + stamp (== what init/upgrade would write)
  | 'bundled-raw'; // bundled template untouched — pre-render, pre-stamp

export interface ShowMatch {
  kind: ShowKind;
  name: string;
  source: ShowSource;
  /**
   * Integrity verdict when source === 'installed'. `'no-bundled'` means
   * no bundled file shares this name; `'local'` means the installed
   * file carries the `_agentcohort_local: true` marker — integrity
   * comparison is intentionally skipped.
   */
  status?: IntegrityVerdict | 'no-bundled' | 'local';
  /** True when default fallback was used (no installed file, bundled shown). */
  fallback: boolean;
  /** True when the installed file carries the local marker. */
  isLocal?: boolean;
  /** Absolute path on disk where `content` came from. */
  path: string;
  /** File body to print. */
  content: string;
}

export interface ShowResult {
  cwd: string;
  /** The raw query the user passed (e.g. "dispatcher" or "agent/dispatcher"). */
  query: string;
  /** When the user used the `agent/` or `command/` prefix, the restricted kind. */
  restrictTo?: ShowKind;
  matches: ShowMatch[];
  /** True when no agent and no command matched. */
  notFound: boolean;
  /** Conventional exit code: 0 found, 1 not found, 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

export type ShowVariant = 'default' | 'raw' | 'bundled';

export interface ShowOptions {
  cwd: string;
  templatesDir: string;
  query: string;
  variant: ShowVariant;
  /** Resolved models — required for rendering agent templates. */
  models: ModelsConfig;
}

export function runShow(opts: ShowOptions): ShowResult {
  const { kind: restrictTo, name } = parseQuery(opts.query);
  const lookFor: ShowKind[] =
    restrictTo !== undefined ? [restrictTo] : ['agent', 'command'];

  const matches: ShowMatch[] = [];
  for (const kind of lookFor) {
    const m = lookupOne({
      kind,
      name,
      cwd: opts.cwd,
      templatesDir: opts.templatesDir,
      variant: opts.variant,
      models: opts.models,
    });
    if (m !== null) matches.push(m);
  }

  const result: ShowResult = {
    cwd: opts.cwd,
    query: opts.query,
    matches,
    notFound: matches.length === 0,
    exitCode: matches.length === 0 ? 1 : 0,
  };
  if (restrictTo !== undefined) result.restrictTo = restrictTo;
  return result;
}

function parseQuery(query: string): { kind?: ShowKind; name: string } {
  if (query.startsWith('agent/')) {
    return { kind: 'agent', name: query.slice('agent/'.length) };
  }
  if (query.startsWith('agents/')) {
    return { kind: 'agent', name: query.slice('agents/'.length) };
  }
  if (query.startsWith('command/')) {
    return { kind: 'command', name: query.slice('command/'.length) };
  }
  if (query.startsWith('commands/')) {
    return { kind: 'command', name: query.slice('commands/'.length) };
  }
  return { name: query };
}

function lookupOne(args: {
  kind: ShowKind;
  name: string;
  cwd: string;
  templatesDir: string;
  variant: ShowVariant;
  models: ModelsConfig;
}): ShowMatch | null {
  const subdir = args.kind === 'agent' ? 'agents' : 'commands';
  // Strip a `.md` extension the user may have included so both
  // `show dispatcher` and `show dispatcher.md` work.
  const baseName = args.name.replace(/\.md$/, '');
  const filename = baseName + '.md';

  const installedPath = join(args.cwd, '.claude', subdir, filename);
  const bundledPath = join(args.templatesDir, subdir, filename);

  const bundledExists = existsSync(bundledPath);
  const installedExists = existsSync(installedPath);

  // --raw → bundled template untouched (only meaningful if bundled exists).
  if (args.variant === 'raw') {
    if (!bundledExists) return null;
    return {
      kind: args.kind,
      name: baseName,
      source: 'bundled-raw',
      fallback: false,
      path: bundledPath,
      content: readFileSync(bundledPath, 'utf8'),
    };
  }

  // --bundled → bundled rendered + stamped (what init/upgrade would write).
  if (args.variant === 'bundled') {
    if (!bundledExists) return null;
    const raw = readFileSync(bundledPath, 'utf8');
    const rendered =
      args.kind === 'agent' ? renderAgentTemplate(raw, args.models) : raw;
    return {
      kind: args.kind,
      name: baseName,
      source: 'bundled-rendered',
      fallback: false,
      path: bundledPath,
      content: stampTemplate(rendered),
    };
  }

  // Default: prefer installed; fall back to bundled-rendered with a banner.
  if (installedExists) {
    const installed = readFileSync(installedPath, 'utf8');
    const isLocal = hasLocalMarker(installed);
    let status: IntegrityVerdict | 'no-bundled' | 'local';
    if (isLocal) {
      // Local files own their content — skip integrity comparison even
      // when a same-named bundled exists (the user opted out).
      status = 'local';
    } else if (bundledExists) {
      const bundledRaw = readFileSync(bundledPath, 'utf8');
      const bundled = stampTemplate(
        args.kind === 'agent'
          ? renderAgentTemplate(bundledRaw, args.models)
          : bundledRaw
      );
      status = compareIntegrity(installed, bundled);
    } else {
      status = 'no-bundled';
    }
    const match: ShowMatch = {
      kind: args.kind,
      name: baseName,
      source: 'installed',
      status,
      fallback: false,
      path: installedPath,
      content: installed,
    };
    if (isLocal) match.isLocal = true;
    return match;
  }

  if (bundledExists) {
    const raw = readFileSync(bundledPath, 'utf8');
    const rendered =
      args.kind === 'agent' ? renderAgentTemplate(raw, args.models) : raw;
    return {
      kind: args.kind,
      name: baseName,
      source: 'bundled-rendered',
      fallback: true,
      path: bundledPath,
      content: stampTemplate(rendered),
    };
  }

  return null;
}
