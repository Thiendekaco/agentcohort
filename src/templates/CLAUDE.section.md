# Agent Force Routing Rules

> Installed and managed by [`agent-force`](https://www.npmjs.com/package/@thiendekaco/agent-force).
> This section is owned by the tool: re-running `agent-force init` may update
> it. Put your own project notes **outside** this section so they are never
> touched.

This project runs as an **AI software-engineering organization**. Default to
routing work through the workflow commands instead of ad-hoc editing.

## Operating standard (all agents)

- Operate at **top 1% principal/staff software-engineer** level.
- **Root-cause first.** No fix without evidence and a proven root cause.
- Production-grade correctness, maintainability, reliability over cleverness
  or speed-to-type. No shallow or symptom-only fixes.
- Every important fix needs a **regression test** and a **review**.
- Always report uncertainty, assumptions, and risk explicitly.

## Workflow selection

Run `/auto-flow` when unsure — it classifies and routes. Otherwise:

| Situation | Command | Pipeline |
|---|---|---|
| Feature / refactor / new behavior | `/dev-flow` | scout → architect* → planner → implementer → test-verifier → final-reviewer |
| Bug / crash / regression / bad data / security / stability | `/bug-audit` | bug-hunter → root-cause-analyst → reproduction-engineer → expert-council |
| A specific fix was **human-approved** | `/bug-fix-approved` | bug-fixer → regression-guard → test-verifier → final-reviewer |
| Slow / bottleneck / profiling | `/perf-hunt` | performance-hunter → architect* → perf-optimizer → test-verifier → perf-reviewer |
| Review a diff / PR | `/review-diff` | final-reviewer |
| Fix specific listed blockers | `/fix-blockers` | feature-implementer → test-verifier |

\* architect stage runs only when the change is architecture-sensitive
(module boundaries, public API, data model/schema, auth, concurrency,
caching, cross-cutting behavior) — otherwise it is skipped with a reason.

## Bug audit rule (non-negotiable)

**Never fix during a bug audit.** The audit produces: evidence → symptom →
direct cause → root cause → systemic cause → severity → affected modules →
solution options → recommended solution → trade-offs → reproduction &
regression plan → open risks. It then **stops at a human approval gate**.
Only after explicit approval does `/bug-fix-approved` change code, and only
within the approved scope.

## Model strategy

| Model | Used for |
|---|---|
| **Haiku** | Cheap exploration / scouting (`repo-scout`). |
| **Sonnet** | Implementation, testing, bug hunting, reproduction, regression, performance hunting/optimization. |
| **Opus** | Architecture, root-cause analysis, expert council, final & performance review. |

## Scope discipline

- No unrelated refactors, renames, or reformatting ("while I'm here" is
  forbidden). Unrelated improvements are **reported, not done**.
- No API / schema / auth / security / blockchain or other persistence-/
  trust-semantic changes without explicit human approval.
- Prefer the **minimal, reversible, low-blast-radius** change.
- Stay within the requested scope; surface out-of-scope findings separately.
- Always state confidence, assumptions, and residual risk.
