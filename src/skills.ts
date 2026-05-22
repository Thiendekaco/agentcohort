import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Skills discovery — `agentcohort skills`.
 *
 * Claude Code skills live in well-known directory trees on the local
 * machine. Each skill is a directory containing a `SKILL.md` file
 * (with YAML frontmatter exposing `name:` and `description:`) plus
 * optional reference files / scripts.
 *
 * Three scopes:
 *  - `user`     ~ `~/.claude/skills/<name>/SKILL.md`
 *  - `plugin`   ~ `~/.claude/plugins/<plugin>/skills/<name>/SKILL.md`
 *  - `project`  ~ `<cwd>/.claude/skills/<name>/SKILL.md`
 *
 * This module is read-only — it never writes. The discovery result
 * feeds:
 *   - `agentcohort skills` (this PR)
 *   - PR2: `init` bakes the list into each agent's boot directive so
 *          the subagent knows what to invoke via the `Skill` tool.
 *   - PR3: `refresh-skills` / `doctor` integration.
 */

export type SkillScope = 'user' | 'plugin' | 'project';

export interface Skill {
  /**
   * Fully-qualified invocation name. For plugin-scoped skills the
   * convention is `<plugin>:<skill>` (matches what Claude Code
   * surfaces). User and project skills use the bare `<skill>` name.
   */
  name: string;
  /** Short body from the SKILL.md frontmatter `description:` field. */
  description: string;
  scope: SkillScope;
  /** Only set when scope === 'plugin'. */
  pluginName?: string;
  /** Absolute path to the skill directory. */
  path: string;
  /** Absolute path to the SKILL.md file inside the directory. */
  skillMdPath: string;
  /** True when the skill folder has files beyond just SKILL.md (references/scripts/etc.). */
  hasExtras: boolean;
}

export interface SkillsScanResult {
  skills: Skill[];
  /** Roots actually inspected (after existence filtering). */
  searchedRoots: { scope: SkillScope; root: string }[];
  /**
   * Count of subdirectories that looked like skill folders but had no
   * readable SKILL.md (informational; never throws).
   */
  invalidCount: number;
}

export interface ScanOptions {
  cwd: string;
  /** Override the home directory (testing). Defaults to `os.homedir()`. */
  homeDir?: string;
}

export function scanSkills(opts: ScanOptions): SkillsScanResult {
  const home = opts.homeDir ?? homedir();
  const userRoot = join(home, '.claude', 'skills');
  const pluginsRoot = join(home, '.claude', 'plugins');
  const projectRoot = join(opts.cwd, '.claude', 'skills');

  const searchedRoots: SkillsScanResult['searchedRoots'] = [];
  const skills: Skill[] = [];
  let invalidCount = 0;

  // User-scope.
  if (isDir(userRoot)) {
    searchedRoots.push({ scope: 'user', root: userRoot });
    const { found, invalid } = scanSkillDir(userRoot, 'user');
    skills.push(...found);
    invalidCount += invalid;
  }

  // Plugin-scope. Each plugin dir may have its own `skills/` subdir.
  if (isDir(pluginsRoot)) {
    for (const pluginName of safeReaddir(pluginsRoot)) {
      const pluginSkillsDir = join(pluginsRoot, pluginName, 'skills');
      if (!isDir(pluginSkillsDir)) continue;
      searchedRoots.push({ scope: 'plugin', root: pluginSkillsDir });
      const { found, invalid } = scanSkillDir(pluginSkillsDir, 'plugin', pluginName);
      skills.push(...found);
      invalidCount += invalid;
    }
  }

  // Project-scope.
  if (isDir(projectRoot)) {
    searchedRoots.push({ scope: 'project', root: projectRoot });
    const { found, invalid } = scanSkillDir(projectRoot, 'project');
    skills.push(...found);
    invalidCount += invalid;
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, searchedRoots, invalidCount };
}

function scanSkillDir(
  root: string,
  scope: SkillScope,
  pluginName?: string
): { found: Skill[]; invalid: number } {
  const found: Skill[] = [];
  let invalid = 0;
  for (const entry of safeReaddir(root)) {
    const dirPath = join(root, entry);
    if (!isDir(dirPath)) continue;
    const skillMdPath = join(dirPath, 'SKILL.md');
    if (!existsSync(skillMdPath) || !isFile(skillMdPath)) {
      invalid += 1;
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(skillMdPath, 'utf8');
    } catch {
      invalid += 1;
      continue;
    }
    const { name: fmName, description } = parseFrontmatter(raw);
    // The frontmatter `name:` field is the source of truth for the
    // skill identifier. Fall back to the directory name if absent.
    const bareName = fmName ?? entry;
    const fullName =
      scope === 'plugin' && pluginName !== undefined
        ? `${pluginName}:${bareName}`
        : bareName;
    const hasExtras = hasNonSkillMdEntries(dirPath);
    const skill: Skill = {
      name: fullName,
      description,
      scope,
      path: dirPath,
      skillMdPath,
      hasExtras,
    };
    if (pluginName !== undefined) skill.pluginName = pluginName;
    found.push(skill);
  }
  return { found, invalid };
}

function hasNonSkillMdEntries(dir: string): boolean {
  for (const entry of safeReaddir(dir)) {
    if (entry === 'SKILL.md') continue;
    return true;
  }
  return false;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function parseFrontmatter(text: string): { name: string | null; description: string } {
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return { name: null, description: '' };
  const body = fm[1] ?? '';
  return {
    name: extractField(body, 'name'),
    description: extractField(body, 'description') ?? '',
  };
}

/**
 * Extract a top-level YAML field's value. Supports:
 *  - inline scalar:        `key: value`
 *  - literal block (`|`):  `key: |` followed by indented lines → joined with '\n'
 *  - folded block (`>`):   `key: >` followed by indented lines → joined with ' '
 *
 * Skills in the wild use `description: |` for multi-line trigger
 * descriptions, so a naive "first line only" capture loses the actual
 * value. This is just enough YAML to read those fields — no anchors,
 * no flow style, no nested maps.
 */
function extractField(yamlBody: string, key: string): string | null {
  const lines = yamlBody.split(/\r?\n/);
  const head = new RegExp(`^${escapeRe(key)}:[ \\t]*(.*?)[ \\t]*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(head);
    if (!m) continue;
    const inline = (m[1] ?? '').trim();
    if (inline === '|' || inline === '>') {
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j]!;
        if (ln.trim() === '') {
          collected.push('');
          continue;
        }
        if (!/^[ \t]/.test(ln)) break; // back to column 0 = next field
        collected.push(ln.replace(/^[ \t]+/, ''));
      }
      const joined =
        inline === '>' ? collected.join(' ').replace(/\s+/g, ' ').trim() : collected.join('\n').trim();
      return joined;
    }
    return inline;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
