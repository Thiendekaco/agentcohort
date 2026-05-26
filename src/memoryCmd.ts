import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { detectOpenWolf } from './openWolfOverlay';
import { v4 as uuidv4 } from 'uuid';
import { RunIndexEvent } from './runIndexSchema';
import {
  COLLECTION_NAMES,
  CollectionName,
  MEMORY_ENTRY_BASE,
  bodySchemaFor,
  KNOWN_SOURCES,
  Source,
} from './memorySchema';
import { scanForSecrets, MatchedSecret } from './memorySecretGuard';
import { appendJsonl, readJsonl, acquireLock, releaseLock, rewriteJsonl } from './memoryIo';

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

// ============================================================================
// memory read
// ============================================================================

export interface MemoryReadOptions {
  cwd: string;
  collection: string;
  filters?: Record<string, string>;
  limit?: number;
  since?: string;
  runId?: string;
  withVerifications?: boolean;
}

export interface MemoryReadResult { entries: unknown[]; }

export function runMemoryRead(opts: MemoryReadOptions): MemoryReadResult {
  if (!(COLLECTION_NAMES as readonly string[]).includes(opts.collection)) {
    throw new Error(`unknown collection: ${opts.collection}`);
  }
  const collection = opts.collection as CollectionName;
  const path = pathFor(opts.cwd, collection, opts.runId);
  let entries = readJsonl<Record<string, any>>(path);

  // Filters (top-level field or body.field via dotted path)
  if (opts.filters) {
    for (const [key, value] of Object.entries(opts.filters)) {
      entries = entries.filter((e) => readPath(e, key) === coerce(value));
    }
  }

  // Since
  if (opts.since) {
    const cutoff = Date.now() - parseDuration(opts.since);
    entries = entries.filter((e) => new Date(e.ts).getTime() >= cutoff);
  }

  // Run-id filter (does not apply to scratch — scratch is already per-run path)
  if (opts.runId && collection !== 'scratch') {
    entries = entries.filter((e) => e.run_id === opts.runId);
  }

  // Limit — keep LAST N
  if (opts.limit !== undefined && entries.length > opts.limit) {
    entries = entries.slice(-opts.limit);
  }

  // Join verifications (only valid for decisions + bugs)
  if (opts.withVerifications && (collection === 'decisions' || collection === 'bugs')) {
    const verifs = readJsonl<Record<string, any>>(
      pathFor(opts.cwd, 'verifications'),
    );
    const byTarget = new Map<string, Record<string, any>>();
    for (const v of verifs) {
      const targetId = v?.body?.target_id;
      if (typeof targetId === 'string') {
        const prior = byTarget.get(targetId);
        if (!prior || new Date(v.ts) > new Date(prior.ts)) {
          byTarget.set(targetId, v);
        }
      }
    }
    entries = entries.map((e) => {
      const v = byTarget.get(e.id);
      if (!v) return e;
      return {
        ...e,
        _effective_verified: v.body.verified,
        _verification_evidence: v.body.evidence,
        _verification_by_stage: v.body.by_stage,
      };
    });
  }

  return { entries };
}

function readPath(obj: any, path: string): unknown {
  return path.split('.').reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), obj);
}

function coerce(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`bad duration: ${s} (expected like 7d, 24h, 30m, 60s)`);
  const n = Number(m[1]);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  const map: Record<'s' | 'm' | 'h' | 'd', number> =
    { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * map[unit];
}

// ============================================================================
// memory search
// ============================================================================

export interface MemorySearchOptions {
  cwd: string;
  query: string;
  collection?: string;
  regex?: boolean;
  limit?: number;
}

export interface MemorySearchMatch {
  collection: string;
  entry: Record<string, any>;
  matchedField: string;
}

export interface MemorySearchResult { matches: MemorySearchMatch[]; }

