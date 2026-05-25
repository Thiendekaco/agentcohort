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
