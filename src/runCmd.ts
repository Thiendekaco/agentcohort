import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { appendJsonl } from './memoryIo';

export interface RunStartOptions {
  cwd: string;
  pipeline?: string;       // required when not --stage (v0.10.0 path)
  stage?: string;          // when set, emits stage_start instead of start
  runId?: string;          // required when --stage
  tier?: number;
  taskSummary?: string;
}

export interface RunStartResult { runId: string; }

export function runRunStart(opts: RunStartOptions): RunStartResult {
  if (opts.stage && opts.pipeline) {
    throw new Error('cannot pass both --stage and --pipeline');
  }
  if (opts.stage && !opts.runId) {
    throw new Error('--stage requires --run-id');
  }
  if (!opts.stage && !opts.pipeline) {
    throw new Error('--pipeline is required (or pass --stage with --run-id)');
  }

  if (opts.stage) {
    const event = {
      event: 'stage_start' as const,
      run_id: opts.runId!,
      ts: new Date().toISOString(),
      stage: opts.stage,
    };
    appendJsonl(indexPath(opts.cwd), event);
    return { runId: opts.runId! };
  }

  const runId = uuidv4();
  const event: Record<string, unknown> = {
    event: 'start',
    run_id: runId,
    ts: new Date().toISOString(),
    pipeline: opts.pipeline,
  };
  if (opts.tier !== undefined) event.tier = opts.tier;
  if (opts.taskSummary) event.task_summary = opts.taskSummary;
  appendJsonl(indexPath(opts.cwd), event);
  return { runId };
}

export interface RunEndOptions {
  cwd: string;
  runId: string;
  outcome: 'success' | 'aborted' | 'failed';
  stage?: string;
  agentsRun?: string[];
  gatesFired?: string[];
}

export function runRunEnd(opts: RunEndOptions): void {
  if (opts.stage) {
    const event = {
      event: 'stage_end' as const,
      run_id: opts.runId,
      ts: new Date().toISOString(),
      stage: opts.stage,
      outcome: opts.outcome,
    };
    appendJsonl(indexPath(opts.cwd), event);
    return;
  }

  const event: Record<string, unknown> = {
    event: 'end',
    run_id: opts.runId,
    ts: new Date().toISOString(),
    outcome: opts.outcome,
  };
  if (opts.agentsRun) event.agents_run = opts.agentsRun;
  if (opts.gatesFired) event.gates_fired = opts.gatesFired;
  appendJsonl(indexPath(opts.cwd), event);
}

function indexPath(cwd: string): string {
  return join(cwd, '.agentcohort', 'runs', 'INDEX.jsonl');
}
