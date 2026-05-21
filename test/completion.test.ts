import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  buildContext,
  generateCompletion,
  COMPLETION_SHELLS,
  CompletionContext,
} from '../src/completion';
import { GATE_NAMES } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');

describe('buildContext', () => {
  it('discovers bundled agent and command names from disk', () => {
    const ctx = buildContext(TEMPLATES);
    expect(ctx.agentNames.length).toBeGreaterThan(0);
    expect(ctx.commandNames.length).toBeGreaterThan(0);
    // Spot-check known names.
    expect(ctx.agentNames).toContain('dispatcher');
    expect(ctx.commandNames).toContain('auto-flow');
  });

  it('returns the canonical top-level commands + scopes + shells', () => {
    const ctx = buildContext(TEMPLATES);
    for (const c of [
      'init', 'config', 'doctor', 'lint', 'status',
      'list', 'show', 'search', 'diff', 'reset',
      'uninstall', 'upgrade', 'completion',
    ]) {
      expect(ctx.commands).toContain(c);
    }
    expect(ctx.listScopes).toEqual(['agents', 'commands', 'gates']);
    expect(ctx.completionShells).toEqual(['bash', 'zsh', 'pwsh']);
    expect([...ctx.gateNames].sort()).toEqual([...GATE_NAMES].sort());
  });

  it('returns empty name lists when the templates dir does not exist', () => {
    const ctx = buildContext(resolve('/this/path/does/not/exist'));
    expect(ctx.agentNames).toEqual([]);
    expect(ctx.commandNames).toEqual([]);
  });
});

const SAMPLE_CTX: CompletionContext = {
  commands: ['init', 'doctor', 'list', 'show', 'completion'],
  listScopes: ['agents', 'commands', 'gates'],
  agentNames: ['dispatcher', 'repo-scout'],
  commandNames: ['auto-flow', 'dev-flow'],
  gateNames: ['architect', 'plan'],
  completionShells: ['bash', 'zsh', 'pwsh'],
  flags: ['--yes', '--json', '--dry-run'],
};

describe('generateCompletion — bash', () => {
  const script = generateCompletion('bash', SAMPLE_CTX);

  it('declares the completion function and registers it on agentcohort', () => {
    expect(script).toContain('_agentcohort_complete()');
    expect(script).toContain('complete -F _agentcohort_complete agentcohort');
  });

  it('embeds top-level commands, list scopes, shells, agent + command names, and flags', () => {
    for (const c of SAMPLE_CTX.commands) expect(script).toContain(c);
    for (const s of SAMPLE_CTX.listScopes) expect(script).toContain(s);
    for (const s of SAMPLE_CTX.completionShells) expect(script).toContain(s);
    for (const a of SAMPLE_CTX.agentNames) expect(script).toContain(a);
    for (const c of SAMPLE_CTX.commandNames) expect(script).toContain(c);
    for (const f of SAMPLE_CTX.flags) expect(script).toContain(f);
  });

  it('includes kind-prefixed names for show / diff / reset disambiguation', () => {
    expect(script).toContain('agent/dispatcher');
    expect(script).toContain('command/auto-flow');
  });

  it('branches per command (list, completion, show/diff/reset)', () => {
    expect(script).toMatch(/case[^\n]*\$\{cmd\}/);
    expect(script).toContain('list)');
    expect(script).toContain('completion)');
    expect(script).toContain('show|diff|reset)');
  });
});

describe('generateCompletion — zsh', () => {
  const script = generateCompletion('zsh', SAMPLE_CTX);

  it('starts with the compdef directive and registers via compdef', () => {
    expect(script.startsWith('#compdef agentcohort')).toBe(true);
    expect(script).toContain('compdef _agentcohort agentcohort');
  });

  it('embeds commands with blurbs and the standard subcommand branches', () => {
    expect(script).toContain("'init:");
    expect(script).toContain("'show:");
    expect(script).toContain('case "${cmd}"');
    expect(script).toContain('list)');
    expect(script).toContain('completion)');
    expect(script).toContain('show|diff|reset)');
  });

  it('embeds list scopes, shells, and qualified names', () => {
    for (const s of SAMPLE_CTX.listScopes) expect(script).toContain(s);
    for (const s of SAMPLE_CTX.completionShells) expect(script).toContain(s);
    expect(script).toContain('agent/dispatcher');
    expect(script).toContain('command/auto-flow');
  });
});

describe('generateCompletion — pwsh', () => {
  const script = generateCompletion('pwsh', SAMPLE_CTX);

  it('uses Register-ArgumentCompleter with -Native -CommandName agentcohort', () => {
    expect(script).toContain('Register-ArgumentCompleter');
    expect(script).toContain('-Native');
    expect(script).toContain('-CommandName agentcohort');
  });

  it('embeds the canonical arrays as @(...)', () => {
    expect(script).toMatch(/\$topCommands\s*=\s*@\(/);
    expect(script).toMatch(/\$listScopes\s*=\s*@\(/);
    expect(script).toMatch(/\$shells\s*=\s*@\(/);
    expect(script).toMatch(/\$names\s*=\s*@\(/);
    expect(script).toMatch(/\$prefixed\s*=\s*@\(/);
    expect(script).toMatch(/\$flags\s*=\s*@\(/);
  });

  it('branches per command via switch ($cmd)', () => {
    expect(script).toMatch(/switch\s*\(\s*\$cmd\s*\)/);
    expect(script).toContain("'list'");
    expect(script).toContain("'completion'");
    expect(script).toContain("'show'");
    expect(script).toContain("'diff'");
    expect(script).toContain("'reset'");
  });

  it('escapes single quotes inside name strings', () => {
    const ctx: CompletionContext = {
      ...SAMPLE_CTX,
      agentNames: ["with'quote"],
    };
    const out = generateCompletion('pwsh', ctx);
    // Escaped form: ''  inside a single-quoted PS string.
    expect(out).toContain("'with''quote'");
  });
});

describe('generateCompletion — all shells', () => {
  it.each(COMPLETION_SHELLS)('produces non-empty output for %s', (shell) => {
    const out = generateCompletion(shell, SAMPLE_CTX);
    expect(out.length).toBeGreaterThan(0);
    // Each shell script mentions the binary name somewhere.
    expect(out).toContain('agentcohort');
  });
});
