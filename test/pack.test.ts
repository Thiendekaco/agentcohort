import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInit } from '../src/installer';
import {
  runExport,
  runImport,
  parsePack,
  PackValidationError,
  Pack,
  PACK_SCHEMA_VERSION,
} from '../src/pack';
import { runAdd } from '../src/add';
import { DEFAULT_MODELS } from '../src/defaults';
import { hasLocalMarker } from '../src/localMarker';

const TEMPLATES = resolve(process.cwd(), 'src', 'templates');
const tmps: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-pack-'));
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
    now: () => new Date(2026, 4, 22, 12, 0, 0),
    templatesDir: TEMPLATES,
    models: { ...DEFAULT_MODELS },
  });
}

const ADD_BASE = {
  archetype: null,
  description: null,
  model: null,
  override: false,
  force: false,
  dryRun: false,
};

// ============================================================================
// runExport
// ============================================================================

describe('runExport — local file collection', () => {
  it('produces an empty pack when there are no local files and no config', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: true,
      version: '0.0.0-test',
    });
    // No `.agentcohort.json` on a default install, no locals → exit 1.
    expect(result.exitCode).toBe(1);
    expect(result.fileCount).toBe(0);
    expect(result.configIncluded).toBe(false);
  });

  it('includes local-new and local-override files', async () => {
    const cwd = project();
    await fullInstall(cwd);
    runAdd({ cwd, templatesDir: TEMPLATES, query: 'my-expert', ...ADD_BASE });
    runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'bug-hunter',
      ...ADD_BASE,
      override: true,
      force: true,
    });
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: false,
      version: '0.0.0-test',
    });
    expect(result.exitCode).toBe(0);
    expect(result.fileCount).toBe(2);
    const names = result.pack.files.map((f) => f.name).sort();
    expect(names).toEqual(['bug-hunter', 'my-expert']);
    const newFile = result.pack.files.find((f) => f.name === 'my-expert')!;
    const overrideFile = result.pack.files.find((f) => f.name === 'bug-hunter')!;
    expect(newFile.isOverride).toBe(false);
    expect(overrideFile.isOverride).toBe(true);
  });

  it('does NOT include user-edited bundled files without the local marker', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const filePath = join(cwd, '.claude', 'agents', 'dispatcher.md');
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, original + '\n# user note\n', 'utf8');
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: false,
      version: '0.0.0-test',
    });
    expect(result.fileCount).toBe(0);
    expect(result.pack.files).toEqual([]);
  });

  it('includes commands too', async () => {
    const cwd = project();
    await fullInstall(cwd);
    runAdd({
      cwd,
      templatesDir: TEMPLATES,
      query: 'command/my-flow',
      ...ADD_BASE,
    });
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: false,
      version: '0.0.0-test',
    });
    expect(result.pack.files.length).toBe(1);
    expect(result.pack.files[0]!.kind).toBe('command');
    expect(result.pack.files[0]!.name).toBe('my-flow');
  });

  it('writes the pack to outPath as pretty JSON when provided', async () => {
    const cwd = project();
    await fullInstall(cwd);
    runAdd({ cwd, templatesDir: TEMPLATES, query: 'solo', ...ADD_BASE });
    const out = join(cwd, 'export.json');
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: out,
      includeConfig: false,
      version: '0.7.0',
    });
    expect(result.outPath).toBe(out);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.schemaVersion).toBe(PACK_SCHEMA_VERSION);
    expect(parsed.agentcohort).toBe('0.7.0');
    expect(parsed.files.length).toBe(1);
  });
});

