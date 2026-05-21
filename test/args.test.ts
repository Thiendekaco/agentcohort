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

describe('parseArgs — show subcommand', () => {
  it('parses `show <name>` with name captured into subcommand', () => {
    const a = parseArgs(['show', 'dispatcher']);
    expect(a.command).toBe('show');
    expect(a.subcommand).toBe('dispatcher');
  });

  it('parses `show agent/dispatcher` (slash prefix lives in subcommand string)', () => {
    const a = parseArgs(['show', 'agent/dispatcher']);
    expect(a.subcommand).toBe('agent/dispatcher');
  });

  it('parses --raw and --bundled flags', () => {
    const a = parseArgs(['show', 'dispatcher', '--raw']);
    expect(a.raw).toBe(true);
    expect(a.bundled).toBe(false);
    const b = parseArgs(['show', 'dispatcher', '--bundled']);
    expect(b.bundled).toBe(true);
    expect(b.raw).toBe(false);
  });

  it('--raw/--bundled default to false', () => {
    const a = parseArgs(['show', 'dispatcher']);
    expect(a.raw).toBe(false);
    expect(a.bundled).toBe(false);
  });
});

describe('parseArgs — search subcommand', () => {
  it('parses `search <keyword>` with keyword captured into subcommand', () => {
    const a = parseArgs(['search', 'dispatcher']);
    expect(a.command).toBe('search');
    expect(a.subcommand).toBe('dispatcher');
  });

  it('parses --agents / --commands flags', () => {
    const a = parseArgs(['search', 'foo', '--agents']);
    expect(a.agents).toBe(true);
    expect(a.commands).toBe(false);
    const b = parseArgs(['search', 'foo', '--commands']);
    expect(b.commands).toBe(true);
    expect(b.agents).toBe(false);
  });

  it('parses --exact / --regex flags', () => {
    const a = parseArgs(['search', 'foo', '--exact']);
    expect(a.exact).toBe(true);
    expect(a.regex).toBe(false);
    const b = parseArgs(['search', 'foo', '--regex']);
    expect(b.regex).toBe(true);
    expect(b.exact).toBe(false);
  });

  it('all search flags default to false', () => {
    const a = parseArgs(['search', 'foo']);
    expect(a.agents).toBe(false);
    expect(a.commands).toBe(false);
    expect(a.exact).toBe(false);
    expect(a.regex).toBe(false);
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
