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

describe('parseArgs — diff subcommand', () => {
  it('parses bare `diff` with no name', () => {
    const a = parseArgs(['diff']);
    expect(a.command).toBe('diff');
    expect(a.subcommand).toBeNull();
  });

  it('parses `diff <name>` with name captured into subcommand', () => {
    const a = parseArgs(['diff', 'dispatcher']);
    expect(a.subcommand).toBe('dispatcher');
  });

  it('parses `diff agent/<name>` (prefix lives in the subcommand string)', () => {
    const a = parseArgs(['diff', 'agent/dispatcher']);
    expect(a.subcommand).toBe('agent/dispatcher');
  });

  it('reuses --agents / --commands flags for scope', () => {
    const a = parseArgs(['diff', '--agents']);
    expect(a.agents).toBe(true);
    const b = parseArgs(['diff', '--commands']);
    expect(b.commands).toBe(true);
  });
});

describe('parseArgs — reset subcommand', () => {
  it('parses `reset <name>` with name captured into subcommand', () => {
    const a = parseArgs(['reset', 'dispatcher']);
    expect(a.command).toBe('reset');
    expect(a.subcommand).toBe('dispatcher');
  });

  it('parses bare `reset` (CLI layer rejects, parser does not)', () => {
    const a = parseArgs(['reset']);
    expect(a.command).toBe('reset');
    expect(a.subcommand).toBeNull();
  });

  it('parses `reset agent/<name>` slash prefix into subcommand', () => {
    const a = parseArgs(['reset', 'agent/dispatcher']);
    expect(a.subcommand).toBe('agent/dispatcher');
  });

  it('reuses --yes / --dry-run / --backup / --force flags', () => {
    const a = parseArgs(['reset', 'dispatcher', '--yes', '--backup']);
    expect(a.yes).toBe(true);
    expect(a.backup).toBe(true);
    const b = parseArgs(['reset', 'dispatcher', '--dry-run']);
    expect(b.dryRun).toBe(true);
    const c = parseArgs(['reset', 'dispatcher', '--force']);
    expect(c.force).toBe(true);
  });
});

describe('parseArgs — uninstall flags', () => {
  it('parses `uninstall` as a command', () => {
    const a = parseArgs(['uninstall']);
    expect(a.command).toBe('uninstall');
  });

  it('parses --keep-config / --remove-config / --keep-claude-md', () => {
    const a = parseArgs(['uninstall', '--keep-config']);
    expect(a.keepConfig).toBe(true);
    expect(a.removeConfig).toBe(false);
    const b = parseArgs(['uninstall', '--remove-config']);
    expect(b.removeConfig).toBe(true);
    expect(b.keepConfig).toBe(false);
    const c = parseArgs(['uninstall', '--keep-claude-md']);
    expect(c.keepClaudeMd).toBe(true);
  });

  it('uninstall flags default to false', () => {
    const a = parseArgs(['uninstall']);
    expect(a.keepConfig).toBe(false);
    expect(a.removeConfig).toBe(false);
    expect(a.keepClaudeMd).toBe(false);
  });
});

describe('parseArgs — completion subcommand', () => {
  it('parses `completion <shell>` with shell captured into subcommand', () => {
    for (const s of ['bash', 'zsh', 'pwsh']) {
      const a = parseArgs(['completion', s]);
      expect(a.command).toBe('completion');
      expect(a.subcommand).toBe(s);
    }
  });

  it('parses bare `completion` (CLI validates the shell, not the parser)', () => {
    const a = parseArgs(['completion']);
    expect(a.command).toBe('completion');
    expect(a.subcommand).toBeNull();
  });
});

describe('parseArgs — add command + value flags', () => {
  it('captures the name as subcommand for `add`', () => {
    const a = parseArgs(['add', 'my-expert']);
    expect(a.command).toBe('add');
    expect(a.subcommand).toBe('my-expert');
  });

  it('parses --override as a boolean flag', () => {
    const a = parseArgs(['add', 'bug-hunter', '--override']);
    expect(a.override).toBe(true);
    expect(a.subcommand).toBe('bug-hunter');
  });

  it('parses --kind=<value>, --description=<value>, --model=<value>', () => {
    const a = parseArgs([
      'add',
      'my-expert',
      '--kind=analyst',
      '--description=Domain expert',
      '--model=opus',
    ]);
    expect(a.kind).toBe('analyst');
    expect(a.description).toBe('Domain expert');
    expect(a.model).toBe('opus');
  });

  it('accepts an empty value via --description=', () => {
    const a = parseArgs(['add', 'foo', '--description=']);
    expect(a.description).toBe('');
  });

  it('preserves an = sign inside the value (only the first = splits)', () => {
    const a = parseArgs(['add', 'foo', '--description=role=analyst']);
    expect(a.description).toBe('role=analyst');
  });

  it('does not set value flags by default', () => {
    const a = parseArgs(['add', 'foo']);
    expect(a.kind).toBeNull();
    expect(a.description).toBeNull();
    expect(a.model).toBeNull();
    expect(a.override).toBe(false);
  });

  it('records an unknown --foo=bar as unknown', () => {
    const a = parseArgs(['add', 'foo', '--bogus=value']);
    expect(a.unknown).toContain('--bogus=value');
  });

  it('passes through agent/ and command/ prefixes in the subcommand', () => {
    expect(parseArgs(['add', 'agent/foo']).subcommand).toBe('agent/foo');
    expect(parseArgs(['add', 'command/foo']).subcommand).toBe('command/foo');
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
