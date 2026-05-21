import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `agentcohort search <keyword>` — grep across installed + bundled
 * agent / command bodies.
 *
 * Pairs with `list` (enumerate) and `show` (inspect one) to complete a
 * discovery flow: enumerate by name, inspect by body, or find by
 * content keyword.
 *
 * Per-file source: installed wins when both exist (so a hand-edited
 * agent shows up with the user's edits). Otherwise the bundled body is
 * searched — letting the user discover what's available before
 * `agentcohort init`.
 *
 * Pure with respect to side effects: filesystem reads only.
 */

export type SearchKind = 'agent' | 'command';
export type SearchScope = 'all' | 'agents' | 'commands';
export type SearchMode = 'substring' | 'exact' | 'regex';
export type SearchSource = 'installed' | 'bundled';

export interface SearchLineMatch {
  /** 1-based line number. */
  line: number;
  /** Full line content (newline stripped). */
  content: string;
  /** Half-open char offsets within `content` where the pattern matched. */
  offsets: Array<{ start: number; end: number }>;
}

export interface SearchFileResult {
  kind: SearchKind;
  /** File basename without `.md`. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Where the searched content came from for this file. */
  source: SearchSource;
  matches: SearchLineMatch[];
}

export interface SearchResult {
  cwd: string;
  query: string;
  mode: SearchMode;
  scope: SearchScope;
  files: SearchFileResult[];
  totalMatches: number;
  totalFiles: number;
  /** 0 found, 1 no matches, 2 internal failure. */
  exitCode: 0 | 1 | 2;
  /** Optional human-friendly note (e.g. regex parse error). Empty string when none. */
  note: string;
}

export interface SearchOptions {
  cwd: string;
  templatesDir: string;
  query: string;
  scope: SearchScope;
  mode: SearchMode;
}

export function runSearch(opts: SearchOptions): SearchResult {
  // Pre-build the matcher. Regex mode can fail to compile — surface a
  // friendly note + exit 1 rather than crash.
  let matcher: LineMatcher;
  try {
    matcher = buildMatcher(opts.query, opts.mode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      cwd: opts.cwd,
      query: opts.query,
      mode: opts.mode,
      scope: opts.scope,
      files: [],
      totalMatches: 0,
      totalFiles: 0,
      exitCode: 1,
      note: `invalid ${opts.mode} pattern: ${msg}`,
    };
  }

  const files: SearchFileResult[] = [];
  if (opts.scope === 'all' || opts.scope === 'agents') {
    files.push(...scanKind('agent', opts.cwd, opts.templatesDir, matcher));
  }
  if (opts.scope === 'all' || opts.scope === 'commands') {
    files.push(...scanKind('command', opts.cwd, opts.templatesDir, matcher));
  }

  const hit = files.filter((f) => f.matches.length > 0);
  hit.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'agent' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const totalMatches = hit.reduce(
    (n, f) => n + f.matches.reduce((m, line) => m + line.offsets.length, 0),
    0
  );
  return {
    cwd: opts.cwd,
    query: opts.query,
    mode: opts.mode,
    scope: opts.scope,
    files: hit,
    totalMatches,
    totalFiles: hit.length,
    exitCode: hit.length === 0 ? 1 : 0,
    note: '',
  };
}

// ---------- Matcher ----------

interface LineMatcher {
  /** Find every offset where the pattern matches in `line`. */
  scan(line: string): Array<{ start: number; end: number }>;
}

function buildMatcher(query: string, mode: SearchMode): LineMatcher {
  if (mode === 'regex') {
    // Multiline+global so /^/ /$/ work intuitively and matchAll returns all hits.
    // Per-line scanning means we drop the /m flag but keep /g — we apply per
    // line so anchors are per-line by construction.
    const re = new RegExp(query, 'g');
    return {
      scan(line) {
        const out: Array<{ start: number; end: number }> = [];
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          const start = m.index ?? 0;
          // Empty matches would loop forever — skip them.
          const end = start + (m[0]?.length ?? 0);
          if (end === start) continue;
          out.push({ start, end });
        }
        return out;
      },
    };
  }
  if (mode === 'exact') {
    return {
      scan(line) {
        return findAll(line, query, /* caseInsensitive */ false);
      },
    };
  }
  // substring (default): case-insensitive literal — best signal for
  // "find me the agent that mentions X".
  return {
    scan(line) {
      return findAll(line, query, /* caseInsensitive */ true);
    },
  };
}

function findAll(
  haystack: string,
  needle: string,
  caseInsensitive: boolean
): Array<{ start: number; end: number }> {
  if (needle === '') return [];
  const h = caseInsensitive ? haystack.toLowerCase() : haystack;
  const n = caseInsensitive ? needle.toLowerCase() : needle;
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const idx = h.indexOf(n, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + n.length });
    from = idx + n.length;
  }
  return out;
}

// ---------- File scan ----------

function scanKind(
  kind: SearchKind,
  cwd: string,
  templatesDir: string,
  matcher: LineMatcher
): SearchFileResult[] {
  const subdir = kind === 'agent' ? 'agents' : 'commands';
  const installedDir = join(cwd, '.claude', subdir);
  const bundledDir = join(templatesDir, subdir);

  const installedFiles = isDir(installedDir)
    ? new Set(readdirSync(installedDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();
  const bundledFiles = isDir(bundledDir)
    ? new Set(readdirSync(bundledDir).filter((f) => f.endsWith('.md')))
    : new Set<string>();

  const union = new Set<string>([...installedFiles, ...bundledFiles]);
  const results: SearchFileResult[] = [];
  for (const f of union) {
    const useInstalled = installedFiles.has(f);
    const path = join(useInstalled ? installedDir : bundledDir, f);
    const content = readFileSync(path, 'utf8');
    const matches = scanContent(content, matcher);
    results.push({
      kind,
      name: f.replace(/\.md$/, ''),
      path,
      source: useInstalled ? 'installed' : 'bundled',
      matches,
    });
  }
  return results;
}

function scanContent(text: string, matcher: LineMatcher): SearchLineMatch[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const out: SearchLineMatch[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const offsets = matcher.scan(line);
    if (offsets.length > 0) {
      out.push({ line: i + 1, content: line, offsets });
    }
  }
  return out;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
