import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface OpenWolfState {
  hasAnatomy: boolean;
  hasCerebrum: boolean;
  hasBuglog: boolean;
}

export function detectOpenWolf(cwd: string): OpenWolfState {
  const wolfDir = join(cwd, '.wolf');
  if (!existsSync(wolfDir)) {
    return { hasAnatomy: false, hasCerebrum: false, hasBuglog: false };
  }
  return {
    hasAnatomy:  existsSync(join(wolfDir, 'anatomy.md')),
    hasCerebrum: existsSync(join(wolfDir, 'cerebrum.md')),
    hasBuglog:   existsSync(join(wolfDir, 'buglog.json')),
  };
}
