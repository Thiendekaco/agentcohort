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
import { parseArgs, helpText } from './args';

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

  if (args.unknown.length > 0) {
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
    args.command !== 'search'
  ) {
    process.stderr.write(paint(`✗ Unknown command: ${args.command}\n`, 'red'));
    process.stdout.write(helpText() + '\n');
    return 1;
  }

  if (args.command === 'doctor') {
    try {
      const report = runDoctor({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
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
      const report = runList({
        cwd: process.cwd(),
        templatesDir: getTemplatesDir(),
        scope,
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

function formatDoctorReport(report: DoctorReport): string {
  const SEVERITY_GLYPH: Record<Severity, string> = {
    ok: paint('✓', 'green'),
    warn: paint('⚠', 'yellow'),
    error: paint('✗', 'red'),
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

const STATUS_COLOR: Record<ListEntryStatus, 'green' | 'yellow' | 'red' | 'gray'> = {
  installed: 'green',
  outdated: 'yellow',
  'user-edited': 'yellow',
  unstamped: 'yellow',
  missing: 'red',
  extra: 'gray',
};

function statusBadge(status: ListEntryStatus): string {
  return paint(status, STATUS_COLOR[status]);
}

function formatAgentsBlock(entries: ListAgentEntry[]): string {
  const out: string[] = [];
  const installed = entries.filter((e) => e.status === 'installed').length;
  const total = entries.filter((e) => e.status !== 'extra').length;
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
  const total = entries.filter((e) => e.status !== 'extra').length;
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
