import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelsConfig } from './config';
import {
  backupFile,
  backupPathFor,
  writeFileEnsuringDir,
} from './fileOps';
import { renderAgentTemplate } from './render';
import { stampTemplate } from './stamp';
import { hasLocalMarker } from './localMarker';
import {
  injectSkillsList,
  hasSkillsRegion,
  extractSkillsRegion,
} from './skillsBoot';
import {
  injectMemorySection,
  MEMORY_MARKERS,
} from './memoryBoot';
import {
  resolveAffinity,
  relevantSkills,
  SkillAffinity,
} from './skillAffinity';
import type { Skill } from './skills';
import type { MemoryAffinityEntry } from './memoryAffinity';

/**
 * `agentcohort refresh-skills` — re-bake the boot-directive skill list
 * into every installed bundled agent.
 *
 * Why this exists: at `init` time we scan installed skills and embed
 * the list into each agent's boot directive (see `skillsBoot.ts`). If
 * the user later installs a new Claude Code skill (or removes one),
 * the embedded lists become stale. `refresh-skills` re-renders just
 * that region, leaving everything else untouched.
 *
 * Difference from `agentcohort upgrade`:
 *   - `upgrade` syncs the entire bundled body. Useful when the
 *     agentcohort package itself updates an agent template.
 *   - `refresh-skills` is a narrow rewrite — only the skill list
 *     region changes. Safer + faster + no "user-edited" prompts.
 *
 * Safety contract:
 *   - Local files (`_agentcohort_local: true`) are NEVER touched.
 *   - Files without the skill markers are skipped (legacy installs;
 *     run `agentcohort upgrade` first to add the marker pair).
 *   - User-edited bodies (integrity stamp doesn't match a stripped
 *     hash) are also skipped — the user must reconcile via `upgrade`
 *     first. `refresh-skills` will not silently overwrite hand edits.
 */

export type RefreshDisposition =
  | 'noop' // skill region already matches current skill list
  | 'updated' // skill region rewritten + file restamped
  | 'skipped-local' // file has `_agentcohort_local: true`
  | 'skipped-missing-markers' // file has no `<!-- agentcohort-skills-* -->` markers
  | 'skipped-user-edited'; // body outside the skill region diverges from bundled

export interface RefreshEntry {
  name: string;
  installedPath: string;
  disposition: RefreshDisposition;
  /** Set when the file was rewritten and a backup was made. */
  backupPath?: string;
}

export interface RefreshResult {
  cwd: string;
  dryRun: boolean;
  /** Number of skills baked into the new region (informational). */
  skillCount: number;
  entries: RefreshEntry[];
  /** 0 success, 1 partial (some files skipped-user-edited), 2 internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface RefreshOptions {
  cwd: string;
  templatesDir: string;
  models: ModelsConfig;
  skills: readonly Skill[];
  /** Per-skill affinity overrides (merged with DEFAULT_AFFINITY). */
  affinity?: SkillAffinity;
  /** Per-agent memory affinity overrides (merged with DEFAULT_MEMORY_AFFINITY). */
  memoryAffinity?: Record<string, MemoryAffinityEntry>;
  dryRun: boolean;
  /** Back up each rewritten file before overwriting. */
  backup: boolean;
  now?: () => Date;
}

