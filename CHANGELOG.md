# Changelog

All notable changes to `agentcohort` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-05-20

First minor release. Two feature areas plus a new dev-branch release workflow.

### Added

- **Agent ↔ user-rules interop.** Every installed agent now boots by reading
  the project's `CLAUDE.md` content **outside** the
  `# Agentcohort Routing Rules` section and checks for installed skills that
  match the current task. User project rules take precedence over the
  agent's own prompt; matching skills are invoked instead of being
  re-implemented. A new `## Interoperability & precedence` section in the
  tool-owned CLAUDE.md block documents the contract for users.
- **Boot directive sync pipeline.** Single source-of-truth file
  `src/templates/_boot-directive.md` is synced into all 15 agent templates
  via `scripts/sync-boot-directive.mjs` (idempotent, CRLF-safe, preserves
  hand-edits outside the delimited region). Wired into `npm run build` so
  the directive never goes stale in `dist/`.
- **Model-tier configuration.** `agentcohort init` (interactive) now prompts
  for an auto-vs-custom model strategy. Custom triggers a 3-step prompt for
  premium / mid / cheap tier model IDs, persisted to `.agentcohort.json`.
  Installed `.claude/agents/*.md` files always contain concrete model IDs
  in their `model:` frontmatter — never an alias or placeholder.
- **`agentcohort config` subcommand.** Re-prompts the model-tier strategy,
  shows a diff of pending changes to installed agents, applies with
  confirmation.
- **`agentcohort init --reconfigure` flag.** Forces the model-tier prompt
  even when `.agentcohort.json` already exists. Requires a TTY; explicitly
  rejected when combined with `--yes` or `--force`.
- **`.agentcohort.json` schema (v1).** Versioned JSON config at project
  root. Includes `$schema` URL for editor autocomplete. Validates strictly
  (rejects malformed JSON, wrong version, missing tier keys, empty or
  whitespace-only values). Ignores unknown top-level keys for forward
  compatibility.
- **Dev-branch release workflow.** Two-branch model: feature PRs target
  `dev` (integration / staging, no publish); `dev` → `main` triggers the
  release workflow. Documented in README under "Branching & releases".

### Changed

- README "zero runtime dependencies" wording dropped to reflect the new
  `@inquirer/prompts` dependency.
- `installer.ts` `InitOptions` gains a required `models: ModelsConfig`
  field; agent template rewriting is hooked in before the existing
  comparison / conflict logic. Command files (`.claude/commands/*.md`)
  bypass the renderer.

### Fixed

- Existing `--force` regression test in `test/installer.test.ts` updated to
  count `# Agentcohort Routing Rules` heading lines only (using
  `^...$/gm`), not literal text — required because the new interop section
  references the heading name inside a code-span.

### Dependencies

- Added: `@inquirer/prompts` `^7` (interactive model-tier prompt).
  First runtime dependency the package has shipped.

### Upgrade notes

- **No breaking changes** for existing installs. Projects on `0.1.x`
  upgrade silently: no `.agentcohort.json` → built-in default model IDs;
  the new boot directive appears in agent files on the next
  `agentcohort init` run.
- **Hand-edits respected.** If you edited an installed agent's `model:`
  line to a specific ID, subsequent `init` / `config` runs leave it
  alone.
- **Non-interactive mode never auto-creates `.agentcohort.json`.** Its
  absence is a meaningful signal ("I did not customize") and the tool
  falls back to defaults.

### Quality gates at release

- 84 unit tests across 9 files pass.
- 5 automated smoke scenarios pass (defaults install, pre-existing valid
  config applied, malformed config rejected, `--yes --reconfigure`
  rejected, `--force --reconfigure` rejected).
- Manual TUI smoke scenarios verified by maintainer.

## [0.1.1] — Prior

- Recommend global install for the CLI (README change).

## [0.1.0] — Prior

- Initial public release on npm as `agentcohort` (rebrand from earlier
  internal names).
- 15 subagents + 7 workflow commands installed via `agentcohort init`.
- `# Agentcohort Routing Rules` section managed in project `CLAUDE.md`.
- Conservative file handling: never deletes, never silently overwrites,
  idempotent, backup-on-overwrite, dry-run, surgical CLAUDE.md edits.

[0.2.0]: https://github.com/Thiendekaco/agentcohort/releases/tag/v0.2.0
[0.1.1]: https://github.com/Thiendekaco/agentcohort/releases/tag/v0.1.1
[0.1.0]: https://github.com/Thiendekaco/agentcohort/releases/tag/v0.1.0
