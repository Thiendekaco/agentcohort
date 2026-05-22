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

### Health check — `agentcohort doctor`

Verify the install in the current project is intact, the config is
valid, and no installed file has drifted from the bundled template:

```bash
agentcohort doctor          # human-readable output, colored, exits 0/1
agentcohort doctor --json   # same checks, JSON for CI
```

The command is **strictly read-only** — never creates, modifies, or
deletes files. It reports:

- **Project**: presence of `.claude/agents/`, `.claude/commands/`,
  `CLAUDE.md`. `.agentcohort.json` is optional (defaults apply).
- **Config**: JSON parseable, model tiers valid, gate values valid.
  Unknown gate keys are surfaced as warnings, not errors (typo guard).
- **Agents / Commands**: count installed vs. bundled; lists missing,
  extra (user-added), `user-edited`, `outdated` (package upgraded but
  file not refreshed), and `unstamped` (pre-0.4.0 install).
- **CLAUDE.md**: routing section present (exactly once), required
  subsections found.

**How integrity tracking works** — at install time, every `.md`
template gets a 16-char SHA-256 stamp in its frontmatter
(`_agentcohort_hash`). The hash excludes the `model:` line so
changing the model tier does not trigger a false `user-edited`
report. `doctor` compares the stored stamp against the current file
content and the current bundled template to classify each file.

Exit codes are CI-friendly:

| Code | Meaning |
|---|---|
| `0` | Healthy — no warnings, no errors |
| `1` | Healthy with warnings, or unhealthy with errors |
| `2` | Internal failure (filesystem error, etc.) |

### Content lint — `agentcohort lint`

Complements `doctor`. Where `doctor` checks **structure** (files
present, config valid, integrity stamps intact), `lint` checks
**content quality** of files the user has touched:

```bash
agentcohort lint            # human-readable, colored, exits 0/1
agentcohort lint --json     # same checks, JSON for CI
```

Also strictly read-only. Sections:

- **Agent frontmatter**: every `.claude/agents/*.md` has valid `---`
  delimiters and required keys (`name`, `description`, `tools`,
  `model`). Broken frontmatter is an **error**.
- **Boot directive**: bundled agents still contain the
  `<!-- boot-directive-start --> ... <!-- boot-directive-end -->`
  block (the bootstrap context that teaches each agent to read
  `CLAUDE.md` / OpenWolf / installed skills). User-authored custom
  agents are exempt.
- **Model references**: each agent's `model:` value resolves to
  either a tier alias (`opus` / `sonnet` / `haiku`) or one of the
  concrete IDs in your `.agentcohort.json` models map. Unrecognized
  values are a **warning**.
