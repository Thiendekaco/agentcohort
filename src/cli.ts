#!/usr/bin/env node
import { confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import { runInit, InitResult } from './installer';
import { createInteractiveResolver } from './prompt';
import { promptModelStrategy } from './promptModels';
import { promptGates } from './promptGates';
import { runConfigCmd } from './configCmd';
import { runDoctor, DoctorReport, Severity } from './doctor';
import { runLint, LintReport, LintSeverity } from './lint';
import { runStatus, StatusReport } from './status';
import {
  runList,
  ListReport,
  ListScope,
  ListAgentEntry,
  ListCommandEntry,
  ListGateEntry,
  ListEntryStatus,
} from './list';
import { runShow, ShowResult, ShowMatch, ShowVariant } from './show';
import {
  runSearch,
  SearchResult,
  SearchMode,
  SearchScope,
  SearchFileResult,
  SearchLineMatch,
} from './search';
import {
  runDiff,
  DiffResult,
  DiffScope,
  DiffFileEntry,
  DiffStatus,
} from './diffCmd';
import {
  runReset,
  ResetResult,
  ResetAction,
  ResetDisposition,
} from './reset';
import {
  runUninstall,
  UninstallResult,
  UninstallEntry,
  UninstallActionKind,
} from './uninstall';
import {
  runAdd,
  AddResult,
  AgentArchetype,
} from './add';
import {
  runExport,
  runImport,
  ExportResult,
  ImportResult,
  ImportFileEntry,
  PackValidationError,
} from './pack';
import { scanSkills, Skill, SkillsScanResult } from './skills';
import {
  runRefreshSkills,
  RefreshResult,
  RefreshEntry,
  RefreshDisposition,
} from './refreshSkills';
import {
  buildContext as buildCompletionContext,
  generateCompletion,
  COMPLETION_SHELLS,
  CompletionShell,
} from './completion';
import {
  runUpgrade,
  UpgradeAction,
  UpgradeConflictRequest,
  UpgradeConflictDecision,
  UpgradeResult,
} from './upgrade';
import { unifiedDiff } from './textDiff';
import { loadConfig, writeConfig, resolveModels, resolveGates } from './config';
import { createLogger, paint } from './logger';
import { getTemplatesDir, getVersion } from './paths';
import { parseArgs, helpText, ParsedArgs } from './args';
import {
  runMemoryInit, runMemoryWrite, runMemoryRead, runMemorySearch, runMemoryMarkStale,
  GitMode, MarkStaleMode,
} from './memoryCmd';
import { runRunStart, runRunEnd } from './runCmd';
import { runGateRecord } from './gateCmd';

function printSummary(result: InitResult): void {
  const counts = new Map<string, number>();
  let backups = 0;
  for (const a of result.actions) {
    counts.set(a.disposition, (counts.get(a.disposition) ?? 0) + 1);
    if (a.backupPath) backups += 1;
  }
  const part = (label: string, key: string): string | null => {
    const n = counts.get(key) ?? 0;
    return n > 0 ? `${n} ${label}` : null;
  };
  const segments = [
    part('created', 'created'),
    part('updated', 'overwritten'),
    part('section appended', 'appended-section'),
    part('section updated', 'replaced-section'),
    part('unchanged', 'unchanged'),
    part('skipped', 'skipped'),
  ].filter((x): x is string => x !== null);

  process.stdout.write('\n');
  const head = result.dryRun ? 'Dry run complete' : 'Agentcohort installed';
  process.stdout.write(`${paint(head, 'bold', 'green')}  ${segments.join(' · ')}\n`);
  if (backups > 0) {
    process.stdout.write(
      `${paint('•', 'cyan')} ${backups} backup(s) written alongside the originals.\n`
    );
  }
  if (!result.dryRun && ((counts.get('created') ?? 0) || (counts.get('overwritten') ?? 0))) {
    process.stdout.write(
      `${paint('•', 'cyan')} Next: open Claude Code in this project and run ${paint('/auto-flow', 'bold')}.\n`
    );
  }
  if (result.dryRun) {
    process.stdout.write(
      `${paint('•', 'cyan')} Re-run without ${paint('--dry-run', 'bold')} to apply.\n`
    );
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  // memory / run / gate commands accept positional args that land in unknown[].
  const commandAllowsUnknown =
    args.command === 'memory' ||
    args.command === 'run' ||
    args.command === 'gate';

  if (!commandAllowsUnknown && args.unknown.length > 0) {
    process.stderr.write(
      paint(`✗ Unknown argument(s): ${args.unknown.join(', ')}\n`, 'red')
    );
    process.stdout.write(helpText() + '\n');
    return 1;
  }

  if (args.version) {
    process.stdout.write(getVersion() + '\n');
    return 0;
  }

  if (args.help || args.command === null) {
    process.stdout.write(helpText() + '\n');
    return 0;
  }

  if (
    args.command !== 'init' &&
    args.command !== 'config' &&
    args.command !== 'doctor' &&
    args.command !== 'lint' &&
    args.command !== 'status' &&
    args.command !== 'upgrade' &&
    args.command !== 'list' &&
    args.command !== 'show' &&
    args.command !== 'search' &&
    args.command !== 'diff' &&
    args.command !== 'reset' &&
    args.command !== 'uninstall' &&
    args.command !== 'completion' &&
    args.command !== 'add' &&
    args.command !== 'export' &&
    args.command !== 'import' &&
    args.command !== 'skills' &&
    args.command !== 'refresh-skills' &&
    args.command !== 'memory' &&
    args.command !== 'run' &&
    args.command !== 'gate'
  ) {
    process.stderr.write(paint(`✗ Unknown command: ${args.command}\n`, 'red'));
    process.stdout.write(helpText() + '\n');
    return 1;
  }

  if (args.command === 'doctor') {
    try {
      const cfg = loadConfig(process.cwd());
      const report = runDoctor({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        skills: scanSkills({ cwd: process.cwd() }).skills,
        affinity: cfg?.skillAffinity,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(formatDoctorReport(report));
      }
      return report.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ doctor: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'lint') {
    try {
      const report = runLint({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(formatLintReport(report));
      }
      return report.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ lint: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'status') {
    try {
      const report = runStatus({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(formatStatusReport(report));
      }
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ status: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'list') {
    const sub = args.subcommand;
    if (
      sub !== null &&
      sub !== 'agents' &&
      sub !== 'commands' &&
      sub !== 'gates'
    ) {
      process.stderr.write(
        paint(
          `✗ list: unknown scope '${sub}'. Use one of: agents, commands, gates (or omit for all).\n`,
          'red'
        )
      );
      return 1;
    }
    const scope: ListScope = (sub ?? 'all') as ListScope;
    try {
      const cfg = loadConfig(process.cwd());
      const report = runList({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        scope,
        skills: scanSkills({ cwd: process.cwd() }).skills,
        affinity: cfg?.skillAffinity,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(formatListReport(report));
      }
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ list: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'completion') {
    const shell = args.subcommand;
    if (shell === null || shell === '') {
      process.stderr.write(
        paint(
          `✗ completion: missing <shell>. Usage: agentcohort completion ${COMPLETION_SHELLS.join(' | ')}\n`,
          'red'
        )
      );
      return 1;
    }
    if (!COMPLETION_SHELLS.includes(shell as CompletionShell)) {
      process.stderr.write(
        paint(
          `✗ completion: unknown shell '${shell}'. Use one of: ${COMPLETION_SHELLS.join(', ')}.\n`,
          'red'
        )
      );
      return 1;
    }
    try {
      const ctx = buildCompletionContext(getTemplatesDir());
      const script = generateCompletion(shell as CompletionShell, ctx);
      process.stdout.write(script);
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ completion: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'uninstall') {
    if (args.keepConfig && args.removeConfig) {
      process.stderr.write(
        paint('✗ uninstall: --keep-config and --remove-config are mutually exclusive.\n', 'red')
      );
      return 1;
    }
    const cwd = process.cwd();
    const stdinTTY = Boolean(process.stdin.isTTY);
    const stdoutTTY = Boolean(process.stdout.isTTY);
    const interactive =
      !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;

    // Decisions: explicit flags > prompts > safe defaults.
    // Defaults under --yes / non-interactive:
    //   - section: REMOVE (uninstall implies full removal of agentcohort presence)
    //   - config:  KEEP   (preserves customizations for a future re-install)
    let removeClaudeSection = !args.keepClaudeMd;
    let removeConfigDecision = args.removeConfig
      ? true
      : args.keepConfig
      ? false
      : false; // safe default
    try {
      // Always preview first so the user sees the full plan.
      const preview = runUninstall({
        cwd,
        templatesDir: getTemplatesDir(),
        dryRun: true,
        backup: args.backup,
        removeClaudeSection,
        removeConfig: removeConfigDecision,
        now: () => new Date(),
      });

      if (preview.exitCode === 1) {
        // Nothing to uninstall.
        if (args.json) {
          process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
        } else {
          process.stdout.write(
            paint('Nothing to uninstall — no bundled files, section, or config found.\n', 'gray')
          );
        }
        return 0;
      }

      if (args.dryRun) {
        if (args.json) {
          process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
        } else {
          process.stdout.write(formatUninstallResult(preview));
        }
        return 0;
      }

      if (interactive) {
        process.stdout.write(formatUninstallPlan(preview, {
          removeClaudeSection,
          removeConfig: removeConfigDecision,
        }));
        // Prompt for config when not explicitly flagged.
        if (!args.keepConfig && !args.removeConfig && preview.entries.some((e) => e.kind === 'kept-config')) {
          const wantRemoveConfig = await confirm({
            message:
              'Also remove `.agentcohort.json` (your customized models / gates)?',
            default: false,
          });
          if (wantRemoveConfig) removeConfigDecision = true;
        }
        const proceed = await confirm({
          message: 'Proceed with uninstall?',
          default: false,
        });
        if (!proceed) {
          process.stdout.write(paint('Cancelled. No changes made.\n', 'yellow'));
          return 130;
        }
      } else if (!args.yes && !args.force) {
        process.stderr.write(
          paint(
            '✗ uninstall: refusing to write in non-interactive mode without --yes (or --force).\n',
            'red'
          )
        );
        return 1;
      }

      const result = runUninstall({
        cwd,
        templatesDir: getTemplatesDir(),
        dryRun: false,
        backup: args.backup,
        removeClaudeSection,
        removeConfig: removeConfigDecision,
        now: () => new Date(),
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatUninstallResult(result));
      }
      return result.exitCode === 1 ? 0 : result.exitCode; // exit 1 already handled above
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ExitPromptError) {
        process.stderr.write(paint('\nCancelled. No changes made.\n', 'yellow'));
        return 130;
      }
      process.stderr.write(paint(`✗ uninstall: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'refresh-skills') {
    const cwd = process.cwd();
    const existingConfig = loadConfig(cwd);
    const models = resolveModels(existingConfig);
    const skills = scanSkills({ cwd }).skills;
    const stdinTTY = Boolean(process.stdin.isTTY);
    const stdoutTTY = Boolean(process.stdout.isTTY);
    const interactive =
      !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;
    try {
      const preview = runRefreshSkills({
        cwd,
        templatesDir: getTemplatesDir(),
        models,
        skills,
        affinity: existingConfig?.skillAffinity,
        dryRun: true,
        backup: args.backup,
      });

      const willChange = preview.entries.some((e) => e.disposition === 'updated');

      if (args.dryRun || !willChange) {
        const display: RefreshResult = { ...preview, dryRun: args.dryRun };
        if (args.json) {
          process.stdout.write(JSON.stringify(display, null, 2) + '\n');
        } else {
          process.stdout.write(formatRefreshResult(display));
        }
        return display.exitCode;
      }

      if (interactive) {
        process.stdout.write(formatRefreshResult(preview));
        const proceed = await confirm({
          message: `Refresh skill list in ${preview.entries.filter((e) => e.disposition === 'updated').length} agent(s)?`,
          default: true,
        });
        if (!proceed) {
          process.stdout.write(paint('Cancelled. No changes made.\n', 'yellow'));
          return 130;
        }
      } else if (!args.yes && !args.force) {
        process.stderr.write(
          paint(
            '✗ refresh-skills: refusing to write in non-interactive mode without --yes (or --force).\n',
            'red'
          )
        );
        return 1;
      }

      const result = runRefreshSkills({
        cwd,
        templatesDir: getTemplatesDir(),
        models,
        skills,
        affinity: existingConfig?.skillAffinity,
        dryRun: false,
        backup: args.backup,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatRefreshResult(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ExitPromptError) {
        process.stderr.write(paint('\nCancelled. No changes made.\n', 'yellow'));
        return 130;
      }
      process.stderr.write(paint(`✗ refresh-skills: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'memory') {
    switch (args.subcommand) {
      case 'init':       return handleMemoryInit(args);
      case 'write':      return handleMemoryWrite(args);
      case 'read':       return handleMemoryRead(args);
      case 'search':     return handleMemorySearch(args);
      case 'mark-stale': return handleMemoryMarkStale(args);
      default:
        process.stderr.write(paint(`✗ Unknown memory subcommand: ${args.subcommand}\n`, 'red'));
        return 1;
    }
  }

  if (args.command === 'run') {
    switch (args.subcommand) {
      case 'start': return handleRunStart(args);
      case 'end':   return handleRunEnd(args);
      default:
        process.stderr.write(paint(`✗ Unknown run subcommand: ${args.subcommand}\n`, 'red'));
        return 1;
    }
  }

  if (args.command === 'gate') {
    if (args.subcommand === 'record') return handleGateRecord(args);
    process.stderr.write(paint(`✗ Unknown gate subcommand: ${args.subcommand}\n`, 'red'));
    return 1;
  }

  if (args.command === 'skills') {
    try {
      const result = scanSkills({ cwd: process.cwd() });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatSkillsReport(result));
      }
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ skills: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'export') {
    try {
      const result = runExport({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        outPath: args.out,
        includeConfig: !args.noConfig,
        version: getVersion(),
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else if (args.out === null) {
        // Write the pack body itself to stdout; a human-readable
        // summary still goes to stderr so piping `agentcohort export >
        // pack.json` does the right thing.
        process.stdout.write(
          JSON.stringify(result.pack, null, 2) + '\n'
        );
        process.stderr.write(formatExportSummary(result));
      } else {
        process.stdout.write(formatExportSummary(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ export: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'import') {
    const packPath = args.subcommand;
    if (packPath === null || packPath === '') {
      process.stderr.write(
        paint(
          '✗ import: missing <pack>. Usage: agentcohort import <path/to/pack.json> [--force] [--no-config] [--backup] [--dry-run]\n',
          'red'
        )
      );
      return 1;
    }
    const cwd = process.cwd();
    const stdinTTY = Boolean(process.stdin.isTTY);
    const stdoutTTY = Boolean(process.stdout.isTTY);
    const interactive =
      !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;
    try {
      const preview = runImport({
        cwd,
        templatesDir: getTemplatesDir(),
        packPath,
        force: args.force,
        importConfig: !args.noConfig,
        backup: args.backup,
        dryRun: true,
      });

      if (args.dryRun) {
        if (args.json) {
          process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
        } else {
          process.stdout.write(formatImportResult(preview));
        }
        return preview.exitCode;
      }

      if (interactive) {
        process.stdout.write(formatImportPlan(preview));
        const proceed = await confirm({
          message: `Apply pack ${packPath}?`,
          default: true,
        });
        if (!proceed) {
          process.stdout.write(paint('Cancelled. No changes made.\n', 'yellow'));
          return 130;
        }
      } else if (!args.yes && !args.force) {
        process.stderr.write(
          paint(
            '✗ import: refusing to write in non-interactive mode without --yes (or --force).\n',
            'red'
          )
        );
        return 1;
      }

      const result = runImport({
        cwd,
        templatesDir: getTemplatesDir(),
        packPath,
        force: args.force,
        importConfig: !args.noConfig,
        backup: args.backup,
        dryRun: false,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatImportResult(result));
      }
      return result.exitCode;
    } catch (err) {
      if (err instanceof PackValidationError) {
        process.stderr.write(paint(`✗ import: ${err.message}\n`, 'red'));
        return 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ExitPromptError) {
        process.stderr.write(paint('\nCancelled. No changes made.\n', 'yellow'));
        return 130;
      }
      process.stderr.write(paint(`✗ import: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'add') {
    const query = args.subcommand;
    if (query === null || query === '') {
      process.stderr.write(
        paint(
          '✗ add: missing <name>. Usage: agentcohort add <name> | agent/<name> | command/<name> [--kind=<archetype>] [--description=<text>] [--model=<tier>] [--override]\n',
          'red'
        )
      );
      return 1;
    }
    const kindFromQuery: 'agent' | 'command' =
      query.startsWith('command/') || query.startsWith('commands/')
        ? 'command'
        : 'agent';
    // Validate archetype.
    let archetype: AgentArchetype | null = null;
    if (args.kind !== null) {
      const allowed: AgentArchetype[] = [
        'analyst',
        'implementer',
        'reviewer',
        'gate',
        'empty',
      ];
      if (!allowed.includes(args.kind as AgentArchetype)) {
        process.stderr.write(
          paint(
            `✗ add: --kind must be one of ${allowed.join(', ')} (got '${args.kind}').\n`,
            'red'
          )
        );
        return 1;
      }
      if (kindFromQuery === 'command') {
        process.stderr.write(
          paint(
            '✗ add: --kind is only valid when adding an agent (got a command query).\n',
            'red'
          )
        );
        return 1;
      }
      archetype = args.kind as AgentArchetype;
    }
    // Validate model alias.
    let model: 'haiku' | 'sonnet' | 'opus' | null = null;
    if (args.model !== null) {
      const allowedModels = ['haiku', 'sonnet', 'opus'] as const;
      if (!(allowedModels as readonly string[]).includes(args.model)) {
        process.stderr.write(
          paint(
            `✗ add: --model must be one of ${allowedModels.join(', ')} (got '${args.model}').\n`,
            'red'
          )
        );
        return 1;
      }
      if (kindFromQuery === 'command') {
        process.stderr.write(
          paint(
            '✗ add: --model is only valid when adding an agent (got a command query).\n',
            'red'
          )
        );
        return 1;
      }
      model = args.model as 'haiku' | 'sonnet' | 'opus';
    }

    const cwd = process.cwd();
    const stdinTTY = Boolean(process.stdin.isTTY);
    const stdoutTTY = Boolean(process.stdout.isTTY);
    const interactive =
      !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;

    try {
      const preview = runAdd({
        cwd,
        templatesDir: getTemplatesDir(),
        query,
        archetype,
        description: args.description,
        model,
        override: args.override,
        force: args.force,
        dryRun: true,
      });
      const isMutating =
        preview.disposition === 'created' ||
        preview.disposition === 'override-created';

      if (args.dryRun || !isMutating) {
        const display: AddResult = { ...preview, dryRun: args.dryRun };
        if (args.json) {
          process.stdout.write(JSON.stringify(display, null, 2) + '\n');
        } else {
          process.stdout.write(formatAddResult(display));
        }
        return display.exitCode;
      }

      if (interactive) {
        process.stdout.write(formatAddPreview(preview));
        const proceed = await confirm({
          message: `Write ${preview.installedPath}?`,
          default: true,
        });
        if (!proceed) {
          process.stdout.write(paint('Cancelled. No changes made.\n', 'yellow'));
          return 130;
        }
      } else if (!args.yes && !args.force) {
        process.stderr.write(
          paint(
            '✗ add: refusing to write in non-interactive mode without --yes (or --force).\n',
            'red'
          )
        );
        return 1;
      }

      const result = runAdd({
        cwd,
        templatesDir: getTemplatesDir(),
        query,
        archetype,
        description: args.description,
        model,
        override: args.override,
        force: args.force,
        dryRun: false,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatAddResult(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ExitPromptError) {
        process.stderr.write(paint('\nCancelled. No changes made.\n', 'yellow'));
        return 130;
      }
      process.stderr.write(paint(`✗ add: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'reset') {
    const query = args.subcommand;
    if (query === null || query === '') {
      process.stderr.write(
        paint(
          '✗ reset: missing <name>. Usage: agentcohort reset <name> | agent/<name> | command/<name>\n',
          'red'
        )
      );
      process.stderr.write(
        paint(
          '  Reset is targeted by design. For a project-wide refresh, use `agentcohort upgrade`.\n',
          'gray'
        )
      );
      return 1;
    }
    const cwd = process.cwd();
    const existingConfig = loadConfig(cwd);
    const models = resolveModels(existingConfig);
    const skills = scanSkills({ cwd }).skills;
    const stdinTTY = Boolean(process.stdin.isTTY);
    const stdoutTTY = Boolean(process.stdout.isTTY);
    const interactive =
      !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;
    try {
      // Dry-run first so the user always sees what would happen before
      // any write occurs.
      const preview = runReset({
        cwd,
        templatesDir: getTemplatesDir(),
        query,
        dryRun: true,
        backup: args.backup,
        models,
        skills,
        affinity: existingConfig?.skillAffinity,
      });
      const isMutating =
        preview.action.disposition === 'reset' ||
        preview.action.disposition === 'installed';

      if (args.dryRun || !isMutating) {
        // The preview ran in dryRun=true internally to avoid side
        // effects. For non-mutating outcomes (noop / refused-*) nothing
        // would have written either way — surface the user's actual
        // dryRun intent so the output is truthful.
        const display: ResetResult = {
          ...preview,
          action: { ...preview.action, dryRun: args.dryRun },
        };
        if (args.json) {
          process.stdout.write(JSON.stringify(display, null, 2) + '\n');
        } else {
          process.stdout.write(formatResetResult(display));
        }
        return display.exitCode;
      }

      if (interactive) {
        process.stdout.write(formatResetPreview(preview));
        const proceed = await confirm({
          message:
            preview.action.disposition === 'reset'
              ? `Overwrite ${preview.action.installedPath}?`
              : `Install ${preview.action.installedPath}?`,
          default: false,
        });
        if (!proceed) {
          process.stdout.write(paint('Cancelled. No changes made.\n', 'yellow'));
          return 130;
        }
      } else if (!args.yes && !args.force) {
        // Non-interactive without explicit consent: refuse to mutate.
        process.stderr.write(
          paint(
            '✗ reset: refusing to write in non-interactive mode without --yes (or --force).\n',
            'red'
          )
        );
        return 1;
      }

      const result = runReset({
        cwd,
        templatesDir: getTemplatesDir(),
        query,
        dryRun: false,
        backup: args.backup,
        models,
        skills,
        affinity: existingConfig?.skillAffinity,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatResetResult(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ExitPromptError) {
        process.stderr.write(paint('\nCancelled. No changes made.\n', 'yellow'));
        return 130;
      }
      process.stderr.write(paint(`✗ reset: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'diff') {
    if (args.agents && args.commands) {
      process.stderr.write(
        paint('✗ diff: --agents and --commands are mutually exclusive.\n', 'red')
      );
      return 1;
    }
    const scope: DiffScope = args.agents
      ? 'agents'
      : args.commands
      ? 'commands'
      : 'all';
    try {
      const existingConfig = loadConfig(process.cwd());
      const models = resolveModels(existingConfig);
      const result = runDiff({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        query: args.subcommand,
        scope,
        models,
        skills: scanSkills({ cwd: process.cwd() }).skills,
        affinity: existingConfig?.skillAffinity,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatDiffResult(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ diff: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'search') {
    const query = args.subcommand;
    if (query === null || query === '') {
      process.stderr.write(
        paint('✗ search: missing <keyword>. Usage: agentcohort search <keyword> [--agents|--commands] [--exact|--regex]\n', 'red')
      );
      return 1;
    }
    if (args.agents && args.commands) {
      process.stderr.write(
        paint('✗ search: --agents and --commands are mutually exclusive (omit both to search both).\n', 'red')
      );
      return 1;
    }
    if (args.exact && args.regex) {
      process.stderr.write(
        paint('✗ search: --exact and --regex are mutually exclusive.\n', 'red')
      );
      return 1;
    }
    const scope: SearchScope = args.agents
      ? 'agents'
      : args.commands
      ? 'commands'
      : 'all';
    const mode: SearchMode = args.regex ? 'regex' : args.exact ? 'exact' : 'substring';
    try {
      const result = runSearch({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        query,
        scope,
        mode,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatSearchResult(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ search: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'show') {
    const query = args.subcommand;
    if (query === null || query === '') {
      process.stderr.write(
        paint(
          '✗ show: missing <name>. Usage: agentcohort show <name> | agent/<name> | command/<name>\n',
          'red'
        )
      );
      return 1;
    }
    if (args.raw && args.bundled) {
      process.stderr.write(
        paint('✗ show: --raw and --bundled are mutually exclusive.\n', 'red')
      );
      return 1;
    }
    const variant: ShowVariant = args.raw ? 'raw' : args.bundled ? 'bundled' : 'default';
    try {
      const existingConfig = loadConfig(process.cwd());
      const models = resolveModels(existingConfig);
      const result = runShow({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        query,
        variant,
        models,
        skills: scanSkills({ cwd: process.cwd() }).skills,
        affinity: existingConfig?.skillAffinity,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatShowResult(result));
      }
      return result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(`✗ show: ${message}\n`, 'red'));
      return 2;
    }
  }

  if (args.command === 'upgrade') {
    const stdinTTY = Boolean(process.stdin.isTTY);
    const stdoutTTY = Boolean(process.stdout.isTTY);
    const interactive =
      !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;
    const cwd = process.cwd();

    // Read existing config silently — upgrade never re-prompts for it.
    const existingConfig = loadConfig(cwd);
    const models = resolveModels(existingConfig);
    const skills = scanSkills({ cwd }).skills;

    process.stdout.write(
      paint('\nagentcohort upgrade', 'bold', 'cyan') +
        paint(`  v${getVersion()}\n`, 'gray')
    );
    if (args.dryRun) {
      process.stdout.write(paint('Dry run — no files will be written.\n', 'gray'));
    } else if (!interactive && !args.yes && !args.force) {
      process.stdout.write(
        paint(
          'Non-interactive — conflicts will keep the local version (safe default).\n',
          'gray'
        )
      );
    }

    try {
      const logger = createLogger();
      const result = await runUpgrade({
        cwd,
        dryRun: args.dryRun,
        force: args.force,
        backup: args.backup,
        interactive,
        models,
        skills,
        affinity: existingConfig?.skillAffinity,
        resolver: interactive
          ? (req) => upgradeResolver(req, { showDiff: args.diff })
          : undefined,
        logger,
      });
      if (args.diff) printVerboseDiffs(result);
      printUpgradeSummary(result);
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ExitPromptError) {
        process.stderr.write(paint('\nCancelled. No more changes will be applied.\n', 'yellow'));
        return 130;
      }
      process.stderr.write(paint(`\n✗ upgrade: ${message}\n`, 'red'));
      return 1;
    }
  }

  if (args.reconfigure && (args.yes || args.force)) {
    process.stderr.write(
      paint('✗ --reconfigure requires interactive mode (cannot combine with --yes or --force).\n', 'red')
    );
    return 1;
  }

  const stdinTTY = Boolean(process.stdin.isTTY);
  const stdoutTTY = Boolean(process.stdout.isTTY);
  const interactive =
    !args.yes && !args.force && !args.dryRun && stdinTTY && stdoutTTY;

  const logger = createLogger();
  let resolverHandle: ReturnType<typeof createInteractiveResolver> | null = null;

  process.stdout.write(
    paint('\nagentcohort', 'bold', 'cyan') + paint(`  v${getVersion()}\n`, 'gray')
  );
  if (args.dryRun) {
    logger.info('Dry run — no files will be written.');
  } else if (!interactive && !args.yes && !args.force) {
    logger.info(
      'Non-interactive environment detected — using safe defaults (like --yes).'
    );
  }

  try {
    const cwd = process.cwd();

    if (args.command === 'config') {
      if (!interactive) {
        process.stderr.write(
          paint(
            '✗ `agentcohort config` requires interactive mode (TTY). Edit .agentcohort.json directly to set models non-interactively.\n',
            'red'
          )
        );
        return 1;
      }
      const result = await runConfigCmd({
        cwd,
        promptModelStrategy,
        promptGates,
        confirm: (message) => confirm({ message, default: true }),
      });
      const appliedDetail = result.changes.length > 0
        ? `${result.changes.length} agent file${result.changes.length === 1 ? '' : 's'}` +
          (result.gatesChanged ? ' + gates' : '')
        : 'gates';
      const msg = {
        'no-changes': 'No changes. Configuration is up to date.',
        'no-agents': 'Config saved. No installed agents found — run `agentcohort init` to install.',
        'cancelled': 'Cancelled. No changes made.',
        'applied': `Applied changes (${appliedDetail}).`,
      }[result.status];
      process.stdout.write(`${paint('•', 'cyan')} ${msg}\n`);
      return 0;
    }

    // command === 'init'
    let existingConfig = loadConfig(cwd);
    let models = resolveModels(existingConfig);

    if (interactive && (existingConfig === null || args.reconfigure)) {
      const newModels = await promptModelStrategy(existingConfig?.models);
      const newGates = await promptGates(resolveGates(existingConfig));
      // Persist config BEFORE install so a partial install can be re-run idempotently.
      // Drop the gates field when nothing was set and user accepted defaults — matches
      // the runConfigCmd policy (explicit > implicit).
      const preInstallConfig =
        existingConfig?.gates !== undefined ||
        newGates.architect !== 'on' ||
        newGates.plan !== 'on' ||
        newGates.bottleneck !== 'auto' ||
        newGates['root-cause'] !== 'on' ||
        newGates['expert-council'] !== 'on'
          ? { version: 1 as const, models: newModels, gates: newGates }
          : { version: 1 as const, models: newModels };
      writeConfig(cwd, preInstallConfig);
      models = newModels;
    }

    if (interactive) resolverHandle = createInteractiveResolver();
    const skills = scanSkills({ cwd }).skills;
    // Re-load config in case `init` wrote one above (e.g. when the
    // user supplied a new models strategy this run). We want
    // skillAffinity from the on-disk file, not the in-memory
    // existingConfig captured before writeConfig.
    const cfgAfterInit = loadConfig(cwd);
    const result = await runInit({
      cwd,
      yes: args.yes,
      dryRun: args.dryRun,
      force: args.force,
      backup: args.backup,
      interactive,
      resolver: resolverHandle?.resolve,
      logger,
      models,
      skills,
      affinity: cfgAfterInit?.skillAffinity,
    });
    printSummary(result);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ExitPromptError) {
      process.stderr.write(paint('\nCancelled. No changes made.\n', 'yellow'));
      return 130;
    }
    process.stderr.write(paint(`\n✗ ${message}\n`, 'red'));
    return 1;
  } finally {
    resolverHandle?.close();
  }
}

// ============================================================================
// Memory / Run / Gate handlers (v0.10+)
// ============================================================================

function handleMemoryInit(args: ParsedArgs): number {
  const mode: GitMode = args.commitAll ? 'commit-all'
    : args.gitignoreAll ? 'gitignore-all'
    : 'default';
  try {
    const r = runMemoryInit({ cwd: process.cwd(), mode });
    if (args.json) { process.stdout.write(JSON.stringify(r) + '\n'); return 0; }
    console.log(`Memory layer ${r.created.length > 0 ? 'initialized' : 'already initialized'}.`);
    if (r.gitignoreUpdated) console.log('  .gitignore updated.');
    for (const c of r.created) console.log(`  + ${c}`);
    return 0;
  } catch (err) {
    process.stderr.write(paint(`✗ memory init: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleMemoryWrite(args: ParsedArgs): number {
  // Collection can be a positional or --collection= flag.
  const collection = args.collection ?? args.unknown[0] ?? null;
  const effectiveArgs = { ...args, collection };
  const missing = (['collection', 'bodyJson', 'source', 'confidence', 'taskSummary'] as (keyof ParsedArgs)[])
    .filter((k) => effectiveArgs[k] === null || effectiveArgs[k] === undefined);
  if (missing.length > 0) {
    for (const k of missing) process.stderr.write(`error: --${camelToKebab(k as string)} is required\n`);
    return 1;
  }
  try {
    const r = runMemoryWrite({
      cwd: process.cwd(),
      collection: collection!,
      bodyJson: args.bodyJson!,
      source: args.source!,
      confidence: args.confidence!,
      verified: args.verifiedFlag ?? false,
      taskSummary: args.taskSummary!,
      runId: args.runId ?? undefined,
      files: args.files ?? [],
    });
    if (args.json) { process.stdout.write(JSON.stringify(r) + '\n'); return 0; }
    if (r.disposition === 'written') {
      console.log(`Wrote entry ${r.entryId} to ${r.filePath}`);
      return 0;
    }
    process.stderr.write(`${r.disposition}: ${r.errorMessage ?? ''}\n`);
    if (r.secretMatches) for (const m of r.secretMatches) {
      process.stderr.write(`  - secret pattern '${m.patternName}' matched at offset ${m.offset} (preview: ${m.preview})\n`);
    }
    return 1;
  } catch (err) {
    process.stderr.write(paint(`✗ memory write: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleMemoryRead(args: ParsedArgs): number {
  const collection = args.collection ?? args.unknown[0] ?? null;
  if (!collection) {
    process.stderr.write('error: <collection> is required (or pass --collection=<name>)\n');
    return 1;
  }
  try {
    const r = runMemoryRead({
      cwd: process.cwd(),
      collection: collection,
      filters: Object.keys(args.filters).length > 0 ? args.filters : undefined,
      limit: args.limit ?? undefined,
      since: args.since ?? undefined,
      runId: args.runId ?? undefined,
      withVerifications: args.withVerifications,
    });
    if (args.json) { process.stdout.write(JSON.stringify(r.entries) + '\n'); return 0; }
    for (const e of r.entries) process.stdout.write(JSON.stringify(e) + '\n');
    return 0;
  } catch (err) {
    process.stderr.write(paint(`✗ memory read: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleMemorySearch(args: ParsedArgs): number {
  const query = args.unknown[0];
  if (!query) {
    process.stderr.write('error: search query is required\n');
    return 1;
  }
  try {
    const r = runMemorySearch({
      cwd: process.cwd(),
      query,
      collection: args.collection ?? undefined,
      regex: args.regex,
      limit: args.limit ?? undefined,
    });
    if (args.json) { process.stdout.write(JSON.stringify(r) + '\n'); return 0; }
    for (const m of r.matches) {
      console.log(`${m.collection}  ${m.matchedField}  ${JSON.stringify(m.entry).slice(0, 120)}`);
    }
    return r.matches.length === 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(paint(`✗ memory search: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleMemoryMarkStale(args: ParsedArgs): number {
  let mode: MarkStaleMode;
  if (args.autoStale) {
    mode = { kind: 'auto' };
  } else if (args.staleId) {
    mode = { kind: 'id', id: args.staleId };
  } else if (args.filters.files) {
    mode = { kind: 'filter', files: args.filters.files };
  } else {
    process.stderr.write('error: must specify --auto, --id=<uuid>, or --filter=files=<path>\n');
    return 1;
  }
  try {
    const r = runMemoryMarkStale({
      cwd: process.cwd(),
      mode,
      collection: (args.collection ?? undefined) as Parameters<typeof runMemoryMarkStale>[0]['collection'],
      unstale: args.unstale,
      dryRun: args.dryRun,
    });
    if (args.json) { process.stdout.write(JSON.stringify(r) + '\n'); return 0; }
    console.log(`Marked ${r.markedCount} entries ${args.unstale ? 'unstale' : 'stale'}.`);
    for (const [col, n] of Object.entries(r.perCollection)) {
      if (n > 0) console.log(`  ${col}: ${n}`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(paint(`✗ memory mark-stale: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleRunStart(args: ParsedArgs): number {
  if (!args.pipeline) {
    process.stderr.write('error: --pipeline is required\n');
    return 1;
  }
  try {
    const r = runRunStart({
      cwd: process.cwd(),
      pipeline: args.pipeline!,
      tier: args.tier ?? undefined,
      taskSummary: args.taskSummary ?? undefined,
    });
    // CRITICAL: stdout = ONLY the UUID (no newline, no decoration).
    process.stdout.write(r.runId);
    return 0;
  } catch (err) {
    process.stderr.write(paint(`✗ run start: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleRunEnd(args: ParsedArgs): number {
  const missing = (['runId', 'outcome'] as (keyof ParsedArgs)[])
    .filter((k) => args[k] === null || args[k] === undefined);
  if (missing.length > 0) {
    for (const k of missing) process.stderr.write(`error: --${camelToKebab(k as string)} is required\n`);
    return 1;
  }
  try {
    runRunEnd({
      cwd: process.cwd(),
      runId: args.runId!,
      outcome: args.outcome as 'success' | 'aborted' | 'failed',
      agentsRun: args.agentsRun ?? undefined,
      gatesFired: args.gatesFired ?? undefined,
    });
    if (!args.json) console.log('OK');
    return 0;
  } catch (err) {
    process.stderr.write(paint(`✗ run end: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function handleGateRecord(args: ParsedArgs): number {
  const missing = (['runId', 'gate', 'outcome', 'proposedContent', 'posingAgent'] as (keyof ParsedArgs)[])
    .filter((k) => args[k] === null || args[k] === undefined);
  if (missing.length > 0) {
    for (const k of missing) process.stderr.write(`error: --${camelToKebab(k as string)} is required\n`);
    return 1;
  }
  try {
    const r = runGateRecord({
      cwd: process.cwd(),
      runId: args.runId!,
      gate: args.gate as 'architect' | 'plan' | 'bottleneck' | 'root-cause' | 'expert-council',
      outcome: args.outcome as 'approved' | 'rejected' | 'escalated' | 'auto-skipped',
      proposedContent: args.proposedContent!,
      posingAgent: args.posingAgent!,
      reason: args.reason ?? undefined,
    });
    if (args.json) { process.stdout.write(JSON.stringify(r) + '\n'); return 0; }
    if (r.disposition === 'written') { console.log('Gate recorded.'); return 0; }
    process.stderr.write(`${r.disposition}: ${r.errorMessage ?? ''}\n`);
    return 1;
  } catch (err) {
    process.stderr.write(paint(`✗ gate record: ${err instanceof Error ? err.message : String(err)}\n`, 'red'));
    return 2;
  }
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

function formatDoctorReport(report: DoctorReport): string {
  const SEVERITY_GLYPH: Record<Severity, string> = {
    ok: paint('✓', 'green'),
    warn: paint('⚠', 'yellow'),
    error: paint('✗', 'red'),
    info: paint('ℹ', 'cyan'),
  };
  const out: string[] = [];
  out.push(paint('\nAgentcohort Doctor', 'bold', 'cyan'));
  out.push(paint(`Project: ${report.cwd}\n`, 'gray'));

  for (const section of report.sections) {
    out.push(paint(`${section.name}:`, 'bold'));
    for (const check of section.checks) {
      out.push(`  ${SEVERITY_GLYPH[check.severity]} ${check.message}`);
      for (const d of check.detail ?? []) {
        out.push(paint(`      └─ ${d}`, 'gray'));
      }
    }
    out.push('');
  }

  const summaryLine = {
    healthy: paint('Summary: Healthy.', 'green'),
    warnings: paint('Summary: Healthy with warnings.', 'yellow'),
    errors: paint('Summary: Unhealthy — fix the errors above.', 'red'),
  }[report.summary];
  out.push(summaryLine);
  return out.join('\n') + '\n';
}

function formatLintReport(report: LintReport): string {
  const SEVERITY_GLYPH: Record<LintSeverity, string> = {
    ok: paint('✓', 'green'),
    warn: paint('⚠', 'yellow'),
    error: paint('✗', 'red'),
  };
  const out: string[] = [];
  out.push(paint('\nAgentcohort Lint', 'bold', 'cyan'));
  out.push(paint(`Project: ${report.cwd}\n`, 'gray'));

  for (const section of report.sections) {
    out.push(paint(`${section.name}:`, 'bold'));
    for (const check of section.checks) {
      out.push(`  ${SEVERITY_GLYPH[check.severity]} ${check.message}`);
      for (const d of check.detail ?? []) {
        out.push(paint(`      └─ ${d}`, 'gray'));
      }
    }
    out.push('');
  }

  const summaryLine = {
    clean: paint('Summary: Clean.', 'green'),
    issues: paint('Summary: Issues found — review the items above.', 'yellow'),
  }[report.summary];
  out.push(summaryLine);
  return out.join('\n') + '\n';
}

function formatStatusReport(report: StatusReport): string {
  const out: string[] = [];
  out.push(paint(`\nagentcohort`, 'bold', 'cyan') + paint(` v${report.version}`, 'gray'));
  out.push(paint(`Project: ${report.cwd}\n`, 'gray'));

  // Install
  const a = report.install.agents;
  const c = report.install.commands;
  const agentLine = `${a.installed} installed (${a.bundled} bundled)`;
  const cmdLine = `${c.installed} installed (${c.bundled} bundled)`;
  const claudeMdLabel = {
    present: paint('routing section present', 'green'),
    missing: paint('not found', 'red'),
    'no-routing-section': paint('present but no routing section', 'yellow'),
  }[report.install.claudeMd];
  const configLabel =
    report.install.config === 'present'
      ? '.agentcohort.json (custom)'
      : paint('defaults', 'gray');
  const openWolfLabel =
    report.install.openWolf === 'active'
      ? paint('active (.wolf/ found)', 'green')
      : paint('not active', 'gray');

  out.push(paint('Install:', 'bold'));
  out.push(`  ${pad('Agents:', 18)} ${agentLine}`);
  out.push(`  ${pad('Commands:', 18)} ${cmdLine}`);
  out.push(`  ${pad('CLAUDE.md:', 18)} ${claudeMdLabel}`);
  out.push(`  ${pad('Config:', 18)} ${configLabel}`);
  out.push(`  ${pad('OpenWolf:', 18)} ${openWolfLabel}`);
  out.push('');

  // Models
  out.push(
    paint('Models', 'bold') +
      (report.modelsSource === 'defaults' ? paint(' (defaults):', 'gray') : ':')
  );
  out.push(`  ${pad('premium:', 18)} ${report.models.premium}`);
  out.push(`  ${pad('mid:', 18)} ${report.models.mid}`);
  out.push(`  ${pad('cheap:', 18)} ${report.models.cheap}`);
  out.push('');

  // Gates
  out.push(
    paint('Gates', 'bold') +
      (report.gatesSource === 'defaults' ? paint(' (defaults):', 'gray') : ':')
  );
  for (const [name, mode] of Object.entries(report.gates)) {
    const modeColor =
      mode === 'on' ? 'green' : mode === 'off' ? 'gray' : 'yellow';
    out.push(`  ${pad(name + ':', 18)} ${paint(mode, modeColor)}`);
  }
  out.push('');

  // Planned
  if (report.planned.length > 0) {
    out.push(paint('Coming in future versions', 'bold', 'gray'));
    for (const f of report.planned) {
      out.push(
        paint(
          `  ${pad(f.target, 8)} ${pad(f.name, 26)} ${f.blurb}`,
          'gray'
        )
      );
    }
  }
  return out.join('\n') + '\n';
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatListReport(report: ListReport): string {
  const out: string[] = [];
  out.push(paint('\nagentcohort list', 'bold', 'cyan'));
  out.push(paint(`Project: ${report.cwd}\n`, 'gray'));

  if (report.agents !== undefined) {
    out.push(formatAgentsBlock(report.agents));
  }
  if (report.commands !== undefined) {
    if (out.length > 2) out.push('');
    out.push(formatCommandsBlock(report.commands));
  }
  if (report.gates !== undefined) {
    if (out.length > 2) out.push('');
    out.push(formatGatesBlock(report.gates));
  }
  return out.join('\n') + '\n';
}

const STATUS_COLOR: Record<ListEntryStatus, 'green' | 'yellow' | 'red' | 'gray' | 'cyan'> = {
  installed: 'green',
  outdated: 'yellow',
  'user-edited': 'yellow',
  unstamped: 'yellow',
  missing: 'red',
  extra: 'gray',
  local: 'cyan',
  'local-override': 'cyan',
};

function statusBadge(status: ListEntryStatus): string {
  return paint(status, STATUS_COLOR[status]);
}

function formatAgentsBlock(entries: ListAgentEntry[]): string {
  const out: string[] = [];
  const installed = entries.filter((e) => e.status === 'installed').length;
  const total = entries.filter((e) => e.status !== 'extra' && e.status !== 'local').length;
  out.push(
    paint(`Agents `, 'bold') +
      paint(`(${installed}/${total} installed)`, 'gray')
  );
  if (entries.length === 0) {
    out.push(paint('  (none — bundled directory missing)', 'gray'));
    return out.join('\n');
  }
  const nameW = Math.max(...entries.map((e) => e.name.length), 8);
  const tierW = 14;
  for (const e of entries) {
    const tierLabel = e.tier
      ? `${e.modelRaw} (${e.tier})`
      : e.modelRaw || '—';
    out.push(
      `  ${pad(e.name, nameW)}  ${pad(tierLabel, tierW)}  ${statusBadge(e.status)}`
    );
    if (e.description !== '') {
      out.push(paint(`    └─ ${truncate(e.description, 96)}`, 'gray'));
    }
  }
  return out.join('\n');
}

function formatCommandsBlock(entries: ListCommandEntry[]): string {
  const out: string[] = [];
  const installed = entries.filter((e) => e.status === 'installed').length;
  const total = entries.filter((e) => e.status !== 'extra' && e.status !== 'local').length;
  out.push(
    paint(`Commands `, 'bold') +
      paint(`(${installed}/${total} installed)`, 'gray')
  );
  if (entries.length === 0) {
    out.push(paint('  (none — bundled directory missing)', 'gray'));
    return out.join('\n');
  }
  const invW = Math.max(...entries.map((e) => e.invocation.length), 10);
  for (const e of entries) {
    out.push(
      `  ${pad(e.invocation, invW)}  ${statusBadge(e.status)}` +
        (e.argumentHint ? paint(`  ${e.argumentHint}`, 'gray') : '')
    );
    if (e.description !== '') {
      out.push(paint(`    └─ ${truncate(e.description, 96)}`, 'gray'));
    }
  }
  return out.join('\n');
}

function formatGatesBlock(entries: ListGateEntry[]): string {
  const out: string[] = [];
  out.push(paint('Gates', 'bold'));
  const nameW = Math.max(...entries.map((e) => e.name.length), 8);
  for (const e of entries) {
    const modeColor =
      e.mode === 'on' ? 'green' : e.mode === 'off' ? 'gray' : 'yellow';
    const srcLabel = e.source === 'config' ? '(config)' : '(default)';
    out.push(
      `  ${pad(e.name, nameW)}  ${paint(pad(e.mode, 6), modeColor)}  ${paint(srcLabel, 'gray')}`
    );
    out.push(paint(`    └─ ${e.blurb}`, 'gray'));
  }
  out.push(
    paint(
      'Modes: on (always pause) · off (never) · auto (pause when Tier 4 / escalation keyword)',
      'gray'
    )
  );
  return out.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function formatShowResult(result: ShowResult): string {
  if (result.notFound) {
    const hint = result.restrictTo
      ? `No ${result.restrictTo} matches '${result.query}'.`
      : `No agent or command matches '${result.query}'.`;
    return paint(`✗ ${hint}\n`, 'red');
  }
  const out: string[] = [];
  for (let i = 0; i < result.matches.length; i += 1) {
    if (i > 0) out.push('');
    out.push(formatShowMatch(result.matches[i]!));
  }
  return out.join('\n') + '\n';
}

function formatShowMatch(m: ShowMatch): string {
  const out: string[] = [];
  const kindLabel = m.kind === 'agent' ? 'Agent' : 'Command';
  const sourceLabel = {
    installed: 'installed',
    'bundled-rendered': 'bundled (rendered + stamped)',
    'bundled-raw': 'bundled (raw, pre-render)',
  }[m.source];
  out.push(
    paint(`── ${kindLabel}: ${m.name} ──`, 'bold', 'cyan') +
      paint(`  ${sourceLabel}`, 'gray')
  );
  out.push(paint(m.path, 'gray'));
  if (m.fallback) {
    out.push(
      paint(
        '! Not installed locally — showing the bundled body. Run `agentcohort init` (or `upgrade`) to install.',
        'yellow'
      )
    );
  }
  if (m.source === 'installed' && m.status !== undefined && m.status !== 'no-bundled') {
    const statusLabel = {
      unchanged: paint('integrity: unchanged', 'green'),
      outdated: paint('integrity: outdated (bundled has moved on)', 'yellow'),
      'user-edited': paint('integrity: user-edited (body diverges from stamp)', 'yellow'),
      unstamped: paint('integrity: unstamped (pre-0.4.0 install)', 'yellow'),
      local: paint(
        'integrity: local (user-authored — `agentcohort upgrade` leaves it alone)',
        'cyan'
      ),
    }[m.status];
    out.push(statusLabel);
  }
  out.push('');
  out.push(m.content.trimEnd());
  return out.join('\n');
}

function formatSearchResult(result: SearchResult): string {
  if (result.note !== '') {
    return paint(`✗ search: ${result.note}\n`, 'red');
  }
  if (result.files.length === 0) {
    const scopeLabel =
      result.scope === 'all' ? 'agents + commands' : result.scope;
    return (
      paint(
        `No matches for ${JSON.stringify(result.query)} in ${scopeLabel} ` +
          `(${result.mode}).\n`,
        'gray'
      )
    );
  }
  const out: string[] = [];
  for (const f of result.files) {
    out.push(formatSearchFile(f));
    out.push('');
  }
  const filesLabel =
    result.totalFiles === 1 ? '1 file' : `${result.totalFiles} files`;
  const matchesLabel =
    result.totalMatches === 1 ? '1 match' : `${result.totalMatches} matches`;
  out.push(
    paint(`${matchesLabel} in ${filesLabel}`, 'bold') +
      paint(`  (${result.mode}, scope: ${result.scope})`, 'gray')
  );
  return out.join('\n') + '\n';
}

function formatSearchFile(f: SearchFileResult): string {
  const kindLabel = f.kind === 'agent' ? 'agents' : 'commands';
  const sourceTag = f.source === 'bundled' ? paint('  [bundled]', 'gray') : '';
  const out: string[] = [];
  out.push(paint(`${kindLabel}/${f.name}.md`, 'bold', 'cyan') + sourceTag);
  // Compute the gutter width from the largest line number so the
  // numbers right-align across all rows of this file.
  const maxLine = f.matches[f.matches.length - 1]?.line ?? 0;
  const gutter = String(maxLine).length;
  for (const m of f.matches) {
    const num = String(m.line).padStart(gutter, ' ');
    out.push(paint(`  ${num}:`, 'gray') + ' ' + highlightLine(m));
  }
  return out.join('\n');
}

function formatUninstallPlan(
  preview: UninstallResult,
  decisions: { removeClaudeSection: boolean; removeConfig: boolean }
): string {
  const s = preview.summary;
  const out: string[] = [];
  out.push(paint('\nagentcohort uninstall — plan', 'bold', 'cyan'));
  out.push(paint(`Project: ${preview.cwd}\n`, 'gray'));
  out.push(
    paint('Will remove:', 'bold') +
      `  ${s.removedFiles} bundled file(s)` +
      (decisions.removeClaudeSection ? ', CLAUDE.md routing section' : '') +
      (decisions.removeConfig ? ', .agentcohort.json' : '')
  );
  out.push(
    paint('Will keep:', 'bold') +
      `   ${s.keptUserFiles} user-authored file(s)` +
      (decisions.removeClaudeSection ? '' : ', CLAUDE.md routing section') +
      (decisions.removeConfig ? '' : ', .agentcohort.json (if present)')
  );
  out.push('');
  return out.join('\n');
}

function formatUninstallResult(result: UninstallResult): string {
  const out: string[] = [];
  const head = result.dryRun ? 'Dry run' : 'Uninstall';
  out.push(paint(`\n${head} complete`, 'bold', 'green'));
  out.push(paint(`Project: ${result.cwd}\n`, 'gray'));
  const tag = result.dryRun ? '[dry-run] ' : '';
  for (const e of result.entries) {
    out.push(formatUninstallEntry(e, tag));
  }
  const s = result.summary;
  const segs: string[] = [];
  segs.push(`${s.removedFiles} removed`);
  segs.push(`${s.keptUserFiles} kept (user)`);
  if (s.sectionRemoved) segs.push('CLAUDE.md section stripped');
  if (s.configRemoved) segs.push('.agentcohort.json removed');
  if (s.backupCount > 0) segs.push(`${s.backupCount} backup(s)`);
  out.push('');
  out.push(paint(`Summary: ${segs.join(' · ')}`, 'bold'));
  return out.join('\n') + '\n';
}

function formatUninstallEntry(e: UninstallEntry, tag: string): string {
  const label: Record<UninstallActionKind, string> = {
    'removed-bundled-file': paint('remove', 'red'),
    'kept-user-file': paint('keep   (user)', 'gray'),
    'removed-routing-section': paint('strip section', 'red'),
    'kept-claude-md': paint('keep   (claude.md)', 'gray'),
    'removed-config': paint('remove', 'red'),
    'kept-config': paint('keep   (config)', 'gray'),
  };
  const bk = e.backupPath ? paint(`  (backup: ${e.backupPath})`, 'gray') : '';
  return `  ${tag}${label[e.kind]}  ${e.path}${bk}`;
}

const RESET_DISP_COLOR: Record<ResetDisposition, 'green' | 'yellow' | 'red'> = {
  noop: 'green',
  reset: 'yellow',
  installed: 'green',
  'refused-extra': 'red',
  'refused-local-new': 'red',
  'refused-not-found': 'red',
  'refused-ambiguous': 'red',
};

function formatResetResult(result: ResetResult): string {
  const a = result.action;
  const out: string[] = [];
  const head = `${a.dryRun ? '[dry-run] ' : ''}reset`;
  const disp = paint(a.disposition, RESET_DISP_COLOR[a.disposition]);
  out.push(paint(head, 'bold') + '  ' + (a.kind ? `${a.kind}/${a.name}` : a.name) + '  ' + disp);
  switch (a.disposition) {
    case 'noop':
      out.push(paint(`  Already matches the bundled body — nothing to do.`, 'gray'));
      break;
    case 'reset':
      if (a.preStatus === 'local-override') {
        out.push(
          paint(
            `  Removed local override and restored bundled body: ${a.installedPath}`,
            'gray'
          )
        );
      } else {
        out.push(
          paint(`  Was: ${a.preStatus}.  Wrote: ${a.installedPath}`, 'gray')
        );
      }
      if (a.backupPath) {
        out.push(paint(`  Backup: ${a.backupPath}`, 'gray'));
      }
      break;
    case 'installed':
      out.push(paint(`  Bundled file installed fresh: ${a.installedPath}`, 'gray'));
      break;
    case 'refused-extra':
      out.push(
        paint(
          `  ✗ This file is installed locally but NOT part of the bundled set — there is no bundled version to reset to.`,
          'red'
        )
      );
      out.push(
        paint(
          `    To remove a user-authored file, delete it manually from ${a.installedPath}.`,
          'gray'
        )
      );
      break;
    case 'refused-local-new':
      out.push(
        paint(
          `  ✗ This file carries \`_agentcohort_local: true\` — it was added by you (or with \`agentcohort add\`) and has no bundled equivalent to revert to.`,
          'red'
        )
      );
      out.push(
        paint(
          `    To remove it, use \`agentcohort uninstall\` (which keeps user files by default — you'd need to delete this file manually) or delete ${a.installedPath} directly.`,
          'gray'
        )
      );
      break;
    case 'refused-not-found':
      out.push(paint(`  ✗ No agent or command matches '${result.query}'.`, 'red'));
      break;
    case 'refused-ambiguous':
      out.push(
        paint(
          `  ✗ Name '${result.query}' matches both an agent AND a command. Use one of:`,
          'red'
        )
      );
      for (const c of result.candidates ?? []) {
        out.push(paint(`    agentcohort reset ${c.kind}/${c.name}`, 'gray'));
      }
      break;
  }
  return out.join('\n') + '\n';
}

function formatResetPreview(preview: ResetResult): string {
  // Compact pre-confirm summary. The user has not yet authorized any
  // write — keep it tight, action + paths only.
  const a = preview.action;
  const out: string[] = [];
  out.push(
    paint('About to reset:', 'bold') +
      '  ' +
      (a.kind ? `${a.kind}/${a.name}` : a.name)
  );
  if (a.preStatus === 'local-override') {
    out.push(
      paint(
        `  This is a LOCAL OVERRIDE — your customization will be dropped and replaced by the bundled body.`,
        'yellow'
      )
    );
  } else {
    out.push(paint(`  Was: ${a.preStatus}.`, 'gray'));
  }
  out.push(paint(`  Target: ${a.installedPath}`, 'gray'));
  if (preview.action.disposition === 'reset' && a.oldText !== '') {
    const diff = unifiedDiff(a.oldText, a.newText, {
      oldLabel: `${a.installedPath} (your version)`,
      newLabel: `${a.installedPath} (bundled)`,
    });
    if (diff !== '') {
      out.push('');
      out.push(diff.trimEnd());
    }
  }
  return out.join('\n') + '\n';
}

function formatAddResult(result: AddResult): string {
  const out: string[] = [];
  const head = `${result.dryRun ? '[dry-run] ' : ''}add`;
  const label = `${result.kind}/${result.name}`;
  switch (result.disposition) {
    case 'created':
      out.push(
        paint(head, 'bold') + '  ' + label + '  ' + paint('created', 'green')
      );
      out.push(paint(`  Wrote: ${result.installedPath}`, 'gray'));
      if (result.kind === 'agent' && result.archetype) {
        out.push(paint(`  Archetype: ${result.archetype}`, 'gray'));
      }
      out.push(
        paint(
          `  Marked with \`_agentcohort_local: true\` — \`agentcohort upgrade\` will leave it alone.`,
          'gray'
        )
      );
      out.push(
        paint(
          `  Next: edit the file to customize the role, then add a routing rule under \`# Agentcohort Routing Rules\` in CLAUDE.md if you want the dispatcher to know about it.`,
          'gray'
        )
      );
      break;
    case 'override-created':
      out.push(
        paint(head, 'bold') +
          '  ' +
          label +
          '  ' +
          paint('override-created', 'green')
      );
      out.push(paint(`  Wrote: ${result.installedPath}`, 'gray'));
      out.push(
        paint(
          `  Body copied from the bundled template and marked as local.`,
          'gray'
        )
      );
      out.push(
        paint(
          `  Your edits now win — upgrades will leave this file alone. Use \`agentcohort reset ${label}\` to revert to the bundled body.`,
          'gray'
        )
      );
      break;
    case 'refused-exists':
      out.push(
        paint(head, 'bold') +
          '  ' +
          label +
          '  ' +
          paint('refused-exists', 'red')
      );
      out.push(
        paint(
          `  ✗ A file already exists at ${result.installedPath}.`,
          'red'
        )
      );
      out.push(
        paint(
          `    Pass --force to overwrite it (no backup unless --backup), or remove it manually first.`,
          'gray'
        )
      );
      break;
    case 'refused-bundled':
      out.push(
        paint(head, 'bold') +
          '  ' +
          label +
          '  ' +
          paint('refused-bundled', 'red')
      );
      out.push(
        paint(
          `  ✗ '${result.name}' is the name of a bundled ${result.kind}. Pick a different name, or pass --override to scaffold a local copy that wins over the bundled body.`,
          'red'
        )
      );
      break;
    case 'refused-invalid-name':
      out.push(
        paint(head, 'bold') +
          '  ' +
          label +
          '  ' +
          paint('refused-invalid-name', 'red')
      );
      out.push(
        paint(
          `  ✗ '${result.name}' is not a valid file name. Use lowercase letters, digits, and hyphens (must start with a letter or digit).`,
          'red'
        )
      );
      break;
  }
  return out.join('\n') + '\n';
}

function formatAddPreview(preview: AddResult): string {
  const out: string[] = [];
  const label = `${preview.kind}/${preview.name}`;
  out.push(paint('About to add:', 'bold') + '  ' + label);
  out.push(paint(`  Target: ${preview.installedPath}`, 'gray'));
  if (preview.disposition === 'override-created') {
    out.push(
      paint(
        `  This is a local copy of the bundled ${preview.kind} '${preview.name}'.`,
        'gray'
      )
    );
  } else if (preview.kind === 'agent' && preview.archetype) {
    out.push(paint(`  Archetype: ${preview.archetype}`, 'gray'));
  }
  return out.join('\n') + '\n';
}

const REFRESH_DISP_COLOR: Record<RefreshDisposition, 'green' | 'yellow' | 'gray' | 'red'> = {
  noop: 'green',
  updated: 'yellow',
  'skipped-local': 'gray',
  'skipped-missing-markers': 'gray',
  'skipped-user-edited': 'red',
};

function formatRefreshResult(result: RefreshResult): string {
  const out: string[] = [];
  const tag = result.dryRun ? '[dry-run] ' : '';
  const updated = result.entries.filter((e) => e.disposition === 'updated').length;
  const noop = result.entries.filter((e) => e.disposition === 'noop').length;
  const skippedLocal = result.entries.filter(
    (e) => e.disposition === 'skipped-local'
  ).length;
  const skippedUserEdited = result.entries.filter(
    (e) => e.disposition === 'skipped-user-edited'
  ).length;
  const skippedMissing = result.entries.filter(
    (e) => e.disposition === 'skipped-missing-markers'
  ).length;

  if (result.entries.length === 0) {
    out.push(paint('refresh-skills: no installed agents found', 'gray'));
    return out.join('\n') + '\n';
  }

  const head = result.dryRun ? 'Refresh plan' : 'Refresh complete';
  out.push(
    paint(head, 'bold') +
      paint(`  (baking ${result.skillCount} skill(s))`, 'gray')
  );
  for (const e of result.entries) {
    if (e.disposition === 'noop') continue; // suppress noise — only show entries that matter
    const disp = paint(e.disposition, REFRESH_DISP_COLOR[e.disposition]);
    const bk = e.backupPath ? paint(`  (backup: ${e.backupPath})`, 'gray') : '';
    out.push(`  ${tag}${disp}  ${e.name}${bk}`);
  }

  // Summary footer.
  const segs: string[] = [];
  if (updated > 0) segs.push(`${updated} updated`);
  if (noop > 0) segs.push(paint(`${noop} unchanged`, 'gray'));
  if (skippedLocal > 0) segs.push(paint(`${skippedLocal} local (skipped)`, 'gray'));
  if (skippedMissing > 0) segs.push(paint(`${skippedMissing} missing-markers (skipped)`, 'gray'));
  if (skippedUserEdited > 0)
    segs.push(paint(`${skippedUserEdited} user-edited (skipped — run \`upgrade\` first)`, 'red'));
  if (segs.length > 0) out.push(paint(`Summary: ${segs.join(' · ')}`, 'bold'));
  if (skippedUserEdited > 0) {
    out.push(
      paint(
        '  Hand-edited files were left untouched. Reconcile via `agentcohort upgrade` (or accept the edits as local with `agentcohort add <name> --override --force`), then re-run.',
        'gray'
      )
    );
  }
  return out.join('\n') + '\n';
}

function formatSkillsReport(result: SkillsScanResult): string {
  const out: string[] = [];
  if (result.skills.length === 0) {
    out.push(paint('No Claude Code skills detected.', 'gray'));
    if (result.searchedRoots.length === 0) {
      out.push(
        paint(
          '  (Searched: ~/.claude/skills, ~/.claude/plugins/*/skills, ./.claude/skills — none exist.)',
          'gray'
        )
      );
    } else {
      out.push(
        paint(
          `  (Searched ${result.searchedRoots.length} root(s); ${result.invalidCount} dir(s) had no readable SKILL.md.)`,
          'gray'
        )
      );
    }
    return out.join('\n') + '\n';
  }
  out.push(
    paint(`${result.skills.length} skill(s) detected`, 'bold') +
      (result.invalidCount > 0
        ? paint(`  (+${result.invalidCount} invalid dir(s) skipped)`, 'gray')
        : '')
  );
  // Group by scope for readability.
  const groups: Array<{ label: string; skills: Skill[] }> = [];
  const userSkills = result.skills.filter((s) => s.scope === 'user');
  if (userSkills.length > 0) groups.push({ label: 'user', skills: userSkills });
  const byPlugin = new Map<string, Skill[]>();
  for (const s of result.skills) {
    if (s.scope !== 'plugin') continue;
    const arr = byPlugin.get(s.pluginName!) ?? [];
    arr.push(s);
    byPlugin.set(s.pluginName!, arr);
  }
  for (const [plugin, list] of [...byPlugin.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    groups.push({ label: `plugin: ${plugin}`, skills: list });
  }
  const projSkills = result.skills.filter((s) => s.scope === 'project');
  if (projSkills.length > 0)
    groups.push({ label: 'project', skills: projSkills });

  const nameW = Math.max(...result.skills.map((s) => s.name.length), 12);
  for (const g of groups) {
    out.push('');
    out.push(paint(`[${g.label}]`, 'cyan'));
    for (const s of g.skills) {
      const extras = s.hasExtras ? paint('  +extras', 'gray') : '';
      out.push(`  ${pad(s.name, nameW)}${extras}`);
      if (s.description !== '') {
        out.push(paint(`    └─ ${truncate(s.description, 90)}`, 'gray'));
      }
    }
  }
  return out.join('\n') + '\n';
}

function formatExportSummary(result: ExportResult): string {
  const out: string[] = [];
  if (result.exitCode === 1) {
    out.push(
      paint(
        'Nothing to export — no `_agentcohort_local: true` files and no `.agentcohort.json` found.',
        'gray'
      )
    );
    return out.join('\n') + '\n';
  }
  const head = result.outPath
    ? `${paint('exported', 'bold', 'green')} → ${result.outPath}`
    : paint('exported (stdout)', 'bold', 'green');
  out.push(head);
  out.push(
    paint(
      `  ${result.fileCount} local file(s), config ${
        result.configIncluded ? 'included' : 'skipped'
      }, schema v${result.pack.schemaVersion}.`,
      'gray'
    )
  );
  if (!result.configIncluded) {
    out.push(
      paint(
        '  (Pass without `--no-config` to bundle `.agentcohort.json` too.)',
        'gray'
      )
    );
  }
  return out.join('\n') + '\n';
}

function formatImportPlan(preview: ImportResult): string {
  const out: string[] = [];
  out.push(paint('About to apply pack:', 'bold') + '  ' + preview.packPath);
  out.push(
    paint(
      `  Schema v${preview.packSchemaVersion}, produced by agentcohort ${preview.packAgentcohortVersion}.`,
      'gray'
    )
  );
  for (const f of preview.files) {
    out.push('  ' + formatImportFileEntry(f, '[dry-run] '));
  }
  if (preview.configHandled !== 'none-in-pack') {
    const label =
      preview.configHandled === 'refused-exists'
        ? paint('refused (exists)', 'red')
        : preview.configHandled === 'skipped'
        ? paint('skipped (--no-config)', 'gray')
        : preview.configHandled === 'written'
        ? paint('write', 'green')
        : paint('overwrite', 'yellow');
    out.push(`  ${label}  ${preview.configPath}`);
  }
  return out.join('\n') + '\n';
}

function formatImportResult(result: ImportResult): string {
  const out: string[] = [];
  const tag = result.dryRun ? '[dry-run] ' : '';
  const head = result.dryRun ? 'Pack preview' : 'Pack imported';
  const color = result.exitCode === 0 ? 'green' : 'yellow';
  out.push(paint(head, 'bold', color) + '  ' + result.packPath);
  for (const f of result.files) {
    out.push('  ' + formatImportFileEntry(f, tag));
  }
  if (result.configHandled !== 'none-in-pack') {
    const target = result.configPath ?? '(unknown)';
    const label = {
      written: paint('config written', 'green'),
      overwritten: paint('config overwritten', 'yellow'),
      'refused-exists': paint('config refused (exists — pass --force)', 'red'),
      skipped: paint('config skipped (--no-config)', 'gray'),
      'none-in-pack': '',
    }[result.configHandled];
    out.push(`  ${tag}${label}  ${target}`);
    if (result.configBackupPath) {
      out.push(paint(`    (backup: ${result.configBackupPath})`, 'gray'));
    }
  }
  // Footer.
  const created = result.files.filter((f) => f.disposition === 'created').length;
  const overwritten = result.files.filter((f) => f.disposition === 'overwritten').length;
  const refused = result.files.filter((f) => f.disposition.startsWith('refused-')).length;
  const segs: string[] = [];
  if (created > 0) segs.push(`${created} created`);
  if (overwritten > 0) segs.push(`${overwritten} overwritten`);
  if (refused > 0) segs.push(paint(`${refused} refused`, 'red'));
  if (segs.length > 0) out.push(paint(`Summary: ${segs.join(' · ')}`, 'bold'));
  if (refused > 0) {
    out.push(
      paint(
        '  Re-run with --force (and optionally --backup) to overwrite existing local files.',
        'gray'
      )
    );
  }
  return out.join('\n') + '\n';
}

function formatImportFileEntry(f: ImportFileEntry, tag: string): string {
  const label = `${f.kind}/${f.name}`;
  const kindTag = f.isOverride ? paint('[override]', 'cyan') : paint('[local]', 'cyan');
  const dispColor =
    f.disposition === 'created'
      ? 'green'
      : f.disposition === 'overwritten'
      ? 'yellow'
      : 'red';
  const disp = paint(f.disposition, dispColor);
  const bk = f.backupPath ? paint(`  (backup: ${f.backupPath})`, 'gray') : '';
  return `${tag}${disp}  ${kindTag} ${label}  → ${f.installedPath}${bk}`;
}

const DIFF_STATUS_COLOR: Record<DiffStatus, 'green' | 'yellow' | 'red' | 'gray' | 'cyan'> = {
  unchanged: 'green',
  outdated: 'yellow',
  'user-edited': 'yellow',
  unstamped: 'yellow',
  missing: 'red',
  extra: 'gray',
  local: 'cyan',
  'local-override': 'cyan',
};

function formatDiffResult(result: DiffResult): string {
  if (result.notFound) {
    const which = result.restrictTo ?? 'agent or command';
    return paint(
      `✗ No ${which} matches '${result.query}'.\n`,
      'red'
    );
  }
  if (result.files.length === 0) {
    const label = result.query
      ? `'${result.query}'`
      : result.scope === 'all'
      ? 'all files'
      : result.scope;
    return paint(`✓ No differences (${label}). ${result.unchangedCount} unchanged.\n`, 'green');
  }
  const out: string[] = [];
  for (const f of result.files) {
    out.push(formatDiffEntry(f));
  }
  // Summary footer.
  const counts = new Map<DiffStatus, number>();
  for (const f of result.files) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
  const segs: string[] = [];
  for (const [s, n] of counts) segs.push(`${n} ${s}`);
  if (result.unchangedCount > 0) segs.push(`${result.unchangedCount} unchanged`);
  out.push(paint(`Summary: ${segs.join(' · ')}`, 'bold'));
  return out.join('\n') + '\n';
}

function formatDiffEntry(f: DiffFileEntry): string {
  const kindLabel = f.kind === 'agent' ? 'agents' : 'commands';
  const head =
    paint(`── ${kindLabel}/${f.name}.md ──`, 'bold', 'cyan') +
    '  ' +
    paint(f.status, DIFF_STATUS_COLOR[f.status]);
  if (f.status === 'extra') {
    return (
      head +
      '\n' +
      paint(
        `  (installed locally but not part of the bundled set — nothing to diff against)`,
        'gray'
      ) +
      '\n'
    );
  }
  if (f.status === 'local') {
    return (
      head +
      '\n' +
      paint(
        `  (user-authored file with no bundled equivalent — nothing to diff against)`,
        'gray'
      ) +
      '\n'
    );
  }
  if (f.status === 'local-override') {
    return (
      head +
      '\n' +
      paint(
        `  This is a local override — the diff below shows what your customization changed from the bundled body.`,
        'gray'
      ) +
      '\n' +
      colorizeDiff(f.diff) +
      '\n'
    );
  }
  // For `missing` the unifiedDiff is "(not installed)" -> bundled body.
  // It can be long but printing it shows exactly what would be installed.
  return head + '\n' + colorizeDiff(f.diff) + '\n';
}

function colorizeDiff(diff: string): string {
  const out: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      out.push(paint(line, 'bold'));
    } else if (line.startsWith('@@')) {
      out.push(paint(line, 'cyan'));
    } else if (line.startsWith('+')) {
      out.push(paint(line, 'green'));
    } else if (line.startsWith('-')) {
      out.push(paint(line, 'red'));
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

function highlightLine(m: SearchLineMatch): string {
  // Render the line with the matched ranges painted. Offsets are
  // already half-open + non-overlapping (matchers advance past each
  // hit before searching for the next), so a single linear walk is
  // enough.
  const out: string[] = [];
  let cursor = 0;
  for (const { start, end } of m.offsets) {
    if (start > cursor) out.push(m.content.slice(cursor, start));
    out.push(paint(m.content.slice(start, end), 'bold', 'yellow'));
    cursor = end;
  }
  if (cursor < m.content.length) out.push(m.content.slice(cursor));
  return out.join('');
}

async function upgradeResolver(
  req: UpgradeConflictRequest,
  opts: { showDiff: boolean }
): Promise<UpgradeConflictDecision> {
  process.stdout.write('\n');
  const reasonLabel = {
    'user-edited': 'edited locally',
    unstamped: 'pre-0.4.0 install (no integrity stamp)',
    'section-edited': 'CLAUDE.md routing section edited',
  }[req.reason];
  process.stdout.write(
    paint(`Conflict: ${req.targetRelPath}  `, 'bold') +
      paint(`(${reasonLabel})\n`, 'yellow')
  );
  if (opts.showDiff) {
    process.stdout.write(
      unifiedDiff(req.oldText, req.newText, {
        oldLabel: `${req.targetRelPath} (your version)`,
        newLabel: `${req.targetRelPath} (bundled)`,
      })
    );
  }

  while (true) {
    const choice = await select<'keep' | 'overwrite' | 'backup-overwrite' | 'diff'>({
      message: `What to do with ${req.targetRelPath}?`,
      choices: [
        { name: 'Keep my version', value: 'keep' },
        { name: 'Overwrite with bundled', value: 'overwrite' },
        { name: 'Backup + overwrite (recommended)', value: 'backup-overwrite' },
        { name: 'Show diff', value: 'diff' },
      ],
      default: 'keep',
    });
    if (choice === 'diff') {
      process.stdout.write(
        unifiedDiff(req.oldText, req.newText, {
          oldLabel: `${req.targetRelPath} (your version)`,
          newLabel: `${req.targetRelPath} (bundled)`,
        })
      );
      continue;
    }
    const applyToAll = await confirm({
      message: 'Apply this choice to all remaining conflicts?',
      default: false,
    });
    return { choice, applyToAll };
  }
}

function printVerboseDiffs(result: UpgradeResult): void {
  const interesting: UpgradeAction[] = result.actions.filter(
    (a) =>
      a.oldText !== undefined &&
      a.newText !== undefined &&
      (a.disposition === 'refreshed' ||
        a.disposition === 'overwritten' ||
        a.disposition === 'backed-up-and-overwritten' ||
        a.disposition === 'kept' ||
        a.disposition === 'section-replaced' ||
        a.disposition === 'section-kept')
  );
  if (interesting.length === 0) return;
  process.stdout.write(paint('\n── Diffs ──\n', 'bold'));
  for (const a of interesting) {
    process.stdout.write(
      paint(`\n[${a.disposition}] ${a.targetRelPath}\n`, 'cyan')
    );
    const diff = unifiedDiff(a.oldText!, a.newText!, {
      oldLabel: `${a.targetRelPath} (current)`,
      newLabel: `${a.targetRelPath} (bundled)`,
    });
    process.stdout.write(diff || paint('  (no textual change)\n', 'gray'));
  }
}

function printUpgradeSummary(result: UpgradeResult): void {
  const counts = new Map<string, number>();
  for (const a of result.actions) {
    counts.set(a.disposition, (counts.get(a.disposition) ?? 0) + 1);
  }
  const part = (label: string, key: string): string | null => {
    const n = counts.get(key) ?? 0;
    return n > 0 ? `${n} ${label}` : null;
  };
  const segments = [
    part('refreshed', 'refreshed'),
    part('created', 'created'),
    part('overwritten', 'overwritten'),
    part('overwritten w/ backup', 'backed-up-and-overwritten'),
    part('kept local', 'kept'),
    part('section-replaced', 'section-replaced'),
    part('section-kept', 'section-kept'),
    part('unchanged', 'unchanged'),
    part('section-unchanged', 'section-unchanged'),
  ].filter((x): x is string => x !== null);

  process.stdout.write('\n');
  const head = result.dryRun ? 'Dry run complete' : 'Upgrade complete';
  process.stdout.write(
    `${paint(head, 'bold', 'green')}  ${segments.join(' · ') || 'nothing to do'}\n`
  );
  if (result.dryRun) {
    process.stdout.write(
      `${paint('•', 'cyan')} Re-run without ${paint('--dry-run', 'bold')} to apply.\n`
    );
  }
}

// Auto-run only when executed as the bin (not when imported by tests/tooling).
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(paint(`\n✗ Fatal: ${String(err)}\n`, 'red'));
      process.exit(1);
    });
}
