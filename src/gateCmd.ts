import { runMemoryWrite, MemoryWriteResult } from './memoryCmd';

export interface GateRecordOptions {
  cwd: string;
  runId: string;
  gate: 'architect' | 'plan' | 'bottleneck' | 'root-cause' | 'expert-council';
  outcome: 'approved' | 'rejected' | 'escalated' | 'auto-skipped';
  proposedContent: string;
  posingAgent: string;
  reason?: string;
}

export type GateRecordDisposition =
  | 'written'
  | 'rejected-missing-reason'
  | MemoryWriteResult['disposition'];

export interface GateRecordResult {
  disposition: GateRecordDisposition;
  errorMessage?: string;
}

export function runGateRecord(opts: GateRecordOptions): GateRecordResult {
  if ((opts.outcome === 'rejected' || opts.outcome === 'escalated') && !opts.reason) {
    return {
      disposition: 'rejected-missing-reason',
      errorMessage: `--reason is required when outcome is '${opts.outcome}'`,
    };
  }
  const body = {
    gate: opts.gate,
    outcome: opts.outcome,
    reason: opts.reason ?? null,
    proposed_content: opts.proposedContent,
    posing_agent: opts.posingAgent,
  };
  const w = runMemoryWrite({
    cwd: opts.cwd,
    collection: 'audit',
    bodyJson: JSON.stringify(body),
    source: 'dispatcher',
    confidence: 1.0,
    verified: true,
    taskSummary: `gate:${opts.gate} ${opts.outcome}`,
    runId: opts.runId,
    files: [],
  });
  if (w.disposition !== 'written') {
    return { disposition: w.disposition, errorMessage: w.errorMessage };
  }
  return { disposition: 'written' };
}
