import { describe, it, expect } from 'vitest';
import {
  contentHash,
  stampTemplate,
  parseStamp,
  compareIntegrity,
} from '../src/stamp';

const AGENT_FM = `---
name: test
description: stub
tools: Read
model: haiku
---

# Role

You are a test agent.
`;

const AGENT_NO_FM = `# Role\n\nNo frontmatter.\n`;

describe('contentHash', () => {
  it('is deterministic for the same input', () => {
    expect(contentHash(AGENT_FM)).toBe(contentHash(AGENT_FM));
  });

  it('ignores changes to the model line', () => {
    const a = AGENT_FM.replace('model: haiku', 'model: sonnet');
    const b = AGENT_FM.replace('model: haiku', 'model: claude-opus-x');
    expect(contentHash(a)).toBe(contentHash(AGENT_FM));
    expect(contentHash(b)).toBe(contentHash(AGENT_FM));
  });

  it('detects body changes', () => {
    const edited = AGENT_FM.replace('You are a test agent.', 'You are MODIFIED.');
    expect(contentHash(edited)).not.toBe(contentHash(AGENT_FM));
  });

  it('ignores changes to the stamp line', () => {
    const stamped = stampTemplate(AGENT_FM);
    const tampered = stamped.replace(
      /_agentcohort_hash:[ \t]+\S+/,
      '_agentcohort_hash: deadbeefdeadbeef'
    );
    // The canonical hash is the same in both — only parseStamp() differs.
    expect(contentHash(stamped)).toBe(contentHash(tampered));
  });
});

describe('stampTemplate', () => {
  it('inserts _agentcohort_hash field into frontmatter', () => {
    const out = stampTemplate(AGENT_FM);
    expect(out).toMatch(/^_agentcohort_hash:[ \t]+[0-9a-f]{16}[ \t]*$/m);
    // Original body intact
    expect(out).toContain('# Role');
    expect(out).toContain('You are a test agent.');
    // Closing frontmatter delimiter still present exactly once
    const dashLines = out.split('\n').filter((l) => l === '---');
    expect(dashLines.length).toBe(2);
  });

  it('is idempotent — stamping twice produces identical bytes', () => {
    const once = stampTemplate(AGENT_FM);
    const twice = stampTemplate(once);
    expect(twice).toBe(once);
  });

  it('updates the stamp when body changes', () => {
    const stamped = stampTemplate(AGENT_FM);
    const edited = stamped.replace(
      'You are a test agent.',
      'You are MODIFIED.'
    );
    const restamped = stampTemplate(edited);
    expect(parseStamp(restamped)).not.toBe(parseStamp(stamped));
  });

  it('does not stamp content without frontmatter', () => {
    expect(stampTemplate(AGENT_NO_FM)).toBe(AGENT_NO_FM);
  });

  it('stamping is invariant under model-line changes', () => {
    const a = stampTemplate(AGENT_FM);
    const swapped = AGENT_FM.replace('model: haiku', 'model: sonnet');
    const b = stampTemplate(swapped);
    // Stamps are equal because contentHash ignores the model line.
    expect(parseStamp(a)).toBe(parseStamp(b));
  });
});

describe('parseStamp', () => {
  it('returns undefined when no stamp is present', () => {
    expect(parseStamp(AGENT_FM)).toBeUndefined();
  });

  it('returns the stamp value when present', () => {
    const stamped = stampTemplate(AGENT_FM);
    const expected = contentHash(AGENT_FM);
    expect(parseStamp(stamped)).toBe(expected);
  });
});

describe('compareIntegrity', () => {
  const bundled = AGENT_FM; // pretend this is the post-render bundled

  it('returns "unchanged" when installed matches bundled', () => {
    const installed = stampTemplate(bundled);
    expect(compareIntegrity(installed, bundled)).toBe('unchanged');
  });

  it('returns "user-edited" when installed body was modified post-stamp', () => {
    const installed = stampTemplate(bundled).replace(
      'You are a test agent.',
      'You are MODIFIED.'
    );
    expect(compareIntegrity(installed, bundled)).toBe('user-edited');
  });

  it('returns "outdated" when stamp matches body but bundled has moved on', () => {
    const installed = stampTemplate(bundled);
    const newerBundled = bundled.replace(
      'You are a test agent.',
      'You are an UPDATED test agent.'
    );
    expect(compareIntegrity(installed, newerBundled)).toBe('outdated');
  });

  it('returns "unstamped" when installed has no stamp (pre-0.4.0)', () => {
    expect(compareIntegrity(AGENT_FM, bundled)).toBe('unstamped');
  });

  it('ignores model line changes when comparing stamp', () => {
    const installed = stampTemplate(bundled).replace(
      'model: haiku',
      'model: claude-haiku-4-5-20251001'
    );
    expect(compareIntegrity(installed, bundled)).toBe('unchanged');
  });
});
