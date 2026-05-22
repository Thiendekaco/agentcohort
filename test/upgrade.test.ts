import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  runUpgrade,
  UpgradeResolver,
  UpgradeConflictDecision,
} from '../src/upgrade';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';
import { parseStamp } from '../src/stamp';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-upgrade-'));
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

const baseOpts = (cwd: string) => ({
  cwd,
  dryRun: false,
  force: false,
  backup: false,
  interactive: false,
  templatesDir: TEMPLATES,
  models: { ...DEFAULT_MODELS },
  now: () => new Date(2026, 4, 20, 12, 0, 0),
});

describe('runUpgrade — no-op when already in sync', () => {
  it('marks every file unchanged on a fresh install', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = await runUpgrade(baseOpts(cwd));
    for (const a of result.actions) {
      expect(
        a.disposition === 'unchanged' || a.disposition === 'section-unchanged',
        `${a.targetRelPath} unexpectedly ${a.disposition}`
      ).toBe(true);
    }
  });
});

describe('runUpgrade — outdated files auto-refresh', () => {
  it('refreshes a file whose stamp matches an older bundled body', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Replace dispatcher.md with the SAME stamp but an older body.
    // Easiest simulation: parse current stamp, write a body that has
    // the old stamp value but different content. Since contentHash
    // depends on the body, we can't easily fake "outdated" — but we
    // can simulate by overwriting the body with stale content while
    // keeping the stamp line intact. compareIntegrity will then
    // classify as 'user-edited' (body hash != stamp).
    //
    // Instead, simulate `outdated` correctly: install fresh, then
    // mutate the BUNDLED templatesDir for one file so the installed
    // file's stamp matches the OLD bundled but bundled has now moved
    // on. We'd need a separate temp templatesDir for that.
    const altTemplates = mkdtempSync(join(tmpdir(), 'af-templates-'));
    tmps.push(altTemplates);
    copyDirSync(TEMPLATES, altTemplates);
    const targetAlt = join(altTemplates, 'agents', 'repo-scout.md');
    const txt = readFileSync(targetAlt, 'utf8');
    writeFileSync(
      targetAlt,
      txt.replace('# Role', '# Role\n\nNEW LINE FROM "UPGRADED" TEMPLATES\n'),
      'utf8'
    );
    const result = await runUpgrade({ ...baseOpts(cwd), templatesDir: altTemplates });
    const a = result.actions.find((x) => x.targetRelPath.endsWith('repo-scout.md'))!;
    expect(a.verdict).toBe('outdated');
    expect(a.disposition).toBe('refreshed');
    // File should now contain the "upgraded" content.
    const installed = readFileSync(
      join(cwd, '.claude', 'agents', 'repo-scout.md'),
      'utf8'
    );
    expect(installed).toContain('NEW LINE FROM "UPGRADED" TEMPLATES');
  });
});

