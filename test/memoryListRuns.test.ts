import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryInit, runMemoryListRuns } from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-listruns-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runMemoryListRuns', () => {
  it('returns [] when INDEX is empty', () => {
    const r = runMemoryListRuns({ cwd: dir });
    expect(r.runs).toEqual([]);
  });

  it('joins start + end events by run_id', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'quick-fix', tier: 2 });
    runRunEnd({ cwd: dir, runId, outcome: 'success', agentsRun: ['bug-fixer'] });
    const r = runMemoryListRuns({ cwd: dir });
    expect(r.runs.length).toBe(1);
    expect(r.runs[0].run_id).toBe(runId);
    expect(r.runs[0].pipeline).toBe('quick-fix');
    expect(r.runs[0].outcome).toBe('success');
    expect(r.runs[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(r.runs[0].agents_run).toEqual(['bug-fixer']);
  });

  it('marks orphan runs (start without end) with outcome=running', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow' });
    const r = runMemoryListRuns({ cwd: dir });
    expect(r.runs.length).toBe(1);
    expect(r.runs[0].run_id).toBe(runId);
    expect(r.runs[0].outcome).toBe('running');
    expect(r.runs[0].duration_ms).toBeNull();
  });

  it('--limit returns the most recent N (sorted newest first)', () => {
    for (let i = 0; i < 5; i++) {
      const { runId } = runRunStart({ cwd: dir, pipeline: 'p' });
      runRunEnd({ cwd: dir, runId, outcome: 'success' });
    }
    const r = runMemoryListRuns({ cwd: dir, limit: 3 });
    expect(r.runs.length).toBe(3);
  });

  it('--since filters by start ts', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'p' });
    runRunEnd({ cwd: dir, runId, outcome: 'success' });
    const r = runMemoryListRuns({ cwd: dir, since: '1d' });
    expect(r.runs.length).toBe(1);
  });
});
