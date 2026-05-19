---
description: Fix ONLY the listed blockers, then verify. No unrelated changes.
argument-hint: <paste the blocker list from a review>
---

# /fix-blockers — Targeted Blocker Resolution

Resolve **only** the specific blockers listed in `$ARGUMENTS` (typically the
BLOCKER/HIGH findings from `/review-diff`, `/dev-flow`, or `/perf-hunt`).

## Pre-flight

Restate each blocker as a discrete, checkable item. If the list is vague or
empty, **stop and ask** for the explicit blockers — do not infer scope.

## Pipeline

1. **feature-implementer** — fix each listed blocker with the minimal change.
   One blocker at a time; do not touch anything not on the list.
2. **test-verifier** — run tests/typecheck/lint; add/adjust focused tests for
   the fixed blockers; report real output.

## Rules

- **Only the listed blockers.** No refactors, no renames, no reformatting, no
  "while I'm here" fixes, no unrelated code.
- No API/schema/auth/security/persistence semantic change unless that change
  *was itself the blocker* and is explicitly approved.
- New issues discovered while fixing → reported, not fixed (route to
  `/bug-audit`).
- Each blocker must end with evidence it is resolved.

## Output

Per-blocker: what changed (`path:line`), the verification command, and its
real result. Then recommend re-running `/review-diff` to confirm clearance.
