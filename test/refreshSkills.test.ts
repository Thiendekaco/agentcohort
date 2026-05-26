import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runRefreshSkills } from '../src/refreshSkills';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';
import type { Skill } from '../src/skills';
import type { SkillAffinity } from '../src/skillAffinity';
import { MEMORY_MARKERS } from '../src/memoryBoot';

const BUNDLED_AGENTS = [
  'bug-fixer',
  'bug-hunter',
  'dispatcher',
  'expert-council',
  'feature-implementer',
  'feature-planner',
  'final-reviewer',
  'perf-optimizer',
  'perf-reviewer',
  'performance-hunter',
  'regression-guard',
  'repo-scout',
  'reproduction-engineer',
  'root-cause-analyst',
  'solution-architect',
  'test-verifier',
];

function affinityForAll(skillNames: string[]): SkillAffinity {
  const out: SkillAffinity = {};
  for (const s of skillNames) out[s] = BUNDLED_AGENTS;
  return out;
}

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-refresh-'));
  tmps.push(d);
  return d;
}

afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function makeSkill(name: string, description = 'test'): Skill {
  return {
    name,
    description,
    scope: 'user',
    path: `/tmp/${name}`,
    skillMdPath: `/tmp/${name}/SKILL.md`,
    hasExtras: false,
  };
}

async function installWithSkills(
  cwd: string,
  skills: Skill[],
  affinity?: SkillAffinity
): Promise<void> {
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
    skills,
    affinity: affinity ?? affinityForAll(skills.map((s) => s.name)),
  });
}

describe('runRefreshSkills — noop / updated dispositions', () => {
  it('is noop when the installed skill list matches the current scan', async () => {
    const cwd = project();
    const skills = [makeSkill('foo', 'foo desc'), makeSkill('bar', 'bar desc')];
    await installWithSkills(cwd, skills);
    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills,
      affinity: affinityForAll(skills.map((s) => s.name)),
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(0);
    const updated = result.entries.filter((e) => e.disposition === 'updated');
    expect(updated.length).toBe(0);
    expect(
      result.entries.every((e) => e.disposition === 'noop')
    ).toBe(true);
  });

  it('rewrites all bundled agents when the skill list changed', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('skill-a')]);
    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('skill-a'), makeSkill('skill-b', 'B description')],
      affinity: affinityForAll(['skill-a', 'skill-b']),
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(0);
    const updated = result.entries.filter((e) => e.disposition === 'updated');
    // Every bundled agent should have its skill region refreshed.
    expect(updated.length).toBeGreaterThan(0);
    const bugHunter = readFileSync(
      join(cwd, '.claude', 'agents', 'bug-hunter.md'),
      'utf8'
    );
    expect(bugHunter).toContain('`skill-a`');
    expect(bugHunter).toContain('`skill-b`');
    expect(bugHunter).toContain('B description');
  });

  it('writes a backup file when --backup is set', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('one')]);
    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('one'), makeSkill('two')],
      affinity: affinityForAll(['one', 'two']),
      dryRun: false,
      backup: true,
      now: () => new Date(2026, 5, 1, 9, 0, 0),
    });
    const updated = result.entries.filter((e) => e.disposition === 'updated');
    expect(updated.length).toBeGreaterThan(0);
    for (const e of updated) {
      expect(e.backupPath).toBeDefined();
      expect(existsSync(e.backupPath!)).toBe(true);
    }
  });
});

describe('runRefreshSkills — safety contract', () => {
  it('skips files carrying `_agentcohort_local: true`', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('foo')]);
    // Mark bug-hunter as local — refresh-skills must leave it alone.
    const path = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    const body = readFileSync(path, 'utf8');
    const marked = body.replace(
      /^---\r?\n/,
      (match) => match + '_agentcohort_local: true\n'
    );
    writeFileSync(path, marked, 'utf8');
    const before = readFileSync(path, 'utf8');

    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('foo'), makeSkill('changed')],
      dryRun: false,
      backup: false,
    });
    const e = result.entries.find((x) => x.name === 'bug-hunter')!;
    expect(e.disposition).toBe('skipped-local');
    // File content untouched.
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('skips user-edited files (body outside region diverges from bundled)', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('foo')]);
    // Hand-edit the Role section of bug-hunter.
    const path = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    const body = readFileSync(path, 'utf8');
    const tampered = body.replace(
      '# Role',
      '# Role\n\nUSER ADDED A LINE HERE.\n'
    );
    writeFileSync(path, tampered, 'utf8');

    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('foo'), makeSkill('new')],
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(1);
    const e = result.entries.find((x) => x.name === 'bug-hunter')!;
    expect(e.disposition).toBe('skipped-user-edited');
    // Hand edits preserved.
    expect(readFileSync(path, 'utf8')).toContain('USER ADDED A LINE HERE');
  });

  it('skips files without the skills marker pair (legacy install)', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('foo')]);
    // Strip the marker pair from a file (simulating pre-v0.9 install).
    const path = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    let body = readFileSync(path, 'utf8');
    body = body.replace(/<!-- agentcohort-skills-start -->[\s\S]*?<!-- agentcohort-skills-end -->\n?/, '');
    writeFileSync(path, body, 'utf8');

    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('foo'), makeSkill('new')],
      dryRun: false,
      backup: false,
    });
    const e = result.entries.find((x) => x.name === 'bug-hunter')!;
    expect(e.disposition).toBe('skipped-missing-markers');
  });
});

