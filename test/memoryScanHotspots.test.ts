import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { runMemoryInit, runMemoryWrite, runMemoryScanHotspots } from '../src/memoryCmd';
import { readJsonl } from '../src/memoryIo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-hotspots-'));
  runMemoryInit({ cwd: dir, mode: 'default' });
  execSync('git init -q', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function addBug(file: string) {
  return runMemoryWrite({
    cwd: dir, collection: 'bugs', source: 'bug-fixer',
    confidence: 1, verified: true, taskSummary: 'bug', runId: uuidv4(),
    files: [file],
    bodyJson: JSON.stringify({
      symptoms: 'x', root_cause: 'y', fix_summary: 'z',
      affected_files: [file], test_added: null,
    }),
  });
}

describe('runMemoryScanHotspots', () => {
  it('produces no hotspots when no bugs exist', () => {
    const r = runMemoryScanHotspots({ cwd: dir, threshold: 2 });
    expect(r.hotspotCount).toBe(0);
  });

  it('counts unique files across bugs, applies threshold', () => {
    addBug('src/a.ts'); addBug('src/a.ts'); addBug('src/a.ts');
    addBug('src/b.ts'); // below threshold
    const r = runMemoryScanHotspots({ cwd: dir, threshold: 2 });
    expect(r.hotspotCount).toBe(1);
    const hot = readJsonl<any>(join(dir, '.agentcohort/memory/shared/hotspots.jsonl'));
    expect(hot[0].body.file_path).toBe('src/a.ts');
    expect(hot[0].body.bug_count).toBe(3);
    expect(hot[0].body.fragility_score).toBeCloseTo(0.3, 2);
  });

  it('fragility_score caps at 1.0', () => {
    for (let i = 0; i < 15; i++) addBug('src/a.ts');
    runMemoryScanHotspots({ cwd: dir, threshold: 1 });
    const hot = readJsonl<any>(join(dir, '.agentcohort/memory/shared/hotspots.jsonl'));
    expect(hot[0].body.fragility_score).toBe(1.0);
  });

  it('idempotent — re-running updates existing entries (not duplicates)', () => {
    addBug('src/a.ts'); addBug('src/a.ts');
    runMemoryScanHotspots({ cwd: dir, threshold: 1 });
    runMemoryScanHotspots({ cwd: dir, threshold: 1 });
    const hot = readJsonl<any>(join(dir, '.agentcohort/memory/shared/hotspots.jsonl'));
    expect(hot.length).toBe(1);
  });

  it('removes entries that drop below threshold on re-run', () => {
    addBug('src/a.ts'); addBug('src/a.ts');
    runMemoryScanHotspots({ cwd: dir, threshold: 1 });
    const r = runMemoryScanHotspots({ cwd: dir, threshold: 5 });
    expect(r.hotspotCount).toBe(0);
    const hot = readJsonl<any>(join(dir, '.agentcohort/memory/shared/hotspots.jsonl'));
    expect(hot.length).toBe(0);
  });
});
