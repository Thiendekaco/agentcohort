import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryInit } from '../src/memoryCmd';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentcohort-memcmd-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runMemoryInit', () => {
  it('creates the directory layout', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    expect(existsSync(join(dir, '.agentcohort', 'memory', 'shared'))).toBe(true);
    expect(existsSync(join(dir, '.agentcohort', 'memory', 'local'))).toBe(true);
    expect(existsSync(join(dir, '.agentcohort', 'runs'))).toBe(true);
    expect(existsSync(join(dir, '.agentcohort', 'memory', 'local', '.gitkeep'))).toBe(true);
  });
  it('updates .gitignore with local + runs entries (default mode)', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('.agentcohort/memory/local/');
    expect(gi).toContain('.agentcohort/runs/');
  });
  it('mode=commit-all skips .gitignore additions', () => {
    runMemoryInit({ cwd: dir, mode: 'commit-all' });
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });
  it('mode=gitignore-all writes .agentcohort/ to .gitignore', () => {
    runMemoryInit({ cwd: dir, mode: 'gitignore-all' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('.agentcohort/');
    expect(gi).not.toContain('.agentcohort/memory/local/');
  });
  it('idempotent — re-running on initialized dir is a no-op', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    const r2 = runMemoryInit({ cwd: dir, mode: 'default' });
    expect(r2.created).toEqual([]);
    expect(r2.alreadyPresent.length).toBeGreaterThan(0);
  });
  it('does not duplicate .gitignore entries on re-run', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    runMemoryInit({ cwd: dir, mode: 'default' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    const occurrences = (gi.match(/\.agentcohort\/runs\//g) ?? []).length;
    expect(occurrences).toBe(1);
  });
  it('appends to existing .gitignore without clobbering', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    runMemoryInit({ cwd: dir, mode: 'default' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('.agentcohort/runs/');
  });
});

import { runMemoryWrite, runMemoryRead } from '../src/memoryCmd';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'node:child_process';

describe('runMemoryWrite', () => {
  beforeEach(() => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    // Make `dir` a real git repo so context.commit auto-fill works.
    execSync('git init -q', { cwd: dir });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  });

  function validWriteOpts(overrides: Partial<Parameters<typeof runMemoryWrite>[0]> = {}) {
    return {
      cwd: dir,
      collection: 'decisions',
      bodyJson: JSON.stringify({
        approach_chosen: 'use Redis', alternatives_considered: ['in-memory'],
        trade_offs: 'higher infra cost', gate_outcome: 'approved',
      }),
      source: 'solution-architect',
      confidence: 0.9,
      verified: true,
      taskSummary: 'add caching to /users endpoint',
      runId: uuidv4(),
      files: ['src/users.ts'],
      ...overrides,
    } as const;
  }

  it('writes a valid entry to the right file', () => {
    const r = runMemoryWrite(validWriteOpts());
    expect(r.disposition).toBe('written');
    const text = readFileSync(
      join(dir, '.agentcohort/memory/shared/decisions.jsonl'), 'utf8',
    );
    const entry = JSON.parse(text.trim());
    expect(entry.body.approach_chosen).toBe('use Redis');
    expect(entry.source).toBe('solution-architect');
    expect(entry.context.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('rejects malformed body JSON', () => {
    const r = runMemoryWrite(validWriteOpts({ bodyJson: 'not-json' }));
    expect(r.disposition).toBe('rejected-malformed');
  });
  it('rejects body that fails schema', () => {
    const r = runMemoryWrite(validWriteOpts({
      bodyJson: JSON.stringify({ approach_chosen: 'x' }),
    }));
    expect(r.disposition).toBe('rejected-schema');
  });
  it('rejects entries containing a secret', () => {
    const r = runMemoryWrite(validWriteOpts({
      bodyJson: JSON.stringify({
        approach_chosen: 'use key AKIAIOSFODNN7EXAMPLE',
        alternatives_considered: [], trade_offs: 'use key AKIAIOSFODNN7EXAMPLE for s3', gate_outcome: 'approved',
      }),
    }));
    expect(r.disposition).toBe('rejected-secret');
    expect(r.secretMatches?.[0].patternName).toBe('aws-access-key-id');
  });
  it('rejects unknown collection', () => {
    const r = runMemoryWrite(validWriteOpts({ collection: 'unknown' as any }));
    expect(r.disposition).toBe('rejected-collection');
  });
  it('writes scratch.jsonl to the right per-run path', () => {
    const runId = uuidv4();
    const r = runMemoryWrite({
      ...validWriteOpts(),
      collection: 'scratch',
      bodyJson: JSON.stringify({ stage: 'scout', key: 'files_touched', value: ['src/x.ts'] }),
      runId,
    });
    expect(r.disposition).toBe('written');
    expect(existsSync(
      join(dir, '.agentcohort/runs', runId, 'scratch.jsonl'),
    )).toBe(true);
  });
  it('refuses scratch write without --run-id', () => {
    const r = runMemoryWrite({
      ...validWriteOpts(),
      collection: 'scratch',
      bodyJson: JSON.stringify({ stage: 'scout', key: 'k', value: 1 }),
      runId: undefined,
    });
    expect(r.disposition).toBe('rejected-no-run-id');
  });
});

describe('runMemoryRead', () => {
  beforeEach(() => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    execSync('git init -q', { cwd: dir });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  });

  it('returns [] when collection file is missing', () => {
    const r = runMemoryRead({ cwd: dir, collection: 'decisions' });
    expect(r.entries).toEqual([]);
  });

  it('returns entries in insertion order, last N entries when limit applied', () => {
    for (let i = 0; i < 5; i++) {
      runMemoryWrite({
        cwd: dir, collection: 'decisions', source: 'solution-architect',
        confidence: 1, verified: true,
        taskSummary: `t${i}`, runId: uuidv4(), files: [],
        bodyJson: JSON.stringify({
          approach_chosen: `a${i}`, alternatives_considered: [], trade_offs: '',
          gate_outcome: 'approved',
        }),
      });
    }
    const r = runMemoryRead({ cwd: dir, collection: 'decisions', limit: 3 });
    expect(r.entries.length).toBe(3);
    expect(r.entries.map((e: any) => e.body.approach_chosen)).toEqual(['a2', 'a3', 'a4']);
  });

  it('filter=source=human returns only human entries', () => {
    runMemoryWrite({
      cwd: dir, collection: 'decisions', source: 'human',
      confidence: 1, verified: true, taskSummary: 'h', runId: uuidv4(), files: [],
      bodyJson: JSON.stringify({ approach_chosen: 'h', alternatives_considered: [], trade_offs: '', gate_outcome: 'approved' }),
    });
    runMemoryWrite({
      cwd: dir, collection: 'decisions', source: 'solution-architect',
      confidence: 1, verified: true, taskSummary: 'a', runId: uuidv4(), files: [],
      bodyJson: JSON.stringify({ approach_chosen: 'a', alternatives_considered: [], trade_offs: '', gate_outcome: 'approved' }),
    });
    const r = runMemoryRead({ cwd: dir, collection: 'decisions', filters: { source: 'human' } });
    expect(r.entries.length).toBe(1);
    expect((r.entries[0] as any).source).toBe('human');
  });

  it('--with-verifications joins latest verification by target_id', () => {
    const targetRunId = uuidv4();
    const w = runMemoryWrite({
      cwd: dir, collection: 'bugs', source: 'bug-fixer',
      confidence: 0.7, verified: false, taskSummary: 'bug t', runId: targetRunId, files: [],
      bodyJson: JSON.stringify({
        symptoms: 'x', root_cause: 'y', fix_summary: 'z',
        affected_files: [], test_added: null,
      }),
    });
    expect(w.disposition).toBe('written');
    runMemoryWrite({
      cwd: dir, collection: 'verifications', source: 'test-verifier',
      confidence: 1, verified: true, taskSummary: 'verify', runId: targetRunId, files: [],
      bodyJson: JSON.stringify({
        target_id: w.entryId, target_collection: 'bugs',
        verified: true, evidence: 'tests passed', by_stage: 'test-verifier',
      }),
    });
    const r = runMemoryRead({ cwd: dir, collection: 'bugs', withVerifications: true });
    expect((r.entries[0] as any)._effective_verified).toBe(true);
    expect((r.entries[0] as any)._verification_evidence).toBe('tests passed');
  });

  it('--with-verifications uses LATEST verification when multiple exist (refute pattern)', async () => {
    const targetRunId = uuidv4();
    const w = runMemoryWrite({
      cwd: dir, collection: 'bugs', source: 'bug-fixer',
      confidence: 0.7, verified: false, taskSummary: 'bug', runId: targetRunId, files: [],
      bodyJson: JSON.stringify({
        symptoms: 'x', root_cause: 'y', fix_summary: 'z',
        affected_files: [], test_added: null,
      }),
    });
    runMemoryWrite({
      cwd: dir, collection: 'verifications', source: 'test-verifier',
      confidence: 1, verified: true, taskSummary: 'v1', runId: targetRunId, files: [],
      bodyJson: JSON.stringify({
        target_id: w.entryId, target_collection: 'bugs',
        verified: true, evidence: 'first pass', by_stage: 'test-verifier',
      }),
    });
    // Sleep 5ms to ensure ts ordering is deterministic.
    await new Promise(r => setTimeout(r, 5));
    runMemoryWrite({
      cwd: dir, collection: 'verifications', source: 'regression-guard',
      confidence: 1, verified: true, taskSummary: 'v2', runId: targetRunId, files: [],
      bodyJson: JSON.stringify({
        target_id: w.entryId, target_collection: 'bugs',
        verified: false, evidence: 'regressed later', by_stage: 'regression-guard',
      }),
    });
    const r = runMemoryRead({ cwd: dir, collection: 'bugs', withVerifications: true });
    expect((r.entries[0] as any)._effective_verified).toBe(false);
    expect((r.entries[0] as any)._verification_evidence).toBe('regressed later');
  });
});

