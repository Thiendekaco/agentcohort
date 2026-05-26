import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { runMemoryInit, runMemoryClean } from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';
import { readJsonl, appendJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-clean-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const INDEX = () => join(dir, '.agentcohort/runs/INDEX.jsonl');
const runDirOf = (runId: string) => join(dir, '.agentcohort/runs', runId);

describe('runMemoryClean', () => {
  it('no-op when no runs exist', () => {
    const r = runMemoryClean({ cwd: dir });
    expect(r.removedCount).toBe(0);
  });

  it('removes runs older than the cutoff', () => {
    const oldId = uuidv4();
    const oldTs = new Date(Date.now() - 31 * 86_400_000).toISOString();
    appendJsonl(INDEX(), { event: 'start', run_id: oldId, ts: oldTs, pipeline: 'p' });
    appendJsonl(INDEX(), { event: 'end',   run_id: oldId, ts: oldTs, outcome: 'success' });
    mkdirSync(runDirOf(oldId), { recursive: true });
    writeFileSync(join(runDirOf(oldId), 'scratch.jsonl'), '');

    const { runId: newId } = runRunStart({ cwd: dir, pipeline: 'p' });
    runRunEnd({ cwd: dir, runId: newId, outcome: 'success' });

    const r = runMemoryClean({ cwd: dir, olderThan: '30d' });
    expect(r.removedCount).toBe(1);
    expect(existsSync(runDirOf(oldId))).toBe(false);
  });

  it('--orphans detects start-without-end older than 1 hour', () => {
    const orphanId = uuidv4();
    const orphanTs = new Date(Date.now() - 2 * 3_600_000).toISOString();
    appendJsonl(INDEX(), { event: 'start', run_id: orphanId, ts: orphanTs, pipeline: 'p' });
    mkdirSync(runDirOf(orphanId), { recursive: true });

    const r = runMemoryClean({ cwd: dir, orphans: true });
    expect(r.removedCount).toBe(1);
    expect(existsSync(runDirOf(orphanId))).toBe(false);
  });

  it('--orphans respects 1-hour grace period', () => {
    const freshId = uuidv4();
    appendJsonl(INDEX(), { event: 'start', run_id: freshId, ts: new Date().toISOString(), pipeline: 'p' });
    mkdirSync(runDirOf(freshId), { recursive: true });

    const r = runMemoryClean({ cwd: dir, orphans: true });
    expect(r.removedCount).toBe(0);
    expect(existsSync(runDirOf(freshId))).toBe(true);
  });

  it('--dry-run does not delete', () => {
    const oldId = uuidv4();
    const oldTs = new Date(Date.now() - 31 * 86_400_000).toISOString();
    appendJsonl(INDEX(), { event: 'start', run_id: oldId, ts: oldTs, pipeline: 'p' });
    appendJsonl(INDEX(), { event: 'end', run_id: oldId, ts: oldTs, outcome: 'success' });
    mkdirSync(runDirOf(oldId), { recursive: true });

    const r = runMemoryClean({ cwd: dir, olderThan: '30d', dryRun: true });
    expect(r.removedCount).toBe(1);
    expect(existsSync(runDirOf(oldId))).toBe(true);
  });
});
