import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import { DEFAULT_MODELS, DEFAULT_GATES, GateName, GateMode } from './defaults';
import { getVersion } from './paths';
import { readJsonl } from './memoryIo';

/**
 * `agentcohort status` — fast read-only at-a-glance report of the
 * current project's install. Combines structural facts (counts,
 * artifact presence) with the resolved config (models, gates) and a
 * short pointer at planned features that are not yet wired up.
 *
 * Pure with respect to side effects: filesystem reads only.
 */

export interface InstallStatus {
  agents: { installed: number; bundled: number };
  commands: { installed: number; bundled: number };
  /** Whether `CLAUDE.md` exists AND contains the routing-section heading. */
  claudeMd: 'present' | 'missing' | 'no-routing-section';
  /** Whether `.agentcohort.json` exists. */
  config: 'present' | 'defaults';
  /** Whether `.wolf/` exists (OpenWolf integration). */
  openWolf: 'active' | 'not-active';
}

export interface ResolvedModels {
  premium: string;
  mid: string;
  cheap: string;
}

export type ResolvedGates = Record<GateName, GateMode>;

export interface MemoryStatus {
  initialized: boolean;
  collections: Record<string, number>;
  runsTracked: number;
  lastWrite: { ts: string; source: string; collection: string } | null;
  staleEntries: number;
  gitPolicy: 'shared-committed-local-gitignored' | 'all-gitignored' | 'all-committed' | 'unknown';
}

export interface PlannedFeature {
  /** Short label. */
  name: string;
  /** Soft target (e.g. "v0.6", "v1.2"). NOT a commitment. */
  target: string;
  /** One-liner. */
  blurb: string;
}

export interface StatusReport {
  cwd: string;
  version: string;
  install: InstallStatus;
  models: ResolvedModels;
  /** Whether the models came from `.agentcohort.json` (custom) or defaults. */
  modelsSource: 'config' | 'defaults';
  gates: ResolvedGates;
  /** Whether gates came from `.agentcohort.json` (custom) or defaults. */
  gatesSource: 'config' | 'defaults';
  planned: PlannedFeature[];
  memory: MemoryStatus;
}

export interface StatusOptions {
  cwd: string;
  templatesDir: string;
}

/** Static — soft pointers at known-planned features, NOT release commitments. */
const PLANNED_FEATURES: PlannedFeature[] = [
  {
    name: 'Memory extensions',
    target: 'v0.10.1',
    blurb: '`hotspots` / `conventions` / `module-map` collections + dispatcher routing on past runs',
  },
  {
    name: 'Stats dashboard',
    target: 'v0.10.1',
    blurb: '`agentcohort stats` cost report from INDEX.jsonl + per-stage telemetry',
  },
  {
    name: 'Memory lifecycle',
    target: 'v0.10.2',
    blurb: '`memory compact` (summarize old entries) + `memory clean --runs --older-than=30d`',
  },
  {
    name: 'OpenWolf overlay',
    target: 'v0.10.1',
    blurb: 'defer `module-map` / `conventions` to OpenWolf when `.wolf/` is present',
  },
];

const ROUTING_HEADING_RE = /^# Agentcohort Routing Rules[ \t]*$/m;

export function runStatus(opts: StatusOptions): StatusReport {
  const install = readInstall(opts.cwd, opts.templatesDir);
  const { models, modelsSource, gates, gatesSource } = readConfig(opts.cwd);
  const memory = readMemory(opts.cwd);
  return {
    cwd: opts.cwd,
    version: getVersion(),
    install,
    models,
    modelsSource,
    gates,
    gatesSource,
    planned: PLANNED_FEATURES,
    memory,
  };
}

function readInstall(cwd: string, templatesDir: string): InstallStatus {
  const agentsInstalled = countMd(join(cwd, '.claude', 'agents'));
  const commandsInstalled = countMd(join(cwd, '.claude', 'commands'));
  const agentsBundled = countMd(join(templatesDir, 'agents'));
  const commandsBundled = countMd(join(templatesDir, 'commands'));

  const claudeMdPath = join(cwd, 'CLAUDE.md');
  let claudeMd: InstallStatus['claudeMd'] = 'missing';
  if (existsSync(claudeMdPath)) {
    const text = readFileSync(claudeMdPath, 'utf8');
    claudeMd = ROUTING_HEADING_RE.test(text) ? 'present' : 'no-routing-section';
  }

  const config = existsSync(join(cwd, CONFIG_FILENAME)) ? 'present' : 'defaults';
  const openWolf =
    existsSync(join(cwd, '.wolf')) && isDir(join(cwd, '.wolf'))
      ? 'active'
      : 'not-active';

  return {
    agents: { installed: agentsInstalled, bundled: agentsBundled },
    commands: { installed: commandsInstalled, bundled: commandsBundled },
    claudeMd,
    config,
    openWolf,
  };
}

