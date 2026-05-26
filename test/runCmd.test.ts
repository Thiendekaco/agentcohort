import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryInit } from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-run-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runRunStart', () => {
  it('returns a UUIDv4 and appends a start event', () => {
    const r = runRunStart({ cwd: dir, pipeline: 'quick-fix', tier: 2, taskSummary: 'fix x' });
    expect(r.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('start');
    expect(events[0].run_id).toBe(r.runId);
    expect(events[0].pipeline).toBe('quick-fix');
    expect(events[0].tier).toBe(2);
    expect(events[0].task_summary).toBe('fix x');
  });
  it('two starts produce two different uuids', () => {
    const a = runRunStart({ cwd: dir, pipeline: 'p' });
    const b = runRunStart({ cwd: dir, pipeline: 'p' });
    expect(a.runId).not.toBe(b.runId);
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events.length).toBe(2);
  });
  it('start event omits optional fields when not given', () => {
    const r = runRunStart({ cwd: dir, pipeline: 'p' });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events[0].tier).toBeUndefined();
    expect(events[0].task_summary).toBeUndefined();
  });
});

describe('runRunEnd', () => {
  it('appends an end event matching the run_id', () => {
    const start = runRunStart({ cwd: dir, pipeline: 'dev-flow' });
    runRunEnd({ cwd: dir, runId: start.runId, outcome: 'success', agentsRun: ['scout', 'architect'] });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events.length).toBe(2);
    expect(events[1].event).toBe('end');
    expect(events[1].run_id).toBe(start.runId);
    expect(events[1].outcome).toBe('success');
    expect(events[1].agents_run).toEqual(['scout', 'architect']);
  });
  it('records gates_fired when provided', () => {
    const start = runRunStart({ cwd: dir, pipeline: 'dev-flow' });
    runRunEnd({ cwd: dir, runId: start.runId, outcome: 'aborted', gatesFired: ['architect'] });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events[1].gates_fired).toEqual(['architect']);
    expect(events[1].outcome).toBe('aborted');
  });
});
