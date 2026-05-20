import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from './config';
import {
  DEFAULT_MODELS,
  GATE_NAMES,
  GATE_MODES,
  GateName,
  GateMode,
} from './defaults';
import { renderAgentTemplate } from './render';
import { compareIntegrity, IntegrityVerdict } from './stamp';

/**
 * `agentcohort doctor` — read-only health check.
 *
 * Pure with respect to side effects: this module only reads the
 * filesystem, never writes/creates/deletes anything. Returns a
 * structured `DoctorReport`; the CLI layer renders it for humans or
 * as JSON.
 */

export type Severity = 'ok' | 'warn' | 'error';

export interface CheckResult {
  /** Stable machine-readable id (e.g. "agents.missing"). */
  id: string;
  severity: Severity;
  /** Short user-facing line. */
  message: string;
  /** Optional list of supporting facts (file names, etc.). */
  detail?: string[];
}

export interface SectionReport {
  name: string;
  checks: CheckResult[];
}

export type DoctorSummary = 'healthy' | 'warnings' | 'errors';

export interface DoctorReport {
  /** The project root that was diagnosed. */
  cwd: string;
  sections: SectionReport[];
  summary: DoctorSummary;
  /** Conventional exit code: 0 = healthy, 1 = warnings/errors, 2 = internal failure. */
  exitCode: 0 | 1 | 2;
}

export interface DoctorOptions {
  cwd: string;
  /** Bundled templates root. Defaulted by the CLI to the package's install dir. */
  templatesDir: string;
}

const ROUTING_HEADING_RE = /^# Agentcohort Routing Rules[ \t]*$/gm;
const REQUIRED_SUBSECTIONS = [
  '## Workflow selection',
  '## Operating standard',
];

export function runDoctor(opts: DoctorOptions): DoctorReport {
  const sections: SectionReport[] = [];
  sections.push(checkProject(opts.cwd));
  sections.push(checkConfig(opts.cwd));
  sections.push(checkAgents(opts.cwd, opts.templatesDir));
  sections.push(checkCommands(opts.cwd, opts.templatesDir));
  sections.push(checkClaudeMd(opts.cwd));

  let worst: Severity = 'ok';
  for (const s of sections) {
    for (const c of s.checks) {
      if (c.severity === 'error') worst = 'error';
      else if (c.severity === 'warn' && worst === 'ok') worst = 'warn';
    }
  }
  const summary: DoctorSummary =
    worst === 'ok' ? 'healthy' : worst === 'warn' ? 'warnings' : 'errors';
  const exitCode: 0 | 1 | 2 = worst === 'ok' ? 0 : 1;

  return { cwd: opts.cwd, sections, summary, exitCode };
}

// ---------- Section: Project ----------

function checkProject(cwd: string): SectionReport {
  const checks: CheckResult[] = [];

  // `.agentcohort.json` is OPTIONAL — a user on defaults has no need
  // for it. Treat its absence as informational, not a warning.
  const items: { rel: string; kind: 'file' | 'dir'; optional?: boolean }[] = [
    { rel: CONFIG_FILENAME, kind: 'file', optional: true },
    { rel: '.claude/agents', kind: 'dir' },
    { rel: '.claude/commands', kind: 'dir' },
    { rel: 'CLAUDE.md', kind: 'file' },
  ];
  for (const item of items) {
    const path = join(cwd, item.rel);
    const exists =
      existsSync(path) &&
      (item.kind === 'file' ? statSync(path).isFile() : statSync(path).isDirectory());
    let severity: Severity;
    let message: string;
    if (exists) {
      severity = 'ok';
      message = `${item.rel} found`;
    } else if (item.optional) {
      severity = 'ok';
      message = `${item.rel} not present (optional — defaults apply)`;
    } else {
      severity = 'warn';
      message = `${item.rel} missing`;
    }
    checks.push({ id: `project.${item.rel}`, severity, message });
  }
  return { name: 'Project', checks };
}

// ---------- Section: Config ----------

