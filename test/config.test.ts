import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  writeConfig,
  validateConfig,
  resolveModels,
  CONFIG_FILENAME,
} from '../src/config';
import { DEFAULT_MODELS } from '../src/defaults';

const tmps: string[] = [];
function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-cfg-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

const VALID = {
  version: 1,
  models: {
    premium: 'claude-opus-4-7',
    mid: 'claude-sonnet-4-6',
    cheap: 'claude-haiku-4-5-20251001',
  },
};

describe('validateConfig', () => {
  it('accepts a valid v1 object', () => {
    expect(validateConfig(VALID)).toEqual(VALID);
  });

  it('rejects non-object', () => {
    expect(() => validateConfig(null)).toThrow(/Invalid \.agentcohort\.json/);
    expect(() => validateConfig('x')).toThrow(/Invalid \.agentcohort\.json/);
    expect(() => validateConfig(42)).toThrow(/Invalid \.agentcohort\.json/);
    expect(() => validateConfig([])).toThrow(/Invalid \.agentcohort\.json/);
  });

  it('rejects wrong version', () => {
    expect(() => validateConfig({ ...VALID, version: 2 })).toThrow(
      /version/
    );
  });

  it('rejects missing tier key', () => {
    const m = { ...VALID.models } as Record<string, string>;
    delete m.mid;
    expect(() => validateConfig({ version: 1, models: m })).toThrow(/mid/);
  });

  it('rejects empty string value', () => {
    expect(() =>
      validateConfig({ version: 1, models: { ...VALID.models, premium: '' } })
    ).toThrow(/premium/);
  });

  it('rejects whitespace-only string value', () => {
    expect(() =>
      validateConfig({ version: 1, models: { ...VALID.models, mid: '   ' } })
    ).toThrow(/mid/);
  });

  it('rejects non-string value', () => {
    expect(() =>
      validateConfig({ version: 1, models: { ...VALID.models, cheap: 5 } })
    ).toThrow(/cheap/);
  });

  it('ignores unknown top-level keys', () => {
    const out = validateConfig({ ...VALID, extra: 'whatever' });
    expect(out).toEqual(VALID);
  });
});

describe('loadConfig / writeConfig', () => {
  it('returns null when file is absent', () => {
    expect(loadConfig(project())).toBeNull();
  });

  it('writes and reads back the same data', () => {
    const root = project();
    writeConfig(root, VALID);
    expect(existsSync(join(root, CONFIG_FILENAME))).toBe(true);
    expect(loadConfig(root)).toEqual(VALID);
  });

  it('includes a $schema URL in the written file', () => {
    const root = project();
    writeConfig(root, VALID);
    const text = readFileSync(join(root, CONFIG_FILENAME), 'utf8');
    expect(text).toContain('"$schema":');
  });

  it('writeConfig is idempotent at the byte level', () => {
    const root = project();
    writeConfig(root, VALID);
    const first = readFileSync(join(root, CONFIG_FILENAME), 'utf8');
    writeConfig(root, VALID);
    const second = readFileSync(join(root, CONFIG_FILENAME), 'utf8');
    expect(second).toBe(first);
  });

  it('loadConfig throws on malformed JSON', () => {
    const root = project();
    writeFileSync(join(root, CONFIG_FILENAME), 'not json {{{', 'utf8');
    expect(() => loadConfig(root)).toThrow(/Invalid \.agentcohort\.json/);
  });

  it('loadConfig throws on schema violation', () => {
    const root = project();
    writeFileSync(
      join(root, CONFIG_FILENAME),
      JSON.stringify({ version: 9, models: VALID.models }),
      'utf8'
    );
    expect(() => loadConfig(root)).toThrow(/version/);
  });
});

describe('resolveModels', () => {
  it('returns DEFAULT_MODELS when config is null', () => {
    expect(resolveModels(null)).toEqual(DEFAULT_MODELS);
  });

  it('returns the embedded models when config is present', () => {
    expect(resolveModels(VALID)).toEqual(VALID.models);
  });
});
