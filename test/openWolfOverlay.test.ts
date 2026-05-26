import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOpenWolf } from '../src/openWolfOverlay';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentcohort-wolf-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('detectOpenWolf', () => {
  it('returns all false when .wolf/ absent', () => {
    expect(detectOpenWolf(dir)).toEqual({ hasAnatomy: false, hasCerebrum: false, hasBuglog: false });
  });
  it('detects anatomy.md', () => {
    mkdirSync(join(dir, '.wolf'));
    writeFileSync(join(dir, '.wolf/anatomy.md'), '# anatomy');
    expect(detectOpenWolf(dir).hasAnatomy).toBe(true);
  });
  it('detects cerebrum.md', () => {
    mkdirSync(join(dir, '.wolf'));
    writeFileSync(join(dir, '.wolf/cerebrum.md'), '# cerebrum');
    expect(detectOpenWolf(dir).hasCerebrum).toBe(true);
  });
  it('detects buglog.json', () => {
    mkdirSync(join(dir, '.wolf'));
    writeFileSync(join(dir, '.wolf/buglog.json'), '[]');
    expect(detectOpenWolf(dir).hasBuglog).toBe(true);
  });
});
