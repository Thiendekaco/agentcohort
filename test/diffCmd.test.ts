import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runDiff } from '../src/diffCmd';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-diff-'));
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

describe('runDiff — clean install (no diffs)', () => {
  it('returns exit 0 and zero differing files after a fresh install', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.files.length).toBe(0);
    expect(result.unchangedCount).toBeGreaterThan(0);
  });
});

describe('runDiff — user-edited file', () => {
  it('flags a hand-edited agent and includes a non-empty unified diff', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      file,
      readFileSync(file, 'utf8') + '\n# user note here\n',
      'utf8'
    );
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(1);
    const dispatcher = result.files.find((f) => f.name === 'dispatcher');
    expect(dispatcher).toBeDefined();
    expect(dispatcher!.status).toBe('user-edited');
    expect(dispatcher!.diff.length).toBeGreaterThan(0);
    expect(dispatcher!.diff).toContain('user note here');
  });
});

describe('runDiff — missing file', () => {
  it('reports every bundled file as missing on an empty project', () => {
    const cwd = project();
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(1);
    expect(result.files.length).toBeGreaterThan(0);
    for (const f of result.files) {
      expect(f.status).toBe('missing');
      // The diff for a missing file is the full bundled body.
      expect(f.diff.length).toBeGreaterThan(0);
    }
  });
});

describe('runDiff — extra file (installed but not bundled)', () => {
  it('marks a user-authored agent as extra with empty diff', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'my-helper.md'),
      '---\nname: my-helper\ndescription: mine\ntools: Read\nmodel: haiku\n---\n\nbody\n',
      'utf8'
    );
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    const extra = result.files.find((f) => f.name === 'my-helper');
    expect(extra).toBeDefined();
    expect(extra!.status).toBe('extra');
    expect(extra!.diff).toBe('');
    // extra files DO contribute to a non-zero exit (they're a difference).
    expect(result.exitCode).toBe(1);
  });
});

describe('runDiff — single-name query', () => {
  it('returns a single-entry result for a specific name', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    // Clean install → no diffs even for the queried file.
    expect(result.exitCode).toBe(0);
    expect(result.files.length).toBe(0);
    expect(result.unchangedCount).toBe(1);
  });

  it('returns notFound + exit 1 when the queried name does not exist', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'no-such-thing',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.notFound).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('strips a trailing .md extension', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher.md',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.notFound).toBe(false);
    expect(result.unchangedCount).toBe(1);
  });
});

describe('runDiff — kind prefix', () => {
  it('agent/<name> restricts the lookup to agents', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // dispatcher exists only as agent → command/dispatcher should not match.
    const cmdResult = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/dispatcher',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(cmdResult.notFound).toBe(true);
    expect(cmdResult.restrictTo).toBe('command');

    const agentResult = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'agent/dispatcher',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(agentResult.notFound).toBe(false);
    expect(agentResult.restrictTo).toBe('agent');
  });
});

describe('runDiff — scope filter', () => {
  it('--agents excludes commands', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Edit one agent and one command.
    const agentFile = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      agentFile,
      readFileSync(agentFile, 'utf8') + '\n# A\n',
      'utf8'
    );
    const cmdFile = join(cwd, '.claude', 'commands', 'auto-flow.md');
    writeFileSync(
      cmdFile,
      readFileSync(cmdFile, 'utf8') + '\n# C\n',
      'utf8'
    );

    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'agents',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.files.length).toBeGreaterThan(0);
    for (const f of result.files) expect(f.kind).toBe('agent');
  });

  it('--commands excludes agents', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const agentFile = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      agentFile,
      readFileSync(agentFile, 'utf8') + '\n# A\n',
      'utf8'
    );
    const cmdFile = join(cwd, '.claude', 'commands', 'auto-flow.md');
    writeFileSync(
      cmdFile,
      readFileSync(cmdFile, 'utf8') + '\n# C\n',
      'utf8'
    );

    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'commands',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.files.length).toBeGreaterThan(0);
    for (const f of result.files) expect(f.kind).toBe('command');
  });
});

describe('runDiff — custom model config', () => {
  it('compares against the user-configured model IDs', async () => {
    const cwd = project();
    // Install with custom models so the installed body has those IDs.
    const customModels = {
      premium: 'custom-premium',
      mid: 'custom-mid',
      cheap: 'custom-cheap',
    };
    await runInit({
      cwd,
      yes: true,
      dryRun: false,
      force: false,
      backup: false,
      interactive: false,
      now: () => new Date(2026, 4, 20, 12, 0, 0),
      templatesDir: TEMPLATES,
      models: customModels,
    });
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'all',
      models: customModels,
    });
    // Same models → no diffs.
    expect(result.exitCode).toBe(0);
    expect(result.files.length).toBe(0);
  });
});

describe('runDiff — JSON shape', () => {
  it('round-trips through JSON.stringify without loss', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n# z\n', 'utf8');
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: null,
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    const round = JSON.parse(JSON.stringify(result));
    expect(round.exitCode).toBe(1);
    expect(round.files[0].status).toBe('user-edited');
    expect(typeof round.files[0].diff).toBe('string');
  });
});

describe('runDiff — overlay-aware (PR2)', () => {
  it('reports local-override with status="local-override" and a real diff', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const overridePath = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    writeFileSync(
      overridePath,
      `---
name: bug-hunter
description: My override
_agentcohort_local: true
---

# Role

Customized.
`,
      'utf8'
    );
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'bug-hunter',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(1);
    const entry = result.files.find((f) => f.name === 'bug-hunter')!;
    expect(entry.status).toBe('local-override');
    expect(entry.diff).not.toBe('');
    expect(entry.diff).toContain('local override');
  });

  it('reports local-new with status="local" and an empty diff', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const localPath = join(cwd, '.claude', 'agents', 'my-custom.md');
    writeFileSync(
      localPath,
      `---
name: my-custom
description: Custom
_agentcohort_local: true
---

Body.
`,
      'utf8'
    );
    const result = runDiff({
      cwd,
      templatesDir: TEMPLATES,
      query: 'my-custom',
      scope: 'all',
      models: { ...DEFAULT_MODELS },
    });
    const entry = result.files.find((f) => f.name === 'my-custom')!;
    expect(entry.status).toBe('local');
    expect(entry.diff).toBe('');
  });
});
