import { describe, it, expect } from 'vitest';
import {
  SECTION_TITLE,
  buildInitialClaudeMd,
  findSectionStart,
  hasSection,
  removeSection,
  sectionMatches,
  upsertSection,
} from '../src/claudeMd';

const SECTION = `${SECTION_TITLE}\n\nRule A\nRule B\n`;

describe('hasSection / findSectionStart', () => {
  it('detects an existing section', () => {
    const doc = `# Project\n\nintro\n\n${SECTION}`;
    expect(hasSection(doc)).toBe(true);
    expect(findSectionStart(doc)).toBeGreaterThan(0);
  });

  it('returns false when absent', () => {
    expect(hasSection('# Project\n\nno section here\n')).toBe(false);
  });

  it('ignores the heading when it appears inside a fenced code block', () => {
    const doc = [
      '# Project',
      '',
      'Example of what gets added:',
      '',
      '```md',
      SECTION_TITLE,
      'fake body',
      '```',
      '',
      'real content',
      '',
    ].join('\n');
    expect(hasSection(doc)).toBe(false);
  });
});

describe('upsertSection - append', () => {
  it('appends with a blank-line separator and preserves existing content', () => {
    const doc = '# Project\n\nMy own notes.\n';
    const { result, mode } = upsertSection(doc, SECTION);
    expect(mode).toBe('append');
    expect(result).toContain('My own notes.');
    expect(result).toContain(SECTION_TITLE);
    expect(result.indexOf('My own notes.')).toBeLessThan(
      result.indexOf(SECTION_TITLE)
    );
    // separated by a blank line, not glued onto user text
    expect(result).toMatch(/My own notes\.\n\n# Agentcohort Routing Rules/);
  });

  it('on empty input produces just the section', () => {
    const { result, mode } = upsertSection('', SECTION);
    expect(mode).toBe('append');
    expect(result.startsWith(SECTION_TITLE)).toBe(true);
  });
});

describe('upsertSection - replace', () => {
  it('replaces only the section, preserving prefix and suffix verbatim', () => {
    const doc = [
      '# Project',
      '',
      'Intro kept.',
      '',
      SECTION_TITLE,
      '',
      'OLD RULE',
      '',
      '# After Section',
      '',
      'Trailing kept.',
      '',
    ].join('\n');
    const { result, mode } = upsertSection(doc, SECTION);
    expect(mode).toBe('replace');
    expect(result).toContain('Intro kept.');
    expect(result).toContain('Trailing kept.');
    expect(result).toContain('# After Section');
    expect(result).toContain('Rule A');
    expect(result).not.toContain('OLD RULE');
    // exactly one occurrence of the heading (no duplication)
    expect(result.match(/# Agentcohort Routing Rules/g)?.length).toBe(1);
    // following heading still present and separated
    expect(result).toMatch(/Rule B\n\n# After Section/);
  });

  it('is idempotent: replacing with identical content yields equal output', () => {
    const doc = `# P\n\n${SECTION}`;
    const once = upsertSection(doc, SECTION).result;
    const twice = upsertSection(once, SECTION).result;
    expect(twice).toBe(once);
  });
});

describe('sectionMatches', () => {
  it('true when the existing section equals the template', () => {
    const doc = `# P\n\n${SECTION}`;
    expect(sectionMatches(doc, SECTION)).toBe(true);
  });
  it('false when it differs', () => {
    const doc = `# P\n\n${SECTION_TITLE}\n\nDIFFERENT\n`;
    expect(sectionMatches(doc, SECTION)).toBe(false);
  });
});

describe('buildInitialClaudeMd', () => {
  it('produces a header plus the section', () => {
    const out = buildInitialClaudeMd(SECTION);
    expect(out).toContain('# Project Guidance for Claude Code');
    expect(out).toContain(SECTION_TITLE);
    expect(hasSection(out)).toBe(true);
  });
});

describe('removeSection', () => {
  it('returns null when no section is present', () => {
    expect(removeSection('# Project\n\nno section here\n')).toBeNull();
  });

  it('preserves content BEFORE the section', () => {
    const doc = `# Project\n\nintro\n\n${SECTION}`;
    const out = removeSection(doc);
    expect(out).not.toBeNull();
    expect(out!).toContain('# Project');
    expect(out!).toContain('intro');
    expect(out!).not.toContain(SECTION_TITLE);
  });

  it('preserves content AFTER the section', () => {
    const doc = `# Project\n\n${SECTION}\n\n# Trailing\n\ntail content\n`;
    const out = removeSection(doc);
    expect(out).not.toBeNull();
    expect(out!).toContain('# Trailing');
    expect(out!).toContain('tail content');
    expect(out!).not.toContain(SECTION_TITLE);
  });

  it('keeps exactly one blank line between surrounding content', () => {
    const doc = `# Project\n\nintro\n\n${SECTION}\n\n# Trailing\n\ntail\n`;
    const out = removeSection(doc)!;
    // No three-or-more consecutive newlines.
    expect(/\n{3,}/.test(out)).toBe(false);
    expect(out).toContain('intro\n\n# Trailing');
  });

  it('returns "" when the file contained only the section', () => {
    const doc = SECTION;
    expect(removeSection(doc)).toBe('');
  });

  it('round-trips with upsertSection: removeSection(upsertSection(empty)) == empty after trim', () => {
    const empty = '# Project\n';
    const withSection = upsertSection(empty, SECTION).result;
    const out = removeSection(withSection)!;
    // The header survives.
    expect(out).toContain('# Project');
    expect(hasSection(out)).toBe(false);
  });
});