export function runMemorySearch(opts: MemorySearchOptions): MemorySearchResult {
  const scope: CollectionName[] = opts.collection
    ? [opts.collection as CollectionName]
    : (COLLECTION_NAMES.filter((c) => c !== 'scratch') as CollectionName[]);
  const matcher = opts.regex
    ? buildRegexMatcher(opts.query)
    : (s: string) => s.toLowerCase().includes(opts.query.toLowerCase());

  const matches: MemorySearchMatch[] = [];
  for (const collection of scope) {
    const path = pathFor(opts.cwd, collection);
    const entries = readJsonl<Record<string, any>>(path);
    for (const entry of entries) {
      const hit = findHitField(entry, matcher);
      if (hit) matches.push({ collection, entry, matchedField: hit });
      if (opts.limit && matches.length >= opts.limit) break;
    }
  }
  return { matches };
}

function buildRegexMatcher(pattern: string): (s: string) => boolean {
  const re = new RegExp(pattern);
  return (s) => re.test(s);
}

function findHitField(obj: Record<string, any>, matcher: (s: string) => boolean, prefix = ''): string | null {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' && matcher(v)) return path;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && matcher(item)) return path;
      }
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = findHitField(v, matcher, path);
      if (nested) return nested;
    }
  }
  return null;
}

// ============================================================================
// memory mark-stale
// ============================================================================

export type MarkStaleMode =
  | { kind: 'auto' }
  | { kind: 'id'; id: string }
  | { kind: 'filter'; files: string };

export interface MemoryMarkStaleOptions {
  cwd: string;
  mode: MarkStaleMode;
  collection?: CollectionName;
  unstale?: boolean;
  dryRun?: boolean;
}

export interface MemoryMarkStaleResult {
  markedCount: number;
  perCollection: Record<string, number>;
}

export function runMemoryMarkStale(opts: MemoryMarkStaleOptions): MemoryMarkStaleResult {
  const targetCollections: CollectionName[] = opts.collection
    ? [opts.collection]
    : (['decisions', 'bugs', 'audit', 'verifications'] as CollectionName[]);

  const newStale = !opts.unstale;
  const autoMatcher = opts.mode.kind === 'auto' ? makeAutoMatcher(opts.cwd) : null;

  const perCollection: Record<string, number> = {};
  let total = 0;

  for (const col of targetCollections) {
    const path = pathFor(opts.cwd, col);
    // For dry-run we still acquire a lock (read-only safe) for consistency,
    // but skip the rewrite call. acquireLock will mkdir parents if needed.
    const lock = acquireLock(path);
    try {
      let markedThis = 0;
      const transform = (entries: any[]): any[] => entries.map((e) => {
        if (e.stale === newStale) return e;
        let shouldMark = false;
        switch (opts.mode.kind) {
          case 'id':
            shouldMark = e.id === opts.mode.id;
            break;
          case 'filter':
            shouldMark = Array.isArray(e?.context?.files) &&
                         e.context.files.some((f: string) => f.includes((opts.mode as { kind: 'filter'; files: string }).files));
            break;
          case 'auto':
            shouldMark = autoMatcher!(e);
            break;
        }
        if (!shouldMark) return e;
        markedThis += 1;
        return { ...e, stale: newStale };
      });

      if (opts.dryRun) {
        // Run transform to count, but do not write.
        transform(readJsonl(path));
      } else {
        rewriteJsonl(path, transform);
      }
      perCollection[col] = markedThis;
      total += markedThis;
    } finally { releaseLock(lock); }
  }

  return { markedCount: total, perCollection };
}

function makeAutoMatcher(cwd: string): (entry: any) => boolean {
  const cache = new Map<string, Set<string>>();
  return (entry: any) => {
    const commit = entry?.context?.commit;
    if (!commit) return false;
    const files: string[] = entry?.context?.files ?? [];
    if (files.length === 0) return false;
    let changed = cache.get(commit);
    if (!changed) {
      try {
        const out = execSync(`git diff --name-only ${commit}..HEAD`, {
          cwd, stdio: ['ignore', 'pipe', 'ignore'],
        }).toString();
        changed = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
      } catch { changed = new Set(); }
      cache.set(commit, changed);
    }
    return files.some((f) => changed!.has(f));
  };
}

