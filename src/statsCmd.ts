import { join } from 'node:path';
import { readJsonl } from './memoryIo';
import { NAIVE_FULL_PIPELINE, estimateCostForAgents } from './statsTable';

export interface StatsOptions {
  cwd: string;
  since?: string;
  compareNaive?: boolean;
}

export interface PipelineStats {
  count: number;
  outcomes: Record<'success' | 'aborted' | 'failed', number>;
  durationsMs: number[];
}

export interface StatsResult {
  totalRuns: number;
  perPipeline: Record<string, PipelineStats>;
  perOutcome: Record<'success' | 'aborted' | 'failed' | 'running', number>;
  estimatedCostUsd: number;
  naiveEstimatedCostUsd?: number;
  savingsPct?: number;
  durationMedianMs: number | null;
  durationP95Ms: number | null;
  gateFires: Record<string, number>;
}

function parseDur(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`bad duration: ${s}`);
  return Number(m[1]) * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's'|'m'|'h'|'d']);
}

export function runStats(opts: StatsOptions): StatsResult {
  const indexPath = join(opts.cwd, '.agentcohort', 'runs', 'INDEX.jsonl');
  const events = readJsonl<any>(indexPath);
  const cutoffTs = opts.since ? Date.now() - parseDur(opts.since) : 0;

  const byRun = new Map<string, { start?: any; end?: any }>();
  for (const e of events) {
    if (e.event !== 'start' && e.event !== 'end') continue;
    const slot = byRun.get(e.run_id) ?? {};
    if (e.event === 'start') slot.start = e;
    else slot.end = e;
    byRun.set(e.run_id, slot);
  }

  const perPipeline: Record<string, PipelineStats> = {};
  const perOutcome: Record<'success' | 'aborted' | 'failed' | 'running', number> =
    { success: 0, aborted: 0, failed: 0, running: 0 };
  const allDurations: number[] = [];
  const gateFires: Record<string, number> = {};
  let totalRuns = 0;
  let estimatedCostUsd = 0;
  let naiveEstimatedCostUsd = 0;

  for (const [, { start, end }] of byRun) {
    if (!start) continue;
    if (new Date(start.ts).getTime() < cutoffTs) continue;
    totalRuns += 1;

    const outcome = end?.outcome ?? 'running';
    perOutcome[outcome as keyof typeof perOutcome] += 1;

    const ps = perPipeline[start.pipeline] ??
      { count: 0, outcomes: { success: 0, aborted: 0, failed: 0 }, durationsMs: [] };
    ps.count += 1;
    if (end) {
      const d = new Date(end.ts).getTime() - new Date(start.ts).getTime();
      ps.durationsMs.push(d);
      allDurations.push(d);
      if (outcome === 'success' || outcome === 'aborted' || outcome === 'failed') {
        ps.outcomes[outcome as 'success' | 'aborted' | 'failed'] += 1;
      }
    }
    perPipeline[start.pipeline] = ps;

    if (end?.agents_run) estimatedCostUsd += estimateCostForAgents(end.agents_run);
    if (end?.gates_fired) for (const g of end.gates_fired) gateFires[g] = (gateFires[g] ?? 0) + 1;

    if (opts.compareNaive) {
      naiveEstimatedCostUsd += estimateCostForAgents(NAIVE_FULL_PIPELINE);
    }
  }

  allDurations.sort((a, b) => a - b);
  const durationMedianMs: number | null = allDurations.length ? allDurations[Math.floor(allDurations.length / 2)] ?? null : null;
  const durationP95Ms: number | null = allDurations.length ? allDurations[Math.floor(allDurations.length * 0.95)] ?? null : null;

  const result: StatsResult = {
    totalRuns, perPipeline, perOutcome,
    estimatedCostUsd, durationMedianMs, durationP95Ms, gateFires,
  };
  if (opts.compareNaive) {
    result.naiveEstimatedCostUsd = naiveEstimatedCostUsd;
    result.savingsPct = naiveEstimatedCostUsd > 0
      ? Math.max(0, (1 - estimatedCostUsd / naiveEstimatedCostUsd) * 100)
      : 0;
  }
  return result;
}
