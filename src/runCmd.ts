import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { appendJsonl } from './memoryIo';

export interface RunStartOptions {
  cwd: string;
  pipeline: string;
  tier?: number;
  taskSummary?: string;
}

export interface RunStartResult { runId: string; }

export function runRunStart(opts: RunStartOptions): RunStartResult {
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
  agentsRun?: string[];
  gatesFired?: string[];
}

export function runRunEnd(opts: RunEndOptions): void {
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