describe('runUpgrade — user-edited file conflict resolution', () => {
  it('keeps user-edited file in non-interactive mode (safe default)', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const originalBody = readFileSync(target, 'utf8');
    writeFileSync(
      target,
      originalBody.replace('# Role', '# Role\n\nUSER-EDITED LOCALLY\n'),
      'utf8'
    );
    const result = await runUpgrade(baseOpts(cwd));
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.verdict).toBe('user-edited');
    expect(a.disposition).toBe('kept');
    // File still contains user edit.
    expect(readFileSync(target, 'utf8')).toContain('USER-EDITED LOCALLY');
  });

  it('overwrites user-edited file when --force', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('# Role', '# Role\n\nUSER EDIT\n'),
      'utf8'
    );
    const result = await runUpgrade({ ...baseOpts(cwd), force: true });
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.disposition).toBe('overwritten');
    expect(readFileSync(target, 'utf8')).not.toContain('USER EDIT');
  });

  it('asks the resolver when interactive — applies its `keep` decision', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('# Role', '# Role\n\nUSER EDIT\n'),
      'utf8'
    );
    const seen: string[] = [];
    const resolver: UpgradeResolver = async (req) => {
      seen.push(req.targetRelPath);
      return { choice: 'keep' };
    };
    const result = await runUpgrade({
      ...baseOpts(cwd),
      interactive: true,
      resolver,
    });
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.disposition).toBe('kept');
    expect(seen).toContain('.claude/agents/dispatcher.md');
  });

  it('asks the resolver when interactive — applies its `overwrite` decision', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('# Role', '# Role\n\nUSER EDIT\n'),
      'utf8'
    );
    const resolver: UpgradeResolver = async () => ({ choice: 'overwrite' });
    const result = await runUpgrade({
      ...baseOpts(cwd),
      interactive: true,
      resolver,
    });
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.disposition).toBe('overwritten');
    expect(readFileSync(target, 'utf8')).not.toContain('USER EDIT');
  });

  it('writes a backup file when resolver picks backup-overwrite', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('# Role', '# Role\n\nUSER EDIT\n'),
      'utf8'
    );
    const resolver: UpgradeResolver = async () => ({ choice: 'backup-overwrite' });
    const result = await runUpgrade({
      ...baseOpts(cwd),
      interactive: true,
      resolver,
    });
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.disposition).toBe('backed-up-and-overwritten');
    expect(a.backupPath).toBeDefined();
    expect(existsSync(a.backupPath!)).toBe(true);
    expect(readFileSync(a.backupPath!, 'utf8')).toContain('USER EDIT');
  });

  it('honors applyToAll across multiple conflicts', async () => {
    const cwd = project();
    await fullInstall(cwd);
    for (const name of ['dispatcher.md', 'repo-scout.md', 'feature-planner.md']) {
      const t = join(cwd, '.claude', 'agents', name);
      writeFileSync(
        t,
        readFileSync(t, 'utf8').replace('# Role', '# Role\n\nEDIT\n'),
        'utf8'
      );
    }
    let calls = 0;
    const resolver: UpgradeResolver = async () => {
      calls += 1;
      return { choice: 'overwrite', applyToAll: true };
    };
    const result = await runUpgrade({
      ...baseOpts(cwd),
      interactive: true,
      resolver,
    });
    expect(calls).toBe(1); // applyToAll short-circuits subsequent prompts
    const overwritten = result.actions.filter((a) => a.disposition === 'overwritten');
    expect(overwritten.length).toBeGreaterThanOrEqual(3);
  });
});

describe('runUpgrade — unstamped files', () => {
  it('treats a file with no integrity stamp as a conflict', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    // Strip the _agentcohort_hash line — simulates a pre-0.4.0 install.
    const stripped = readFileSync(target, 'utf8').replace(
      /^_agentcohort_hash:[ \t]+\S+[ \t]*\r?\n/m,
      ''
    );
    writeFileSync(target, stripped, 'utf8');
    const seen: string[] = [];
    const resolver: UpgradeResolver = async (req) => {
      seen.push(req.reason);
      return { choice: 'overwrite' };
    };
    const result = await runUpgrade({
      ...baseOpts(cwd),
      interactive: true,
      resolver,
    });
    expect(seen).toContain('unstamped');
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.verdict).toBe('unstamped');
    expect(a.disposition).toBe('overwritten');
    // After overwrite, file should have a fresh stamp.
    expect(parseStamp(readFileSync(target, 'utf8'))).toBeDefined();
  });
});

describe('runUpgrade — new files', () => {
  it('installs a bundled file that is missing locally', async () => {
    const cwd = project();
    await fullInstall(cwd);
    // Delete one file to simulate "new in this version".
    rmSync(join(cwd, '.claude', 'agents', 'final-reviewer.md'));
    const result = await runUpgrade(baseOpts(cwd));
    const a = result.actions.find((x) =>
      x.targetRelPath.endsWith('final-reviewer.md')
    )!;
    expect(a.verdict).toBe('new');
    expect(a.disposition).toBe('created');
    expect(existsSync(join(cwd, '.claude', 'agents', 'final-reviewer.md'))).toBe(true);
  });
});

