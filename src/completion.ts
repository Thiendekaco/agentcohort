import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GATE_NAMES } from './defaults';

/**
 * `agentcohort completion <shell>` — emit a shell completion script.
 *
 * Names (agent + command files, gate names, shells) are baked into
 * the script at generation time. Users re-run `agentcohort completion`
 * after a package upgrade to refresh — same trade-off as cargo / npm /
 * docker. Fast at TAB time (no fork per keystroke), predictable.
 *
 * Pure with respect to side effects: filesystem reads only to discover
 * bundled template names.
 */

export type CompletionShell = 'bash' | 'zsh' | 'pwsh';
export const COMPLETION_SHELLS: readonly CompletionShell[] = ['bash', 'zsh', 'pwsh'];

export interface CompletionContext {
  /** Top-level command names. */
  commands: readonly string[];
  /** Scopes the `list` command accepts. */
  listScopes: readonly string[];
  /** Bundled agent names (file basename without `.md`). */
  agentNames: readonly string[];
  /** Bundled command names. */
  commandNames: readonly string[];
  /** Gate names (for future targeted flags). */
  gateNames: readonly string[];
  /** Shell names that `completion` accepts. */
  completionShells: readonly string[];
  /** All recognized long-form flags (no values). */
  flags: readonly string[];
}

const TOP_COMMANDS: readonly string[] = [
  'init',
  'config',
  'doctor',
  'lint',
  'status',
  'list',
  'show',
  'search',
  'diff',
  'reset',
  'uninstall',
  'upgrade',
  'completion',
  'add',
];

const ALL_FLAGS: readonly string[] = [
  '--yes',
  '-y',
  '--dry-run',
  '--force',
  '--backup',
  '--reconfigure',
  '--json',
  '--diff',
  '--raw',
  '--bundled',
  '--agents',
  '--commands',
  '--exact',
  '--regex',
  '--keep-config',
  '--remove-config',
  '--keep-claude-md',
  '--override',
  '--help',
  '-h',
  '--version',
  '-v',
];

export function buildContext(templatesDir: string): CompletionContext {
  return {
    commands: TOP_COMMANDS,
    listScopes: ['agents', 'commands', 'gates'],
    agentNames: scanNames(join(templatesDir, 'agents')),
    commandNames: scanNames(join(templatesDir, 'commands')),
    gateNames: GATE_NAMES.slice(),
    completionShells: COMPLETION_SHELLS.slice(),
    flags: ALL_FLAGS,
  };
}

