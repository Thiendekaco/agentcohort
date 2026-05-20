import type { ModelsConfig } from './config';
import { TIER_ALIASES } from './defaults';

/**
 * Rewrite the `model:` line inside the YAML frontmatter from a tier
 * alias (haiku/sonnet/opus) to the user's concrete model ID. Leaves
 * everything else (including hand-edited specific IDs in the
 * frontmatter, and any `model:` text in the body) unchanged.
 *
 * Pure and idempotent: rendering an already-rendered file returns it
 * unchanged.
 */
export function renderAgentTemplate(content: string, models: ModelsConfig): string {
  if (!content.startsWith('---')) return content;
  // Find the end of the YAML frontmatter (the second `---` on its own line).
  const fmEndRe = /^---[ \t]*\r?\n([\s\S]*?\r?\n)---[ \t]*\r?\n/;
  const fmMatch = content.match(fmEndRe);
  if (!fmMatch) return content;
  const fmEnd = fmMatch[0].length;
  const frontmatter = content.slice(0, fmEnd);
  const body = content.slice(fmEnd);

  const aliasRe = /^model:[ \t]+(haiku|sonnet|opus)[ \t]*$/m;
  const aliasMatch = frontmatter.match(aliasRe);
  if (!aliasMatch) return content;

  const alias = aliasMatch[1] as keyof typeof TIER_ALIASES;
  const tier = TIER_ALIASES[alias];
  const newModelId = models[tier];
  const newLine = `model: ${newModelId}`;
  const newFrontmatter = frontmatter.replace(aliasRe, newLine);
  return newFrontmatter + body;
}
