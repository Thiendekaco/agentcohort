import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEMORY_AFFINITY,
  resolveMemoryAffinity,
  affinityFor,
} from '../src/memoryAffinity';

describe('DEFAULT_MEMORY_AFFINITY', () => {
  it('covers every bundled agent (16)', () => {
    const expected = [
      'repo-scout', 'solution-architect', 'feature-planner', 'feature-implementer',
      'test-verifier', 'final-reviewer', 'bug-hunter', 'root-cause-analyst',
      'reproduction-engineer', 'regression-guard', 'bug-fixer',
      'performance-hunter', 'perf-optimizer', 'perf-reviewer',
      'expert-council', 'dispatcher',
    ];
    for (const name of expected) {
      expect(DEFAULT_MEMORY_AFFINITY[name]).toBeDefined();
    }
  });
  it('solution-architect reads decisions + scratch, writes decisions + scratch', () => {
    const aff = DEFAULT_MEMORY_AFFINITY['solution-architect'];
    expect(aff.reads).toContain('decisions');
    expect(aff.writes).toContain('decisions');
  });
  it('bug-fixer writes bugs', () => {
    expect(DEFAULT_MEMORY_AFFINITY['bug-fixer'].writes).toContain('bugs');
  });
  it('test-verifier writes verifications', () => {
    expect(DEFAULT_MEMORY_AFFINITY['test-verifier'].writes).toContain('verifications');
  });
  it('dispatcher writes audit', () => {
    expect(DEFAULT_MEMORY_AFFINITY['dispatcher'].writes).toContain('audit');
  });
});

describe('resolveMemoryAffinity', () => {
  it('returns defaults when no user overrides', () => {
    const r = resolveMemoryAffinity(undefined);
    expect(r['solution-architect'].writes).toContain('decisions');
  });
  it('user entries replace defaults (no union) for that agent', () => {
    const r = resolveMemoryAffinity({
      'solution-architect': { reads: ['bugs'], writes: [] },
    });
    expect(r['solution-architect'].reads).toEqual(['bugs']);
    expect(r['solution-architect'].writes).toEqual([]);
  });
  it('user-only keys add new agents', () => {
    const r = resolveMemoryAffinity({
      'my-custom-agent': { reads: ['decisions'], writes: ['scratch'] },
    });
    expect(r['my-custom-agent']).toEqual({ reads: ['decisions'], writes: ['scratch'] });
  });
  it('agents not in defaults keep their defaults unmerged', () => {
    const r = resolveMemoryAffinity({
      'my-custom-agent': { reads: ['decisions'], writes: ['scratch'] },
    });
    // solution-architect should still have its default
    expect(r['solution-architect'].reads).toContain('decisions');
  });
});

describe('affinityFor', () => {
  it('returns the merged affinity for one agent', () => {
    const a = affinityFor('bug-fixer', undefined);
    expect(a.writes).toContain('bugs');
  });
  it('falls back to empty {reads:[], writes:[]} for unknown', () => {
    const a = affinityFor('unknown-agent', undefined);
    expect(a.reads).toEqual([]);
    expect(a.writes).toEqual([]);
  });
});

describe('DEFAULT_MEMORY_AFFINITY — v0.10.1 collection additions', () => {
  it('dispatcher reads hotspots (for fragility detection)', () => {
    expect(DEFAULT_MEMORY_AFFINITY['dispatcher'].reads).toContain('hotspots');
  });
  it('repo-scout reads module-map (orientation)', () => {
    expect(DEFAULT_MEMORY_AFFINITY['repo-scout'].reads).toContain('module-map');
  });
  it('repo-scout reads conventions', () => {
    expect(DEFAULT_MEMORY_AFFINITY['repo-scout'].reads).toContain('conventions');
  });
  it('final-reviewer writes conventions (learned from review comments)', () => {
    expect(DEFAULT_MEMORY_AFFINITY['final-reviewer'].writes).toContain('conventions');
  });
  it('bug-fixer reads hotspots (avoid known-fragile patterns)', () => {
    expect(DEFAULT_MEMORY_AFFINITY['bug-fixer'].reads).toContain('hotspots');
  });
});
