/**
 * Single source of truth for default Claude model IDs and the
 * alias-to-tier mapping the installer uses when rewriting agent
 * templates.
 *
 * When a new Claude model ships, update DEFAULT_MODELS here and the
 * change flows through both the default install path and the prompt
 * defaults.
 */

export const DEFAULT_MODELS = {
  premium: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5-20251001',
} as const;

export const TIER_ALIASES = {
  opus: 'premium',
  sonnet: 'mid',
  haiku: 'cheap',
} as const;

export type Tier = keyof typeof DEFAULT_MODELS;
export type TierAlias = keyof typeof TIER_ALIASES;
