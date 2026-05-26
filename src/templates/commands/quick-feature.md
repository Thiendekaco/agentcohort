---
description: Tier 2b — small, local feature in 1–3 files with no API / schema / auth surface. Skips architect and planner; keeps review.
argument-hint: <the small, local feature to add>
---

# /quick-feature — Scout → Implement → Test → Review (no architect, no planner)

Use this when the change is small and **clearly local**: a single
component, a single utility, a small UI addition, a copy change with
logic, etc. It is the shorter sibling of `/dev-flow` for tasks that do
not deserve a full architect + planner stage.

If the change is **anywhere near** API contract, data model, auth,
schema, migrations, payment, security, concurrency, caching, or any
other cross-cutting concern, do **not** use this — use `/dev-flow`.

## Memory layer (agentcohort v0.10+)

1. Before invoking the first subagent, run:

   `RUN_ID=$(agentcohort run start --pipeline=quick-feature --tier=2 --task-summary="<one-line summary of $ARGUMENTS>")`

2. Include `Run ID: $RUN_ID` in EVERY subagent invocation prompt below. Subagents use this UUID to read/write the run scratchpad and tag every memory write.

## Pre-flight

If `$ARGUMENTS` is vague about scope, **stop and ask** for:
- the user-visible behavior change,
- the file(s) you expect to touch (or the surface area you expect).

If the surface obviously exceeds 3 files, abort and route to `/dev-flow`.

## Pipeline

1. **repo-scout** — locate the exact files, confirm scope is local,
   produce a compact briefing. If scope turns out to be larger than
   expected, **stop** and recommend `/dev-flow`.
2. **feature-implementer** — implement the change with the smallest
   correct edit; add focused tests; targeted verification; no scope
   creep.
3. **test-verifier** — run tests, typecheck, lint; fix only breakages
   caused by this change; report real output.
4. **final-reviewer** — review the actual diff: correctness, regression,
   scope creep, security, data consistency, missing tests. Verdict
   required.

## Rules

- **No scope creep.** Anything found outside the stated change is
  reported, not done.
- **No architect, no expert-council** at this tier — that is precisely
  what `/dev-flow` is for.
- **Reviewer is mandatory.** This is the only catch for what the
  skipped stages would have caught.
- **No API / schema / auth / security / persistence semantic change.**
  If any of those would be touched, abort and switch to `/dev-flow`.
- If `final-reviewer` returns BLOCK, recommend `/fix-blockers` — do not
  auto-loop.

## Output

Stage-by-stage summary + reviewer's APPROVE/BLOCK verdict + the
concrete next step.

## Pipeline end

The **final-reviewer** (designated last agent for this pipeline) must call:

`agentcohort run end --run-id=$RUN_ID --outcome=success --agents-run=<csv of agents that actually ran> [--gates-fired=<csv of gates that fired>]`

If the pipeline aborted at a gate, the gate-record step already called `run end --outcome=aborted` — do NOT call it again.
