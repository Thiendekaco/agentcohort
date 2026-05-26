# Agents & Pipelines

agentcohort installs **16 specialist subagents** and **9 workflow commands** into your project's `.claude/` directory. A smart dispatcher routes each user task to the smallest sufficient pipeline.

## What gets installed

```
.claude/
  agents/
    dispatcher.md            repo-scout.md           solution-architect.md
    feature-planner.md       feature-implementer.md  test-verifier.md
    final-reviewer.md        bug-hunter.md           root-cause-analyst.md
    reproduction-engineer.md regression-guard.md     bug-fixer.md
    performance-hunter.md    perf-optimizer.md       perf-reviewer.md
    expert-council.md
  commands/
    auto-flow.md     quick-fix.md     quick-feature.md
    dev-flow.md      bug-audit.md     bug-fix-approved.md
    perf-hunt.md     review-diff.md   fix-blockers.md
CLAUDE.md              # an "# Agentcohort Routing Rules" section
```

A full example tree is in [`examples/generated-claude/`](../examples/generated-claude).

## Philosophy

- **Core**: Explore → Architect → Plan → Implement → Test → Review
- **Bugs**: Hunt → Evidence → Root Cause → Expert Council → **Human Approval** → Fix → Regression Test → Verify → Review
- **Performance**: Measure / Evidence → Bottleneck → Safe Optimization → Verify → Performance Review

Every agent operates at a top-1% principal / staff standard: root-cause first, production-grade correctness, no shallow fixes, no fixing without evidence, and **a bug audit never fixes** — it produces a recommendation and stops at a human approval gate.

## The 16 bundled agents

| Agent | Tier | Role | Memory reads / writes |
|---|---|---|---|
| `dispatcher` | haiku (cheap) | Read-only task classifier — picks tier + pipeline | reads: audit, hotspots · writes: audit |
| `repo-scout` | haiku (cheap) | Fast exploration; collects files + context for downstream stages | reads: scratch, module-map, conventions · writes: scratch |
| `solution-architect` | opus (premium) | Proposes 2-3 approaches with trade-offs | reads: decisions, scratch, conventions · writes: decisions, scratch |
| `feature-planner` | sonnet (mid) | Locks in exact files + tests + verification surface | reads: scratch, conventions · writes: scratch |
| `feature-implementer` | opus (premium) | Implements an approved plan exactly; no scope expansion | reads: scratch, conventions · writes: scratch |
| `test-verifier` | sonnet (mid) | Runs tests; verifies coverage; writes verifications for past decisions | reads: scratch · writes: scratch, verifications |
| `final-reviewer` | opus (premium) | Pre-landing diff review; can derive new conventions | reads: scratch, conventions · writes: scratch, verifications, conventions |
| `bug-hunter` | sonnet (mid) | Triage + reproduce candidates from symptoms | reads: bugs, scratch, hotspots · writes: scratch |
| `root-cause-analyst` | opus (premium) | Iron-law root cause, not the first plausible fix | reads: bugs, scratch · writes: scratch |
| `reproduction-engineer` | sonnet (mid) | Builds a minimal repro after root cause | reads: scratch · writes: scratch |
| `regression-guard` | sonnet (mid) | Verifies a fix does not regress | reads: bugs, scratch, hotspots · writes: scratch, verifications |
| `bug-fixer` | sonnet (mid) | Implements approved fix; records the bug pattern | reads: bugs, scratch, hotspots · writes: bugs, scratch |
| `performance-hunter` | sonnet (mid) | Measures + identifies bottleneck candidates | reads: scratch, hotspots · writes: scratch |
| `perf-optimizer` | opus (premium) | Safe optimization with measured before / after | reads: scratch · writes: scratch |
| `perf-reviewer` | opus (premium) | Verifies no perf regression elsewhere | reads: scratch · writes: scratch |
| `expert-council` | opus (premium) | Synthesizes recommendation across bug audit findings | reads: decisions, bugs, scratch · writes: scratch, audit |

## The 9 pipelines

