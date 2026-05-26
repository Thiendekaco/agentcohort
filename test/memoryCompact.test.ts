import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { runMemoryInit, runMemoryWrite, runMemoryCompact } from '../src/memoryCmd';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-compact-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
  execSync('git init -q', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function addDecision(idx: number) {
  return runMemoryWrite({
    cwd: dir, collection: 'decisions', source: 'solution-architect',
    confidence: 1, verified: true, taskSummary: `t${idx}`, runId: uuidv4(),
    files: [], bodyJson: JSON.stringify({
      approach_chosen: `approach ${idx}`, alternatives_considered: [],
      trade_offs: '', gate_outcome: 'approved',
    }),
  });
}

describe('runMemoryCompact', () => {
  it('no-op when fewer than 10 old entries qualify', () => {
    for (let i = 0; i < 5; i++) addDecision(i);
    const r = runMemoryCompact({ cwd: dir, keepLast: 0 });
    expect(r.compactedCount).toBe(0);
  });

  it('merges old entries into 1 compacted entry, keeps last N', () => {
    for (let i = 0; i < 20; i++) addDecision(i);
    const r = runMemoryCompact({ cwd: dir, keepLast: 5 });
    expect(r.compactedCount).toBe(1);
    const after = readJsonl<any>(join(dir, '.agentcohort/memory/shared/decisions.jsonl'));
    // 1 compacted + 5 kept = 6 entries
    expect(after.length).toBe(6);
    const compacted = after.find((e: any) => e.body?._compacted);
    expect(compacted).toBeDefined();
    expect(compacted.body.merged_count).toBe(15);
    expect(compacted.body.id_range).toHaveLength(2);
  });

  it('refuses to compact audit collection', () => {
    const r = runMemoryCompact({ cwd: dir, collection: 'audit', keepLast: 0 });
    expect(r.compactedCount).toBe(0);
    expect(r.skippedAudit).toBe(true);
  });

  it('refuses to compact verifications collection', () => {
    const r = runMemoryCompact({ cwd: dir, collection: 'verifications', keepLast: 0 });
    expect(r.compactedCount).toBe(0);
    expect(r.skippedAudit).toBe(true);
  });

  it('--dry-run writes nothing', () => {
    for (let i = 0; i < 20; i++) addDecision(i);
    const r = runMemoryCompact({ cwd: dir, keepLast: 5, dryRun: true });
    expect(r.compactedCount).toBe(1);
    const after = readJsonl<any>(join(dir, '.agentcohort/memory/shared/decisions.jsonl'));
    expect(after.length).toBe(20);
  });
});
