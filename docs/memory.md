# Memory Layer

agentcohort agents are stateless by default. The memory layer (introduced in v0.10.0, extended in v0.11.0) adds 4 storage layers + per-run scratchpad + per-run telemetry index, with safety metadata on every entry.

## Overview

| Layer | Storage | Lifetime | Who reads / writes |
|---|---|---|---|
| **1. Run Scratchpad** | `runs/<id>/scratch.jsonl` | Per pipeline run | Every agent (share findings within a run) |
| **2. Project Memory** | `memory/shared/{decisions,bugs,hotspots,conventions,module-map}.jsonl` | Permanent | scout/architect/bug-fixer/final-reviewer + dispatcher |
| **3. Decision Audit** | `memory/shared/audit.jsonl` + `verifications.jsonl` | Permanent | dispatcher (gates) + test-verifier (refute/confirm) |
| **4. Run History / Telemetry** | `runs/INDEX.jsonl` | Per pipeline run + lifecycle commands clean up | `agentcohort stats`, dispatcher routing |

## File layout

Created by `agentcohort memory init`:

```
.agentcohort/
  memory/
    shared/                  # COMMITTED to git
      decisions.jsonl        # architect verdicts (approved only)
      bugs.jsonl             # verified bug fix patterns
      audit.jsonl            # every gate fire (approve/reject/escalate)
      verifications.jsonl    # append-only verification claims
      hotspots.jsonl         # file/module fragility (derived from bugs.jsonl)
      conventions.jsonl      # accumulated project style/conventions
      module-map.jsonl       # high-level project structure
    local/                   # gitignored (reserved for project-local use)
  runs/                      # gitignored
    <run-id>/
      scratch.jsonl          # within-pipeline scratchpad
    INDEX.jsonl              # start/end + stage_start/stage_end events per pipeline run
```

**Initialize once per project:**

```bash
agentcohort memory init              # default: shared committed, local + runs gitignored
agentcohort memory init --commit-all # everything committed (max-share teams)
agentcohort memory init --gitignore-all # everything gitignored (max-privacy)
```

## Layer 1 — Run Scratchpad

Within a single pipeline run, agents share findings via `runs/<run-id>/scratch.jsonl`. Agent N writes its discoveries (e.g. file paths, code patterns); agent N+1 reads them without re-scanning the same files. Each run gets its own directory so scratch data stays isolated between runs. Clean up old runs with `agentcohort memory clean --runs [--older-than=30d] [--orphans] [--dry-run]`.

## Layer 2 — Project Memory

