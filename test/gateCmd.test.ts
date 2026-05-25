import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { runMemoryInit } from '../src/memoryCmd';
import { runGateRecord } from '../src/gateCmd';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-gate-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
  execSync('git init -q', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runGateRecord', () => {
  it('writes an audit entry on approved (no reason)', () => {
    const r = runGateRecord({
      cwd: dir, runId: uuidv4(), gate: 'architect', outcome: 'approved',
      proposedContent: 'use Redis', posingAgent: 'solution-architect',
    });
    expect(r.disposition).toBe('written');
    const audit = readJsonl<any>(join(dir, '.agentcohort/memory/shared/audit.jsonl'));
    expect(audit.length).toBe(1);
    expect(audit[0].body.gate).toBe('architect');
    expect(audit[0].body.outcome).toBe('approved');
    expect(audit[0].body.reason).toBeNull();
    expect(audit[0].source).toBe('dispatcher');
  });
  it('writes reason on reject', () => {
    const r = runGateRecord({
      cwd: dir, runId: uuidv4(), gate: 'architect', outcome: 'rejected',
      proposedContent: 'use Redis', posingAgent: 'solution-architect',
      reason: 'no new infra dependencies allowed this quarter',
    });
    expect(r.disposition).toBe('written');
    const audit = readJsonl<any>(join(dir, '.agentcohort/memory/shared/audit.jsonl'));
    expect(audit[0].body.reason).toContain('no new infra');
  });
  it('rejects when reason missing on reject', () => {
    const r = runGateRecord({
      cwd: dir, runId: uuidv4(), gate: 'plan', outcome: 'rejected',
      proposedContent: 'plan', posingAgent: 'feature-planner',
    });
    expect(r.disposition).toBe('rejected-missing-reason');
  });
  it('rejects when reason missing on escalate', () => {
    const r = runGateRecord({
      cwd: dir, runId: uuidv4(), gate: 'plan', outcome: 'escalated',
      proposedContent: 'plan', posingAgent: 'feature-planner',
    });
    expect(r.disposition).toBe('rejected-missing-reason');
  });
});
