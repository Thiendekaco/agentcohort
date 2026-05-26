---
description: Smart router — dispatcher classifies the task into a tier, prints a plan, and executes only after explicit user approval.
argument-hint: <describe the task, paste the bug, or point at the diff>
---

# /auto-flow — Dispatcher-driven router

You are the **orchestrator**. Do **not** start the downstream pipeline
yet. First classify, then surface the plan, then wait for the user.

## Memory layer (agentcohort v0.10+)

The `dispatcher` subagent (invoked first below) is responsible for calling `agentcohort run start --pipeline=<chosen>` after it classifies the task. It captures the printed UUID and includes `Run ID: <uuid>` in every downstream handoff.

## Step 1 — Classify (cheap, mandatory)

Invoke the `dispatcher` subagent on `$ARGUMENTS`. The dispatcher
returns a structured plan with: tier, pipeline, agents involved,
agents skipped, escalation triggers, cost band, and the exact next
command to run.

If the dispatcher escalates the tier above the user's intuitive
expectation, **trust the dispatcher** — escalation keywords (auth,
schema, migration, payment, security, concurrency, cache, …) are
non-negotiable.

## Step 2 — Surface the plan

Print the dispatcher's short recommendation block (`Recommended` /
`Cost` / `Why` / optional `Escalation`) verbatim — do not expand the
agent roster, do not re-introduce the old `Classification / Pipeline /
Agents / Skipping / Next step` lines.

Then use the **`AskUserQuestion`** tool to surface the approval gate:

- `question`: `"<recommended slash command> — proceed?"` (interpolate
  the dispatcher's `Recommended:` value, e.g. `"/dev-flow — proceed?"`)
- `header`: `"Routing"`
- `options`:
  - `Run recommended` — Run the dispatcher's recommended next step.
  - `Pick a different flow` — Show the full list of flows.

Map the answer:

- **`Run recommended`** → execute the next step (Step 3 table).
- **`Pick a different flow`** → print the text flow list below, then
  wait for the user's letter.
- **`Other` (free-form)** → parse the text:
  - `abort` → stop. Do nothing else.
  - `gates ±<name>` (e.g. `gates +architect`, `gates -plan`) → override
    a single gate for THIS task only (does not modify
    `.agentcohort.json`). Update the `Gates:` line and re-issue the
    `AskUserQuestion`. Valid gate names: `architect`, `plan`,
    `bottleneck`, `root-cause`, `expert-council`.
  - Anything else → treat as a clarifying question; answer it, then
    re-issue the `AskUserQuestion`. Never silently run.

**Fallback** when `AskUserQuestion` is unavailable (older Claude Code,
headless / scripted runs): print a numbered text panel and accept
`1` / `y` / Enter as "Run recommended", `2` as "Pick a different
flow", `abort` to stop, `gates ±<name>` to override.

### Flow list (only print when user picks "Pick a different flow")

The full list contains 9 items, which exceeds `AskUserQuestion`'s
4-option limit — surface it as a text menu instead:

```
Pick a flow:
  a) /quick-fix          — known root cause, 1–2 line fix
  b) /quick-feature      — small feature, 1–3 files, no API/schema/auth
  c) /dev-flow           — feature / refactor / normal change
  d) /bug-audit          — investigate unknown bug (audit only, no fix)
  e) /bug-fix-approved   — apply a previously approved fix
  f) /perf-hunt          — slowness / bottleneck investigation
  g) /review-diff        — review pending changes
  h) /fix-blockers       — address reviewer blockers
  i) /repo-scout         — read-only walkthrough

Reply with the letter (e.g. c), or `back` to return to the recommendation.
```

If the user picks a letter, run that command on `$ARGUMENTS` immediately
— their explicit choice IS the approval; do not re-prompt. If they pick
`back`, re-issue the recommendation `AskUserQuestion`.

## Step 3 — Execute the chosen next step

Only after the user replies `1` / `y` / Enter (or picks a letter from
Step 2's flow list):

| Tier | Action |
|---|---|
| **0** | Answer inline using Read / Glob / Grep. No subagent. |
| **1** | Invoke `repo-scout` on `$ARGUMENTS`. Return the briefing. Stop. |
| **2a — quick-fix** | Run `/quick-fix` on `$ARGUMENTS`. |
| **2b — quick-feature** | Run `/quick-feature` on `$ARGUMENTS`. |
| **3 — dev** | Run `/dev-flow` on `$ARGUMENTS`. |
| **3 — bug audit** | Run `/bug-audit` on `$ARGUMENTS`. (No fixing — invariant.) |
| **3 — perf** | Run `/perf-hunt` on `$ARGUMENTS`. |
| **3 — review** | Run `/review-diff`. |
| **3 — bug fix approved** | Run `/bug-fix-approved` on `$ARGUMENTS`. |
| **4 — escalated** | Run `/dev-flow` (or `/bug-audit`/`/perf-hunt`) and **force** the architect stage + expert-council stage on. |

## Hard rules

- **Never run downstream agents before the user replies `1` / `y` / Enter,
  or explicitly picks a letter from the flow list.** Silent routing
  destroys the value of having a plan.
- **Bug audit never fixes.** Invariant from `/bug-audit`. The
  dispatcher cannot route a Tier 4 bug into a fix path.
- **Reviewer is never skipped** for any code change, regardless of
  tier. The mini-commands `/quick-fix` and `/quick-feature` already
  enforce this.
- **Regression-guard is never skipped** for any bug fix.
- Respect the model strategy: cheap for scouting/dispatcher, mid for
  implement/test/hunt, premium for architecture/root-cause/council/review.
- Enforce scope discipline: no unrelated refactors; no API / schema /
  auth / security / persistence semantic changes without explicit
  approval (Tier 4 + architect verdict).

## Notes for users skipping the plan

If your project's CLAUDE.md says "skip dispatcher for trivial questions"
or similar, honour it — but only for Tier 0 questions. Anything that
might touch code goes through the dispatcher first.

## Pipeline end

The last agent of the chosen pipeline calls `agentcohort run end --run-id=$RUN_ID --outcome=success --agents-run=<csv of agents that actually ran> [--gates-fired=<csv of gates that fired>]`. See each pipeline's own template for which agent that is.

If the pipeline aborted at a gate, the gate-record step already called `run end --outcome=aborted` — do NOT call it again.
