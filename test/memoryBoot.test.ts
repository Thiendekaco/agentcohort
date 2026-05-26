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

describe('renderMemorySection — v0.10.1 stage-event additions', () => {
  it('emits stage_start instruction with agent name', () => {
    const out = renderMemorySection('bug-fixer', undefined);
    expect(out).toContain('agentcohort run start --stage=bug-fixer');
  });
  it('emits stage_end instruction with agent name', () => {
    const out = renderMemorySection('bug-fixer', undefined);
    expect(out).toContain('agentcohort run end --stage=bug-fixer');
  });
});

describe('renderMemorySection — dispatcher gets routing lookup', () => {
  it('dispatcher boot directive contains memory-aware routing block', () => {
    const out = renderMemorySection('dispatcher', undefined);
    expect(out).toContain('Memory-aware routing');
  });
  it('non-dispatcher agents do NOT get the routing block', () => {
    const out = renderMemorySection('bug-fixer', undefined);
    expect(out).not.toContain('Memory-aware routing');
  });
});
