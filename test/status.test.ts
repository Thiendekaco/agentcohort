import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { runStatus } from '../src/status';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS } from '../src/defaults';
import { runMemoryInit, runMemoryWrite } from '../src/memoryCmd';
import { v4 as uuidv4 } from 'uuid';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function bundledTemplatesDir(): string {
  return TEMPLATES;
}

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-status-'));
  tmps.push(d);
  return d;
}

afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

async function fullInstall(cwd: string): Promise<void> {
  await runInit({
    cwd,
    yes: true,
    dryRun: false,
    force: false,
    backup: false,
    interactive: false,
    now: () => new Date(2026, 4, 20, 12, 0, 0),
    templatesDir: TEMPLATES,
    models: { ...DEFAULT_MODELS },
  });
}

describe('runStatus — empty project', () => {
  it('reports zero installs + defaults when nothing is set up', () => {
    const cwd = project();
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.cwd).toBe(cwd);
    expect(report.install.agents.installed).toBe(0);
    expect(report.install.commands.installed).toBe(0);
    expect(report.install.claudeMd).toBe('missing');
    expect(report.install.config).toBe('defaults');
    expect(report.install.openWolf).toBe('not-active');
    expect(report.modelsSource).toBe('defaults');
    expect(report.gatesSource).toBe('defaults');
    expect(report.models).toEqual(DEFAULT_MODELS);
  });

  it('reports the bundled counts even when nothing is installed locally', () => {
    const cwd = project();
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.install.agents.bundled).toBeGreaterThan(0);
    expect(report.install.commands.bundled).toBeGreaterThan(0);
  });
});

describe('runStatus — fresh install', () => {
  it('reports installed counts matching bundled counts', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.install.agents.installed).toBe(report.install.agents.bundled);
    expect(report.install.commands.installed).toBe(report.install.commands.bundled);
    expect(report.install.claudeMd).toBe('present');
    expect(report.install.config).toBe('defaults');
  });

  it('reports CLAUDE.md as `no-routing-section` when the file exists without our heading', () => {
    const cwd = project();
    mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Some other project\n\nhi\n', 'utf8');
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.install.claudeMd).toBe('no-routing-section');
  });
});

describe('runStatus — config & gates', () => {
  it('reports modelsSource=config when .agentcohort.json defines models', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: {
          premium: 'custom-premium-id',
          mid: 'custom-mid-id',
          cheap: 'custom-cheap-id',
        },
      }),
      'utf8'
    );
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.modelsSource).toBe('config');
    expect(report.install.config).toBe('present');
    expect(report.models.premium).toBe('custom-premium-id');
    expect(report.models.mid).toBe('custom-mid-id');
    expect(report.models.cheap).toBe('custom-cheap-id');
  });

  it('reports gatesSource=config when .agentcohort.json overrides any gate', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: DEFAULT_MODELS,
        gates: { architect: 'off', plan: 'auto' },
      }),
      'utf8'
    );
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.gatesSource).toBe('config');
    expect(report.gates.architect).toBe('off');
    expect(report.gates.plan).toBe('auto');
    // Untouched gates fall back to defaults.
    expect(report.gates.bottleneck).toBe('auto');
    expect(report.gates['root-cause']).toBe('on');
    expect(report.gates['expert-council']).toBe('on');
  });

  it('falls back to defaults silently on a malformed .agentcohort.json', () => {
    const cwd = project();
    writeFileSync(join(cwd, '.agentcohort.json'), '{ not json', 'utf8');
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    // The file IS present — that's the install-section signal.
    expect(report.install.config).toBe('present');
    // But the values couldn't be parsed — status uses defaults rather than crashing.
    expect(report.modelsSource).toBe('defaults');
    expect(report.gatesSource).toBe('defaults');
    expect(report.models).toEqual(DEFAULT_MODELS);
  });

  it('ignores unknown gate modes — does not flip gatesSource to config', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: DEFAULT_MODELS,
        gates: { architect: 'maybe' },
      }),
      'utf8'
    );
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.gates.architect).toBe('on'); // default
    expect(report.gatesSource).toBe('defaults');
  });
});

describe('runStatus — OpenWolf', () => {
  it('reports openWolf=active when .wolf/ exists', async () => {
    const cwd = project();
    await fullInstall(cwd);
    mkdirSync(join(cwd, '.wolf'), { recursive: true });
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.install.openWolf).toBe('active');
  });

  it('reports openWolf=not-active when .wolf/ is absent', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.install.openWolf).toBe('not-active');
  });
});

describe('runStatus — planned features', () => {
  it('always returns the planned-features list', () => {
    const cwd = project();
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.planned.length).toBeGreaterThan(0);
    for (const f of report.planned) {
      expect(typeof f.name).toBe('string');
      expect(typeof f.target).toBe('string');
      expect(typeof f.blurb).toBe('string');
    }
  });
});

describe('runStatus — version', () => {
  it('reports the package version', () => {
    const cwd = project();
    const report = runStatus({ cwd, templatesDir: TEMPLATES });
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('status — memory section', () => {
  let memDir: string;
  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'agentcohort-status-mem-'));
    execSync('git init -q', { cwd: memDir });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: memDir });
  });
  afterEach(() => rmSync(memDir, { recursive: true, force: true }));

  it('reports memory.initialized=false when not initialized', () => {
    const r = runStatus({ cwd: memDir, templatesDir: bundledTemplatesDir() });
    expect(r.memory.initialized).toBe(false);
  });

  it('reports collection counts after writes', () => {
    runMemoryInit({ cwd: memDir, mode: 'default' });
    runMemoryWrite({
      cwd: memDir, collection: 'decisions', source: 'solution-architect',
      confidence: 1, verified: true, taskSummary: 't', runId: uuidv4(), files: [],
      bodyJson: JSON.stringify({ approach_chosen: 'x', alternatives_considered: [], trade_offs: '', gate_outcome: 'approved' }),
    });
    const r = runStatus({ cwd: memDir, templatesDir: bundledTemplatesDir() });
    expect(r.memory.initialized).toBe(true);
    expect(r.memory.collections['decisions']).toBe(1);
  });
});
