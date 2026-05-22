import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkills } from '../src/skills';

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-skills-'));
  tmps.push(d);
  return d;
}

afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

interface SkillSeed {
  scope: 'user' | 'plugin' | 'project';
  pluginName?: string;
  name: string;
  description?: string;
  /** When true, omit SKILL.md (invalid dir). */
  noSkillMd?: boolean;
  /** Add extra files in the skill dir (for hasExtras testing). */
  extras?: string[];
  /** Omit `name:` from frontmatter; falls back to dir name. */
  noFrontmatterName?: boolean;
  /** Override the dir name (defaults to `name`). */
  dirName?: string;
}

function seedSkill(homeDir: string, cwd: string, s: SkillSeed): void {
  const dirName = s.dirName ?? s.name;
  let dirPath: string;
  if (s.scope === 'user') {
    dirPath = join(homeDir, '.claude', 'skills', dirName);
  } else if (s.scope === 'plugin') {
    dirPath = join(
      homeDir,
      '.claude',
      'plugins',
      s.pluginName!,
      'skills',
      dirName
    );
  } else {
    dirPath = join(cwd, '.claude', 'skills', dirName);
  }
  mkdirSync(dirPath, { recursive: true });
  if (!s.noSkillMd) {
    const fm: string[] = ['---'];
    if (!s.noFrontmatterName) fm.push(`name: ${s.name}`);
    fm.push(`description: ${s.description ?? 'A test skill'}`);
    fm.push('---');
    fm.push('');
    fm.push('Skill body content here.');
    writeFileSync(join(dirPath, 'SKILL.md'), fm.join('\n'), 'utf8');
  }
  for (const e of s.extras ?? []) {
    const extraPath = join(dirPath, e);
    const extraDir = extraPath.slice(0, Math.max(extraPath.lastIndexOf('/'), extraPath.lastIndexOf('\\')));
    if (extraDir !== dirPath) mkdirSync(extraDir, { recursive: true });
    writeFileSync(extraPath, 'extra content', 'utf8');
  }
}

describe('scanSkills — empty cases', () => {
  it('returns empty when no skill dirs exist anywhere', () => {
    const home = tmp();
    const cwd = tmp();
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills).toEqual([]);
    expect(r.searchedRoots).toEqual([]);
    expect(r.invalidCount).toBe(0);
  });

  it('does not throw on totally missing home dir', () => {
    const home = join(tmp(), 'does-not-exist');
    const cwd = tmp();
    expect(() => scanSkills({ cwd, homeDir: home })).not.toThrow();
  });
});

describe('scanSkills — user scope', () => {
  it('finds skills in <home>/.claude/skills/<name>/SKILL.md', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'caveman-commit',
      description: 'Ultra-compressed commit messages',
    });
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'investigate',
      description: 'Systematic debugging',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name).sort()).toEqual([
      'caveman-commit',
      'investigate',
    ]);
    for (const s of r.skills) {
      expect(s.scope).toBe('user');
      expect(s.pluginName).toBeUndefined();
    }
  });

  it('extracts the description from frontmatter', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'foo',
      description: 'My helpful description',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills[0]!.description).toBe('My helpful description');
  });

  it('falls back to directory name when frontmatter has no `name:` field', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'unused',
      dirName: 'actual-dir-name',
      noFrontmatterName: true,
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills[0]!.name).toBe('actual-dir-name');
  });
});

describe('scanSkills — plugin scope', () => {
  it('finds skills under plugins/<plugin>/skills/<name>/SKILL.md', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'superpowers',
      name: 'systematic-debugging',
      description: 'Iron Law: no fixes without root cause',
    });
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'superpowers',
      name: 'test-driven-development',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name).sort()).toEqual([
      'superpowers:systematic-debugging',
      'superpowers:test-driven-development',
    ]);
    for (const s of r.skills) {
      expect(s.scope).toBe('plugin');
      expect(s.pluginName).toBe('superpowers');
    }
  });

  it('handles multiple plugins independently', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'pluginA',
      name: 'shared-name',
    });
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'pluginB',
      name: 'shared-name',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name).sort()).toEqual([
      'pluginA:shared-name',
      'pluginB:shared-name',
    ]);
  });

  it('skips plugin dirs that have no `skills/` subdir', () => {
    const home = tmp();
    const cwd = tmp();
    mkdirSync(join(home, '.claude', 'plugins', 'no-skills-plugin'), {
      recursive: true,
    });
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'has-skills',
      name: 's1',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name)).toEqual(['has-skills:s1']);
  });
});

