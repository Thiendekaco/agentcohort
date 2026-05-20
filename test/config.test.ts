import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  writeConfig,
  validateConfig,
  resolveModels,
  resolveGates,
  CONFIG_FILENAME,
} from '../src/config';
import { DEFAULT_MODELS, DEFAULT_GATES } from '../src/defaults';

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

describe('gates — validateConfig', () => {
  it('accepts a config with no gates field (backward-compat for v0.3.x)', () => {
    const out = validateConfig(VALID);
    expect(out.gates).toBeUndefined();
  });

  it('accepts a fully-specified gates object', () => {
    const out = validateConfig({
      ...VALID,
      gates: {
        architect: 'on',
        plan: 'off',
        bottleneck: 'on',
        'root-cause': 'auto',
        'expert-council': 'on',
      },
    });
    expect(out.gates).toEqual({
      architect: 'on',
      plan: 'off',
      bottleneck: 'on',
      'root-cause': 'auto',
      'expert-council': 'on',
    });
  });

  it('accepts a partial gates object (rest fall back to defaults at resolve time)', () => {
    const out = validateConfig({ ...VALID, gates: { architect: 'off' } });
    expect(out.gates).toEqual({ architect: 'off' });
  });

  it('rejects unknown gate names (typo guard)', () => {
    expect(() =>
      validateConfig({ ...VALID, gates: { plzn: 'on' } })
    ).toThrow(/unknown gate/);
  });

  it('rejects invalid gate modes', () => {
    expect(() =>
      validateConfig({ ...VALID, gates: { architect: 'maybe' } })
    ).toThrow(/architect/);
  });

  it('rejects non-object gates', () => {
    expect(() =>
      validateConfig({ ...VALID, gates: 'on' })
    ).toThrow(/gates must be an object/);
  });
});

describe('resolveGates', () => {
  it('returns DEFAULT_GATES when config is null', () => {
    expect(resolveGates(null)).toEqual(DEFAULT_GATES);
  });

  it('returns DEFAULT_GATES when gates field is missing', () => {
    expect(resolveGates(VALID)).toEqual(DEFAULT_GATES);
  });

  it('fills missing gate keys with defaults', () => {
    const cfg = { ...VALID, gates: { architect: 'off' as const } };
    expect(resolveGates(cfg)).toEqual({
      architect: 'off',
      plan: DEFAULT_GATES.plan,
      bottleneck: DEFAULT_GATES.bottleneck,
      'root-cause': DEFAULT_GATES['root-cause'],
      'expert-council': DEFAULT_GATES['expert-council'],
    });
  });

  it('returns the embedded gates when fully specified', () => {
    const gates = {
      architect: 'auto' as const,
      plan: 'off' as const,
      bottleneck: 'on' as const,
      'root-cause': 'on' as const,
      'expert-council': 'auto' as const,
    };
    expect(resolveGates({ ...VALID, gates })).toEqual(gates);
  });

  it('default for bottleneck is auto (the only non-on default)', () => {
    expect(resolveGates(null).bottleneck).toBe('auto');
    expect(resolveGates(VALID).bottleneck).toBe('auto');
  });
});

describe('gates — writeConfig serialization', () => {
  it('does NOT emit gates field when config has none (round-trip clean)', () => {
    const root = project();
    writeConfig(root, VALID);
    const text = readFileSync(join(root, CONFIG_FILENAME), 'utf8');
    expect(text).not.toContain('"gates"');
  });

  it('emits gates field when present and round-trips', () => {
    const root = project();
    const cfg = {
      ...VALID,
      gates: { architect: 'off' as const, plan: 'auto' as const },
    };
    writeConfig(root, cfg);
    expect(loadConfig(root)).toEqual(cfg);
  });

  it('emits gates in canonical order (byte-level idempotent)', () => {
    const root = project();
    // Pass gates in reverse insertion order on purpose.
    const cfg = {
      ...VALID,
      gates: {
        'expert-council': 'auto' as const,
        'root-cause': 'on' as const,
        bottleneck: 'on' as const,
        plan: 'off' as const,
        architect: 'on' as const,
      },
    };
    writeConfig(root, cfg);
    const text = readFileSync(join(root, CONFIG_FILENAME), 'utf8');
    // architect → plan → bottleneck → root-cause → expert-council
    const a = text.indexOf('"architect"');
    const p = text.indexOf('"plan"');
    const b = text.indexOf('"bottleneck"');
    const r = text.indexOf('"root-cause"');
    const e = text.indexOf('"expert-council"');
    expect(a).toBeLessThan(p);
    expect(p).toBeLessThan(b);
    expect(b).toBeLessThan(r);
    expect(r).toBeLessThan(e);
  });
});
