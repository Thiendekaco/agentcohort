# Agentcohort Routing Rules

> Installed and managed by [`agentcohort`](https://www.npmjs.com/package/agentcohort).
> This section is owned by the tool: re-running `agentcohort init` may update
> it. Put your own project notes **outside** this section so they are never
> touched.

This project runs as an **AI software-engineering organization**. Default to
routing work through the workflow commands instead of ad-hoc editing.

## Interoperability & precedence

These rules govern how the installed agents interact with the rest of
your project's setup. They apply to every agent and every workflow.

- **Your project rules win.** Anything you write in this CLAUDE.md
  *outside* this `# Agentcohort Routing Rules` section takes precedence
  over an installed agent's prompt. On conflict, agents follow your
  rules.
- **Installed skills must be invoked when they match.** If you have a
  skill (e.g. `superpowers:*`, `gstack`, etc.) that fits the current
  task, the agent invokes it instead of re-implementing the same logic.
- **Agent prompts are a baseline, not ground truth.** When your
  CLAUDE.md specifies a tool, framework, commit style, or workflow, the
  agent uses your choice — not the default in its prompt.
- **Pipeline commands remain the default routing.** `/dev-flow`,
  `/bug-audit`, and the others are the default. A user-defined flow in
  your CLAUDE.md takes precedence when present.

## OpenWolf interop (optional)

`agentcohort` does **not** bundle [OpenWolf](https://github.com/cytostack/openwolf).
If `.wolf/` exists in the project, OpenWolf was installed separately
by the user (`npm i -g openwolf && openwolf init`), and agentcohort
agents will consult its output files for cheaper, more accurate work.

**License note.** `agentcohort` is MIT. OpenWolf is AGPL-3.0. No
OpenWolf code is required, copied, or linked by agentcohort — agents
only read text/JSON files OpenWolf has written into `.wolf/`. The
AGPL terms apply only to OpenWolf itself.

**Detection.** Agents check for `.wolf/` at boot. If present, they
read `.wolf/OPENWOLF.md` and then consult the file(s) relevant to
their role per the matrix below. If absent, agents proceed normally.
**Agents never write to `.wolf/`** — OpenWolf manages it via hooks.

**Read matrix.** When `.wolf/` is present:

| Agent | Reads from `.wolf/` | Purpose |
|---|---|---|
| `dispatcher` | presence check only | Note `OpenWolf active` in the plan output |
| `repo-scout` | `anatomy.md` | Skip files whose description suffices; estimate token cost before opening |
| `solution-architect` | `anatomy.md`, `cerebrum.md` | Module sizing + recorded architecture preferences |
| `feature-planner` | `anatomy.md`, `cerebrum.md` | File sizing + recorded preferences for plan |
| `feature-implementer`, `bug-fixer` | `cerebrum.md` (`## Do-Not-Repeat`, `## User Preferences`) | Verify the planned change does not violate a recorded rule |
| `regression-guard`, `test-verifier` | `cerebrum.md` | Recorded test conventions / scaffolding rules |
| `final-reviewer`, `perf-reviewer` | `cerebrum.md` | Run the diff against `## Do-Not-Repeat`; a violation is a BLOCKER |
| `bug-hunter`, `root-cause-analyst`, `reproduction-engineer` | `buglog.json` | Check for matching past fixes before re-investigating (verify the codebase has not drifted before accepting) |
| `performance-hunter`, `perf-optimizer` | `anatomy.md` | Token-size hints for hot-path prioritization |
| `expert-council` | `buglog.json`, `cerebrum.md` | Historical bugs + recorded preferences inform the panel's options |

**Conflict policy.** If an OpenWolf-recorded rule conflicts with this
section, OpenWolf wins (it captures what *this* project learned).
If both are silent, the agent's default playbook applies.

**Failure mode.** A missing `.wolf/` file or invalid JSON is logged
and ignored — agents must not block on OpenWolf I/O.

## Default behavior (auto-route)

For ANY user task — feature, bug, perf, refactor, review, "fix X",
"add Y", "make Z faster", "is this safe", "implement the agreed fix" —
the assistant **MUST** start by invoking `/auto-flow` with the user's
message verbatim. Do not write code, edit files, or run downstream
agents directly until the `dispatcher` has classified the task,
surfaced its recommendation, and the user has approved via the
selection prompt.

The user should not need to type a slash command. Natural-language
requests automatically route through `/auto-flow`.

**The approval prompt.** After the dispatcher prints its short
recommendation (Recommended / Cost / Why / optional Escalation), the
orchestrator calls Claude Code's **`AskUserQuestion`** tool with two
options:

- `Run recommended` — execute the dispatcher's chosen next step.
- `Pick a different flow` — show the full text flow list
  (`/quick-fix`, `/quick-feature`, `/dev-flow`, `/bug-audit`,
  `/bug-fix-approved`, `/perf-hunt`, `/review-diff`, `/fix-blockers`,
  `/repo-scout`); the user picks a letter.

The "Other" free-form slot of `AskUserQuestion` handles power-user
input:

- `abort` → stop the pipeline.
- `gates ±<name>` → per-task gate override; re-issue the prompt with
  the updated `Gates:` line.
- Anything else → treated as a clarifying question; answer it, then
  re-issue the prompt.

If `AskUserQuestion` is unavailable (older Claude Code, headless /
scripted runs), the orchestrator falls back to a numbered text panel
(`[1] Run recommended` / `[2] Pick a different flow`) and accepts
the same vocabulary.

**Exception — pure lookups answer inline** (no `/auto-flow` needed):
- "Where is file X?" / "What does function Y do?" / "Trace where Z is wired."
- Any read-only question that does not change state and does not
  require code edits.

Never silently skip the dispatcher because a task "looks small" —
sizing is the dispatcher's job, not the assistant's.

A project may opt out by writing a contrary instruction in `CLAUDE.md`
**outside** this section (per the interoperability rules above).

## Operating standard (all agents)

- Operate at **top 1% principal/staff software-engineer** level.
- **Root-cause first.** No fix without evidence and a proven root cause.
- Production-grade correctness, maintainability, reliability over cleverness
  or speed-to-type. No shallow or symptom-only fixes.
- Every important fix needs a **regression test** and a **review**.
- Always report uncertainty, assumptions, and risk explicitly.

## Tiered routing (smart dispatcher)

`/auto-flow` is the **default entry point**. It runs the cheap
`dispatcher` agent first to classify the task into a tier and print
the two-option panel; nothing else runs until the user replies
`1` / `y` / Enter (or picks a flow from `[2]`).

| Tier | When | Pipeline |
|---|---|---|
| **0** | Pure question / lookup ("where is X", "what does Y do") | Direct answer, no subagent |
| **1** | Read-only recon / trace flow | `repo-scout` only |
| **2a** | Small bug fix, root cause already known | `/quick-fix` (fixer → guard → test → reviewer) |
| **2b** | Small feature, 1–3 local files, no API/schema/auth | `/quick-feature` (scout → implementer → test → reviewer) |
| **3**  | Feature, refactor, unknown bug, perf | `/dev-flow` / `/bug-audit` / `/perf-hunt` |
| **4**  | Escalation keyword matched or architecture-sensitive | Full pipeline + architect + expert-council forced on |

**Escalation keywords** (force tier ≥ 3, prefer 4): `auth`, `login`,
`session`, `token`, `password`, `oauth`, `sso`, `schema`, `migration`,
`prisma`, `database`, `sql`, `api contract`, `public api`,
`breaking change`, `payment`, `billing`, `money`, `currency`, `balance`,
`security`, `secret`, `credential`, `cors`, `csrf`, `blockchain`,
`wallet`, `signature`, `private key`, `concurrency`, `race condition`,
`lock`, `mutex`, `transaction`, `cache`, `invalidation`, `ttl`.

Uncertainty escalates **up**, never down. The user can override at
the panel with `[2]` (pick a different flow) or `abort`.

## Workflow selection

Run `/auto-flow` when unsure — it dispatches and routes. To invoke a
specific pipeline directly:

| Situation | Command | Pipeline |
|---|---|---|
| Feature / refactor / new behavior | `/dev-flow` | scout → architect* → planner → implementer → test-verifier → final-reviewer |
| Small feature, 1–3 files, no API/schema/auth | `/quick-feature` | scout → implementer → test-verifier → final-reviewer |
| Bug / crash / regression / bad data / security / stability | `/bug-audit` | bug-hunter → root-cause-analyst → reproduction-engineer → expert-council |
| Small bug fix, root cause already known | `/quick-fix` | bug-fixer → regression-guard → test-verifier → final-reviewer |
| A specific fix was **human-approved** | `/bug-fix-approved` | bug-fixer → regression-guard → test-verifier → final-reviewer |
| Slow / bottleneck / profiling | `/perf-hunt` | performance-hunter → architect* → perf-optimizer → test-verifier → perf-reviewer |
| Review a diff / PR | `/review-diff` | final-reviewer |
| Fix specific listed blockers | `/fix-blockers` | feature-implementer → test-verifier |

\* architect stage runs only when the change is architecture-sensitive
(module boundaries, public API, data model/schema, auth, concurrency,
caching, cross-cutting behavior) — otherwise it is skipped with a reason.

## Human review gates

Some pipeline stages produce **load-bearing decisions** — an
architecture choice, a root-cause verdict, a plan that locks in the
implementation surface. agentcohort pauses the pipeline at these
points so the user can sanity-check the decision before more
expensive stages run on top of it.

**Configured gates** (load-bearing decisions default to `on`):

| Gate | Position | Default | What you confirm |
|---|---|---|---|
| `architect` | after `solution-architect` (in `/dev-flow` and `/perf-hunt`, only if arch-sensitive) | `on` | The chosen architecture + trade-offs |
| `plan` | after `feature-planner` (in `/dev-flow`) | `on` | The exact files/tests/verification before code is written |
| `bottleneck` | after `performance-hunter` (in `/perf-hunt`) | `auto` | The right bottleneck to attack before architect / optimizer cost is committed |
| `root-cause` | after `root-cause-analyst` (in `/bug-audit`) | `on` | The root cause verdict before a reproduction is built |
| `expert-council` | after `expert-council` (always, end of `/bug-audit`) | `on` | The recommended solution before `/bug-fix-approved` can run |
| `final` | after `final-reviewer` (every code change) | always on | The reviewer's APPROVE / BLOCK verdict |

**Gate modes:**

- `on` — pause every time.
- `off` — never pause.
- `auto` — pause when the dispatcher escalated to Tier 4 OR an
  escalation keyword fired (auth/schema/payment/security/concurrency/
  cache/…).

**Configure globally** with `.agentcohort.json`:

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

Missing keys fall back to defaults. Run `agentcohort config` to
re-prompt interactively.

**Per-task override** via the dispatcher's approval prompt — type into
the `AskUserQuestion` "Other" slot (or the text fallback):

```
> gates -plan             # skip the plan gate for THIS task only
> gates +architect        # force architect gate on for THIS task only
> gates +bottleneck       # force bottleneck gate on (default is auto)
```

The orchestrator updates the `Gates:` line, re-prints the panel, and
waits again. Overrides do not modify `.agentcohort.json`.

**Reply contract at a gate.** When a gate fires, the orchestrator
surfaces the relevant artifact and calls Claude Code's
**`AskUserQuestion`** tool with three options:

- `Approve` — continue to the next stage.
- `Revise` — collect free-form feedback in a follow-up message, then
  re-run the current stage with it.
- `Abort` — stop the pipeline.

If `AskUserQuestion` is unavailable (older Claude Code, headless /
scripted runs), the orchestrator falls back to a numbered text menu
and accepts `1` / `y` / Enter (Approve), `revise <feedback>`
(Revise), or `abort`.

The orchestrator does not auto-continue past a gate that is `on` and
has not been answered.

## Bug audit rule (non-negotiable)

**Never fix during a bug audit.** The audit produces: evidence → symptom →
direct cause → root cause → systemic cause → severity → affected modules →
solution options → recommended solution → trade-offs → reproduction &
regression plan → open risks. It then **stops at a human approval gate**.
Only after explicit approval does `/bug-fix-approved` change code, and only
within the approved scope.

## Model strategy

| Model | Used for |
|---|---|
| **Haiku** | Cheap exploration / scouting (`repo-scout`). |
| **Sonnet** | Implementation, testing, bug hunting, reproduction, regression, performance hunting/optimization. |
| **Opus** | Architecture, root-cause analysis, expert council, final & performance review. |

## Scope discipline

- No unrelated refactors, renames, or reformatting ("while I'm here" is
  forbidden). Unrelated improvements are **reported, not done**.
- No API / schema / auth / security / blockchain or other persistence-/
  trust-semantic changes without explicit human approval.
- Prefer the **minimal, reversible, low-blast-radius** change.
- Stay within the requested scope; surface out-of-scope findings separately.
- Always state confidence, assumptions, and residual risk.
