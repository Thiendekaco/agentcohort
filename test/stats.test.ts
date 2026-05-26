import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryInit } from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';
import { runStats } from '../src/statsCmd';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-stats-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runStats', () => {
  it('returns empty stats when INDEX is empty', () => {
    const r = runStats({ cwd: dir });
    expect(r.totalRuns).toBe(0);
    expect(r.perPipeline).toEqual({});
  });

  it('aggregates per-pipeline counts + outcomes', () => {
    for (let i = 0; i < 3; i++) {
      const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow', tier: 3 });
      runRunEnd({ cwd: dir, runId, outcome: 'success', agentsRun: ['repo-scout', 'solution-architect', 'final-reviewer'] });
    }
    for (let i = 0; i < 2; i++) {
      const { runId } = runRunStart({ cwd: dir, pipeline: 'quick-fix', tier: 2 });
      runRunEnd({ cwd: dir, runId, outcome: 'success', agentsRun: ['bug-fixer'] });
    }
    const r = runStats({ cwd: dir });
    expect(r.totalRuns).toBe(5);
    expect(r.perPipeline['dev-flow'].count).toBe(3);
    expect(r.perPipeline['quick-fix'].count).toBe(2);
  });

  it('computes token estimate via static table', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow', tier: 3 });
    runRunEnd({ cwd: dir, runId, outcome: 'success', agentsRun: ['solution-architect'] });
    const r = runStats({ cwd: dir });
    // solution-architect: 8000*15/1e6 + 2500*75/1e6 = 0.12 + 0.1875 = 0.3075
    expect(r.estimatedCostUsd).toBeCloseTo(0.3075, 2);
  });

  it('--compare-naive computes hypothetical full-pipeline cost', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'quick-fix', tier: 2 });
    runRunEnd({ cwd: dir, runId, outcome: 'success', agentsRun: ['bug-fixer', 'regression-guard', 'test-verifier', 'final-reviewer'] });
    const r = runStats({ cwd: dir, compareNaive: true });
    expect(r.naiveEstimatedCostUsd).toBeDefined();
    expect(r.naiveEstimatedCostUsd!).toBeGreaterThan(r.estimatedCostUsd);
    expect(r.savingsPct).toBeGreaterThanOrEqual(0);
  });

  it('--since filters by ts', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow' });
    runRunEnd({ cwd: dir, runId, outcome: 'success' });
    const r = runStats({ cwd: dir, since: '1d' });
    expect(r.totalRuns).toBe(1);
  });
});
