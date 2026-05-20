import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('release-please configuration', () => {
  it('release-please-config.json is valid and has expected keys', () => {
    const raw = readFileSync('release-please-config.json', 'utf8');
    const cfg = JSON.parse(raw);
    expect(cfg.packages).toBeDefined();
    expect(cfg.packages['.']).toBeDefined();
    expect(cfg.packages['.']['release-type']).toBe('node');
    expect(cfg.packages['.']['package-name']).toBe('agentcohort');
    expect(cfg.packages['.']['changelog-path']).toBe('CHANGELOG.md');
    expect(cfg.packages['.']['include-v-in-tag']).toBe(true);
  });

  it('.release-please-manifest.json is valid and matches package.json', () => {
    const manifest = JSON.parse(
      readFileSync('.release-please-manifest.json', 'utf8')
    );
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(typeof manifest['.']).toBe('string');
    expect(manifest['.']).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
    expect(manifest['.']).toBe(pkg.version);
  });
});
