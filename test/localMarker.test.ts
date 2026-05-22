import { describe, it, expect } from 'vitest';
import { hasLocalMarker, markAsLocal } from '../src/localMarker';

const PLAIN = `---
name: foo
description: A test
model: sonnet
---

# Body

Some content.
`;

const MARKED = `---
name: foo
description: A test
model: sonnet
_agentcohort_local: true
---

# Body

Some content.
`;

const STAMPED = `---
name: foo
description: A test
model: sonnet
_agentcohort_hash: abc1234567890def
---

# Body

Some content.
`;

describe('hasLocalMarker', () => {
  it('is true when frontmatter carries _agentcohort_local: true', () => {
    expect(hasLocalMarker(MARKED)).toBe(true);
  });
  it('is false when the marker is absent', () => {
    expect(hasLocalMarker(PLAIN)).toBe(false);
  });
  it('is false for a stamped (bundled) file', () => {
    expect(hasLocalMarker(STAMPED)).toBe(false);
  });
  it('is false for content without YAML frontmatter', () => {
    expect(hasLocalMarker('# just a heading\n')).toBe(false);
    expect(hasLocalMarker('')).toBe(false);
  });
  it('is false when the marker text appears in the body (not the frontmatter)', () => {
    const inBody = PLAIN + '\n_agentcohort_local: true\n';
    expect(hasLocalMarker(inBody)).toBe(false);
  });
});

describe('markAsLocal', () => {
  it('inserts the marker just before the closing frontmatter fence', () => {
    const out = markAsLocal(PLAIN);
    expect(hasLocalMarker(out)).toBe(true);
    // Marker line precedes closing `---`.
    const idxMarker = out.indexOf('_agentcohort_local: true');
    const idxClose = out.indexOf('---', idxMarker);
    expect(idxMarker).toBeGreaterThan(0);
    expect(idxClose).toBeGreaterThan(idxMarker);
  });

  it('strips an existing _agentcohort_hash when marking as local', () => {
    const out = markAsLocal(STAMPED);
    expect(hasLocalMarker(out)).toBe(true);
    expect(out).not.toContain('_agentcohort_hash');
  });

  it('is idempotent — marking an already-marked file is a no-op', () => {
    const once = markAsLocal(PLAIN);
    const twice = markAsLocal(once);
    expect(twice).toBe(once);
  });

  it('preserves the body verbatim', () => {
    const out = markAsLocal(PLAIN);
    expect(out).toContain('# Body');
    expect(out).toContain('Some content.');
  });

  it('returns input unchanged when there is no YAML frontmatter', () => {
    const noFm = '# Just markdown\n\nNo frontmatter here.\n';
    expect(markAsLocal(noFm)).toBe(noFm);
  });

  it('handles CRLF line endings without mangling the body', () => {
    const crlf = PLAIN.replace(/\n/g, '\r\n');
    const out = markAsLocal(crlf);
    expect(hasLocalMarker(out)).toBe(true);
    expect(out).toContain('Some content.');
  });
});
