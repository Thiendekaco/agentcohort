import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInit, InitOptions } from '../src/installer';
import type { ConflictResolver } from '../src/prompt';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const FIXED_NOW = () => new Date(2024, 2, 9, 10, 11, 12); // 2024-03-09 10:11:12

const tmps: string[] = [];
function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-install-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function baseOpts(cwd: string, over: Partial<InitOptions> = {}): InitOptions {
  return {
    cwd,
    yes: true,
    dryRun: false,
    force: false,
    backup: false,
    interactive: false,
    now: FIXED_NOW,
    templatesDir: TEMPLATES,
    models: {
      premium: DEFAULT_MODELS.premium,
      mid: DEFAULT_MODELS.mid,
      cheap: DEFAULT_MODELS.cheap,
    },
    ...over,
  };
}

describe('runInit - fresh project', () => {
  it('creates all 16 agents, 9 commands and CLAUDE.md', async () => {
    const cwd = project();
    const result = await runInit(baseOpts(cwd));

    const agents = readdirSync(join(cwd, '.claude', 'agents'));
    const commands = readdirSync(join(cwd, '.claude', 'commands'));
    expect(agents.length).toBe(16);
    expect(commands.length).toBe(9);
    expect(agents).toContain('repo-scout.md');
    expect(agents).toContain('dispatcher.md');
    expect(commands).toContain('auto-flow.md');
    expect(commands).toContain('quick-fix.md');
    expect(commands).toContain('quick-feature.md');

    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('# Agentcohort Routing Rules');
    expect(claude).toContain('# Project Guidance for Claude Code');

    expect(result.actions.every((a) => a.disposition === 'created')).toBe(true);
    expect(result.actions.some((a) => a.backupPath)).toBe(false);

    // installed content is the rendered template (tier aliases replaced with concrete IDs)
    const tpl = readFileSync(join(TEMPLATES, 'agents', 'repo-scout.md'), 'utf8');
    const installed = readFileSync(join(cwd, '.claude/agents/repo-scout.md'), 'utf8');
    // The raw template has `model: haiku`; after rendering it becomes a concrete model ID.
    expect(installed).not.toBe(tpl);
    expect(installed).toContain(`model: ${DEFAULT_MODELS.cheap}`);
  });

  it('installs the interoperability section before operating standard', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    const i = claude.indexOf('## Interoperability & precedence');
    const j = claude.indexOf('## Operating standard');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  it('installs the Human review gates section + commands carry the gate steps', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    // CLAUDE.md section + each configurable gate is documented
    expect(claude).toContain('## Human review gates');
    expect(claude).toContain('`architect`');
    expect(claude).toContain('`plan`');
    expect(claude).toContain('`root-cause`');
    expect(claude).toContain('`expert-council`');
    // dev-flow.md contains gate steps for architect AND plan
    const devFlow = readFileSync(
      join(cwd, '.claude', 'commands', 'dev-flow.md'),
      'utf8'
    );
    expect(devFlow).toContain('HUMAN GATE — architect');
    expect(devFlow).toContain('HUMAN GATE — plan');
    expect(devFlow).toContain('.agentcohort.json');
    // bug-audit.md contains the root-cause gate
    const bugAudit = readFileSync(
      join(cwd, '.claude', 'commands', 'bug-audit.md'),
      'utf8'
    );
    expect(bugAudit).toContain('HUMAN GATE — root-cause');
    expect(bugAudit).toContain('HUMAN GATE — expert-council');
    // perf-hunt.md contains BOTH the bottleneck and architect gates
    const perfHunt = readFileSync(
      join(cwd, '.claude', 'commands', 'perf-hunt.md'),
      'utf8'
    );
    expect(perfHunt).toContain('HUMAN GATE — bottleneck');
    expect(perfHunt).toContain('HUMAN GATE — architect');
    // CLAUDE.md mentions bottleneck in the gate table
    expect(claude).toContain('`bottleneck`');
    // dispatcher.md exposes Approval gates field
    const dispatcher = readFileSync(
      join(cwd, '.claude', 'agents', 'dispatcher.md'),
      'utf8'
    );
    expect(dispatcher).toContain('Approval gates:');
    // auto-flow.md documents the per-task override syntax
    const autoFlow = readFileSync(
      join(cwd, '.claude', 'commands', 'auto-flow.md'),
      'utf8'
    );
    expect(autoFlow).toContain('gates ±');
  });

  it('installs the OpenWolf interop section with the read matrix', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    // Section header + the three .wolf files agents care about + the
    // license disclaimer that protects agentcohort's MIT status.
    expect(claude).toContain('## OpenWolf interop');
    expect(claude).toContain('`anatomy.md`');
    expect(claude).toContain('`cerebrum.md`');
    expect(claude).toContain('`buglog.json`');
    expect(claude).toContain('MIT');
    expect(claude).toContain('AGPL-3.0');
    // The section must sit BEFORE the default-behavior / operating-standard
    // sections so precedence rules are clear when agents read top-down.
    const interop = claude.indexOf('## OpenWolf interop');
    const defaults = claude.indexOf('## Default behavior');
    const operating = claude.indexOf('## Operating standard');
    expect(interop).toBeGreaterThan(-1);
    expect(interop).toBeLessThan(defaults);
    expect(defaults).toBeLessThan(operating);
  });

  it('every agent boot directive mentions OpenWolf so .wolf/ is checked', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const agentDir = join(cwd, '.claude', 'agents');
    const files = readdirSync(agentDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(16);
    for (const f of files) {
      const text = readFileSync(join(agentDir, f), 'utf8');
      const start = text.indexOf('<!-- boot-directive-start -->');
      const end = text.indexOf('<!-- boot-directive-end -->');
      const directive = text.slice(start, end);
      expect(directive, `${f}: boot directive must reference .wolf/`).toContain(
        '.wolf/'
      );
      expect(directive, `${f}: must not write to .wolf/`).toContain(
        'Do NOT modify `.wolf/` directly'
      );
    }
  });

  it('installs the delimited boot directive at the top of every agent', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const agentDir = join(cwd, '.claude', 'agents');
    const files = readdirSync(agentDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(16);
    for (const f of files) {
      const text = readFileSync(join(agentDir, f), 'utf8');
      const start = text.indexOf('<!-- boot-directive-start -->');
      const end = text.indexOf('<!-- boot-directive-end -->');
      const role = text.indexOf('# Role');
      expect(start, `${f}: missing boot-directive-start`).toBeGreaterThan(-1);
      expect(end, `${f}: missing boot-directive-end`).toBeGreaterThan(-1);
      expect(role, `${f}: missing # Role`).toBeGreaterThan(-1);
      // Directive sits between frontmatter and # Role.
      expect(start).toBeLessThan(end);
      expect(end).toBeLessThan(role);
    }
  });

  it('is idempotent: a second run reports everything unchanged', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const second = await runInit(baseOpts(cwd));
    expect(second.actions.every((a) => a.disposition === 'unchanged')).toBe(true);
    expect(second.actions.some((a) => a.backupPath)).toBe(false);
  });

  it('renders agent files with the default concrete model IDs', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const scout = readFileSync(
      join(cwd, '.claude', 'agents', 'repo-scout.md'),
      'utf8'
    );
    expect(scout).toContain(`model: ${DEFAULT_MODELS.cheap}`);
    expect(scout).not.toMatch(/^model:[ \t]+haiku[ \t]*$/m);

    const reviewer = readFileSync(
      join(cwd, '.claude', 'agents', 'final-reviewer.md'),
      'utf8'
    );
    expect(reviewer).toContain(`model: ${DEFAULT_MODELS.premium}`);
  });

  it('renders agent files with custom model IDs', async () => {
    const cwd = project();
    await runInit(
      baseOpts(cwd, {
        models: { premium: 'P', mid: 'M', cheap: 'C' },
      })
    );
    const scout = readFileSync(
      join(cwd, '.claude', 'agents', 'repo-scout.md'),
      'utf8'
    );
    expect(scout).toContain('model: C');
  });

  it('does NOT rewrite model: in command files', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const tplPath = join(TEMPLATES, 'commands', 'auto-flow.md');
    const installedPath = join(cwd, '.claude', 'commands', 'auto-flow.md');
    expect(readFileSync(installedPath, 'utf8')).toBe(
      readFileSync(tplPath, 'utf8')
    );
  });
});