function checkConfig(cwd: string): SectionReport {
  const checks: CheckResult[] = [];
  const path = join(cwd, CONFIG_FILENAME);

  if (!existsSync(path)) {
    checks.push({
      id: 'config.missing',
      severity: 'ok',
      message: `${CONFIG_FILENAME} not present — defaults apply (run \`agentcohort config\` to customize)`,
    });
    return { name: 'Config', checks };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    checks.push({
      id: 'config.parse',
      severity: 'error',
      message: `${CONFIG_FILENAME} is not valid JSON`,
      detail: [err instanceof Error ? err.message : String(err)],
    });
    return { name: 'Config', checks };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    checks.push({
      id: 'config.shape',
      severity: 'error',
      message: 'Config root must be a JSON object',
    });
    return { name: 'Config', checks };
  }
  const obj = raw as Record<string, unknown>;

  // version
  if (obj.version !== 1) {
    checks.push({
      id: 'config.version',
      severity: 'error',
      message: `Unsupported config version ${JSON.stringify(obj.version)}; expected 1`,
    });
  } else {
    checks.push({
      id: 'config.version',
      severity: 'ok',
      message: 'Schema version: 1',
    });
  }

  // models
  const models = obj.models;
  if (models === null || typeof models !== 'object' || Array.isArray(models)) {
    checks.push({
      id: 'config.models',
      severity: 'error',
      message: 'Missing or invalid `models` object',
    });
  } else {
    const m = models as Record<string, unknown>;
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const tier of ['premium', 'mid', 'cheap'] as const) {
      const v = m[tier];
      if (v === undefined) missing.push(tier);
      else if (typeof v !== 'string' || v.trim().length === 0)
        invalid.push(tier);
    }
    if (missing.length === 0 && invalid.length === 0) {
      checks.push({
        id: 'config.models',
        severity: 'ok',
        message: 'Model tiers configured (premium / mid / cheap)',
      });
    } else {
      checks.push({
        id: 'config.models',
        severity: 'error',
        message: 'Model tiers are missing or invalid',
        detail: [
          ...missing.map((t) => `${t}: missing`),
          ...invalid.map((t) => `${t}: must be a non-empty string`),
        ],
      });
    }
  }

  // gates (optional)
  if (obj.gates !== undefined) {
    if (
      obj.gates === null ||
      typeof obj.gates !== 'object' ||
      Array.isArray(obj.gates)
    ) {
      checks.push({
        id: 'config.gates',
        severity: 'error',
        message: '`gates` must be an object',
      });
    } else {
      const g = obj.gates as Record<string, unknown>;
      const unknownKeys: string[] = [];
      const badValues: string[] = [];
      for (const key of Object.keys(g)) {
        if (!GATE_NAMES.includes(key as GateName)) {
          unknownKeys.push(key);
          continue;
        }
        const v = g[key];
        if (typeof v !== 'string' || !GATE_MODES.includes(v as GateMode)) {
          badValues.push(`${key}: ${JSON.stringify(v)} (expected on/off/auto)`);
        }
      }
      if (unknownKeys.length === 0 && badValues.length === 0) {
        checks.push({
          id: 'config.gates',
          severity: 'ok',
          message: 'Gate config valid',
        });
      } else {
        checks.push({
          id: 'config.gates',
          severity: 'warn',
          message: 'Gate config has issues',
          detail: [
            ...unknownKeys.map((k) => `unknown gate '${k}' (will be ignored)`),
            ...badValues,
          ],
        });
      }
    }
  }

  return { name: 'Config', checks };
}

// ---------- Sections: Agents / Commands ----------

function checkAgents(cwd: string, templatesDir: string): SectionReport {
  return checkTemplateGroup({
    cwd,
    templatesDir,
    group: 'agents',
    sectionName: 'Agents',
    // Agents are rendered (the `model:` line is rewritten to the user's
    // concrete tier ID). Pass the user's models so the integrity check
    // compares apples to apples.
    render: true,
  });
}

function checkCommands(cwd: string, templatesDir: string): SectionReport {
  return checkTemplateGroup({
    cwd,
    templatesDir,
    group: 'commands',
    sectionName: 'Commands',
    render: false,
  });
}

