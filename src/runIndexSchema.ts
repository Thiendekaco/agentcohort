import { z } from 'zod';

/**
 * Discriminated union for `.agentcohort/runs/INDEX.jsonl` event records.
 *
 * v0.10.0 shipped { start, end }. v0.10.1 adds { stage_start, stage_end }
 * to enable per-stage telemetry in `agentcohort stats`.
 *
 * Backward compatibility: existing v0.10.0 entries still parse.
 */

const RUN_OUTCOME = z.enum(['success', 'aborted', 'failed']);

export const RUN_INDEX_EVENT = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('start'),
    run_id: z.string().uuid(),
    ts: z.string().datetime(),
    pipeline: z.string(),
    tier: z.number().int().min(0).max(4).optional(),
    task_summary: z.string().max(200).optional(),
  }),
  z.object({
    event: z.literal('stage_start'),
    run_id: z.string().uuid(),
    ts: z.string().datetime(),
    stage: z.string().min(1),
  }),
  z.object({
    event: z.literal('stage_end'),
    run_id: z.string().uuid(),
    ts: z.string().datetime(),
    stage: z.string().min(1),
    outcome: RUN_OUTCOME,
  }),
  z.object({
    event: z.literal('end'),
    run_id: z.string().uuid(),
    ts: z.string().datetime(),
    outcome: RUN_OUTCOME,
    agents_run: z.array(z.string()).optional(),
    gates_fired: z.array(z.string()).optional(),
  }),
]);

export type RunIndexEvent = z.infer<typeof RUN_INDEX_EVENT>;
