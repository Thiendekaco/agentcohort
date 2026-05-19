---
description: Run the final reviewer on the current diff/PR. Read-only verdict.
argument-hint: [base ref or PR — defaults to the current branch diff]
---

# /review-diff — Final Reviewer Only

Run the **final-reviewer** subagent on the current change.

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
