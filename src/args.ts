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
  /** Show the bundled template body untouched — pre-render, pre-stamp. */
  raw: boolean;
  /** Show the bundled template after render + stamp (what init/upgrade would write). */
  bundled: boolean;
  /** (search) Restrict to agent files. */
  agents: boolean;
  /** (search) Restrict to command files. */
  commands: boolean;
  /** (search) Case-sensitive literal match. */
  exact: boolean;
  /** (search) Treat the query as an ECMAScript regex. */
  regex: boolean;
  /** (uninstall) Keep `.agentcohort.json` instead of removing it. */
  keepConfig: boolean;
  /** (uninstall) Force-remove `.agentcohort.json` (overrides the safe-default keep). */
  removeConfig: boolean;
  /** (uninstall) Keep the CLAUDE.md routing section instead of stripping it. */
  keepClaudeMd: boolean;
  /** (add) Allow scaffolding a local copy of an existing bundled file. */
  override: boolean;
  /** (add) Archetype for new agents: analyst | implementer | reviewer | gate | empty. */
  kind: string | null;
  /** (add) Frontmatter `description:` value. */
  description: string | null;
  /** (add) Frontmatter `model:` alias (haiku | sonnet | opus). */
  model: string | null;
  /** (export) Path to write the pack to. When null, write to stdout. */
  out: string | null;
  /** (export, import) Exclude `.agentcohort.json` from the pack / from import. */
  noConfig: boolean;
  help: boolean;
  version: boolean;
  unknown: string[];

  // ---- memory + run + gate flags (v0.10+) ----
  runId: string | null;
  collection: string | null;
  bodyJson: string | null;
  source: string | null;
  confidence: number | null;
  verifiedFlag: boolean | null;
  taskSummary: string | null;
  files: string[] | null;
  filters: Record<string, string>;
  limit: number | null;
  since: string | null;
  withVerifications: boolean;
  commitAll: boolean;
  gitignoreAll: boolean;
  autoStale: boolean;
  staleId: string | null;
  unstale: boolean;
  pipeline: string | null;
  tier: number | null;
  outcome: string | null;
  agentsRun: string[] | null;
  gatesFired: string[] | null;
  gate: string | null;
  reason: string | null;
  proposedContent: string | null;
  posingAgent: string | null;
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
  '--raw': 'raw',
  '--bundled': 'bundled',
  '--agents': 'agents',
  '--commands': 'commands',
  '--exact': 'exact',
  '--regex': 'regex',
  '--keep-config': 'keepConfig',
  '--remove-config': 'removeConfig',
  '--keep-claude-md': 'keepClaudeMd',
  '--override': 'override',
  '--no-config': 'noConfig',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version',
  '--with-verifications': 'withVerifications',
  '--commit-all':         'commitAll',
  '--gitignore-all':      'gitignoreAll',
  '--auto':               'autoStale',
  '--unstale':            'unstale',
};

/**
 * Flags that take a value via `--flag=value` syntax. Space-separated
 * form (`--flag value`) is intentionally NOT supported — it would
 * require lookahead and risks swallowing positionals on user typos.
 */