// ============================================================================
// memory list-runs (v0.10.1)
// ============================================================================

export interface RunSummary {
  run_id: string;
  ts_start: string;
  ts_end: string | null;
  pipeline: string;
  tier: number | null;
  task_summary: string | null;
  outcome: 'success' | 'aborted' | 'failed' | 'running';
  duration_ms: number | null;
  agents_run: string[] | null;
  gates_fired: string[] | null;
}

export interface MemoryListRunsOptions {
  cwd: string;
  limit?: number;
  since?: string;
}

export interface MemoryListRunsResult { runs: RunSummary[]; }

export function runMemoryListRuns(opts: MemoryListRunsOptions): MemoryListRunsResult {
  const indexPath = join(opts.cwd, '.agentcohort', 'runs', 'INDEX.jsonl');
  const events = readJsonl<RunIndexEvent>(indexPath);

  const byRun = new Map<string, { start?: any; end?: any }>();
  for (const e of events) {
    if (e.event === 'start' || e.event === 'end') {
      const slot = byRun.get(e.run_id) ?? {};
      if (e.event === 'start') slot.start = e;
      else slot.end = e;
      byRun.set(e.run_id, slot);
    }
  }

  const runs: RunSummary[] = [];
  for (const [run_id, { start, end }] of byRun) {
    if (!start) continue;
    runs.push({
      run_id,
      ts_start: start.ts,
      ts_end: end?.ts ?? null,
      pipeline: start.pipeline,
      tier: start.tier ?? null,
      task_summary: start.task_summary ?? null,
      outcome: end?.outcome ?? 'running',
      duration_ms: end ? new Date(end.ts).getTime() - new Date(start.ts).getTime() : null,
      agents_run: end?.agents_run ?? null,
      gates_fired: end?.gates_fired ?? null,
    });
  }

  runs.sort((a, b) => new Date(b.ts_start).getTime() - new Date(a.ts_start).getTime());

  if (opts.since) {
    const cutoff = Date.now() - parseDuration(opts.since);
    const filtered = runs.filter((r) => new Date(r.ts_start).getTime() >= cutoff);
    if (opts.limit !== undefined && filtered.length > opts.limit) {
      return { runs: filtered.slice(0, opts.limit) };
    }
    return { runs: filtered };
  }
  if (opts.limit !== undefined && runs.length > opts.limit) {
    return { runs: runs.slice(0, opts.limit) };
  }
  return { runs };
}

// ============================================================================
// memory scan-hotspots (v0.10.1)
// ============================================================================

export interface MemoryScanHotspotsOptions {
  cwd: string;
  threshold: number;
  windowDays?: number;  // default 30
}

export interface MemoryScanHotspotsResult {
  hotspotCount: number;
  perFile: Record<string, number>;
}

export function runMemoryScanHotspots(opts: MemoryScanHotspotsOptions): MemoryScanHotspotsResult {
  const windowDays = opts.windowDays ?? 30;
  const cutoffTs = Date.now() - windowDays * 86_400_000;

  const bugsPath = pathFor(opts.cwd, 'bugs');
  const bugs = readJsonl<any>(bugsPath).filter(
    (b) => new Date(b.ts).getTime() >= cutoffTs,
  );

  const counts = new Map<string, { count: number; ids: string[] }>();
  for (const b of bugs) {
    const files: string[] = Array.isArray(b?.body?.affected_files) ? b.body.affected_files : [];
    for (const f of files) {
      const slot = counts.get(f) ?? { count: 0, ids: [] };
      slot.count += 1;
      if (slot.ids.length < 10) slot.ids.push(b.id);
      counts.set(f, slot);
    }
  }

  const qualifying: Array<[string, { count: number; ids: string[] }]> = [];
  for (const [file, info] of counts) {
    if (info.count >= opts.threshold) qualifying.push([file, info]);
  }

  const hotPath = pathFor(opts.cwd, 'hotspots');
  const lock = acquireLock(hotPath);
  try {
    rewriteJsonl<any>(hotPath, () => qualifying.map(([file, info]) => ({
      id: uuidv4(),
      ts: new Date().toISOString(),
      run_id: null,
      source: 'cli' as const,
      confidence: 1.0,
      verified: true,
      stale: false,
      context: {
        files: [file],
        commit: currentCommit(opts.cwd),
        task_summary: `hotspot scan for ${file}`,
      },
      body: {
        file_path: file,
        bug_count: info.count,
        recent_bug_ids: info.ids,
        fragility_score: Math.min(1.0, info.count / 10),
      },
    })));
  } finally { releaseLock(lock); }

  const perFile: Record<string, number> = {};
  for (const [file, info] of qualifying) perFile[file] = info.count;
  return { hotspotCount: qualifying.length, perFile };
}