describe('scanSkills — project scope', () => {
  it('finds skills in <cwd>/.claude/skills/<name>/SKILL.md', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'project',
      name: 'project-only-skill',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.length).toBe(1);
    expect(r.skills[0]!.name).toBe('project-only-skill');
    expect(r.skills[0]!.scope).toBe('project');
  });

  it('includes all three scopes in one scan', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, { scope: 'user', name: 'user-skill' });
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'p',
      name: 'plug-skill',
    });
    seedSkill(home, cwd, { scope: 'project', name: 'proj-skill' });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name).sort()).toEqual([
      'p:plug-skill',
      'proj-skill',
      'user-skill',
    ]);
    expect(r.searchedRoots.length).toBe(3);
  });
});

describe('scanSkills — invalid / extras', () => {
  it('counts dirs without SKILL.md as invalid (does not throw)', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, { scope: 'user', name: 'orphan', noSkillMd: true });
    seedSkill(home, cwd, { scope: 'user', name: 'good' });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name)).toEqual(['good']);
    expect(r.invalidCount).toBe(1);
  });

  it('flags hasExtras when the skill dir has files beyond SKILL.md', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'simple',
    });
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'complex',
      extras: ['references/copilot-tools.md', 'script.sh'],
    });
    const r = scanSkills({ cwd, homeDir: home });
    const simple = r.skills.find((s) => s.name === 'simple')!;
    const complex = r.skills.find((s) => s.name === 'complex')!;
    expect(simple.hasExtras).toBe(false);
    expect(complex.hasExtras).toBe(true);
  });

  it('tolerates malformed frontmatter — description defaults to empty', () => {
    const home = tmp();
    const cwd = tmp();
    const dirPath = join(home, '.claude', 'skills', 'no-fm');
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(
      join(dirPath, 'SKILL.md'),
      'No frontmatter at all here.\n',
      'utf8'
    );
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.length).toBe(1);
    expect(r.skills[0]!.name).toBe('no-fm');
    expect(r.skills[0]!.description).toBe('');
  });
});

describe('scanSkills — multi-line description (YAML block scalars)', () => {
  it('handles `description: |` literal block scalar', () => {
    const home = tmp();
    const cwd = tmp();
    const dirPath = join(home, '.claude', 'skills', 'multi-literal');
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(
      join(dirPath, 'SKILL.md'),
      [
        '---',
        'name: multi-literal',
        'description: |',
        '  First line of description',
        '  Second line of description',
        '---',
        '',
        'Body.',
      ].join('\n'),
      'utf8'
    );
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills[0]!.description).toBe(
      'First line of description\nSecond line of description'
    );
  });

  it('handles `description: >` folded block scalar (newlines → spaces)', () => {
    const home = tmp();
    const cwd = tmp();
    const dirPath = join(home, '.claude', 'skills', 'multi-folded');
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(
      join(dirPath, 'SKILL.md'),
      [
        '---',
        'name: multi-folded',
        'description: >',
        '  This is a folded',
        '  description across',
        '  multiple lines.',
        '---',
        '',
        'Body.',
      ].join('\n'),
      'utf8'
    );
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills[0]!.description).toBe(
      'This is a folded description across multiple lines.'
    );
  });

  it('still handles inline scalars (regression)', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'user',
      name: 'inline',
      description: 'Just one line, no block scalar.',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills[0]!.description).toBe('Just one line, no block scalar.');
  });
});

describe('scanSkills — output is deterministic', () => {
  it('returns skills sorted by full name', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, { scope: 'user', name: 'zebra' });
    seedSkill(home, cwd, { scope: 'user', name: 'alpha' });
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'p',
      name: 'middle',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name)).toEqual([
      'alpha',
      'p:middle',
      'zebra',
    ]);
  });
});
