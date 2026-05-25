import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// memory init
// ============================================================================

export type GitMode = 'default' | 'commit-all' | 'gitignore-all';

export interface MemoryInitOptions {
  cwd: string;
  mode: GitMode;
}

export interface MemoryInitResult {
  created: string[];
  alreadyPresent: string[];
  gitignoreUpdated: boolean;
}

const DIR_LAYOUT = [
  '.agentcohort',
  '.agentcohort/memory',
  '.agentcohort/memory/shared',
  '.agentcohort/memory/local',
  '.agentcohort/runs',
] as const;

const GITIGNORE_DEFAULT = [
  '.agentcohort/memory/local/',
  '.agentcohort/runs/',
];

const GITIGNORE_ALL = [
  '.agentcohort/',
];

export function runMemoryInit(opts: MemoryInitOptions): MemoryInitResult {
  const created: string[] = [];
  const alreadyPresent: string[] = [];
  for (const rel of DIR_LAYOUT) {
    const abs = join(opts.cwd, rel);
    if (existsSync(abs)) {
      alreadyPresent.push(rel);
    } else {
      mkdirSync(abs, { recursive: true });
      created.push(rel);
    }
  }
  const keepFile = join(opts.cwd, '.agentcohort', 'memory', 'local', '.gitkeep');
  if (!existsSync(keepFile)) {
    writeFileSync(keepFile, '');
    created.push('.agentcohort/memory/local/.gitkeep');
  }

  let gitignoreUpdated = false;
  if (opts.mode === 'default') {
    gitignoreUpdated = ensureGitignore(opts.cwd, GITIGNORE_DEFAULT);
  } else if (opts.mode === 'gitignore-all') {
    gitignoreUpdated = ensureGitignore(opts.cwd, GITIGNORE_ALL);
  }
  // commit-all: leave .gitignore untouched.

  return { created, alreadyPresent, gitignoreUpdated };
}

function ensureGitignore(cwd: string, lines: string[]): boolean {
  const path = join(cwd, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const toAdd = lines.filter((l) => !existingLines.has(l));
  if (toAdd.length === 0) return false;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, prefix + toAdd.join('\n') + '\n');
  return true;
}
