import type { Skill } from './skills';

/**
 * Skill affinity — which skills are relevant to which bundled agents.
 *
 * Why this exists: by default, PR2 of Theme B (#45) bakes the full
 * list of installed skills into every agent's boot directive. With
 * 38+ skills on a typical dev machine that's thousands of tokens of
 * boilerplate per subagent invocation, plus a real risk that an
 * agent invokes the wrong skill (e.g. `bug-hunter` invoking
 * `caveman-commit`).
 *
 * Affinity solves both: each agent only sees the skills that are
 * actually relevant to its role.
 *
 * Resolution rules:
 *  - The hardcoded `DEFAULT_AFFINITY` map below covers every skill
 *    we ship knowledge of (superpowers, common community plugins).
 *  - User-supplied `skillAffinity` in `.agentcohort.json` MERGES
 *    with the defaults — listed user entries replace the default
 *    for that skill; entries not in the user config keep their
 *    default.
 *  - Skills appearing in NEITHER map default to **no agents** —
 *    safer than the noisy "show in all" alternative, since unknown
 *    skills may not be subagent-appropriate at all (e.g.
 *    `caveman-commit` is a commit-message tool, not a subagent
 *    method).
 *  - An explicit empty array `[]` for a skill means "show in no
 *    agents" — useful for muting a default-mapped skill the user
 *    doesn't want surfaced.
 */

/**
 * Skill name → list of bundled agent names that should see it in
 * their boot directive's skill region. Empty array = don't surface
 * this skill in any agent.
 */
export const DEFAULT_AFFINITY: Readonly<Record<string, readonly string[]>> = {
  // ---- Investigation / debugging ----
  'superpowers:systematic-debugging': [
    'bug-hunter',
    'root-cause-analyst',
    'reproduction-engineer',
  ],
  investigate: ['bug-hunter', 'root-cause-analyst', 'reproduction-engineer'],

  // ---- TDD / testing ----
  'superpowers:test-driven-development': ['test-verifier', 'feature-implementer'],
  qa: ['test-verifier'],
  'qa-only': ['test-verifier'],

  // ---- Planning / architecture ----
  'superpowers:writing-plans': ['solution-architect', 'feature-planner'],
  'superpowers:brainstorming': ['expert-council', 'solution-architect'],
  'plan-ceo-review': ['solution-architect', 'expert-council'],
  'plan-eng-review': ['solution-architect', 'feature-planner'],
  'plan-design-review': ['solution-architect'],
  'office-hours': ['expert-council'],

  // ---- Review ----
  review: ['final-reviewer', 'perf-reviewer'],
  'security-review': ['final-reviewer'],
  'caveman-review': ['final-reviewer'],
  cso: ['final-reviewer'],
  'design-review': ['final-reviewer'],
  codex: ['expert-council', 'final-reviewer'],

  // ---- Verification / completion ----
  'superpowers:verification-before-completion': [
    'final-reviewer',
    'test-verifier',
  ],
  'superpowers:receiving-code-review': ['feature-implementer', 'bug-fixer'],
  'superpowers:requesting-code-review': ['feature-implementer', 'bug-fixer'],

  // ---- Subagent dispatching ----
  'superpowers:subagent-driven-development': ['dispatcher'],
  'superpowers:dispatching-parallel-agents': ['dispatcher'],
  cavecrew: ['dispatcher'],
  autoplan: ['dispatcher'],

  // ---- Performance ----
  benchmark: ['performance-hunter', 'perf-reviewer', 'perf-optimizer'],

  // ---- Code quality / refactoring ----
  simplify: ['feature-implementer', 'bug-fixer', 'perf-optimizer'],

  // ---- Browser / QA ----
  browse: ['test-verifier'],
  gstack: ['test-verifier'],

  // ---- Skill / workflow meta ----
  'find-skills': ['dispatcher'],
  'superpowers:writing-skills': [],
  'superpowers:using-superpowers': [],

  // ---- Commit / release / docs (not subagent-appropriate by default) ----
  'caveman-commit': [],
  'document-release': [],
  ship: [],
  'land-and-deploy': [],
  canary: [],
  retro: [],

  // ---- Caveman family (mostly user-facing, not subagent methodology) ----
  caveman: [],
  'caveman-help': [],
  'caveman-stats': [],
  'caveman-compress': [],

  // ---- Safety / harness modes ----
  careful: [],
  guard: [],
  freeze: [],
  unfreeze: [],

  // ---- Design / brand ----
  'design-consultation': [],

  // ---- Setup / tooling ----
  'setup-browser-cookies': [],
  'setup-deploy': [],
  'gstack-upgrade': [],

  // ---- Scheduling / loops ----
  loop: [],
  schedule: [],

  // ---- Docs ----
  'read-doc-dual': [],
  'write-dev-log': [],

  // ---- Repo init ----
  init: [],
};

export type SkillAffinity = Record<string, readonly string[]>;

/**
 * Merge user overrides over the built-in defaults. User entries are
 * authoritative: a user entry of `[]` mutes a default-mapped skill;
 * a user entry with names adds those names (does NOT union with the
 * default — user is explicit).
 */
export function resolveAffinity(
  userOverrides: Record<string, readonly string[]> | undefined
): SkillAffinity {
  const merged: SkillAffinity = { ...DEFAULT_AFFINITY };
  if (userOverrides) {
    for (const key of Object.keys(userOverrides)) {
      merged[key] = userOverrides[key]!;
    }
  }
  return merged;
}

/**
 * Filter `skills` to the ones relevant to `agentName` per the
 * resolved affinity map. Unknown skills (not in the map) default to
 * "not relevant" — they're filtered out.
 */
export function relevantSkills(
  agentName: string,
  skills: readonly Skill[],
  affinity: SkillAffinity
): readonly Skill[] {
  return skills.filter((s) => {
    const targets = affinity[s.name];
    if (targets === undefined) return false; // unknown skill → not relevant
    return targets.includes(agentName);
  });
}

/** True when a skill has an affinity entry — known to the map. */
export function isKnownSkill(
  skillName: string,
  affinity: SkillAffinity
): boolean {
  return affinity[skillName] !== undefined;
}