describe('runUpgrade — CLAUDE.md section', () => {
  it('marks the section unchanged when CLAUDE.md is fresh', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = await runUpgrade(baseOpts(cwd));
    const a = result.actions.find((x) => x.targetRelPath === 'CLAUDE.md')!;
    expect(a.disposition).toBe('section-unchanged');
  });

  it('keeps a hand-edited routing section in non-interactive mode', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const claudePath = join(cwd, 'CLAUDE.md');
    const text = readFileSync(claudePath, 'utf8');
    // Edit must be INSIDE the agentcohort routing section (otherwise
    // `sectionMatches` returns true and the action is `section-unchanged`).
    // `## Operating standard` is a subsection guaranteed to live inside ours.
    expect(text).toContain('## Operating standard');
    writeFileSync(
      claudePath,
      text.replace(
        '## Operating standard',
        '## Operating standard (USER EDITED HEADING)'
      ),
      'utf8'
    );
    const result = await runUpgrade(baseOpts(cwd));
    const a = result.actions.find((x) => x.targetRelPath === 'CLAUDE.md')!;
    expect(a.disposition).toBe('section-kept');
  });

  it('preserves user content OUTSIDE the routing section when overwriting', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const claudePath = join(cwd, 'CLAUDE.md');
    const text = readFileSync(claudePath, 'utf8');
    // Modify the section (so upgrade conflicts) AND add user content
    // outside the section that must survive overwrite.
    writeFileSync(
      claudePath,
      text.replace(
        '## Operating standard',
        '## Operating standard (EDITED)'
      ) + '\n\n# My project notes\n\nDo not touch this.\n',
      'utf8'
    );
    const resolver: UpgradeResolver = async () => ({ choice: 'overwrite' });
    await runUpgrade({ ...baseOpts(cwd), interactive: true, resolver });
    const after = readFileSync(claudePath, 'utf8');
    expect(after).toContain('# My project notes');
    expect(after).toContain('Do not touch this.');
  });
});

describe('runUpgrade — dry-run', () => {
  it('does not write anything in dry-run mode', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const target = join(cwd, '.claude', 'agents', 'dispatcher.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('# Role', '# Role\n\nUSER EDIT\n'),
      'utf8'
    );
    const before = readFileSync(target, 'utf8');
    const result = await runUpgrade({ ...baseOpts(cwd), dryRun: true, force: true });
    expect(result.dryRun).toBe(true);
    // File is unchanged.
    expect(readFileSync(target, 'utf8')).toBe(before);
    // The action says it would have been overwritten.
    const a = result.actions.find((x) => x.targetRelPath.endsWith('dispatcher.md'))!;
    expect(a.disposition).toBe('overwritten');
    expect(a.dryRun).toBe(true);
  });
});

describe('runUpgrade — leaves user-created files alone', () => {
  it('does not delete or touch custom agent files not in the bundled manifest', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const custom = join(cwd, '.claude', 'agents', 'my-helper.md');
    writeFileSync(
      custom,
      '---\nname: my-helper\ndescription: stub\ntools: Read\nmodel: haiku\n---\n\n# Role\n',
      'utf8'
    );
    await runUpgrade(baseOpts(cwd));
    expect(existsSync(custom)).toBe(true);
    expect(readFileSync(custom, 'utf8')).toContain('my-helper');
  });
});

// ---- helpers ----

function copyDirSync(from: string, to: string): void {
  const { readdirSync, statSync, copyFileSync, mkdirSync } =
    require('node:fs') as typeof import('node:fs');
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) copyDirSync(src, dst);
    else copyFileSync(src, dst);
  }
}

describe('runUpgrade — overlay-aware (PR2)', () => {
  it('never overwrites a file carrying `_agentcohort_local: true`', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const overridePath = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    const localBody = `---
name: bug-hunter
description: My customized bug hunter
tools: Read
model: opus
_agentcohort_local: true
---

# Role

My customization wins.
`;
    writeFileSync(overridePath, localBody, 'utf8');
    const result = await runUpgrade({
      cwd,
      dryRun: false,
      force: true,
      backup: false,
      interactive: false,
      models: { ...DEFAULT_MODELS },
      templatesDir: TEMPLATES,
    });
    // File content unchanged.
    expect(readFileSync(overridePath, 'utf8')).toBe(localBody);
    // Action recorded as kept-local.
    const action = result.actions.find((a) =>
      a.targetRelPath.endsWith('bug-hunter.md')
    )!;
    expect(action.disposition).toBe('kept-local');
    expect(action.verdict).toBe('local');
  });

  it('local-new files (no bundled equivalent) are simply not in the manifest and untouched', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const localPath = join(cwd, '.claude', 'agents', 'my-custom.md');
    const body = `---
name: my-custom
description: Custom
_agentcohort_local: true
---

Body.
`;
    writeFileSync(localPath, body, 'utf8');
    await runUpgrade({
      cwd,
      dryRun: false,
      force: true,
      backup: false,
      interactive: false,
      models: { ...DEFAULT_MODELS },
      templatesDir: TEMPLATES,
    });
    expect(readFileSync(localPath, 'utf8')).toBe(body);
  });
});
