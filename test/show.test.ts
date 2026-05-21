import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runShow } from '../src/show';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-show-'));
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

describe('runShow — installed agent', () => {
  it('returns the installed file with source=installed, integrity=unchanged', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.matches.length).toBe(1);
    const m = result.matches[0]!;
    expect(m.kind).toBe('agent');
    expect(m.name).toBe('dispatcher');
    expect(m.source).toBe('installed');
    expect(m.status).toBe('unchanged');
    expect(m.fallback).toBe(false);
    expect(m.content).toContain('---');
    expect(m.content).toContain('name: dispatcher');
  });

  it('flags integrity=user-edited when the body was modified', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n# user note\n', 'utf8');
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.matches[0]!.status).toBe('user-edited');
  });
});

describe('runShow — fallback to bundled', () => {
  it('returns bundled-rendered with fallback=true when not installed', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    const m = result.matches[0]!;
    expect(m.source).toBe('bundled-rendered');
    expect(m.fallback).toBe(true);
    // Rendered → model: line is the concrete ID, not the alias.
    expect(m.content).toContain(DEFAULT_MODELS.cheap);
    expect(m.content).not.toMatch(/^model: haiku$/m);
  });
});

describe('runShow — variants', () => {
  it('--raw returns bundled body untouched (pre-render, pre-stamp)', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'raw',
      models: { ...DEFAULT_MODELS },
    });
    const m = result.matches[0]!;
    expect(m.source).toBe('bundled-raw');
    expect(m.fallback).toBe(false);
    expect(m.content).toMatch(/^model: haiku$/m);
    expect(m.content).not.toContain('_agentcohort_hash:');
  });

  it('--bundled returns bundled body with render + stamp applied', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'bundled',
      models: { ...DEFAULT_MODELS },
    });
    const m = result.matches[0]!;
    expect(m.source).toBe('bundled-rendered');
    expect(m.fallback).toBe(false);
    expect(m.content).toContain('_agentcohort_hash:');
    expect(m.content).toContain(DEFAULT_MODELS.cheap);
  });

  it('--bundled uses the custom models when supplied', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'bundled',
      models: { premium: 'custom-p', mid: 'custom-m', cheap: 'custom-c' },
    });
    expect(result.matches[0]!.content).toContain('model: custom-c');
  });
});

describe('runShow — kind prefixes', () => {
  it('agent/<name> restricts the lookup to agents', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'agent/dispatcher',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.restrictTo).toBe('agent');
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]!.kind).toBe('agent');
  });

  it('command/<name> restricts the lookup to commands', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/auto-flow',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.restrictTo).toBe('command');
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]!.kind).toBe('command');
  });

  it('accepts the plural `agents/<name>` and `commands/<name>` aliases', () => {
    const cwd = project();
    const a = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'agents/dispatcher',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(a.restrictTo).toBe('agent');
    const c = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'commands/auto-flow',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(c.restrictTo).toBe('command');
  });

  it('strips a trailing .md extension', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher.md',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.matches[0]!.name).toBe('dispatcher');
  });
});

describe('runShow — ambiguous (same name in both kinds)', () => {
  it('returns BOTH matches when an agent and a command share a name', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Plant a user-authored agent with the same name as an installed command.
    writeFileSync(
      join(cwd, '.claude', 'agents', 'auto-flow.md'),
      '---\nname: auto-flow\ndescription: My own override.\ntools: Read\nmodel: haiku\n---\n\nbody\n',
      'utf8'
    );
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'auto-flow',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.exitCode).toBe(0);
    expect(result.matches.length).toBe(2);
    const kinds = result.matches.map((m) => m.kind).sort();
    expect(kinds).toEqual(['agent', 'command']);
  });
});

describe('runShow — not found', () => {
  it('returns notFound + exit code 1 when nothing matches', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'nope-not-real',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.notFound).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.matches.length).toBe(0);
  });

  it('respects a kind prefix when reporting not-found', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/dispatcher', // dispatcher is an agent, not a command
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    expect(result.notFound).toBe(true);
    expect(result.restrictTo).toBe('command');
  });
});

describe('runShow — JSON shape', () => {
  it('round-trips through JSON.stringify without loss', () => {
    const cwd = project();
    const result = runShow({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      variant: 'default',
      models: { ...DEFAULT_MODELS },
    });
    const round = JSON.parse(JSON.stringify(result));
    expect(round.matches[0].kind).toBe('agent');
    expect(round.matches[0].source).toBe('bundled-rendered');
    expect(round.exitCode).toBe(0);
  });
});
