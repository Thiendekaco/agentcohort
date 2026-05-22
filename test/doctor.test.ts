import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runDoctor } from '../src/doctor';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-doctor-'));
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

describe('runDoctor — healthy install', () => {
  it('reports healthy with exitCode 0 on a fresh full install', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    expect(report.summary).toBe('healthy');
    expect(report.exitCode).toBe(0);
    // Every check is `ok` — no warnings or errors.
    for (const s of report.sections) {
      for (const c of s.checks) {
        expect(
          c.severity,
          `${s.name} / ${c.id} unexpectedly non-ok: ${c.message}`
        ).toBe('ok');
      }
    }
  });
});

describe('runDoctor — Project section', () => {
  it('warns when .claude/ directories and CLAUDE.md are missing', () => {
    const cwd = project();
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    expect(report.exitCode).toBe(1);
    const projectSection = report.sections.find((s) => s.name === 'Project')!;
    // The three required artifacts must be flagged warn.
    for (const id of [
      'project..claude/agents',
      'project..claude/commands',
      'project.CLAUDE.md',
    ]) {
      const check = projectSection.checks.find((c) => c.id === id)!;
      expect(check, `expected check ${id}`).toBeDefined();
      expect(check.severity).toBe('warn');
    }
    // .agentcohort.json is optional — its absence is `ok` with an
    // informational message.
    const cfg = projectSection.checks.find(
      (c) => c.id === 'project..agentcohort.json'
    )!;
    expect(cfg.severity).toBe('ok');
  });
});

describe('runDoctor — Config section', () => {
  it('warns when .agentcohort.json is missing', () => {
    const cwd = project();
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const cfg = report.sections.find((s) => s.name === 'Config')!;
    expect(cfg.checks.some((c) => c.id === 'config.missing')).toBe(true);
  });

  it('errors when .agentcohort.json is malformed JSON', async () => {
    const cwd = project();
    writeFileSync(join(cwd, '.agentcohort.json'), '{{{ not json', 'utf8');
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const cfg = report.sections.find((s) => s.name === 'Config')!;
    const parse = cfg.checks.find((c) => c.id === 'config.parse')!;
    expect(parse.severity).toBe('error');
    expect(report.exitCode).toBe(1);
  });

  it('errors when models field is missing/invalid', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({ version: 1, models: { premium: '', mid: 'x', cheap: 'y' } }),
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const models = report.sections
      .find((s) => s.name === 'Config')!
      .checks.find((c) => c.id === 'config.models')!;
    expect(models.severity).toBe('error');
  });

  it('warns (does not crash) on unknown gate keys', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: DEFAULT_MODELS,
        gates: { architect: 'on', plzn: 'on' },
      }),
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const gates = report.sections
      .find((s) => s.name === 'Config')!
      .checks.find((c) => c.id === 'config.gates')!;
    expect(gates.severity).toBe('warn');
    expect(gates.detail?.some((d) => d.includes('plzn'))).toBe(true);
  });

  it('warns on invalid gate mode but does not crash', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: DEFAULT_MODELS,
        gates: { architect: 'maybe' },
      }),
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const gates = report.sections
      .find((s) => s.name === 'Config')!
      .checks.find((c) => c.id === 'config.gates')!;
    expect(gates.severity).toBe('warn');
  });
});

describe('runDoctor — Agents/Commands integrity', () => {
  it('detects a user-edited agent as `user-edited`', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Modify body — leaves the stamp in place but contentHash now differs.
    const agentPath = join(cwd, '.claude', 'agents', 'repo-scout.md');
    const text = readFileSync(agentPath, 'utf8');
    writeFileSync(
      agentPath,
      text.replace('# Role', '# Role\n\nUSER HAND-EDITED THIS\n'),
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const agents = report.sections.find((s) => s.name === 'Agents')!;
    const edited = agents.checks.find((c) => c.id === 'agents.user-edited');
    expect(edited).toBeDefined();
    expect(edited!.detail).toContain('repo-scout.md');
    expect(report.exitCode).toBe(1);
  });

  it('detects an extra agent file not in the bundled manifest', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'my-custom-agent.md'),
      '---\nname: x\n---\n\n# Role\n',
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const extra = report.sections
      .find((s) => s.name === 'Agents')!
      .checks.find((c) => c.id === 'agents.extra');
    expect(extra).toBeDefined();
    expect(extra!.detail).toContain('my-custom-agent.md');
  });

  it('detects a missing agent file', async () => {
    const cwd = project();
    await fullInstall(cwd);
    rmSync(join(cwd, '.claude', 'agents', 'dispatcher.md'));
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const missing = report.sections
      .find((s) => s.name === 'Agents')!
      .checks.find((c) => c.id === 'agents.missing');
    expect(missing).toBeDefined();
    expect(missing!.detail).toContain('dispatcher.md');
  });

  it('detects unstamped (pre-0.4.0) installs', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Strip the stamp from one agent to simulate a legacy install.
    const agentPath = join(cwd, '.claude', 'agents', 'final-reviewer.md');
    const text = readFileSync(agentPath, 'utf8');
    writeFileSync(
      agentPath,
      text.replace(/^_agentcohort_hash:[ \t]+\S+[ \t]*\r?\n/m, ''),
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const unstamped = report.sections
      .find((s) => s.name === 'Agents')!
      .checks.find((c) => c.id === 'agents.unstamped');
    expect(unstamped).toBeDefined();
    expect(unstamped!.detail).toContain('final-reviewer.md');
  });
});