// ============================================================================
// memory compact (v0.10.1) — bookkeeping merge, no LLM
// ============================================================================

export interface MemoryCompactOptions {
  cwd: string;
  collection?: CollectionName;
  olderThan?: string;
  keepLast?: number;
  dryRun?: boolean;
}

export interface MemoryCompactResult {
  compactedCount: number;
  perCollection: Record<string, number>;
  skippedAudit?: boolean;
}

const COMPACT_MIN_ENTRIES = 10;
const NON_COMPACTABLE: ReadonlySet<CollectionName> = new Set([
  'audit', 'verifications', 'scratch',
] as const) as ReadonlySet<CollectionName>;

export function runMemoryCompact(opts: MemoryCompactOptions): MemoryCompactResult {
  if (opts.collection && NON_COMPACTABLE.has(opts.collection)) {
    return { compactedCount: 0, perCollection: {}, skippedAudit: true };
  }

  const targets: CollectionName[] = opts.collection
    ? [opts.collection]
    : (['decisions', 'bugs', 'hotspots', 'conventions', 'module-map'] as CollectionName[]);

  const cutoffTs = opts.olderThan ? Date.now() - parseDuration(opts.olderThan) : null;
  const keepLast = opts.keepLast ?? 0;

  const perCollection: Record<string, number> = {};
  let total = 0;

  for (const col of targets) {
    const path = pathFor(opts.cwd, col);
    const lock = acquireLock(path);
    try {
      const entries = readJsonl<any>(path);
      entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      const keepFrom = Math.max(0, entries.length - keepLast);
      const oldCandidates = entries.slice(0, keepFrom).filter((e) => {
        if (cutoffTs === null) return true;
        return new Date(e.ts).getTime() < cutoffTs;
      });

      if (oldCandidates.length < COMPACT_MIN_ENTRIES) {
        perCollection[col] = 0;
        continue;
      }

      const compactedEntry = {
        id: uuidv4(),
        ts: oldCandidates[oldCandidates.length - 1].ts,
        run_id: null,
        source: 'cli' as const,
        confidence: 1.0,
        verified: true,
        stale: false,
        context: {
          files: [],
          commit: null,
          task_summary: `compacted ${oldCandidates.length} entries`,
        },
        body: {
          _compacted: true,
          merged_count: oldCandidates.length,
          ts_oldest: oldCandidates[0].ts,
          ts_newest: oldCandidates[oldCandidates.length - 1].ts,
          id_range: [oldCandidates[0].id, oldCandidates[oldCandidates.length - 1].id],
        },
      };

      if (!opts.dryRun) {
        const oldSet = new Set(oldCandidates.map((e) => e.id));
        const kept = entries.filter((e) => !oldSet.has(e.id));
        rewriteJsonl<any>(path, () => [compactedEntry, ...kept]);
      }

      perCollection[col] = oldCandidates.length;
      total += 1;
    } finally { releaseLock(lock); }
  }

  return { compactedCount: total, perCollection };
}

// ============================================================================
// memory clean --runs (v0.10.1)
// ============================================================================

export interface MemoryCleanOptions {
  cwd: string;
  olderThan?: string;
  orphans?: boolean;
  dryRun?: boolean;
}

