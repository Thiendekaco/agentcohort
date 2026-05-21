import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import { DEFAULT_MODELS, DEFAULT_GATES, GateName, GateMode } from './defaults';
import { getVersion } from './paths';

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
}

export interface StatusOptions {
  cwd: string;
  templatesDir: string;
}

/** Static — soft pointers at known-planned features, NOT release commitments. */
const PLANNED_FEATURES: PlannedFeature[] = [
  {
    name: 'Project profiles',
    target: 'v0.7',
    blurb: '`init --profile=backend|fullstack|...` for stack-aware presets',
  },
  {
    name: 'Skills auto-detect',
    target: 'v0.7',
    blurb: 'record installed Claude skills into config so agents reference them',
  },
  {
    name: 'Agent packs',
    target: 'v0.8',
    blurb: 'modular `agentcohort add-pack <name>` for custom agent bundles',
  },
  {
    name: 'Telemetry',
    target: 'v1.2',
    blurb: 'per-task JSONL log of tier, tokens, gates, duration',
  },
];

const ROUTING_HEADING_RE = /^# Agentcohort Routing Rules[ \t]*$/m;

export function runStatus(opts: StatusOptions): StatusReport {
  const install = readInstall(opts.cwd, opts.templatesDir);
  const { models, modelsSource, gates, gatesSource } = readConfig(opts.cwd);
  return {
    cwd: opts.cwd,
    version: getVersion(),
    install,
    models,
    modelsSource,
    gates,
    gatesSource,
    planned: PLANNED_FEATURES,
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
