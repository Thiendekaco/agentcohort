import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupPathFor,
  contentEquals,
  formatBackupSuffix,
  readIfExists,
} from '../src/fileOps';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-fileops-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe('formatBackupSuffix', () => {
  it('zero-pads to backup-YYYYMMDD-HHMMSS using local time', () => {
    // Local time intentionally; construct via local-time Date components.
    const d = new Date(2024, 0, 5, 9, 3, 7); // 2024-01-05 09:03:07 local
    expect(formatBackupSuffix(d)).toBe('backup-20240105-090307');
  });

  it('handles double-digit month/day/time', () => {
    const d = new Date(2025, 10, 23, 14, 45, 59); // 2025-11-23 14:45:59
    expect(formatBackupSuffix(d)).toBe('backup-20251123-144559');
  });
});

describe('backupPathFor', () => {
  it('appends .backup-<suffix> to the original path', () => {
    const d = new Date(2024, 0, 5, 9, 3, 7);
    expect(backupPathFor('/a/b/CLAUDE.md', d)).toBe(
      '/a/b/CLAUDE.md.backup-20240105-090307'
    );
  });
});

describe('contentEquals', () => {
  it('is exact byte comparison', () => {
    expect(contentEquals('a\n', 'a\n')).toBe(true);
    expect(contentEquals('a\n', 'a')).toBe(false);
  });
});

describe('readIfExists', () => {
  it('returns null when the file is absent and content when present', () => {
    const dir = tmp();
    expect(readIfExists(join(dir, 'nope.md'))).toBeNull();
    const f = join(dir, 'there.md');
    writeFileSync(f, 'hello', 'utf8');
    expect(readIfExists(f)).toBe('hello');
  });
});
