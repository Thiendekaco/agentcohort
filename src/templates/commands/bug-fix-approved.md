---
description: Implement an APPROVED bug fix — fix at root cause, add regression test, verify, review. Approved scope only.
argument-hint: <the approved bug + the approved fix option>
---

# /bug-fix-approved — Fix → Regression → Verify → Review

Use this **only after a human has approved a specific fix** (normally the
recommended option from `/bug-audit`). The approved issue and approved
approach must be stated in `$ARGUMENTS`.

## Memory layer (agentcohort v0.10+)

1. Before invoking the first subagent, run:

   `RUN_ID=$(agentcohort run start --pipeline=bug-fix-approved --tier=3 --task-summary="<one-line summary of $ARGUMENTS>")`

2. Include `Run ID: $RUN_ID` in EVERY subagent invocation prompt below. Subagents use this UUID to read/write the run scratchpad and tag every memory write.

## Pre-flight

If `$ARGUMENTS` does not clearly contain (a) the specific approved issue and
(b) the approved fix approach, **stop and ask** with a concise approval summary
that restates the missing approved scope, what fix Claude would apply if
clarified, and that no code will change until the approved issue and approved
approach are explicit. Do not guess. Do not fix anything that was not explicitly
approved.

## Pipeline

1. **bug-fixer** — implement the approved fix at the **root cause**, minimal
   and reversible; scope strictly limited to the approved issue.
2. **regression-guard** — ensure a regression test exists that fails on the
   old behavior and passes on the fixed behavior.
3. **test-verifier** — run tests, typecheck, lint; fix only breakages caused
   by this change; report real output.
4. **final-reviewer** — review the actual diff: correctness, regression,
   scope creep, security, data consistency, tests. Verdict required.

## Rules

- **Only the approved issue.** Other bugs noticed → reported, not fixed
  (route them to a new `/bug-audit`).
- No symptom-only patch unless explicitly approved as a labelled stopgap.
- No scope creep, no unrelated refactors, no unapproved API/schema/auth/
  security/persistence semantic change.
- A regression test is required if at all practical; if not practical, the
  reviewer must explicitly accept that.
- If the fixer finds the root-cause analysis was wrong, **stop** and route
  back to `/bug-audit` — do not improvise.

## Output

Stage summary + failing→passing regression evidence + reviewer verdict +
explicit confirmation that only the approved scope changed.

## Pipeline end

The **final-reviewer** (designated last agent for this pipeline) must call:

`agentcohort run end --run-id=$RUN_ID --outcome=success --agents-run=<csv of agents that actually ran> [--gates-fired=<csv of gates that fired>]`

If the pipeline aborted at a gate, the gate-record step already called `run end --outcome=aborted` — do NOT call it again.
