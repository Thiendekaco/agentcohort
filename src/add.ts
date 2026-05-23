import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileEnsuringDir } from './fileOps';
import { markAsLocal } from './localMarker';

/**
 * `agentcohort add <name>` — create a user-authored agent or command
 * file under `.claude/`. The new file is stamped with
 * `_agentcohort_local: true` so PR2's overlay-aware commands will
 * leave it alone on upgrade, treat it as a first-class member of the
 * install (not `extra`), and skip the integrity check.
 *
 * Two cases:
 *  - "create"           — name does NOT collide with any bundled file.
 *                         Scaffold from an archetype template (analyst /
 *                         implementer / reviewer / gate / empty).
 *  - "override-create"  — name DOES collide with a bundled file. Refuse
 *                         unless `--override` is passed; with it, copy
 *                         the bundled body verbatim and add the local
 *                         marker. The user gets a head start with the
 *                         current bundled content, then edits it.
 *
 * Always refuses if an installed file with that name already exists,
 * unless `--force` is set. Backup is the user's job here — `add` is
 * about new files, not editing existing ones (use `reset` to revert
 * a hand-edited bundled file).
 */

export type AddKind = 'agent' | 'command';

export type AgentArchetype =
  | 'analyst' // read-only investigator (like bug-hunter, performance-hunter)
  | 'implementer' // change-maker (like feature-implementer, bug-fixer)
  | 'reviewer' // read-only critic (like final-reviewer, perf-reviewer)
  | 'gate' // decision/handoff role (like dispatcher, expert-council)
  | 'empty'; // barebones — just required frontmatter

export type AddDisposition =
  | 'created' // new local file written (no bundled collision)
  | 'override-created' // local copy of a bundled file written
  | 'refused-exists' // a file at the target path already exists
  | 'refused-bundled' // bundled file exists; --override required
  | 'refused-invalid-name'; // name failed validation

export interface AddOptions {
  cwd: string;
  templatesDir: string;
  /** Raw query: `agent/foo`, `command/foo`, or bare `foo` (defaults to agent). */
  query: string;
  /** Used only when `kind` resolves to `agent`. Defaults to `empty`. */
  archetype: AgentArchetype | null;
  /** Frontmatter `description:` value. Defaults to a TODO placeholder. */
  description: string | null;
  /** Frontmatter `model:` alias (agents only). Defaults to `sonnet`. */
  model: 'haiku' | 'sonnet' | 'opus' | null;
  /** Allow scaffolding from a bundled file of the same name. */
  override: boolean;
  /** Allow overwriting an existing installed file. */
  force: boolean;
  dryRun: boolean;
}

