import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFrontmatterModelDiff } from '../src/diff';
import type { ModelsConfig } from '../src/config';

const tmps: string[] = [];
function dir(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-diff-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function agent(modelLine: string): string {
  return `---\nname: x\ndescription: y\n${modelLine}\n---\n\n# Role\n`;
}

const OLD: ModelsConfig = {
  premium: 'OLD-OPUS',
  mid: 'OLD-SONNET',
  cheap: 'OLD-HAIKU',
};
const NEW: ModelsConfig = {
  premium: 'NEW-OPUS',
  mid: 'OLD-SONNET',
  cheap: 'NEW-HAIKU',
};

describe('computeFrontmatterModelDiff', () => {
  it('returns empty array when configs are equal', () => {
    const d = dir();
    writeFileSync(join(d, 'a.md'), agent('model: opus'));
    expect(computeFrontmatterModelDiff(d, OLD, OLD)).toEqual([]);
  });

  it('returns empty array when directory is absent', () => {
    expect(computeFrontmatterModelDiff('/no/such/dir', OLD, NEW)).toEqual([]);
  });

  it('lists files whose tier value changed (and only those)', () => {
    const d = dir();
    writeFileSync(join(d, 'opus-agent.md'), agent('model: opus'));
    writeFileSync(join(d, 'sonnet-agent.md'), agent('model: sonnet'));
    writeFileSync(join(d, 'haiku-agent.md'), agent('model: haiku'));

    const changes = computeFrontmatterModelDiff(d, OLD, NEW);
    const files = changes.map((c) => c.file).sort();
    // opus and haiku changed; sonnet stayed the same → only 2 changes
    expect(files).toEqual(['haiku-agent.md', 'opus-agent.md']);

    const opus = changes.find((c) => c.file === 'opus-agent.md')!;
    expect(opus.from).toBe('OLD-OPUS');
    expect(opus.to).toBe('NEW-OPUS');
  });

  it('excludes hand-edited files (non-alias model line)', () => {
    const d = dir();
    writeFileSync(join(d, 'hand.md'), agent('model: claude-some-specific-id'));
    expect(computeFrontmatterModelDiff(d, OLD, NEW)).toEqual([]);
  });

  it('skips non-.md files', () => {
    const d = dir();
    writeFileSync(join(d, 'a.md'), agent('model: opus'));
    writeFileSync(join(d, 'notes.txt'), agent('model: opus'));
    const changes = computeFrontmatterModelDiff(d, OLD, NEW);
    expect(changes.map((c) => c.file)).toEqual(['a.md']);
  });

  it('also detects files whose installed value is a concrete ID matching the old config', () => {
    // A previously-rendered file has `model: OLD-OPUS` in the frontmatter
    // (not an alias). We should still recognize that a re-render with
    // NEW would change it.
    const d = dir();
    writeFileSync(join(d, 'rendered.md'), agent('model: OLD-OPUS'));
    const changes = computeFrontmatterModelDiff(d, OLD, NEW);
    expect(changes).toEqual([
      { file: 'rendered.md', from: 'OLD-OPUS', to: 'NEW-OPUS' },
    ]);
  });
});
