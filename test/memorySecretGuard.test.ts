import { describe, it, expect } from 'vitest';
import { scanForSecrets, SECRET_PATTERNS } from '../src/memorySecretGuard';

describe('scanForSecrets', () => {
  it('detects AWS key', () => {
    const out = scanForSecrets('found AKIAIOSFODNN7EXAMPLE in config');
    expect(out.length).toBe(1);
    expect(out[0].patternName).toBe('aws-access-key-id');
  });
  it('detects OpenAI sk- key', () => {
    const out = scanForSecrets('sk-abcdef1234567890abcdef1234567890abcdef1234567890');
    expect(out.some((m) => m.patternName === 'openai-secret-key')).toBe(true);
  });
  it('detects GitHub token (ghp_, ghs_, gho_, ghu_, ghr_)', () => {
    expect(scanForSecrets('ghp_' + 'a'.repeat(36)).length).toBeGreaterThan(0);
    expect(scanForSecrets('ghs_' + 'a'.repeat(36)).length).toBeGreaterThan(0);
  });
  it('detects Anthropic key', () => {
    const out = scanForSecrets('sk-ant-' + 'a'.repeat(100));
    expect(out.some((m) => m.patternName === 'anthropic-key')).toBe(true);
  });
  it('detects Bearer token', () => {
    const out = scanForSecrets('Authorization: Bearer abcdef1234567890ABCDEF=');
    expect(out.some((m) => m.patternName === 'bearer-token')).toBe(true);
  });
  it('detects private key block', () => {
    const out = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END');
    expect(out.some((m) => m.patternName === 'private-key')).toBe(true);
  });
  it('detects env-style API_KEY=...', () => {
    const out = scanForSecrets('API_KEY=secret_value_here_12345');
    expect(out.some((m) => m.patternName === 'env-secret-line')).toBe(true);
  });
  it('returns empty for clean text', () => {
    expect(scanForSecrets('this is fine, no secrets here')).toEqual([]);
  });
  it('returns empty for short prefix lookalikes', () => {
    expect(scanForSecrets('AKIA-shortish')).toEqual([]);
    expect(scanForSecrets('sk-tooshort')).toEqual([]);
  });
  it('reports byte offset for highlighting', () => {
    const out = scanForSecrets('prefix AKIAIOSFODNN7EXAMPLE suffix');
    expect(out[0].offset).toBe(7);
    expect(out[0].length).toBe('AKIAIOSFODNN7EXAMPLE'.length);
  });
});

describe('SECRET_PATTERNS', () => {
  it('exposes all 7 named patterns', () => {
    const names = SECRET_PATTERNS.map((p) => p.name).sort();
    expect(names).toEqual([
      'anthropic-key',
      'aws-access-key-id',
      'bearer-token',
      'env-secret-line',
      'github-token',
      'openai-secret-key',
      'private-key',
    ]);
  });
});
