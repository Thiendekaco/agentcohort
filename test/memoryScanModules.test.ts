import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runMemoryInit, runMemoryScanModules } from '../src/memoryCmd';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-scanmodules-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
  execSync('git init -q', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });

  mkdirSync(join(dir, 'src/api/users'), { recursive: true });
  writeFileSync(join(dir, 'src/api/users/index.ts'), '// users');
  mkdirSync(join(dir, 'src/auth'), { recursive: true });
  writeFileSync(join(dir, 'src/auth/index.ts'), '// auth');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runMemoryScanModules (fallback prompt path)', () => {
  it('lists module candidates without writing (claudeCli=false)', () => {
    const r = runMemoryScanModules({ cwd: dir, root: 'src', dryRun: true, claudeCli: false });
    expect(r.modules.length).toBeGreaterThanOrEqual(2);
    const modNames = r.modules.map((m) => m.module).sort();
    expect(modNames).toEqual(expect.arrayContaining(['src/api', 'src/auth']));
    expect(r.disposition).toBe('printed-prompts');
  });

  it('warns when OpenWolf anatomy.md is present', () => {
    mkdirSync(join(dir, '.wolf'));
    writeFileSync(join(dir, '.wolf/anatomy.md'), '# anatomy');
    const r = runMemoryScanModules({ cwd: dir, root: 'src', dryRun: true, claudeCli: false });
    expect(r.openWolfWarning).toBe(true);
  });

  it('no OpenWolf warning when anatomy.md absent', () => {
    const r = runMemoryScanModules({ cwd: dir, root: 'src', dryRun: true, claudeCli: false });
    expect(r.openWolfWarning).toBe(false);
  });
});
