import type { Skill } from './skills';

/**
 * Inject the detected-skills list into an agent's boot directive.
 *
 * The bundled boot directive ships with a marker pair that wraps the
 * generic "check available skills" instruction:
 *
 *   <!-- agentcohort-skills-start -->
 *   3. Check available skills. If any skill matches what you're about
 *      to do, invoke it first — don't re-implement what a skill
 *      provides.
 *   <!-- agentcohort-skills-end -->
 *
 * When `agentcohort init` (or `upgrade`) runs, it scans the user's
 * environment for installed skills and rewrites this region:
 *
 *   - **No skills detected**: keep the generic text (no-op).
 *   - **Skills detected**: replace with a concrete numbered list of
 *     `name — description` pairs so the subagent knows WHICH skills
 *     it can invoke via the `Skill` tool.
 *
 * Pure and idempotent: re-running with the same skill list yields the
 * same output. Re-running with a different list updates the region
 * without touching anything outside the markers.
 *
 * Files without the marker pair (e.g. user-authored local agents that
 * never had a boot directive) are returned unchanged.
 */

const START_MARKER = '<!-- agentcohort-skills-start -->';
const END_MARKER = '<!-- agentcohort-skills-end -->';

/** Maximum characters from a skill's description to embed in the boot directive. */
const DESCRIPTION_MAX = 140;

export function injectSkillsList(content: string, skills: readonly Skill[]): string {
  const startIdx = content.indexOf(START_MARKER);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(END_MARKER, startIdx + START_MARKER.length);
  if (endIdx === -1) return content;

  const before = content.slice(0, startIdx + START_MARKER.length);
  const after = content.slice(endIdx);
  const section = renderSkillsRegion(skills);
  return before + '\n' + section + '\n' + after;
}

/** True when the content has the marker pair (= it's overlay-aware). */
export function hasSkillsRegion(content: string): boolean {
  const s = content.indexOf(START_MARKER);
  if (s === -1) return false;
  return content.indexOf(END_MARKER, s + START_MARKER.length) !== -1;
}

/**
 * Extract the rendered skills region (without the markers themselves)
 * from an installed agent. Returns null when markers are absent. Used
 * by PR3's `refresh-skills` and `doctor` for staleness detection.
 */
export function extractSkillsRegion(content: string): string | null {
  const startIdx = content.indexOf(START_MARKER);
  if (startIdx === -1) return null;
  const endIdx = content.indexOf(END_MARKER, startIdx + START_MARKER.length);
  if (endIdx === -1) return null;
  return content.slice(startIdx + START_MARKER.length, endIdx).replace(/^\n|\n$/g, '');
}

function renderSkillsRegion(skills: readonly Skill[]): string {
  if (skills.length === 0) return renderGenericFallback();
  const lines: string[] = [
    '3. Skills installed in this environment (detected at install time).',
    '   When the user\'s task matches one of these, invoke it via the',
    '   `Skill` tool BEFORE falling back to your playbook — the skill',
    '   runs in your context on your model tier and has full access',
    '   to its references and scripts:',
  ];
  for (const s of skills) {
    const desc = truncate(s.description.replace(/\s+/g, ' ').trim(), DESCRIPTION_MAX);
    lines.push(`   - \`${s.name}\` — ${desc}`);
  }
  return lines.join('\n');
}

function renderGenericFallback(): string {
  return [
    "3. Check available skills. If any skill matches what you're about to do,",
    "   invoke it first — don't re-implement what a skill provides.",
  ].join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
