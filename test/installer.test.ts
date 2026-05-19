import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInit, InitOptions } from '../src/installer';
import type { ConflictResolver } from '../src/prompt';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const FIXED_NOW = () => new Date(2024, 2, 9, 10, 11, 12); // 2024-03-09 10:11:12

const tmps: string[] = [];
function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-install-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function baseOpts(cwd: string, over: Partial<InitOptions> = {}): InitOptions {
  return {
    cwd,
    yes: true,
    dryRun: false,
    force: false,
    backup: false,
    interactive: false,
    now: FIXED_NOW,
    templatesDir: TEMPLATES,
    ...over,
  };
}

describe('runInit - fresh project', () => {
  it('creates all 15 agents, 7 commands and CLAUDE.md', async () => {
    const cwd = project();
    const result = await runInit(baseOpts(cwd));

    const agents = readdirSync(join(cwd, '.claude', 'agents'));
    const commands = readdirSync(join(cwd, '.claude', 'commands'));
    expect(agents.length).toBe(15);
    expect(commands.length).toBe(7);
    expect(agents).toContain('repo-scout.md');
    expect(commands).toContain('auto-flow.md');

    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('# Agentcohort Routing Rules');
    expect(claude).toContain('# Project Guidance for Claude Code');

    expect(result.actions.every((a) => a.disposition === 'created')).toBe(true);
    expect(result.actions.some((a) => a.backupPath)).toBe(false);

    // installed content equals the bundled template
    const tpl = readFileSync(join(TEMPLATES, 'agents', 'repo-scout.md'), 'utf8');
    expect(readFileSync(join(cwd, '.claude/agents/repo-scout.md'), 'utf8')).toBe(tpl);
  });

  it('is idempotent: a second run reports everything unchanged', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const second = await runInit(baseOpts(cwd));
    expect(second.actions.every((a) => a.disposition === 'unchanged')).toBe(true);
    expect(second.actions.some((a) => a.backupPath)).toBe(false);
  });
});

describe('runInit - dry run', () => {
  it('writes nothing but reports the would-be creations', async () => {
    const cwd = project();
    const result = await runInit(baseOpts(cwd, { dryRun: true }));
    expect(existsSync(join(cwd, '.claude'))).toBe(false);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.actions.every((a) => a.disposition === 'created' && a.dryRun)).toBe(
      true
    );
  });
});

describe('runInit - conflicts on a regular file', () => {
  function seedDifferentAgent(cwd: string): string {
    const p = join(cwd, '.claude', 'agents', 'repo-scout.md');
    mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(p, 'OLD USER CONTENT\n', 'utf8');
    return p;
  }

  it('--yes safe default backs up then overwrites (no data loss)', async () => {
    const cwd = project();
    const p = seedDifferentAgent(cwd);
    const result = await runInit(baseOpts(cwd));

    const rec = result.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec.disposition).toBe('overwritten');
    expect(rec.backupPath).toBeDefined();
    expect(readFileSync(rec.backupPath!, 'utf8')).toBe('OLD USER CONTENT\n');
    expect(readFileSync(p, 'utf8')).toBe(
      readFileSync(join(TEMPLATES, 'agents', 'repo-scout.md'), 'utf8')
    );
  });

  it('--force overwrites WITHOUT a backup unless --backup is set', async () => {
    const cwd = project();
    seedDifferentAgent(cwd);
    const r1 = await runInit(baseOpts(cwd, { force: true }));
    const rec1 = r1.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec1.disposition).toBe('overwritten');
    expect(rec1.backupPath).toBeUndefined();

    seedDifferentAgent(cwd);
    const r2 = await runInit(baseOpts(cwd, { force: true, backup: true }));
    const rec2 = r2.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec2.backupPath).toBeDefined();
    expect(existsSync(rec2.backupPath!)).toBe(true);
  });

  it('interactive "skip" preserves the user file and never deletes it', async () => {
    const cwd = project();
    const p = seedDifferentAgent(cwd);
    const skip: ConflictResolver = async () => ({ choice: 'skip', applyToAll: true });
    const result = await runInit(
      baseOpts(cwd, { yes: false, interactive: true, resolver: skip })
    );
    const rec = result.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec.disposition).toBe('skipped');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('OLD USER CONTENT\n');
  });

  it('dry-run on a conflict reports the action but writes/backs-up nothing', async () => {
    const cwd = project();
    const p = seedDifferentAgent(cwd);
    const result = await runInit(baseOpts(cwd, { dryRun: true }));
    const rec = result.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec.disposition).toBe('overwritten');
    expect(rec.backupPath).toBeDefined();
    expect(existsSync(rec.backupPath!)).toBe(false); // not actually written
    expect(readFileSync(p, 'utf8')).toBe('OLD USER CONTENT\n'); // untouched
  });
});

describe('runInit - CLAUDE.md handling', () => {
  it('appends the section to an existing CLAUDE.md without losing user content', async () => {
    const cwd = project();
    const original = '# My Project\n\nImportant project notes the user wrote.\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), original, 'utf8');

    const result = await runInit(baseOpts(cwd));
    const rec = result.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('appended-section');
    expect(rec.backupPath).toBeUndefined(); // append is non-destructive

    const after = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('Important project notes the user wrote.');
    expect(after).toContain('# Agentcohort Routing Rules');
  });

  it('non-interactive leaves a DIFFERING existing section untouched (skip)', async () => {
    const cwd = project();
    const doc =
      '# My Project\n\nnotes\n\n# Agentcohort Routing Rules\n\nMY CUSTOM RULES\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), doc, 'utf8');

    const result = await runInit(baseOpts(cwd));
    const rec = result.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('skipped');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(doc);
  });

  it('--force replaces the section but preserves surrounding content', async () => {
    const cwd = project();
    const doc =
      '# My Project\n\nkeep me\n\n# Agentcohort Routing Rules\n\nOLD RULES\n\n# Other\n\nkeep me too\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), doc, 'utf8');

    const result = await runInit(baseOpts(cwd, { force: true }));
    const rec = result.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('replaced-section');

    const after = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('keep me');
    expect(after).toContain('keep me too');
    expect(after).toContain('# Other');
    expect(after).not.toContain('OLD RULES');
    expect(after.match(/# Agentcohort Routing Rules/g)?.length).toBe(1);
  });

  it('reports the section unchanged on a second run (idempotent)', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const second = await runInit(baseOpts(cwd));
    const rec = second.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('unchanged');
  });
});
