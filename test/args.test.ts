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

describe('parseArgs — skills command', () => {
  it('parses bare `skills` as a command', () => {
    const a = parseArgs(['skills']);
    expect(a.command).toBe('skills');
    expect(a.subcommand).toBeNull();
    expect(a.unknown).toEqual([]);
  });

  it('parses `skills --json`', () => {
    const a = parseArgs(['skills', '--json']);
    expect(a.command).toBe('skills');
    expect(a.json).toBe(true);
  });
});

describe('parseArgs — export / import commands', () => {
  it('parses `export` with no subcommand', () => {
    const a = parseArgs(['export']);
    expect(a.command).toBe('export');
    expect(a.subcommand).toBeNull();
  });

  it('parses --out=<path> as a value flag', () => {
    const a = parseArgs(['export', '--out=./pack.json']);
    expect(a.out).toBe('./pack.json');
  });

  it('parses --no-config as a boolean flag', () => {
    const a = parseArgs(['export', '--no-config']);
    expect(a.noConfig).toBe(true);
  });

  it('captures the pack path as subcommand for `import`', () => {
    const a = parseArgs(['import', './pack.json']);
    expect(a.command).toBe('import');
    expect(a.subcommand).toBe('./pack.json');
  });

  it('parses --force / --backup / --dry-run on import', () => {
    const a = parseArgs([
      'import',
      './pack.json',
      '--force',
      '--backup',
      '--dry-run',
    ]);
    expect(a.force).toBe(true);
    expect(a.backup).toBe(true);
    expect(a.dryRun).toBe(true);
  });

  it('value flags + boolean flags compose in any order', () => {
    const a = parseArgs([
      'export',
      '--no-config',
      '--out=./pack.json',
      '--json',
    ]);
    expect(a.noConfig).toBe(true);
    expect(a.out).toBe('./pack.json');
    expect(a.json).toBe(true);
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

describe('parseArgs — memory/run/gate boolean flags (v0.10+)', () => {
  it('parses --with-verifications as true', () => {
    const a = parseArgs(['memory', 'read', '--with-verifications']);
    expect(a.withVerifications).toBe(true);
  });

  it('parses --commit-all as true', () => {
    const a = parseArgs(['memory', 'init', '--commit-all']);
    expect(a.commitAll).toBe(true);
  });

  it('parses --gitignore-all as true', () => {
    const a = parseArgs(['memory', 'init', '--gitignore-all']);
    expect(a.gitignoreAll).toBe(true);
  });

  it('parses --auto as autoStale=true', () => {
    const a = parseArgs(['memory', 'mark-stale', '--auto']);
    expect(a.autoStale).toBe(true);
  });

  it('parses --unstale as true', () => {
    const a = parseArgs(['memory', 'mark-stale', '--unstale']);
    expect(a.unstale).toBe(true);
  });

  it('all new boolean flags default to false', () => {
    const a = parseArgs(['memory', 'init']);
    expect(a.withVerifications).toBe(false);
    expect(a.commitAll).toBe(false);
    expect(a.gitignoreAll).toBe(false);
    expect(a.autoStale).toBe(false);
    expect(a.unstale).toBe(false);
  });
});

describe('parseArgs — memory/run/gate value flags (v0.10+)', () => {
  it('parses --run-id=<uuid> as string', () => {
    const a = parseArgs(['memory', 'write', '--run-id=abc-123']);
    expect(a.runId).toBe('abc-123');
  });

  it('parses --collection=<name> as string', () => {
    const a = parseArgs(['memory', 'read', '--collection=decisions']);
    expect(a.collection).toBe('decisions');
  });

  it('parses --json-body=<json> into bodyJson', () => {
    const a = parseArgs(['memory', 'write', '--json-body={"x":1}']);
    expect(a.bodyJson).toBe('{"x":1}');
  });

  it('parses --source=<name> as string', () => {
    const a = parseArgs(['memory', 'write', '--source=human']);
    expect(a.source).toBe('human');
  });

  it('parses --confidence=0.9 as number', () => {
    const a = parseArgs(['memory', 'write', '--confidence=0.9']);
    expect(a.confidence).toBeCloseTo(0.9);
  });

  it('parses --verified=true as boolean true', () => {
    const a = parseArgs(['memory', 'write', '--verified=true']);
    expect(a.verifiedFlag).toBe(true);
  });

  it('parses --verified=false as boolean false', () => {
    const a = parseArgs(['memory', 'write', '--verified=false']);
    expect(a.verifiedFlag).toBe(false);
  });

  it('parses --task-summary=<txt> as string', () => {
    const a = parseArgs(['memory', 'write', '--task-summary=my task']);
    expect(a.taskSummary).toBe('my task');
  });

  it('parses --files=a,b,c as array', () => {
    const a = parseArgs(['memory', 'write', '--files=a,b,c']);
    expect(a.files).toEqual(['a', 'b', 'c']);
  });

  it('parses --limit=10 as number', () => {
    const a = parseArgs(['memory', 'read', '--limit=10']);
    expect(a.limit).toBe(10);
  });

  it('parses --since=<dur> as string', () => {
    const a = parseArgs(['memory', 'read', '--since=7d']);
    expect(a.since).toBe('7d');
  });

  it('parses --id=<uuid> into staleId', () => {
    const a = parseArgs(['memory', 'mark-stale', '--id=abc-123']);
    expect(a.staleId).toBe('abc-123');
  });

  it('parses --pipeline=<name> as string', () => {
    const a = parseArgs(['run', 'start', '--pipeline=quick-fix']);
    expect(a.pipeline).toBe('quick-fix');
  });

  it('parses --tier=2 as number', () => {
    const a = parseArgs(['run', 'start', '--tier=2']);
    expect(a.tier).toBe(2);
  });

  it('parses --outcome=<str> as string', () => {
    const a = parseArgs(['run', 'end', '--outcome=success']);
    expect(a.outcome).toBe('success');
  });

  it('parses --agents-run=a,b as array', () => {
    const a = parseArgs(['run', 'end', '--agents-run=scout,architect']);
    expect(a.agentsRun).toEqual(['scout', 'architect']);
  });

  it('parses --gates-fired=plan,arch as array', () => {
    const a = parseArgs(['run', 'end', '--gates-fired=plan,architect']);
    expect(a.gatesFired).toEqual(['plan', 'architect']);
  });

  it('parses --gate=<name> as string', () => {
    const a = parseArgs(['gate', 'record', '--gate=plan']);
    expect(a.gate).toBe('plan');
  });

  it('parses --reason=<txt> as string', () => {
    const a = parseArgs(['gate', 'record', '--reason=looks good']);
    expect(a.reason).toBe('looks good');
  });

  it('parses --proposed-content=<txt> into proposedContent', () => {
    const a = parseArgs(['gate', 'record', '--proposed-content=some content']);
    expect(a.proposedContent).toBe('some content');
  });

  it('parses --posing-agent=<name> into posingAgent', () => {
    const a = parseArgs(['gate', 'record', '--posing-agent=planner']);
    expect(a.posingAgent).toBe('planner');
  });

  it('all new value flags default to null', () => {
    const a = parseArgs(['memory', 'init']);
    expect(a.runId).toBeNull();
    expect(a.collection).toBeNull();
    expect(a.bodyJson).toBeNull();
    expect(a.source).toBeNull();
    expect(a.confidence).toBeNull();
    expect(a.verifiedFlag).toBeNull();
    expect(a.taskSummary).toBeNull();
    expect(a.files).toBeNull();
    expect(a.limit).toBeNull();
    expect(a.since).toBeNull();
    expect(a.staleId).toBeNull();
    expect(a.pipeline).toBeNull();
    expect(a.tier).toBeNull();
    expect(a.outcome).toBeNull();
    expect(a.agentsRun).toBeNull();
    expect(a.gatesFired).toBeNull();
    expect(a.gate).toBeNull();
    expect(a.reason).toBeNull();
    expect(a.proposedContent).toBeNull();
    expect(a.posingAgent).toBeNull();
  });
});

describe('parseArgs — --filter= repeatable flag (v0.10+)', () => {
  it('parses a single --filter=k=v into filters record', () => {
    const a = parseArgs(['memory', 'read', '--filter=source=human']);
    expect(a.filters).toEqual({ source: 'human' });
  });

  it('accumulates multiple --filter flags', () => {
    const a = parseArgs(['memory', 'read', '--filter=source=human', '--filter=verified=true']);
    expect(a.filters).toEqual({ source: 'human', verified: 'true' });
  });

  it('last-write-wins on duplicate --filter key', () => {
    const a = parseArgs(['memory', 'read', '--filter=source=human', '--filter=source=agent']);
    expect(a.filters['source']).toBe('agent');
  });

  it('handles value containing = correctly (only splits on first =)', () => {
    const a = parseArgs(['memory', 'read', '--filter=meta=a=b']);
    expect(a.filters['meta']).toBe('a=b');
  });

  it('filters default to empty object', () => {
    const a = parseArgs(['memory', 'read']);
    expect(a.filters).toEqual({});
  });
});

describe('parseArgs — memory/run/gate subcommand routing', () => {
  it('parses `memory init` with subcommand=init', () => {
    const a = parseArgs(['memory', 'init']);
    expect(a.command).toBe('memory');
    expect(a.subcommand).toBe('init');
  });

  it('parses `memory write` with subcommand=write', () => {
    const a = parseArgs(['memory', 'write', 'decisions']);
    expect(a.command).toBe('memory');
    expect(a.subcommand).toBe('write');
    expect(a.unknown).toEqual(['decisions']);
  });

  it('parses `memory mark-stale` with subcommand=mark-stale', () => {
    const a = parseArgs(['memory', 'mark-stale', '--auto']);
    expect(a.subcommand).toBe('mark-stale');
    expect(a.autoStale).toBe(true);
  });

  it('parses `run start` with subcommand=start', () => {
    const a = parseArgs(['run', 'start', '--pipeline=quick-fix']);
    expect(a.command).toBe('run');
    expect(a.subcommand).toBe('start');
    expect(a.pipeline).toBe('quick-fix');
  });

  it('parses `run end` with subcommand=end', () => {
    const a = parseArgs(['run', 'end', '--run-id=x', '--outcome=success']);
    expect(a.command).toBe('run');
    expect(a.subcommand).toBe('end');
    expect(a.runId).toBe('x');
    expect(a.outcome).toBe('success');
  });

  it('parses `gate record` with subcommand=record', () => {
    const a = parseArgs(['gate', 'record', '--gate=plan', '--outcome=approved']);
    expect(a.command).toBe('gate');
    expect(a.subcommand).toBe('record');
    expect(a.gate).toBe('plan');
  });

  it('mix of new flags with existing flags composes correctly', () => {
    const a = parseArgs(['memory', 'read', '--collection=bugs', '--limit=5', '--json']);
    expect(a.command).toBe('memory');
    expect(a.subcommand).toBe('read');
    expect(a.collection).toBe('bugs');
    expect(a.limit).toBe(5);
    expect(a.json).toBe(true);
  });
});