| Command | Pipeline | Gates | Use it for |
|---|---|---|---|
| `/auto-flow` | dispatcher → plan → user approval → chosen pipeline | (delegated) | The **default** — invoked automatically for any natural-language task |
| `/dev-flow` | scout → architect\* → planner → implementer → test-verifier → final-reviewer | architect, plan | Tier 3: normal feature or refactor |
| `/quick-feature` | scout → implementer → test-verifier → final-reviewer | (none) | Tier 2b: small feature in 1-3 local files, no API / schema / auth |
| `/bug-audit` | bug-hunter → root-cause-analyst → reproduction-engineer → expert-council | root-cause, expert-council | Tier 3: bugs / regressions / bad data / stability. **No fixing.** |
| `/bug-fix-approved` | bug-fixer → regression-guard → test-verifier → final-reviewer | (none) | Tier 3: implement an audited & approved fix |
| `/quick-fix` | bug-fixer → regression-guard → test-verifier → final-reviewer | (none) | Tier 2a: small bug fix, root cause already known |
| `/perf-hunt` | performance-hunter → architect\* → perf-optimizer → test-verifier → perf-reviewer | bottleneck | Tier 3: slowness / bottlenecks |
| `/review-diff` | final-reviewer | (none) | Review the current diff / PR |
| `/fix-blockers` | feature-implementer → test-verifier | (none) | Fix only the blockers a review listed |

\* the architect stage runs only when the change is architecture-sensitive. **Tier 4** (escalated by the dispatcher when an escalation keyword fires — auth / schema / migration / payment / security / concurrency / cache / …) **forces** the architect + expert-council stages on, regardless of the chosen pipeline.

## Model strategy

- **Haiku** — cheap exploration / scouting / dispatch classification
- **Sonnet** — implementation, testing, bug & performance hunting
- **Opus** — architecture, root-cause analysis, expert council, final review

Customize per-tier in `.agentcohort.json` — see [docs/configuration.md#model-strategy](configuration.md#model-strategy).

## Cost savings — full breakdown

| Task type | Naïve baseline | With agentcohort | Estimated savings |
|---|---|---|---|
| Lookups — "where is X", "what does Y do" | full pipeline | **Tier 0**: answered inline, 0 agents | **~100%** |
| Read & explain — "trace this flow" | full pipeline | **Tier 1**: 1 haiku scout | **~95%** |
| Small bug fix (root cause known) | 6 agents incl. 2× opus | **Tier 2a** `/quick-fix` — 4 agents, 1× opus | **~45%** |
| Small feature (1-3 local files) | 6 agents incl. 2× opus | **Tier 2b** `/quick-feature` — 4 agents, 1× opus | **~50%** |
| Normal feature / bug / perf | full pipeline | full pipeline (unchanged) | 0% |
| Sensitive — auth / schema / payment / cache / concurrency | full pipeline | full **+ forced** architect + expert-council | **−20%** (intentional) |

**Typical project mix** (~40% lookups & reads, ~30% small fixes & features, ~30% normal+ work): expect roughly **50-70% lower token spend** on Claude calls vs. always running a full pipeline. Validate on your project with `agentcohort stats --compare-naive` — see [docs/cli-reference.md](cli-reference.md#agentcohort-stats).

**Where the savings come from:**

1. **Lookups skip the pipeline.** "Where is the auth check?" used to fire scout → planner → implementer → reviewer if you typed `/dev-flow`. Now it returns an inline answer.
2. **Architect & expert-council are skipped when not needed.** Two opus stages account for the bulk of cost — keep them only when the change is architecture-sensitive.
3. **Small fixes use a 4-agent pipeline instead of 6.** Same reviewer (non-negotiable), no planner stage when scope is small.
4. **Sensitive changes are *more* expensive on purpose.** Forced architect + expert-council are far cheaper than shipping a broken auth migration.

> **Methodology:** percentages are derived from Claude API pricing across haiku / sonnet / opus tiers and typical per-agent context size in a mid-sized TypeScript codebase. The dispatcher itself costs about one haiku call (~$0.005) per request, included in the "with agentcohort" column.

## How agents respect your CLAUDE.md and skills

Every installed agent boots by reading your project's `CLAUDE.md` content **outside** the `# Agentcohort Routing Rules` section and by checking for installed skills that match the current task.

- Your project rules take precedence over an agent's default prompt.
- An agent invokes a matching skill instead of re-implementing it.
- agentcohort's defaults apply only where your project is silent.

agentcohort slots into a project that already has its own CLAUDE.md and skills (e.g. `superpowers`) — it does not override what you've already set up.

---

**See also:** [docs/memory.md](memory.md) for how agents share state · [docs/configuration.md](configuration.md) for per-agent + per-gate customization.
