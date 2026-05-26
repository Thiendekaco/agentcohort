import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryInit } from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-stages-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runRunStart with --stage', () => {
  it('emits stage_start event when stage + runId provided', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow' });
    runRunStart({ cwd: dir, stage: 'repo-scout', runId });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events.length).toBe(2);
    expect(events[1].event).toBe('stage_start');
    expect(events[1].stage).toBe('repo-scout');
    expect(events[1].run_id).toBe(runId);
  });

  it('rejects --stage without --run-id', () => {
    expect(() => runRunStart({ cwd: dir, stage: 'scout' } as any)).toThrow(/run.?id/i);
  });

  it('rejects --stage with --pipeline (cannot both)', () => {
    expect(() => runRunStart({ cwd: dir, stage: 'scout', pipeline: 'p', runId: '00000000-0000-4000-8000-000000000001' } as any)).toThrow(/stage|pipeline/i);
  });
});

describe('runRunEnd with --stage', () => {
  it('emits stage_end event with outcome', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow' });
    runRunStart({ cwd: dir, stage: 'repo-scout', runId });
    runRunEnd({ cwd: dir, runId, stage: 'repo-scout', outcome: 'success' });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events[2].event).toBe('stage_end');
    expect(events[2].stage).toBe('repo-scout');
    expect(events[2].outcome).toBe('success');
  });

  it('top-level end (no --stage) still works (v0.10.0 compat)', () => {
    const { runId } = runRunStart({ cwd: dir, pipeline: 'p' });
    runRunEnd({ cwd: dir, runId, outcome: 'success' });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events[1].event).toBe('end');
  });
});
