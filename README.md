# agentcohort

> Install a principal/staff-level **AI software-engineering organization** for
> [Claude Code](https://docs.claude.com/en/docs/claude-code) into any project
> with one command.

`agentcohort` is not just a template copier. It installs a coordinated set of
**15 subagents**, **7 workflow commands**, and **routing rules** that make
Claude Code work like a disciplined engineering org: explore before changing,
prove root cause before fixing, measure before optimizing, and review before
shipping.

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

Then open Claude Code in that project and run:

```
/auto-flow <describe your task, bug, or paste a diff>
```

`/auto-flow` classifies the work and routes it to the right pipeline.

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
    repo-scout.md            solution-architect.md   feature-planner.md
    feature-implementer.md   test-verifier.md        final-reviewer.md
    bug-hunter.md            root-cause-analyst.md   reproduction-engineer.md
    regression-guard.md      bug-fixer.md
    performance-hunter.md    perf-optimizer.md       perf-reviewer.md
    expert-council.md
  commands/
    auto-flow.md   dev-flow.md   bug-audit.md   bug-fix-approved.md
    perf-hunt.md   review-diff.md   fix-blockers.md
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

## Using the workflow commands (inside Claude Code)

| Command | Pipeline | Use it for |
|---|---|---|
| `/auto-flow` | classify → route | When unsure — it picks the flow. |
| `/dev-flow` | scout → architect\* → planner → implementer → test-verifier → final-reviewer | Features & refactors. |
| `/bug-audit` | bug-hunter → root-cause-analyst → reproduction-engineer → expert-council | Bugs / regressions / bad data / stability. **No fixing.** |
| `/bug-fix-approved` | bug-fixer → regression-guard → test-verifier → final-reviewer | Implement a fix you already approved. |
| `/perf-hunt` | performance-hunter → architect\* → perf-optimizer → test-verifier → perf-reviewer | Slowness / bottlenecks. |
| `/review-diff` | final-reviewer | Review the current diff/PR. |
| `/fix-blockers` | feature-implementer → test-verifier | Fix only the blockers a review listed. |

\* the architect stage runs only when the change is architecture-sensitive.

### Model strategy

- **Haiku** — cheap exploration / scouting.
- **Sonnet** — implementation, testing, bug & performance hunting.
- **Opus** — architecture, root-cause analysis, expert council, final review.

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
- Cross-platform (Windows/macOS/Linux), zero runtime dependencies, no
  shell-specific behavior.

## Development

```bash
npm install
npm run build      # tsc -> dist/, then copies templates
npm test           # vitest
```

## Releases

Publishing is automated. **The version in `package.json` is the version that
gets published.** Every push to `main` runs the
[`Release`](.github/workflows/release.yml) workflow, which:

1. installs, builds and runs the full test suite;
2. publishes the **current** `package.json` version to npm —
   https://www.npmjs.com/package/agentcohort (so the very first
   release is exactly `0.1.0`, nothing skipped);
3. creates the annotated git tag `vX.Y.Z` on the published commit;
4. bumps to the next dev version (`patch` by default) and pushes a
   `chore(release): published vX.Y.Z, open vX.Y.(Z+1) [skip ci]` commit back
   to `main`.

So: to cut a normal release, just push to `main`. To release a `minor`/`major`
instead, bump `package.json` yourself in a regular commit before pushing (or
use the *Run workflow* button to control how the **next** pending version is
opened). If the pending version is already on npm, publish is skipped and the
job still succeeds (safe re-runs). The `[skip ci]` marker stops the release
commit from re-triggering the workflow (no publish loop).

**One-time setup:** add an npm **Automation** access token as the repository
secret `NPM_TOKEN` (GitHub → Settings → Secrets and variables → Actions →
*New repository secret*). Until that secret exists, the workflow's *Publish*
step will fail while build/test still pass.

## License

MIT
