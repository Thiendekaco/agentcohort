import { describe, it, expect } from 'vitest';
import {
  MEMORY_ENTRY_BASE,
  DECISION_BODY,
  BUG_BODY,
  SCRATCH_BODY,
  AUDIT_BODY,
  VERIFICATION_BODY,
  COLLECTION_NAMES,
  bodySchemaFor,
} from '../src/memorySchema';

const validBase = {
  id: '00000000-0000-4000-8000-000000000000',
  ts: '2026-05-25T14:22:00.000Z',
  run_id: null,
  source: 'human',
  confidence: 0.9,
  verified: true,
  stale: false,
  context: { files: [], commit: null, task_summary: 'test' },
  body: {},
};

describe('MEMORY_ENTRY_BASE', () => {
  it('accepts a minimal valid entry', () => {
    expect(() => MEMORY_ENTRY_BASE.parse(validBase)).not.toThrow();
  });
  it('rejects invalid uuid', () => {
    expect(() => MEMORY_ENTRY_BASE.parse({ ...validBase, id: 'not-a-uuid' })).toThrow();
  });
  it('rejects confidence outside [0,1]', () => {
    expect(() => MEMORY_ENTRY_BASE.parse({ ...validBase, confidence: 1.5 })).toThrow();
    expect(() => MEMORY_ENTRY_BASE.parse({ ...validBase, confidence: -0.1 })).toThrow();
  });
  it('rejects unknown source', () => {
    expect(() => MEMORY_ENTRY_BASE.parse({ ...validBase, source: 'not-an-agent' })).toThrow();
  });
  it('rejects task_summary > 200 chars', () => {
    const longSummary = 'x'.repeat(201);
    expect(() => MEMORY_ENTRY_BASE.parse({
      ...validBase,
      context: { ...validBase.context, task_summary: longSummary },
    })).toThrow();
  });
  it('rejects malformed commit hash', () => {
    expect(() => MEMORY_ENTRY_BASE.parse({
      ...validBase,
      context: { ...validBase.context, commit: 'not-hex' },
    })).toThrow();
  });
});

describe('per-collection bodies', () => {
  it('DECISION_BODY accepts a valid decision', () => {
    expect(() => DECISION_BODY.parse({
      approach_chosen: 'use Redis',
      alternatives_considered: ['in-memory', 'memcached'],
      trade_offs: 'higher infra cost, lower latency',
      gate_outcome: 'approved',
    })).not.toThrow();
  });
  it('DECISION_BODY rejects invalid gate_outcome', () => {
    expect(() => DECISION_BODY.parse({
      approach_chosen: 'x', alternatives_considered: [], trade_offs: 'y',
      gate_outcome: 'wat',
    })).toThrow();
  });
  it('BUG_BODY accepts a valid bug', () => {
    expect(() => BUG_BODY.parse({
      symptoms: 'totals off by one',
      root_cause: 'incl/excl mismatch',
      fix_summary: 'use < instead of <=',
      affected_files: ['src/invoice.ts'],
      test_added: 'test/invoice.test.ts',
    })).not.toThrow();
  });
  it('BUG_BODY accepts test_added=null', () => {
    expect(() => BUG_BODY.parse({
      symptoms: 'x', root_cause: 'y', fix_summary: 'z',
      affected_files: [], test_added: null,
    })).not.toThrow();
  });
  it('VERIFICATION_BODY requires uuid target_id', () => {
    expect(() => VERIFICATION_BODY.parse({
      target_id: 'not-a-uuid', target_collection: 'bugs',
      verified: true, evidence: 'ok', by_stage: 'test-verifier',
    })).toThrow();
  });
  it('AUDIT_BODY accepts approved with null reason', () => {
    expect(() => AUDIT_BODY.parse({
      gate: 'architect', outcome: 'approved', reason: null,
      proposed_content: 'use Redis', posing_agent: 'solution-architect',
    })).not.toThrow();
  });
});

describe('bodySchemaFor', () => {
  it('returns the right schema per collection name', () => {
    expect(bodySchemaFor('decisions')).toBe(DECISION_BODY);
    expect(bodySchemaFor('bugs')).toBe(BUG_BODY);
    expect(bodySchemaFor('scratch')).toBe(SCRATCH_BODY);
    expect(bodySchemaFor('audit')).toBe(AUDIT_BODY);
    expect(bodySchemaFor('verifications')).toBe(VERIFICATION_BODY);
  });
  it('throws on unknown collection', () => {
    expect(() => bodySchemaFor('unknown' as any)).toThrow(/unknown collection/i);
  });
});

describe('COLLECTION_NAMES', () => {
  it('matches the spec', () => {
    expect(COLLECTION_NAMES).toEqual(['decisions', 'bugs', 'scratch', 'audit', 'verifications']);
  });
});
