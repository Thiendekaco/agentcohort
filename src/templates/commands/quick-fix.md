---
description: Tier 2a — small bug fix where the root cause is already known. Skips audit; keeps regression test + review.
argument-hint: <the bug + the known root cause + the fix to apply>
---

# /quick-fix — Fix → Regression → Verify → Review (no audit)

Use this **only** when the root cause is already established and the
fix is small (typically 1–2 files, ≤ a few lines). It is a shorter
sibling of `/bug-fix-approved` for changes where a full audit and an
explicit human approval gate are overkill.

If you are *investigating* a bug, do **not** use this — use `/bug-audit`.

## Pre-flight

`$ARGUMENTS` must contain:
1. the bug (symptom),
2. the stated root cause,
3. the proposed fix.

If any of the three is missing, **stop and ask**. If the dispatcher
escalated this task (any keyword from auth, schema, migration, payment,
security, concurrency, cache, …), route to `/bug-fix-approved` instead.

## Pipeline

1. **bug-fixer** — apply the stated fix at the **root cause**; minimal
   and reversible; strictly within the stated scope.
2. **regression-guard** — add a regression test that fails on the old
   behavior and passes on the fixed behavior. **Mandatory.**
3. **test-verifier** — run tests, typecheck, lint; fix only breakages
   caused by this change; report real output.
4. **final-reviewer** — review the actual diff: correctness, regression,
   scope creep, security, missing tests. Verdict required.

## Rules

- **No skipping regression-guard or final-reviewer.** Both are cheap
  insurance against re-emergence; both are non-negotiable even at this
  tier.
- **Only the stated bug.** Other findings are reported, not fixed.
- **No symptom-only patch.** If the stated "root cause" turns out to be
  a symptom, **stop** and route to `/bug-audit`.
- **No unapproved API/schema/auth/security/persistence change.** If the
  fix needs one, abort and escalate to `/bug-audit`.
- If `final-reviewer` returns BLOCK, recommend `/fix-blockers` — do not
  auto-loop.

## Output

Stage summary + failing→passing regression evidence + reviewer verdict
+ a one-line confirmation that no out-of-scope changes were made.
