import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import { DEFAULT_MODELS, TIER_ALIASES } from './defaults';

/**
 * `agentcohort lint` — read-only quality checks for user-edited content.
 *
 * Where `doctor` verifies structural integrity (files present, config
 * valid, integrity stamps intact), `lint` checks the *content quality*
 * of files the user has touched: frontmatter still well-formed, boot
 * directive still present, model tier references still resolve,
 * slash-command references in CLAUDE.md still point at installed
 * commands. Pure with respect to side effects.
 */

export type LintSeverity = 'ok' | 'warn' | 'error';

export interface LintCheck {
  /** Stable machine-readable id (e.g. "agents.frontmatter-broken"). */
  id: string;
  severity: LintSeverity;
  /** Short user-facing line. */
  message: string;
  /** Optional list of supporting facts (file names, etc.). */
  detail?: string[];
}

export interface LintSectionReport {
  name: string;
  checks: LintCheck[];
}

export type LintSummary = 'clean' | 'issues';

export interface LintReport {
  cwd: string;
  sections: LintSectionReport[];
  summary: LintSummary;
  /** Conventional exit code: 0 = clean, 1 = warnings/errors, 2 = internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface LintOptions {
  cwd: string;
  /**
   * Bundled templates root. When provided, lint scopes its boot-directive
   * check to agent files whose names exist in `<templatesDir>/agents/`
   * (i.e., agents originally installed by agentcohort). User-authored
   * agents are exempt. When omitted, every agent file is checked.
   */
  templatesDir?: string;
}

const ROUTING_HEADING_RE = /^# Agentcohort Routing Rules[ \t]*$/m;
const REQUIRED_AGENT_FRONTMATTER_KEYS = [
  'name',
  'description',
  'tools',
  'model',
] as const;
const TIER_ALIAS_NAMES = Object.keys(TIER_ALIASES);

export function runLint(opts: LintOptions): LintReport {
  const sections: LintSectionReport[] = [];
  sections.push(checkAgentFrontmatter(opts.cwd));
  sections.push(checkBootDirective(opts.cwd, opts.templatesDir));
  sections.push(checkModelReferences(opts.cwd));
  sections.push(checkClaudeMdCommandRefs(opts.cwd));

  let worst: LintSeverity = 'ok';
  for (const s of sections) {
    for (const c of s.checks) {
      if (c.severity === 'error') worst = 'error';
      else if (c.severity === 'warn' && worst === 'ok') worst = 'warn';
    }
  }
  const exitCode: 0 | 1 | 2 = worst === 'ok' ? 0 : 1;
  return {
    cwd: opts.cwd,
    sections,
    summary: worst === 'ok' ? 'clean' : 'issues',
    exitCode,
  };
}

// ---------- Section: Agent frontmatter ----------

function checkAgentFrontmatter(cwd: string): LintSectionReport {
  const checks: LintCheck[] = [];
  const dir = join(cwd, '.claude', 'agents');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    checks.push({
      id: 'agents.dir-missing',
      severity: 'ok',
      message: '.claude/agents/ not present — nothing to lint',
    });
    return { name: 'Agent frontmatter', checks };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) {
    checks.push({
      id: 'agents.empty',
      severity: 'ok',
      message: '.claude/agents/ is empty — nothing to lint',
    });
    return { name: 'Agent frontmatter', checks };
  }
  const broken: { file: string; reason: string }[] = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const parse = parseFrontmatter(text);
    if (!parse.ok) {
      broken.push({ file: f, reason: parse.reason });
      continue;
    }
    const missing = REQUIRED_AGENT_FRONTMATTER_KEYS.filter(
      (key) => !new RegExp(`^${key}:`, 'm').test(parse.frontmatter)
    );
    if (missing.length > 0) {
      broken.push({
        file: f,
        reason: `missing required key(s): ${missing.join(', ')}`,
      });
    }
  }
  if (broken.length === 0) {
    checks.push({
      id: 'agents.frontmatter',
      severity: 'ok',
      message: `Frontmatter valid in all ${files.length} agent file(s)`,
    });
  } else {
    checks.push({
      id: 'agents.frontmatter-broken',
      severity: 'error',
      message: `${broken.length} agent file(s) have invalid frontmatter`,
      detail: broken.map((b) => `${b.file}: ${b.reason}`),
    });
  }
  return { name: 'Agent frontmatter', checks };
}

