# agentcohort

> A principal-level AI engineering organization for Claude Code, installed with one command.

[![npm version](https://img.shields.io/npm/v/agentcohort)](https://www.npmjs.com/package/agentcohort)
[![license](https://img.shields.io/npm/l/agentcohort)](LICENSE)
[![downloads](https://img.shields.io/npm/dm/agentcohort)](https://www.npmjs.com/package/agentcohort)

agentcohort installs **16 specialist subagents**, **9 workflow pipelines**, and a **4-layer memory system** into any project. A smart dispatcher right-sizes the pipeline to your task — small fixes stay cheap, sensitive changes (auth / schema / payment) get the full architect + expert-council treatment.

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

## Why it saves you money

The dispatcher matches agent count *and* model strength to task complexity instead of running a one-size-fits-all pipeline.

| Task type | Naïve (always full pipeline) | With agentcohort | Savings |
|---|---|---|---|
| Lookups — "where is X" | full pipeline | inline answer, 0 agents | **~100%** |
| Small bug fix | 6 agents, 2× opus | `/quick-fix` — 4 agents, 1× opus | **~45%** |
| Normal feature / bug | full pipeline | full pipeline | 0% |
| Sensitive (auth / schema / cache) | full pipeline | full **+ forced** architect + expert-council | **−20%** (intentional) |

**Typical project mix: ~50-70% lower spend.** Validate on your own project with `agentcohort stats --compare-naive`.

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
