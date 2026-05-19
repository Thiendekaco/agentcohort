/**
 * Pure helpers for managing the Agent Force section inside a project CLAUDE.md.
 *
 * Design goals:
 *  - Never destroy the user's existing CLAUDE.md content.
 *  - Only ever touch our own clearly-delimited section.
 *  - Preserve the rest of the file byte-for-byte (no global EOL rewrites):
 *    we splice by string index instead of split/join.
 *  - Be fenced-code-block aware so a `# ...` line inside ``` ``` is not
 *    mistaken for a real heading boundary.
 */

export const SECTION_TITLE = '# Agent Force Routing Rules';

interface LineSpan {
  /** Index of the first character of the line (after the previous '\n'). */
  start: number;
  /** Index just past the line's content, before its trailing newline. */
  contentEnd: number;
  /** Index of the next line's start (past the '\n'), or content.length. */
  next: number;
  text: string;
}

function* iterateLines(content: string): Generator<LineSpan> {
  let i = 0;
  const n = content.length;
  while (i <= n) {
    let nl = content.indexOf('\n', i);
    if (nl === -1) nl = n;
    let contentEnd = nl;
    if (contentEnd > i && content[contentEnd - 1] === '\r') contentEnd -= 1;
    yield {
      start: i,
      contentEnd,
      next: nl === n ? n : nl + 1,
      text: content.slice(i, contentEnd),
    };
    if (nl === n) break;
    i = nl + 1;
  }
}

const FENCE_RE = /^\s{0,3}(```+|~~~+)/;
const TOP_HEADING_RE = /^# (?!#)/; // exactly one '#', then space, not '##'

/** Index where our section heading line starts, fenced-code-aware. -1 if absent. */
export function findSectionStart(content: string): number {
  let inFence = false;
  let fenceToken = '';
  for (const line of iterateLines(content)) {
    const fence = FENCE_RE.exec(line.text);
    if (fence) {
      const token = fence[1]![0]!; // '`' or '~'
      if (!inFence) {
        inFence = true;
        fenceToken = token;
      } else if (token === fenceToken) {
        inFence = false;
        fenceToken = '';
      }
      continue;
    }
    if (inFence) continue;
    if (line.text.trimEnd() === SECTION_TITLE) return line.start;
  }
  return -1;
}

/** Index where the section ends (start of the next top-level heading) or EOF. */
function findSectionEnd(content: string, sectionStart: number): number {
  let inFence = false;
  let fenceToken = '';
  let passedHeading = false;
  for (const line of iterateLines(content)) {
    if (line.start < sectionStart) continue;
    if (!passedHeading) {
      // This is our own heading line; skip it then start scanning.
      passedHeading = true;
      continue;
    }
    const fence = FENCE_RE.exec(line.text);
    if (fence) {
      const token = fence[1]![0]!;
      if (!inFence) {
        inFence = true;
        fenceToken = token;
      } else if (token === fenceToken) {
        inFence = false;
        fenceToken = '';
      }
      continue;
    }
    if (inFence) continue;
    if (TOP_HEADING_RE.test(line.text)) return line.start;
  }
  return content.length;
}

export function hasSection(content: string): boolean {
  return findSectionStart(content) !== -1;
}

/** The exact current section block (heading through just before next heading/EOF). */
export function extractSection(content: string): string | null {
  const start = findSectionStart(content);
  if (start === -1) return null;
  const end = findSectionEnd(content, start);
  return content.slice(start, end);
}

/** True when the existing section already equals the template (ignoring edge whitespace). */
export function sectionMatches(content: string, sectionMarkdown: string): boolean {
  const current = extractSection(content);
  if (current === null) return false;
  return current.trim() === sectionMarkdown.trim();
}

export type UpsertMode = 'append' | 'replace';

export interface UpsertResult {
  result: string;
  mode: UpsertMode;
}

/**
 * Insert or replace the Agent Force section.
 *  - Absent  -> appended at the end, separated by a blank line.
 *  - Present -> the existing section block is replaced in place; everything
 *               before and after is preserved verbatim.
 */
export function upsertSection(content: string, sectionMarkdown: string): UpsertResult {
  const body = sectionMarkdown.replace(/\s+$/, '') + '\n';
  const start = findSectionStart(content);

  if (start === -1) {
    const base = content.length === 0 ? '' : content.replace(/\s+$/, '') + '\n';
    const separator = base === '' ? '' : '\n';
    return { result: base + separator + body, mode: 'append' };
  }

  const end = findSectionEnd(content, start);
  const prefix = content.slice(0, start);
  const suffix = content.slice(end);

  let result = prefix + body;
  if (suffix.length > 0) {
    // Ensure exactly one blank line between our section and the next heading.
    result += '\n' + suffix.replace(/^\n+/, '');
  }
  return { result, mode: 'replace' };
}

/** Minimal CLAUDE.md created when the project has none. */
export function buildInitialClaudeMd(sectionMarkdown: string): string {
  const header = [
    '# Project Guidance for Claude Code',
    '',
    'This file is read by Claude Code at the start of every session.',
    'The section below was installed by `agent-force` and wires up the',
    'AI software-engineering organization (agents + workflows).',
    '',
  ].join('\n');
  return upsertSection(header, sectionMarkdown).result;
}
