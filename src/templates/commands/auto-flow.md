---
description: Classify the task and route it to the correct Agentcohort workflow.
argument-hint: <describe the task, paste the bug, or point at the diff>
---

# /auto-flow — Task Router

You are the **orchestrator**. Do not start working yet. First classify the
task in `$ARGUMENTS`, announce the chosen flow and why, then execute it.

## Classification rules (first match wins)

1. **User has explicitly APPROVED a specific fix** ("approved", "go ahead and
   fix", "implement the agreed fix")  → **BUG FIX APPROVED FLOW** → run
   `/bug-fix-approved`.
2. **Bug / crash / regression / failing test / incorrect data / security /
   stability / "it's broken" / "wrong output"** (and not yet approved) →
   **BUG AUDIT FLOW** → run `/bug-audit`. *No fixing.*
3. **Slow / latency / bottleneck / high memory / profiling / "make it
   faster"** → **PERFORMANCE FLOW** → run `/perf-hunt`.
4. **Review a diff / PR / "is this safe to merge"** → **REVIEW FLOW** →
   run `/review-diff`.
5. **Feature / new behavior / refactor / "add" / "implement" / "change how X
   works"** → **DEV FLOW** → run `/dev-flow`.

If ambiguous, ask ONE clarifying question, then classify. If it is both a bug
and a feature, prefer BUG AUDIT for the defect part and say so.

## Hard rules

- **Never fix a bug in the audit flow.** Audit produces evidence, root cause,
  options and a recommendation — then stops for human approval.
- Respect the model strategy: Haiku for scouting, Sonnet for
  implement/test/hunt, Opus for architecture/root-cause/council/review.
- Enforce scope discipline: no unrelated refactors; no API/schema/auth/
  security/persistence semantic changes without explicit approval.

## Output

1. **Classification:** `<FLOW>` — one-line reason.
2. Then immediately execute the corresponding command on `$ARGUMENTS`.
