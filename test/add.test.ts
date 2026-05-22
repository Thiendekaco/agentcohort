import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runAdd } from '../src/add';
import { hasLocalMarker } from '../src/localMarker';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-add-'));
  tmps.push(d);
  return d;
}

afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

const BASE = {
  archetype: null,
  description: null,
  model: null,
  override: false,
  force: false,
  dryRun: false,
} as const;

describe('runAdd — happy paths (new agent)', () => {
  it('scaffolds a new local agent with the empty archetype by default', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'my-new-agent',
      ...BASE,
    });
    expect(result.exitCode).toBe(0);
    expect(result.disposition).toBe('created');
    expect(result.kind).toBe('agent');
    expect(result.archetype).toBe('empty');
    const written = readFileSync(result.installedPath!, 'utf8');
    expect(written).toContain('name: my-new-agent');
    expect(written).toContain('model: sonnet');
    expect(hasLocalMarker(written)).toBe(true);
    expect(written).not.toContain('_agentcohort_hash');
  });

  it('uses --description and --model when provided', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'my-expert',
      ...BASE,
      archetype: 'analyst',
      description: 'Domain expert for billing',
      model: 'opus',
    });
    expect(result.exitCode).toBe(0);
    const written = readFileSync(result.installedPath!, 'utf8');
    expect(written).toContain('description: Domain expert for billing');
    expect(written).toContain('model: opus');
    expect(written).toContain('# Role');
    expect(written).toContain('read-only analyst');
  });

  it('respects the agent/ prefix to disambiguate explicitly', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'agent/precise-name',
      ...BASE,
    });
    expect(result.exitCode).toBe(0);
    expect(result.kind).toBe('agent');
    expect(result.installedPath).toMatch(/[\\/]agents[\\/]precise-name\.md$/);
  });

  it('strips .md from the query if the user types it', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'agent/with-suffix.md',
      ...BASE,
    });
    expect(result.exitCode).toBe(0);
    expect(result.name).toBe('with-suffix');
    expect(result.installedPath).toMatch(/[\\/]with-suffix\.md$/);
  });

  it('writes a body matching each archetype', () => {
    const cwd = project();
    const r1 = runAdd({ cwd, templatesDir: TEMPLATES, query: 'a-imp', ...BASE, archetype: 'implementer' });
    const r2 = runAdd({ cwd, templatesDir: TEMPLATES, query: 'a-rev', ...BASE, archetype: 'reviewer' });
    const r3 = runAdd({ cwd, templatesDir: TEMPLATES, query: 'a-gate', ...BASE, archetype: 'gate' });
    expect(readFileSync(r1.installedPath!, 'utf8')).toContain('You implement changes');
    expect(readFileSync(r2.installedPath!, 'utf8')).toContain('read-only reviewer');
    expect(readFileSync(r3.installedPath!, 'utf8')).toContain('AskUserQuestion');
  });
});

describe('runAdd — happy paths (new command)', () => {
  it('scaffolds a new local command when the command/ prefix is used', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/my-flow',
      ...BASE,
      description: 'A custom flow',
    });
    expect(result.exitCode).toBe(0);
    expect(result.disposition).toBe('created');
    expect(result.kind).toBe('command');
    expect(result.archetype).toBeNull();
    const written = readFileSync(result.installedPath!, 'utf8');
    expect(written).toContain('name: my-flow');
    expect(written).toContain('description: A custom flow');
    expect(written).toContain('# /my-flow');
    expect(hasLocalMarker(written)).toBe(true);
    expect(written).not.toContain('model:'); // commands don't carry a model tier
  });
});

describe('runAdd — override (local copy of a bundled file)', () => {
  it('refuses when bundled exists and --override is not set', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'bug-hunter',
      ...BASE,
    });
    expect(result.exitCode).toBe(1);
    expect(result.disposition).toBe('refused-bundled');
    expect(result.bundledExists).toBe(true);
    expect(existsSync(result.installedPath!)).toBe(false);
  });

  it('with --override, copies the bundled body verbatim and marks it local', () => {
    const cwd = project();
    const bundledPath = join(TEMPLATES, 'agents', 'bug-hunter.md');
    const bundled = readFileSync(bundledPath, 'utf8');
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'bug-hunter',
      ...BASE,
      override: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.disposition).toBe('override-created');
    const written = readFileSync(result.installedPath!, 'utf8');
    expect(hasLocalMarker(written)).toBe(true);
    // The user-visible body section is preserved.
    expect(written).toContain('# Role');
    // Bundled frontmatter content is preserved (name, description) — only
    // the local marker is added (and stamp stripped if present).
    expect(written).toContain('name: bug-hunter');
    expect(bundled).toContain('name: bug-hunter');
  });
});

describe('runAdd — refusals', () => {
  it('refuses an invalid name', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'BadName_with_underscores',
      ...BASE,
    });
    expect(result.exitCode).toBe(1);
    expect(result.disposition).toBe('refused-invalid-name');
  });

  it('refuses when a file already exists at the target and --force is off', () => {
    const cwd = project();
    // Seed an existing file.
    const path = join(cwd, '.claude', 'agents', 'existing.md');
    runAdd({ cwd, templatesDir: TEMPLATES, query: 'existing', ...BASE });
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'existing',
      ...BASE,
    });
    expect(result.exitCode).toBe(1);
    expect(result.disposition).toBe('refused-exists');
    // Original file untouched.
    expect(existsSync(path)).toBe(true);
  });

  it('with --force, overwrites an existing file', () => {
    const cwd = project();
    runAdd({ cwd, templatesDir: TEMPLATES, query: 'existing', ...BASE });
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'existing',
      ...BASE,
      archetype: 'reviewer',
      force: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.disposition).toBe('created');
    expect(readFileSync(result.installedPath!, 'utf8')).toContain('read-only reviewer');
  });
});

describe('runAdd — dryRun', () => {
  it('writes nothing in dryRun mode but reports the would-be disposition', () => {
    const cwd = project();
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'preview-only',
      ...BASE,
      dryRun: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.disposition).toBe('created');
    expect(result.dryRun).toBe(true);
    expect(result.newText).not.toBe('');
    expect(existsSync(result.installedPath!)).toBe(false);
  });

  it('does not write even when dryRun=true and force=true (refused-exists stays refused)', () => {
    const cwd = project();
    runAdd({ cwd, templatesDir: TEMPLATES, query: 'preset', ...BASE });
    const before = readFileSync(
      join(cwd, '.claude', 'agents', 'preset.md'),
      'utf8'
    );
    const result = runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'preset',
      ...BASE,
      force: true,
      archetype: 'reviewer',
      dryRun: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(readFileSync(join(cwd, '.claude', 'agents', 'preset.md'), 'utf8')).toBe(before);
  });
});
