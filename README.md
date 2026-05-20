# agentcohort

> Install a principal/staff-level **AI software-engineering organization** for
> [Claude Code](https://docs.claude.com/en/docs/claude-code) into any project
> with one command.

`agentcohort` is not just a template copier. It installs a coordinated set of
**16 subagents**, **9 workflow commands**, and **routing rules** that make
Claude Code work like a disciplined engineering org: explore before changing,
prove root cause before fixing, measure before optimizing, and review before
shipping.

A **smart dispatcher** (haiku) classifies every task and runs the smallest
sufficient pipeline — small tasks stay cheap, normal work stays normal, and
sensitive tasks (auth / schema / payment / …) are *forced* up to the full
pipeline with architect + expert-council.

---

## Why agentcohort — token & cost savings

The dispatcher rejects the "one-size-fits-all" pipeline and matches agent
count *and* model strength to task complexity. Estimated savings vs. the
naïve baseline of running the full `/dev-flow` (or any full pipeline) on
every request:

| Task type | Naïve baseline | With agentcohort | Est. savings |
|---|---|---|---|
| Lookups — "where is X", "what does Y do" | full pipeline | **Tier 0**: answered inline, 0 agents | **~100%** |
| Read & explain — "trace this flow" | full pipeline | **Tier 1**: 1 haiku scout | **~95%** |
| Small bug fix (root cause known) | 6 agents incl. 2× opus | **Tier 2a** `/quick-fix` — 4 agents, 1× opus | **~45%** |
| Small feature (1–3 local files) | 6 agents incl. 2× opus | **Tier 2b** `/quick-feature` — 4 agents, 1× opus | **~50%** |
| Normal feature / bug / perf | full pipeline | full pipeline (unchanged) | 0% |
| Sensitive — auth / schema / payment / cache / concurrency | full pipeline | full **+ forced** architect + expert-council | **−20%** (intentional) |

**Typical project mix** (~40% lookups & reads, ~30% small fixes &
features, ~30% normal+ work): expect roughly **50–70% lower token
spend on Claude calls** vs. always running a full pipeline — while
sensitive work spends *more* (on purpose).

**Where the savings come from**

1. **Lookups skip the pipeline.** "Where is the auth check?" used to
   fire scout → planner → implementer → reviewer if you typed
   `/dev-flow`. Now it returns an inline answer.
2. **Architect & expert-council are skipped when not needed.** Two
   opus stages account for the bulk of cost — keep them only when the
   change is architecture-sensitive.
3. **Small fixes use a 4-agent pipeline instead of 6.** Same reviewer
   (non-negotiable), no planner stage when scope is small.
4. **Sensitive changes are *more* expensive on purpose.** Forced
   architect + expert-council are far cheaper than shipping a broken
   auth migration.

> **Methodology:** percentages are derived from Claude API pricing
> across haiku / sonnet / opus tiers and typical per-agent context
> size in a mid-sized TypeScript codebase. They are estimates, not
> benchmarked guarantees — your task mix and project size drive
> actual numbers. The dispatcher itself costs about one haiku call
> (~$0.005) per request, included in the "with agentcohort" column.

---

## Install

`agentcohort` is a CLI — install it **globally**, once:

```bash
npm i -g agentcohort
```

Or run it without installing anything (per-project, ad-hoc):

```bash
npx agentcohort init
```

> The npm package is `agentcohort`; the CLI command it installs is also
> `agentcohort`.

## Quick start

```bash
npm i -g agentcohort          # once, globally
cd path/to/your-project       # any project you want to equip
agentcohort init              # installs agents + commands + routing rules here
```

Then open Claude Code in that project and **just type your request in
natural language** — no slash command required:

```
Add a date-range filter to the /transactions page
Fix the off-by-one in invoice totals
This page takes 8s to render, profile it
```

The dispatcher classifies the task, prints the proposed pipeline +
estimated cost band, and waits for you to approve before any agent
runs.

> You can still invoke a specific pipeline directly with `/auto-flow`,
> `/dev-flow`, `/bug-audit`, `/perf-hunt`, `/quick-fix`,
> `/quick-feature`, `/bug-fix-approved`, `/review-diff`, or
> `/fix-blockers`. Pure lookups ("where is file X?") are answered
> inline without invoking the dispatcher.

### Commands

| Command | What it does |
|---|---|
| `agentcohort init` | Install agents, commands and routing rules into the current project. |
| `agentcohort init --yes` | Non-interactive. Safe defaults (see below). |
| `agentcohort init --dry-run` | Print exactly what *would* change. Writes nothing. |
| `agentcohort init --force` | Overwrite conflicts / replace the routing section without prompting. |
| `agentcohort init --backup` | Always back up a file before overwriting it. |
| `agentcohort --version` | Print the version. |
| `agentcohort --help` | Show help. |

Flags compose: `agentcohort init --yes --backup`, `--force --backup`, etc.

## What files are created

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
CLAUDE.md                          # a "# Agentcohort Routing Rules" section
```

A full example tree is in [`examples/generated-claude/`](./examples/generated-claude).

## The philosophy

**Core:** Explore → Architect → Plan → Implement → Test → Review

**Bugs:** Hunt → Evidence → Root Cause → Expert Council → **Human Approval** →
Fix → Regression Test → Verify → Review

**Performance:** Measure/Evidence → Bottleneck → Safe Optimization → Verify →
Performance Review

Every agent operates at a top-1% principal/staff standard: root-cause first,
production-grade correctness, no shallow fixes, no fixing without evidence, and
**a bug audit never fixes** — it produces a recommendation and stops at a human
approval gate.

### How agents respect your CLAUDE.md and skills

Every installed agent boots by reading your project's `CLAUDE.md`
content **outside** the `# Agentcohort Routing Rules` section and by
checking for installed skills that match the current task. The rules:

- Your project rules take precedence over an agent's default prompt.
- An agent invokes a matching skill instead of re-implementing it.
- Agentcohort's defaults apply only where your project is silent.

This means `agentcohort` slots into a project that already has its own
CLAUDE.md and skills (e.g. `superpowers`) — it does not override what
you've already set up.

## Using the workflow commands (inside Claude Code)

| Command | Pipeline | Use it for |
|---|---|---|
| `/auto-flow` | dispatcher → plan → user approval → chosen pipeline | The **default** — invoked automatically for any natural-language task. |
| `/dev-flow` | scout → architect\* → planner → implementer → test-verifier → final-reviewer | Tier 3: normal feature or refactor. |
| `/quick-feature` | scout → implementer → test-verifier → final-reviewer | Tier 2b: small feature in 1–3 local files, no API/schema/auth. |
| `/bug-audit` | bug-hunter → root-cause-analyst → reproduction-engineer → expert-council | Tier 3: bugs / regressions / bad data / stability. **No fixing.** |
| `/bug-fix-approved` | bug-fixer → regression-guard → test-verifier → final-reviewer | Tier 3: implement an audited & approved fix. |
| `/quick-fix` | bug-fixer → regression-guard → test-verifier → final-reviewer | Tier 2a: small bug fix, root cause already known. |
| `/perf-hunt` | performance-hunter → architect\* → perf-optimizer → test-verifier → perf-reviewer | Tier 3: slowness / bottlenecks. |
| `/review-diff` | final-reviewer | Review the current diff / PR. |
| `/fix-blockers` | feature-implementer → test-verifier | Fix only the blockers a review listed. |

\* the architect stage runs only when the change is architecture-sensitive.
Tier 4 (escalated by the dispatcher when an escalation keyword fires —
auth / schema / migration / payment / security / concurrency / cache /
…) forces the architect and expert-council stages on, regardless of
the chosen pipeline.

### Model strategy

- **Haiku** — cheap exploration / scouting.
- **Sonnet** — implementation, testing, bug & performance hunting.
- **Opus** — architecture, root-cause analysis, expert council, final review.

## Customizing model strategy

`agentcohort init` will (interactively) prompt you to either use the
default Claude model IDs or pick your own for each tier. Your choice is
saved to `.agentcohort.json` at the project root and reused on later
runs.

To revisit your choice without re-installing everything, run:

```bash
agentcohort config
```

This re-prompts for the three tier model IDs, shows a diff of which
installed agents would change, and applies the changes with your
confirmation.

To force a re-prompt during install (instead of using the existing
`.agentcohort.json`), run:

```bash
agentcohort init --reconfigure
```

### `.agentcohort.json` schema (v1)

```json
{
  "$schema": "https://raw.githubusercontent.com/Thiendekaco/agentcohort/main/schema/agentcohort-config-v1.json",
  "version": 1,
  "models": {
    "premium": "claude-opus-4-7",
    "mid": "claude-sonnet-4-6",
    "cheap": "claude-haiku-4-5-20251001"
  }
}
```

- **premium** — architecture, root-cause analysis, expert council, final
  review.
- **mid** — implementation, testing, bug & performance hunting.
- **cheap** — fast read-only repo scout.

Hand-editing one of the installed `.claude/agents/*.md` files to use a
specific model ID is respected: subsequent `agentcohort init` and
`agentcohort config` runs leave that hand-edit alone (the tool only
rewrites lines that are still tier aliases or match the previous
config's IDs).

Model IDs are not validated by the tool — if the ID is invalid, Claude
Code will fail at agent spawn time.

## Customizing agents

The installed files are plain Markdown and **yours to edit**:

- Tune any agent in `.claude/agents/*.md` (role, rules, output format, the
  `model:`/`tools:` frontmatter).
- Adjust a pipeline in `.claude/commands/*.md`.
- Put **your own** project notes in `CLAUDE.md` *outside* the
  `# Agentcohort Routing Rules` section — that section is owned by the tool and
  may be updated by a future `init`; everything else is never touched.

Re-running `agentcohort init` later will detect your edits as conflicts and ask
before changing them (or back them up with `--backup`).

## Safety notes

`agentcohort` is conservative by design:

- **Never deletes** your files.
- **Never silently overwrites.** Existing, differing files trigger a prompt
  (skip / overwrite / backup + overwrite), or an explicit flag.
- **Idempotent.** Re-running on identical content reports *unchanged* and does
  nothing.
- **CLAUDE.md is surgical.** A missing file is created; a file without our
  section gets the section *appended* (your content preserved); an existing,
  differing section is **left alone** in non-interactive mode (use `--force`
  to update it). Only the delimited section is ever touched.
- **`--yes` safe defaults:** new files created; conflicting files
  **backed up then updated**; an existing CLAUDE.md routing section **left
  untouched**.
- **`--dry-run`** performs zero writes and zero backups.
- Backups are written next to the original as
  `&lt;file&gt;.backup-YYYYMMDD-HHMMSS` and never overwrite an existing backup.
- Cross-platform (Windows/macOS/Linux); a single runtime dependency
  (`@inquirer/prompts` for the interactive model-tier prompt), no
  shell-specific behavior.

## Development

```bash
npm install
npm run build      # tsc -> dist/, then copies templates
npm test           # vitest
```

## Branching & releases

Two long-lived branches:

- **`dev`** — integration / staging. All feature PRs target `dev`. Nothing
  here publishes to npm; this is the place to bundle PRs together, run
  manual smoke tests, and verify the release as a whole.
- **`main`** — production. Only ever updated by merging `dev` → `main`.
  Every push to `main` triggers the [`Release`](.github/workflows/release.yml)
  workflow.

The workflow does:

1. installs, builds and runs the full test suite;
2. publishes the **current** `package.json` version to npm —
   https://www.npmjs.com/package/agentcohort (so the very first
   release was exactly `0.1.0`, nothing skipped);
3. creates the annotated git tag `vX.Y.Z` on the published commit;
4. bumps to the next dev version (`patch` by default) and pushes a
   `chore(release): published vX.Y.Z, open vX.Y.(Z+1) [skip ci]` commit back
   to `main`.

So the normal release cycle is: open PR → `dev` → review & merge → smoke
test on `dev` → open PR `dev` → `main` → merge → workflow publishes. To
ship a `minor`/`major` instead of `patch`, bump `package.json` yourself
in the PR before merging (or use the *Run workflow* button to control
how the **next** pending version is opened). If the pending version is
already on npm, publish is skipped and the job still succeeds (safe
re-runs). The `[skip ci]` marker stops the release commit from
re-triggering the workflow (no publish loop).

**One-time setup:** add an npm **Automation** access token as the repository
secret `NPM_TOKEN` (GitHub → Settings → Secrets and variables → Actions →
*New repository secret*). Until that secret exists, the workflow's *Publish*
step will fail while build/test still pass.

## License

MIT