export function runRefreshSkills(opts: RefreshOptions): RefreshResult {
  const now = opts.now ?? (() => new Date());
  const affinity = resolveAffinity(opts.affinity);
  const agentsDir = join(opts.cwd, '.claude', 'agents');
  const bundledDir = join(opts.templatesDir, 'agents');
  const entries: RefreshEntry[] = [];

  if (!existsSync(agentsDir) || !statSync(agentsDir).isDirectory()) {
    return {
      cwd: opts.cwd,
      dryRun: opts.dryRun,
      skillCount: opts.skills.length,
      entries: [],
      exitCode: 0,
    };
  }

  const installedFiles = readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  for (const f of installedFiles) {
    const installedPath = join(agentsDir, f);
    const bundledPath = join(bundledDir, f);
    const installed = readFileSync(installedPath, 'utf8');

    // Local files own their content — never touch them.
    if (hasLocalMarker(installed)) {
      entries.push({
        name: f.replace(/\.md$/, ''),
        installedPath,
        disposition: 'skipped-local',
      });
      continue;
    }

    // No marker pair → legacy install (pre-skills-injection). Tell the
    // user to upgrade first so the marker pair lands.
    if (!hasSkillsRegion(installed)) {
      entries.push({
        name: f.replace(/\.md$/, ''),
        installedPath,
        disposition: 'skipped-missing-markers',
      });
      continue;
    }

    // No bundled equivalent (e.g. an extra agent that has the marker
    // pair for some reason). Skip it — refresh-skills is for bundled
    // agents only.
    if (!existsSync(bundledPath)) {
      entries.push({
        name: f.replace(/\.md$/, ''),
        installedPath,
        disposition: 'skipped-missing-markers',
      });
      continue;
    }

    // Build the canonical "what init would write right now" for this
    // file: render → inject affinity-filtered current skills → inject memory → stamp.
    const agentName = f.replace(/\.md$/, '');
    const bundledRaw = readFileSync(bundledPath, 'utf8');
    const rendered = renderAgentTemplate(bundledRaw, opts.models);
    const relevant = relevantSkills(agentName, opts.skills, affinity);
    const withSkills = injectSkillsList(rendered, relevant);
    const withMemory = injectMemorySection(withSkills, agentName, opts.memoryAffinity);
    const fresh = stampTemplate(withMemory);

    if (fresh === installed) {
      entries.push({
        name: f.replace(/\.md$/, ''),
        installedPath,
        disposition: 'noop',
      });
      continue;
    }

    // Safety check: is the ONLY delta between installed and fresh the
    // skill region content (and consequently the hash, which is a
    // function of the body)? Strip both — what remains must match
    // byte-for-byte; if not, the user has hand-edited something
    // outside the skill region and we must defer to `upgrade`.
    const installedOutside = bodyOutsideSkillRegion(installed);
    const freshOutside = bodyOutsideSkillRegion(fresh);
    if (installedOutside !== freshOutside) {
      entries.push({
        name: f.replace(/\.md$/, ''),
        installedPath,
        disposition: 'skipped-user-edited',
      });
      continue;
    }

    // Safe to rewrite — only the skill region differs.
    let backupPath: string | undefined;
    if (opts.backup) {
      backupPath = uniqueBackupPath(installedPath, now());
      if (!opts.dryRun) backupFile(installedPath, backupPath);
    }
    if (!opts.dryRun) writeFileEnsuringDir(installedPath, fresh);
    const entry: RefreshEntry = {
      name: f.replace(/\.md$/, ''),
      installedPath,
      disposition: 'updated',
    };
    if (backupPath !== undefined) entry.backupPath = backupPath;
    entries.push(entry);
  }

  const userEdited = entries.filter(
    (e) => e.disposition === 'skipped-user-edited'
  ).length;
  return {
    cwd: opts.cwd,
    dryRun: opts.dryRun,
    skillCount: opts.skills.length,
    entries,
    exitCode: userEdited > 0 ? 1 : 0,
  };
}

const STAMP_LINE_RE = /^_agentcohort_hash:[ \t]+\S+[ \t]*\r?\n/m;
const SKILLS_REGION_RE =
  /<!-- agentcohort-skills-start -->[\s\S]*?<!-- agentcohort-skills-end -->/;
const MEMORY_REGION_RE =
  /<!-- agentcohort-memory-start -->[\s\S]*?<!-- agentcohort-memory-end -->/;

/**
 * Return the file body with the volatile pieces removed:
 *   1. The integrity stamp line (changes whenever the body changes).
 *   2. The skill region between markers (refreshed by this command).
 *   3. The memory region between markers (also refreshed by this command).
 *
 * What remains must match byte-for-byte between an "installed" file
 * and the "what init would write today" version when the user has
 * NOT hand-edited anything outside the managed regions.
 */
function bodyOutsideSkillRegion(text: string): string {
  return text
    .replace(STAMP_LINE_RE, '')
    .replace(SKILLS_REGION_RE, '')
    .replace(MEMORY_REGION_RE, '');
}

function uniqueBackupPath(target: string, date: Date): string {
  const base = backupPathFor(target, date);
  if (!existsSync(base)) return base;
  let i = 1;
  while (existsSync(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
