import { paint } from './logger';

export interface ParsedArgs {
  command: string | null;
  /** First positional after the command (e.g. `list agents` → "agents"). */
  subcommand: string | null;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  backup: boolean;
  reconfigure: boolean;
  json: boolean;
  diff: boolean;
  help: boolean;
  version: boolean;
  unknown: string[];
}

const FLAGS: Record<string, keyof ParsedArgs> = {
  '--yes': 'yes',
  '-y': 'yes',
  '--dry-run': 'dryRun',
  '--force': 'force',
  '--backup': 'backup',
  '--reconfigure': 'reconfigure',
  '--json': 'json',
  '--diff': 'diff',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version',
};

/** Pure, deterministic argument parser. Unknown tokens are collected, not thrown. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    subcommand: null,
    yes: false,
    dryRun: false,
    force: false,
    backup: false,
    reconfigure: false,
    json: false,
    diff: false,
    help: false,
    version: false,
    unknown: [],
  };
  for (const arg of argv) {
    if (arg.startsWith('-')) {
      const key = FLAGS[arg];
      if (key) {
        (parsed as unknown as Record<string, boolean>)[key] = true;
      } else {
        parsed.unknown.push(arg);
      }
    } else if (parsed.command === null) {
      parsed.command = arg;
    } else if (parsed.command === 'list' && parsed.subcommand === null) {
      parsed.subcommand = arg;
    } else {
      parsed.unknown.push(arg);
    }
  }
  return parsed;
}

export function helpText(): string {
  const b = (s: string) => paint(s, 'bold');
  return `
${b('agentcohort')} — install a principal/staff-level Claude Code AI engineering org.

${b('USAGE')}
  agentcohort <command> [options]

${b('COMMANDS')}
  init                 Install agents, workflow commands and routing rules
                       into ./.claude and ./CLAUDE.md of the current project.
  config               Re-prompt the model-tier strategy, show a diff of
                       any pending changes to installed agents, and apply
                       them with confirmation.
  doctor               Read-only health check: verify the install is
                       intact, the config is valid, and no installed file
                       has drifted from the bundled template. Exits 0 when
                       healthy, 1 on any warning/error.
  lint                 Read-only content-quality check: validates agent
                       frontmatter, boot-directive presence, model tier
                       references, and slash-command references in
                       CLAUDE.md. Complements doctor — doctor checks
                       structure, lint checks content. Exits 0 on clean.
  status               At-a-glance read-only report: version, agent /
                       command counts, CLAUDE.md routing presence,
                       resolved model tiers + gate modes, OpenWolf
                       activity, and planned upcoming features.
  list [scope]         Enumerate what is available in the install. Scope
                       is one of: agents (per-file install status + model
                       tier), commands (slash-commands with descriptions),
                       gates (review gates + current mode + when each
                       pauses). Omit scope to show all three.
  upgrade              Sync the project's .claude/ templates and CLAUDE.md
                       routing section to the bundled version. Refreshes
                       outdated files automatically and prompts before
                       overwriting any file the user has edited locally.
                       Preserves .agentcohort.json (models + gates).

${b('OPTIONS')}
  --yes, -y            Non-interactive. Safe defaults: new files created;
                       existing conflicting files backed up then updated;
                       an existing CLAUDE.md routing section is left untouched.
  --dry-run            Print exactly what would be created/updated. Writes
                       nothing. Implies non-interactive (safe defaults).
  --force              Overwrite conflicting files / replace the routing
                       section without prompting (no backup unless --backup).
  --backup             Always back up a file before overwriting it.
                       Backup name: <file>.backup-YYYYMMDD-HHMMSS
  --reconfigure        (init only) Re-prompt model-tier strategy even if a
                       .agentcohort.json already exists. Requires a TTY;
                       not compatible with --yes.
  --diff               (upgrade only) Print the unified diff of every
                       file that would be refreshed or overwritten, in
                       addition to the per-conflict prompt's diff view.
  --json               (doctor, lint, status, list) Emit the report as
                       JSON instead of human-readable text. Exit code is
                       the same in both modes.
  --help, -h           Show this help.
  --version, -v        Print the version.

${b('WHAT GETS INSTALLED')}
  .claude/agents/      15 subagents (scout, architect, planner, implementer,
                       reviewer, bug-hunter, root-cause-analyst, ...).
  .claude/commands/    7 workflow commands.
  CLAUDE.md            Appends a "# Agentcohort Routing Rules" section.
  .agentcohort.json    (Only when user customizes model-tier strategy.)

${b('WORKFLOW COMMANDS (run inside Claude Code)')}
  /auto-flow           Classify the task and pick the right workflow.
  /dev-flow            Feature/refactor: scout -> architect -> plan ->
                       implement -> test -> review.
  /bug-audit           Investigate ONLY (no fixes): hunt -> evidence ->
                       root cause -> expert council -> recommendation.
  /bug-fix-approved    Fix an approved bug: fix -> regression -> test -> review.
  /perf-hunt           Measure -> bottleneck -> safe optimize -> verify -> review.
  /review-diff         Final reviewer on the current diff.
  /fix-blockers        Fix only listed blockers, then verify.

Existing files are NEVER deleted and NEVER silently overwritten.
`;
}
