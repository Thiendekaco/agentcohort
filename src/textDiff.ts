/**
 * Minimal line-based unified-diff formatter.
 *
 * Computes a longest-common-subsequence diff over the two inputs'
 * lines and renders it in a unified-diff-ish format with `-` / `+` /
 * ` ` prefixes plus `@@ -a,b +c,d @@` hunk headers. Intended for
 * human reading in the `agentcohort upgrade` prompt, not for patch
 * application — there is no escaping/quoting and ties favor the new
 * side.
 *
 * Complexity is O(n*m) which is fine for template-sized files
 * (~hundreds of lines). If we ever need to diff large files we can
 * swap in a real diff library.
 */

export interface UnifiedDiffOptions {
  /** Label for the "old" side (default: "a"). */
  oldLabel?: string;
  /** Label for the "new" side (default: "b"). */
  newLabel?: string;
  /** Lines of unchanged context around each hunk (default: 3). */
  context?: number;
}

export function unifiedDiff(
  oldText: string,
  newText: string,
  opts: UnifiedDiffOptions = {}
): string {
  const oldLabel = opts.oldLabel ?? 'a';
  const newLabel = opts.newLabel ?? 'b';
  const ctx = opts.context ?? 3;
  const a = oldText.replace(/\r\n/g, '\n').split('\n');
  const b = newText.replace(/\r\n/g, '\n').split('\n');
  const ops = lcsDiff(a, b);
  const hunks = collectHunks(ops, ctx);
  if (hunks.length === 0) return '';

  const out: string[] = [];
  out.push(`--- ${oldLabel}`);
  out.push(`+++ ${newLabel}`);
  for (const h of hunks) {
    out.push(`@@ -${h.aStart + 1},${h.aLen} +${h.bStart + 1},${h.bLen} @@`);
    for (const line of h.lines) out.push(line);
  }
  return out.join('\n') + '\n';
}

// ---- internals ----

type Op =
  | { kind: 'equal'; aIdx: number; bIdx: number; line: string }
  | { kind: 'delete'; aIdx: number; line: string }
  | { kind: 'insert'; bIdx: number; line: string };

interface Hunk {
  aStart: number;
  aLen: number;
  bStart: number;
  bLen: number;
  lines: string[];
}

function lcsDiff(a: string[], b: string[]): Op[] {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = LCS length of a[0..i] vs b[0..j]
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (a[i] === b[j]) dp[i + 1]![j + 1] = dp[i]![j]! + 1;
      else
        dp[i + 1]![j + 1] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  // Backtrack to produce ops in reverse, then flip.
  const rev: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rev.push({
        kind: 'equal',
        aIdx: i - 1,
        bIdx: j - 1,
        line: a[i - 1]!,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      rev.push({ kind: 'insert', bIdx: j - 1, line: b[j - 1]! });
      j--;
    } else {
      rev.push({ kind: 'delete', aIdx: i - 1, line: a[i - 1]! });
      i--;
    }
  }
  return rev.reverse();
}

function collectHunks(ops: Op[], context: number): Hunk[] {
  // Find change-bearing op indices.
  const changeIdx: number[] = [];
  ops.forEach((op, idx) => {
    if (op.kind !== 'equal') changeIdx.push(idx);
  });
  if (changeIdx.length === 0) return [];

  // Greedy: walk ops, group changes that are within (2 * context) of each
  // other into a single hunk so context regions overlap rather than emit
  // tiny adjacent hunks.
  const hunks: Hunk[] = [];
  let groupStart = changeIdx[0]!;
  let groupEnd = changeIdx[0]!;
  for (let k = 1; k < changeIdx.length; k++) {
    const idx = changeIdx[k]!;
    if (idx - groupEnd <= context * 2) {
      groupEnd = idx;
    } else {
      hunks.push(renderHunk(ops, groupStart, groupEnd, context));
      groupStart = idx;
      groupEnd = idx;
    }
  }
  hunks.push(renderHunk(ops, groupStart, groupEnd, context));
  return hunks;
}

function renderHunk(
  ops: Op[],
  fromChange: number,
  toChange: number,
  context: number
): Hunk {
  const start = Math.max(0, fromChange - context);
  const end = Math.min(ops.length - 1, toChange + context);
  const lines: string[] = [];
  let aStart = -1;
  let bStart = -1;
  let aLen = 0;
  let bLen = 0;
  for (let i = start; i <= end; i++) {
    const op = ops[i]!;
    if (op.kind === 'equal') {
      if (aStart < 0) aStart = op.aIdx;
      if (bStart < 0) bStart = op.bIdx;
      lines.push(' ' + op.line);
      aLen++;
      bLen++;
    } else if (op.kind === 'delete') {
      if (aStart < 0) aStart = op.aIdx;
      // bStart anchors at the first context-or-insert line; if neither
      // has appeared yet, use 0.
      if (bStart < 0) bStart = bIdxAround(ops, i);
      lines.push('-' + op.line);
      aLen++;
    } else {
      if (bStart < 0) bStart = op.bIdx;
      if (aStart < 0) aStart = aIdxAround(ops, i);
      lines.push('+' + op.line);
      bLen++;
    }
  }
  return {
    aStart: Math.max(0, aStart),
    aLen,
    bStart: Math.max(0, bStart),
    bLen,
    lines,
  };
}

function aIdxAround(ops: Op[], i: number): number {
  for (let k = i; k >= 0; k--) {
    const o = ops[k]!;
    if (o.kind === 'equal') return o.aIdx;
    if (o.kind === 'delete') return o.aIdx;
  }
  for (let k = i + 1; k < ops.length; k++) {
    const o = ops[k]!;
    if (o.kind === 'equal') return o.aIdx;
    if (o.kind === 'delete') return o.aIdx;
  }
  return 0;
}

function bIdxAround(ops: Op[], i: number): number {
  for (let k = i; k >= 0; k--) {
    const o = ops[k]!;
    if (o.kind === 'equal') return o.bIdx;
    if (o.kind === 'insert') return o.bIdx;
  }
  for (let k = i + 1; k < ops.length; k++) {
    const o = ops[k]!;
    if (o.kind === 'equal') return o.bIdx;
    if (o.kind === 'insert') return o.bIdx;
  }
  return 0;
}
