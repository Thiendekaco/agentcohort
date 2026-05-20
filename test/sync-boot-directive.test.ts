import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error - .mjs ESM module without type declarations
import { syncBootDirective } from '../scripts/sync-boot-directive.mjs';

const tmps: string[] = [];
function workspace(): { root: string; directivePath: string; agentDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'af-sync-'));
  tmps.push(root);
  const agentDir = join(root, 'agents');
  mkdirSync(agentDir, { recursive: true });
  const directivePath = join(root, '_boot-directive.md');
  return { root, directivePath, agentDir };
}
const DIRECTIVE = `<!-- boot-directive-start -->

# Boot directive — read before acting

Stub directive body.

<!-- boot-directive-end -->
`;

const AGENT_NO_DIRECTIVE = `---
name: test-agent
description: stub
model: sonnet
---

# Role

You are a test agent.
`;

describe('syncBootDirective', () => {
  afterEach(() => {
    while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
  });

  it('inserts directive after frontmatter when not present', () => {
    const ws = workspace();
    writeFileSync(ws.directivePath, DIRECTIVE);
    const agentPath = join(ws.agentDir, 'a.md');
    writeFileSync(agentPath, AGENT_NO_DIRECTIVE);

    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });

    const out = readFileSync(agentPath, 'utf8');
    expect(out).toContain('<!-- boot-directive-start -->');
    expect(out).toContain('<!-- boot-directive-end -->');
    expect(out).toContain('Stub directive body.');
    // Order: frontmatter (closing ---), then a separator newline, then
    // directive, then # Role
    const closingDashesIdx = out.indexOf('---', 4);
    const idxStart = out.indexOf('<!-- boot-directive-start -->');
    const idxEnd = out.indexOf('<!-- boot-directive-end -->');
    const idxRole = out.indexOf('# Role');
    expect(closingDashesIdx).toBeGreaterThan(-1);
    expect(idxStart).toBeGreaterThan(closingDashesIdx + 3);
    expect(out.slice(closingDashesIdx + 3, idxStart)).toMatch(/\n\s*\n/);
    expect(idxStart).toBeLessThan(idxEnd);
    expect(idxEnd).toBeLessThan(idxRole);
  });

  it('is idempotent: second run produces no change', () => {
    const ws = workspace();
    writeFileSync(ws.directivePath, DIRECTIVE);
    const agentPath = join(ws.agentDir, 'a.md');
    writeFileSync(agentPath, AGENT_NO_DIRECTIVE);

    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });
    const after1 = readFileSync(agentPath, 'utf8');
    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });
    const after2 = readFileSync(agentPath, 'utf8');

    expect(after2).toBe(after1);
  });

  it('replaces existing directive region with new content', () => {
    const ws = workspace();
    writeFileSync(ws.directivePath, DIRECTIVE);
    const agentPath = join(ws.agentDir, 'a.md');
    writeFileSync(agentPath, AGENT_NO_DIRECTIVE);
    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });

    const NEW_DIRECTIVE = `<!-- boot-directive-start -->

# Boot directive — read before acting

NEW updated body.

<!-- boot-directive-end -->
`;
    writeFileSync(ws.directivePath, NEW_DIRECTIVE);
    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });

    const out = readFileSync(agentPath, 'utf8');
    expect(out).toContain('NEW updated body.');
    expect(out).not.toContain('Stub directive body.');
    // Still only one region
    const starts = (out.match(/<!-- boot-directive-start -->/g) ?? []).length;
    const ends = (out.match(/<!-- boot-directive-end -->/g) ?? []).length;
    expect(starts).toBe(1);
    expect(ends).toBe(1);
  });

  it('preserves hand-edited content outside the directive region', () => {
    const ws = workspace();
    writeFileSync(ws.directivePath, DIRECTIVE);
    const agentPath = join(ws.agentDir, 'a.md');
    const handEdited = `---
name: test-agent
description: stub
model: sonnet
---

<!-- boot-directive-start -->

old directive that should be replaced

<!-- boot-directive-end -->

# Role

You are a test agent.

## Custom hand-edited section

This must survive the sync.
`;
    writeFileSync(agentPath, handEdited);

    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });

    const out = readFileSync(agentPath, 'utf8');
    expect(out).toContain('## Custom hand-edited section');
    expect(out).toContain('This must survive the sync.');
    expect(out).toContain('Stub directive body.');
    expect(out).not.toContain('old directive that should be replaced');
  });

  it('iterates every .md file in the agent directory', () => {
    const ws = workspace();
    writeFileSync(ws.directivePath, DIRECTIVE);
    writeFileSync(join(ws.agentDir, 'a.md'), AGENT_NO_DIRECTIVE);
    writeFileSync(join(ws.agentDir, 'b.md'), AGENT_NO_DIRECTIVE);
    writeFileSync(join(ws.agentDir, 'c.md'), AGENT_NO_DIRECTIVE);
    writeFileSync(join(ws.agentDir, 'notes.txt'), 'should be ignored');

    syncBootDirective({ directivePath: ws.directivePath, agentDir: ws.agentDir });

    for (const f of ['a.md', 'b.md', 'c.md']) {
      const out = readFileSync(join(ws.agentDir, f), 'utf8');
      expect(out).toContain('<!-- boot-directive-start -->');
    }
    const notes = readFileSync(join(ws.agentDir, 'notes.txt'), 'utf8');
    expect(notes).toBe('should be ignored');
  });
});