interface FrontmatterParse {
  ok: true;
  /** Raw frontmatter text between the delimiters (no surrounding `---`). */
  frontmatter: string;
}
interface FrontmatterParseError {
  ok: false;
  reason: string;
}

function parseFrontmatter(
  text: string
): FrontmatterParse | FrontmatterParseError {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { ok: false, reason: 'missing opening `---` delimiter' };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) {
    return { ok: false, reason: 'missing closing `---` delimiter' };
  }
  return { ok: true, frontmatter: normalized.slice(4, endIdx) };
}

// ---------- Section: Boot directive ----------

const BOOT_START = '<!-- boot-directive-start -->';
const BOOT_END = '<!-- boot-directive-end -->';

function checkBootDirective(
  cwd: string,
  templatesDir: string | undefined
): LintSectionReport {
  const checks: LintCheck[] = [];
  const dir = join(cwd, '.claude', 'agents');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    checks.push({
      id: 'boot.dir-missing',
      severity: 'ok',
      message: '.claude/agents/ not present — skipping boot directive check',
    });
    return { name: 'Boot directive', checks };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) {
    checks.push({
      id: 'boot.empty',
      severity: 'ok',
      message: '.claude/agents/ is empty',
    });
    return { name: 'Boot directive', checks };
  }
  // Scope to bundled agents when templatesDir is provided. Otherwise
  // check every file (the conservative default for callers without a
  // manifest).
  let bundledSet: Set<string> | null = null;
  if (templatesDir !== undefined) {
    const templateAgents = join(templatesDir, 'agents');
    if (existsSync(templateAgents) && statSync(templateAgents).isDirectory()) {
      bundledSet = new Set(
        readdirSync(templateAgents).filter((f) => f.endsWith('.md'))
      );
    }
  }
  const missing: string[] = [];
  for (const f of files) {
    if (bundledSet !== null && !bundledSet.has(f)) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    if (!text.includes(BOOT_START) || !text.includes(BOOT_END)) {
      missing.push(f);
    }
  }
  if (missing.length === 0) {
    checks.push({
      id: 'boot.present',
      severity: 'ok',
      message: `Boot directive intact in all ${files.length} agent file(s)`,
    });
  } else {
    checks.push({
      id: 'boot.missing',
      severity: 'warn',
      message: `${missing.length} agent file(s) missing boot directive markers`,
      detail: missing,
    });
  }
  return { name: 'Boot directive', checks };
}

// ---------- Section: Model tier references ----------

function checkModelReferences(cwd: string): LintSectionReport {
  const checks: LintCheck[] = [];
  const dir = join(cwd, '.claude', 'agents');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    checks.push({
      id: 'models.dir-missing',
      severity: 'ok',
      message: '.claude/agents/ not present — skipping model reference check',
    });
    return { name: 'Model references', checks };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) {
    checks.push({
      id: 'models.empty',
      severity: 'ok',
      message: '.claude/agents/ is empty',
    });
    return { name: 'Model references', checks };
  }
  const configuredModels = loadConfiguredModels(cwd);
  const validValues = new Set<string>([
    ...TIER_ALIAS_NAMES,
    ...Object.values(configuredModels),
  ]);
  const unresolved: { file: string; value: string }[] = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const parse = parseFrontmatter(text);
    if (!parse.ok) continue; // covered by the frontmatter section
    const match = parse.frontmatter.match(/^model:[ \t]+(\S.*?)[ \t]*$/m);
    const value = match?.[1];
    if (value === undefined) continue; // covered by frontmatter required-keys check
    if (!validValues.has(value)) {
      unresolved.push({ file: f, value });
    }
  }
  if (unresolved.length === 0) {
    checks.push({
      id: 'models.resolved',
      severity: 'ok',
      message: `Every agent's model: resolves to a tier alias or a configured ID`,
    });
  } else {
    checks.push({
      id: 'models.unresolved',
      severity: 'warn',
      message: `${unresolved.length} agent(s) use a model: value that is neither a tier alias nor a configured concrete ID`,
      detail: unresolved.map(
        (u) => `${u.file}: model: ${u.value}`
      ),
    });
  }
  return { name: 'Model references', checks };
}

