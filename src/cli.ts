#!/usr/bin/env node
import { runInit, InitResult } from './installer';
import { createInteractiveResolver } from './prompt';
import { createLogger, paint } from './logger';
import { getVersion } from './paths';
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

  if (args.command !== 'init') {
    process.stderr.write(paint(`✗ Unknown command: ${args.command}\n`, 'red'));
    process.stdout.write(helpText() + '\n');
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
    if (interactive) resolverHandle = createInteractiveResolver();
    const result = await runInit({
      cwd: process.cwd(),
      yes: args.yes,
      dryRun: args.dryRun,
      force: args.force,
      backup: args.backup,
      interactive,
      resolver: resolverHandle?.resolve,
      logger,
    });
    printSummary(result);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(paint(`\n✗ ${message}\n`, 'red'));
    return 1;
  } finally {
    resolverHandle?.close();
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
