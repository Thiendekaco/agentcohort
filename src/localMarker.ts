/**
 * Local-agent marker — distinguishes user-authored (or user-overridden)
 * agent / command files from bundled ones.
 *
 * The marker is a YAML frontmatter field: `_agentcohort_local: true`.
 *
 * Files carrying this marker:
 *  - Are NEVER overwritten by `upgrade`.
 *  - Are NEVER flagged as `extra` / `unstamped` by `doctor` / `list`.
 *  - Show up with a `[local]` tag in discovery commands.
 *  - Survive `uninstall` by default (user opts in to remove them).
 *
 * PR1 (v0.8.0): introduces the convention and the `agentcohort add`
 * command that writes it. PR2 wires up the rest of the CLI to respect
 * the marker.
 */

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?\r?\n)---[ \t]*\r?\n/;
const LOCAL_VALUE_RE = /^_agentcohort_local:[ \t]+true[ \t]*$/m;
const STAMP_LINE_RE = /^_agentcohort_hash:[ \t]+\S+[ \t]*\r?\n/m;

/** True when the YAML frontmatter carries `_agentcohort_local: true`. */
export function hasLocalMarker(text: string): boolean {
  if (!text.startsWith('---')) return false;
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return false;
  return LOCAL_VALUE_RE.test(fm[1]!);
}

/**
 * Insert `_agentcohort_local: true` into the YAML frontmatter and strip
 * any existing `_agentcohort_hash:` line. A local file is no longer
 * tracked by the integrity stamp — that's what makes it "local".
 *
 * Pure and idempotent: marking an already-marked file yields the input
 * unchanged (modulo stamp removal). Files without YAML frontmatter are
 * returned unchanged — nowhere safe to put the marker.
 */
export function markAsLocal(text: string): string {
  if (!text.startsWith('---')) return text;
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return text;

  const fmEnd = fm[0].length;
  const frontmatter = text.slice(0, fmEnd);
  const body = text.slice(fmEnd);

  // Strip the integrity stamp first — local files own their content.
  const fmStripped = frontmatter.replace(STAMP_LINE_RE, '');

  // Already marked? Return the stripped form (idempotent w.r.t. stamp drop too).
  if (LOCAL_VALUE_RE.test(fmStripped)) {
    return fmStripped + body;
  }

  // Splice the marker line in just before the closing `---` fence,
  // mirroring how `stampTemplate` inserts its own field.
  const closeIdx = fmStripped.lastIndexOf('---');
  const markerLine = '_agentcohort_local: true\n';
  const newFrontmatter =
    fmStripped.slice(0, closeIdx) + markerLine + fmStripped.slice(closeIdx);
  return newFrontmatter + body;
}