const VALUE_FLAGS: Record<string, keyof ParsedArgs> = {
  '--kind': 'kind',
  '--description': 'description',
  '--model': 'model',
  '--out': 'out',
  '--run-id': 'runId',
  '--collection': 'collection',
  '--json-body': 'bodyJson',
  '--source': 'source',
  '--confidence': 'confidence',
  '--verified': 'verifiedFlag',
  '--task-summary': 'taskSummary',
  '--files': 'files',
  '--limit': 'limit',
  '--since': 'since',
  '--id': 'staleId',
  '--pipeline': 'pipeline',
  '--tier': 'tier',
  '--outcome': 'outcome',
  '--agents-run': 'agentsRun',
  '--gates-fired': 'gatesFired',
  '--gate': 'gate',
  '--reason': 'reason',
  '--proposed-content': 'proposedContent',
  '--posing-agent': 'posingAgent',
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
    raw: false,
    bundled: false,
    agents: false,
    commands: false,
    exact: false,
    regex: false,
    keepConfig: false,
    removeConfig: false,
    keepClaudeMd: false,
    override: false,
    kind: null,
    description: null,
    model: null,
    out: null,
    noConfig: false,
    help: false,
    version: false,
    unknown: [],
    // memory + run + gate flags (v0.10+)
    runId: null,
    collection: null,
    bodyJson: null,
    source: null,
    confidence: null,
    verifiedFlag: null,
    taskSummary: null,
    files: null,
    filters: {},
    limit: null,
    since: null,
    withVerifications: false,
    commitAll: false,
    gitignoreAll: false,
    autoStale: false,
    staleId: null,
    unstale: false,
    pipeline: null,
    tier: null,
    outcome: null,
    agentsRun: null,
    gatesFired: null,
    gate: null,
    reason: null,
    proposedContent: null,
    posingAgent: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const flagName = arg.slice(0, eqIdx);
        const rawValue = arg.slice(eqIdx + 1);

        // Special-case: --filter=key=val → store into filters record.
        if (flagName === '--filter') {
          const sepIdx = rawValue.indexOf('=');
          if (sepIdx !== -1) {
            const filterKey = rawValue.slice(0, sepIdx);
            const filterVal = rawValue.slice(sepIdx + 1);
            parsed.filters[filterKey] = filterVal;
          } else {
            parsed.unknown.push(arg);
          }
          continue;
        }

        const valueKey = VALUE_FLAGS[flagName];
        if (valueKey !== undefined) {
          // Apply type coercions for specific fields.
          if (valueKey === 'confidence' || valueKey === 'limit' || valueKey === 'tier') {
            (parsed as unknown as Record<string, number>)[valueKey] = Number(rawValue);
          } else if (valueKey === 'verifiedFlag') {
            (parsed as unknown as Record<string, boolean>)[valueKey] = rawValue === 'true';
          } else if (valueKey === 'files' || valueKey === 'agentsRun' || valueKey === 'gatesFired') {
            (parsed as unknown as Record<string, string[]>)[valueKey] = rawValue.split(',').filter(Boolean);
          } else {
            (parsed as unknown as Record<string, string>)[valueKey] = rawValue;
          }
          continue;
        }
        parsed.unknown.push(arg);
        continue;
      }
      const key = FLAGS[arg];
      if (key) {
        (parsed as unknown as Record<string, boolean>)[key] = true;
      } else {
        parsed.unknown.push(arg);
      }
    } else if (arg.startsWith('-')) {
      const key = FLAGS[arg];
      if (key) {
        (parsed as unknown as Record<string, boolean>)[key] = true;
      } else {
        parsed.unknown.push(arg);
      }
    } else if (parsed.command === null) {
      parsed.command = arg;
    } else if (
      (parsed.command === 'list' ||
        parsed.command === 'show' ||
        parsed.command === 'search' ||
        parsed.command === 'diff' ||
        parsed.command === 'reset' ||
        parsed.command === 'completion' ||
        parsed.command === 'add' ||
        parsed.command === 'import' ||
        parsed.command === 'memory' ||
        parsed.command === 'run' ||
        parsed.command === 'gate') &&
      parsed.subcommand === null
    ) {
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
  show <name>          Print the body of one installed or bundled
                       agent / command. Use \`agent/<name>\` or
                       \`command/<name>\` to disambiguate; when a name
                       matches both kinds, both bodies are printed with
                       clear headers. Defaults to the installed file
                       (falls back to bundled with a banner when not
                       installed).
  search <keyword>     Grep across agent / command bodies. Default mode
                       is case-insensitive substring; use --exact for a
                       case-sensitive literal, or --regex for an
                       ECMAScript pattern. Restrict to one kind with
                       --agents / --commands. Searches installed files
                       first; bundled-only files are still scanned so
                       you can discover what's available pre-install.
  reset <name>         Mutating. Revert ONE installed agent / command
                       to the currently-bundled body (render + stamp).
                       Targeted complement to \`upgrade\` for fixing a
                       single hand-edited file without touching the
                       rest of the install. Use \`agent/<name>\` or
                       \`command/<name>\` to disambiguate. Refuses when
                       the file is \`extra\` (no bundled version to
                       reset to). Interactive prompt before any write;
                       skip with --yes or --force.
  diff [name]          Read-only diff between installed templates and
                       the currently-bundled versions. With no name,
                       prints a unified diff for every file that
                       differs (missing / outdated / user-edited /
                       unstamped). With a name (or \`agent/<name>\` /
                       \`command/<name>\`), diffs just that file.
                       Exits 0 when nothing differs, 1 when something
                       does — CI-friendly.
  upgrade              Sync the project's .claude/ templates and CLAUDE.md
                       routing section to the bundled version. Refreshes
                       outdated files automatically and prompts before
                       overwriting any file the user has edited locally.
                       Preserves .agentcohort.json (models + gates).
  completion <shell>   Emit a shell completion script for the named
                       shell (bash, zsh, or pwsh). Pipe to your shell
                       config — see README for one-liners. Re-run
                       after upgrading the package to refresh the
                       baked-in name lists.
  uninstall            Mutating. Remove the bundled-set files from
                       .claude/ and strip the agentcohort routing
                       section from CLAUDE.md. NEVER deletes user-
                       authored agents / commands. Defaults: section
                       removed, .agentcohort.json kept (so a re-install
                       picks up your customizations). Use
                       --keep-claude-md / --remove-config to override.
  add <name>           Mutating. Scaffold a new user-authored agent or
                       command under .claude/. The file is stamped with
                       \`_agentcohort_local: true\` so future \`upgrade\`
                       runs leave it alone. Use \`agent/<name>\` or
                       \`command/<name>\` to disambiguate (bare name
                       defaults to agent). For agents, pass
                       \`--kind=<archetype>\` (analyst | implementer |
                       reviewer | gate | empty) and optionally
                       \`--description=<text>\` / \`--model=<tier>\`.
                       Pass \`--override\` to scaffold a local copy of
                       a same-named bundled file (your edits then win
                       over the bundled body).
  skills               Read-only. Detect Claude Code skills installed
                       in this environment (user / plugin / project
                       scope) and list them with their descriptions.
                       Used by \`init\` to bake the skill list into
                       each agent's boot directive so the subagent
                       can invoke skills via the Skill tool.
  refresh-skills       Mutating. Re-bake the boot-directive skill list
                       in every installed bundled agent. Use when you
                       install or remove a skill AFTER \`init\` and
                       want the agents to pick up the new list without
                       doing a full \`upgrade\`. Local files and
                       user-edited bodies are left untouched.
  export               Read-only. Bundle every local file (\`add\` /
                       \`add --override\` output) plus \`.agentcohort.json\`
                       into a portable JSON pack. With \`--out=<path>\`
                       writes to that file; otherwise prints to stdout.
                       Use \`--no-config\` to skip the config.
  import <pack>        Mutating. Apply a pack produced by \`export\`:
                       writes each local file under .claude/ and
                       (unless \`--no-config\`) restores
                       \`.agentcohort.json\`. Refuses to overwrite an
                       existing local file without \`--force\`. Use
                       \`--backup\` to keep the previous body when
                       overwriting.

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
  --raw                (show only) Print the bundled template untouched
                       — pre-render, pre-stamp. Source-of-truth view.
  --bundled            (show only) Print the bundled template after
                       render + stamp (= exactly what \`init\` / \`upgrade\`
                       would write). Useful to compare against an
                       edited installed copy.
  --agents             (search, diff) Restrict the operation to agent files.
  --commands           (search, diff) Restrict the operation to command files.
  --exact              (search only) Case-sensitive literal match
                       instead of the case-insensitive default.
  --regex              (search only) Treat the query as an ECMAScript
                       regex (per-line match, /g flag implied).
  --keep-config        (uninstall only) Keep .agentcohort.json instead
                       of prompting / removing it.
  --remove-config      (uninstall only) Remove .agentcohort.json
                       (overrides the safe-default keep).
  --keep-claude-md     (uninstall only) Keep the CLAUDE.md routing
                       section instead of stripping it.
  --override           (add only) Scaffold a local copy of a bundled
                       file with the same name. Without it, \`add\`
                       refuses to clobber bundled names.
  --kind=<archetype>   (add only) Agent archetype: analyst, implementer,
                       reviewer, gate, or empty. Defaults to empty.
                       Determines the scaffolded role + tools list.
  --description=<txt>  (add only) Frontmatter \`description:\` for the
                       new agent / command. Defaults to a TODO line.
  --model=<tier>       (add only, agents) Model tier alias: haiku /
                       sonnet / opus. Defaults to sonnet.
  --out=<path>         (export only) Write the pack to this file instead
                       of stdout.
  --no-config          (export, import) Exclude .agentcohort.json from
                       the pack / from the import.
  --json               (doctor, lint, status, list, show, search, diff,
                       export, import) Emit the report as JSON instead
                       of human-readable text. Exit code is the same.
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

${b('Memory layer (v0.10+):')}
  agentcohort memory init [--commit-all|--gitignore-all] [--yes]
      Initialize .agentcohort/memory/{shared,local} and runs/.
  agentcohort memory write <collection> --json-body=<JSON> --source=<agent> \\
                           --confidence=<0..1> --verified=<true|false> \\
                           --task-summary="<txt>" [--run-id=<uuid>] [--files=<csv>]
      Append a validated entry (Zod schema + secret guard).
  agentcohort memory read <collection> [--filter=k=v...] [--limit=N] \\
                          [--since=<dur>] [--run-id=<uuid>] [--with-verifications] [--json]
      Read entries with filters and optional verification join.
  agentcohort memory search <keyword> [--collection=<name>] [--regex] [--limit=N]
      Substring/regex search across collections.
  agentcohort memory mark-stale (--auto | --id=<uuid> | --filter=files=<path>) \\
                                [--collection=<name>] [--unstale] [--dry-run]
      Mark entries stale (or unstale) after refactors.

${b('Run lifecycle:')}
  agentcohort run start --pipeline=<name> [--tier=<n>] [--task-summary="<txt>"]
      Generate a UUIDv4 + start record. Prints the UUID to stdout only.
  agentcohort run end --run-id=<uuid> --outcome=<success|aborted|failed> \\
                      [--agents-run=<csv>] [--gates-fired=<csv>]
      Append the end record matching the run_id.

${b('Gate recording:')}
  agentcohort gate record --run-id=<uuid> --gate=<name> --outcome=<verb> \\
                          --proposed-content="<txt>" --posing-agent=<name> [--reason="<txt>"]
      Record gate approve/reject/escalate/auto-skip into audit.jsonl.
`;
}
