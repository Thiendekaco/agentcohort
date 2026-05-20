import { describe, it, expect } from 'vitest';
import { renderAgentTemplate } from '../src/render';
import type { ModelsConfig } from '../src/config';

const MODELS: ModelsConfig = {
  premium: 'PREMIUM-ID',
  mid: 'MID-ID',
  cheap: 'CHEAP-ID',
};

function agent(modelLine: string, body = '# Role\n\nbody text\n'): string {
  return `---\nname: x\ndescription: y\ntools: Read\n${modelLine}\n---\n\n${body}`;
}

describe('renderAgentTemplate', () => {
  it('rewrites `model: opus` to the premium ID', () => {
    const out = renderAgentTemplate(agent('model: opus'), MODELS);
    expect(out).toContain('model: PREMIUM-ID');
    expect(out).not.toContain('model: opus');
  });

  it('rewrites `model: sonnet` to the mid ID', () => {
    const out = renderAgentTemplate(agent('model: sonnet'), MODELS);
    expect(out).toContain('model: MID-ID');
  });

  it('rewrites `model: haiku` to the cheap ID', () => {
    const out = renderAgentTemplate(agent('model: haiku'), MODELS);
    expect(out).toContain('model: CHEAP-ID');
  });

  it('is idempotent: render twice = render once', () => {
    const once = renderAgentTemplate(agent('model: opus'), MODELS);
    const twice = renderAgentTemplate(once, MODELS);
    expect(twice).toBe(once);
  });

  it('leaves a hand-edited specific model ID unchanged', () => {
    const input = agent('model: claude-opus-3-5-sonnet');
    expect(renderAgentTemplate(input, MODELS)).toBe(input);
  });

  it('leaves a file without YAML frontmatter unchanged', () => {
    const input = '# Role\n\nmodel: opus\n';
    expect(renderAgentTemplate(input, MODELS)).toBe(input);
  });

  it('does NOT rewrite a `model: sonnet` line that appears in the body', () => {
    const input = agent('model: sonnet', '# Role\n\nThe text `model: opus` should stay.\n');
    const out = renderAgentTemplate(input, MODELS);
    // Frontmatter rewritten
    expect(out).toContain('model: MID-ID');
    // Body untouched
    expect(out).toContain('`model: opus` should stay');
  });

  it('preserves surrounding bytes exactly when no rewrite is needed', () => {
    const input = agent('model: claude-opus-4-7');
    expect(renderAgentTemplate(input, MODELS)).toBe(input);
  });

  it('handles CRLF line endings in frontmatter', () => {
    const input = agent('model: opus').replace(/\n/g, '\r\n');
    const out = renderAgentTemplate(input, MODELS);
    expect(out).toContain('PREMIUM-ID');
  });
});
