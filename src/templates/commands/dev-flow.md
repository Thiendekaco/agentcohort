---
description: Feature / refactor pipeline — scout, architect (if needed), plan, implement, test, review.
argument-hint: <feature or refactor to build>
---

# /dev-flow — Explore → Architect → Plan → Implement → Test → Review

Orchestrate the following subagents **in order** for the task in
`$ARGUMENTS`. Pass each agent's output forward as context. Stop and report if
any stage raises a blocker.

## Pipeline

1. **repo-scout** — locate files, trace current flow, identify change points.
2. **solution-architect** — *only if the task is architecture-sensitive*
   (touches module boundaries, public API, data model/schema, auth,
   concurrency, caching, or cross-cutting behavior). Otherwise skip and say
   why it was skipped.
3. **🚦 HUMAN GATE — architect** (only if step 2 ran). Read
   `.agentcohort.json` for `gates.architect` (default `on`). If `on`, OR
   `auto` AND the dispatcher classified this as Tier 4 / arch-sensitive,
   STOP and surface the architect's decision (chosen approach + key
   trade-offs + risks). Then use the **`AskUserQuestion`** tool with:
   - `question`: `"Architect verdict — proceed with this approach?"`
   - `header`: `"Architect gate"`
   - `options`:
     - `Approve` — Continue to the planner with this architecture.
     - `Revise` — I'll provide feedback; re-run the architect.
     - `Abort` — Stop the pipeline.
   On `Approve` continue to step 4. On `Revise` ask the user for the
   feedback as a free-form follow-up, then re-run solution-architect
   with it. On `Abort` stop. If the orchestrator environment lacks
   `AskUserQuestion`, fall back to a numbered text menu and accept
   `1`/`y`/Enter as Approve, `revise <feedback>` as Revise, `abort`
   as Abort. If `gates.architect` is `off`, skip this gate entirely.
4. **feature-planner** — produce the bite-sized, test-first implementation
   checklist with exact files and verification.
5. **🚦 HUMAN GATE — plan**. Read `.agentcohort.json` for `gates.plan`
   (default `on`). If `on`, OR `auto` AND Tier ≥ 4, STOP and surface the
   plan (files to touch, tests to add, verification commands). Then
   use **`AskUserQuestion`** with:
   - `question`: `"Plan ready — proceed with implementation?"`
   - `header`: `"Plan gate"`
   - `options`:
     - `Approve` — Implement exactly this plan.
     - `Revise` — I'll provide feedback; re-run the planner.
     - `Abort` — Stop the pipeline.
   Same fallback contract as the architect gate
   (`1`/`y`/Enter / `revise <feedback>` / `abort`).
6. **feature-implementer** — execute the plan; minimal change; focused tests;
   targeted verification; no scope creep.
7. **test-verifier** — add/run tests, typecheck, lint; fix only breakages
   caused by this change; report real output.
8. **final-reviewer** — review the actual diff: correctness, regression,
   scope creep, security, data consistency, missing tests. Verdict required.

## Rules

- The architect decision (if invoked) is binding on the planner and
  implementer. Implementer must not re-architect.
- No API / schema / auth / security / persistence semantic change unless the
  architect explicitly decided it and the user approved it.
- Prefer the minimal safe change. Unrelated improvements are reported, not done.
- If `final-reviewer` returns BLOCK, summarize the blockers and recommend
  `/fix-blockers` — do not auto-loop silently.

## Output

A stage-by-stage summary, ending with the reviewer's APPROVE/BLOCK verdict and
the concrete next step.
