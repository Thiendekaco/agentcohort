import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendJsonl,
  readJsonl,
  acquireLock,
  releaseLock,
  rewriteJsonl,
  MAX_ENTRY_BYTES,
} from '../src/memoryIo';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentcohort-io-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('appendJsonl', () => {
  it('creates the file on first append', () => {
    const path = join(dir, 'col.jsonl');
    appendJsonl(path, { a: 1 });
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n');
  });
  it('appends multiple entries with newlines', () => {
    const path = join(dir, 'col.jsonl');
    appendJsonl(path, { a: 1 });
    appendJsonl(path, { b: 2 });
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });
  it('rejects entries above MAX_ENTRY_BYTES', () => {
    const path = join(dir, 'col.jsonl');
    const big = { x: 'a'.repeat(MAX_ENTRY_BYTES + 100) };
    expect(() => appendJsonl(path, big)).toThrow(/entry too large/i);
  });
  it('creates parent directories on demand', () => {
    const path = join(dir, 'nested', 'deep', 'col.jsonl');
    appendJsonl(path, { a: 1 });
    expect(existsSync(path)).toBe(true);
  });
});

describe('readJsonl', () => {
  it('returns [] for missing file', () => {
    expect(readJsonl(join(dir, 'missing.jsonl'))).toEqual([]);
  });
  it('parses one entry per line', () => {
    const path = join(dir, 'col.jsonl');
    appendJsonl(path, { a: 1 });
    appendJsonl(path, { b: 2 });
    expect(readJsonl(path)).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('skips blank lines tolerantly', () => {
    const path = join(dir, 'col.jsonl');
    writeFileSync(path, '{"a":1}\n\n  \n{"b":2}\n');
    expect(readJsonl(path)).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('throws on malformed JSON line with file path + line number', () => {
    const path = join(dir, 'col.jsonl');
    writeFileSync(path, '{"a":1}\nnot-json\n');
    expect(() => readJsonl(path)).toThrow(/line 2/);
  });
});

describe('acquireLock / releaseLock', () => {
  it('round-trips', () => {
    const path = join(dir, 'col.jsonl');
    const lock = acquireLock(path);
    expect(existsSync(`${path}.lock`)).toBe(true);
    releaseLock(lock);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });
  it('throws when the lock is already held by a live pid', () => {
    const path = join(dir, 'col.jsonl');
    const a = acquireLock(path);
    expect(() => acquireLock(path)).toThrow(/locked/i);
    releaseLock(a);
  });
  it('breaks stale locks (held by a non-existent pid)', () => {
    const path = join(dir, 'col.jsonl');
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 999999999, ts: Date.now() }));
    // Should not throw — the stale lock gets reclaimed.
    const lock = acquireLock(path);
    releaseLock(lock);
  });
});

describe('rewriteJsonl', () => {
  it('atomically replaces the file via tmp + rename', () => {
    const path = join(dir, 'col.jsonl');
    appendJsonl(path, { a: 1 });
    appendJsonl(path, { b: 2 });
    rewriteJsonl(path, (entries: any[]) => entries.map((e) => ({ ...e, x: 'y' })));
    expect(readJsonl(path)).toEqual([{ a: 1, x: 'y' }, { b: 2, x: 'y' }]);
  });
  it('produces no tmp file leftover on success', () => {
    const path = join(dir, 'col.jsonl');
    appendJsonl(path, { a: 1 });
    rewriteJsonl(path, (e: any[]) => e);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
  it('writes empty file when transform returns []', () => {
    const path = join(dir, 'col.jsonl');
    appendJsonl(path, { a: 1 });
    rewriteJsonl(path, () => []);
    expect(readFileSync(path, 'utf8')).toBe('');
  });
});