function countMd(dir: string): number {
  if (!existsSync(dir) || !isDir(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readMemory(cwd: string): MemoryStatus {
  const memDir = join(cwd, '.agentcohort', 'memory');
  if (!existsSync(memDir)) {
    return {
      initialized: false, collections: {}, runsTracked: 0,
      lastWrite: null, staleEntries: 0, gitPolicy: detectGitPolicy(cwd),
    };
  }
  const sharedDir = join(memDir, 'shared');
  const collections: Record<string, number> = {};
  let staleEntries = 0;
  let lastWrite: MemoryStatus['lastWrite'] = null;
  if (existsSync(sharedDir)) {
    for (const f of readdirSync(sharedDir).filter((x) => x.endsWith('.jsonl'))) {
      const entries = readJsonl<any>(join(sharedDir, f));
      const name = f.replace(/\.jsonl$/, '');
      collections[name] = entries.length;
      staleEntries += entries.filter((e: any) => e.stale).length;
      const last = entries[entries.length - 1];
      if (last && (!lastWrite || new Date(last.ts) > new Date(lastWrite.ts))) {
        lastWrite = { ts: last.ts, source: last.source, collection: name };
      }
    }
  }
  const indexPath = join(cwd, '.agentcohort', 'runs', 'INDEX.jsonl');
  const runsTracked = existsSync(indexPath)
    ? readJsonl<any>(indexPath).filter((e: any) => e.event === 'start').length
    : 0;
  return {
    initialized: true, collections, runsTracked, lastWrite, staleEntries,
    gitPolicy: detectGitPolicy(cwd),
  };
}

function detectGitPolicy(cwd: string): MemoryStatus['gitPolicy'] {
  const giPath = join(cwd, '.gitignore');
  if (!existsSync(giPath)) return 'unknown';
  const gi = readFileSync(giPath, 'utf8');
  const hasBroad = gi.includes('.agentcohort/') && !gi.includes('.agentcohort/memory/local/');
  const hasSplit = gi.includes('.agentcohort/memory/local/') && gi.includes('.agentcohort/runs/');
  const hasNothing = !gi.includes('.agentcohort/');
  if (hasBroad) return 'all-gitignored';
  if (hasSplit) return 'shared-committed-local-gitignored';
  if (hasNothing) return 'all-committed';
  return 'unknown';
}

function readConfig(cwd: string): {
  models: ResolvedModels;
  modelsSource: 'config' | 'defaults';
  gates: ResolvedGates;
  gatesSource: 'config' | 'defaults';
} {
  // Tolerant: status never crashes on malformed config; doctor is
  // the place to surface config errors. On any parse / shape error
  // we fall back to defaults.
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) {
    return {
      models: { ...DEFAULT_MODELS },
      modelsSource: 'defaults',
      gates: { ...DEFAULT_GATES },
      gatesSource: 'defaults',
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {
      models: { ...DEFAULT_MODELS },
      modelsSource: 'defaults',
      gates: { ...DEFAULT_GATES },
      gatesSource: 'defaults',
    };
  }
  if (!raw || typeof raw !== 'object') {
    return {
      models: { ...DEFAULT_MODELS },
      modelsSource: 'defaults',
      gates: { ...DEFAULT_GATES },
      gatesSource: 'defaults',
    };
  }
  const obj = raw as Record<string, unknown>;

  const models: ResolvedModels = { ...DEFAULT_MODELS };
  let modelsSource: 'config' | 'defaults' = 'defaults';
  if (obj.models && typeof obj.models === 'object') {
    const m = obj.models as Record<string, unknown>;
    if (typeof m.premium === 'string') models.premium = m.premium;
    if (typeof m.mid === 'string') models.mid = m.mid;
    if (typeof m.cheap === 'string') models.cheap = m.cheap;
    modelsSource = 'config';
  }

  const gates: ResolvedGates = { ...DEFAULT_GATES };
  let gatesSource: 'config' | 'defaults' = 'defaults';
  if (obj.gates && typeof obj.gates === 'object') {
    const g = obj.gates as Record<string, unknown>;
    for (const key of Object.keys(gates) as GateName[]) {
      const v = g[key];
      if (v === 'on' || v === 'off' || v === 'auto') {
        gates[key] = v;
        gatesSource = 'config';
      }
    }
  }
  return { models, modelsSource, gates, gatesSource };
}
