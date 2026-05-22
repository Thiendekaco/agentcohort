// One-shot maintenance script: append a Git-safety reinforcement block
// to every bundled agent that has `Bash` in its `tools:` whitelist.
//
// The block is delimited by HTML-comment markers so re-running this
// script is idempotent (existing block is replaced, not duplicated).
//
// Usage: node scripts/add-per-agent-safety.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAFETY_START = '<!-- agent-git-safety-start -->';
const SAFETY_END = '<!-- agent-git-safety-end -->';

const BLOCK = [
  SAFETY_START,
  '',
  '# Git safety (binding — re-stated because this agent has shell access)',
  '',
  "The boot directive's step 5 is binding for this agent. Repeated here",
  'because this role has `Bash` in its tool whitelist:',
  '',
  '- NEVER run destructive git commands without an explicit user',
  '  instruction in this session. Specifically forbidden:',
  '  `git restore`, `git reset --hard`, `git clean -f`,',
  '  `git checkout -- <path>`, `git stash drop`,',
  '  `git push --force`, or anything that overwrites uncommitted',
  '  work or rewrites published history.',
  '- If you hit a "stash conflict", "dirty working tree",',
  '  "uncommitted changes blocking the operation", or similar —',
  '  STOP and REPORT the state. Do NOT "clean up" silently.',
  '  Uncommitted work is sacred.',
  '- Read-only git is always fine: `git status`, `git diff`,',
  '  `git log`, `git show`, `git stash list`, `git reflog`.',
  '- If unsure whether a command is destructive, treat it as',
  '  destructive and ask the user before running.',
  '',
  SAFETY_END,
  '',
].join('\n');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REGION_RE = new RegExp(
  escapeRe(SAFETY_START) + '[\\s\\S]*?' + escapeRe(SAFETY_END) + '\\n?',
  'g'
);

function hasBash(body) {
  const m = body.match(/^tools:\s*(.+?)\s*$/m);
  if (!m) return false;
  return m[1].split(',').map((s) => s.trim()).includes('Bash');
}

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = join(here, '..', 'src', 'templates', 'agents');

let added = 0;
let replaced = 0;
let skipped = 0;

for (const f of readdirSync(agentDir).sort()) {
  if (!f.endsWith('.md')) continue;
  const p = join(agentDir, f);
  const body = readFileSync(p, 'utf8');
  if (!hasBash(body)) {
    skipped += 1;
    continue;
  }
  let next;
  if (REGION_RE.test(body)) {
    next = body.replace(REGION_RE, BLOCK);
    replaced += 1;
  } else {
    next = body.replace(/\s+$/, '') + '\n\n' + BLOCK;
    added += 1;
  }
  if (next !== body) writeFileSync(p, next);
}

console.log(
  `[add-per-agent-safety] added=${added} replaced=${replaced} skipped=${skipped}`
);
