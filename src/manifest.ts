import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type EntryKind = 'regular' | 'claude-section';

export interface ManifestEntry {
  kind: EntryKind;
  /** Absolute path to the source template inside the package. */
  templateAbsPath: string;
  /** Absolute path where it will be installed in the target project. */
  targetAbsPath: string;
  /** Forward-slash relative path for stable, readable CLI output. */
  targetRelPath: string;
}

const SECTION_FILE = 'CLAUDE.section.md';

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Build the install manifest by enumerating the bundled templates.
 *
 * Enumeration (rather than a hard-coded list) keeps the package
 * maintainable: dropping a new `agents/*.md` template ships it with no
 * code change.
 */
export function buildManifest(templatesDir: string, projectRoot: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  for (const group of ['agents', 'commands'] as const) {
    const dir = join(templatesDir, group);
    for (const file of listMarkdown(dir)) {
      entries.push({
        kind: 'regular',
        templateAbsPath: join(dir, file),
        targetAbsPath: join(projectRoot, '.claude', group, file),
        targetRelPath: `.claude/${group}/${file}`,
      });
    }
  }

  const sectionTemplate = join(templatesDir, SECTION_FILE);
  if (existsSync(sectionTemplate)) {
    entries.push({
      kind: 'claude-section',
      templateAbsPath: sectionTemplate,
      targetAbsPath: join(projectRoot, 'CLAUDE.md'),
      targetRelPath: 'CLAUDE.md',
    });
  }

  return entries;
}
