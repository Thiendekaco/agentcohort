# CLI Reference

Every command `agentcohort <subcommand>` understands, grouped by category. Output blocks show the human-readable format; every command also accepts `--json` for tooling.

## Quick index

| Command | Purpose |
|---|---|
| `agentcohort init` | Install agents + commands + routing rules into the current project |
| `agentcohort config` | Re-prompt model tiers + gates; apply diff |
| `agentcohort doctor` | Read-only structural health check |
| `agentcohort lint` | Read-only content-quality check on installed files |
| `agentcohort status` | At-a-glance summary (version, counts, gates, memory) |
| `agentcohort list` | Enumerate bundled agents / commands / gates with install status |
| `agentcohort show <name>` | Print one installed file (falls back to bundled with banner) |
| `agentcohort search <keyword>` | Grep across installed + bundled agent / command bodies |
| `agentcohort diff` | Read-only unified diff of installed vs bundled |
| `agentcohort reset <name>` | Revert one installed file to bundled |
| `agentcohort uninstall` | Remove bundled files + strip CLAUDE.md routing section |
| `agentcohort upgrade` | Sync templates + CLAUDE.md to currently-installed CLI version |
| `agentcohort add <name>` | Scaffold a custom agent / command marked `_agentcohort_local: true` |
| `agentcohort export` | Bundle local files + `.agentcohort.json` into a portable pack |
| `agentcohort import <pack>` | Apply a pack produced by `export` |
| `agentcohort skills` | Detect installed Claude Code skills (read-only) |
| `agentcohort refresh-skills` | Re-bake the skill + memory regions in every bundled agent |
| `agentcohort memory init` | Initialize `.agentcohort/memory/` + `.agentcohort/runs/` |
| `agentcohort memory write` | Append a validated entry (Zod + secret guard) |
| `agentcohort memory read` | Read entries with filters; joins verifications + read-time stale |
| `agentcohort memory search` | Substring / regex search across memory collections |
| `agentcohort memory mark-stale` | Mark entries stale (or unstale) after refactors |
| `agentcohort memory list-runs` | Browse pipeline run history from `INDEX.jsonl` |
| `agentcohort memory scan-modules` | Populate `module-map.jsonl` (hybrid LLM or fallback prompt) |
| `agentcohort memory scan-hotspots` | Derive file fragility from `bugs.jsonl` |
| `agentcohort memory compact` | Bookkeeping merge of old entries |
| `agentcohort memory clean --runs` | Reap old + orphan run directories |
| `agentcohort run start` | Generate run-id + emit start (or stage_start) event |
| `agentcohort run end` | Emit end (or stage_end) event for a run-id |
| `agentcohort gate record` | Record gate approve/reject/escalate/auto-skip into `audit.jsonl` |
| `agentcohort stats` | Cost dashboard from `INDEX.jsonl` + `--compare-naive` |
| `agentcohort completion <shell>` | Emit a shell completion script (bash / zsh / pwsh) |

## Install + lifecycle

### `agentcohort init`

Install agents, commands and routing rules into the current project.

```bash
npm i -g agentcohort          # once, globally
cd path/to/your-project
agentcohort init              # installs agents + commands + routing rules here
agentcohort init --yes        # non-interactive, safe defaults
agentcohort init --dry-run    # print exactly what would change; writes nothing
agentcohort init --force      # overwrite conflicts without prompting
agentcohort init --backup     # back up files before overwriting
agentcohort init --reconfigure  # re-prompt for model tiers even if .agentcohort.json exists
```

| Flag | Effect |
|---|---|
| `--yes` | Non-interactive. New files created; conflicting files backed up then updated; existing CLAUDE.md routing section left untouched |
| `--dry-run` | Performs zero writes and zero backups |
| `--force` | Overwrite conflicts / replace the routing section without prompting |
| `--backup` | Always back up a file before overwriting it |
| `--reconfigure` | Force re-prompt for model tiers during install instead of using existing `.agentcohort.json` |

Flags compose: `agentcohort init --yes --backup`, `--force --backup`, etc.

