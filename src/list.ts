import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import {
  DEFAULT_GATES,
  DEFAULT_MODELS,
  GATE_MODES,
  GATE_NAMES,
  GateMode,
  GateName,
  TIER_ALIASES,
} from './defaults';
import { renderAgentTemplate } from './render';
import { stampTemplate, compareIntegrity } from './stamp';
import { hasLocalMarker } from './localMarker';
import { injectSkillsList } from './skillsBoot';
import {
  resolveAffinity,
  relevantSkills,
  SkillAffinity,
} from './skillAffinity';
import type { Skill } from './skills';

/**
 * `agentcohort list` — discovery command.
 *
 * Where `doctor` diagnoses install health and `status` summarizes at a
 * glance, `list` enumerates *what is available* in the install:
 *
 *  - `list agents`   → bundled agents + per-file install status + model tier
 *  - `list commands` → bundled slash-commands + description + install status
 *  - `list gates`    → human review gates + current mode + when each pauses
 *  - `list`          → all three at once
 *
 * Pure with respect to side effects: filesystem reads only.
 */

export type ListScope = 'all' | 'agents' | 'commands' | 'gates';

export type ListEntryStatus =
  | 'installed' // installed, integrity stamp matches current bundled
  | 'outdated' // installed, stamp matches an older bundled body
  | 'user-edited' // installed, body no longer matches its stamp
  | 'unstamped' // installed, no stamp (pre-0.4.0)
  | 'missing' // bundled but not installed
  | 'extra' // installed but not in the bundled set (no local marker)
  | 'local' // user-authored file (carries `_agentcohort_local: true`)
  | 'local-override'; // user-authored override of a same-named bundled file

export interface ListAgentEntry {
  /** File basename without `.md`, e.g. "dispatcher". */
  name: string;
  /** From frontmatter `description:`. Empty string if absent. */
  description: string;
  /** Raw `model:` value from the installed file (alias OR concrete ID). */
  modelRaw: string;
  /** Inferred tier when `modelRaw` is a known alias or resolves to a configured ID. */
  tier: 'premium' | 'mid' | 'cheap' | null;
  /** Concrete model ID that the install would resolve `modelRaw` to. */
  modelResolved: string;
  status: ListEntryStatus;
}

export interface ListCommandEntry {
  /** File basename without `.md`. */
  name: string;
  /** Slash invocation form, e.g. "/auto-flow". */
  invocation: string;
  /** From frontmatter `description:`. Empty string if absent. */
  description: string;
  /** From frontmatter `argument-hint:` when present. */
  argumentHint?: string;
  status: ListEntryStatus;
}

export interface ListGateEntry {
  name: GateName;
  mode: GateMode;
  source: 'config' | 'defaults';
  /** Short blurb describing when this gate pauses the pipeline. */
  blurb: string;
}

export interface ListReport {
  cwd: string;
  scope: ListScope;
  /** Present when scope is 'all' or 'agents'. */
  agents?: ListAgentEntry[];
  /** Present when scope is 'all' or 'commands'. */
  commands?: ListCommandEntry[];
  /** Present when scope is 'all' or 'gates'. */
  gates?: ListGateEntry[];
}

export interface ListOptions {
  cwd: string;
  templatesDir: string;
  scope: ListScope;
  /**
   * Skills baked into the bundled-body comparison (matches what
   * `init` / `upgrade` would write today). Defaults to `[]` — CLI
   * dispatchers pass the scanned list; tests can pass `[]` to opt out.
   */
  skills?: readonly Skill[];
  /** Per-skill affinity overrides (merged with DEFAULT_AFFINITY). */
  affinity?: SkillAffinity;
}

const GATE_BLURBS: Record<GateName, string> = {
  architect:
    'After solution-architect, before feature-planner — confirms the approach.',
  plan:
    'After feature-planner, before feature-implementer — confirms the plan.',
  bottleneck:
    'After performance-hunter in /perf-hunt — confirms the target bottleneck.',
  'root-cause':
    'After root-cause-analyst in /bug-audit — confirms the diagnosis.',
  'expert-council':
    'After expert-council in /bug-audit — nothing fixes without approval.',
};

export function runList(opts: ListOptions): ListReport {
  const includeAgents = opts.scope === 'all' || opts.scope === 'agents';
  const includeCommands = opts.scope === 'all' || opts.scope === 'commands';
  const includeGates = opts.scope === 'all' || opts.scope === 'gates';

  const models = loadConfiguredModels(opts.cwd);
  const report: ListReport = { cwd: opts.cwd, scope: opts.scope };

  if (includeAgents) {
    report.agents = listAgents(
      opts.cwd,
      opts.templatesDir,
      models,
      opts.skills ?? [],
      resolveAffinity(opts.affinity)
    );
  }
  if (includeCommands) {
    report.commands = listCommands(opts.cwd, opts.templatesDir);
  }
  if (includeGates) {
    report.gates = listGates(opts.cwd);
  }
  return report;
}

