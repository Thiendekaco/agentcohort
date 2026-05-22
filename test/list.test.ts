import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runList } from '../src/list';
import { runInit } from '../src/installer';
import { DEFAULT_MODELS, GATE_NAMES } from '../src/defaults';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-list-'));
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

describe('runList — scope', () => {
  it('"all" returns all three sections', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'all' });
    expect(report.agents).toBeDefined();
    expect(report.commands).toBeDefined();
    expect(report.gates).toBeDefined();
  });

  it('"agents" returns only the agents section', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    expect(report.agents).toBeDefined();
    expect(report.commands).toBeUndefined();
    expect(report.gates).toBeUndefined();
  });

  it('"commands" returns only the commands section', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'commands' });
    expect(report.agents).toBeUndefined();
    expect(report.commands).toBeDefined();
    expect(report.gates).toBeUndefined();
  });

  it('"gates" returns only the gates section', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'gates' });
    expect(report.agents).toBeUndefined();
    expect(report.commands).toBeUndefined();
    expect(report.gates).toBeDefined();
  });
});

describe('runList — agents on empty project', () => {
  it('lists every bundled agent as "missing"', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    expect(report.agents!.length).toBeGreaterThan(0);
    for (const a of report.agents!) {
      expect(a.status).toBe('missing');
    }
  });

  it('still resolves model tiers for missing agents using bundled body', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const dispatcher = report.agents!.find((a) => a.name === 'dispatcher');
    expect(dispatcher).toBeDefined();
    expect(dispatcher!.modelRaw).not.toBe('');
    expect(dispatcher!.modelResolved).not.toBe('');
  });
});

describe('runList — agents on fresh install', () => {
  it('marks every bundled agent as "installed"', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    for (const a of report.agents!) {
      expect(a.status).toBe('installed');
    }
  });

  it('populates name + description from frontmatter', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    for (const a of report.agents!) {
      expect(a.name).not.toMatch(/\.md$/);
      expect(typeof a.description).toBe('string');
    }
    // Spot-check a known agent.
    const dispatcher = report.agents!.find((a) => a.name === 'dispatcher')!;
    expect(dispatcher.description.length).toBeGreaterThan(10);
  });

  it('resolves model tier to a concrete configured ID', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    for (const a of report.agents!) {
      // After install the `model:` line is rewritten to the concrete ID,
      // so modelResolved should equal one of the configured tier IDs.
      expect([
        DEFAULT_MODELS.premium,
        DEFAULT_MODELS.mid,
        DEFAULT_MODELS.cheap,
      ]).toContain(a.modelResolved);
      expect(['premium', 'mid', 'cheap']).toContain(a.tier);
    }
  });
});

describe('runList — agents with user edits', () => {
  it('flags an edited agent as "user-edited"', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original + '\n# user added line\n', 'utf8');
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const dispatcher = report.agents!.find((a) => a.name === 'dispatcher')!;
    expect(dispatcher.status).toBe('user-edited');
  });

  it('flags an unstamped (pre-0.4.0) agent', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const file = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const original = readFileSync(file, 'utf8');
    // Strip the integrity stamp to simulate a pre-0.4.0 install.
    const stripped = original.replace(/^_agentcohort_hash:[ \t]+\S+[ \t]*\r?\n/m, '');
    writeFileSync(file, stripped, 'utf8');
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const dispatcher = report.agents!.find((a) => a.name === 'dispatcher')!;
    expect(dispatcher.status).toBe('unstamped');
  });

  it('reports a user-authored agent as "extra"', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.claude', 'agents', 'my-helper.md'),
      '---\nname: my-helper\ndescription: My own helper.\ntools: Read\nmodel: haiku\n---\n\nbody\n',
      'utf8'
    );
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const extra = report.agents!.find((a) => a.name === 'my-helper');
    expect(extra).toBeDefined();
    expect(extra!.status).toBe('extra');
  });
});

describe('runList — commands', () => {
  it('lists every bundled command with slash invocation', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'commands' });
    expect(report.commands!.length).toBeGreaterThan(0);
    for (const c of report.commands!) {
      expect(c.invocation).toBe('/' + c.name);
      expect(c.status).toBe('installed');
    }
    // Spot-check description + argument-hint extraction on /auto-flow.
    const autoFlow = report.commands!.find((c) => c.name === 'auto-flow')!;
    expect(autoFlow.description.length).toBeGreaterThan(10);
    expect(autoFlow.argumentHint).toBeDefined();
  });

  it('marks missing commands when nothing is installed', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'commands' });
    for (const c of report.commands!) {
      expect(c.status).toBe('missing');
    }
  });
});

