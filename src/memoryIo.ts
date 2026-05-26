import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * POSIX guarantees atomic appendFileSync for writes < PIPE_BUF (typically
 * 4096 bytes). We cap a bit lower than that to leave headroom for the
 * trailing newline + worst-case UTF-8 expansion. Entries larger than
 * this are rejected — split the body across multiple entries.
 */
export const MAX_ENTRY_BYTES = 3800;

export function appendJsonl(path: string, entry: unknown): void {
  const line = JSON.stringify(entry) + '\n';
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > MAX_ENTRY_BYTES) {
    throw new Error(
      `entry too large (${bytes} bytes > ${MAX_ENTRY_BYTES}); split the body across multiple entries`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line, { encoding: 'utf8', flag: 'a' });
}

export function readJsonl<T = unknown>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out: T[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch (e) {
      throw new Error(`malformed JSON in ${path} line ${i + 1}: ${(e as Error).message}`);
    }
  }
  return out;
}

export interface LockHandle { path: string; lockPath: string; }

const LOCK_STALE_MS = 30_000;

export function acquireLock(targetPath: string): LockHandle {
  const lockPath = `${targetPath}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });

  // wx-first pattern: try to claim the lock atomically. If it already
  // exists, inspect — reclaim if stale, otherwise refuse. Retry once
  // after a stale reclaim so we don't recurse.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, ts: Date.now() }),
        { flag: 'wx' },
      );
      return { path: targetPath, lockPath };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw e;

      // Lock already exists. Inspect to decide stale-vs-live.
      let stale = false;
      try {
        const meta = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; ts: number };
        const age = Date.now() - meta.ts;
        if (isPidAlive(meta.pid) && age < LOCK_STALE_MS) {
          throw new Error(`file is locked by pid ${meta.pid} (held ${age}ms)`);
        }
        stale = true;
      } catch (parseErr) {
        if ((parseErr as Error).message?.startsWith('file is locked by pid')) throw parseErr;
        // Malformed lock file (partial write, garbage) — treat as stale.
        stale = true;
      }

      if (stale) {
        try { unlinkSync(lockPath); } catch { /* another process already reclaimed */ }
        // Loop and retry the wx write. If yet another process raced us
        // to the new lock, we'll see EEXIST again and on attempt 2 the
        // re-inspect will throw a clean "locked by pid X" error.
        continue;
      }
    }
  }
  throw new Error(`failed to acquire lock at ${lockPath} after 2 attempts (contention)`);
}

export function releaseLock(handle: LockHandle): void {
  try { unlinkSync(handle.lockPath); } catch {}
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

/**
 * Read all entries, run `transform`, write the result back atomically
 * via tmp + rename. Caller MUST hold the lock for `path` first.
 */
export function rewriteJsonl<T = unknown>(path: string, transform: (entries: T[]) => T[]): void {
  const entries = readJsonl<T>(path);
  const next = transform(entries);
  const tmpPath = `${path}.tmp`;
  const text = next.map((e) => JSON.stringify(e)).join('\n') + (next.length > 0 ? '\n' : '');
  writeFileSync(tmpPath, text, { encoding: 'utf8' });
  renameSync(tmpPath, path);
}
