import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AFFINITY,
  resolveAffinity,
  relevantSkills,
  isKnownSkill,
  SkillAffinity,
} from '../src/skillAffinity';
import type { Skill } from '../src/skills';

function s(name: string, description = ''): Skill {
  return {
    name,
    description,
    scope: 'user',
    path: `/fake/${name}`,
    skillMdPath: `/fake/${name}/SKILL.md`,
    hasExtras: false,
  };
}

describe('resolveAffinity', () => {
  it('returns the built-in defaults when no user overrides are provided', () => {
    const aff = resolveAffinity(undefined);
    expect(aff['superpowers:systematic-debugging']).toBeDefined();
    expect(aff['superpowers:systematic-debugging']).toContain('bug-hunter');
  });

  it('user overrides replace the default for that skill (no union)', () => {
    const aff = resolveAffinity({
      'superpowers:systematic-debugging': ['only-this-agent'],
    });
    expect(aff['superpowers:systematic-debugging']).toEqual(['only-this-agent']);
  });

  it('user-only keys add new entries (custom skill wiring)', () => {
    const aff = resolveAffinity({
      'my-custom-skill': ['feature-implementer', 'bug-fixer'],
    });
    expect(aff['my-custom-skill']).toEqual([
      'feature-implementer',
      'bug-fixer',
    ]);
    // Existing defaults untouched.
    expect(aff['superpowers:systematic-debugging']).toContain('bug-hunter');
  });

  it('an explicit empty array mutes a default-mapped skill', () => {
    const aff = resolveAffinity({
      'superpowers:systematic-debugging': [],
    });
    expect(aff['superpowers:systematic-debugging']).toEqual([]);
  });
});

describe('relevantSkills', () => {
  const affinity: SkillAffinity = {
    'skill-A': ['bug-hunter', 'feature-implementer'],
    'skill-B': ['bug-hunter'],
    'skill-C': ['test-verifier'],
    'skill-MUTED': [],
  };

  it('returns only skills whose affinity entry lists this agent', () => {
    const skills = [s('skill-A'), s('skill-B'), s('skill-C')];
    const out = relevantSkills('bug-hunter', skills, affinity);
    expect(out.map((sk) => sk.name).sort()).toEqual(['skill-A', 'skill-B']);
  });

  it('filters out skills not in the affinity map (unknown skills)', () => {
    const skills = [s('skill-A'), s('skill-NOT-IN-MAP')];
    const out = relevantSkills('bug-hunter', skills, affinity);
    expect(out.map((sk) => sk.name)).toEqual(['skill-A']);
  });

  it('skills with an empty affinity array are hidden from every agent', () => {
    const skills = [s('skill-MUTED')];
    expect(relevantSkills('bug-hunter', skills, affinity)).toEqual([]);
    expect(relevantSkills('test-verifier', skills, affinity)).toEqual([]);
  });

  it('preserves the skill order from the input list (does not re-sort)', () => {
    const skills = [s('skill-B'), s('skill-A'), s('skill-MUTED')];
    const out = relevantSkills('bug-hunter', skills, affinity);
    expect(out.map((sk) => sk.name)).toEqual(['skill-B', 'skill-A']);
  });

  it('returns empty when the agent appears in no affinity entry', () => {
    const skills = [s('skill-A'), s('skill-B'), s('skill-C')];
    expect(relevantSkills('dispatcher', skills, affinity)).toEqual([]);
  });
});

describe('DEFAULT_AFFINITY — sanity', () => {
  it('superpowers debugging wires to investigators', () => {
    expect(DEFAULT_AFFINITY['superpowers:systematic-debugging']).toContain(
      'bug-hunter'
    );
    expect(DEFAULT_AFFINITY['superpowers:systematic-debugging']).toContain(
      'root-cause-analyst'
    );
  });

  it('TDD skill wires to test + implementation agents', () => {
    expect(DEFAULT_AFFINITY['superpowers:test-driven-development']).toContain(
      'test-verifier'
    );
    expect(DEFAULT_AFFINITY['superpowers:test-driven-development']).toContain(
      'feature-implementer'
    );
  });

  it('plan-eng-review wires to architecture / planning agents', () => {
    expect(DEFAULT_AFFINITY['plan-eng-review']).toContain('solution-architect');
    expect(DEFAULT_AFFINITY['plan-eng-review']).toContain('feature-planner');
  });

  it('commit-message skills are unmapped (empty array — not subagent-relevant)', () => {
    expect(DEFAULT_AFFINITY['caveman-commit']).toEqual([]);
  });

  it('all targets in defaults reference real bundled agent names', () => {
    const KNOWN_AGENTS = new Set([
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
    ]);
    for (const [skill, targets] of Object.entries(DEFAULT_AFFINITY)) {
      for (const t of targets) {
        expect(
          KNOWN_AGENTS.has(t),
          `${skill} → unknown agent "${t}"`
        ).toBe(true);
      }
    }
  });
});

describe('isKnownSkill', () => {
  it('true for skills in the map', () => {
    expect(isKnownSkill('superpowers:systematic-debugging', DEFAULT_AFFINITY)).toBe(true);
    expect(isKnownSkill('caveman-commit', DEFAULT_AFFINITY)).toBe(true); // empty array still counts as known
  });
  it('false for skills not in the map', () => {
    expect(isKnownSkill('some-random-skill', DEFAULT_AFFINITY)).toBe(false);
  });
});
