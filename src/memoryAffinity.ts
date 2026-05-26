/**
 * Memory affinity — which agents read/write which collections.
 *
 * Why this exists: every agent's boot directive lists "your reads:" and
 * "your writes:" so the agent knows EXACTLY which memory subcommands to
 * call. Without affinity, agents would either read everything (token
 * waste) or guess (wrong collection writes).
 *
 * Resolution rules:
 *  - DEFAULT_MEMORY_AFFINITY covers every bundled agent.
 *  - User-supplied `memoryAffinity` in `.agentcohort.json` MERGES with
 *    the defaults — listed user entries replace the default for that
 *    agent; entries not in the user config keep their default.
 *  - Agents not in either map default to `{ reads: [], writes: [] }`
 *    (no memory wiring — agent won't pollute or query).
 *
 * Mirrors the `skillAffinity` pattern in src/skillAffinity.ts.
 */

export interface MemoryAffinityEntry {
  reads: string[];
  writes: string[];
}

export type MemoryAffinityMap = Readonly<Record<string, MemoryAffinityEntry>>;

export const DEFAULT_MEMORY_AFFINITY: MemoryAffinityMap = {
  'repo-scout':            { reads: ['scratch', 'module-map', 'conventions'],   writes: ['scratch'] },
  'solution-architect':    { reads: ['decisions', 'scratch', 'conventions'],    writes: ['decisions', 'scratch'] },
  'feature-planner':       { reads: ['scratch', 'conventions'],                 writes: ['scratch'] },
  'feature-implementer':   { reads: ['scratch', 'conventions'],                 writes: ['scratch'] },
  'test-verifier':         { reads: ['scratch'],                                writes: ['scratch', 'verifications'] },
  'final-reviewer':        { reads: ['scratch', 'conventions'],                 writes: ['scratch', 'verifications', 'conventions'] },
  'bug-hunter':            { reads: ['bugs', 'scratch', 'hotspots'],            writes: ['scratch'] },
  'root-cause-analyst':    { reads: ['bugs', 'scratch'],                        writes: ['scratch'] },
  'reproduction-engineer': { reads: ['scratch'],                                writes: ['scratch'] },
  'regression-guard':      { reads: ['bugs', 'scratch', 'hotspots'],            writes: ['scratch', 'verifications'] },
  'bug-fixer':             { reads: ['bugs', 'scratch', 'hotspots'],            writes: ['bugs', 'scratch'] },
  'performance-hunter':    { reads: ['scratch', 'hotspots'],                    writes: ['scratch'] },
  'perf-optimizer':        { reads: ['scratch'],                                writes: ['scratch'] },
  'perf-reviewer':         { reads: ['scratch'],                                writes: ['scratch'] },
  'expert-council':        { reads: ['decisions', 'bugs', 'scratch'],           writes: ['scratch', 'audit'] },
  'dispatcher':            { reads: ['audit', 'hotspots'],                      writes: ['audit'] },
};

export function resolveMemoryAffinity(
  user: Record<string, MemoryAffinityEntry> | undefined,
): MemoryAffinityMap {
  if (!user) return DEFAULT_MEMORY_AFFINITY;
  return { ...DEFAULT_MEMORY_AFFINITY, ...user };
}

export function affinityFor(
  agent: string,
  user: Record<string, MemoryAffinityEntry> | undefined,
): MemoryAffinityEntry {
  const map = resolveMemoryAffinity(user);
  return map[agent] ?? { reads: [], writes: [] };
}
