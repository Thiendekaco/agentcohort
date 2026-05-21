import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runReset } from '../src/reset';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-reset-'));
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

describe('runReset — clean install (noop)', () => {
  it('returns disposition=noop without writing when the file already matches bundled', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const before = readFileSync(file, 'utf8');
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.action.disposition).toBe('noop');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('runReset — user-edited overwrite', () => {
  it('reverts a hand-edited file and returns disposition=reset', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const original = readFileSync(file, 'utf8');
    const tampered = original + '\n# user note\n';
    writeFileSync(file, tampered, 'utf8');

    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.action.disposition).toBe('reset');
    expect(result.action.preStatus).toBe('user-edited');
    expect(readFileSync(file, 'utf8')).not.toContain('# user note');
    // Restored body is byte-identical to a fresh install.
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('does NOT write when dryRun is true', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const tampered = readFileSync(file, 'utf8') + '\n# z\n';
    writeFileSync(file, tampered, 'utf8');

    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: true,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.action.disposition).toBe('reset');
    expect(result.action.dryRun).toBe(true);
    // File on disk is still the tampered version.
    expect(readFileSync(file, 'utf8')).toBe(tampered);
  });

  it('writes a backup when backup=true', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const tampered = readFileSync(file, 'utf8') + '\n# z\n';
    writeFileSync(file, tampered, 'utf8');

    const fixedNow = new Date(2026, 4, 20, 13, 14, 15);
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: false,
      backup: true,
      models: { ...DEFAULT_MODELS },
      now: () => fixedNow,
    });
    expect(result.action.backupPath).toBeDefined();
    expect(existsSync(result.action.backupPath!)).toBe(true);
    // Backup contents == the tampered body, not the reverted one.
    expect(readFileSync(result.action.backupPath!, 'utf8')).toBe(tampered);
  });
});

describe('runReset — missing file (install fresh)', () => {
  it('installs the file when it is missing locally', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    rmSync(file);

    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.action.disposition).toBe('installed');
    expect(result.action.preStatus).toBe('missing');
    expect(existsSync(file)).toBe(true);
  });

  it('installs into an empty project (creates the .claude/agents dir)', () => {
    const cwd = project();
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.action.disposition).toBe('installed');
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    expect(existsSync(file)).toBe(true);
  });
});

describe('runReset — refused-extra (no bundled to reset to)', () => {
  it('refuses a user-authored agent with no bundled counterpart', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'my-helper.md'),
      '---\nname: my-helper\ndescription: mine\ntools: Read\nmodel: haiku\n---\n\nbody\n',
      'utf8'
    );
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'my-helper',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(1);
    expect(result.action.disposition).toBe('refused-extra');
    // File on disk untouched.
    expect(existsSync(join(cwd, '.claude', 'agents', 'my-helper.md'))).toBe(true);
  });
});

describe('runReset — refused-not-found', () => {
  it('refuses when no agent or command matches', () => {
    const cwd = project();
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'no-such-thing',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(1);
    expect(result.action.disposition).toBe('refused-not-found');
    expect(result.action.preStatus).toBe('not-found');
  });

  it('respects a kind prefix in not-found reporting', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // dispatcher exists as agent, not as command.
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/dispatcher',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.action.disposition).toBe('refused-not-found');
    expect(result.restrictTo).toBe('command');
  });
});

describe('runReset — refused-ambiguous (both kinds, no prefix)', () => {
  it('refuses when a bare name matches both an agent and a command', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Plant a user-authored agent with a name shared with a bundled command.
    writeFileSync(
      join(cwd, '.claude', 'agents', 'auto-flow.md'),
      '---\nname: auto-flow\ndescription: my override\ntools: Read\nmodel: haiku\n---\n\nbody\n',
      'utf8'
    );
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'auto-flow',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(1);
    expect(result.action.disposition).toBe('refused-ambiguous');
    expect(result.candidates?.length).toBe(2);
    const kinds = result.candidates!.map((c) => c.kind).sort();
    expect(kinds).toEqual(['agent', 'command']);
  });

  it('proceeds when the user disambiguates with command/<name>', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'auto-flow.md'),
      '---\nname: auto-flow\ndescription: my override\ntools: Read\nmodel: haiku\n---\n\nbody\n',
      'utf8'
    );
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/auto-flow',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.action.kind).toBe('command');
    // noop because the bundled command was already installed unchanged.
    expect(result.action.disposition).toBe('noop');
  });
});

describe('runReset — JSON shape', () => {
  it('round-trips through JSON.stringify without loss', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n# z\n', 'utf8');
    const result = runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: true,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    const round = JSON.parse(JSON.stringify(result));
    expect(round.action.disposition).toBe('reset');
    expect(round.action.preStatus).toBe('user-edited');
    expect(round.action.dryRun).toBe(true);
  });
});

// Sanity check: when reset overwrites a tampered file, doctor/list should
// flip back to "installed" / "unchanged" — i.e. the stamp lines up again.
describe('runReset — integration with stamp', () => {
  it('restores integrity stamp parity after a hand-edit', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n# tamper\n', 'utf8');
    runReset({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      dryRun: false,
      backup: false,
      models: { ...DEFAULT_MODELS },
    });
    // After reset, the body must match what `init` would write — so the
    // file must equal the freshly-rendered+stamped bundled body.
    const reverted = readFileSync(file, 'utf8');
    // The bundled raw body has `model: haiku`, which install would rewrite.
    expect(reverted).toContain(DEFAULT_MODELS.cheap); // dispatcher uses cheap tier
    expect(reverted).toContain('_agentcohort_hash:');
  });
});