function checkTemplateGroup(args: {
  cwd: string;
  templatesDir: string;
  group: 'agents' | 'commands';
  sectionName: string;
  render: boolean;
}): SectionReport {
  const checks: CheckResult[] = [];
  const installedDir = join(args.cwd, '.claude', args.group);
  const templateDir = join(args.templatesDir, args.group);

  if (!existsSync(templateDir)) {
    checks.push({
      id: `${args.group}.bundled-missing`,
      severity: 'error',
      message: `Bundled ${args.group}/ directory not found in the package`,
    });
    return { name: args.sectionName, checks };
  }

  // The user's resolved models — required for rendering agent templates.
  // We can't import from config without a circular dep, so re-resolve
  // minimally here. If config is broken, agents check still runs but
  // the rendered comparison uses tier aliases as-is (compareIntegrity
  // will then likely report `user-edited` — that's OK, the config
  // section already surfaces the real problem).
  const userModels = loadModelsForRender(args.cwd);

  const bundledFiles = readdirSync(templateDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (!existsSync(installedDir)) {
    checks.push({
      id: `${args.group}.dir-missing`,
      severity: 'error',
      message: `.claude/${args.group}/ does not exist`,
      detail: [
        `expected ${bundledFiles.length} files — run \`agentcohort init\` to install`,
      ],
    });
    return { name: args.sectionName, checks };
  }

  const installedFiles = readdirSync(installedDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const installedSet = new Set(installedFiles);
  const bundledSet = new Set(bundledFiles);

  const missing = bundledFiles.filter((f) => !installedSet.has(f));
  const extra = installedFiles.filter((f) => !bundledSet.has(f));

  // Integrity buckets for the intersection
  const userEdited: string[] = [];
  const outdated: string[] = [];
  const unstamped: string[] = [];

  for (const f of bundledFiles) {
    if (!installedSet.has(f)) continue;
    const bundled = readFileSync(join(templateDir, f), 'utf8');
    const rendered = args.render
      ? renderAgentTemplate(bundled, userModels)
      : bundled;
    const installed = readFileSync(join(installedDir, f), 'utf8');
    const verdict: IntegrityVerdict = compareIntegrity(installed, rendered);
    if (verdict === 'user-edited') userEdited.push(f);
    else if (verdict === 'outdated') outdated.push(f);
    else if (verdict === 'unstamped') unstamped.push(f);
  }

  const installedCount = bundledFiles.length - missing.length;
  checks.push({
    id: `${args.group}.count`,
    severity: missing.length === 0 ? 'ok' : 'warn',
    message: `${installedCount}/${bundledFiles.length} ${args.group} installed`,
  });

  if (missing.length > 0) {
    checks.push({
      id: `${args.group}.missing`,
      severity: 'warn',
      message: `Missing ${missing.length} ${args.group}`,
      detail: missing,
    });
  }
  if (extra.length > 0) {
    checks.push({
      id: `${args.group}.extra`,
      severity: 'warn',
      message: `Found ${extra.length} extra file(s) not from the bundled set`,
      detail: extra,
    });
  }
  if (userEdited.length > 0) {
    checks.push({
      id: `${args.group}.user-edited`,
      severity: 'warn',
      message: `${userEdited.length} file(s) hand-edited locally`,
      detail: userEdited,
    });
  }
  if (outdated.length > 0) {
    checks.push({
      id: `${args.group}.outdated`,
      severity: 'warn',
      message: `${outdated.length} file(s) outdated vs. current package — run \`agentcohort init\` to refresh`,
      detail: outdated,
    });
  }
  if (unstamped.length > 0) {
    checks.push({
      id: `${args.group}.unstamped`,
      severity: 'warn',
      message: `${unstamped.length} file(s) have no integrity stamp (pre-0.4.0 install)`,
      detail: unstamped,
    });
  }
  return { name: args.sectionName, checks };
}

function loadModelsForRender(cwd: string): {
  premium: string;
  mid: string;
  cheap: string;
} {
  // Re-implements a minimal subset of resolveModels to keep doctor
  // independent of config-loading side effects (validateConfig throws
  // on schema violations; doctor must tolerate broken configs and
  // still render templates for the integrity check).
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) return { ...DEFAULT_MODELS };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && raw.models && typeof raw.models === 'object') {
      const m = raw.models;
      if (
        typeof m.premium === 'string' &&
        typeof m.mid === 'string' &&
        typeof m.cheap === 'string'
      ) {
        return { premium: m.premium, mid: m.mid, cheap: m.cheap };
      }
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_MODELS };
}

// ---------- Section: CLAUDE.md ----------

function checkClaudeMd(cwd: string): SectionReport {
  const checks: CheckResult[] = [];
  const path = join(cwd, 'CLAUDE.md');

  if (!existsSync(path)) {
    checks.push({
      id: 'claudeMd.missing',
      severity: 'error',
      message: 'CLAUDE.md not found',
    });
    return { name: 'CLAUDE.md', checks };
  }

  const text = readFileSync(path, 'utf8');
  const headingMatches = text.match(ROUTING_HEADING_RE) ?? [];

  if (headingMatches.length === 0) {
    checks.push({
      id: 'claudeMd.section-missing',
      severity: 'error',
      message: '`# Agentcohort Routing Rules` section not found in CLAUDE.md',
    });
    return { name: 'CLAUDE.md', checks };
  }
  if (headingMatches.length > 1) {
    checks.push({
      id: 'claudeMd.section-duplicated',
      severity: 'error',
      message: `Found ${headingMatches.length} \`# Agentcohort Routing Rules\` headings — should be exactly 1`,
    });
    return { name: 'CLAUDE.md', checks };
  }
  checks.push({
    id: 'claudeMd.section',
    severity: 'ok',
    message: 'Agentcohort section found',
  });

  // Extract section content for subsection checks.
  const startIdx = text.search(ROUTING_HEADING_RE);
  const after = text.slice(startIdx);
  // The section ends at the next top-level heading or EOF.
  const nextTopHeading = after.slice(1).search(/^# [^\n]/m); // skip our own '#'
  const sectionText =
    nextTopHeading === -1 ? after : after.slice(0, nextTopHeading + 1);

  const missingSubs = REQUIRED_SUBSECTIONS.filter(
    (s) => !sectionText.includes(s)
  );
  if (missingSubs.length === 0) {
    checks.push({
      id: 'claudeMd.subsections',
      severity: 'ok',
      message: 'Routing rules present',
    });
  } else {
    checks.push({
      id: 'claudeMd.subsections',
      severity: 'warn',
      message: 'Section is present but missing expected subsections',
      detail: missingSubs.map((s) => `${s} not found`),
    });
  }

  return { name: 'CLAUDE.md', checks };
}
