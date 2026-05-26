# agentcohort

> A principal-level AI engineering organization for Claude Code, installed with one command.

[![npm version](https://img.shields.io/npm/v/agentcohort)](https://www.npmjs.com/package/agentcohort)
[![license](https://img.shields.io/npm/l/agentcohort)](LICENSE)
[![downloads](https://img.shields.io/npm/dm/agentcohort)](https://www.npmjs.com/package/agentcohort)

agentcohort installs **16 specialist subagents**, **9 workflow pipelines**, and a **4-layer memory system** into any project. A smart dispatcher right-sizes the pipeline to your task — small fixes stay cheap, sensitive changes (auth / schema / payment) get the full architect + expert-council treatment.

## 🎯 How it works

You type a task in Claude Code. agentcohort's dispatcher reads it, classifies the complexity, and **automatically picks the right team of agents** — strong models (opus) for hard work, cheap models (haiku / sonnet) for easy work. No more burning premium tokens on "where is X?". No more under-powering a schema migration.

| Your task | Dispatcher routes to | Agents used (model tier) | Cost class |
|---|---|---|---|
| **"Where is the auth check?"** | inline answer | **0 agents** | **~free** |
| **"Fix off-by-one in invoice totals"** | `/quick-fix` | bug-fixer (sonnet) → regression-guard (sonnet) → test-verifier (sonnet) → final-reviewer (opus) | **low** |
| **"Add date-range filter to /transactions"** | `/quick-feature` | scout (haiku) → implementer (opus) → test-verifier (sonnet) → final-reviewer (opus) | **medium** |
| **"Refactor the auth middleware"** | `/dev-flow` + architect gate | scout (haiku) → architect (opus) → planner (sonnet) → implementer (opus) → tester (sonnet) → reviewer (opus) | **high** |
| **"Migrate users table to UUID PKs"** | `/dev-flow` + **forced** architect + expert-council | 7+ agents, premium-heavy + human approval gates | **premium** *(worth it)* |

**The insight:** easy tasks shouldn't pay the price of hard tasks. Hard tasks shouldn't get the depth of easy ones. The dispatcher does this routing on every request — you just type your task in natural language, no slash commands needed.

Cheap models do the cheap work (scouting, dispatch classification, simple tests). Premium models do the premium work (architecture choices, root-cause analysis, final review). The dispatcher itself runs on haiku — overhead is negligible.

**Result: 50-70% lower Claude bill on typical project mix.** Lookups stay free, normal work stays normal, sensitive changes get *more* care on purpose. Validate on YOUR project with `agentcohort stats --compare-naive`.

## The problem with default Claude Code

You ask Claude to "add a date-range filter to /transactions". It writes code in one shot. Looks fine. You merge. Then:

- You realize Claude didn't write tests.
- It touched 3 unrelated files for no reason.
- Next week, someone reports a regression — Claude had no memory of existing date-handling conventions.
- You burned premium-tier tokens on a job that should have been a haiku-tier call.

Multiply by 50 tasks a week and a team of 5. That's the bill, the broken trust in AI-generated code, and the hours spent reviewing.

## The idea

agentcohort's thesis: **AI coding is bottlenecked by discipline, not capability.** Frontier models are smart enough to be principal-level engineers — they just need the structure of a real engineering org around them:

- **Specialists, not generalists** — one agent explores, another designs, another implements, another reviews. Each has a single focused job description.
- **Review checkpoints** — pause at architecture + plan stages BEFORE expensive code-writing fires.
- **Institutional memory** — past decisions, bug patterns, project conventions persist. The next conversation starts smarter.
- **A router, not a hammer** — small fixes don't need full pipelines. Lookups don't need pipelines at all.

What you get is Claude Code that behaves like a disciplined senior team, not a brilliant intern.

## What else you get

Beyond the cost savings of smart routing:

### 🛡️ Higher quality output

- **Architecture gate** catches "we shouldn't add this dependency" or "this should be a server-side query" BEFORE premium-tier tokens implement the wrong thing.
- **Bug audit pipeline NEVER fixes** — produces a recommendation + waits for your approval. No more shallow "make the error go away" fixes that mask the root cause.
- **Specialist agents with strict roles** — `solution-architect` proposes 2-3 approaches with explicit trade-offs (not the first plausible one); `final-reviewer` reads the diff with reviewer eyes; `regression-guard` verifies the fix doesn't break anything else.
- **Test verification is non-negotiable** — every pipeline that touches code ends with `test-verifier` + `final-reviewer`. No "I wrote it, looks good, ship it".

### 🧠 Memory that compounds across runs

Every pipeline writes to a 4-layer memory system. The next task starts smarter, not from zero:

- **Decisions** — past architectural verdicts. Next architect proposal builds on them instead of reinventing.
- **Bugs** — verified bug pattern + fix. Next bug-hunter checks "have we seen this symptom before?" before re-investigating.
- **Hotspots** — files with ≥ 2 prior bugs are auto-flagged as fragile; touching them forces the `architect` gate ON.
- **Conventions** — project-specific style learned from accepted final-reviewer comments. Next implementer follows them automatically.

The dispatcher reads this memory before every new task and surfaces matches: *"Similar past task last Tuesday took /quick-fix → success → recommend /quick-fix"*. The longer you use it, the better the routing.

### ⚡ Fast where it matters

- **Lookups answer inline** in seconds, not after a 60-second pipeline. "Where is the auth check?" returns the file path + line, doesn't spawn agents.
- **Small fixes use 4 agents, not 6** — skips the planner + architect stages when scope is small. Same reviewer though — that's non-negotiable.
- **Dispatcher overhead is negligible** — one haiku call to classify, then it hands off to the right pipeline.

### 🚦 Catches mistakes BEFORE they cost real money

The expensive part of bad AI code isn't the tokens — it's discovering the bug in production and unwinding it. agentcohort gates that:

- **Wrong architecture?** Caught at the architect gate (1 premium call deep), not at code review (whole pipeline deep). The wasted work is the architect call, not the implementer + tests + reviewer chain.
- **Wrong root cause?** Caught at the root-cause gate. `bug-fixer` never runs on a faulty hypothesis. No "we fixed the wrong thing" embarrassment in PR review.
- **Scope creep?** Plan gate locks the exact files + tests before any code is written. If the planner says 3 files and the implementer touches 7, the diff fails review automatically.

## Install

```bash
npm i -g agentcohort
cd your-project && agentcohort init
```

Then in Claude Code, just type natural language:

```
Add a date-range filter to /transactions
Fix the off-by-one in invoice totals
This page takes 8s to render, profile it
```

The dispatcher classifies the task, prints a proposed plan with estimated cost band, and waits for your approval before any agent runs.

## Features at a glance

- 🧠 **Memory layer** — 4 collections + 8 CLI commands + dispatcher-aware routing. ([docs/memory.md](docs/memory.md))
- 🛠️ **16 specialist agents + 9 pipelines** — scout, architect, planner, implementer, bug-fixer, perf-optimizer, etc. ([docs/agents.md](docs/agents.md))
- 📊 **Stats dashboard** — `agentcohort stats --compare-naive` validates the savings claim on your project.
- 🔌 **Skills integration** — auto-detects Claude Code skills, wires per-agent affinity. ([docs/configuration.md#skills-affinity](docs/configuration.md#skills-affinity))
- 🚪 **Human review gates** — configurable architect / plan / root-cause / expert-council checkpoints. ([docs/configuration.md#gates](docs/configuration.md#gates))
- 🩺 **Health checks** — `agentcohort doctor` + `lint` + `status`. ([docs/cli-reference.md#health-checks](docs/cli-reference.md#health-checks))

## Documentation

| Topic | Read |
|---|---|
| CLI reference (all 25+ commands) | [docs/cli-reference.md](docs/cli-reference.md) |
| Memory layer (4 collections + dispatcher routing + OpenWolf overlay) | [docs/memory.md](docs/memory.md) |
| Agents & pipelines (16 agents, 9 workflows, model strategy) | [docs/agents.md](docs/agents.md) |
| Configuration (`.agentcohort.json`, gates, skills, customization) | [docs/configuration.md](docs/configuration.md) |
| Contributing & releases | [docs/contributing.md](docs/contributing.md) |

## License

MIT
