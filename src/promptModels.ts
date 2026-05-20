import { select, input } from '@inquirer/prompts';
import { DEFAULT_MODELS } from './defaults';
import type { ModelsConfig } from './config';

/**
 * Interactive 1-step or 2-step prompt that returns a ModelsConfig.
 *
 * Step 1: select "Use defaults (auto)" or "Customize each tier".
 * Step 2 (custom only): three input prompts for premium / mid / cheap.
 *
 * When `current` is provided, prompts pre-fill with it. Otherwise the
 * defaults are pre-filled.
 *
 * Throws ExitPromptError on Ctrl+C — the caller catches and exits 130.
 */
export async function promptModelStrategy(
  current?: ModelsConfig
): Promise<ModelsConfig> {
  const base: ModelsConfig = current ?? {
    premium: DEFAULT_MODELS.premium,
    mid: DEFAULT_MODELS.mid,
    cheap: DEFAULT_MODELS.cheap,
  };

  const mode = await select<'auto' | 'custom'>({
    message: 'Model strategy:',
    choices: [
      {
        name: 'Use defaults (recommended)',
        value: 'auto',
        description: `premium=${DEFAULT_MODELS.premium}, mid=${DEFAULT_MODELS.mid}, cheap=${DEFAULT_MODELS.cheap}`,
      },
      {
        name: 'Customize each tier',
        value: 'custom',
        description: 'Enter a specific model ID for premium / mid / cheap',
      },
    ],
    default: current ? 'custom' : 'auto',
  });

  if (mode === 'auto') {
    return {
      premium: DEFAULT_MODELS.premium,
      mid: DEFAULT_MODELS.mid,
      cheap: DEFAULT_MODELS.cheap,
    };
  }

  const premium = await input({
    message: 'Premium tier model ID (architecture, root cause, review):',
    default: base.premium,
    validate: (v) => (v.trim().length > 0 ? true : 'must not be empty'),
  });
  const mid = await input({
    message: 'Mid tier model ID (implementation, tests, hunting):',
    default: base.mid,
    validate: (v) => (v.trim().length > 0 ? true : 'must not be empty'),
  });
  const cheap = await input({
    message: 'Cheap tier model ID (repo scout):',
    default: base.cheap,
    validate: (v) => (v.trim().length > 0 ? true : 'must not be empty'),
  });

  return {
    premium: premium.trim(),
    mid: mid.trim(),
    cheap: cheap.trim(),
  };
}