### `agentcohort config`

Re-prompts for the three tier model IDs (premium / mid / cheap), shows a diff of which installed agents would change, and applies the changes with your confirmation. Saves the result to `.agentcohort.json`.

```bash
agentcohort config
```

### `agentcohort uninstall`

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

### `agentcohort upgrade`

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

## Health checks

### `agentcohort doctor`

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

### `agentcohort lint`

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
  (`/dev-flow`, etc.) in the user-owned part of `CLAUDE.md` point
  at commands actually installed under `.claude/commands/`. Stale
  references are a **warning**.

Exit codes follow the same `0` / `1` / `2` convention as `doctor`.

### `agentcohort status`

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

## Discovery

### `agentcohort list`

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

### `agentcohort show`

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

### `agentcohort search`

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

### `agentcohort diff`

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

## Mutation

### `agentcohort reset`

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

### `agentcohort add`

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

### `agentcohort export` / `import`

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

## Skills

### `agentcohort skills`

Claude Code now ships a Skills system (`superpowers:*`, `caveman-*`,
`investigate`, `review`, ...). agentcohort detects them so its
bundled agents can invoke them at runtime via the `Skill` tool —
skill content (including `references/` and scripts) runs in the
subagent's context on the agent's configured model tier.

```bash
agentcohort skills              # detect + list (text)
agentcohort skills --json       # machine-readable
```

Sample output:

```
38 skill(s) detected

[user]
  caveman-commit
    └─ Ultra-compressed commit message generator. Cuts noise from commit messages...
  investigate
    └─ Systematic debugging with root cause investigation. Four phases...

[plugin: superpowers]
  superpowers:systematic-debugging
    └─ Use when encountering any bug, test failure, or unexpected behavior...
  superpowers:test-driven-development
    └─ Use when implementing any feature or bugfix, before writing implementation code

[project]
  my-project-skill
    └─ ...
```

Discovery scopes:

| Scope | Path |
|---|---|
| `user` | `~/.claude/skills/<name>/SKILL.md` |
| `plugin` | `~/.claude/plugins/<plugin>/skills/<name>/SKILL.md` |
| `project` | `<cwd>/.claude/skills/<name>/SKILL.md` |

Plugin-scope skills get a `<plugin>:<name>` qualified name (matches
how Claude Code surfaces them). User and project skills use the bare
name.

`Skill` is in the `tools:` whitelist of every bundled agent — so
each agent CAN invoke skills when appropriate.