describe('runExport — config handling', () => {
  it('includes .agentcohort.json when present and includeConfig=true', async () => {
    const cwd = project();
    await fullInstall(cwd);
    const cfgPath = join(cwd, '.agentcohort.json');
    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          version: 1,
          models: { premium: 'claude-x', mid: 'claude-y', cheap: 'claude-z' },
        },
        null,
        2
      )
    );
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: true,
      version: '0.0.0-test',
    });
    expect(result.configIncluded).toBe(true);
    expect(result.pack.config).not.toBeNull();
    expect((result.pack.config as { models: { premium: string } }).models.premium).toBe(
      'claude-x'
    );
  });

  it('skips config when includeConfig=false even if .agentcohort.json exists', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(
      join(cwd, '.agentcohort.json'),
      '{"version":1,"models":{"premium":"a","mid":"b","cheap":"c"}}'
    );
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: false,
      version: '0.0.0-test',
    });
    expect(result.configIncluded).toBe(false);
    expect(result.pack.config).toBeNull();
  });

  it('tolerates a malformed .agentcohort.json by skipping config (does not throw)', async () => {
    const cwd = project();
    await fullInstall(cwd);
    writeFileSync(join(cwd, '.agentcohort.json'), 'not json {{{');
    runAdd({ cwd, templatesDir: TEMPLATES, query: 'foo', ...ADD_BASE });
    const result = runExport({
      cwd,
      templatesDir: TEMPLATES,
      outPath: null,
      includeConfig: true,
      version: '0.0.0-test',
    });
    expect(result.pack.config).toBeNull();
    expect(result.fileCount).toBe(1);
  });
});

// ============================================================================
// parsePack
// ============================================================================

describe('parsePack — validation', () => {
  const makeValidPack = (): Pack => ({
    schemaVersion: PACK_SCHEMA_VERSION,
    agentcohort: '0.7.0',
    exportedAt: '2026-05-22T12:00:00.000Z',
    config: null,
    files: [
      {
        kind: 'agent',
        name: 'foo',
        isOverride: false,
        content: '---\nname: foo\n_agentcohort_local: true\n---\n\nBody.\n',
      },
    ],
  });

  it('accepts a well-formed pack', () => {
    const ok = parsePack(JSON.stringify(makeValidPack()));
    expect(ok.files.length).toBe(1);
    expect(ok.files[0]!.name).toBe('foo');
  });

  it('rejects invalid JSON', () => {
    expect(() => parsePack('not json {{{')).toThrow(PackValidationError);
  });

  it('rejects a non-object root', () => {
    expect(() => parsePack('[]')).toThrow(PackValidationError);
    expect(() => parsePack('null')).toThrow(PackValidationError);
    expect(() => parsePack('"string"')).toThrow(PackValidationError);
  });

  it('rejects an unsupported schemaVersion', () => {
    const p = makeValidPack();
    (p as unknown as { schemaVersion: number }).schemaVersion = 99;
    expect(() => parsePack(JSON.stringify(p))).toThrow(/schema version/);
  });

  it('rejects when `files` is not an array', () => {
    const bad = { ...makeValidPack(), files: { not: 'array' } };
    expect(() => parsePack(JSON.stringify(bad))).toThrow(/files/);
  });

  it('rejects a file with an invalid `kind`', () => {
    const p = makeValidPack();
    (p.files[0] as unknown as { kind: string }).kind = 'bogus';
    expect(() => parsePack(JSON.stringify(p))).toThrow(/kind/);
  });

  it('rejects a file with a missing `name`', () => {
    const p = makeValidPack();
    delete (p.files[0] as unknown as { name?: string }).name;
    expect(() => parsePack(JSON.stringify(p))).toThrow(/name/);
  });

  it('rejects a file with a non-boolean `isOverride`', () => {
    const p = makeValidPack();
    (p.files[0] as unknown as { isOverride: string }).isOverride = 'yes';
    expect(() => parsePack(JSON.stringify(p))).toThrow(/isOverride/);
  });

  it('accepts null config and object config', () => {
    const p = makeValidPack();
    expect(parsePack(JSON.stringify({ ...p, config: null })).config).toBeNull();
    expect(parsePack(JSON.stringify({ ...p, config: { foo: 1 } })).config).toEqual({
      foo: 1,
    });
  });

  it('rejects a non-object/null config (e.g. array)', () => {
    const p = makeValidPack();
    expect(() => parsePack(JSON.stringify({ ...p, config: [] }))).toThrow(/config/);
  });
});

// ============================================================================
// runImport
// ============================================================================

