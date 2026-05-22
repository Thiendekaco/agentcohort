import { describe, it, expect } from 'vitest';
import {
  injectSkillsList,
  hasSkillsRegion,
  extractSkillsRegion,
} from '../src/skillsBoot';
import type { Skill } from '../src/skills';

const START = '<!-- agentcohort-skills-start -->';
const END = '<!-- agentcohort-skills-end -->';

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

const BODY_WITH_MARKERS = `# Boot directive

1. First step.
2. Second step.
${START}
3. Check available skills. If any skill matches what you're about to do,
   invoke it first — don't re-implement what a skill provides.
${END}
4. Final step.
`;

const BODY_WITHOUT_MARKERS = `# Boot directive

1. First step.
2. Second step.
3. Old generic skill instruction.
4. Final step.
`;

describe('hasSkillsRegion', () => {
  it('detects the marker pair when present', () => {
    expect(hasSkillsRegion(BODY_WITH_MARKERS)).toBe(true);
  });
  it('returns false when markers are absent', () => {
    expect(hasSkillsRegion(BODY_WITHOUT_MARKERS)).toBe(false);
  });
  it('returns false when only the start marker is present', () => {
    expect(hasSkillsRegion(`${START}\nhalf-baked\n`)).toBe(false);
  });
});

describe('extractSkillsRegion', () => {
  it('returns the text between markers (trimmed of edge newlines)', () => {
    const region = extractSkillsRegion(BODY_WITH_MARKERS);
    expect(region).toContain("3. Check available skills.");
    expect(region).not.toContain(START);
    expect(region).not.toContain(END);
  });
  it('returns null when markers are missing', () => {
    expect(extractSkillsRegion(BODY_WITHOUT_MARKERS)).toBeNull();
  });
});

describe('injectSkillsList — empty list (no-op fallback)', () => {
  it('keeps the generic instruction when skills is empty', () => {
    const out = injectSkillsList(BODY_WITH_MARKERS, []);
    expect(out).toContain('Check available skills');
    expect(out).toContain(START);
    expect(out).toContain(END);
    // The body outside the region is preserved verbatim.
    expect(out.startsWith('# Boot directive\n\n1. First step.')).toBe(true);
    expect(out).toContain('4. Final step.');
  });

  it('is idempotent on empty input — running twice yields the same output', () => {
    const once = injectSkillsList(BODY_WITH_MARKERS, []);
    const twice = injectSkillsList(once, []);
    expect(twice).toBe(once);
  });
});

describe('injectSkillsList — with skills', () => {
  it('replaces the region with a concrete skill list', () => {
    const out = injectSkillsList(BODY_WITH_MARKERS, [
      makeSkill('superpowers:systematic-debugging', 'Iron Law: no fixes without root cause'),
      makeSkill('investigate', 'Systematic debugging with root cause investigation'),
    ]);
    expect(out).toContain('Skills installed in this environment');
    expect(out).toContain('`superpowers:systematic-debugging`');
    expect(out).toContain('Iron Law: no fixes without root cause');
    expect(out).toContain('`investigate`');
    // Markers preserved.
    expect(out).toContain(START);
    expect(out).toContain(END);
  });

  it('preserves the body outside the region verbatim', () => {
    const out = injectSkillsList(BODY_WITH_MARKERS, [
      makeSkill('test-skill'),
    ]);
    expect(out.startsWith('# Boot directive\n\n1. First step.\n2. Second step.')).toBe(true);
    expect(out).toContain('\n4. Final step.\n');
  });

  it('truncates very long descriptions to keep the boot directive readable', () => {
    const longDesc = 'x'.repeat(500);
    const out = injectSkillsList(BODY_WITH_MARKERS, [makeSkill('huge', longDesc)]);
    // Description embed must be much shorter than the input.
    const skillLine = out.split('\n').find((l) => l.includes('`huge`'))!;
    expect(skillLine.length).toBeLessThan(200);
    expect(skillLine).toContain('…');
  });

  it('collapses internal whitespace (newlines / multiple spaces) in descriptions', () => {
    const out = injectSkillsList(BODY_WITH_MARKERS, [
      makeSkill('multi', 'first line\nsecond  line\nthird   line'),
    ]);
    expect(out).toContain('first line second line third line');
  });

  it('is idempotent — re-running with the same skill list yields the same output', () => {
    const skills = [makeSkill('a'), makeSkill('b')];
    const once = injectSkillsList(BODY_WITH_MARKERS, skills);
    const twice = injectSkillsList(once, skills);
    expect(twice).toBe(once);
  });

  it('updates the region when called with a different skill list (not duplicating)', () => {
    const first = injectSkillsList(BODY_WITH_MARKERS, [makeSkill('first')]);
    const second = injectSkillsList(first, [makeSkill('second')]);
    // First skill name is gone; second is present; markers count stays 1 pair.
    expect(second).not.toContain('`first`');
    expect(second).toContain('`second`');
    expect((second.match(/agentcohort-skills-start/g) || []).length).toBe(1);
    expect((second.match(/agentcohort-skills-end/g) || []).length).toBe(1);
  });
});

describe('injectSkillsList — content without markers', () => {
  it('returns the content unchanged when markers are absent', () => {
    const out = injectSkillsList(BODY_WITHOUT_MARKERS, [makeSkill('x')]);
    expect(out).toBe(BODY_WITHOUT_MARKERS);
  });
});
