# Example: what `agentcohort init` generates

Running `agentcohort init` in a project produces exactly this structure
(content is shipped verbatim from [`src/templates/`](../src/templates), which
is the single source of truth — this file intentionally does not duplicate it
to avoid drift):

```
<your-project>/
├── CLAUDE.md
│     └── # Agentcohort Routing Rules     <- appended/managed section only
│                                            (your other CLAUDE.md content is
│                                             never touched)
└── .claude/
    ├── agents/
    │   ├── repo-scout.md              (model: haiku — read-only recon)
    │   ├── solution-architect.md      (model: opus  — architecture decisions)
    │   ├── feature-planner.md         (model: sonnet)
    │   ├── feature-implementer.md     (model: sonnet)
    │   ├── test-verifier.md           (model: sonnet)
    │   ├── final-reviewer.md          (model: opus  — quality gate)
    │   ├── bug-hunter.md              (model: sonnet)
    │   ├── root-cause-analyst.md      (model: opus)
    │   ├── reproduction-engineer.md   (model: sonnet)
    │   ├── regression-guard.md        (model: sonnet)
    │   ├── bug-fixer.md               (model: sonnet)
    │   ├── performance-hunter.md      (model: sonnet)
    │   ├── perf-optimizer.md          (model: sonnet)
    │   ├── perf-reviewer.md           (model: opus)
    │   └── expert-council.md          (model: opus  — pre-fix deliberation)
    └── commands/
        ├── auto-flow.md          (/auto-flow         — classify & route)
        ├── dev-flow.md           (/dev-flow          — feature pipeline)
        ├── bug-audit.md          (/bug-audit         — investigate, NO fix)
        ├── bug-fix-approved.md   (/bug-fix-approved  — fix approved bug)
        ├── perf-hunt.md          (/perf-hunt         — perf pipeline)
        ├── review-diff.md        (/review-diff       — final review only)
        └── fix-blockers.md       (/fix-blockers      — fix listed blockers)
```

Each `agents/*.md` file follows the Claude Code subagent format:

```markdown
---
name: <agent-name>
description: <when to use this agent>
tools: <comma-separated tools>
model: <haiku | sonnet | opus>
---

# Role
# Expertise Level / Operating Standard
# Mission
# Use this agent when
# Responsibilities
# Rules
# Output format
```

To preview without writing anything:

```bash
agentcohort init --dry-run
```