describe('runImport — happy paths', () => {
  it('creates local files on the destination from the pack', async () => {
    const srcCwd = project();
    await fullInstall(srcCwd);
    runAdd({ cwd: srcCwd, templatesDir: TEMPLATES, query: 'my-expert', ...ADD_BASE });
    runAdd({
      cwd: srcCwd,
      templatesDir: TEMPLATES,
      query: 'bug-hunter',
      ...ADD_BASE,
      override: true,
      force: true,
    });
    const packPath = join(srcCwd, 'export.json');
    runExport({
      cwd: srcCwd,
      templatesDir: TEMPLATES,
      outPath: packPath,
      includeConfig: false,
      version: '0.0.0-test',
    });

    const dstCwd = project();
    const result = runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: false,
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.files.length).toBe(2);
    expect(result.files.every((f) => f.disposition === 'created')).toBe(true);
    const expert = readFileSync(
      join(dstCwd, '.claude', 'agents', 'my-expert.md'),
      'utf8'
    );
    expect(hasLocalMarker(expert)).toBe(true);
  });

  it('writes .agentcohort.json when importConfig=true and the pack carries one', async () => {
    const srcCwd = project();
    await fullInstall(srcCwd);
    writeFileSync(
      join(srcCwd, '.agentcohort.json'),
      JSON.stringify({
        version: 1,
        models: { premium: 'p', mid: 'm', cheap: 'c' },
      })
    );
    const packPath = join(srcCwd, 'export.json');
    runExport({
      cwd: srcCwd,
      templatesDir: TEMPLATES,
      outPath: packPath,
      includeConfig: true,
      version: '0.0.0-test',
    });

    const dstCwd = project();
    const result = runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: true,
      dryRun: false,
      backup: false,
    });
    expect(result.configHandled).toBe('written');
    const cfg = JSON.parse(
      readFileSync(join(dstCwd, '.agentcohort.json'), 'utf8')
    );
    expect(cfg.models.premium).toBe('p');
  });

  it('forces the local marker on imported content even if it lacks it (defense in depth)', async () => {
    const dstCwd = project();
    const packPath = join(dstCwd, 'p.json');
    const pack = {
      schemaVersion: PACK_SCHEMA_VERSION,
      agentcohort: '0.7.0',
      exportedAt: new Date().toISOString(),
      config: null,
      files: [
        {
          kind: 'agent',
          name: 'unmarked',
          isOverride: false,
          // body has no marker
          content: '---\nname: unmarked\n---\n\nBody.\n',
        },
      ],
    };
    writeFileSync(packPath, JSON.stringify(pack));
    runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: false,
      dryRun: false,
      backup: false,
    });
    const written = readFileSync(
      join(dstCwd, '.claude', 'agents', 'unmarked.md'),
      'utf8'
    );
    expect(hasLocalMarker(written)).toBe(true);
  });
});

