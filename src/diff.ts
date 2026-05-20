import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelsConfig } from './config';
import { TIER_ALIASES } from './defaults';

export interface ModelChange {
  file: string;
  from: string;
  to: string;
}

/**
 * For each `.md` file in `installedAgentDir`, decide whether changing
 * the model config from `oldModels` to `newModels` would alter the
 * file's frontmatter `model:` line. Returns the list of changes (file
 * name + from/to model IDs).
 *
 * A file is treated three ways:
 *   1. Tier alias in frontmatter (`model: opus|sonnet|haiku`): treat
 *      as `oldModels[tier(alias)]` and check whether
 *      `newModels[tier(alias)]` differs.
 *   2. Concrete ID matching one of oldModels: that's a previously
 *      rendered file; we know its tier, so check whether the new
 *      config differs.
 *   3. Concrete ID NOT in oldModels: a hand-edit. Skipped.
 *
 * Returns [] if the dir does not exist.
 */
export function computeFrontmatterModelDiff(
  installedAgentDir: string,
  oldModels: ModelsConfig,
  newModels: ModelsConfig
): ModelChange[] {
  if (!existsSync(installedAgentDir)) return [];

  const oldById: Record<string, keyof ModelsConfig> = {
    [oldModels.premium]: 'premium',
    [oldModels.mid]: 'mid',
    [oldModels.cheap]: 'cheap',
  };

  const changes: ModelChange[] = [];
  for (const file of readdirSync(installedAgentDir).sort()) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(installedAgentDir, file), 'utf8');
    const m = text.match(/^model:[ \t]+(\S+)[ \t]*$/m);
    if (!m) continue;
    const value = m[1];

    let tier: keyof ModelsConfig | null = null;
    let from: string;
    if (value === 'opus' || value === 'sonnet' || value === 'haiku') {
      tier = TIER_ALIASES[value];
      from = oldModels[tier];
    } else if (oldById[value]) {
      tier = oldById[value];
      from = value;
    } else {
      // hand-edited specific ID → skip
      continue;
    }

    const to = newModels[tier];
    if (from !== to) {
      changes.push({ file, from, to });
    }
  }
  return changes;
}
