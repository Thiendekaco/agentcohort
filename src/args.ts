import { paint } from './logger';

export interface ParsedArgs {
  command: string | null;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  backup: boolean;
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
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version',
};

/** Pure, deterministic argument parser. Unknown tokens are collected, not thrown. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    yes: false,
    dryRun: false,
    force: false,
    backup: false,
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
    } else {
      parsed.unknown.push(arg);
    }
  }
  return parsed;
}

export function helpText(): string {
  const b = (s: string) => paint(s, 'bold');
  return `
${b('agentcrew')} — install a principal/staff-level Claude Code AI engineering org.

${b('USAGE')}
  agentcrew <command> [options]

${b('COMMANDS')}
  init                 Install agents, workflow commands and routing rules
                       into ./.claude and ./CLAUDE.md of the current project.

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
  --help, -h           Show this help.
  --version, -v        Print the version.

${b('WHAT GETS INSTALLED')}
  .claude/agents/      15 subagents (scout, architect, planner, implementer,
                       reviewer, bug-hunter, root-cause-analyst, ...).
  .claude/commands/    7 workflow commands.
  CLAUDE.md            Appends a "# Agentcrew Routing Rules" section.

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