describe('runList — gates', () => {
  it('lists every gate with default mode + source=defaults', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'gates' });
    expect(report.gates!.map((g) => g.name).sort()).toEqual(
      [...GATE_NAMES].sort()
    );
    for (const g of report.gates!) {
      expect(g.source).toBe('defaults');
      expect(g.blurb.length).toBeGreaterThan(10);
    }
  });

  it('flips source=config per-gate when .agentcohort.json overrides it', () => {
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
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'gates' });
    const architect = report.gates!.find((g) => g.name === 'architect')!;
    const plan = report.gates!.find((g) => g.name === 'plan')!;
    const bottleneck = report.gates!.find((g) => g.name === 'bottleneck')!;
    expect(architect.mode).toBe('off');
    expect(architect.source).toBe('config');
    expect(plan.mode).toBe('auto');
    expect(plan.source).toBe('config');
    // Untouched gates remain on defaults.
    expect(bottleneck.source).toBe('defaults');
  });

  it('falls back silently on malformed config', () => {
    const cwd = project();
    writeFileSync(join(cwd, '.agentcohort.json'), '{ broken', 'utf8');
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'gates' });
    for (const g of report.gates!) {
      expect(g.source).toBe('defaults');
    }
  });
});

describe('runList — custom config models', () => {
  it('still resolves missing-agent tiers when models are customized', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: {
          premium: 'custom-premium',
          mid: 'custom-mid',
          cheap: 'custom-cheap',
        },
      }),
      'utf8'
    );
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    // Bundled `model: haiku` → tier 'cheap' → resolves to 'custom-cheap'.
    const dispatcher = report.agents!.find((a) => a.name === 'dispatcher')!;
    expect(dispatcher.tier).toBe('cheap');
    expect(dispatcher.modelResolved).toBe('custom-cheap');
  });
});

describe('runList — JSON-safe output shape', () => {
  it('round-trips through JSON.stringify without loss', () => {
    const cwd = project();
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'all' });
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.scope).toBe('all');
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(Array.isArray(parsed.gates)).toBe(true);
  });
});

describe('runList — overlay-aware (PR2)', () => {
  it('reports a local-new file with status="local" (no bundled equivalent)', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const localPath = join(cwd, '.claude', 'agents', 'my-custom.md');
    writeFileSync(
      localPath,
      `---
name: my-custom
description: Custom local agent
tools: Read
model: sonnet
_agentcohort_local: true
---

# Role

Custom.
`,
      'utf8'
    );
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const e = report.agents!.find((a) => a.name === 'my-custom')!;
    expect(e).toBeDefined();
    expect(e.status).toBe('local');
  });

  it('reports a local-override (same name as bundled, has marker) with status="local-override"', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const overridePath = join(cwd, '.claude', 'agents', 'bug-hunter.md');
    writeFileSync(
      overridePath,
      `---
name: bug-hunter
description: My customized bug hunter
tools: Read
model: opus
_agentcohort_local: true
---

# Role

Customized.
`,
      'utf8'
    );
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const e = report.agents!.find((a) => a.name === 'bug-hunter')!;
    expect(e.status).toBe('local-override');
  });

  it('a file with no marker and no bundled equivalent still shows as "extra"', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const extraPath = join(cwd, '.claude', 'agents', 'random-extra.md');
    writeFileSync(extraPath, '---\nname: random-extra\n---\n\nNo marker here.\n', 'utf8');
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'agents' });
    const e = report.agents!.find((a) => a.name === 'random-extra')!;
    expect(e.status).toBe('extra');
  });

  it('local-override commands surface as "local-override" too', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const overridePath = join(cwd, '.claude', 'commands', 'auto-flow.md');
    writeFileSync(
      overridePath,
      `---
name: auto-flow
description: My customized auto-flow
_agentcohort_local: true
---

# /auto-flow

Customized.
`,
      'utf8'
    );
    const report = runList({ cwd, templatesDir: TEMPLATES, scope: 'commands' });
    const e = report.commands!.find((c) => c.name === 'auto-flow')!;
    expect(e.status).toBe('local-override');
  });
});
