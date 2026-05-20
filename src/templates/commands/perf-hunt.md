---
description: Performance pipeline — measure/evidence, bottleneck, safe optimization, verify, perf review.
argument-hint: <what is slow + the workload/metric if known>
---

# /perf-hunt — Measure → Bottleneck → Safe Optimize → Verify → Review

Orchestrate the performance workflow for `$ARGUMENTS`. **Evidence before
changes. No blind optimization.**

## Pipeline

1. **performance-hunter** — define "slow" (metric, workload, target), gather
   measurements, rank bottlenecks, separate measured from hypothesized.
2. **🚦 HUMAN GATE — bottleneck**. Read `.agentcohort.json` for
   `gates.bottleneck` (default `auto`). If `on`, OR `auto` AND the
   dispatcher classified this as Tier 4 / has an escalation keyword
   (cache, concurrency, race condition, transaction, …), STOP and
   surface the ranked bottleneck list for user confirmation BEFORE
   architect/optimizer cost is committed. Wait for:
   - `y` → continue to step 3 with the top-ranked bottleneck as target.
   - `revise <feedback>` → re-run performance-hunter with the feedback
     (e.g. "ignore the render path, focus on the DB query").
   - `abort` → stop the pipeline.
   If `off`, skip this gate and continue immediately.
3. **solution-architect** — *only if* the likely fix affects caching, data
   flow, or architecture. Decide the boundary-safe approach. Otherwise skip
   and say why.
4. **🚦 HUMAN GATE — architect** (only if step 3 ran). Read
   `.agentcohort.json` for `gates.architect` (default `on`). If `on`, OR
   `auto` AND the dispatcher classified this as Tier 4 / arch-sensitive,
   STOP and surface the architect's decision (chosen approach + caching/
   invalidation plan + risks) for user review. Wait for:
   - `y` → continue to step 5.
   - `revise <feedback>` → re-run architect with the feedback.
   - `abort` → stop the pipeline.
   If `off`, skip this gate and continue immediately.
5. **perf-optimizer** — apply the smallest reversible, evidence-backed change;
   measure before/after under the same workload; preserve behavior.
6. **test-verifier** — run tests/typecheck/lint; confirm behavior unchanged;
   report real output.
7. **perf-reviewer** — verify the gain is real and representative, behavior is
   preserved, any cache has sound invalidation, and assess new regression
   risk. Verdict required.

## Rules

- No optimization without a **measured** bottleneck behind it.
- **No behavior/output change.** Same inputs → same results.
- **No caching/memoization without an explicit, correct invalidation
  strategy** and a stated staleness bound.
- One optimization per change; keep it reversible.
- If the gain is marginal or risk outweighs it, stop and report — do not ship
  a risky micro-win.
- If `perf-reviewer` BLOCKs, summarize and recommend `/fix-blockers`.

## Output

Stage summary including before/after numbers, behavior-preserved evidence, and
the reviewer's APPROVE/BLOCK verdict.
