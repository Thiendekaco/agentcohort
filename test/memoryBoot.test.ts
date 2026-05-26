import { describe, it, expect } from 'vitest';
import { renderMemorySection, MEMORY_MARKERS } from '../src/memoryBoot';

describe('renderMemorySection', () => {
  it('emits start/end markers around a section', () => {
    const out = renderMemorySection('solution-architect', undefined);
    expect(out).toContain(MEMORY_MARKERS.start);
    expect(out).toContain(MEMORY_MARKERS.end);
  });
  it('includes the agent reads + writes', () => {
    const out = renderMemorySection('solution-architect', undefined);
    expect(out).toContain('Reads: decisions, scratch');
    expect(out).toContain('Writes: decisions, scratch');
  });
  it('honors user override', () => {
    const out = renderMemorySection('solution-architect', {
      'solution-architect': { reads: ['bugs'], writes: [] },
    });
    expect(out).toContain('Reads: bugs');
    expect(out).toContain('Writes: (none)');
  });
  it('includes the NEVER store secrets line', () => {
    const out = renderMemorySection('bug-fixer', undefined);
    expect(out).toContain('NEVER store secrets');
  });
  it('substitutes the agent name into write commands', () => {
    const out = renderMemorySection('bug-fixer', undefined);
    expect(out).toContain('--source=bug-fixer');
  });
});
