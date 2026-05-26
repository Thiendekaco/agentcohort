import { describe, it, expect } from 'vitest';
import { generateDispatcherLookupInstructions } from '../src/memoryLookup';

describe('generateDispatcherLookupInstructions', () => {
  it('returns a non-empty string with the section header', () => {
    expect(generateDispatcherLookupInstructions()).toContain('Memory-aware routing');
  });
  it('instructs dispatcher to call memory list-runs', () => {
    expect(generateDispatcherLookupInstructions()).toContain('agentcohort memory list-runs');
  });
  it('instructs dispatcher to read hotspots', () => {
    expect(generateDispatcherLookupInstructions()).toContain('agentcohort memory read hotspots');
  });
  it('explains Jaccard similarity threshold 0.3', () => {
    expect(generateDispatcherLookupInstructions()).toContain('0.3');
  });
  it('explains fragile-file architect-gate forcing', () => {
    const s = generateDispatcherLookupInstructions();
    expect(s).toContain('fragility_score');
    expect(s).toContain('architect');
  });
  it('mentions audit recording via gate record', () => {
    expect(generateDispatcherLookupInstructions()).toContain('agentcohort gate record');
  });
});
