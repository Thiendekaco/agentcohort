---
description: Investigate a bug or risk with evidence and root cause. NO FIXING. Ends with a recommendation for human approval.
argument-hint: <bug report, error, or area to audit>
---

# /bug-audit — Hunt → Evidence → Root Cause → Council (NO FIX)

Orchestrate the bug audit for `$ARGUMENTS`. **This flow does not change any
product code.** Its only deliverable is a decision-ready report.

## Pipeline

1. **bug-hunter** — sweep for confirmed and latent defects with evidence.
2. **root-cause-analyst** — for the significant findings: symptom → direct
   cause → root cause → systemic cause; severity; impact; correction options.
3. **reproduction-engineer** — make the primary bug deterministic; capture a
   failing test/script (test scaffolding only — no product-code changes).
4. **expert-council** — review the diagnosis; produce solution options with
   trade-offs; recommend one; define the human approval being requested.

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
