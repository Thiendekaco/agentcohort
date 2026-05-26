/**
 * Static per-agent token estimates + tier pricing for `agentcohort stats`.
 * Estimates are intentionally rough (±20%) — refined values come in v0.10.2+
 * once we have real telemetry from per-stage event captures.
 */

export interface AgentEstimate {
  input: number;
  output: number;
  model: 'haiku' | 'sonnet' | 'opus';
}

export const AGENT_TOKEN_ESTIMATE: Record<string, AgentEstimate> = {
  'dispatcher':             { input: 2000,  output: 800,  model: 'haiku' },
  'repo-scout':             { input: 3000,  output: 500,  model: 'haiku' },
  'solution-architect':     { input: 8000,  output: 2500, model: 'opus' },
  'feature-planner':        { input: 6000,  output: 2000, model: 'sonnet' },
  'feature-implementer':    { input: 12000, output: 3000, model: 'opus' },
  'test-verifier':          { input: 5000,  output: 1500, model: 'sonnet' },
  'final-reviewer':         { input: 8000,  output: 1500, model: 'opus' },
  'bug-hunter':             { input: 6000,  output: 2000, model: 'sonnet' },
  'root-cause-analyst':     { input: 7000,  output: 2000, model: 'opus' },
  'reproduction-engineer':  { input: 5000,  output: 1500, model: 'sonnet' },
  'regression-guard':       { input: 4000,  output: 1000, model: 'sonnet' },
  'bug-fixer':              { input: 8000,  output: 2000, model: 'sonnet' },
  'performance-hunter':     { input: 6000,  output: 1500, model: 'sonnet' },
  'perf-optimizer':         { input: 10000, output: 2500, model: 'opus' },
  'perf-reviewer':          { input: 7000,  output: 1500, model: 'opus' },
  'expert-council':         { input: 10000, output: 3000, model: 'opus' },
};

export const TIER_PRICE_PER_MTOK: Record<'haiku' | 'sonnet' | 'opus', { input: number; output: number }> = {
  haiku:  { input: 1.0,  output: 5.0 },
  sonnet: { input: 3.0,  output: 15.0 },
  opus:   { input: 15.0, output: 75.0 },
};

export const NAIVE_FULL_PIPELINE: readonly string[] = [
  'dispatcher', 'repo-scout', 'solution-architect', 'feature-planner',
  'feature-implementer', 'test-verifier', 'final-reviewer',
];

export function estimateCostForAgents(agents: readonly string[]): number {
  let totalUsd = 0;
  for (const name of agents) {
    const e = AGENT_TOKEN_ESTIMATE[name];
    if (!e) continue;
    const price = TIER_PRICE_PER_MTOK[e.model];
    totalUsd += (e.input / 1e6) * price.input + (e.output / 1e6) * price.output;
  }
  return totalUsd;
}
