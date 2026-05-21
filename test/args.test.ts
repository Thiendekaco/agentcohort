import { describe, it, expect } from 'vitest';
import { parseArgs, helpText } from '../src/args';

describe('parseArgs', () => {
  it('parses the bare init command with all flags false', () => {
    const a = parseArgs(['init']);
    expect(a.command).toBe('init');
    expect(a.yes).toBe(false);
    expect(a.dryRun).toBe(false);
    expect(a.force).toBe(false);
    expect(a.backup).toBe(false);
    expect(a.unknown).toEqual([]);
  });

  it('parses short and long flags including aliases', () => {
    const a = parseArgs(['init', '-y', '--dry-run', '--force', '--backup']);
    expect(a).toMatchObject({
      command: 'init',
      yes: true,
      dryRun: true,
      force: true,
      backup: true,
    });
  });

  it('treats --version / -v and --help / -h', () => {
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs([]).command).toBeNull();
  });

  it('collects unknown flags and extra positionals', () => {
    const a = parseArgs(['init', '--nope', 'extra']);
    expect(a.command).toBe('init');
    expect(a.unknown).toEqual(['--nope', 'extra']);
  });

  it('records an unknown command as the command (CLI decides validity)', () => {
    const a = parseArgs(['bogus']);
    expect(a.command).toBe('bogus');
    expect(a.unknown).toEqual([]);
  });
});

describe('helpText', () => {
  it('documents the tool and the workflow commands', () => {
    const h = helpText();
    expect(h).toContain('agentcohort');
    expect(h).toContain('/auto-flow');
    expect(h).toContain('/bug-audit');
    expect(h).toContain('NEVER');
  });
});

describe('parseArgs — list subcommand', () => {
  it('parses `list` without a scope', () => {
    const a = parseArgs(['list']);
    expect(a.command).toBe('list');
    expect(a.subcommand).toBeNull();
  });

  it('parses `list agents` with scope captured into subcommand', () => {
    const a = parseArgs(['list', 'agents']);
    expect(a.command).toBe('list');
    expect(a.subcommand).toBe('agents');
    expect(a.unknown).toEqual([]);
  });

  it('routes the second positional under `list` to subcommand', () => {
    const a = parseArgs(['list', 'gates', '--json']);
    expect(a.subcommand).toBe('gates');
    expect(a.json).toBe(true);
  });

  it('does NOT capture a subcommand for non-list commands', () => {
    const a = parseArgs(['init', 'extra']);
    expect(a.command).toBe('init');
    expect(a.subcommand).toBeNull();
    expect(a.unknown).toEqual(['extra']);
  });

  it('treats a third positional under `list` as unknown', () => {
    const a = parseArgs(['list', 'agents', 'huh']);
    expect(a.subcommand).toBe('agents');
    expect(a.unknown).toEqual(['huh']);
  });
});

describe('parseArgs - PR 2 additions', () => {
  it('parses the new `config` command', () => {
    const a = parseArgs(['config']);
    expect(a.command).toBe('config');
    expect(a.unknown).toEqual([]);
  });

  it('parses --reconfigure as a flag', () => {
    const a = parseArgs(['init', '--reconfigure']);
    expect(a.command).toBe('init');
    expect(a.reconfigure).toBe(true);
  });

  it('does not set --reconfigure by default', () => {
    const a = parseArgs(['init']);
    expect(a.reconfigure).toBe(false);
  });

  it('parses --reconfigure and --force together (the rejection happens in cli, not parseArgs)', () => {
    const a = parseArgs(['init', '--reconfigure', '--force']);
    expect(a.reconfigure).toBe(true);
    expect(a.force).toBe(true);
  });
});