describe('runImport — refusals & overwrites', () => {
  it('refuses to overwrite an existing local file without --force', async () => {
    const dstCwd = project();
    runAdd({ cwd: dstCwd, templatesDir: TEMPLATES, query: 'foo', ...ADD_BASE });
    const packPath = join(dstCwd, 'p.json');
    writeFileSync(
      packPath,
      JSON.stringify({
        schemaVersion: PACK_SCHEMA_VERSION,
        agentcohort: '0.7.0',
        exportedAt: new Date().toISOString(),
        config: null,
        files: [
          {
            kind: 'agent',
            name: 'foo',
            isOverride: false,
            content:
              '---\nname: foo\n_agentcohort_local: true\n---\n\nFrom pack.\n',
          },
        ],
      })
    );
    const before = readFileSync(
      join(dstCwd, '.claude', 'agents', 'foo.md'),
      'utf8'
    );
    const result = runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: false,
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.files[0]!.disposition).toBe('refused-exists');
    // File untouched.
    expect(
      readFileSync(join(dstCwd, '.claude', 'agents', 'foo.md'), 'utf8')
    ).toBe(before);
  });

  it('overwrites with --force, with backup when --backup', async () => {
    const dstCwd = project();
    runAdd({ cwd: dstCwd, templatesDir: TEMPLATES, query: 'foo', ...ADD_BASE });
    const packPath = join(dstCwd, 'p.json');
    writeFileSync(
      packPath,
      JSON.stringify({
        schemaVersion: PACK_SCHEMA_VERSION,
        agentcohort: '0.7.0',
        exportedAt: new Date().toISOString(),
        config: null,
        files: [
          {
            kind: 'agent',
            name: 'foo',
            isOverride: false,
            content:
              '---\nname: foo\n_agentcohort_local: true\n---\n\nFrom pack.\n',
          },
        ],
      })
    );
    const result = runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: true,
      importConfig: false,
      dryRun: false,
      backup: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.files[0]!.disposition).toBe('overwritten');
    expect(result.files[0]!.backupPath).toBeDefined();
    expect(existsSync(result.files[0]!.backupPath!)).toBe(true);
    expect(
      readFileSync(join(dstCwd, '.claude', 'agents', 'foo.md'), 'utf8')
    ).toContain('From pack.');
  });

  it('dryRun does not write anything but reports what would happen', async () => {
    const dstCwd = project();
    const packPath = join(dstCwd, 'p.json');
    writeFileSync(
      packPath,
      JSON.stringify({
        schemaVersion: PACK_SCHEMA_VERSION,
        agentcohort: '0.7.0',
        exportedAt: new Date().toISOString(),
        config: null,
        files: [
          {
            kind: 'agent',
            name: 'bar',
            isOverride: false,
            content: '---\nname: bar\n_agentcohort_local: true\n---\n\nBody.\n',
          },
        ],
      })
    );
    const result = runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: false,
      dryRun: true,
      backup: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.files[0]!.disposition).toBe('created');
    expect(result.dryRun).toBe(true);
    expect(
      existsSync(join(dstCwd, '.claude', 'agents', 'bar.md'))
    ).toBe(false);
  });

  it('throws PackValidationError on a missing pack file', () => {
    const dstCwd = project();
    expect(() =>
      runImport({
        cwd: dstCwd,
        templatesDir: TEMPLATES,
        packPath: join(dstCwd, 'does-not-exist.json'),
        force: false,
        importConfig: false,
        dryRun: false,
        backup: false,
      })
    ).toThrow(PackValidationError);
  });

  it('refuses to overwrite an existing .agentcohort.json without --force', async () => {
    const dstCwd = project();
    writeFileSync(
      join(dstCwd, '.agentcohort.json'),
      JSON.stringify({ version: 1, models: { premium: 'a', mid: 'b', cheap: 'c' } })
    );
    const packPath = join(dstCwd, 'p.json');
    writeFileSync(
      packPath,
      JSON.stringify({
        schemaVersion: PACK_SCHEMA_VERSION,
        agentcohort: '0.7.0',
        exportedAt: new Date().toISOString(),
        config: { version: 1, models: { premium: 'x', mid: 'y', cheap: 'z' } },
        files: [],
      })
    );
    const result = runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: true,
      dryRun: false,
      backup: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.configHandled).toBe('refused-exists');
    // Existing config untouched.
    const cfg = JSON.parse(
      readFileSync(join(dstCwd, '.agentcohort.json'), 'utf8')
    );
    expect(cfg.models.premium).toBe('a');
  });
});

// ============================================================================
// Round-trip
// ============================================================================

describe('export → import round trip', () => {
  it('preserves both file content and config across projects', async () => {
    const srcCwd = project();
    await fullInstall(srcCwd);
    runAdd({
      cwd: srcCwd,
      templatesDir: TEMPLATES,
      query: 'expert',
      ...ADD_BASE,
      archetype: 'analyst',
      description: 'My expert',
      model: 'opus',
    });
    runAdd({
      cwd: srcCwd,
      templatesDir: TEMPLATES,
      query: 'bug-hunter',
      ...ADD_BASE,
      override: true,
      force: true,
    });
    writeFileSync(
      join(srcCwd, '.agentcohort.json'),
      JSON.stringify(
        { version: 1, models: { premium: 'X', mid: 'Y', cheap: 'Z' } },
        null,
        2
      )
    );
    const expertOriginal = readFileSync(
      join(srcCwd, '.claude', 'agents', 'expert.md'),
      'utf8'
    );

    const packPath = join(srcCwd, 'pack.json');
    runExport({
      cwd: srcCwd,
      templatesDir: TEMPLATES,
      outPath: packPath,
      includeConfig: true,
      version: '0.0.0-test',
    });

    const dstCwd = project();
    runImport({
      cwd: dstCwd,
      templatesDir: TEMPLATES,
      packPath,
      force: false,
      importConfig: true,
      dryRun: false,
      backup: false,
    });
    expect(
      readFileSync(join(dstCwd, '.claude', 'agents', 'expert.md'), 'utf8')
    ).toBe(expertOriginal);
    const cfg = JSON.parse(
      readFileSync(join(dstCwd, '.agentcohort.json'), 'utf8')
    );
    expect(cfg.models.premium).toBe('X');
    expect(
      existsSync(join(dstCwd, '.claude', 'agents', 'bug-hunter.md'))
    ).toBe(true);
  });
});
