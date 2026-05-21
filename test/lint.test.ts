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
import { runLint } from '../src/lint';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-lint-'));
  tmps.push(d);
  return d;
}

/** Read a file and normalize CRLF→LF for cross-platform test consistency. */
function readLF(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
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

describe('runLint — clean install', () => {
  it('reports clean with exitCode 0 on a fresh full install', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    expect(report.summary).toBe('clean');
    expect(report.exitCode).toBe(0);
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

describe('runLint — Agent frontmatter', () => {
  it('errors when an agent file is missing the opening `---`', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'repo-scout.md');
    const text = readLF(target).replace(/^---\n/, '');
    writeFileSync(target, text, 'utf8');
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'Agent frontmatter')!;
    const check = section.checks.find((c) => c.id === 'agents.frontmatter-broken');
    expect(check).toBeDefined();
    expect(check!.severity).toBe('error');
    expect(check!.detail?.some((d) => d.startsWith('repo-scout.md'))).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it('errors when an agent file is missing a required frontmatter key', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'feature-planner.md');
    const text = readLF(target).replace(/^description:.*\n/m, '');
    writeFileSync(target, text, 'utf8');
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const check = report.sections
      .find((s) => s.name === 'Agent frontmatter')!
      .checks.find((c) => c.id === 'agents.frontmatter-broken')!;
    expect(check).toBeDefined();
    expect(check.severity).toBe('error');
    expect(
      check.detail?.some(
        (d) => d.startsWith('feature-planner.md') && d.includes('description')
      )
    ).toBe(true);
  });

  it('treats a custom agent with valid frontmatter as ok', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'my-helper.md'),
      '---\nname: my-helper\ndescription: helps\ntools: Read\nmodel: haiku\n---\n\n# Role\n',
      'utf8'
    );
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    expect(report.summary).toBe('clean');
  });

  it('passes when .claude/agents/ is absent (nothing to lint)', () => {
    const cwd = project();
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'Agent frontmatter')!;
    expect(section.checks[0]!.severity).toBe('ok');
    expect(section.checks[0]!.id).toBe('agents.dir-missing');
  });
});

describe('runLint — Boot directive', () => {
  it('warns when an agent file is missing the boot directive markers', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const text = readLF(target)
      .replace('<!-- boot-directive-start -->', '')
      .replace('<!-- boot-directive-end -->', '');
    writeFileSync(target, text, 'utf8');
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const check = report.sections
      .find((s) => s.name === 'Boot directive')!
      .checks.find((c) => c.id === 'boot.missing')!;
    expect(check).toBeDefined();
    expect(check.severity).toBe('warn');
    expect(check.detail).toContain('dispatcher.md');
  });

  it('does NOT flag user-authored custom agents that lack the boot directive', async () => {
    // Boot directive is the signal "this came from agentcohort init".
    // When templatesDir is provided, lint scopes the check to files
    // whose name exists in the bundled manifest — custom user agents
    // are exempt.
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'my-helper.md'),
      '---\nname: my-helper\ndescription: stub\ntools: Read\nmodel: haiku\n---\n\n# Role\n',
      'utf8'
    );
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'Boot directive')!;
    expect(section.checks[0]!.id).toBe('boot.present');
    expect(section.checks[0]!.severity).toBe('ok');
  });
});

