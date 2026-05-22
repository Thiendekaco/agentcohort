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

describe('scanSkills — Claude Code marketplace plugin layout (installed_plugins.json)', () => {
  it('discovers skills via installed_plugins.json -> installPath/skills/', () => {
    const home = tmp();
    const cwd = tmp();
    // Real-world layout: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
    const installPath = join(
      home,
      '.claude',
      'plugins',
      'cache',
      'claude-plugins-official',
      'superpowers',
      '5.0.7'
    );
    mkdirSync(join(installPath, 'skills', 'systematic-debugging'), {
      recursive: true,
    });
    writeFileSync(
      join(installPath, 'skills', 'systematic-debugging', 'SKILL.md'),
      [
        '---',
        'name: systematic-debugging',
        'description: Use when encountering any bug',
        '---',
        '',
        'Body.',
      ].join('\n'),
      'utf8'
    );
    // Write the registry file pointing at the install.
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [
            {
              scope: 'user',
              installPath: installPath.replace(/\//g, '\\'),
              version: '5.0.7',
              lastUpdated: '2026-04-13T08:38:52.509Z',
            },
          ],
        },
      })
    );
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name)).toContain(
      'superpowers:systematic-debugging'
    );
    const found = r.skills.find(
      (s) => s.name === 'superpowers:systematic-debugging'
    )!;
    expect(found.scope).toBe('plugin');
    expect(found.pluginName).toBe('superpowers');
  });

  it('picks the latest installation when multiple versions are registered', () => {
    const home = tmp();
    const cwd = tmp();
    const baseDir = join(home, '.claude', 'plugins', 'cache', 'mkt', 'plug');
    const v1Path = join(baseDir, '1.0.0');
    const v2Path = join(baseDir, '2.0.0');
    mkdirSync(join(v1Path, 'skills', 'old-skill'), { recursive: true });
    mkdirSync(join(v2Path, 'skills', 'new-skill'), { recursive: true });
    writeFileSync(
      join(v1Path, 'skills', 'old-skill', 'SKILL.md'),
      '---\nname: old-skill\ndescription: old\n---\n'
    );
    writeFileSync(
      join(v2Path, 'skills', 'new-skill', 'SKILL.md'),
      '---\nname: new-skill\ndescription: new\n---\n'
    );
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'plug@mkt': [
            { installPath: v1Path, lastUpdated: '2025-01-01T00:00:00.000Z' },
            { installPath: v2Path, lastUpdated: '2026-04-01T00:00:00.000Z' },
          ],
        },
      })
    );
    const r = scanSkills({ cwd, homeDir: home });
    const names = r.skills.map((s) => s.name);
    expect(names).toContain('plug:new-skill');
    expect(names).not.toContain('plug:old-skill');
  });

  it('tolerates a missing installed_plugins.json (falls back to legacy layout)', () => {
    const home = tmp();
    const cwd = tmp();
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'legacy-plug',
      name: 'a-skill',
    });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name)).toContain('legacy-plug:a-skill');
  });

  it('tolerates a malformed installed_plugins.json (skips, does not throw)', () => {
    const home = tmp();
    const cwd = tmp();
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      'not json {{{'
    );
    seedSkill(home, cwd, { scope: 'user', name: 'still-finds-user' });
    const r = scanSkills({ cwd, homeDir: home });
    expect(r.skills.map((s) => s.name)).toContain('still-finds-user');
  });

  it('does not double-count a plugin present in both registry and legacy layout', () => {
    const home = tmp();
    const cwd = tmp();
    // Create the plugin in the legacy layout AND register it via JSON.
    seedSkill(home, cwd, {
      scope: 'plugin',
      pluginName: 'dupe',
      name: 'shared-skill',
    });
    const registryInstallPath = join(
      home,
      '.claude',
      'plugins',
      'cache',
      'mkt',
      'dupe',
      '1.0'
    );
    mkdirSync(join(registryInstallPath, 'skills', 'shared-skill'), {
      recursive: true,
    });
    writeFileSync(
      join(registryInstallPath, 'skills', 'shared-skill', 'SKILL.md'),
      '---\nname: shared-skill\ndescription: via registry\n---\n'
    );
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'dupe@mkt': [{ installPath: registryInstallPath }],
        },
      })
    );
    const r = scanSkills({ cwd, homeDir: home });
    const dupeSkills = r.skills.filter((s) => s.name === 'dupe:shared-skill');
    expect(dupeSkills.length).toBe(1);
    // The registry-discovered version wins (its description reads "via registry").
    expect(dupeSkills[0]!.description).toBe('via registry');
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
