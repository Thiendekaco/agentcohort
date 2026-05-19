import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Resolve the bundled templates directory.
 *
 * Works in two layouts:
 *  - Compiled:  dist/paths.js     -> dist/templates   (copied by build script)
 *  - Tests/ts:  src/paths.ts      -> src/templates
 *
 * Both keep `templates/` as a sibling of this module, so __dirname is the
 * single source of truth and no environment guessing is needed.
 */
export function getTemplatesDir(): string {
  const local = join(__dirname, 'templates');
  if (existsSync(local)) return local;
  throw new Error(
    `agent-force: templates directory not found next to ${__dirname}. ` +
      `The package may be corrupted; try reinstalling.`
  );
}

/** Read the package version from package.json (sibling of dist/ or src/). */
export function getVersion(): string {
  const candidates = [
    join(__dirname, '..', 'package.json'),
    join(__dirname, '..', '..', 'package.json'),
  ];
  for (const c of candidates) {
    try {
      if (!existsSync(c)) continue;
      const pkg = JSON.parse(readFileSync(c, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'agent-force' && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      /* keep trying */
    }
  }
  return '0.0.0';
}

/** Normalize a user-supplied target directory to an absolute path. */
export function resolveProjectRoot(cwd: string): string {
  return resolve(cwd);
}
