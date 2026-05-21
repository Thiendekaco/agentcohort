#!/usr/bin/env node
import { confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import { runInit, InitResult } from './installer';
import { createInteractiveResolver } from './prompt';
import { promptModelStrategy } from './promptModels';
import { promptGates } from './promptGates';
import { runConfigCmd } from './configCmd';
import { runDoctor, DoctorReport, Severity } from './doctor';
import { runLint, LintReport, LintSeverity } from './lint';
import { runStatus, StatusReport } from './status';
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
    args.command !== 'status'
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

// Auto-run only when executed as the bin (not when imported by tests/tooling).
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(paint(`\n✗ Fatal: ${String(err)}\n`, 'red'));
      process.exit(1);
    });
}
