import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  backupFile,
  backupPathFor,
  contentEquals,
  readIfExists,
  writeFileEnsuringDir,
} from './fileOps';
import {
  buildInitialClaudeMd,
  hasSection,
  sectionMatches,
  upsertSection,
} from './claudeMd';
import { buildManifest, EntryKind, ManifestEntry } from './manifest';
import { getTemplatesDir } from './paths';
import type { ConflictDecision, ConflictResolver } from './prompt';
import type { Logger } from './logger';
import { renderAgentTemplate } from './render';
import type { ModelsConfig } from './config';

export type Disposition =
  | 'created'
  | 'overwritten'
  | 'appended-section'
  | 'replaced-section'
  | 'skipped'
  | 'unchanged';

export interface ActionRecord {
  targetRelPath: string;
  kind: EntryKind;
  disposition: Disposition;
  /** Absolute path of the backup that was (or would be) written, if any. */
  backupPath?: string;
  dryRun: boolean;
}

export interface InitOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  /** Force a backup before any destructive write, regardless of other choices. */
  backup: boolean;
  /** When false, conflicts are resolved by safe automatic defaults. */
  interactive: boolean;
  models: ModelsConfig;
  resolver?: ConflictResolver;
  now?: () => Date;
  logger?: Logger;
  templatesDir?: string;
}

export interface InitResult {
  projectRoot: string;
  actions: ActionRecord[];
  dryRun: boolean;
}

interface ConflictPolicy {
  proceed: boolean;
  backup: boolean;
}

/** Pick a non-clobbering backup path (never overwrite an existing backup). */
function uniqueBackupPath(target: string, date: Date): string {
  const base = backupPathFor(target, date);
  if (!existsSync(base)) return base;
  let i = 1;
  while (existsSync(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const projectRoot = options.cwd;
  const now = options.now ?? (() => new Date());
  const log = options.logger;
  const templatesDir = options.templatesDir ?? getTemplatesDir();
  const manifest = buildManifest(templatesDir, projectRoot);

  if (manifest.length === 0) {
    throw new Error('agentcohort: no templates found to install.');
  }

  const actions: ActionRecord[] = [];
  let sticky: ConflictDecision | null = null;

  const decide = async (
    kind: EntryKind,
    targetRelPath: string
  ): Promise<ConflictPolicy> => {
    // 1. --force always proceeds; backup only if explicitly requested.
    if (options.force) {
      return { proceed: true, backup: options.backup };
    }
    // 2. Non-interactive (--yes, --dry-run, or non-TTY): safe defaults.
    if (!options.interactive) {
      if (kind === 'claude-section') {
        // Don't silently rewrite hand-editable routing rules.
        return { proceed: false, backup: false };
      }
      // Deliver latest templates but never lose old content.
      return { proceed: true, backup: true };
    }
    // 3. Interactive: ask (honoring a prior "apply to all" decision).
    if (!options.resolver) {
      throw new Error('agentcohort: interactive mode requires a resolver.');
    }
    const decision = sticky ?? (await options.resolver({ targetRelPath, kind }));
    if (decision.applyToAll && !sticky) sticky = decision;
    if (decision.choice === 'skip') return { proceed: false, backup: false };
    if (decision.choice === 'overwrite') {
      return { proceed: true, backup: options.backup };
    }
    return { proceed: true, backup: true }; // 'backup'
  };

  const record = (a: ActionRecord) => {
    actions.push(a);
    if (!log) return;
    const tag = options.dryRun ? '[dry-run] ' : '';
    const bk = a.backupPath ? `  (backup: ${relative(projectRoot, a.backupPath)})` : '';
    switch (a.disposition) {
      case 'created':
        log.success(`${tag}create  ${a.targetRelPath}`);
        break;
      case 'overwritten':
        log.success(`${tag}update  ${a.targetRelPath}${bk}`);
        break;
      case 'appended-section':
        log.success(`${tag}append  ${a.targetRelPath} (Agentcohort Routing Rules)`);
        break;
      case 'replaced-section':
        log.success(`${tag}update  ${a.targetRelPath} (Agentcohort Routing Rules)${bk}`);
        break;
      case 'unchanged':
        log.info(`${tag}unchanged  ${a.targetRelPath}`);
        break;
      case 'skipped':
        log.warn(`${tag}skip  ${a.targetRelPath}`);
        break;
    }
  };

  const doBackup = (target: string): string => {
    const path = uniqueBackupPath(target, now());
    if (!options.dryRun) backupFile(target, path);
    return path;
  };

  for (const entry of manifest) {
    if (entry.kind === 'regular') {
      await handleRegular(entry);
    } else {
      await handleClaudeSection(entry);
    }
  }

  return { projectRoot, actions, dryRun: options.dryRun };

  // ---- per-entry handlers (closures over decide/record/doBackup) ----

  async function handleRegular(entry: ManifestEntry): Promise<void> {
    const rawTemplate = readFileSync(entry.templateAbsPath, 'utf8');
    const template = entry.targetRelPath.startsWith('.claude/agents/')
      ? renderAgentTemplate(rawTemplate, options.models)
      : rawTemplate;
    const existing = readIfExists(entry.targetAbsPath);

    if (existing === null) {
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, template);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'created',
        dryRun: options.dryRun,
      });
      return;
    }

    if (contentEquals(existing, template)) {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'unchanged',
        dryRun: options.dryRun,
      });
      return;
    }

    const policy = await decide(entry.kind, entry.targetRelPath);
    if (!policy.proceed) {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'skipped',
        dryRun: options.dryRun,
      });
      return;
    }

    let backupPath: string | undefined;
    if (policy.backup) backupPath = doBackup(entry.targetAbsPath);
    if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, template);
    record({
      targetRelPath: entry.targetRelPath,
      kind: entry.kind,
      disposition: 'overwritten',
      backupPath,
      dryRun: options.dryRun,
    });
  }

  async function handleClaudeSection(entry: ManifestEntry): Promise<void> {
    const sectionMarkdown = readFileSync(entry.templateAbsPath, 'utf8');
    const existing = readIfExists(entry.targetAbsPath);

    if (existing === null) {
      const content = buildInitialClaudeMd(sectionMarkdown);
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, content);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'created',
        dryRun: options.dryRun,
      });
      return;
    }

    if (!hasSection(existing)) {
      const content = upsertSection(existing, sectionMarkdown).result;
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, content);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'appended-section',
        dryRun: options.dryRun,
      });
      return;
    }

    if (sectionMatches(existing, sectionMarkdown)) {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'unchanged',
        dryRun: options.dryRun,
      });
      return;
    }

    const policy = await decide(entry.kind, entry.targetRelPath);
    if (!policy.proceed) {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        disposition: 'skipped',
        dryRun: options.dryRun,
      });
      return;
    }

    let backupPath: string | undefined;
    if (policy.backup) backupPath = doBackup(entry.targetAbsPath);
    const content = upsertSection(existing, sectionMarkdown).result;
    if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, content);
    record({
      targetRelPath: entry.targetRelPath,
      kind: entry.kind,
      disposition: 'replaced-section',
      backupPath,
      dryRun: options.dryRun,
    });
  }
}
