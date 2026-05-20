import { join } from 'node:path';
import {
  loadConfig,
  writeConfig,
  resolveModels,
  AgentcohortConfig,
  ModelsConfig,
} from './config';
import { computeFrontmatterModelDiff, ModelChange } from './diff';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type ConfigCmdStatus = 'no-changes' | 'no-agents' | 'cancelled' | 'applied';

export interface ConfigCmdResult {
  status: ConfigCmdStatus;
  changes: ModelChange[];
}

export interface ConfigCmdOptions {
  cwd: string;
  /** Inject the prompt function — production passes the real TUI, tests pass a mock. */
  promptModelStrategy: (current?: ModelsConfig) => Promise<ModelsConfig>;
  /** Inject the diff-confirm function — same reason. */
  confirm: (message: string) => Promise<boolean>;
}

/**
 * Run the `agentcohort config` subcommand.
 *
 *  1. Load existing config (or null → defaults).
 *  2. Prompt user for a new ModelsConfig (pre-filled with current).
 *  3. If no models changed: write config (idempotent) → 'no-changes'.
 *  4. Compute the diff of installed agent files.
 *  5. If diff is empty (e.g. no .claude/agents dir): write config → 'no-agents'.
 *  6. Otherwise: confirm with user. Decline → 'cancelled'. Accept →
 *     write config + rewrite each affected file's `model:` line in
 *     place (preserves the rest byte-for-byte) → 'applied'.
 */
export async function runConfigCmd(opts: ConfigCmdOptions): Promise<ConfigCmdResult> {
  const existing = loadConfig(opts.cwd);
  const oldModels = resolveModels(existing);

  const newModels = await opts.promptModelStrategy(existing?.models);

  const noChange =
    newModels.premium === oldModels.premium &&
    newModels.mid === oldModels.mid &&
    newModels.cheap === oldModels.cheap;

  const newConfig: AgentcohortConfig = { version: 1, models: newModels };

  const agentDir = join(opts.cwd, '.claude', 'agents');

  if (noChange) {
    writeConfig(opts.cwd, newConfig);
    if (!existsSync(agentDir)) {
      return { status: 'no-agents', changes: [] };
    }
    return { status: 'no-changes', changes: [] };
  }

  const changes = computeFrontmatterModelDiff(agentDir, oldModels, newModels);

  if (changes.length === 0) {
    writeConfig(opts.cwd, newConfig);
    return { status: 'no-agents', changes: [] };
  }

  const message = `Apply ${changes.length} model change${changes.length === 1 ? '' : 's'}?`;
  const accepted = await opts.confirm(message);
  if (!accepted) {
    return { status: 'cancelled', changes };
  }

  writeConfig(opts.cwd, newConfig);
  for (const c of changes) {
    const path = join(agentDir, c.file);
    const current = readFileSync(path, 'utf8');
    const rewritten = current.replace(
      /^model:[ \t]+\S+[ \t]*$/m,
      `model: ${c.to}`
    );
    writeFileSync(path, rewritten, 'utf8');
  }
  return { status: 'applied', changes };
}
