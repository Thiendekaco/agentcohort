import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_MODELS,
  DEFAULT_GATES,
  GATE_NAMES,
  GATE_MODES,
  GateMode,
  GateName,
} from './defaults';

export const CONFIG_FILENAME = '.agentcohort.json';

export interface ModelsConfig {
  premium: string;
  mid: string;
  cheap: string;
}

export type GatesConfig = Record<GateName, GateMode>;
/** Partial gates as they may appear in a hand-edited config file. */
export type PartialGatesConfig = Partial<GatesConfig>;

export interface AgentcohortConfig {
  version: 1;
  models: ModelsConfig;
  /** Optional. When absent or partial, resolveGates() fills with DEFAULT_GATES. */
  gates?: PartialGatesConfig;
}

const TIERS = ['premium', 'mid', 'cheap'] as const;

function fail(reason: string): never {
  throw new Error(
    `Invalid .agentcohort.json: ${reason}. Expected schema: { version: 1, models: { premium: string, mid: string, cheap: string }, gates?: { architect?: 'on'|'off'|'auto', plan?: ..., 'root-cause'?: ..., 'expert-council'?: ... } }`
  );
}

/**
 * Validate that `raw` is a well-formed AgentcohortConfig. Returns the
 * parsed config (with unknown top-level keys stripped). Throws on any
 * violation.
 */
export function validateConfig(raw: unknown): AgentcohortConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    fail(`unsupported version ${JSON.stringify(obj.version)}; expected 1`);
  }
  const models = obj.models;
  if (models === null || typeof models !== 'object' || Array.isArray(models)) {
    fail('models must be an object');
  }
  const m = models as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const tier of TIERS) {
    const v = m[tier];
    if (typeof v !== 'string') {
      fail(`models.${tier} must be a string`);
    }
    if (v.trim().length === 0) {
      fail(`models.${tier} must be a non-empty, non-whitespace string`);
    }
    out[tier] = v;
  }
  const gates = validateGates(obj.gates);
  const result: AgentcohortConfig = {
    version: 1,
    models: out as unknown as ModelsConfig,
  };
  if (gates !== undefined) {
    result.gates = gates;
  }
  return result;
}

function validateGates(raw: unknown): PartialGatesConfig | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('gates must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const out: PartialGatesConfig = {};
  for (const key of Object.keys(obj)) {
    if (!GATE_NAMES.includes(key as GateName)) {
      fail(`unknown gate: '${key}' (allowed: ${GATE_NAMES.join(', ')})`);
    }
    const v = obj[key];
    if (typeof v !== 'string' || !GATE_MODES.includes(v as GateMode)) {
      fail(`gates.${key} must be one of: ${GATE_MODES.join(', ')}`);
    }
    out[key as GateName] = v as GateMode;
  }
  return out;
}

/**
 * Load `.agentcohort.json` from `projectRoot`. Returns null if absent.
 * Throws a structured error if the file exists but is malformed.
 */
export function loadConfig(projectRoot: string): AgentcohortConfig | null {
  const path = join(projectRoot, CONFIG_FILENAME);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`malformed JSON (${msg})`);
  }
  return validateConfig(parsed);
}

const SCHEMA_URL =
  'https://raw.githubusercontent.com/Thiendekaco/agentcohort/main/schema/agentcohort-config-v1.json';

function serializeConfig(cfg: AgentcohortConfig): string {
  const ordered: Record<string, unknown> = {
    $schema: SCHEMA_URL,
    version: cfg.version,
    models: {
      premium: cfg.models.premium,
      mid: cfg.models.mid,
      cheap: cfg.models.cheap,
    },
  };
  if (cfg.gates) {
    // Emit gates in canonical order so byte-level idempotency holds.
    const gates: PartialGatesConfig = {};
    for (const name of GATE_NAMES) {
      const v = cfg.gates[name];
      if (v !== undefined) gates[name] = v;
    }
    ordered.gates = gates;
  }
  return JSON.stringify(ordered, null, 2) + '\n';
}

/**
 * Write `cfg` to `.agentcohort.json` in `projectRoot`. Includes a
 * `$schema` field for editor autocomplete. Idempotent at the byte
 * level: writing the same config twice produces identical bytes.
 */
export function writeConfig(projectRoot: string, cfg: AgentcohortConfig): void {
  const path = join(projectRoot, CONFIG_FILENAME);
  writeFileSync(path, serializeConfig(cfg), 'utf8');
}

/**
 * Resolve a ModelsConfig from a possibly-null config. When null,
 * returns DEFAULT_MODELS.
 */
export function resolveModels(cfg: AgentcohortConfig | null): ModelsConfig {
  if (cfg === null) {
    return {
      premium: DEFAULT_MODELS.premium,
      mid: DEFAULT_MODELS.mid,
      cheap: DEFAULT_MODELS.cheap,
    };
  }
  return cfg.models;
}

/**
 * Resolve a fully-populated GatesConfig from a possibly-null /
 * partially-specified config. Missing gates fall back to
 * DEFAULT_GATES.
 */
export function resolveGates(cfg: AgentcohortConfig | null): GatesConfig {
  const partial = cfg?.gates ?? {};
  return {
    architect: partial.architect ?? DEFAULT_GATES.architect,
    plan: partial.plan ?? DEFAULT_GATES.plan,
    bottleneck: partial.bottleneck ?? DEFAULT_GATES.bottleneck,
    'root-cause': partial['root-cause'] ?? DEFAULT_GATES['root-cause'],
    'expert-council':
      partial['expert-council'] ?? DEFAULT_GATES['expert-council'],
  };
}
