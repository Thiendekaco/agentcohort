import { z } from 'zod';

/**
 * The agent names we accept as `source`. Includes all 16 bundled agents,
 * plus 'human' (user-initiated entries) and 'cli' (internal CLI plumbing).
 *
 * Keep in lockstep with src/templates/agents/*.md. If you add a new bundled
 * agent, add its name here too — otherwise `memory write --source=<new>`
 * will reject with a confusing "invalid enum value" error.
 */
export const KNOWN_SOURCES = [
  'repo-scout', 'solution-architect', 'feature-planner', 'feature-implementer',
  'test-verifier', 'final-reviewer', 'bug-hunter', 'root-cause-analyst',
  'reproduction-engineer', 'regression-guard', 'bug-fixer',
  'performance-hunter', 'perf-optimizer', 'perf-reviewer',
  'expert-council', 'dispatcher', 'human', 'cli',
] as const;
export type Source = (typeof KNOWN_SOURCES)[number];

export const MEMORY_ENTRY_BASE = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  run_id: z.string().uuid().nullable(),
  source: z.enum(KNOWN_SOURCES),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
  stale: z.boolean().default(false),
  context: z.object({
    files: z.array(z.string()),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    task_summary: z.string().max(200),
  }),
  body: z.record(z.unknown()),
});
export type MemoryEntry = z.infer<typeof MEMORY_ENTRY_BASE>;

// ---- per-collection body schemas -----------------------------------

export const DECISION_BODY = z.object({
  approach_chosen: z.string().min(1),
  alternatives_considered: z.array(z.string()),
  trade_offs: z.string(),
  gate_outcome: z.enum(['approved', 'rejected', 'escalated', 'auto-skipped']),
});

export const BUG_BODY = z.object({
  symptoms: z.string().min(1),
  root_cause: z.string().min(1),
  fix_summary: z.string().min(1),
  affected_files: z.array(z.string()),
  test_added: z.string().nullable(),
});

export const SCRATCH_BODY = z.object({
  stage: z.string(),
  key: z.string(),
  value: z.unknown(),
});

export const AUDIT_BODY = z.object({
  gate: z.enum(['architect', 'plan', 'bottleneck', 'root-cause', 'expert-council']),
  outcome: z.enum(['approved', 'rejected', 'escalated', 'auto-skipped']),
  reason: z.string().max(2000).nullable(),
  proposed_content: z.string().min(1).max(2000),
  posing_agent: z.string(),
});

export const VERIFICATION_BODY = z.object({
  target_id: z.string().uuid(),
  target_collection: z.enum(['decisions', 'bugs']),
  verified: z.boolean(),
  evidence: z.string().min(1).max(1000),
  by_stage: z.string(),
});

// hotspots.jsonl — Layer 2 (v0.10.1): file/module fragility
export const HOTSPOT_BODY = z.object({
  file_path: z.string().min(1),
  bug_count: z.number().int().nonnegative(),
  recent_bug_ids: z.array(z.string().uuid()),
  fragility_score: z.number().min(0).max(1),
  notes: z.string().max(500).optional(),
});

// conventions.jsonl — Layer 2 (v0.10.1): accumulated style/conventions
export const CONVENTION_BODY = z.object({
  rule: z.string().min(1),
  scope: z.string(),
  examples_good: z.array(z.string()).default([]),
  examples_bad: z.array(z.string()).default([]),
  derivation: z.enum(['user-confirmed', 'final-reviewer-derived']),
});

// module-map.jsonl — Layer 2 (v0.10.1): high-level project structure
export const MODULE_MAP_BODY = z.object({
  module: z.string().min(1),
  description: z.string().min(1).max(500),
  responsibilities: z.array(z.string()).min(1),
  key_files: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
});

// ---- collection name dispatch --------------------------------------

export const COLLECTION_NAMES = [
  'decisions', 'bugs', 'scratch', 'audit', 'verifications',
  'hotspots', 'conventions', 'module-map',
] as const;
export type CollectionName = (typeof COLLECTION_NAMES)[number];

export function bodySchemaFor(name: CollectionName): z.ZodTypeAny {
  switch (name) {
    case 'decisions':     return DECISION_BODY;
    case 'bugs':          return BUG_BODY;
    case 'scratch':       return SCRATCH_BODY;
    case 'audit':         return AUDIT_BODY;
    case 'verifications': return VERIFICATION_BODY;
    case 'hotspots':     return HOTSPOT_BODY;
    case 'conventions':  return CONVENTION_BODY;
    case 'module-map':   return MODULE_MAP_BODY;
    default: {
      const _exhaust: never = name;
      throw new Error(`unknown collection: ${String(_exhaust)}`);
    }
  }
}

// ---- inferred body types (convenience for callers) -----------------
export type DecisionBody     = z.infer<typeof DECISION_BODY>;
export type BugBody          = z.infer<typeof BUG_BODY>;
export type ScratchBody      = z.infer<typeof SCRATCH_BODY>;
export type AuditBody        = z.infer<typeof AUDIT_BODY>;
export type VerificationBody = z.infer<typeof VERIFICATION_BODY>;
export type HotspotBody     = z.infer<typeof HOTSPOT_BODY>;
export type ConventionBody  = z.infer<typeof CONVENTION_BODY>;
export type ModuleMapBody   = z.infer<typeof MODULE_MAP_BODY>;