export interface AddResult {
  cwd: string;
  kind: AddKind;
  name: string;
  /** Null when refused or when kind is `command`. */
  archetype: AgentArchetype | null;
  installedPath: string | null;
  bundledPath: string | null;
  bundledExists: boolean;
  /** True when an installed file already sat at the target path. */
  installedExists: boolean;
  disposition: AddDisposition;
  /** Body that would be written (empty for refused-*). */
  newText: string;
  dryRun: boolean;
  /** 0 success, 1 refused, 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

/** Allowed names: lowercase letters / digits / hyphens, must start with a letter or digit. */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function runAdd(opts: AddOptions): AddResult {
  const { kind, name } = parseQuery(opts.query);

  if (!NAME_RE.test(name)) {
    return {
      cwd: opts.cwd,
      kind,
      name,
      archetype: null,
      installedPath: null,
      bundledPath: null,
      bundledExists: false,
      installedExists: false,
      disposition: 'refused-invalid-name',
      newText: '',
      dryRun: opts.dryRun,
      exitCode: 1,
    };
  }

  const subdir = kind === 'agent' ? 'agents' : 'commands';
  const filename = `${name}.md`;
  const installedPath = join(opts.cwd, '.claude', subdir, filename);
  const bundledPath = join(opts.templatesDir, subdir, filename);
  const installedExists = existsSync(installedPath);
  const bundledExists = existsSync(bundledPath);

  if (installedExists && !opts.force) {
    return {
      cwd: opts.cwd,
      kind,
      name,
      archetype: null,
      installedPath,
      bundledPath,
      bundledExists,
      installedExists,
      disposition: 'refused-exists',
      newText: '',
      dryRun: opts.dryRun,
      exitCode: 1,
    };
  }

  if (bundledExists && !opts.override) {
    return {
      cwd: opts.cwd,
      kind,
      name,
      archetype: null,
      installedPath,
      bundledPath,
      bundledExists,
      installedExists,
      disposition: 'refused-bundled',
      newText: '',
      dryRun: opts.dryRun,
      exitCode: 1,
    };
  }

  // Build the body.
  let newText: string;
  const archetype: AgentArchetype = opts.archetype ?? 'empty';
  if (bundledExists && opts.override) {
    const bundledRaw = readFileSync(bundledPath, 'utf8');
    newText = markAsLocal(bundledRaw);
  } else if (kind === 'agent') {
    newText = scaffoldAgent({
      name,
      archetype,
      description: opts.description ?? defaultDescription(name),
      model: opts.model ?? 'sonnet',
    });
  } else {
    newText = scaffoldCommand({
      name,
      description: opts.description ?? defaultDescription(name),
    });
  }

  if (!opts.dryRun) {
    writeFileEnsuringDir(installedPath, newText);
  }

  return {
    cwd: opts.cwd,
    kind,
    name,
    archetype: kind === 'agent' ? archetype : null,
    installedPath,
    bundledPath,
    bundledExists,
    installedExists,
    disposition: bundledExists ? 'override-created' : 'created',
    newText,
    dryRun: opts.dryRun,
    exitCode: 0,
  };
}

function parseQuery(query: string): { kind: AddKind; name: string } {
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
  // Bare name defaults to agent — agents are far more common to add.
  return { kind: 'agent', name: stripMd(query) };
}

function stripMd(s: string): string {
  return s.replace(/\.md$/, '');
}

function defaultDescription(name: string): string {
  return `${name} — TODO: describe what this role does and when it runs.`;
}

interface AgentScaffoldArgs {
  name: string;
  archetype: AgentArchetype;
  description: string;
  model: 'haiku' | 'sonnet' | 'opus';
}

interface CommandScaffoldArgs {
  name: string;
  description: string;
}

function scaffoldAgent(args: AgentScaffoldArgs): string {
  const meta = ARCHETYPE_META[args.archetype];
  return [
    '---',
    `name: ${args.name}`,
    `description: ${args.description}`,
    `tools: ${meta.tools}`,
    `model: ${args.model}`,
    `_agentcohort_local: true`,
    '---',
    '',
    meta.body,
  ].join('\n');
}

function scaffoldCommand(args: CommandScaffoldArgs): string {
  return [
    '---',
    `name: ${args.name}`,
    `description: ${args.description}`,
    `argument-hint: <args>`,
    `_agentcohort_local: true`,
    '---',
    '',
    `# /${args.name}`,
    '',
    `TODO: write the workflow this slash-command runs.`,
    '',
    `Outline the steps the orchestrator should take, which subagents to`,
    `dispatch, and what each gate decides.`,
    '',
  ].join('\n');
}

interface ArchetypeMeta {
  tools: string;
  body: string;
}

const ARCHETYPE_META: Record<AgentArchetype, ArchetypeMeta> = {
  empty: {
    tools: 'Read, Glob, Grep',
    body: ['# Role', '', 'TODO: describe what this agent does.', ''].join('\n'),
  },
  analyst: {
    tools: 'Read, Glob, Grep, Bash',
    body: [
      '# Role',
      '',
      'You are a read-only analyst. Investigate the area in scope and',
      'surface findings with concrete evidence. Never modify files.',
      '',
      '# Method',
      '',
      '1. Form a map of where the relevant code lives — files, modules,',
      '   integration points.',
      '2. Read the actual code (do not trust file names alone). Cite',
      '   `path:line` for every finding.',
      '3. Catalog findings by severity. Each entry: location, evidence,',
      '   why it matters.',
      '4. Return a concise report. Facts and citations, not opinions.',
      '',
      '# Boundaries',
      '',
      '- No edits, writes, or git operations.',
      '- No speculation without code evidence backing it.',
      '',
    ].join('\n'),
  },
  implementer: {
    tools: 'Read, Write, Edit, Glob, Grep, Bash',
    body: [
      '# Role',
      '',
      'You implement changes following a plan. Surgical edits, no scope',
      'creep, evidence in the diff.',
      '',
      '# Method',
      '',
      '1. Read the plan / spec and the affected files end-to-end before',
      '   touching code.',
      '2. Make the smallest change that satisfies the plan. Resist the',
      '   urge to refactor adjacent code.',
      '3. Run the test suite (or the closest equivalent) after each',
      '   meaningful change.',
      '4. Report what you changed, what you skipped from the plan, and',
      '   anything you discovered along the way.',
      '',
      '# Boundaries',
      '',
      '- Do not extend scope beyond what the plan requests.',
      '- Do not commit; let the orchestrator decide.',
      '',
    ].join('\n'),
  },
  reviewer: {
    tools: 'Read, Glob, Grep, Bash',
    body: [
      '# Role',
      '',
      'You are a read-only reviewer. Read the diff / plan and surface',
      'issues that would block merge.',
      '',
      '# Method',
      '',
      '1. Read every file touched by the diff. Skim the surrounding code',
      '   for invariants the change might break.',
      '2. Classify findings: blocker / strong-recommendation / nit.',
      '3. For each blocker, cite `path:line` and explain the failure mode',
      '   concretely.',
      '4. Return a structured verdict, not a stream of comments.',
      '',
      '# Boundaries',
      '',
      '- Never modify code.',
      '- Strong opinions OK, but always with evidence.',
      '',
    ].join('\n'),
  },
  gate: {
    tools: 'Read, Glob, Grep',
    body: [
      '# Role',
      '',
      'You are a decision gate. Present a concise summary of the upstream',
      "subagent's work and ask the human to confirm before the pipeline",
      'proceeds.',
      '',
      '# Method',
      '',
      '1. Summarize the upstream output in 3–5 bullets.',
      '2. Surface trade-offs / risks the human must weigh.',
      '3. Present 2–4 explicit options via `AskUserQuestion`. Never use',
      '   text menus like `[y/revise/abort]`.',
      '4. Wait for the answer; do not act on assumptions.',
      '',
      '# Boundaries',
      '',
      '- Read-only. Never modify code.',
      '- One question at a time, mutually exclusive options.',
      '',
    ].join('\n'),
  },
};
