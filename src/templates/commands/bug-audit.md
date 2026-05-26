---
description: Investigate a bug or risk with evidence and root cause. NO FIXING. Ends with a recommendation for human approval.
argument-hint: <bug report, error, or area to audit>
---

# /bug-audit — Hunt → Evidence → Root Cause → Council (NO FIX)

Orchestrate the bug audit for `$ARGUMENTS`. **This flow does not change any
product code.** Its only deliverable is a decision-ready report.

## Memory layer (agentcohort v0.10+)

1. Before invoking the first subagent, run:

   `RUN_ID=$(agentcohort run start --pipeline=bug-audit --tier=3 --task-summary="<one-line summary of $ARGUMENTS>")`

2. Include `Run ID: $RUN_ID` in EVERY subagent invocation prompt below. Subagents use this UUID to read/write the run scratchpad and tag every memory write.

## Pipeline

1. **bug-hunter** — sweep for confirmed and latent defects with evidence.
2. **root-cause-analyst** — for the significant findings: symptom → direct
   cause → root cause → systemic cause; severity; impact; correction options.
3. **🚦 HUMAN GATE — root-cause**. Read `.agentcohort.json` for
   `gates.root-cause` (default `on`). If `on`, OR `auto` AND Tier ≥ 4,
   STOP and surface the root cause analysis BEFORE building the
   reproduction. Present this summary block first:

   ### Approval summary — root-cause
   **You are approving:** whether the current diagnosis matches the evidence before reproduction work begins.
   **Current conclusion:** the root-cause analysis has connected the symptom, direct cause, root cause, and impact.
   **If approved, Claude will:**
   1. ask `reproduction-engineer` to make the bug deterministic
   2. preserve the diagnosis as the basis for the later solution review
   3. continue the audit without changing product code
   **Not done yet:** no fix has been attempted; no product code will change in this flow.
   **Decision needed:** does this root-cause verdict match the evidence well enough to continue?

   Then use **`AskUserQuestion`** with:
   - `question`: `"Root-cause verdict — does this match the evidence?"`
   - `header`: `"Root-cause gate"`
   - `options`:
     - `Approve` — Continue to reproduction-engineer.
     - `Revise` — I'll provide feedback; re-run root-cause-analyst.
     - `Abort` — Stop the audit.
   Fallback when `AskUserQuestion` is unavailable: numbered text menu
   accepting `1`/`y`/Enter / `revise <feedback>` / `abort`. If `off`,
   skip this gate.

   ### Gate: root-cause

   When the user responds (approve / revise / abort / escalate), record the outcome:

   `agentcohort gate record --run-id=$RUN_ID --gate=root-cause --outcome=<approved|rejected|escalated|auto-skipped> --proposed-content="<short summary of what was up for approval>" --posing-agent=root-cause-analyst [--reason="<user text — REQUIRED on reject/escalate>"]`

   If outcome is `rejected` or `aborted`, also call `agentcohort run end --run-id=$RUN_ID --outcome=aborted` and STOP the pipeline.

4. **reproduction-engineer** — make the primary bug deterministic; capture a
   failing test/script (test scaffolding only — no product-code changes).
5. **expert-council** — review the diagnosis; produce solution options with
   trade-offs; recommend one; define the human approval being requested.
6. **🚦 HUMAN GATE — expert-council** (always, non-negotiable). This is
   the existing bug-audit approval gate from v0.1.x. The flow ends here.
   Present this summary block near handoff:

   ### Approval summary — expert-council
   **You are approving:** which solution option should be allowed to move into `/bug-fix-approved`.
   **Current conclusion:** the council has compared the solution options, recommended one, and described the trade-offs.
   **If approved, Claude will:**
   1. stop this audit flow
   2. wait for you to invoke `/bug-fix-approved` with the approved option
   3. keep code unchanged until that separate command is run
   **Not done yet:** no code has been changed; `/bug-audit` never applies the fix.
   **Decision needed:** which solution option do you approve for the separate fix flow?

   No code changes occur in `/bug-audit` regardless of any gate config —
   only `/bug-fix-approved` invoked separately by the user can change code.

   ### Gate: expert-council

   When the user responds (approve / revise / abort / escalate), record the outcome:

   `agentcohort gate record --run-id=$RUN_ID --gate=expert-council --outcome=<approved|rejected|escalated|auto-skipped> --proposed-content="<short summary of what was up for approval>" --posing-agent=expert-council [--reason="<user text — REQUIRED on reject/escalate>"]`

   If outcome is `rejected` or `aborted`, also call `agentcohort run end --run-id=$RUN_ID --outcome=aborted` and STOP the pipeline.

## Iron rules

- **NEVER fix anything here.** No edits to product code. A reproduction test
  is allowed; a fix is not.
- No recommendation without a proven root cause (or an explicitly
  flagged-as-unproven causal link with how to confirm it).
- Bug audit must NOT silently progress to a fix. It ends at the human gate.

## Required report sections

```
- Bug / risk / issue
- Evidence
- Symptom
- Direct cause
- Root cause
- Systemic cause (if any)
- Severity: CRITICAL | HIGH | MEDIUM | LOW
- Affected files / modules
- Solution options (quick / robust / long-term)
- Recommended solution
- Trade-offs
- Validation / reproduction plan
- Regression test strategy
- Open risks / uncertainties
```

## Output ends with

> **Awaiting human approval.** To proceed, run `/bug-fix-approved` with the
> option you approve. No code will change until then.

## Pipeline end

The **expert-council** (designated last agent for this pipeline) must call:

`agentcohort run end --run-id=$RUN_ID --outcome=success --agents-run=<csv of agents that actually ran> [--gates-fired=<csv of gates that fired>]`

If the pipeline aborted at a gate, the gate-record step already called `run end --outcome=aborted` — do NOT call it again.
