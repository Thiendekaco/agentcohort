import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runUninstall } from '../src/uninstall';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';
import { hasSection } from '../src/claudeMd';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-uninstall-'));
  tmps.push(d);
  return d;
}

afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

async function fullInstall(cwd: string): Promise<void> {
  await runInit({
    cwd,
    yes: true,
    dryRun: false,
    force: false,
    backup: false,
    interactive: false,
    now: () => new Date(2026, 4, 20, 12, 0, 0),
    templatesDir: TEMPLATES,
    models: { ...DEFAULT_MODELS },
  });
}

describe('runUninstall — happy path (defaults)', () => {
  it('removes every bundled file and strips the CLAUDE.md section', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const agentDir = join(cwd, '.claude', 'agents');
    const cmdDir = join(cwd, '.claude', 'commands');
    const beforeAgents = readdirSync(agentDir).length;
    const beforeCommands = readdirSync(cmdDir).length;
    expect(beforeAgents).toBeGreaterThan(0);
    expect(beforeCommands).toBeGreaterThan(0);

    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.summary.removedFiles).toBe(beforeAgents + beforeCommands);
    expect(result.summary.sectionRemoved).toBe(true);
    expect(result.summary.configRemoved).toBe(false);

    expect(readdirSync(agentDir).length).toBe(0);
    expect(readdirSync(cmdDir).length).toBe(0);
    const claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(hasSection(claudeMd)).toBe(false);
  });
});

describe('runUninstall — preserves user-authored files', () => {
  it('keeps a user-authored agent untouched', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const userFile = join(cwd, '.claude', 'agents', 'my-helper.md');
    const userBody = '---\nname: my-helper\ndescription: mine\ntools: Read\nmodel: haiku\n---\n\nbody\n';
    writeFileSync(userFile, userBody, 'utf8');

    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    expect(result.summary.keptUserFiles).toBe(1);
    expect(existsSync(userFile)).toBe(true);
    expect(readFileSync(userFile, 'utf8')).toBe(userBody);
  });
});

describe('runUninstall — CLAUDE.md handling', () => {
  it('--keep-claude-md leaves the routing section intact', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: false,
      removeConfig: false,
    });
    expect(result.summary.sectionRemoved).toBe(false);
    const claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(hasSection(claudeMd)).toBe(true);
  });

  it('preserves user content OUTSIDE the routing section', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const original = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    const augmented = original + '\n\n# My Stuff\n\nmy private rules\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), augmented, 'utf8');

    runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    const after = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('# My Stuff');
    expect(after).toContain('my private rules');
    expect(hasSection(after)).toBe(false);
  });
});

describe('runUninstall — config handling', () => {
  it('removeConfig=false keeps .agentcohort.json', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({ version: 1, models: DEFAULT_MODELS }),
      'utf8'
    );
    runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    expect(existsSync(join(cwd, '.agentcohort.json'))).toBe(true);
  });

  it('removeConfig=true removes .agentcohort.json', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({ version: 1, models: DEFAULT_MODELS }),
      'utf8'
    );
    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: true,
    });
    expect(result.summary.configRemoved).toBe(true);
    expect(existsSync(join(cwd, '.agentcohort.json'))).toBe(false);
  });
});

describe('runUninstall — backup', () => {
  it('writes a backup file next to each removed bundled file', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: true,
      removeClaudeSection: true,
      removeConfig: false,
      now: () => new Date(2026, 4, 20, 13, 14, 15),
    });
    expect(result.summary.backupCount).toBe(result.summary.removedFiles + 1); // +1 for CLAUDE.md
    for (const e of result.entries) {
      if (e.backupPath) {
        expect(existsSync(e.backupPath)).toBe(true);
      }
    }
  });
});

describe('runUninstall — dry run', () => {
  it('writes nothing when dryRun=true', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const agentDir = join(cwd, '.claude', 'agents');
    const cmdDir = join(cwd, '.claude', 'commands');
    const beforeAgents = readdirSync(agentDir).length;
    const beforeCommands = readdirSync(cmdDir).length;

    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: true,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    expect(result.dryRun).toBe(true);
    expect(result.summary.removedFiles).toBe(beforeAgents + beforeCommands);
    // Filesystem unchanged.
    expect(readdirSync(agentDir).length).toBe(beforeAgents);
    expect(readdirSync(cmdDir).length).toBe(beforeCommands);
    const claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(hasSection(claudeMd)).toBe(true);
  });
});

describe('runUninstall — empty project', () => {
  it('exits 1 with no work to do', () => {
    const cwd = project();
    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.summary.removedFiles).toBe(0);
    expect(result.summary.sectionRemoved).toBe(false);
    expect(result.summary.configRemoved).toBe(false);
  });
});

describe('runUninstall — JSON shape', () => {
  it('round-trips through JSON.stringify without loss', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: true,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
    });
    const round = JSON.parse(JSON.stringify(result));
    expect(round.dryRun).toBe(true);
    expect(round.summary.removedFiles).toBeGreaterThan(0);
    expect(Array.isArray(round.entries)).toBe(true);
  });
});

describe('runUninstall — overlay-aware (PR2)', () => {
  it('keeps a local-override file (same name as bundled, has marker) instead of removing it', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const overridePath = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    const body = `---
name: bug-hunter
description: My override
_agentcohort_local: true
---

# Role

Local.
`;
    writeFileSync(overridePath, body, 'utf8');
    const result = runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
      now: () => new Date(2026, 4, 21, 12, 0, 0),
    });
    // File still there with the original local body.
    expect(existsSync(overridePath)).toBe(true);
    expect(readFileSync(overridePath, 'utf8')).toBe(body);
    // Recorded as kept-user-file.
    const entry = result.entries.find((e) => e.path.endsWith('bug-hunter.md'))!;
    expect(entry.kind).toBe('kept-user-file');
  });

  it('removes non-local bundled files (regression: marker is the only protection)', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const bundledPath = join(cwd, '.claude', 'agents', 'dispatcher.md');
    expect(existsSync(bundledPath)).toBe(true);
    runUninstall({
      cwd,
      templatesDir: TEMPLATES,
      dryRun: false,
      backup: false,
      removeClaudeSection: true,
      removeConfig: false,
      now: () => new Date(2026, 4, 21, 12, 0, 0),
    });
    expect(existsSync(bundledPath)).toBe(false);
  });
});
