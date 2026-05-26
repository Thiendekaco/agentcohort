import { describe, it, expect } from 'vitest';
import { RUN_INDEX_EVENT } from '../src/runIndexSchema';

const baseTs = '2026-05-26T10:00:00.000Z';
const runId = '00000000-0000-4000-8000-000000000001';

describe('RUN_INDEX_EVENT', () => {
  it('accepts start event', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'start', run_id: runId, ts: baseTs, pipeline: 'dev-flow', tier: 3,
    })).not.toThrow();
  });
  it('accepts end event', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'end', run_id: runId, ts: baseTs, outcome: 'success',
      agents_run: ['repo-scout', 'final-reviewer'], gates_fired: ['architect'],
    })).not.toThrow();
  });
  it('accepts stage_start event', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'stage_start', run_id: runId, ts: baseTs, stage: 'repo-scout',
    })).not.toThrow();
  });
  it('accepts stage_end event', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'stage_end', run_id: runId, ts: baseTs, stage: 'repo-scout', outcome: 'success',
    })).not.toThrow();
  });
  it('rejects unknown event type', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'made-up', run_id: runId, ts: baseTs,
    })).toThrow();
  });
  it('rejects stage_start without stage field', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'stage_start', run_id: runId, ts: baseTs,
    })).toThrow();
  });
  it('rejects end with invalid outcome', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'end', run_id: runId, ts: baseTs, outcome: 'maybe',
    })).toThrow();
  });
  it('rejects malformed run_id', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'start', run_id: 'not-uuid', ts: baseTs, pipeline: 'p',
    })).toThrow();
  });
  it('accepts start without optional tier/task_summary', () => {
    expect(() => RUN_INDEX_EVENT.parse({
      event: 'start', run_id: runId, ts: baseTs, pipeline: 'p',
    })).not.toThrow();
  });
});