describe('runLint — Model references', () => {
  it('passes when every agent uses a known tier alias or configured concrete ID', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'Model references')!;
    expect(section.checks[0]!.severity).toBe('ok');
    expect(section.checks[0]!.id).toBe('models.resolved');
  });

  it('warns when an agent uses an unrecognized model value', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'solution-architect.md');
    const text = readLF(target).replace(
      /^model:.+$/m,
      'model: not-a-real-model-id'
    );
    writeFileSync(target, text, 'utf8');
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const check = report.sections
      .find((s) => s.name === 'Model references')!
      .checks.find((c) => c.id === 'models.unresolved')!;
    expect(check).toBeDefined();
    expect(check.severity).toBe('warn');
    expect(check.detail?.some((d) => d.includes('solution-architect.md'))).toBe(
      true
    );
    expect(check.detail?.some((d) => d.includes('not-a-real-model-id'))).toBe(
      true
    );
  });

  it('accepts the raw alias `opus`/`sonnet`/`haiku` as a valid model value', async () => {
    // Templates ship with aliases; render rewrites them to concrete IDs.
    // A user reverting to the alias should NOT be flagged.
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'repo-scout.md');
    const text = readLF(target).replace(/^model:.+$/m, 'model: haiku');
    writeFileSync(target, text, 'utf8');
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'Model references')!;
    expect(section.checks[0]!.id).toBe('models.resolved');
  });

  it('respects a user-customized `.agentcohort.json` models map', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // User reconfigures premium to a hypothetical "ultra" ID (the
    // other tiers stay at default). After the swap, an agent using
    // `claude-ultra` must NOT appear in the unresolved list — that's
    // the test. (Other agents may still flag because they reference
    // the OLD premium ID that the user's config no longer points to;
    // that's a separate, correct detection.)
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: {
          premium: 'claude-ultra',
          mid: 'claude-sonnet-4-6',
          cheap: 'claude-haiku-4-5-20251001',
        },
      }),
      'utf8'
    );
    const target = join(cwd, '.claude', 'agents', 'solution-architect.md');
    const text = readLF(target).replace(/^model:.+$/m, 'model: claude-ultra');
    writeFileSync(target, text, 'utf8');
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const check = report.sections
      .find((s) => s.name === 'Model references')!
      .checks.find((c) => c.id === 'models.unresolved');
    // solution-architect.md must NOT be in the unresolved list.
    expect(
      check?.detail?.some((d) => d.includes('solution-architect.md')) ?? false
    ).toBe(false);
  });
});

describe('runLint — CLAUDE.md references', () => {
  it('warns when the user section references a slash command not installed', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Append a user-owned section AFTER the agentcohort routing section
    // by adding a fake top-level heading and a reference to a missing command.
    const claudePath = join(cwd, 'CLAUDE.md');
    const text = readLF(claudePath);
    writeFileSync(
      claudePath,
      text + '\n\n# Project notes\n\nUse `/totally-fake-command` to wave a magic wand.\n',
      'utf8'
    );
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const check = report.sections
      .find((s) => s.name === 'CLAUDE.md references')!
      .checks.find((c) => c.id === 'claudeMd.stale-commands')!;
    expect(check).toBeDefined();
    expect(check.severity).toBe('warn');
    expect(check.detail?.some((d) => d.includes('/totally-fake-command'))).toBe(
      true
    );
  });

  it('does not flag command references INSIDE the agentcohort routing section', async () => {
    // The agentcohort section lists `/dev-flow` etc. — that's our own
    // content, not user content, and should be excluded from the scan.
    const cwd = project();
    await fullInstall(cwd);
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'CLAUDE.md references')!;
    expect(section.checks.every((c) => c.severity === 'ok')).toBe(true);
  });

  it('does not flag installed commands referenced in the user section', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const claudePath = join(cwd, 'CLAUDE.md');
    const text = readLF(claudePath);
    writeFileSync(
      claudePath,
      text + '\n\n# Project notes\n\nWe like `/dev-flow` and `/quick-fix`.\n',
      'utf8'
    );
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'CLAUDE.md references')!;
    expect(section.checks[0]!.severity).toBe('ok');
  });

  it('passes when CLAUDE.md is absent', () => {
    const cwd = project();
    const report = runLint({ cwd, templatesDir: TEMPLATES });
    const section = report.sections.find((s) => s.name === 'CLAUDE.md references')!;
    expect(section.checks[0]!.id).toBe('claudeMd.missing');
    expect(section.checks[0]!.severity).toBe('ok');
  });
});

describe('runLint — exit codes', () => {
  it('exits 0 on clean', async () => {
    const cwd = project();
    await fullInstall(cwd);
    expect(runLint({ cwd }).exitCode).toBe(0);
  });

  it('exits 1 on any warning or error', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const text = readFileSync(target, 'utf8').replace(
      '<!-- boot-directive-start -->',
      ''
    );
    writeFileSync(target, text, 'utf8');
    expect(runLint({ cwd }).exitCode).toBe(1);
  });
});
