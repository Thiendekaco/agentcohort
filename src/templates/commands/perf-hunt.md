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
   surface the ranked bottleneck list BEFORE architect/optimizer cost
   is committed.

   ### Approval summary — bottleneck
   **You are approving:** which measured bottleneck Claude should target before optimization work starts.
   **Current conclusion:** `performance-hunter` has ranked the measured bottlenecks and identified the top candidate.
   **If approved, Claude will:**
   1. focus the rest of the workflow on the approved bottleneck
   2. invoke `solution-architect` only if the likely fix affects caching, data flow, or architecture
   3. optimize only after the target bottleneck is locked in
   **Not done yet:** no optimization has been applied yet.
   **Decision needed:** should Claude target the current top-ranked bottleneck?

   Then use **`AskUserQuestion`** with:
   - `question`: `"Bottleneck identified — target the top-ranked one?"`
   - `header`: `"Bottleneck gate"`
   - `options`:
     - `Approve` — Target the top-ranked bottleneck.
     - `Revise` — I'll narrow the focus (e.g. ignore one path).
     - `Abort` — Stop the pipeline.
   On `Approve` continue to step 3. On `Revise` collect feedback and
   re-run performance-hunter. On `Abort` stop. Fallback when
   `AskUserQuestion` is unavailable: numbered text menu accepting
   `1`/`y`/Enter / `revise <feedback>` / `abort`. If `off`, skip
   this gate.
3. **solution-architect** — *only if* the likely fix affects caching, data
   flow, or architecture. Decide the boundary-safe approach. Otherwise skip
   and say why.
4. **🚦 HUMAN GATE — architect** (only if step 3 ran). Read
   `.agentcohort.json` for `gates.architect` (default `on`). If `on`, OR
   `auto` AND the dispatcher classified this as Tier 4 / arch-sensitive,
   STOP and surface the architect's decision (chosen approach + caching/
   invalidation plan + risks).

   ### Approval summary — architect
   **You are approving:** the performance-oriented design before `perf-optimizer` changes internals while preserving behavior.
   **Current conclusion:** the architect has chosen the boundary-safe optimization approach, including any caching or invalidation plan.
   **If approved, Claude will:**
   1. hand this design to `perf-optimizer`
   2. measure before and after under the same workload
   3. send the result through verification and perf review
   **Not done yet:** no optimization has been applied yet; behavior must still remain unchanged.
   **Decision needed:** should Claude proceed with this performance approach?

   Then use **`AskUserQuestion`** with:
   - `question`: `"Architect verdict — proceed with this perf approach?"`
   - `header`: `"Architect gate"`
   - `options`:
     - `Approve` — Continue to perf-optimizer with this design.
     - `Revise` — I'll provide feedback; re-run the architect.
     - `Abort` — Stop the pipeline.
   Same fallback contract as the bottleneck gate
   (`1`/`y`/Enter / `revise <feedback>` / `abort`). If `off`, skip.
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
