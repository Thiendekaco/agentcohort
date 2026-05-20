import { join } from 'node:path';
import {
  loadConfig,
  writeConfig,
  resolveModels,
  resolveGates,
  AgentcohortConfig,
  ModelsConfig,
  GatesConfig,
} from './config';
import { GATE_NAMES } from './defaults';
import { computeFrontmatterModelDiff, ModelChange } from './diff';
import { stampTemplate } from './stamp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type ConfigCmdStatus = 'no-changes' | 'no-agents' | 'cancelled' | 'applied';

export interface ConfigCmdResult {
  status: ConfigCmdStatus;
  changes: ModelChange[];
  /** True iff the gates config differed from the loaded value. */
  gatesChanged: boolean;
}

export interface ConfigCmdOptions {
  cwd: string;
  /** Inject the prompt function — production passes the real TUI, tests pass a mock. */
  promptModelStrategy: (current?: ModelsConfig) => Promise<ModelsConfig>;
  /** Inject the gates prompt — production passes the real TUI, tests pass a mock. */
  promptGates: (current: GatesConfig) => Promise<GatesConfig>;
  /** Inject the diff-confirm function — same reason. */
  confirm: (message: string) => Promise<boolean>;
}

function gatesEqual(a: GatesConfig, b: GatesConfig): boolean {
  return GATE_NAMES.every((g) => a[g] === b[g]);
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
  const oldGates = resolveGates(existing);

  const newModels = await opts.promptModelStrategy(existing?.models);
  const newGates = await opts.promptGates(oldGates);

  const modelsChanged =
    newModels.premium !== oldModels.premium ||
    newModels.mid !== oldModels.mid ||
    newModels.cheap !== oldModels.cheap;
  const gatesChanged = !gatesEqual(oldGates, newGates);

  // Preserve a user-set gates field even when the new values equal
  // the defaults (explicit > implicit). Drop gates only when neither
  // the existing config had them nor the user touched them.
  const newConfig: AgentcohortConfig = { version: 1, models: newModels };
  if (existing?.gates !== undefined || gatesChanged) {
    newConfig.gates = newGates;
  }

  const agentDir = join(opts.cwd, '.claude', 'agents');

  if (!modelsChanged) {
    writeConfig(opts.cwd, newConfig);
    if (!existsSync(agentDir)) {
      return { status: 'no-agents', changes: [], gatesChanged };
    }
    return {
      status: gatesChanged ? 'applied' : 'no-changes',
      changes: [],
      gatesChanged,
    };
  }

  const changes = computeFrontmatterModelDiff(agentDir, oldModels, newModels);

  if (changes.length === 0) {
    writeConfig(opts.cwd, newConfig);
    return { status: 'no-agents', changes: [], gatesChanged };
  }

  const message = `Apply ${changes.length} model change${changes.length === 1 ? '' : 's'}?`;
  const accepted = await opts.confirm(message);
  if (!accepted) {
    return { status: 'cancelled', changes, gatesChanged };
  }

  writeConfig(opts.cwd, newConfig);
  for (const c of changes) {
    const path = join(agentDir, c.file);
    const current = readFileSync(path, 'utf8');
    const rewritten = current.replace(
      /^model:[ \t]+\S+[ \t]*$/m,
      `model: ${c.to}`
    );
    // Re-stamp after rewriting the model line. contentHash ignores
    // the model line, so the stamp value does not actually change —
    // but stampTemplate also patches files that pre-date 0.4.0 and
    // had no stamp at all.
    writeFileSync(path, stampTemplate(rewritten), 'utf8');
  }
  return { status: 'applied', changes, gatesChanged };
}
