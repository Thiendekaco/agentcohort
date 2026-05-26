# Configuration

agentcohort reads `.agentcohort.json` at the project root for model tiers, gate modes, and per-skill / per-memory affinity overrides. Defaults apply when the file is missing or a key is omitted.

## `.agentcohort.json` schema (v1)

```json
{
  "$schema": "https://raw.githubusercontent.com/Thiendekaco/agentcohort/main/schema/agentcohort-config-v1.json",
  "version": 1,
  "models": {
    "premium": "claude-opus-4-7",
    "mid": "claude-sonnet-4-6",
    "cheap": "claude-haiku-4-5-20251001"
  },
  "gates": {
    "architect": "on",
    "plan": "auto",
    "bottleneck": "auto",
    "root-cause": "on",
    "expert-council": "on"
  },
  "skillAffinity": {
    "my-internal-skill": ["bug-hunter", "feature-implementer"],
    "superpowers:systematic-debugging": []
  },
  "memoryAffinity": {
    "my-custom-agent": { "reads": ["bugs"], "writes": ["scratch"] }
  }
}
```

All sections are optional — the file can be as small as `{ "version": 1, "models": { ... } }`.

## Model strategy

Three tiers map to the three model strengths agentcohort uses:

| Tier | Used by | Why |
|---|---|---|
| `premium` | architecture, root-cause analysis, expert council, final review | Hardest reasoning, highest stakes |
| `mid` | implementation, testing, bug & performance hunting | Solid execution, manageable cost |
| `cheap` | dispatcher classification, repo scout | Fast read-only work |

### Setting model tiers

`agentcohort init` prompts you interactively to either use the defaults or pick your own IDs per tier. Your choice is saved to `.agentcohort.json`.

To revisit later: `agentcohort config`. This re-prompts, shows a diff of which installed agents would change, and applies with your confirmation.

To force a re-prompt during install (instead of using existing `.agentcohort.json`): `agentcohort init --reconfigure`.

### Hand-edited `model:` lines are respected

Editing one of the installed `.claude/agents/*.md` files to use a specific model ID is respected: subsequent `agentcohort init` / `config` runs leave that hand-edit alone (the tool only rewrites lines that are still tier aliases or match the previous config's IDs).

Model IDs are not validated by the tool — if the ID is invalid, Claude Code will fail at agent spawn time.

## Gates

Some pipeline stages produce **load-bearing decisions** — architecture choices, root-cause verdicts, plans that lock in the implementation surface. agentcohort can pause the pipeline at these points so you sanity-check the decision before more expensive stages run.

### Gate matrix

| Gate | Position | Default | What you confirm |
|---|---|---|---|
| `architect` | after `solution-architect` (in `/dev-flow`, `/perf-hunt`) | `on` | The chosen architecture + trade-offs |
| `plan` | after `feature-planner` (in `/dev-flow`) | `on` | Exact files, tests, verification before code is written |
| `bottleneck` | after `performance-hunter` (in `/perf-hunt`) | `auto` | The right bottleneck to attack before architect / optimizer cost is committed |
| `root-cause` | after `root-cause-analyst` (in `/bug-audit`) | `on` | The root cause verdict before a reproduction is built |
| `expert-council` | end of `/bug-audit` (always) | `on` | The recommended solution before `/bug-fix-approved` can run |

### Modes

| Mode | Effect |
|---|---|
| `on` | Always pause for human approval |
| `off` | Never pause |
| `auto` | Pause only when the dispatcher escalates to Tier 4 (sensitive keyword fired) |

### Configure globally

Either re-run `agentcohort config` or hand-edit `.agentcohort.json` `gates` section.

### Override per task

At the dispatcher's plan prompt:

```
Proceed with this plan? [y / escalate / abort / question / gates ±<name>]
> gates -plan        # skip the plan gate for THIS task only
> gates +architect   # force architect gate ON for THIS task only
```

Per-task overrides do not persist.

### Why gates pay for themselves

A wrong architecture decision cascades cost into planner → implementer → test → review. Catching it at the architect gate (when you've spent ~1 opus call) is far cheaper than catching it at the reviewer gate (when you've spent the whole pipeline + a wasted edit). Default-`on` is conservative; turn gates `off` if your task volume makes the friction worse than the rework.

## Skills affinity

Claude Code skills (e.g. `superpowers:*`, `caveman-*`, `investigate`) are auto-detected by `agentcohort skills` and baked into per-agent boot directives. The hardcoded `DEFAULT_AFFINITY` (in `src/skillAffinity.ts`) maps every known skill to a curated list of agents that should see it.

Override per-project in `.agentcohort.json` `skillAffinity` section. User entries **replace** defaults for that skill (so an empty array mutes a default-mapped skill).

For unknown skills (not in the default map), the safe default is **no agents** — explicit opt-in only.

## Memory affinity

Each bundled agent reads / writes specific memory collections (see [docs/memory.md#memory-affinity-per-agent-reads--writes](memory.md#memory-affinity-per-agent-reads--writes)). Defaults live in `src/memoryAffinity.ts`.

Override per-project in `.agentcohort.json` `memoryAffinity` section. User entries **merge** with defaults: listed user agents replace; unlisted agents keep their defaults.

```json
{
  "memoryAffinity": {
    "my-custom-agent": { "reads": ["bugs"], "writes": ["scratch"] },
    "feature-planner": { "reads": ["decisions", "scratch"], "writes": ["scratch"] }
  }
}
```

## Customizing agents

The installed `.claude/agents/*.md` and `.claude/commands/*.md` files are plain markdown and **yours to edit**:

- Tune any agent's role, rules, output format, or `model:` / `tools:` frontmatter
- Adjust a pipeline's flow in `.claude/commands/*.md`
- Put your own project notes in `CLAUDE.md` *outside* the `# Agentcohort Routing Rules` section — that section is owned by the tool and may be updated by a future `init`; everything else is never touched

Re-running `agentcohort init` later will detect your edits as conflicts and ask before changing them (or back them up with `--backup`).

## Shell completion

```bash
# bash
agentcohort completion bash > ~/.agentcohort-completion.bash
echo 'source ~/.agentcohort-completion.bash' >> ~/.bashrc

# zsh
agentcohort completion zsh > "${fpath[1]}/_agentcohort"
autoload -U compinit && compinit

# PowerShell
agentcohort completion pwsh >> $PROFILE
. $PROFILE
```

Re-run after upgrades to refresh baked-in agent / command names.

## Safety notes

agentcohort is conservative by design:

- **Never deletes** your files
- **Never silently overwrites** — existing differing files trigger a prompt (skip / overwrite / backup + overwrite) or require an explicit flag
- **Idempotent** — re-running on identical content reports `unchanged` and does nothing
- **CLAUDE.md is surgical** — only the `# Agentcohort Routing Rules` section is touched; everything else preserved
- **`--yes` safe defaults** — new files created; conflicting files backed up then updated; existing CLAUDE.md routing section left untouched
- **`--dry-run`** performs zero writes and zero backups
- Backups land next to the original as `<file>.backup-YYYYMMDD-HHMMSS` and never overwrite an existing backup
- Cross-platform (Windows / macOS / Linux); a single runtime dependency (`@inquirer/prompts` for interactive prompts), no shell-specific behavior

---

**See also:** [docs/cli-reference.md](cli-reference.md) for command flags · [docs/agents.md](agents.md) for the 16 agents + 9 pipelines · [docs/memory.md](memory.md) for the memory model.
