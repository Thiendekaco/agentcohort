/**
 * Single source of truth for default Claude model IDs and the
 * alias-to-tier mapping the installer uses when rewriting agent
 * templates.
 *
 * When a new Claude model ships, update DEFAULT_MODELS here and the
 * change flows through both the default install path and the prompt
 * defaults.
 */

export const DEFAULT_MODELS = {
  premium: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5-20251001',
} as const;

export const TIER_ALIASES = {
  opus: 'premium',
  sonnet: 'mid',
  haiku: 'cheap',
} as const;

export type Tier = keyof typeof DEFAULT_MODELS;
export type TierAlias = keyof typeof TIER_ALIASES;

/**
 * Human review gates. Each gate pauses the pipeline at a specific
 * point so the user can sanity-check an expensive or high-stakes
 * decision before it cascades into the next stage.
 *
 *  - `architect`      — after `solution-architect`, before `feature-planner`.
 *  - `plan`           — after `feature-planner`, before `feature-implementer`.
 *  - `bottleneck`     — after `performance-hunter` in `/perf-hunt`. Confirms
 *                       the right bottleneck to attack before architect/
 *                       optimizer cost is committed.
 *  - `root-cause`     — after `root-cause-analyst` in `/bug-audit`.
 *  - `expert-council` — after `expert-council` in `/bug-audit` (existing
 *                       invariant: nothing fixes until the user approves).
 *
 * Modes:
 *  - `on`   → always pause.
 *  - `off`  → never pause.
 *  - `auto` → pause when the dispatcher escalated to Tier 4 or an
 *             escalation keyword fired (auth/schema/payment/...).
 *
 * Defaults: architect / plan / root-cause / expert-council are `on`
 * because they are the four load-bearing decisions whose cost
 * cascades the most if wrong. The bottleneck gate is `auto` because
 * most perf tasks (slow page, slow query) have a self-evident target
 * and the friction of a default-on pause outweighs the rework risk —
 * but Tier 4 / escalation-keyword tasks still get the gate.
 */
export const DEFAULT_GATES = {
  architect: 'on',
  plan: 'on',
  bottleneck: 'auto',
  'root-cause': 'on',
  'expert-council': 'on',
} as const;

export type GateMode = 'on' | 'off' | 'auto';
export type GateName = keyof typeof DEFAULT_GATES;
export const GATE_NAMES: readonly GateName[] = [
  'architect',
  'plan',
  'bottleneck',
  'root-cause',
  'expert-council',
];
export const GATE_MODES: readonly GateMode[] = ['on', 'off', 'auto'];
