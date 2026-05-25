// Sync the boot directive from a single source-of-truth file into every
// agent template. Idempotent: second run produces no diff.
//
// The directive is delimited by HTML-comment markers so the script can
// find and replace an existing region cleanly:
//
//   <!-- boot-directive-start -->
//   ... body ...
//   <!-- boot-directive-end -->
//
// Insertion point is immediately after the YAML frontmatter and before
// the rest of the agent body. Hand-edited content outside the region is
// preserved.
//
// Memory markers are also rewritten per-agent:
//
//   <!-- agentcohort-memory-start -->
//   ... agent-specific memory affinity section ...
//   <!-- agentcohort-memory-end -->

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const START = '<!-- boot-directive-start -->';
const END = '<!-- boot-directive-end -->';

const MEM_START = '<!-- agentcohort-memory-start -->';
const MEM_END = '<!-- agentcohort-memory-end -->';

/**
 * Split a markdown string into frontmatter and body.
 * If no frontmatter, returns { frontmatter: '', body: text }.
 */
function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: '', body: text };
  // Find closing --- on its own line.
  const re = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/;
  const m = text.match(re);
  if (!m) return { frontmatter: '', body: text };
  const end = m[0].length;
  return { frontmatter: text.slice(0, end), body: text.slice(end) };
}

/**
 * Remove an existing directive region (between START and END, inclusive,
 * plus a trailing blank line if present) from `body`. Returns the body
 * unchanged if no region exists.
 */
function stripExistingRegion(body) {
  const re = new RegExp(
    `${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}\\s*\\n?`,
    'g'
  );
  return body.replace(re, '');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite the agentcohort-memory-start/end region inside `content`
 * with the per-agent rendered section from memoryBoot.
 *
 * @param {string} content - agent file content after boot-directive sync
 * @param {string} agentName - e.g. "bug-fixer"
 * @param {(agent: string, user: undefined) => string} renderFn
 * @returns {string}
 */
function injectMemorySection(content, agentName, renderFn) {
  const startIdx = content.indexOf(MEM_START);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(MEM_END, startIdx + MEM_START.length);
  if (endIdx === -1) return content;

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + MEM_END.length);
  const rendered = renderFn(agentName, undefined);
  return before + rendered + after;
}

/**
 * Sync the directive into every .md file under `agentDir`.
 *
 * @param {{ directivePath: string, agentDir: string, renderMemorySection?: (agent: string, user: undefined) => string }} opts
 * @returns {{ updated: string[], unchanged: string[] }}
 */
export function syncBootDirective(opts) {
  if (!existsSync(opts.agentDir)) {
    throw new Error(`sync-boot-directive: agent dir not found: ${opts.agentDir}`);
  }

  const directive = readFileSync(opts.directivePath, 'utf8').trimEnd() + '\n';
  if (!directive.startsWith(START) || !directive.trimEnd().endsWith(END)) {
    throw new Error(
      `sync-boot-directive: ${opts.directivePath} must start with ${START} and end with ${END}`
    );
  }

  const updated = [];
  const unchanged = [];

  for (const file of readdirSync(opts.agentDir).sort()) {
    if (!file.endsWith('.md')) continue;
    const path = join(opts.agentDir, file);
    const agentName = file.replace(/\.md$/, '');
    const original = readFileSync(path, 'utf8');
    const { frontmatter, body } = splitFrontmatter(original);
    const stripped = stripExistingRegion(body).replace(/^[\r\n]+/, '');
    const fm = frontmatter || '';
    const fmTail = fm && !fm.endsWith('\n') ? '\n' : '';
    const sep = fm ? '\n' : '';
    let next = `${fm}${fmTail}${sep}${directive}\n${stripped}`;
    // Inject per-agent memory section if renderMemorySection is provided.
    if (opts.renderMemorySection) {
      next = injectMemorySection(next, agentName, opts.renderMemorySection);
    }
    if (next === original) {
      unchanged.push(file);
    } else {
      writeFileSync(path, next);
      updated.push(file);
    }
  }

  return { updated, unchanged };
}

// CLI entry point: run with defaults pointing at this repo's templates.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');

  // Load renderMemorySection from compiled dist if available (tsc must run first).
  let renderMemorySection;
  const distMemoryBoot = join(root, 'dist', 'memoryBoot.js');
  if (existsSync(distMemoryBoot)) {
    const mod = await import(pathToFileURL(distMemoryBoot).href);
    renderMemorySection = mod.renderMemorySection;
  } else {
    console.warn(
      '[sync-boot-directive] dist/memoryBoot.js not found — memory section will not be injected. Run tsc first.'
    );
  }

  const result = syncBootDirective({
    directivePath: join(root, 'src', 'templates', '_boot-directive.md'),
    agentDir: join(root, 'src', 'templates', 'agents'),
    renderMemorySection,
  });
  console.log(
    `[sync-boot-directive] updated=${result.updated.length} unchanged=${result.unchanged.length}`
  );
}