See [docs/configuration.md#skills-affinity](configuration.md#skills-affinity) for per-agent affinity customization.

### `agentcohort refresh-skills`

Re-bake the boot-directive skill list in every installed bundled agent.
Narrower than `upgrade` — only the boot directive's skill region is
rewritten, leaving everything else untouched.

```bash
agentcohort refresh-skills              # preview + interactive confirm
agentcohort refresh-skills --dry-run    # preview only
agentcohort refresh-skills --yes        # apply, no prompt
agentcohort refresh-skills --backup     # back up each rewritten file
```

Safety contract:

| File state | What refresh-skills does |
|---|---|
| Skill region matches current → noop | reported as `noop` |
| Skill region stale, rest matches bundled | rewrites, reports `updated` |
| Has `_agentcohort_local: true` | reported as `skipped-local`, never touched |
| Body outside skill region also diverges from bundled | reported as `skipped-user-edited` — must reconcile via `upgrade` first |
| Missing the `<!-- agentcohort-skills-* -->` markers (legacy install) | reported as `skipped-missing-markers` — run `upgrade` once to land the markers |

`agentcohort doctor` warns about skill drift with a check named
`agents.skills-stale`. The message points directly at
`refresh-skills` so you don't have to guess between `upgrade` and
`refresh-skills` — drift in just the skill list is a refresh-skills
job; drift in the bundled template body is an upgrade job.

## Memory layer (v0.10+)

These commands need their own deep guide — see [docs/memory.md](memory.md) for the model. The reference below covers flags only.

### `agentcohort memory init`

Synopsis: `agentcohort memory init [--commit-all | --gitignore-all] [--yes]`

Initializes `.agentcohort/memory/{shared,local}` and `.agentcohort/runs/`. Updates `.gitignore` per mode.

| Flag | Effect |
|---|---|
| `--commit-all` | Do not touch `.gitignore` — everything committed |
| `--gitignore-all` | Gitignore the entire `.agentcohort/` dir |
| (default) | Commit `shared/`; gitignore `local/` + `runs/` |
| `--yes` | Non-interactive (skip confirmation prompts) |

### `agentcohort memory write`

Synopsis: `agentcohort memory write <collection> --json-body=<JSON> --source=<agent> --confidence=<0..1> --verified=<true|false> --task-summary="<txt>" [--run-id=<uuid>] [--files=<csv>]`

Validates the body against the collection's Zod schema + secret-guard regexes, fills in `id`/`ts`/`context.commit`, atomically appends to the right file. See [docs/memory.md#universal-entry-shape](memory.md#universal-entry-shape) for the schema.

| Disposition | Meaning |
|---|---|
| `written` | Entry appended successfully |
| `rejected-malformed` | `--json-body` was not valid JSON |
| `rejected-schema` | Body did not match collection schema |
| `rejected-secret` | Body contains a recognized secret pattern |
| `rejected-collection` | Unknown collection name |
| `rejected-source` | Unknown source agent name |
| `rejected-no-run-id` | `scratch` writes require `--run-id` |

### `agentcohort memory read`

Synopsis: `agentcohort memory read <collection> [--filter=k=v]... [--limit=N] [--since=<dur>] [--run-id=<uuid>] [--with-verifications] [--no-stale-check] [--json]`

| Flag | Effect |
|---|---|
| `--filter=k=v` | Repeatable; top-level field or `body.dotted.path` equality |
| `--limit=N` | Keep LAST N matching entries |
| `--since=<dur>` | `7d`, `24h`, `30m`, `60s` |
| `--run-id=<uuid>` | For scratch, picks the per-run file; else filters entries with matching `run_id` |
| `--with-verifications` | For `decisions`/`bugs`, joins latest `verifications` entry by `target_id` → adds `_effective_verified` / `_verification_evidence` / `_verification_by_stage` |
| `--no-stale-check` | Skip read-time `git diff` (faster in CI / tests). Default: each entry gains `_effective_stale: boolean` |

### `agentcohort memory search`

Synopsis: `agentcohort memory search <keyword> [--collection=<name>] [--regex] [--limit=N] [--json]`

Substring (case-insensitive default) or regex search across all non-scratch collections (or scoped to one). Walks string + array-of-string + nested object fields recursively.

### `agentcohort memory mark-stale`

Synopsis: `agentcohort memory mark-stale (--auto | --id=<uuid> | --filter=files=<path>) [--collection=<name>] [--unstale] [--dry-run]`

The only mutating op on existing entries — uses lock + rewriteJsonl. Modes are mutually exclusive.

| Mode | Effect |
|---|---|
| `--auto` | Per-commit `git diff --name-only <context.commit>..HEAD`; marks entries whose files appear in the diff |
| `--id=<uuid>` | Marks one specific entry |
| `--filter=files=<path>` | Marks all entries whose `context.files` contains `<path>` (substring) |
| `--unstale` | Flip to `false` instead of `true` |
| `--dry-run` | Preview only, no write |

### `agentcohort memory list-runs`

Synopsis: `agentcohort memory list-runs [--limit=N] [--since=<dur>] [--json]`

Joins `start` + `end` events from `runs/INDEX.jsonl`. Orphan runs (start without end) show `outcome=running`.

### `agentcohort memory scan-modules`

Synopsis: `agentcohort memory scan-modules [--root=<path>] [--dry-run] [--yes] [--json]`

Hybrid: if `claude` is in PATH, shells to `claude --print --model=claude-haiku-4-5-20251001` per module to generate `MODULE_MAP_BODY` JSON; else prints the prompt for manual paste-back. Warns if `.wolf/anatomy.md` exists (OpenWolf overlay — `module-map` would be redundant).

### `agentcohort memory scan-hotspots`

Synopsis: `agentcohort memory scan-hotspots [--threshold=N] [--json]`

Counts file occurrences in `bugs.jsonl` (last 30 days). Files with ≥ threshold bugs get a `HOTSPOT_BODY` entry. Idempotent — re-running updates existing entries. Removes entries that drop below threshold.

### `agentcohort memory compact`

Synopsis: `agentcohort memory compact [--collection=<name>] [--older-than=<dur>] [--keep-last=<N>] [--dry-run]`

Bookkeeping merge — replaces ≥ 10 old entries in a collection with 1 synthetic "compacted" entry preserving `merged_count` + `ts_range` + `id_range`. NEVER compacts `audit`, `verifications`, or `scratch`.

### `agentcohort memory clean --runs`

Synopsis: `agentcohort memory clean --runs [--older-than=30d] [--orphans] [--dry-run]`

Reaps `runs/<id>/` directories matching `--older-than` or `--orphans` (start without end > 1h grace). Also strips matching INDEX events.

## Run lifecycle

### `agentcohort run start`

Synopsis: `agentcohort run start --pipeline=<name> [--tier=<n>] [--task-summary="<txt>"]`

Generates a UUIDv4, appends a `start` event to `runs/INDEX.jsonl`, prints **only the UUID** to stdout (capture via `RUN_ID=$(agentcohort run start --pipeline=quick-fix)`).

With `--stage=<name> --run-id=<uuid>` instead of `--pipeline`, emits a `stage_start` event for that run-id (used by per-stage telemetry). Validation: `--stage` requires `--run-id`; `--stage` and `--pipeline` are mutually exclusive.

### `agentcohort run end`

Synopsis: `agentcohort run end --run-id=<uuid> --outcome=<success|aborted|failed> [--agents-run=<csv>] [--gates-fired=<csv>]`

Appends an `end` event matching the run-id. With `--stage=<name>`, emits `stage_end` instead.

## Gates

### `agentcohort gate record`

Synopsis: `agentcohort gate record --run-id=<uuid> --gate=<name> --outcome=<verb> --proposed-content="<txt>" --posing-agent=<name> [--reason="<txt>"]`

Wraps `memory write audit` with audit-specific defaults (`source=dispatcher`, `confidence=1.0`, `verified=true`). Requires `--reason` when outcome is `rejected` or `escalated`.

Valid gate names: `architect`, `plan`, `bottleneck`, `root-cause`, `expert-council`.

## Telemetry

### `agentcohort stats`

Synopsis: `agentcohort stats [--since=<dur>] [--compare-naive] [--json]`

Aggregates `runs/INDEX.jsonl` by pipeline + outcome + duration. Computes estimated cost via the static per-agent token table. `--compare-naive` adds a hypothetical full-pipeline cost for the same run set; reports `Savings: X%` to validate the README claim.

```
agentcohort stats — last 7 days

Runs: 47 total
  Success: 37  Aborted: 6  Failed: 4

Per pipeline:
  /dev-flow: 12 runs   median 8m 22s
  /quick-fix: 18 runs  median 2m 14s

Gates:
  architect: 12 fired
  plan: 12 fired

Token estimate:
  Actual: ~$0.47
  Naïve:  ~$1.23
  Savings: 62%
```

## Meta

### `agentcohort completion`

Synopsis: `agentcohort completion bash|zsh|pwsh`

Emits a shell completion script. Pipe to your shell config; re-run after package upgrades to refresh baked-in names. See [docs/configuration.md#shell-completion](configuration.md#shell-completion) for setup snippets per shell.

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

### `agentcohort --version` / `agentcohort --help`

Print the version / help text.

---

**See also:** [docs/memory.md](memory.md) for the memory model · [docs/configuration.md](configuration.md) for `.agentcohort.json` · [docs/agents.md](agents.md) for agent + pipeline details.