describe('runInit - dry run', () => {
  it('writes nothing but reports the would-be creations', async () => {
    const cwd = project();
    const result = await runInit(baseOpts(cwd, { dryRun: true }));
    expect(existsSync(join(cwd, '.claude'))).toBe(false);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.actions.every((a) => a.disposition === 'created' && a.dryRun)).toBe(
      true
    );
  });
});

describe('runInit - conflicts on a regular file', () => {
  function seedDifferentAgent(cwd: string): string {
    const p = join(cwd, '.claude', 'agents', 'repo-scout.md');
    mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(p, 'OLD USER CONTENT\n', 'utf8');
    return p;
  }

  it('--yes safe default backs up then overwrites (no data loss)', async () => {
    const cwd = project();
    const p = seedDifferentAgent(cwd);
    const result = await runInit(baseOpts(cwd));

    const rec = result.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec.disposition).toBe('overwritten');
    expect(rec.backupPath).toBeDefined();
    expect(readFileSync(rec.backupPath!, 'utf8')).toBe('OLD USER CONTENT\n');
    expect(readFileSync(p, 'utf8')).toContain(`model: ${DEFAULT_MODELS.cheap}`);
  });

  it('--force overwrites WITHOUT a backup unless --backup is set', async () => {
    const cwd = project();
    seedDifferentAgent(cwd);
    const r1 = await runInit(baseOpts(cwd, { force: true }));
    const rec1 = r1.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec1.disposition).toBe('overwritten');
    expect(rec1.backupPath).toBeUndefined();

    seedDifferentAgent(cwd);
    const r2 = await runInit(baseOpts(cwd, { force: true, backup: true }));
    const rec2 = r2.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec2.backupPath).toBeDefined();
    expect(existsSync(rec2.backupPath!)).toBe(true);
  });

  it('interactive "skip" preserves the user file and never deletes it', async () => {
    const cwd = project();
    const p = seedDifferentAgent(cwd);
    const skip: ConflictResolver = async () => ({ choice: 'skip', applyToAll: true });
    const result = await runInit(
      baseOpts(cwd, { yes: false, interactive: true, resolver: skip })
    );
    const rec = result.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec.disposition).toBe('skipped');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('OLD USER CONTENT\n');
  });

  it('dry-run on a conflict reports the action but writes/backs-up nothing', async () => {
    const cwd = project();
    const p = seedDifferentAgent(cwd);
    const result = await runInit(baseOpts(cwd, { dryRun: true }));
    const rec = result.actions.find((a) => a.targetRelPath.endsWith('repo-scout.md'))!;
    expect(rec.disposition).toBe('overwritten');
    expect(rec.backupPath).toBeDefined();
    expect(existsSync(rec.backupPath!)).toBe(false); // not actually written
    expect(readFileSync(p, 'utf8')).toBe('OLD USER CONTENT\n'); // untouched
  });
});

