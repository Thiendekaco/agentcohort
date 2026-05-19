// Cross-platform copy of src/templates -> dist/templates.
// tsc only emits .ts files, so the static markdown templates must be copied
// into the build output so the published package can resolve them at runtime.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'src', 'templates');
const dest = join(root, 'dist', 'templates');

if (!existsSync(src)) {
  console.error(`[copy-templates] source not found: ${src}`);
  process.exit(1);
}

cpSync(src, dest, { recursive: true });
console.log(`[copy-templates] copied templates -> ${dest}`);
