---
description: Smart router — dispatcher classifies the task into a tier, prints a plan, and executes only after explicit user approval.
argument-hint: <describe the task, paste the bug, or point at the diff>
---

# /auto-flow — Dispatcher-driven router

You are the **orchestrator**. Do **not** start the downstream pipeline
yet. First classify, then surface the plan, then wait for the user.

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

Print the dispatcher's plan to the user verbatim, plus a single
question line:

```
Proceed with this plan?  [y / escalate / abort / question / gates ±<name>]
```

- `y` → run the next step exactly as planned.
- `escalate` → move up one tier (e.g. Tier 2b → Tier 3 `/dev-flow`,
  Tier 3 → Tier 4 with forced architect + expert-council) and re-print
  the new plan.
- `abort` → stop. Do nothing else.
- `question` → answer the user's question; do not execute the plan
  until you re-confirm.
- `gates +architect`, `gates -plan`, etc. → override a single gate
  for THIS task only (does not modify `.agentcohort.json`). Re-print
  the plan with the new `Approval gates:` line, then re-ask for `y`.
  Valid gate names: `architect`, `plan`, `root-cause`, `expert-council`.

## Step 3 — Execute the chosen next step

Only after the user replies `y`:

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

- **Never run downstream agents before the user replies `y`.** Silent
  routing destroys the value of having a plan.
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