// ---------- Agents ----------

function listAgents(
  cwd: string,
  templatesDir: string,
  models: { premium: string; mid: string; cheap: string },
  skills: readonly Skill[],
  affinity: SkillAffinity
): ListAgentEntry[] {
  const templateDir = join(templatesDir, 'agents');
  const installedDir = join(cwd, '.claude', 'agents');

  const bundledFiles = isDir(templateDir)
    ? readdirSync(templateDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  const installedFiles = isDir(installedDir)
    ? new Set(readdirSync(installedDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();

  const entries: ListAgentEntry[] = [];

  for (const f of bundledFiles) {
    const bundledRaw = readFileSync(join(templateDir, f), 'utf8');
    const agentName = f.replace(/\.md$/, '');
    const relevant = relevantSkills(agentName, skills, affinity);
    const bundled = stampTemplate(
      injectSkillsList(renderAgentTemplate(bundledRaw, models), relevant)
    );
    if (!installedFiles.has(f)) {
      entries.push(buildAgentEntry(f, bundled, null, models, 'missing'));
      continue;
    }
    const installed = readFileSync(join(installedDir, f), 'utf8');
    // A local override (file has the marker AND a bundled file shares the
    // name) is a deliberate user choice — never flag as drift.
    if (hasLocalMarker(installed)) {
      entries.push(
        buildAgentEntry(f, installed, installed, models, 'local-override')
      );
      continue;
    }
    const verdict = compareIntegrity(installed, bundled);
    const status: ListEntryStatus =
      verdict === 'unchanged'
        ? 'installed'
        : verdict === 'outdated'
        ? 'outdated'
        : verdict === 'user-edited'
        ? 'user-edited'
        : 'unstamped';
    entries.push(buildAgentEntry(f, installed, installed, models, status));
  }

  // Files installed locally that aren't part of the bundled set. Local
  // (marker-carrying) ones surface as `local`; the rest are `extra`.
  for (const f of installedFiles) {
    if (bundledFiles.includes(f)) continue;
    const installed = readFileSync(join(installedDir, f), 'utf8');
    const status: ListEntryStatus = hasLocalMarker(installed) ? 'local' : 'extra';
    entries.push(buildAgentEntry(f, installed, installed, models, status));
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function buildAgentEntry(
  filename: string,
  bodyForDescription: string,
  installedBody: string | null,
  models: { premium: string; mid: string; cheap: string },
  status: ListEntryStatus
): ListAgentEntry {
  const name = filename.replace(/\.md$/, '');
  const fm = readFrontmatter(bodyForDescription) ?? '';
  const description = extractField(fm, 'description') ?? '';
  // Prefer the installed file's actual model value (what the user has);
  // fall back to the bundled body's value for `missing` entries so the
  // listing always shows a real tier.
  const modelSource = installedBody !== null ? installedBody : bodyForDescription;
  const modelFm = readFrontmatter(modelSource) ?? '';
  const modelRaw = extractField(modelFm, 'model') ?? '';
  const { tier, modelResolved } = resolveModel(modelRaw, models);
  return { name, description, modelRaw, tier, modelResolved, status };
}

function resolveModel(
  modelRaw: string,
  models: { premium: string; mid: string; cheap: string }
): { tier: 'premium' | 'mid' | 'cheap' | null; modelResolved: string } {
  if (modelRaw === '') return { tier: null, modelResolved: '' };
  if (modelRaw in TIER_ALIASES) {
    const tier = TIER_ALIASES[modelRaw as keyof typeof TIER_ALIASES];
    return { tier, modelResolved: models[tier] };
  }
  // Concrete ID — match against the user's configured tiers.
  for (const tier of ['premium', 'mid', 'cheap'] as const) {
    if (models[tier] === modelRaw) return { tier, modelResolved: modelRaw };
  }
  return { tier: null, modelResolved: modelRaw };
}

// ---------- Commands ----------

function listCommands(cwd: string, templatesDir: string): ListCommandEntry[] {
  const templateDir = join(templatesDir, 'commands');
  const installedDir = join(cwd, '.claude', 'commands');

  const bundledFiles = isDir(templateDir)
    ? readdirSync(templateDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  const installedFiles = isDir(installedDir)
    ? new Set(readdirSync(installedDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();

  const entries: ListCommandEntry[] = [];

  for (const f of bundledFiles) {
    const bundledRaw = readFileSync(join(templateDir, f), 'utf8');
    const bundled = stampTemplate(bundledRaw);
    if (!installedFiles.has(f)) {
      entries.push(buildCommandEntry(f, bundledRaw, 'missing'));
      continue;
    }
    const installed = readFileSync(join(installedDir, f), 'utf8');
    if (hasLocalMarker(installed)) {
      entries.push(buildCommandEntry(f, installed, 'local-override'));
      continue;
    }
    const verdict = compareIntegrity(installed, bundled);
    const status: ListEntryStatus =
      verdict === 'unchanged'
        ? 'installed'
        : verdict === 'outdated'
        ? 'outdated'
        : verdict === 'user-edited'
        ? 'user-edited'
        : 'unstamped';
    entries.push(buildCommandEntry(f, installed, status));
  }

  for (const f of installedFiles) {
    if (bundledFiles.includes(f)) continue;
    const installed = readFileSync(join(installedDir, f), 'utf8');
    const status: ListEntryStatus = hasLocalMarker(installed) ? 'local' : 'extra';
    entries.push(buildCommandEntry(f, installed, status));
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function buildCommandEntry(
  filename: string,
  body: string,
  status: ListEntryStatus
): ListCommandEntry {
  const name = filename.replace(/\.md$/, '');
  const fm = readFrontmatter(body) ?? '';
  const description = extractField(fm, 'description') ?? '';
  const argumentHint = extractField(fm, 'argument-hint') ?? undefined;
  const entry: ListCommandEntry = {
    name,
    invocation: '/' + name,
    description,
    status,
  };
  if (argumentHint !== undefined) entry.argumentHint = argumentHint;
  return entry;
}

// ---------- Gates ----------

function listGates(cwd: string): ListGateEntry[] {
  const resolved = loadConfiguredGates(cwd);
  return GATE_NAMES.map<ListGateEntry>((name) => ({
    name,
    mode: resolved.gates[name],
    source: resolved.perGateSource[name],
    blurb: GATE_BLURBS[name],
  }));
}

// ---------- Frontmatter helpers ----------

function readFrontmatter(text: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return null;
  return normalized.slice(4, end);
}

function extractField(frontmatter: string, key: string): string | null {
  // Match a single-line `<key>: <value>` field. YAML supports multi-line
  // scalars; intentionally not supported here — every bundled template
  // uses single-line description / model / argument-hint values, and
  // tolerating multi-line YAML pulls in scope this command does not need.
  const re = new RegExp(`^${escapeRegex(key)}:[ \\t]+(.+?)[ \\t]*$`, 'm');
  const m = frontmatter.match(re);
  return m && m[1] !== undefined ? m[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Config helpers (tolerant — never throw on malformed) ----------

function loadConfiguredModels(cwd: string): {
  premium: string;
  mid: string;
  cheap: string;
} {
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) return { ...DEFAULT_MODELS };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (
      raw &&
      typeof raw === 'object' &&
      raw.models &&
      typeof raw.models === 'object' &&
      typeof raw.models.premium === 'string' &&
      typeof raw.models.mid === 'string' &&
      typeof raw.models.cheap === 'string'
    ) {
      return {
        premium: raw.models.premium,
        mid: raw.models.mid,
        cheap: raw.models.cheap,
      };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_MODELS };
}

function loadConfiguredGates(cwd: string): {
  gates: Record<GateName, GateMode>;
  perGateSource: Record<GateName, 'config' | 'defaults'>;
} {
  const gates: Record<GateName, GateMode> = { ...DEFAULT_GATES };
  const perGateSource: Record<GateName, 'config' | 'defaults'> = {
    architect: 'defaults',
    plan: 'defaults',
    bottleneck: 'defaults',
    'root-cause': 'defaults',
    'expert-council': 'defaults',
  };
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) return { gates, perGateSource };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { gates, perGateSource };
  }
  if (!raw || typeof raw !== 'object') return { gates, perGateSource };
  const obj = raw as Record<string, unknown>;
  if (!obj.gates || typeof obj.gates !== 'object') {
    return { gates, perGateSource };
  }
  const g = obj.gates as Record<string, unknown>;
  for (const key of GATE_NAMES) {
    const v = g[key];
    if (typeof v === 'string' && GATE_MODES.includes(v as GateMode)) {
      gates[key] = v as GateMode;
      perGateSource[key] = 'config';
    }
  }
  return { gates, perGateSource };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
