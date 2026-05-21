import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runSearch } from '../src/search';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-search-'));
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

describe('runSearch — default mode (substring, case-insensitive)', () => {
  it('finds matches across both kinds', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'all',
      mode: 'substring',
    });
    expect(result.exitCode).toBe(0);
    expect(result.totalMatches).toBeGreaterThan(0);
    const kinds = new Set(result.files.map((f) => f.kind));
    expect(kinds.has('agent')).toBe(true);
    expect(kinds.has('command')).toBe(true);
  });

  it('is case-insensitive by default', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const lower = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'all',
      mode: 'substring',
    });
    const upper = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'DISPATCHER',
      scope: 'all',
      mode: 'substring',
    });
    expect(upper.totalMatches).toBe(lower.totalMatches);
  });

  it('records match offsets within each matched line', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'agents',
      mode: 'substring',
    });
    const someLine = result.files[0]?.matches[0];
    expect(someLine).toBeDefined();
    expect(someLine!.offsets.length).toBeGreaterThan(0);
    for (const { start, end } of someLine!.offsets) {
      expect(end).toBeGreaterThan(start);
      expect(someLine!.content.slice(start, end).toLowerCase()).toBe('dispatcher');
    }
  });

  it('finds multiple matches per line when the keyword repeats', () => {
    const cwd = project();
    mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude', 'agents', 'demo.md'),
      'foo bar foo baz foo\n',
      'utf8'
    );
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'foo',
      scope: 'agents',
      mode: 'substring',
    });
    const demoFile = result.files.find((f) => f.name === 'demo');
    expect(demoFile).toBeDefined();
    expect(demoFile!.matches[0]!.offsets.length).toBe(3);
  });
});

describe('runSearch — exact mode', () => {
  it('is case-sensitive', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const exact = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'DISPATCHER', // all-caps does not appear in templates
      scope: 'all',
      mode: 'exact',
    });
    const sub = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'DISPATCHER',
      scope: 'all',
      mode: 'substring',
    });
    expect(exact.totalMatches).toBe(0);
    expect(sub.totalMatches).toBeGreaterThan(0);
  });
});

describe('runSearch — regex mode', () => {
  it('matches an ECMAScript pattern per line', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: '^model:\\s+\\S+$',
      scope: 'agents',
      mode: 'regex',
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    // Every match should be on a model: line.
    for (const f of result.files) {
      for (const m of f.matches) {
        expect(m.content).toMatch(/^model:\s+\S+$/);
      }
    }
  });

  it('returns exit 1 + a note for an invalid pattern', () => {
    const cwd = project();
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: '(', // unbalanced
      scope: 'all',
      mode: 'regex',
    });
    expect(result.exitCode).toBe(1);
    expect(result.note).toContain('invalid regex pattern');
    expect(result.files.length).toBe(0);
  });
});

describe('runSearch — scope', () => {
  it('--agents excludes commands', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'agents',
      mode: 'substring',
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    for (const f of result.files) expect(f.kind).toBe('agent');
  });

  it('--commands excludes agents', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'commands',
      mode: 'substring',
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    for (const f of result.files) expect(f.kind).toBe('command');
  });
});

describe('runSearch — fallback to bundled', () => {
  it('scans bundled files when nothing is installed locally', () => {
    const cwd = project();
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'all',
      mode: 'substring',
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    for (const f of result.files) expect(f.source).toBe('bundled');
  });

  it('prefers installed body over bundled when both exist', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Mutate an installed agent: add a sentinel string that does NOT
    // appear in the bundled body. Search for it — must hit installed.
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      file,
      // Sentinel must be unique and not in any other file.
      '# zzzMagicLocalEdit\n',
      'utf8'
    );
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'zzzMagicLocalEdit',
      scope: 'agents',
      mode: 'substring',
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    const hit = result.files.find((f) => f.name === 'dispatcher');
    expect(hit).toBeDefined();
    expect(hit!.source).toBe('installed');
  });
});

describe('runSearch — no matches', () => {
  it('returns exit 1 + empty files for an unmatched keyword', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'this-string-cannot-possibly-appear-zzzzzzz',
      scope: 'all',
      mode: 'substring',
    });
    expect(result.exitCode).toBe(1);
    expect(result.totalMatches).toBe(0);
    expect(result.files.length).toBe(0);
  });

  it('returns exit 1 for an empty query (substring of "" is everywhere — guarded out)', () => {
    const cwd = project();
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: '',
      scope: 'all',
      mode: 'substring',
    });
    expect(result.totalMatches).toBe(0);
    expect(result.exitCode).toBe(1);
  });
});

describe('runSearch — JSON shape', () => {
  it('round-trips through JSON.stringify without loss', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runSearch({
      cwd,
      templatesDir: TEMPLATES,
      query: 'dispatcher',
      scope: 'all',
      mode: 'substring',
    });
    const round = JSON.parse(JSON.stringify(result));
    expect(round.mode).toBe('substring');
    expect(round.scope).toBe('all');
    expect(round.exitCode).toBe(0);
    expect(round.files[0].matches[0].offsets[0].start).toBeGreaterThanOrEqual(0);
  });
});
