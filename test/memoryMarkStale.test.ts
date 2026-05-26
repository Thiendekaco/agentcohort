import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { runMemoryInit, runMemoryWrite, runMemoryMarkStale } from '../src/memoryCmd';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-stale-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
  execSync('git init -q', { cwd: dir });
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  execSync('git -c user.email=t@t -c user.name=t add .', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeDecision(files: string[]) {
  return runMemoryWrite({
    cwd: dir, collection: 'decisions', source: 'solution-architect',
    confidence: 1, verified: true, taskSummary: 't', runId: uuidv4(), files,
    bodyJson: JSON.stringify({ approach_chosen: 'x', alternatives_considered: [], trade_offs: '', gate_outcome: 'approved' }),
  });
}

describe('runMemoryMarkStale', () => {
  it('--id marks one entry', () => {
    const w = makeDecision(['a.ts']);
    const r = runMemoryMarkStale({ cwd: dir, mode: { kind: 'id', id: w.entryId! } });
    expect(r.markedCount).toBe(1);
    const entries = readJsonl<any>(join(dir, '.agentcohort/memory/shared/decisions.jsonl'));
    expect(entries[0].stale).toBe(true);
  });

  it('--filter=files=a.ts marks every entry referencing a.ts', () => {
    makeDecision(['a.ts']);
    makeDecision(['b.ts']);
    const r = runMemoryMarkStale({ cwd: dir, mode: { kind: 'filter', files: 'a.ts' } });
    expect(r.markedCount).toBe(1);
  });

  it('--auto marks entries whose files have changed since context.commit', () => {
    makeDecision(['a.ts']);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    execSync('git -c user.email=t@t -c user.name=t commit -q -am change', { cwd: dir });
    const r = runMemoryMarkStale({ cwd: dir, mode: { kind: 'auto' } });
    expect(r.markedCount).toBe(1);
  });

  it('--auto is a no-op when nothing has changed', () => {
    makeDecision(['a.ts']);
    const r = runMemoryMarkStale({ cwd: dir, mode: { kind: 'auto' } });
    expect(r.markedCount).toBe(0);
  });

  it('--unstale flips back to false', () => {
    const w = makeDecision(['a.ts']);
    runMemoryMarkStale({ cwd: dir, mode: { kind: 'id', id: w.entryId! } });
    const r2 = runMemoryMarkStale({ cwd: dir, mode: { kind: 'id', id: w.entryId! }, unstale: true });
    expect(r2.markedCount).toBe(1);
    const entries = readJsonl<any>(join(dir, '.agentcohort/memory/shared/decisions.jsonl'));
    expect(entries[0].stale).toBe(false);
  });

  it('--dry-run does not modify the file', () => {
    const w = makeDecision(['a.ts']);
    const r = runMemoryMarkStale({ cwd: dir, mode: { kind: 'id', id: w.entryId! }, dryRun: true });
    expect(r.markedCount).toBe(1);
    const entries = readJsonl<any>(join(dir, '.agentcohort/memory/shared/decisions.jsonl'));
    expect(entries[0].stale).toBe(false);
  });

  it('--id no-op when target already has the desired stale state', () => {
    const w = makeDecision(['a.ts']);
    runMemoryMarkStale({ cwd: dir, mode: { kind: 'id', id: w.entryId! } });
    const r2 = runMemoryMarkStale({ cwd: dir, mode: { kind: 'id', id: w.entryId! } });
    expect(r2.markedCount).toBe(0);
  });
});
