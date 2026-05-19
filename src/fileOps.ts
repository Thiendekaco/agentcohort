import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Read a file's UTF-8 content, or null if it does not exist. */
export function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** Exact byte-for-byte comparison (drives idempotency: identical => "unchanged"). */
export function contentEquals(a: string, b: string): boolean {
  return a === b;
}

/** Two-digit / four-digit zero padded. */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Backup filename suffix using LOCAL time: `backup-YYYYMMDD-HHMMSS`.
 * Local time is intentional so the timestamp matches the user's wall clock.
 */
export function formatBackupSuffix(date: Date): string {
  const y = pad(date.getFullYear(), 4);
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `backup-${y}${mo}${d}-${h}${mi}${s}`;
}

/** Absolute path of the backup file for `target` at `date`. */
export function backupPathFor(target: string, date: Date): string {
  return `${target}.${formatBackupSuffix(date)}`;
}

/** Copy an existing file to its backup path. Never deletes the original. */
export function backupFile(target: string, backupPath: string): void {
  copyFileSync(target, backupPath);
}

/** Create parent directories (recursive) then write the file as UTF-8. */
export function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}