describe('runRefreshSkills — dryRun', () => {
  it('writes nothing in dryRun mode but reports what would update', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('foo')]);
    const path = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    const before = readFileSync(path, 'utf8');
    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('foo'), makeSkill('new-skill')],
      affinity: affinityForAll(['foo', 'new-skill']),
      dryRun: true,
      backup: false,
    });
    const updated = result.entries.filter((e) => e.disposition === 'updated');
    expect(updated.length).toBeGreaterThan(0);
    // File untouched.
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('runRefreshSkills — empty target', () => {
  it('returns an empty result when the agents/ directory does not exist', () => {
    const cwd = project();
    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('any')],
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.entries).toEqual([]);
  });
});

describe('runRefreshSkills — v0.10.1 dispatcher memory-lookup', () => {
  it('refresh re-bakes memory-lookup block into dispatcher boot directive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentcohort-refresh-v10_1-'));
    try {
      const templatesDir = join(__dirname, '..', 'src', 'templates');
      await runInit({
        cwd: dir,
        yes: true,
        dryRun: false,
        force: false,
        backup: false,
        interactive: false,
        now: () => new Date(2026, 4, 25, 12, 0, 0),
        templatesDir,
        models: { ...DEFAULT_MODELS },
        skills: [],
        affinity: {},
      } as any);
      const target = join(dir, '.claude/agents/dispatcher.md');
      const text = readFileSync(target, 'utf8');
      const tampered = text.replace(
        /<!-- agentcohort-memory-start -->[\s\S]*?<!-- agentcohort-memory-end -->/,
        '<!-- agentcohort-memory-start -->\nSTALE\n<!-- agentcohort-memory-end -->',
      );
      writeFileSync(target, tampered);
      runRefreshSkills({
        cwd: dir,
        templatesDir,
        models: { ...DEFAULT_MODELS },
        skills: [],
        affinity: {},
        dryRun: false,
        backup: false,
      });
      const after = readFileSync(target, 'utf8');
      expect(after).toContain('Memory-aware routing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runRefreshSkills — also refreshes memory section', () => {
  it('rewrites stale memory section while leaving the rest alone', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('foo')]);
    // Tamper with bug-fixer.md to make ONLY the memory section stale
    const target = join(cwd, '.claude/agents/bug-fixer.md');
    const text = readFileSync(target, 'utf8');
    const tampered = text.replace(
      new RegExp(`${MEMORY_MARKERS.start}[\\s\\S]*?${MEMORY_MARKERS.end}`),
      `${MEMORY_MARKERS.start}\nSTALE MEMORY PLACEHOLDER\n${MEMORY_MARKERS.end}`,
    );
    writeFileSync(target, tampered);

    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('foo')],
      affinity: affinityForAll(['foo']),
      dryRun: false,
      backup: false,
    });
    const updated = result.entries.filter((e) => e.disposition === 'updated');
    expect(updated.length).toBeGreaterThan(0);

    const after = readFileSync(target, 'utf8');
    expect(after).toContain(MEMORY_MARKERS.start);
    expect(after).toContain(MEMORY_MARKERS.end);
    expect(after).toContain('Reads: bugs, scratch');   // bug-fixer reads
    expect(after).toContain('Writes: bugs, scratch');  // bug-fixer writes
    expect(after).not.toContain('STALE MEMORY PLACEHOLDER');
  });

  it('skips local-override agents (_agentcohort_local: true)', async () => {
    const cwd = project();
    await installWithSkills(cwd, [makeSkill('foo')]);
    const target = join(cwd, '.claude/agents/bug-fixer.md');
    const text = readFileSync(target, 'utf8');
    // Mark as local
    const localized = text.replace(/^---\r?\n/, (match) => match + '_agentcohort_local: true\n');
    writeFileSync(target, localized);

    const result = runRefreshSkills({
      cwd,
      templatesDir: TEMPLATES,
      models: { ...DEFAULT_MODELS },
      skills: [makeSkill('foo')],
      dryRun: false,
      backup: false,
    });
    const entry = result.entries.find((e) => e.name === 'bug-fixer');
    expect(entry?.disposition).toBe('skipped-local');
  });
});
