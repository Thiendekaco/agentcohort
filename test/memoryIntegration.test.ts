import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runMemoryInit, runMemoryWrite, runMemoryRead } from '../src/memoryCmd';
import { runRunStart, runRunEnd } from '../src/runCmd';
import { runGateRecord } from '../src/gateCmd';
import { runDoctor } from '../src/doctor';
import { runStatus } from '../src/status';
import { readJsonl } from '../src/memoryIo';

function bundledTemplatesDir() { return join(__dirname, '..', 'src', 'templates'); }

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcohort-e2e-'));
  execSync('git init -q', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  execSync('git -c user.email=t@t -c user.name=t add .', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('memory layer end-to-end (simulated dev-flow pipeline)', () => {
  it('completes a full pipeline: init → run start → architect write + gate → bug-fixer write + verify → run end', () => {
    // 1. Init memory layer
    runMemoryInit({ cwd: dir, mode: 'default' });

    // 2. Run start (dispatcher's first call after classification)
    const { runId } = runRunStart({
      cwd: dir, pipeline: 'dev-flow', tier: 3,
      taskSummary: 'add caching to /users endpoint',
    });
    expect(runId).toBeTruthy();

    // 3. solution-architect writes its decision
    const decision = runMemoryWrite({
      cwd: dir, collection: 'decisions', source: 'solution-architect',
      confidence: 0.85, verified: false,
      taskSummary: 'cache /users',
      runId, files: ['src/users.ts'],
      bodyJson: JSON.stringify({
        approach_chosen: 'in-memory LRU with 1000-key cap',
        alternatives_considered: ['Redis', 'memcached'],
        trade_offs: 'avoids new infra; bounded memory; not multi-instance safe',
        gate_outcome: 'approved',
      }),
    });
    expect(decision.disposition).toBe('written');

    // 4. Architect gate fires — user approves
    const gateApproved = runGateRecord({
      cwd: dir, runId, gate: 'architect', outcome: 'approved',
      proposedContent: 'in-memory LRU with 1000-key cap',
      posingAgent: 'solution-architect',
    });
    expect(gateApproved.disposition).toBe('written');

    // 5. bug-fixer writes a bug entry (independent pipeline branch — simulated)
    const bug = runMemoryWrite({
      cwd: dir, collection: 'bugs', source: 'bug-fixer',
      confidence: 0.7, verified: false,
      taskSummary: 'cache invalidation race',
      runId, files: ['src/users.ts'],
      bodyJson: JSON.stringify({
        symptoms: 'stale user data after profile update',
        root_cause: 'cache write happens before DB commit',
        fix_summary: 'reorder: commit then invalidate cache',
        affected_files: ['src/users.ts'],
        test_added: 'test/users.cache.test.ts',
      }),
    });
    expect(bug.disposition).toBe('written');

    // 6. test-verifier verifies the bug fix
    const verify = runMemoryWrite({
      cwd: dir, collection: 'verifications', source: 'test-verifier',
      confidence: 1.0, verified: true,
      taskSummary: 'verify cache fix',
      runId, files: [],
      bodyJson: JSON.stringify({
        target_id: bug.entryId,
        target_collection: 'bugs',
        verified: true,
        evidence: 'test/users.cache.test.ts passed',
        by_stage: 'test-verifier',
      }),
    });
    expect(verify.disposition).toBe('written');

    // 7. Reading bugs with --with-verifications shows verified=true
    const reading = runMemoryRead({ cwd: dir, collection: 'bugs', withVerifications: true });
    expect((reading.entries[0] as any)._effective_verified).toBe(true);
    expect((reading.entries[0] as any)._verification_evidence).toBe('test/users.cache.test.ts passed');

    // 8. Run end (last agent — final-reviewer)
    runRunEnd({
      cwd: dir, runId, outcome: 'success',
      agentsRun: ['solution-architect', 'bug-fixer', 'test-verifier', 'final-reviewer'],
      gatesFired: ['architect'],
    });

    // 9. INDEX.jsonl has start + end paired by run_id
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('start');
    expect(events[1].event).toBe('end');
    expect(events[0].run_id).toBe(events[1].run_id);
    expect(events[1].outcome).toBe('success');

    // 10. Doctor reports the layer is healthy
    const doc = runDoctor({ cwd: dir, templatesDir: bundledTemplatesDir() });
    const allChecks = doc.sections.flatMap((s: any) => s.checks);
    const memDirCheck = allChecks.find((c: any) => c.id === 'memory.dir-present');
    expect(memDirCheck?.severity).toBe('ok');
    const secScan = allChecks.find((c: any) => c.id === 'memory.secrets-scan');
    expect(secScan?.severity).toBe('ok');

    // 11. Status reflects all writes
    const stat = runStatus({ cwd: dir, templatesDir: bundledTemplatesDir() });
    expect((stat as any).memory.initialized).toBe(true);
    expect((stat as any).memory.collections.decisions).toBe(1);
    expect((stat as any).memory.collections.bugs).toBe(1);
    expect((stat as any).memory.collections.audit).toBe(1);
    expect((stat as any).memory.collections.verifications).toBe(1);
    expect((stat as any).memory.runsTracked).toBe(1);
  });

  it('rejects a write that would leak a secret', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    const { runId } = runRunStart({ cwd: dir, pipeline: 'p' });
    const r = runMemoryWrite({
      cwd: dir, collection: 'decisions', source: 'solution-architect',
      confidence: 1, verified: true,
      taskSummary: 't', runId, files: [],
      bodyJson: JSON.stringify({
        approach_chosen: 'use key AKIAIOSFODNN7EXAMPLE for s3',
        alternatives_considered: [], trade_offs: '', gate_outcome: 'approved',
      }),
    });
    expect(r.disposition).toBe('rejected-secret');
    expect(r.secretMatches?.[0].patternName).toBe('aws-access-key-id');
  });

  it('aborted pipeline records gate reject + run end aborted', () => {
    runMemoryInit({ cwd: dir, mode: 'default' });
    const { runId } = runRunStart({ cwd: dir, pipeline: 'dev-flow', tier: 3 });
    const r = runGateRecord({
      cwd: dir, runId, gate: 'architect', outcome: 'rejected',
      proposedContent: 'use Redis',
      posingAgent: 'solution-architect',
      reason: 'no new infra dependencies this quarter',
    });
    expect(r.disposition).toBe('written');
    runRunEnd({ cwd: dir, runId, outcome: 'aborted', gatesFired: ['architect'] });
    const events = readJsonl<any>(join(dir, '.agentcohort/runs/INDEX.jsonl'));
    expect(events[1].outcome).toBe('aborted');
    const audit = readJsonl<any>(join(dir, '.agentcohort/memory/shared/audit.jsonl'));
    expect(audit[0].body.outcome).toBe('rejected');
    expect(audit[0].body.reason).toContain('no new infra');
  });
});