describe('runInit - CLAUDE.md handling', () => {
  it('appends the section to an existing CLAUDE.md without losing user content', async () => {
    const cwd = project();
    const original = '# My Project\n\nImportant project notes the user wrote.\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), original, 'utf8');

    const result = await runInit(baseOpts(cwd));
    const rec = result.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('appended-section');
    expect(rec.backupPath).toBeUndefined(); // append is non-destructive

    const after = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('Important project notes the user wrote.');
    expect(after).toContain('# Agentcohort Routing Rules');
  });

  it('non-interactive leaves a DIFFERING existing section untouched (skip)', async () => {
    const cwd = project();
    const doc =
      '# My Project\n\nnotes\n\n# Agentcohort Routing Rules\n\nMY CUSTOM RULES\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), doc, 'utf8');

    const result = await runInit(baseOpts(cwd));
    const rec = result.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('skipped');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(doc);
  });

  it('--force replaces the section but preserves surrounding content', async () => {
    const cwd = project();
    const doc =
      '# My Project\n\nkeep me\n\n# Agentcohort Routing Rules\n\nOLD RULES\n\n# Other\n\nkeep me too\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), doc, 'utf8');

    const result = await runInit(baseOpts(cwd, { force: true }));
    const rec = result.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('replaced-section');

    const after = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('keep me');
    expect(after).toContain('keep me too');
    expect(after).toContain('# Other');
    expect(after).not.toContain('OLD RULES');
    expect(after.match(/^# Agentcohort Routing Rules\s*$/gm)?.length).toBe(1);
  });

  it('reports the section unchanged on a second run (idempotent)', async () => {
    const cwd = project();
    await runInit(baseOpts(cwd));
    const second = await runInit(baseOpts(cwd));
    const rec = second.actions.find((a) => a.targetRelPath === 'CLAUDE.md')!;
    expect(rec.disposition).toBe('unchanged');
  });
});
