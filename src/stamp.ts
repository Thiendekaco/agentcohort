import { createHash } from 'node:crypto';

/**
 * Integrity stamping for installed agent/command templates.
 *
 * At install time, the installer adds a single `_agentcohort_hash`
 * field to the YAML frontmatter of every installed `.md` template.
 * The hash is computed over the file content with the `model:` line
 * and the `_agentcohort_hash:` line itself stripped — so:
 *
 *  - Changing the model tier (via `agentcohort config`) does NOT
 *    invalidate the stamp.
 *  - Hand-editing the body does invalidate the stamp.
 *  - The stamp itself is excluded from the hash so it can be
 *    inserted without recursion.
 *
 * `agentcohort doctor` uses the stamp to classify each installed
 * file as `unchanged`, `outdated`, `user-edited`, or `unstamped`
 * (legacy pre-0.4.0 install).
 */

const STAMP_LINE_RE = /^_agentcohort_hash:[ \t]+\S+[ \t]*\r?\n/m;
const MODEL_LINE_RE = /^model:[ \t]+\S+[ \t]*\r?\n/m;
const STAMP_VALUE_RE = /^_agentcohort_hash:[ \t]+(\S+)[ \t]*$/m;
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?\r?\n)---[ \t]*\r?\n/;

/**
 * Compute the canonical content hash of a template/installed file.
 *
 * Strips the `model:` and `_agentcohort_hash:` lines so neither a
 * model-tier change nor a re-stamp shifts the hash. Returns the first
 * 16 hex chars of SHA-256 (64 bits — collision-resistant enough for
 * a project-local integrity check, short enough to be readable in
 * the frontmatter).
 */
export function contentHash(text: string): string {
  const normalized = text.replace(STAMP_LINE_RE, '').replace(MODEL_LINE_RE, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Add or replace the `_agentcohort_hash:` field in the YAML
 * frontmatter. Inserts the line immediately before the closing `---`.
 *
 * Pure and idempotent: stamping an already-stamped file with the same
 * canonical content returns the input unchanged.
 *
 * Files without YAML frontmatter are returned unchanged — there is
 * nowhere safe to put the stamp.
 */
export function stampTemplate(text: string): string {
  if (!text.startsWith('---')) return text;
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return text;

  const fmEnd = fm[0].length;
  const frontmatter = text.slice(0, fmEnd);
  const body = text.slice(fmEnd);

  // Drop any prior stamp first so the hash never depends on itself.
  const fmStripped = frontmatter.replace(STAMP_LINE_RE, '');
  const hash = contentHash(fmStripped + body);
  const newStampLine = `_agentcohort_hash: ${hash}\n`;

  // If the existing frontmatter already carries this exact stamp,
  // return the input verbatim so callers can rely on byte-level
  // idempotency.
  const existing = parseStamp(frontmatter);
  if (existing === hash) return text;

  // Insert immediately before the closing `---` line of the
  // frontmatter (the last line of fmStripped is `---\n`).
  const closeIdx = fmStripped.lastIndexOf('---');
  const newFrontmatter =
    fmStripped.slice(0, closeIdx) + newStampLine + fmStripped.slice(closeIdx);

  return newFrontmatter + body;
}

/** Return the stored stamp value, or `undefined` if none is present. */
export function parseStamp(text: string): string | undefined {
  const m = text.match(STAMP_VALUE_RE);
  return m ? m[1] : undefined;
}

export type IntegrityVerdict =
  | 'unchanged' // file body matches its stamp, stamp matches current bundled
  | 'outdated' // file body matches its stamp, but bundled has moved on
  | 'user-edited' // file body no longer matches its stamp
  | 'unstamped'; // no stamp field — pre-0.4.0 install or hand-stripped

/**
 * Diagnose an installed file's integrity against the bundled
 * post-render template that would be installed today.
 *
 * Caller must pass `bundled` already rendered for the user's model
 * tier (so a stamp-comparison with `installed` is apples-to-apples).
 */
export function compareIntegrity(
  installed: string,
  bundled: string
): IntegrityVerdict {
  const stored = parseStamp(installed);
  if (stored === undefined) return 'unstamped';
  if (contentHash(installed) !== stored) return 'user-edited';
  if (stored !== contentHash(bundled)) return 'outdated';
  return 'unchanged';
}
