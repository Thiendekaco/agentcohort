import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import {
  COLLECTION_NAMES,
  CollectionName,
  MEMORY_ENTRY_BASE,
  bodySchemaFor,
  KNOWN_SOURCES,
  Source,
} from './memorySchema';
import { scanForSecrets, MatchedSecret } from './memorySecretGuard';
import { appendJsonl } from './memoryIo';

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

// ============================================================================
// memory write
// ============================================================================

export interface MemoryWriteOptions {
  cwd: string;
  collection: string;
  bodyJson: string;
  source: string;
  confidence: number;
  verified: boolean;
  taskSummary: string;
  runId?: string;
  files?: string[];
}

export type MemoryWriteDisposition =
  | 'written'
  | 'rejected-malformed'
  | 'rejected-schema'
  | 'rejected-secret'
  | 'rejected-collection'
  | 'rejected-source'
  | 'rejected-no-run-id';

export interface MemoryWriteResult {
  disposition: MemoryWriteDisposition;
  entryId?: string;
  filePath?: string;
  errorMessage?: string;
  secretMatches?: MatchedSecret[];
}

export function runMemoryWrite(opts: MemoryWriteOptions): MemoryWriteResult {
  // 1. Collection validity
  if (!(COLLECTION_NAMES as readonly string[]).includes(opts.collection)) {
    return {
      disposition: 'rejected-collection',
      errorMessage: `unknown collection '${opts.collection}'; expected one of ${COLLECTION_NAMES.join(', ')}`,
    };
  }
  const collection = opts.collection as CollectionName;

  // 2. Source validity
  if (!(KNOWN_SOURCES as readonly string[]).includes(opts.source)) {
    return {
      disposition: 'rejected-source',
      errorMessage: `unknown source '${opts.source}'`,
    };
  }

  // 3. Scratch requires run-id
  if (collection === 'scratch' && !opts.runId) {
    return {
      disposition: 'rejected-no-run-id',
      errorMessage: 'scratch writes require --run-id',
    };
  }

  // 4. Parse body
  let body: unknown;
  try { body = JSON.parse(opts.bodyJson); }
  catch (e) {
    return { disposition: 'rejected-malformed', errorMessage: (e as Error).message };
  }

  // 5. Schema validation
  const parsed = bodySchemaFor(collection).safeParse(body);
  if (!parsed.success) {
    return { disposition: 'rejected-schema', errorMessage: parsed.error.message };
  }

  // 6. Secret scan on the entire serialized body (recursive across all strings)
  const flat = JSON.stringify(body);
  const secrets = scanForSecrets(flat);
  if (secrets.length > 0) {
    return { disposition: 'rejected-secret', secretMatches: secrets };
  }

  // 7. Build the full entry
  const commit = currentCommit(opts.cwd);
  const entry = {
    id: uuidv4(),
    ts: new Date().toISOString(),
    run_id: opts.runId ?? null,
    source: opts.source as Source,
    confidence: opts.confidence,
    verified: opts.verified,
    stale: false,
    context: {
      files: opts.files ?? [],
      commit,
      task_summary: opts.taskSummary,
    },
    body: parsed.data,
  };

  // 8. Final base-shape check (catches future schema drift)
  const ok = MEMORY_ENTRY_BASE.safeParse(entry);
  if (!ok.success) {
    return { disposition: 'rejected-schema', errorMessage: ok.error.message };
  }

  // 9. Write to the right path
  const filePath = pathFor(opts.cwd, collection, opts.runId);
  appendJsonl(filePath, entry);
  return { disposition: 'written', entryId: entry.id, filePath };
}

export function pathFor(cwd: string, collection: CollectionName, runId?: string): string {
  if (collection === 'scratch') {
    if (!runId) throw new Error('scratch path requires runId');
    return join(cwd, '.agentcohort', 'runs', runId, 'scratch.jsonl');
  }
  return join(cwd, '.agentcohort', 'memory', 'shared', `${collection}.jsonl`);
}

function currentCommit(cwd: string): string | null {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) return sha.slice(0, 12);
    return null;
  } catch { return null; }
}
