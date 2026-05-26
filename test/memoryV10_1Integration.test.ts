import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  runMemoryInit, runMemoryWrite, runMemoryRead, runMemoryScanHotspots,
  runMemoryListRuns, runMemoryCompact, runMemoryClean,
} from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';
import { runStats } from '../src/statsCmd';
import { jaccardSimilarity } from '../src/memorySimilarity';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-e2e-v10_1-'));
  execSync('git init -q', { cwd: dir });
  writeFileSync(join(dir, 'src.ts'), 'x');
  execSync('git -c user.email=t@t -c user.name=t add .', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('memory v0.10.1 end-to-end', () => {
  it('full pipeline with per-stage events + stats + similarity lookup', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });

    const { runId: r1 } = runRunStart({ cwd: dir, pipeline: 'dev-flow', tier: 3, taskSummary: 'add cache to users endpoint' });
    runRunStart({ cwd: dir, stage: 'repo-scout', runId: r1 });
    runRunEnd({ cwd: dir, runId: r1, stage: 'repo-scout', outcome: 'success' });
    runRunStart({ cwd: dir, stage: 'solution-architect', runId: r1 });
    runRunEnd({ cwd: dir, runId: r1, stage: 'solution-architect', outcome: 'success' });
    runRunEnd({ cwd: dir, runId: r1, outcome: 'success', agentsRun: ['repo-scout', 'solution-architect'] });

    const { runId: r2 } = runRunStart({ cwd: dir, pipeline: 'quick-fix', tier: 2, taskSummary: 'fix off-by-one in cache' });
    runRunEnd({ cwd: dir, runId: r2, outcome: 'success', agentsRun: ['bug-fixer'] });

    const list = runMemoryListRuns({ cwd: dir });
    expect(list.runs.length).toBe(2);

    expect(jaccardSimilarity('add cache to users endpoint', 'cache invalidation in users')).toBeGreaterThanOrEqual(0.3);

    const stats = runStats({ cwd: dir, since: '7d', compareNaive: true });
    expect(stats.totalRuns).toBe(2);
    expect(stats.estimatedCostUsd).toBeGreaterThan(0);
    expect(stats.savingsPct).toBeGreaterThanOrEqual(0);
  });

  it('hotspots derived from bugs + readable as collection', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });

    for (let i = 0; i < 3; i++) {
      runMemoryWrite({
        cwd: dir, collection: 'bugs', source: 'bug-fixer',
        confidence: 1, verified: true, taskSummary: `bug ${i}`, runId: `00000000-0000-4000-8000-00000000000${i}`,
        files: ['src.ts'],
        bodyJson: JSON.stringify({
          symptoms: 'x', root_cause: 'y', fix_summary: 'z',
          affected_files: ['src.ts'], test_added: null,
        }),
      });
    }
    runMemoryScanHotspots({ cwd: dir, threshold: 2 });
    const hot = runMemoryRead({ cwd: dir, collection: 'hotspots', noStaleCheck: true });
    expect(hot.entries.length).toBe(1);
    expect((hot.entries[0] as any).body.fragility_score).toBeCloseTo(0.3, 2);
  });

  it('compact + clean reduce on-disk footprint', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    for (let i = 0; i < 15; i++) {
      runMemoryWrite({
        cwd: dir, collection: 'decisions', source: 'solution-architect',
        confidence: 1, verified: true, taskSummary: `t${i}`, runId: `00000000-0000-4000-8000-00000000${String(i).padStart(4, '0')}`,
        files: [], bodyJson: JSON.stringify({
          approach_chosen: `a${i}`, alternatives_considered: [], trade_offs: '', gate_outcome: 'approved',
        }),
      });
    }
    runMemoryCompact({ cwd: dir, collection: 'decisions', keepLast: 3 });
    const after = readJsonl<any>(join(dir, '.agentcohort/memory/shared/decisions.jsonl'));
    expect(after.length).toBe(4);

    const cleaned = runMemoryClean({ cwd: dir, olderThan: '30d', orphans: true });
    expect(cleaned.removedCount).toBe(0);
  });
});
