/**
 * Keyword Jaccard similarity for memory-aware dispatcher routing.
 *
 * Used by the dispatcher's boot directive to find similar past tasks
 * in `runs/INDEX.jsonl` without external embedding APIs.
 *
 * Trade-off: keyword overlap is imperfect (no synonyms, no semantics)
 * but ships locally, deterministic, zero dependencies. Threshold 0.3
 * is the recommended cutoff for "similar enough to surface".
 */

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'to', 'in', 'for', 'on', 'with', 'and', 'or',
  'of', 'is', 'was', 'be', 'at', 'by', 'as', 'from', 'this', 'that',
]);

export function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}