- **CLAUDE.md references**: backtick-wrapped slash commands
  (\`/dev-flow\`, etc.) in the user-owned part of `CLAUDE.md` point
  at commands actually installed under `.claude/commands/`. Stale
  references are a **warning**.

Exit codes follow the same `0` / `1` / `2` convention as `doctor`.

### Upgrade in place — `agentcohort upgrade`

Sync templates to whatever the currently-installed agentcohort CLI
bundles, without losing local edits:

```bash
agentcohort upgrade            # interactive, prompts on conflicts
agentcohort upgrade --dry-run  # preview, write nothing
agentcohort upgrade --diff     # also print unified diff per changed file
agentcohort upgrade --backup   # always back up before overwriting
agentcohort upgrade --force    # overwrite user-edited files (combine with --backup)
```

How files are classified:

- **`unchanged`** — file matches bundled. Skip silently.
- **`outdated`** — stamp matches an older bundled version. **Auto-refresh** (no prompt — the user did not edit).
- **`user-edited`** — body no longer matches its stamp. **Prompt** with 4 choices: `Keep / Overwrite / Backup + overwrite / Show diff`. "Show diff" loops back to the prompt.
- **`unstamped`** — no integrity stamp (pre-0.4.0 install). Treated as user-edited.
- **missing locally** — bundled file not present. Install fresh.
- **extra locally** — user-created `.claude/*.md` files not in the bundled manifest are **never touched or deleted**.

`.agentcohort.json` is read for the user's model tiers but never written — gates and models persist exactly as the user configured them.

### Quick status — `agentcohort status`

One-shot read-only summary of the current install — version, counts,
config, gates, OpenWolf, and what's planned next:

```bash
agentcohort status          # human-readable, colored
agentcohort status --json   # JSON for tooling
```

```text
agentcohort v0.5.0

Install:
  Agents:            17 installed (17 bundled)
  Commands:          10 installed (10 bundled)
  CLAUDE.md:         routing section present
  Config:            .agentcohort.json (custom)
  OpenWolf:          active (.wolf/ found)

Models:
  premium:           claude-opus-4-7
  ...

Gates:
  architect:         on
  ...

Coming in future versions
  v0.6     agentcohort upgrade   bump bundled templates while preserving local config
  v0.7     Project profiles      `init --profile=backend|fullstack|...`
  ...
```

The "Coming in future versions" block is a static roadmap pointer, not
a release commitment. Targets may shift.

### Discovery — `agentcohort list`

Enumerate what is available in the current install. Where `status`
summarizes counts, `list` shows the items themselves — useful when you
want to know which agent handles what, which slash-command to invoke,
or what each review gate guards.

```bash
agentcohort list             # everything (agents + commands + gates)
agentcohort list agents      # bundled agents + per-file install status + model tier
agentcohort list commands    # slash-commands + descriptions + install status
agentcohort list gates       # review gates + current mode + when each pauses
agentcohort list --json      # any of the above, machine-readable
```

Example output (`agentcohort list agents`):

```text
Agents (16/16 installed)
  dispatcher            haiku (cheap)   installed
    └─ Read-only task classifier. Reads the user's request, classifies it into a routing tier…
  feature-implementer   opus (premium)  installed
    └─ Implement an approved plan exactly. No scope expansion, no opportunistic refactors…
  solution-architect    opus (premium)  user-edited
    └─ Propose 2–3 implementation approaches with explicit trade-offs…
  …
```

Per-file status is the same 4-state integrity verdict that powers
`doctor` and `upgrade` (`installed` / `outdated` / `user-edited` /
`unstamped`), plus `missing` (bundled but not installed) and `extra`
(installed locally but not part of the bundled set — user-authored
agents land here). Gate entries label their mode source as `(config)`
when `.agentcohort.json` overrides the default and `(default)` otherwise.

### Inspect one file — `agentcohort show <name>`

Pairs with `list`: where `list` enumerates names, `show` prints one
body so you can read the actual prompt without opening the file
manually.

```bash
agentcohort show dispatcher           # auto-pick agent or command
agentcohort show agent/dispatcher     # disambiguate (also: agents/dispatcher)
agentcohort show command/auto-flow    # disambiguate (also: commands/auto-flow)
agentcohort show dispatcher --raw     # bundled body, pre-render, pre-stamp
agentcohort show dispatcher --bundled # bundled body, render + stamp applied
agentcohort show dispatcher --json    # JSON wrapper with metadata
```

Defaults to the **installed** file (truthful — exactly what Claude
Code reads). When the file is not installed locally, falls back to
the bundled body with a banner so you can still preview what would
land. When a name matches both an agent and a command (a user-authored
agent overshadowing a slash-command name, for instance), `show`
prints **both** with clear `── Agent: <name> ──` / `── Command: <name> ──`
headers.

Integrity verdict is shown for installed files so you know at a glance
whether the body still matches its stamp (`unchanged` / `outdated` /
`user-edited` / `unstamped`).

### Search by content — `agentcohort search <keyword>`

Grep across agent + command bodies. Pairs with `list` (enumerate) and
`show` (inspect by name) — `search` finds the file by what it
*contains*. Useful for "which agent handles migrations?" or "find every
mention of `escalation keyword`."

```bash
agentcohort search dispatcher              # case-insensitive substring (default)
agentcohort search "exit code" --exact     # case-sensitive literal
agentcohort search "^model:\s+\S+$" --regex  # ECMAScript regex per-line
agentcohort search dispatcher --agents     # scope to agent files
agentcohort search dispatcher --commands   # scope to command files
agentcohort search dispatcher --json       # JSON for tooling
```

Output is ripgrep-style — file group, line number, line content with
the match highlighted:

```text
agents/dispatcher.md
   3:  description: Read-only task classifier...
  12:  the dispatcher returns a structured plan with: tier, pipeline...

commands/auto-flow.md
  18:  Invoke the `dispatcher` subagent on `$ARGUMENTS`.

2 matches in 2 files  (substring, scope: all)
```

**File source:** installed files take precedence when both an installed
copy and a bundled template exist (so your edits show up). When a file
is bundled-only — e.g. you haven't installed yet — `search` still scans
the bundled body and tags the result `[bundled]`. This means
`agentcohort search …` works as a discovery tool *before* `init`.

Exit codes: **0** at least one match, **1** no matches (or invalid regex
pattern with a friendly note), **2** internal failure.

### Inspect drift — `agentcohort diff [name]`

CI-friendly read-only diff between **installed** templates and the
currently **bundled** versions. Unlike `upgrade --dry-run --diff` —
which is action-oriented — `diff` is pure inspection: no policy
decisions, no prompts, no concept of "kept" or "applied". Just: what
is different right now?

```bash
agentcohort diff                       # diff every file that differs
agentcohort diff dispatcher            # diff one file by name
agentcohort diff agent/dispatcher      # disambiguate (also: agents/...)
agentcohort diff command/auto-flow     # disambiguate (also: commands/...)
agentcohort diff --agents              # scope to agent files
agentcohort diff --commands            # scope to command files
agentcohort diff --json                # JSON for tooling / CI
```

Per-file `status`:

| Status | Meaning |
|---|---|
| `unchanged` | installed body matches the current bundled body (silent — not included in `files`) |
| `outdated` | installed stamp matches an older bundled body |
| `user-edited` | installed body diverges from its stamp |
| `unstamped` | installed has no stamp (pre-0.4.0) |
| `missing` | bundled but not installed (diff shows the full bundled body) |
| `extra` | installed locally but not in the bundled set (no comparison possible) |

Exit codes are wired for CI:

| Code | Meaning |
|---|---|
| 0 | No differences — `unchanged` for everything in scope |
| 1 | At least one difference (or the named file does not exist) |
| 2 | Internal failure |

Drop `agentcohort diff` into a pre-merge check to fail the build when a
contributor edits a bundled template in `.claude/` without going
through `agentcohort upgrade`.

### Revert one file — `agentcohort reset <name>`

Targeted mutating command — revert ONE installed agent / command to
the currently-bundled body (rendered for your configured tiers,
re-stamped). Complements `upgrade` (project-wide refresh) when you
want to undo edits to a single file without touching the rest.

```bash
agentcohort reset dispatcher              # prompts before writing
agentcohort reset agent/dispatcher        # disambiguate (also: agents/...)
agentcohort reset command/auto-flow       # disambiguate (also: commands/...)
agentcohort reset dispatcher --dry-run    # preview, no write
agentcohort reset dispatcher --backup     # back up before overwriting
agentcohort reset dispatcher --yes        # skip confirm (non-interactive ok)
agentcohort reset dispatcher --force      # alias of --yes for this command
```

**Safety policy:**

- **No bulk reset.** The user must name a file. For project-wide
  refresh, use `agentcohort upgrade`.
- **Refuses `extra` files** (installed locally but not part of the
  bundled set — typically user-authored agents). There's no bundled
  version to reset to; deleting a user-authored file is a manual
  decision.
- **Refuses ambiguity.** When a bare name matches both an agent and
  a command, reset refuses and prompts for `agent/<name>` or
  `command/<name>`.
- **Interactive confirm by default.** A pre-confirm diff is printed so
  you see exactly what will change. Skip with `--yes` / `--force`.
- **Non-interactive without `--yes` refuses to write** — protects CI
  and pipes from accidental destructive runs.

Per-file outcomes:

| `disposition` | Meaning |
|---|---|
| `noop` | already matches bundled — nothing to do |
| `reset` | installed file was overwritten (was outdated / user-edited / unstamped) |
| `installed` | bundled file was not present locally; written fresh |
| `refused-extra` | installed locally but not in bundled set |
| `refused-not-found` | no agent / command matches |
| `refused-ambiguous` | bare name matches both kinds — needs `agent/` or `command/` prefix |

Exit codes: **0** success (noop / reset / installed), **1** refused
or named target not found, **2** internal failure, **130** user
cancelled the interactive confirm.

### Clean removal — `agentcohort uninstall`

Mutating, destructive — remove the bundled-set files from `.claude/`
and strip the agentcohort routing section from CLAUDE.md. Designed
so re-running `agentcohort init` later picks up exactly where you
left off (because `.agentcohort.json` is preserved by default).

```bash
agentcohort uninstall                  # interactive — prompts before writing
agentcohort uninstall --dry-run        # preview the plan, no writes
agentcohort uninstall --backup         # back up every file before removing
agentcohort uninstall --keep-claude-md # do NOT strip the routing section
agentcohort uninstall --remove-config  # ALSO remove .agentcohort.json
agentcohort uninstall --keep-config    # explicit: keep .agentcohort.json (default)
agentcohort uninstall --yes            # skip the confirm (non-interactive ok)
```

**Strong safety contract:**

- **User-authored files are NEVER touched.** A file in
  `.claude/agents/` whose name is not in the bundled set is recorded
  as `kept-user-file` and left alone. This is non-negotiable — there
  is no flag to delete user-authored files.
- **CLAUDE.md content outside the routing section is preserved.**
  Only the agentcohort section is removed; the rest of the file
  keeps its byte content (modulo whitespace collapsing at the section
  boundary).
- **Directories are not removed**, even if empty after the run. You
  own `.claude/` — agentcohort is just a tenant.
- **Backups** (when enabled) are per-file `<file>.backup-YYYYMMDD-
  HHMMSS`, same convention as `upgrade` / `reset`.
- **Non-interactive without `--yes` refuses to write.** Protects CI
  and pipes from accidental destructive runs.

**Default decisions under `--yes` / non-interactive:**

- CLAUDE.md routing section: **remove** (uninstall implies full
  removal of agentcohort presence)
- `.agentcohort.json`: **keep** (preserves your customized models /
  gates so a future re-install is one command away)

Override either with `--keep-claude-md` / `--remove-config` /
`--keep-config`.

### Add a custom agent or command — `agentcohort add <name>`

Scaffold a new user-authored agent or slash command. The file is
marked with `_agentcohort_local: true` in its YAML frontmatter so
future `agentcohort upgrade` runs leave it alone.

```bash
# New agent — kind picks the scaffold (analyst | implementer | reviewer | gate | empty)
agentcohort add my-domain-expert --kind=analyst --description="Billing-domain expert" --model=opus

# New slash command
agentcohort add command/my-flow --description="Custom workflow for nightly builds"

# Override a bundled agent — copies the bundled body verbatim and marks it local
agentcohort add bug-hunter --override
```

Disambiguating prefixes: `agent/<name>` and `command/<name>` (bare
name defaults to `agent`).

| Disposition | Meaning |
|---|---|
| `created` | new local file written |
| `override-created` | bundled file with same name was copied + marked local |
| `refused-bundled` | bundled `<name>` exists; pass `--override` to make a local copy |
| `refused-exists` | a file already sits at the target path; pass `--force` (or remove it manually) |
| `refused-invalid-name` | name must be lowercase letters, digits, hyphens (must start with a letter or digit) |

Behavior notes:

- **Always interactive by default.** Confirms before writing. Pass
  `--yes` (or `--force`) to skip; in non-interactive contexts (CI,
  pipes), `add` refuses without explicit consent.
- **`--dry-run` previews** the exact body that would be written,
  without touching the filesystem. Combine with `--json` for
  machine-readable preview.
- **CLAUDE.md is NOT auto-edited.** If you want the dispatcher in
  `/auto-flow` to know about your new agent, add a routing rule
  manually under `# Agentcohort Routing Rules` in your CLAUDE.md.
- **Override semantics:** `--override` is a one-shot snapshot. If
  the bundled body changes in a later `agentcohort upgrade`, your
  local copy is **untouched** — that's the whole point of marking
  it local. To pull bundled improvements back in, use
  `agentcohort reset <name>` (which reverts the local override).
- **Overriding an existing install:** the first time you override a
  bundled agent after `init`, an installed copy already sits at the
  target path — pass `--override --force` to authorize replacing
  that bundled-installed copy with the local one.

### Share customizations across projects — `agentcohort export` / `import`

Bundle every local file (`add` / `add --override` output) plus
`.agentcohort.json` into a portable JSON pack, then restore it in a
different project:

```bash
# Source project — write to a file
agentcohort export --out=team-pack.json

# Or write to stdout for piping (summary goes to stderr)
agentcohort export > team-pack.json

# Skip the config (model tiers / gates) if you don't want to share it
agentcohort export --out=team-pack.json --no-config

# Destination project — preview, then apply
agentcohort import team-pack.json --dry-run
agentcohort import team-pack.json --yes

# Overwrite existing local files (with optional backup)
agentcohort import team-pack.json --force --backup
```

What goes in the pack:

- **All local agents + commands** — every file under `.claude/` that
  carries `_agentcohort_local: true`. Both local-new (your custom
  agents) and local-override (your tweaks to bundled agents) ship.
- **`.agentcohort.json`** — model tier strategy + gate modes. Use
  `--no-config` to omit it.
- **What does NOT ship**: bundled files you hand-edited without
  marking local. Those are "drift" — use `agentcohort add --override`
  to mark them as intentional customizations first, then export.

| Disposition | Meaning |
|---|---|
| `created` | new local file written to the destination |
| `overwritten` | existing local file replaced (with `--force`) |
| `refused-exists` | a file already sits at the target path; re-run with `--force` |

Pack format (`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "agentcohort": "0.8.0",
  "exportedAt": "2026-05-22T12:00:00.000Z",
  "config": { "version": 1, "models": { ... }, "gates": { ... } },
  "files": [
    { "kind": "agent",   "name": "my-expert",  "isOverride": false, "content": "..." },
    { "kind": "agent",   "name": "bug-hunter", "isOverride": true,  "content": "..." },
    { "kind": "command", "name": "my-flow",    "isOverride": false, "content": "..." }
  ]
}
```

The pack is plain JSON — `cat | jq` away from being inspectable.
No new runtime dependencies are added.

### How local files are treated by the rest of the CLI

The `_agentcohort_local: true` marker is the single source of truth.
Every command respects it consistently:

| Command | Behavior on a marked file |
|---|---|
| `agentcohort list` | `[local]` status (no bundled equivalent) or `[local-override]` (same name as a bundled file) |
| `agentcohort doctor` | Listed under a `local` check (informational, never a warning) |
| `agentcohort show <name>` | Banner reads `integrity: local (user-authored — upgrade leaves it alone)` |
| `agentcohort diff <name>` | Local-new: empty diff (nothing to compare). Local-override: shows what your override changed from bundled. |
| `agentcohort upgrade` | Disposition `kept-local` — never overwritten, never prompted |
| `agentcohort reset <name>` | Local-override: reverts to bundled body (`Was: local-override`). Local-new: `refused-local-new` — there is no bundled to revert to |
| `agentcohort uninstall` | `kept-user-file` for both local-new and local-override — user-authored content is never deleted |

### Shell completion — `agentcohort completion <shell>`

Tab-complete subcommands, `list` scopes, shell names, and the agent /
command file names baked into the package. Emits a script to
stdout — pipe it to your shell's config:

```bash
# bash
agentcohort completion bash > ~/.agentcohort-completion.bash
echo 'source ~/.agentcohort-completion.bash' >> ~/.bashrc

# zsh
agentcohort completion zsh > "${fpath[1]}/_agentcohort"
autoload -U compinit && compinit

# PowerShell (Windows / cross-platform)
agentcohort completion pwsh >> $PROFILE
. $PROFILE
```

After upgrading the package, re-run `agentcohort completion <shell>`
to refresh — agent / command name lists are baked in at script
generation time (same trade-off as `cargo` / `npm` / `docker`).

What gets completed:

| Position | Suggestions |
|---|---|
| `agentcohort <TAB>` | every top-level command (init, doctor, list, show, …) |
| `agentcohort list <TAB>` | `agents` / `commands` / `gates` |
| `agentcohort show <TAB>` | bundled agent / command names + `agent/<name>` / `command/<name>` |
| `agentcohort diff <TAB>` | same as `show` |
| `agentcohort reset <TAB>` | same as `show` |
| `agentcohort completion <TAB>` | `bash` / `zsh` / `pwsh` |
| anywhere else | every long-form flag agentcohort recognizes |

### Human review gates (configurable)

Some pipeline stages produce **load-bearing decisions** — an
architecture choice, a root-cause verdict, a plan that locks in the
implementation surface. agentcohort can pause the pipeline at these
points so you sanity-check the decision before more expensive
stages run.

**Gate matrix:**

| Gate | Position | Default | What you confirm |
|---|---|---|---|
| `architect` | after `solution-architect` (in `/dev-flow`, `/perf-hunt`) | `on` | The chosen architecture + trade-offs |
| `plan` | after `feature-planner` (in `/dev-flow`) | `on` | Exact files, tests, verification before code is written |
| `bottleneck` | after `performance-hunter` (in `/perf-hunt`) | `auto` | The right bottleneck to attack before architect / optimizer cost is committed |
| `root-cause` | after `root-cause-analyst` (in `/bug-audit`) | `on` | The root cause verdict before a reproduction is built |
| `expert-council` | end of `/bug-audit` (always) | `on` | The recommended solution before `/bug-fix-approved` can run |

**Modes per gate:** `on` (always pause), `off` (never), `auto`
(pause only when the dispatcher escalates to Tier 4 / hits an
escalation keyword).

**Configure globally** by re-running `agentcohort config` (or
hand-editing `.agentcohort.json`):

```json
{
  "version": 1,
  "models": { "premium": "...", "mid": "...", "cheap": "..." },
  "gates": {
    "architect": "on",
    "plan": "auto",
    "bottleneck": "auto",
    "root-cause": "on",
    "expert-council": "on"
  }
}
```

**Override per task** at the dispatcher's plan prompt:

```
Proceed with this plan? [y / escalate / abort / question / gates ±<name>]
> gates -plan        # skip the plan gate for THIS task only
> gates +architect   # force architect gate on for THIS task only
```

Per-task overrides do not persist to `.agentcohort.json`.

**Why gates pay for themselves.** A wrong architecture decision
cascades cost into planner → implementer → test → review. Catching
it at the architect gate (when you've spent ~1 opus call) is far
cheaper than catching it at the reviewer gate (when you've spent
the whole pipeline + a wasted edit). Default-`on` is conservative;
turn gates `off` if your task volume makes the friction worse than
the rework.

### Stacks with a memory layer (optional)

If your project also runs [**OpenWolf**](https://github.com/cytostack/openwolf)
(`npm i -g openwolf && openwolf init`), `agentcohort` agents detect
its `.wolf/` directory and consult three of its memory files:

- **`anatomy.md`** — file map with token estimates. Lets `repo-scout`
  and the perf agents skip opening files whose description is enough.
- **`cerebrum.md`** — recorded Do-Not-Repeat list + user preferences.
  `feature-implementer`, `bug-fixer`, and `final-reviewer` block
  changes that violate it.
- **`buglog.json`** — past bug fixes. `bug-hunter` /
  `root-cause-analyst` / `reproduction-engineer` check for matching
  symptoms before re-investigating.

OpenWolf alone reports ~65–80% token savings on real projects (per
its own README). Combined with `agentcohort`'s pipeline right-sizing,
the two layers cut different sources of waste — file-level redundancy
(OpenWolf) and agent-level overkill (agentcohort) — so they compound.
**Estimated combined savings: ~85% vs. the naïve baseline. Not
benchmarked yet; treat as an upper bound, not a guarantee.**

> **Licensing.** `agentcohort` itself remains **MIT**. We do not
> bundle, copy, or link OpenWolf code — agents only *read text
> files* OpenWolf writes to `.wolf/`. OpenWolf is **AGPL-3.0**;
> if you install it, its license terms apply to OpenWolf, not to
> agentcohort. Companies that cannot accept AGPL should skip the
> OpenWolf install and use `agentcohort` standalone.

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
| `agentcohort config` | Re-prompt model tiers + human review gates; show + apply diffs. |
| `agentcohort doctor` | **Read-only** structural health check (files present, config valid, integrity stamps intact). Exits 0 healthy, 1 on warning/error, 2 on internal failure. |
| `agentcohort doctor --json` | Same checks, machine-readable JSON output. |
| `agentcohort lint` | **Read-only** content-quality check (frontmatter valid, boot directive intact, model refs resolve, slash-command refs in CLAUDE.md exist). Exits 0 clean, 1 on warning/error, 2 internal. |
| `agentcohort lint --json` | Same checks, machine-readable JSON output. |
| `agentcohort status` | **Read-only** at-a-glance report: version, agent / command counts, CLAUDE.md routing presence, resolved model tiers + gate modes, OpenWolf activity, planned upcoming features. |
| `agentcohort status --json` | Same data, machine-readable JSON output. |
| `agentcohort list` | **Read-only** discovery: enumerates bundled agents, commands and gates with per-file install status, model tier, descriptions and gate trigger blurbs. |
| `agentcohort list agents \| commands \| gates` | Same as above scoped to one section. |
| `agentcohort list --json` | Same data, machine-readable JSON output. |
| `agentcohort show <name>` | **Read-only** inspect one file. Prints the installed body (falls back to bundled with a banner). When a name matches both an agent and a command, prints both with clear headers. |
| `agentcohort show agent/<name> \| command/<name>` | Disambiguate when a name lives in both kinds. |
| `agentcohort show --raw <name>` | Print the bundled template body untouched — pre-render, pre-stamp. |
| `agentcohort show --bundled <name>` | Print the bundled template after render + stamp (= what `init` / `upgrade` would write). |
| `agentcohort show --json <name>` | Same data, machine-readable JSON output. |
| `agentcohort search <keyword>` | **Read-only** grep across agent + command bodies. Case-insensitive substring by default. Installed files take precedence; bundled-only files still scanned and tagged `[bundled]`. |
| `agentcohort search --agents \| --commands` | Restrict the search to one kind. |
| `agentcohort search --exact` | Case-sensitive literal match (no special chars). |
| `agentcohort search --regex` | Treat the query as an ECMAScript regex (per-line, /g implied). |
| `agentcohort search --json` | Same data, machine-readable JSON output. |
| `agentcohort diff` | **Read-only** unified diff for every installed file that differs from the bundled version. Exits 0 when nothing differs, 1 when something does — CI-friendly. |
| `agentcohort diff <name>` | Diff a single file (also accepts `agent/<name>` / `command/<name>`). |
| `agentcohort diff --agents \| --commands` | Restrict to one kind. |
| `agentcohort diff --json` | Same data, machine-readable JSON output. |
| `agentcohort reset <name>` | **Mutating** — revert one installed agent / command to the bundled body. Targeted alternative to `upgrade`. Refuses bulk, `extra` files, and ambiguous bare names. |
| `agentcohort reset <name> --dry-run` | Preview; writes nothing. |
| `agentcohort reset <name> --backup` | Back up the original before overwriting. |
| `agentcohort reset <name> --yes \| --force` | Skip the interactive confirm. |
| `agentcohort uninstall` | **Mutating, destructive** — remove bundled files, strip CLAUDE.md routing section. NEVER touches user-authored files. `.agentcohort.json` kept by default. |
| `agentcohort uninstall --dry-run` | Show the plan; writes nothing. |
| `agentcohort uninstall --backup` | Back up every file before removing it. |
| `agentcohort uninstall --keep-claude-md` | Do NOT strip the CLAUDE.md routing section. |
| `agentcohort uninstall --remove-config \| --keep-config` | Explicit config decision (default: keep). |
| `agentcohort uninstall --yes \| --force` | Skip the interactive confirm. |
| `agentcohort completion bash \| zsh \| pwsh` | Emit a shell completion script. Pipe to your shell config; re-run after package upgrades to refresh baked-in names. |
| `agentcohort add <name>` | **Mutating** — scaffold a new user-authored agent or command marked `_agentcohort_local: true` (so `upgrade` leaves it alone). Defaults to `agent`; use `command/<name>` for commands. |
| `agentcohort add <name> --kind=<archetype>` | Agent archetype: `analyst` / `implementer` / `reviewer` / `gate` / `empty` (default `empty`). |
| `agentcohort add <name> --description=<txt> --model=<tier>` | Override the default `description:` / `model:` (`haiku` / `sonnet` / `opus`) in the scaffold. |
| `agentcohort add <name> --override` | Allow scaffolding a local copy of a bundled file with the same name (your edits win over the bundled body). |
| `agentcohort add <name> --dry-run \| --yes \| --force` | Preview / skip prompt / overwrite an existing file at the target path. |
| `agentcohort export` | **Read-only** — bundle every local file + `.agentcohort.json` into a portable pack on stdout (machine-readable JSON; human summary to stderr). |
| `agentcohort export --out=<path>` | Write the pack to a file instead of stdout. |
| `agentcohort export --no-config` | Exclude `.agentcohort.json` from the pack. |
| `agentcohort export --json` | Emit the export result (paths + counts) as JSON. |
| `agentcohort import <pack>` | **Mutating** — apply a pack produced by `export`. Creates local files + `.agentcohort.json`. Refuses to overwrite existing files unless `--force`. |
| `agentcohort import <pack> --force --backup` | Overwrite existing local files and `.agentcohort.json`, keeping `.backup-YYYYMMDD-HHMMSS` copies. |
| `agentcohort import <pack> --no-config` | Skip the `.agentcohort.json` in the pack. |
| `agentcohort import <pack> --dry-run \| --yes` | Preview / skip the interactive confirm. |
| `agentcohort upgrade` | Sync `.claude/` templates and the CLAUDE.md routing section to the bundled version. Auto-refreshes outdated files; prompts (keep / overwrite / backup + overwrite / diff) on any file the user has edited. Preserves `.agentcohort.json`. |
| `agentcohort upgrade --dry-run` | Show what would change without writing. |
| `agentcohort upgrade --diff` | Print the unified diff of every file that would be refreshed, overwritten, or kept (in addition to the resolver's interactive diff). |
| `agentcohort upgrade --backup` | Always back up a file before overwriting it. |
| `agentcohort upgrade --force` | Overwrite user-edited files without prompting. Combine with `--backup` to be safe. |
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