describe('runDoctor — CLAUDE.md', () => {
  it('errors when CLAUDE.md is missing', async () => {
    const cwd = project();
    // Install everything EXCEPT CLAUDE.md by removing it post-install.
    await fullInstall(cwd);
    rmSync(join(cwd, 'CLAUDE.md'));
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const claude = report.sections.find((s) => s.name === 'CLAUDE.md')!;
    const missing = claude.checks.find((c) => c.id === 'claudeMd.missing');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('error');
  });

  it('errors when the routing section is duplicated', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const path = join(cwd, 'CLAUDE.md');
    const text = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      text + '\n\n# Agentcohort Routing Rules\n\nduplicate\n',
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const dup = report.sections
      .find((s) => s.name === 'CLAUDE.md')!
      .checks.find((c) => c.id === 'claudeMd.section-duplicated');
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe('error');
  });

  it('errors when the routing section is missing entirely', () => {
    const cwd = project();
    mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(cwd, '.claude', 'commands'), { recursive: true });
    writeFileSync(
      join(cwd, 'CLAUDE.md'),
      '# Project Guidance for Claude Code\n\nno routing section here.\n',
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const missing = report.sections
      .find((s) => s.name === 'CLAUDE.md')!
      .checks.find((c) => c.id === 'claudeMd.section-missing');
    expect(missing).toBeDefined();
  });
});

describe('runDoctor — exit codes', () => {
  it('exits 0 on healthy', async () => {
    const cwd = project();
    await fullInstall(cwd);
    expect(runDoctor({ cwd, templatesDir: TEMPLATES }).exitCode).toBe(0);
  });

  it('exits 1 on any warning or error', async () => {
    const cwd = project();
    await fullInstall(cwd);
    rmSync(join(cwd, '.claude', 'agents', 'dispatcher.md'));
    expect(runDoctor({ cwd, templatesDir: TEMPLATES }).exitCode).toBe(1);
  });
});

describe('runDoctor — overlay-aware (PR2)', () => {
  it('does NOT flag a local-override as user-edited / unstamped', async () => {
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

Local.
`,
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const agentsSection = report.sections.find((s) => s.name === 'Agents')!;
    const issues = agentsSection.checks.filter(
      (c) =>
        c.id.endsWith('.user-edited') ||
        c.id.endsWith('.unstamped') ||
        c.id.endsWith('.outdated') ||
        c.id.endsWith('.extra')
    );
    for (const i of issues) {
      expect(i.detail ?? []).not.toContain('bug-hunter.md');
    }
    // And there IS a local check entry.
    const localCheck = agentsSection.checks.find((c) => c.id === 'agents.local');
    expect(localCheck).toBeDefined();
    expect(localCheck!.detail?.some((d) => d.startsWith('bug-hunter.md'))).toBe(
      true
    );
  });

  it('counts a local-new file under `local`, not under `extra`', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const localPath = join(cwd, '.claude', 'agents', 'my-new.md');
    writeFileSync(
      localPath,
      `---
name: my-new
description: New
_agentcohort_local: true
---

Body.
`,
      'utf8'
    );
    const report = runDoctor({ cwd, templatesDir: TEMPLATES });
    const agentsSection = report.sections.find((s) => s.name === 'Agents')!;
    const extra = agentsSection.checks.find((c) => c.id === 'agents.extra');
    expect(extra).toBeUndefined();
    const local = agentsSection.checks.find((c) => c.id === 'agents.local');
    expect(local).toBeDefined();
    expect(local!.detail).toContain('my-new.md');
  });
});

describe('runDoctor — skill-drift detection (PR3)', () => {
  it('warns about stale skill lists with a refresh-skills hint', async () => {
    const cwd = project();
    // Install with two skills baked in.
    await runInit({
      cwd,
      yes: true,
      dryRun: false,
      force: false,
      backup: false,
      interactive: false,
      now: () => new Date(2026, 4, 25, 12, 0, 0),
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [
        {
          name: 'skill-original',
          description: 'original',
          scope: 'user',
          path: '/x',
          skillMdPath: '/x/SKILL.md',
          hasExtras: false,
        },
      ],
    });
    // Run doctor with a DIFFERENT skill list (simulating user installed a new skill).
    const report = runDoctor({
      cwd,
      templatesDir: TEMPLATES,
      skills: [
        {
          name: 'skill-original',
          description: 'original',
          scope: 'user',
          path: '/x',
          skillMdPath: '/x/SKILL.md',
          hasExtras: false,
        },
        {
          name: 'skill-NEW',
          description: 'just added',
          scope: 'user',
          path: '/y',
          skillMdPath: '/y/SKILL.md',
          hasExtras: false,
        },
      ],
    });
    const agentsSection = report.sections.find((s) => s.name === 'Agents')!;
    const skillsStale = agentsSection.checks.find((c) => c.id === 'agents.skills-stale');
    expect(skillsStale).toBeDefined();
    expect(skillsStale!.message).toContain('refresh-skills');
    expect(skillsStale!.severity).toBe('warn');
    // Detail lists actual file names.
    expect(skillsStale!.detail).toContain('bug-hunter.md');
  });

  it('does NOT warn when the embedded skill list matches current scan', async () => {
    const cwd = project();
    const sameSkills = [
      {
        name: 'unchanged',
        description: 'no drift here',
        scope: 'user' as const,
        path: '/x',
        skillMdPath: '/x/SKILL.md',
        hasExtras: false,
      },
    ];
    await runInit({
      cwd,
      yes: true,
      dryRun: false,
      force: false,
      backup: false,
      interactive: false,
      now: () => new Date(2026, 4, 25, 12, 0, 0),
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: sameSkills,
    });
    const report = runDoctor({
      cwd,
      templatesDir: TEMPLATES,
      skills: sameSkills,
    });
    const agentsSection = report.sections.find((s) => s.name === 'Agents')!;
    const skillsStale = agentsSection.checks.find((c) => c.id === 'agents.skills-stale');
    expect(skillsStale).toBeUndefined();
  });
});