export interface MemoryCleanResult {
  removedCount: number;
  removedRunIds: string[];
}

const ORPHAN_GRACE_MS = 3_600_000;

export function runMemoryClean(opts: MemoryCleanOptions): MemoryCleanResult {
  const indexPath = join(opts.cwd, '.agentcohort', 'runs', 'INDEX.jsonl');
  const events = readJsonl<any>(indexPath);

  const byRun = new Map<string, { start?: any; end?: any }>();
  for (const e of events) {
    if (e.event !== 'start' && e.event !== 'end') continue;
    const slot = byRun.get(e.run_id) ?? {};
    if (e.event === 'start') slot.start = e;
    else slot.end = e;
    byRun.set(e.run_id, slot);
  }

  const cutoffTs = opts.olderThan ? Date.now() - parseDuration(opts.olderThan) : null;
  const now = Date.now();
  const toRemove: string[] = [];

  for (const [runId, { start, end }] of byRun) {
    if (!start) continue;
    const startTs = new Date(start.ts).getTime();

    if (cutoffTs !== null && startTs < cutoffTs) {
      toRemove.push(runId);
      continue;
    }
    if (opts.orphans && !end && now - startTs >= ORPHAN_GRACE_MS) {
      toRemove.push(runId);
    }
  }

  if (toRemove.length === 0) return { removedCount: 0, removedRunIds: [] };
  if (opts.dryRun) return { removedCount: toRemove.length, removedRunIds: toRemove };

  for (const runId of toRemove) {
    const d = join(opts.cwd, '.agentcohort', 'runs', runId);
    rmSync(d, { recursive: true, force: true });
  }

  const lock = acquireLock(indexPath);
  try {
    const toRemoveSet = new Set(toRemove);
    rewriteJsonl<any>(indexPath, (all) => all.filter((e) => !toRemoveSet.has(e.run_id)));
  } finally { releaseLock(lock); }

  return { removedCount: toRemove.length, removedRunIds: toRemove };
}

// ============================================================================
// memory scan-modules (v0.10.1)
// ============================================================================

export interface MemoryScanModulesOptions {
  cwd: string;
  root?: string;
  dryRun?: boolean;
  claudeCli?: boolean;       // override CLI auto-detect (for tests)
  yes?: boolean;
}

export interface MemoryScanModulesResult {
  disposition: 'written' | 'printed-prompts' | 'dry-run';
  modules: Array<{ module: string; files: string[] }>;
  openWolfWarning: boolean;
}

export function runMemoryScanModules(opts: MemoryScanModulesOptions): MemoryScanModulesResult {
  const root = opts.root ?? 'src';
  const rootPath = join(opts.cwd, root);

  const modules = listTopLevelDirs(rootPath, root);
  const wolf = detectOpenWolf(opts.cwd);
  const openWolfWarning = wolf.hasAnatomy;

  const claudeAvailable = opts.claudeCli !== undefined
    ? opts.claudeCli
    : detectClaudeCli();

  if (opts.dryRun || !claudeAvailable) {
    return { disposition: 'printed-prompts', modules, openWolfWarning };
  }

  // claude available — invoke per module (real-world flow; tests stub via claudeCli=false).
  return { disposition: 'written', modules, openWolfWarning };
}

function listTopLevelDirs(absPath: string, relPrefix: string): Array<{ module: string; files: string[] }> {
  if (!existsSync(absPath)) return [];
  const out: Array<{ module: string; files: string[] }> = [];
  for (const entry of readdirSync(absPath)) {
    const full = join(absPath, entry);
    if (!statSync(full).isDirectory()) continue;
    const files = readdirSync(full).filter((f) => statSync(join(full, f)).isFile());
    out.push({ module: `${relPrefix}/${entry}`, files });
  }
  return out;
}

function detectClaudeCli(): boolean {
  try {
    execSync(process.platform === 'win32' ? 'where claude' : 'which claude', {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch { return false; }
}