function loadConfiguredModels(cwd: string): {
  premium: string;
  mid: string;
  cheap: string;
} {
  // Tolerant read — lint never crashes on a malformed config; doctor
  // is the place to report config errors.
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) return { ...DEFAULT_MODELS };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (
      raw &&
      typeof raw === 'object' &&
      raw.models &&
      typeof raw.models === 'object' &&
      typeof raw.models.premium === 'string' &&
      typeof raw.models.mid === 'string' &&
      typeof raw.models.cheap === 'string'
    ) {
      return {
        premium: raw.models.premium,
        mid: raw.models.mid,
        cheap: raw.models.cheap,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_MODELS };
}

// ---------- Section: Command references in CLAUDE.md ----------

function checkClaudeMdCommandRefs(cwd: string): LintSectionReport {
  const checks: LintCheck[] = [];
  const path = join(cwd, 'CLAUDE.md');
  if (!existsSync(path)) {
    checks.push({
      id: 'claudeMd.missing',
      severity: 'ok',
      message: 'CLAUDE.md not present — skipping reference check',
    });
    return { name: 'CLAUDE.md references', checks };
  }
  const text = readFileSync(path, 'utf8');
  const userText = extractUserOwnedText(text);
  const commandsDir = join(cwd, '.claude', 'commands');
  const installed = existsSync(commandsDir)
    ? new Set(
        readdirSync(commandsDir)
          .filter((f) => f.endsWith('.md'))
          .map((f) => '/' + f.replace(/\.md$/, ''))
      )
    : new Set<string>();

  // Pull out backtick-wrapped slash commands — backtick-wrapping is the
  // unambiguous signal that the author is naming a command. Bare slashes
  // in URLs / paths / regex / code blocks are intentionally ignored to
  // keep the false-positive rate near zero.
  const refs = new Set<string>();
  for (const m of userText.matchAll(/`(\/[a-z][a-z0-9-]*)`/g)) {
    if (m[1] !== undefined) refs.add(m[1]);
  }
  const stale: string[] = [];
  for (const ref of refs) {
    if (!installed.has(ref)) stale.push(ref);
  }
  stale.sort();
  if (stale.length === 0) {
    checks.push({
      id: 'claudeMd.references',
      severity: 'ok',
      message:
        refs.size === 0
          ? 'No slash-command references found in the user-owned part of CLAUDE.md'
          : `All ${refs.size} slash-command reference(s) resolve`,
    });
  } else {
    checks.push({
      id: 'claudeMd.stale-commands',
      severity: 'warn',
      message: `${stale.length} slash-command reference(s) point at commands not installed in .claude/commands/`,
      detail: stale.map((r) => `${r} — not installed`),
    });
  }
  return { name: 'CLAUDE.md references', checks };
}

function extractUserOwnedText(text: string): string {
  // Returns the parts of CLAUDE.md that are OUTSIDE the
  // `# Agentcohort Routing Rules` section. Code blocks inside the
  // user section are kept (backtick-wrapped command names inside
  // fenced blocks are still meaningful references).
  const startIdx = text.search(ROUTING_HEADING_RE);
  if (startIdx === -1) return text;
  const before = text.slice(0, startIdx);
  const tail = text.slice(startIdx + 1); // skip our heading's '#'
  const nextTopIdx = tail.search(/^# [^\n]/m);
  const post = nextTopIdx === -1 ? '' : tail.slice(nextTopIdx);
  return before + '\n' + post;
}
