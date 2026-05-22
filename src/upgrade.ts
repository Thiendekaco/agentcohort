import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import {
  backupFile,
  backupPathFor,
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
import { renderAgentTemplate } from './render';
import {
  stampTemplate,
  compareIntegrity,
  IntegrityVerdict,
} from './stamp';
import { hasLocalMarker } from './localMarker';
import { injectSkillsList } from './skillsBoot';
import type { Skill } from './skills';
import type { Logger } from './logger';
import type { ModelsConfig } from './config';

/**
 * `agentcohort upgrade` — sync `.claude/` templates and the CLAUDE.md
 * routing section to whatever the currently-installed agentcohort CLI
 * bundles, without clobbering local user edits.
 *
 * Policy summary (the part that differs from `init`):
 *   - `unchanged`     → skip silently.
 *   - `outdated`      → auto-refresh (no prompt — file matches its own
 *                       old stamp, so the user did not edit it).
 *   - `user-edited`   → conflict; prompt with keep / overwrite /
 *                       backup+overwrite (resolver decides).
 *   - `unstamped`     → treat as user-edited (pre-0.4.0 install — we
 *                       cannot tell what changed, so do not assume).
 *   - missing locally → install fresh.
 *   - extra locally   → leave alone (we never delete user files).
 *
 * `.agentcohort.json` is read for the user's model config so renders
 * stay consistent. It is never written by upgrade.
 */

export type UpgradeDisposition =
  | 'unchanged'
  | 'refreshed' // outdated → auto-applied bundled
  | 'overwritten' // user-edited → resolver said overwrite
  | 'backed-up-and-overwritten'
  | 'kept' // user-edited → resolver said keep
  | 'kept-local' // file carries `_agentcohort_local: true` — never touched
  | 'created' // new file in bundled, not in installed
  | 'section-replaced'
  | 'section-unchanged'
  | 'section-kept';

export interface UpgradeAction {
  targetRelPath: string;
  kind: EntryKind;
  verdict: IntegrityVerdict | 'new' | 'section-new' | 'section-existing' | 'local';
  disposition: UpgradeDisposition;
  backupPath?: string;
  dryRun: boolean;
  /** Pre-action file content. Populated when the action involves a
   *  real comparison (i.e. anything other than `unchanged` /
   *  `section-unchanged`). Used to render `--diff` after the fact. */
  oldText?: string;
  /** Post-action file content (what would have been written). */
  newText?: string;
}

export type UpgradeConflictChoice = 'keep' | 'overwrite' | 'backup-overwrite';

export interface UpgradeConflictDecision {
  choice: UpgradeConflictChoice;
  /** When true, apply this choice to every subsequent conflict. */
  applyToAll?: boolean;
}

export interface UpgradeConflictRequest {
  targetRelPath: string;
  reason: 'user-edited' | 'unstamped' | 'section-edited';
  /** Current file content (what the user has). */
  oldText: string;
  /** Bundled content that upgrade would write (post-render + post-stamp). */
  newText: string;
}

export type UpgradeResolver = (
  req: UpgradeConflictRequest
) => Promise<UpgradeConflictDecision>;

export interface UpgradeOptions {
  cwd: string;
  dryRun: boolean;
  /** Overwrite user-edited files without prompting. */
  force: boolean;
  /** Force a backup before any destructive write. */
  backup: boolean;
  /** When false, conflicts resolve via safe defaults (keep user version). */
  interactive: boolean;
  models: ModelsConfig;
  /**
   * Skills detected on the machine. When provided, the boot-directive
   * skills region of each agent is refreshed in the rendered body
   * (so upgrade picks up newly-installed skills). Defaults to `[]`.
   */
  skills?: readonly Skill[];
  resolver?: UpgradeResolver;
  now?: () => Date;
  logger?: Logger;
  templatesDir?: string;
}

export interface UpgradeResult {
  projectRoot: string;
  actions: UpgradeAction[];
  dryRun: boolean;
}

function uniqueBackupPath(target: string, date: Date): string {
  const base = backupPathFor(target, date);
  if (!existsSync(base)) return base;
  let i = 1;
  while (existsSync(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export async function runUpgrade(options: UpgradeOptions): Promise<UpgradeResult> {
  const projectRoot = options.cwd;
  const now = options.now ?? (() => new Date());
  const log = options.logger;
  const templatesDir = options.templatesDir ?? getTemplatesDir();
  const manifest = buildManifest(templatesDir, projectRoot);

  if (manifest.length === 0) {
    throw new Error('agentcohort: no templates found to upgrade against.');
  }

  const actions: UpgradeAction[] = [];
  let sticky: UpgradeConflictDecision | null = null;

  const record = (a: UpgradeAction) => {
    actions.push(a);
    if (!log) return;
    const tag = options.dryRun ? '[dry-run] ' : '';
    const bk = a.backupPath
      ? `  (backup: ${relative(projectRoot, a.backupPath)})`
      : '';
    switch (a.disposition) {
      case 'unchanged':
      case 'section-unchanged':
        log.info(`${tag}unchanged   ${a.targetRelPath}`);
        break;
      case 'refreshed':
        log.success(`${tag}refresh     ${a.targetRelPath}`);
        break;
      case 'overwritten':
      case 'backed-up-and-overwritten':
      case 'section-replaced':
        log.success(`${tag}update      ${a.targetRelPath}${bk}`);
        break;
      case 'kept':
      case 'section-kept':
        log.warn(`${tag}kept local  ${a.targetRelPath}`);
        break;
      case 'kept-local':
        log.info(`${tag}local       ${a.targetRelPath}`);
        break;
      case 'created':
        log.success(`${tag}install     ${a.targetRelPath}`);
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

  // ---- per-entry handlers ----

  async function handleRegular(entry: ManifestEntry): Promise<void> {
    const rawTemplate = readFileSync(entry.templateAbsPath, 'utf8');
    const isAgent = entry.targetRelPath.startsWith('.claude/agents/');
    const rendered = isAgent
      ? renderAgentTemplate(rawTemplate, options.models)
      : rawTemplate;
    const withSkills = isAgent
      ? injectSkillsList(rendered, options.skills ?? [])
      : rendered;
    const bundled = stampTemplate(withSkills);
    const installed = readIfExists(entry.targetAbsPath);

    if (installed === null) {
      // New template not yet installed → install fresh.
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, bundled);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict: 'new',
        disposition: 'created',
        dryRun: options.dryRun,
        newText: bundled,
      });
      return;
    }

    // Local override (file carries `_agentcohort_local: true`) is a
    // deliberate user choice — never overwrite, never prompt. The whole
    // point of the marker is to opt out of upgrade.
    if (hasLocalMarker(installed)) {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict: 'local',
        disposition: 'kept-local',
        dryRun: options.dryRun,
        oldText: installed,
      });
      return;
    }

    const verdict = compareIntegrity(installed, bundled);
    if (verdict === 'unchanged') {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict,
        disposition: 'unchanged',
        dryRun: options.dryRun,
      });
      return;
    }
    if (verdict === 'outdated') {
      // User did not edit; the stamp matches the older bundled body.
      // Auto-refresh — no prompt.
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, bundled);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict,
        disposition: 'refreshed',
        dryRun: options.dryRun,
        oldText: installed,
        newText: bundled,
      });
      return;
    }

    // verdict ∈ {'user-edited', 'unstamped'} — needs a decision.
    const decision = await decideConflict({
      targetRelPath: entry.targetRelPath,
      reason: verdict === 'unstamped' ? 'unstamped' : 'user-edited',
      oldText: installed,
      newText: bundled,
    });

    if (decision.choice === 'keep') {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict,
        disposition: 'kept',
        dryRun: options.dryRun,
        oldText: installed,
        newText: bundled,
      });
      return;
    }

    let backupPath: string | undefined;
    const wantBackup =
      decision.choice === 'backup-overwrite' || options.backup;
    if (wantBackup) backupPath = doBackup(entry.targetAbsPath);
    if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, bundled);
    record({
      targetRelPath: entry.targetRelPath,
      kind: entry.kind,
      verdict,
      disposition:
        decision.choice === 'backup-overwrite'
          ? 'backed-up-and-overwritten'
          : 'overwritten',
      backupPath,
      dryRun: options.dryRun,
      oldText: installed,
      newText: bundled,
    });
  }

  async function handleClaudeSection(entry: ManifestEntry): Promise<void> {
    const sectionMarkdown = readFileSync(entry.templateAbsPath, 'utf8');
    const existing = readIfExists(entry.targetAbsPath);

    if (existing === null) {
      // No CLAUDE.md at all — create it from scratch.
      const content = buildInitialClaudeMd(sectionMarkdown);
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, content);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict: 'section-new',
        disposition: 'created',
        dryRun: options.dryRun,
        newText: content,
      });
      return;
    }

    if (!hasSection(existing)) {
      // CLAUDE.md exists but no agentcohort section — append it. No
      // user content is at risk because we only add.
      const content = upsertSection(existing, sectionMarkdown).result;
      if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, content);
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict: 'section-existing',
        disposition: 'section-replaced',
        dryRun: options.dryRun,
        oldText: existing,
        newText: content,
      });
      return;
    }

    if (sectionMatches(existing, sectionMarkdown)) {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict: 'section-existing',
        disposition: 'section-unchanged',
        dryRun: options.dryRun,
      });
      return;
    }

    // The agentcohort routing section in CLAUDE.md differs from the
    // bundled section — needs a decision. The "user content" outside
    // our section is always preserved by `upsertSection`; the diff
    // shown to the user is the section text only.
    const newContent = upsertSection(existing, sectionMarkdown).result;
    const decision = await decideConflict({
      targetRelPath: entry.targetRelPath,
      reason: 'section-edited',
      oldText: existing,
      newText: newContent,
    });

    if (decision.choice === 'keep') {
      record({
        targetRelPath: entry.targetRelPath,
        kind: entry.kind,
        verdict: 'section-existing',
        disposition: 'section-kept',
        dryRun: options.dryRun,
        oldText: existing,
        newText: newContent,
      });
      return;
    }

    let backupPath: string | undefined;
    const wantBackup =
      decision.choice === 'backup-overwrite' || options.backup;
    if (wantBackup) backupPath = doBackup(entry.targetAbsPath);
    if (!options.dryRun) writeFileEnsuringDir(entry.targetAbsPath, newContent);
    record({
      targetRelPath: entry.targetRelPath,
      kind: entry.kind,
      verdict: 'section-existing',
      disposition: 'section-replaced',
      backupPath,
      dryRun: options.dryRun,
      oldText: existing,
      newText: newContent,
    });
  }

  async function decideConflict(
    req: UpgradeConflictRequest
  ): Promise<UpgradeConflictDecision> {
    // 1. --force: overwrite without asking.
    if (options.force) {
      return { choice: options.backup ? 'backup-overwrite' : 'overwrite' };
    }
    // 2. Non-interactive: keep user version (safe default — we never
    //    lose local edits without consent).
    if (!options.interactive) return { choice: 'keep' };
    // 3. Sticky from previous "apply to all" answer.
    if (sticky) return sticky;
    // 4. Ask via resolver.
    if (!options.resolver) {
      throw new Error('agentcohort: interactive upgrade requires a resolver.');
    }
    const decision = await options.resolver(req);
    if (decision.applyToAll) sticky = decision;
    return decision;
  }
}
