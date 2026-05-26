---
description: Run the final reviewer on the current diff/PR. Read-only verdict.
argument-hint: [base ref or PR — defaults to the current branch diff]
---

# /review-diff — Final Reviewer Only

Run the **final-reviewer** subagent on the current change.

## Memory layer (agentcohort v0.10+)

1. Before invoking the first subagent, run:

   `RUN_ID=$(agentcohort run start --pipeline=review-diff --tier=1 --task-summary="<one-line summary of $ARGUMENTS>")`

2. Include `Run ID: $RUN_ID` in EVERY subagent invocation prompt below. Subagents use this UUID to read/write the run scratchpad and tag every memory write.

## What to review

- If `$ARGUMENTS` names a base ref or PR, diff against that.
- Otherwise review the working diff against the repository's base branch
  (e.g. `git diff` / `git diff <base>...HEAD`).

## Mandate (read-only)

The reviewer must judge, with `path:line` evidence and explicit severity
(BLOCKER / HIGH / MEDIUM / NIT):

- **Correctness** — incl. edge/error paths and concurrency.
- **Regression risk** — what existing behavior could break.
- **Scope creep** — anything changed the task did not authorize.
- **Security** — input trust, authz, injection, secrets.
- **Data consistency** — partial writes, transactions, invariants.
- **Tests** — is the changed risky behavior actually covered.

## Rules

- **No edits.** This command produces a verdict only.
- Unauthorized API/schema/auth/security/persistence semantic change is at
  least HIGH, default BLOCKER.
- Missing test for changed risky behavior is a BLOCKER.
- No rubber-stamp, no nitpick-only review.

## Output

`APPROVE` or `BLOCK`, the findings list, and exactly what must change before
it can land. If BLOCK, recommend `/fix-blockers` with the blocker list.

## Pipeline end

The **final-reviewer** (designated last agent for this pipeline) must call:

`agentcohort run end --run-id=$RUN_ID --outcome=success --agents-run=<csv of agents that actually ran> [--gates-fired=<csv of gates that fired>]`

If the pipeline aborted at a gate, the gate-record step already called `run end --outcome=aborted` — do NOT call it again.