5 collections. Each follows the universal entry shape (see [Universal entry shape](#universal-entry-shape)) with a body schema specific to the collection.

**CLI commands for project memory:**

```bash
agentcohort memory write <collection> --json-body=<JSON> --source=<agent> \
                                     --confidence=<0..1> --verified=<true|false> \
                                     --task-summary="<txt>" [--run-id=<uuid>] [--files=<csv>]
agentcohort memory read <collection>  [--filter=k=v...] [--limit=N] [--since=<dur>] \
                                      [--run-id=<uuid>] [--with-verifications] [--json]
agentcohort memory search <keyword>   [--collection=<name>] [--regex] [--limit=N]
agentcohort memory mark-stale  (--auto | --id=<uuid> | --filter=files=<path>) \
                               [--collection=<name>] [--unstale] [--dry-run]
agentcohort memory scan-hotspots   [--threshold=N] [--json]
agentcohort memory scan-modules    [--root=<path>] [--dry-run] [--yes] [--json]
agentcohort memory compact         [--collection=<name>] [--older-than=<dur>] [--keep-last=<N>] [--dry-run]
```

### `decisions.jsonl`

Architect verdicts on approach choice. Written by `solution-architect` when a gate approves.

**Schema (`DECISION_BODY`):**
- `approach_chosen: string` (min 1)
- `alternatives_considered: string[]`
- `trade_offs: string`
- `gate_outcome: 'approved' | 'rejected' | 'escalated' | 'auto-skipped'`

### `bugs.jsonl`

Verified bug pattern + fix. Written by `bug-fixer` after a fix lands + tests pass.

**Schema (`BUG_BODY`):**
- `symptoms: string` (min 1)
- `root_cause: string` (min 1)
- `fix_summary: string` (min 1)
- `affected_files: string[]`
- `test_added: string | null`

### `hotspots.jsonl`

File / module fragility, derived from `bugs.jsonl` by `agentcohort memory scan-hotspots`. Used by dispatcher to force the architect gate ON for fragile files. Idempotent — re-running updates existing entries rather than duplicating them.

**Schema (`HOTSPOT_BODY`):**
- `file_path: string` (min 1)
- `bug_count: number` (non-negative int)
- `recent_bug_ids: string[]` (uuids)
- `fragility_score: number` (0..1, linear: `min(1, bug_count / 10)`)
- `notes?: string` (max 500 chars)

**Example entry:**
```json
{"id":"...","ts":"...","source":"cli","confidence":1,"verified":true,"stale":false,
 "context":{"files":["src/auth.ts"],"commit":"abc1234","task_summary":"hotspot scan"},
 "body":{"file_path":"src/auth.ts","bug_count":3,"recent_bug_ids":["...","...","..."],"fragility_score":0.3}}
```

### `conventions.jsonl`

Accumulated project style / conventions. Written by `final-reviewer` when a review comment is accepted.

**Schema (`CONVENTION_BODY`):**
- `rule: string` (min 1) — e.g. "use `<` instead of `<=`"
- `scope: string` — glob: `src/**`, `test/**`, `all`
- `examples_good: string[]` (default [])
- `examples_bad: string[]` (default [])
- `derivation: 'user-confirmed' | 'final-reviewer-derived'`

### `module-map.jsonl`

High-level project structure. Populated by `agentcohort memory scan-modules`. Skipped if OpenWolf `.wolf/anatomy.md` is present (see [OpenWolf overlay](#openwolf-overlay)).

`scan-modules` walks `--root` (default `src`), lists top-level dirs. If `claude` CLI is in PATH, it shells to `claude --print --model=claude-haiku-4-5-20251001` per module to generate `MODULE_MAP_BODY` JSON and ingest it. Otherwise it prints the prompt for manual paste-back.

**Schema (`MODULE_MAP_BODY`):**
- `module: string` (min 1) — e.g. `src/api/users`
- `description: string` (min 1, max 500)
- `responsibilities: string[]` (min 1)
- `key_files: string[]` (default [])
- `dependencies: string[]` (default [])

## Layer 3 — Decision Audit

### `audit.jsonl`

Every gate fire — approve / reject / escalate / auto-skipped — with reason. Distinct from `decisions.jsonl` (which only stores approved technical conclusions). Captures the *process meta*: why was this approach rejected last week?

**Schema (`AUDIT_BODY`):**
- `gate: 'architect' | 'plan' | 'bottleneck' | 'root-cause' | 'expert-council'`
- `outcome: 'approved' | 'rejected' | 'escalated' | 'auto-skipped'`
- `reason: string | null` (required when outcome ∈ {rejected, escalated}, max 2000)
- `proposed_content: string` (max 2000) — short summary of what was up for approval
- `posing_agent: string` — which agent's output the gate guarded

### `verifications.jsonl`

Append-only sidecar — downstream stages confirm or refute earlier `decisions.jsonl` / `bugs.jsonl` entries. Readers join the LATEST verification per `target_id` to compute the effective `verified` state.

**Schema (`VERIFICATION_BODY`):**
- `target_id: string` (uuid)
- `target_collection: 'decisions' | 'bugs'`
- `verified: boolean` — true = confirmed; false = refuted
- `evidence: string` (max 1000) — proof (e.g. "tests passed")
- `by_stage: string`

**Verification chain example:**

```bash
# bug-fixer writes a bug entry (verified=false initially)
agentcohort memory write bugs --json-body='{...}' --source=bug-fixer --verified=false ...

# Later, test-verifier confirms it
agentcohort memory write verifications \
  --json-body='{"target_id":"<bug-id>","target_collection":"bugs","verified":true,"evidence":"tests passed","by_stage":"test-verifier"}' \
  --source=test-verifier --verified=true ...

# Read bugs WITH the latest verification joined
agentcohort memory read bugs --with-verifications
# → each entry gains _effective_verified, _verification_evidence, _verification_by_stage
```

## Layer 4 — Run History / Telemetry

`runs/INDEX.jsonl` is a discriminated-union event log per pipeline run. 4 event types. Queried by `agentcohort memory list-runs` and `agentcohort stats`.

| Event | When emitted | Required fields |
|---|---|---|
| `start` | Pipeline begins (dispatcher calls `agentcohort run start --pipeline=...`) | `run_id`, `pipeline`, `ts` |
| `stage_start` | Each agent begins (boot directive instructs `run start --stage=<name>`) | `run_id`, `stage`, `ts` |
| `stage_end` | Each agent finishes | `run_id`, `stage`, `outcome`, `ts` |
| `end` | Pipeline finishes (last agent of the pipeline calls `run end`) | `run_id`, `outcome`, `ts` |

Readers (`memory list-runs`, `stats`) join events by `run_id` to compute duration, identify orphans, and aggregate per-pipeline metrics.

**Example INDEX.jsonl sequence:**

```jsonl
{"event":"start","run_id":"...","pipeline":"dev-flow","tier":3,...}
{"event":"stage_start","run_id":"...","stage":"repo-scout","ts":"..."}
{"event":"stage_end","run_id":"...","stage":"repo-scout","outcome":"success","ts":"..."}
{"event":"stage_start","run_id":"...","stage":"solution-architect",...}
{"event":"stage_end","run_id":"...","stage":"solution-architect","outcome":"success",...}
{"event":"end","run_id":"...","outcome":"success",...}
```

**`memory list-runs` example:**

```bash
agentcohort memory list-runs --limit=20 --since=7d
agentcohort memory list-runs --json | jq '.[] | select(.outcome=="aborted")'
```

Output columns: `run_id`, `ts`, `pipeline`, `tier`, `duration`, `outcome`, `gates_fired`.

## Universal entry shape

Every entry in every collection (and every scratch line) is a single-line JSON object matching this Zod schema:

```typescript
{
  id: uuid,
  ts: ISO8601,
  run_id: uuid | null,
  source: '<one of 18 known sources>',
  confidence: number,         // 0..1, writer self-attests
  verified: boolean,           // initial claim; verifications.jsonl refutes
  stale: boolean,              // flipped by `memory mark-stale`
  context: {
    files: string[],           // files this entry refers to
    commit: string | null,     // git SHA at write time (for staleness detection)
    task_summary: string,      // max 200 chars
  },
  body: { /* collection-specific */ },
}
```

**Known sources** (`source` enum): all 16 bundled agents + `human` + `cli`.

## 5 safety mechanisms

| Field | Purpose | Enforced where |
|---|---|---|
| `confidence` (0..1) | Writer self-attests how sure they are | Schema requires; conventions per-source documented in agent boot directive |
| `source` (enum) | Which agent (or human / cli) wrote it | Schema rejects unknown sources |
| `verified` (boolean) | Initial claim; downstream `verifications.jsonl` can confirm or refute | `memory read --with-verifications` joins the latest |
| `stale` (boolean) | Manually marked OR `_effective_stale` computed at read-time | `memory mark-stale` + read-time git diff |
| Secret guard | 7 regex patterns reject pre-write | `memory write` validation + `doctor memory.secrets-scan` retroactive |

## Dispatcher memory-aware routing

At classification time, the dispatcher reads:

1. **`runs/INDEX.jsonl`** (last 50) — for each past run, compute Jaccard similarity (threshold 0.3) vs. the current task. Surface matches in the plan.
2. **`hotspots.jsonl`** — if the task mentions a file with `fragility_score ≥ 0.5`, force the `architect` gate ON.
3. **`decisions.jsonl`** filtered to files mentioned in the task — surface verified past decisions for the architect to consider.

Routing reasoning is recorded via `agentcohort gate record --gate=architect --outcome=auto-skipped` so the audit trail captures *why* a particular pipeline was chosen.

## Per-stage events

Boot directive of every bundled agent instructs:
- At start: `agentcohort run start --stage=<agent-name> --run-id=<RUN_ID>` → emits `stage_start`
- At end: `agentcohort run end --stage=<agent-name> --run-id=<RUN_ID> --outcome=<outcome>` → emits `stage_end`

Coverage is monitored by `doctor`'s `memory.stage-events-coverage` check (warns if < 80% of last 10 runs emit stage events — re-bake via `agentcohort refresh-skills`).

## OpenWolf overlay

If a project also runs [OpenWolf](https://github.com/cytostack/openwolf), agentcohort detects three of its files and adjusts:

| OpenWolf file | agentcohort behavior |
|---|---|
| `.wolf/anatomy.md` | `memory scan-modules` warns "module-map will be redundant — continue? [y/N]"; doctor flags overlap |
| `.wolf/cerebrum.md` | `conventions.jsonl` runs in parallel; boot directive instructs agents "prefer OpenWolf on conflict"; doctor flags overlap |
| `.wolf/buglog.json` | `bug-hunter` / `root-cause-analyst` / `reproduction-engineer` already read this to check past bug fixes before re-investigating |

**Licensing reminder**: agentcohort is MIT. OpenWolf is AGPL-3.0. agentcohort only reads files OpenWolf writes — no code is bundled or linked. Use both freely if your project can accept AGPL; otherwise skip OpenWolf and use agentcohort standalone.

## Secret patterns

`agentcohort memory write` runs each entry's serialized body through these regex patterns. A match anywhere causes a hard reject with disposition `rejected-secret`.

| Pattern name | Regex | Example match |
|---|---|---|
| `aws-access-key-id` | `\bAKIA[0-9A-Z]{16}\b` | `AKIAIOSFODNN7EXAMPLE` |
| `openai-secret-key` | `\bsk-[a-zA-Z0-9]{48}\b` | `sk-aBcDeF...` (48 chars) |
| `github-token` | `\bgh[pousr]_[A-Za-z0-9]{36,255}\b` | `ghp_aBcDeF...` |
| `anthropic-key` | `\bsk-ant-[a-zA-Z0-9\-_]{90,}\b` | `sk-ant-aBcDeF...` |
| `bearer-token` | `\bBearer\s+[A-Za-z0-9_\-\.=]{20,}` | `Bearer aBcDeF...` |
| `private-key` | `-----BEGIN (?:RSA \|EC \|OPENSSH \|DSA \|PGP )?PRIVATE KEY-----` | (PEM block header) |
| `env-secret-line` | `\b(?:API_KEY\|SECRET\|TOKEN\|PASSWORD)=\S{8,}` | `API_KEY=abc123def...` |

The intent is conservative — better to miss an exotic format than block a legitimate write. Doctor's `memory.secrets-scan` provides retroactive detection.

**False positive?** Open an issue at https://github.com/Thiendekaco/agentcohort/issues with the literal string (sensitive parts redacted) + the pattern name from the error message.

**Adding a new pattern?** Edit `src/memorySecretGuard.ts` + add a test in `test/memorySecretGuard.test.ts` + update this table.

## Memory affinity (per-agent reads / writes)

Each bundled agent's boot directive contains a "Reads: X / Writes: Y" stanza so the agent only touches the collections relevant to its role (so the boot directive stays small and focused). The defaults live in `src/memoryAffinity.ts`. Override per-project in `.agentcohort.json` (see [docs/configuration.md#memory-affinity](configuration.md#memory-affinity)):

```json
{
  "version": 1,
  "memoryAffinity": {
    "my-custom-agent": { "reads": ["bugs"], "writes": ["scratch"] }
  }
}
```

User entries replace defaults for that agent (no union — explicit).

## Token estimates (`agentcohort stats`)

`agentcohort stats` aggregates `runs/INDEX.jsonl`. Token estimates are computed via a static per-agent table in `src/statsTable.ts` (estimates ±20%). Per-agent input/output tokens are multiplied by tier price ($1/$5/$15 per MTok input + $5/$15/$75 output for haiku/sonnet/opus). `--compare-naive` computes the hypothetical full-pipeline cost for the same task set, validating the cost-savings claim.

To override token estimates per agent, add to `.agentcohort.json` (available from v0.12.0 — edit source for earlier versions).

## CLI reference

14 commands total (8 core + 6 extended):

```bash
# Core
agentcohort memory init       [--commit-all|--gitignore-all]
agentcohort memory write <collection> --json-body=<JSON> --source=<agent> \
                                     --confidence=<0..1> --verified=<true|false> \
                                     --task-summary="<txt>" [--run-id=<uuid>] [--files=<csv>]
agentcohort memory read <collection>  [--filter=k=v...] [--limit=N] [--since=<dur>] \
                                      [--run-id=<uuid>] [--with-verifications] [--json]
agentcohort memory search <keyword>   [--collection=<name>] [--regex] [--limit=N]
agentcohort memory mark-stale  (--auto | --id=<uuid> | --filter=files=<path>) \
                               [--collection=<name>] [--unstale] [--dry-run]
agentcohort run start --pipeline=<name> [--tier=<n>] [--task-summary=<txt>]
agentcohort run end   --run-id=<uuid> --outcome=<success|aborted|failed> \
                      [--agents-run=<csv>] [--gates-fired=<csv>]
agentcohort gate record --run-id=<uuid> --gate=<name> --outcome=<verb> \
                        --proposed-content=<txt> --posing-agent=<name> [--reason=<txt>]

# Extended
agentcohort memory list-runs       [--limit=N] [--since=<dur>] [--json]
agentcohort memory scan-modules    [--root=<path>] [--dry-run] [--yes] [--json]
agentcohort memory scan-hotspots   [--threshold=N] [--json]
agentcohort memory compact         [--collection=<name>] [--older-than=<dur>] [--keep-last=<N>] [--dry-run]
agentcohort memory clean           --runs [--older-than=30d] [--orphans] [--dry-run]
agentcohort stats                  [--since=<dur>] [--compare-naive] [--json]
```

**Run-id flow.** The slash-command templates (`/dev-flow`, `/bug-audit`, etc.) instruct the dispatcher (or first agent) to call `agentcohort run start --pipeline=<chosen>` and pass the printed UUID as `Run ID: <uuid>` in every subsequent subagent prompt. Each agent uses that UUID to scope its `memory read scratch` and tag its `memory write` entries. The designated last agent of the pipeline calls `agentcohort run end --outcome=success`.

**`memory compact` note:** NEVER compacts `audit`, `verifications`, or `scratch` — the audit trail is always preserved. For all other collections, replaces ≥ 10 old entries with 1 synthetic "compacted" entry preserving `merged_count + ts_range + id_range`.

**`agentcohort stats` output:**

```
Runs: 47 total — Success: 37  Aborted: 6  Failed: 4
Per pipeline: /dev-flow ×12, /quick-fix ×18, /bug-audit ×7, ...
Token estimate: Actual ~$0.47   Naïve ~$1.23   Savings 62%
```

**Read-time stale detection.** `memory read` runs `git diff --name-only <context.commit>..HEAD` per unique commit (cached per-process). Each entry gains `_effective_stale: boolean` = persisted `stale` OR git-derived stale. Skip with `--no-stale-check` in tight loops.

## Doctor checks

| Check | Trigger |
|---|---|
| `memory.dir-present` | `.agentcohort/memory/` exists (info if uninitialized, ok if present) |
| `memory.git-policy` | shared committed, local + runs gitignored (warn on mismatch) |
| `memory.secrets-scan` | scans last 100 entries per file; error if any pattern matches |
| `memory.collection-sizes` | warn when any collection > 500 entries (suggest `memory compact`) |
| `memory.stale-ratio` | warn when > 30% entries `stale: true` (suggest `memory mark-stale --auto --unstale` after a refresh) |
| `memory.hotspots-fresh` | info if `hotspots.jsonl` last scan > 30 days ago |
| `memory.openwolf-overlap` | warn when both OpenWolf + corresponding agentcohort collection have content |
| `memory.stage-events-coverage` | warn if < 80% of last 10 runs emit stage events |

## Status output

`agentcohort status` includes a `Memory:` block:

```
Memory:
  Initialized:     yes
  Collections:     decisions: 47  bugs: 23  audit: 156  verifications: 41
                   hotspots: 8    conventions: 12  module-map: 7
  Runs tracked:    78 (last: 2026-05-26T11:02)
  Stage coverage:  92% (of last 10 runs emit per-stage events)
  Last write:      2026-05-26T11:02 by solution-architect → decisions
  Stale entries:   3 effective (1 persisted, 2 git-derived)
  Git policy:      shared committed, local + runs gitignored
  OpenWolf:        cerebrum detected (agents prefer on conflict)
```

## Migration

| From → To | What to do |
|---|---|
| pre-v0.10.0 → v0.10.0 | `agentcohort upgrade` (re-bakes boot directives); then `agentcohort memory init` |
| v0.10.0 → v0.11.0 | `agentcohort upgrade` (re-bakes new memory section); INDEX.jsonl from v0.10.0 still parses (additive event types); `COLLECTION_NAMES` grows from 5 → 8; existing entries are not broken (schemas additive) |
| OpenWolf user joining | Existing `.wolf/buglog.json` reads keep working; new overlay surfaces overlap warnings on `module-map` + `conventions` |

## Roadmap

| Version | Item |
|---|---|
| v0.12.0+ | LLM-based `memory compact` (semantic summarization) |
| v0.12.0+ | Embedding-based dispatcher similarity (replace Jaccard) |
| v0.12.0+ | `.agentcohort.json` override for `tokenEstimates` |
| v0.12.0+ | `hotspots` derivation by churn (not just bug count) |
| TBD | Hot-reload `stats`, dashboard UI |

See [docs/contributing.md](contributing.md) if you want to ship one of these.
