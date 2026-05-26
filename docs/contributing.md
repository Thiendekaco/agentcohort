# Contributing

Thanks for considering a contribution! agentcohort is a small TypeScript CLI — most PRs are quick to land if they follow the conventions below.

## Development

```bash
git clone https://github.com/Thiendekaco/agentcohort.git
cd agentcohort
npm install
npm run build       # tsc + sync-boot-directive + copy templates → dist/
npm test            # vitest, full suite
npm run test:watch  # vitest in watch mode
```

After fresh checkout: **always run `npm run build` first** before `npm test`. The `sync-boot-directive.mjs` step bakes the per-agent skill + memory sections into the bundled templates; without it, integrity-stamp checks fail.

### Project layout

- `src/` — TypeScript source (flat layout, no subdirectories beyond `src/templates/`)
- `test/` — vitest tests (flat layout, mirrors `src/` file names)
- `src/templates/agents/` — 16 bundled agent markdown files
- `src/templates/commands/` — 9 bundled command markdown files
- `src/templates/_boot-directive.md` — the source of truth for skill + memory marker injection
- `scripts/sync-boot-directive.mjs` — bakes per-agent affinity content at build time

## Branching strategy

Two long-lived branches:

- **`dev`** — integration / staging. All feature PRs target `dev`. Nothing on `dev` publishes to npm.
- **`main`** — production. Only ever updated by merging `dev` → `main` via a Release PR.

```
feature branch  →  dev  →  main  →  npm
   (PR #N)         (PR M)    (release-please)
```

## Release flow

agentcohort uses [release-please](https://github.com/googleapis/release-please) for version + CHANGELOG + tag automation.

1. **Merge feature PRs to `dev`** with conventional commit titles (`feat:` / `fix:` / `docs:` / `chore:` / etc.).
2. **Open a `dev → main` PR** when ready to ship. **The PR title MUST start with a conventional commit prefix** — release-please reads only the merge commit subject on `main`, so a non-conventional title (e.g. `Release: ship X.Y.Z`) is silently skipped.
   - For feature releases: `feat: ship 0.X.0 — <summary>`
   - For bugfix releases: `fix: ship 0.X.Y — <summary>`
3. **Merge the dev → main PR.** release-please bot sees the conventional commits since the last tag, opens a `chore(main): release X.Y.Z` PR with version bump + CHANGELOG entry.
4. **Merge the release-please PR.** A GitHub Release + git tag are created.
5. **The publish workflow** listens on `release: published` and runs `npm publish` automatically.

### Pre-1.0 version bumps

Repo config (`release-please-config.json`) sets `bump-minor-pre-major: true`. While major < 1:
- `feat:` commits → **MINOR** bump (0.10.0 → 0.11.0)
- `fix:` commits → **PATCH** bump (0.10.0 → 0.10.1)
- `BREAKING CHANGE:` → MINOR (pre-1.0 stays minor)

So a release PR titled `feat: ship 0.10.1 — ...` will actually bump to **0.11.0**, not 0.10.1. Pick the title to match the bump release-please will compute.

## Docs style

- Body of each doc is short, scannable, examples first
- Reference tables over prose where possible
- Each new CLI command → one entry in `docs/cli-reference.md` (Quick index table + body section)
- Each new memory collection / safety field → entry in `docs/memory.md`
- Each new `.agentcohort.json` field → entry in `docs/configuration.md`
- README stays ~150 lines; only marketing / landing-page content lives there

## Tests

- Tests live in `test/` (flat); file name mirrors the source it tests (`src/foo.ts` → `test/foo.test.ts`)
- Use vitest's `describe` / `it` / `expect`
- For commands that touch the filesystem, use `mkdtempSync(join(tmpdir(), 'agentcohort-...-'))` + `rmSync(dir, { recursive: true, force: true })` in `beforeEach` / `afterEach`
- For git-aware tests, `execSync('git init -q', { cwd: dir })` + a single empty commit suffices
