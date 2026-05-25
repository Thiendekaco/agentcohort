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

import { runMemoryWrite } from '../src/memoryCmd';
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