function scanNames(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

export function generateCompletion(
  shell: CompletionShell,
  ctx: CompletionContext
): string {
  if (shell === 'bash') return renderBash(ctx);
  if (shell === 'zsh') return renderZsh(ctx);
  return renderPwsh(ctx);
}

// ---------- bash ----------

function renderBash(ctx: CompletionContext): string {
  const cmds = quote(ctx.commands);
  const scopes = quote(ctx.listScopes);
  const shells = quote(ctx.completionShells);
  const agents = quote(ctx.agentNames);
  const commands = quote(ctx.commandNames);
  const allNames = quote(unique([...ctx.agentNames, ...ctx.commandNames]));
  const allPrefixed = quote([
    ...ctx.agentNames.map((n) => `agent/${n}`),
    ...ctx.commandNames.map((n) => `command/${n}`),
  ]);
  const flags = quote(ctx.flags);

  return `# agentcohort completion (bash)
# Install:
#   eval "$(agentcohort completion bash)"
# or
#   agentcohort completion bash > ~/.agentcohort-completion.bash
#   echo 'source ~/.agentcohort-completion.bash' >> ~/.bashrc

_agentcohort_complete() {
  local cur prev cmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]:-}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${cmds}" -- "\${cur}") )
    return 0
  fi

  case "\${cmd}" in
    list)
      if [ "\${COMP_CWORD}" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${scopes}" -- "\${cur}") )
        return 0
      fi
      ;;
    completion)
      if [ "\${COMP_CWORD}" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${shells}" -- "\${cur}") )
        return 0
      fi
      ;;
    show|diff|reset)
      if [ "\${COMP_CWORD}" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${allNames} ${allPrefixed}" -- "\${cur}") )
        return 0
      fi
      ;;
    search)
      # No specific suggestions for a free-text keyword. Fall through to flags.
      ;;
  esac

  # Default: flags + agent/command names where useful.
  COMPREPLY=( $(compgen -W "${flags}" -- "\${cur}") )
  return 0
}

complete -F _agentcohort_complete agentcohort
`;
}

// ---------- zsh ----------

function renderZsh(ctx: CompletionContext): string {
  const cmds = ctx.commands
    .map((c) => `    '${c}:${commandBlurb(c)}'`)
    .join('\n');
  const scopes = quote(ctx.listScopes);
  const shells = quote(ctx.completionShells);
  const names = quote(unique([...ctx.agentNames, ...ctx.commandNames]));
  const prefixed = quote([
    ...ctx.agentNames.map((n) => `agent/${n}`),
    ...ctx.commandNames.map((n) => `command/${n}`),
  ]);
  const flags = quote(ctx.flags);

  return `#compdef agentcohort
# agentcohort completion (zsh)
# Install:
#   agentcohort completion zsh > "\${fpath[1]}/_agentcohort"
#   autoload -U compinit && compinit

_agentcohort() {
  local -a commands
  commands=(
${cmds}
  )

  if (( CURRENT == 2 )); then
    _describe -t commands 'agentcohort command' commands
    return
  fi

  local cmd=\${words[2]}
  case "\${cmd}" in
    list)
      if (( CURRENT == 3 )); then
        _values 'scope' ${scopes}
        return
      fi
      ;;
    completion)
      if (( CURRENT == 3 )); then
        _values 'shell' ${shells}
        return
      fi
      ;;
    show|diff|reset)
      if (( CURRENT == 3 )); then
        _alternative 'names:agent or command:(${names})' \\
                     'qualified:kind/name:(${prefixed})'
        return
      fi
      ;;
  esac

  _values 'flag' ${flags}
}

compdef _agentcohort agentcohort
`;
}

function commandBlurb(cmd: string): string {
  const m: Record<string, string> = {
    init: 'install agents + commands + routing rules',
    config: 're-prompt model tiers and gates',
    doctor: 'read-only structural health check',
    lint: 'read-only content-quality check',
    status: 'at-a-glance summary',
    list: 'enumerate agents / commands / gates',
    show: 'print one agent or command body',
    search: 'grep across agent / command bodies',
    diff: 'diff installed vs bundled (CI-friendly)',
    reset: 'revert one file to bundled',
    uninstall: 'remove bundled files + routing section',
    upgrade: 'sync installed templates with bundled',
    completion: 'emit a shell completion script',
  };
  return m[cmd] ?? cmd;
}

// ---------- pwsh ----------

function renderPwsh(ctx: CompletionContext): string {
  const cmds = pwshArray(ctx.commands);
  const scopes = pwshArray(ctx.listScopes);
  const shells = pwshArray(ctx.completionShells);
  const names = pwshArray(unique([...ctx.agentNames, ...ctx.commandNames]));
  const prefixed = pwshArray([
    ...ctx.agentNames.map((n) => `agent/${n}`),
    ...ctx.commandNames.map((n) => `command/${n}`),
  ]);
  const flags = pwshArray(ctx.flags);

  return `# agentcohort completion (pwsh)
# Install:
#   agentcohort completion pwsh >> $PROFILE
#   . $PROFILE

Register-ArgumentCompleter -Native -CommandName agentcohort -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
    $cmdIndex = 1
    $subIndex = 2

    $topCommands = ${cmds}
    $listScopes  = ${scopes}
    $shells      = ${shells}
    $names       = ${names}
    $prefixed    = ${prefixed}
    $flags       = ${flags}

    function _emit($values, $word) {
        $values | Where-Object { $_ -like "$word*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(
                $_, $_, 'ParameterValue', $_
            )
        }
    }

    if ($tokens.Count -le $cmdIndex -or
        ($tokens.Count -eq ($cmdIndex + 1) -and $wordToComplete -ne '')) {
        _emit $topCommands $wordToComplete
        return
    }

    $cmd = $tokens[$cmdIndex]
    if ($tokens.Count -le ($subIndex + 1)) {
        switch ($cmd) {
            'list'       { _emit $listScopes $wordToComplete; return }
            'completion' { _emit $shells     $wordToComplete; return }
            'show'       { _emit ($names + $prefixed) $wordToComplete; return }
            'diff'       { _emit ($names + $prefixed) $wordToComplete; return }
            'reset'      { _emit ($names + $prefixed) $wordToComplete; return }
        }
    }

    _emit $flags $wordToComplete
}
`;
}

// ---------- helpers ----------

function quote(values: readonly string[]): string {
  return values.join(' ');
}

function pwshArray(values: readonly string[]): string {
  if (values.length === 0) return '@()';
  return '@(' + values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ') + ')';
}

function unique(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}
