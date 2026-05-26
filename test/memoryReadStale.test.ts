import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { runMemoryInit, runMemoryWrite, runMemoryRead } from '../src/memoryCmd';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-readstale-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
  execSync('git init -q', { cwd: dir });
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  execSync('git -c user.email=t@t -c user.name=t add .', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function addDecision() {
  return runMemoryWrite({
    cwd: dir, collection: 'decisions', source: 'solution-architect',
    confidence: 1, verified: true, taskSummary: 't', runId: uuidv4(),
    files: ['a.ts'],
    bodyJson: JSON.stringify({ approach_chosen: 'x', alternatives_considered: [], trade_offs: '', gate_outcome: 'approved' }),
  });
}

describe('runMemoryRead — read-time stale (v0.10.1)', () => {
  it('_effective_stale = false when file unchanged', () => {
    addDecision();
    const r = runMemoryRead({ cwd: dir, collection: 'decisions' });
    expect((r.entries[0] as any)._effective_stale).toBe(false);
  });

  it('_effective_stale = true when file changed since context.commit', () => {
    addDecision();
    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    execSync('git -c user.email=t@t -c user.name=t commit -q -am change', { cwd: dir });
    const r = runMemoryRead({ cwd: dir, collection: 'decisions' });
    expect((r.entries[0] as any)._effective_stale).toBe(true);
  });

  it('--no-stale-check skips git diff (no _effective_stale field)', () => {
    addDecision();
    const r = runMemoryRead({ cwd: dir, collection: 'decisions', noStaleCheck: true });
    expect((r.entries[0] as any)._effective_stale).toBeUndefined();
  });
});
