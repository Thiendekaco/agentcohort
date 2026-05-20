import { select } from '@inquirer/prompts';
import { DEFAULT_GATES, GateMode, GateName, GATE_NAMES } from './defaults';
import type { GatesConfig } from './config';

/**
 * Interactive 1-step or 5-step prompt that returns a fully populated
 * GatesConfig.
 *
 * Step 1: select "Use defaults (recommended)" or "Customize each gate".
 * Step 2 (custom only): one `select` per gate (on / off / auto), each
 * pre-filled with the current value.
 *
 * Throws ExitPromptError on Ctrl+C — the caller catches and exits 130.
 */
export async function promptGates(current: GatesConfig): Promise<GatesConfig> {
  const allDefault = GATE_NAMES.every((g) => current[g] === DEFAULT_GATES[g]);

  const mode = await select<'auto' | 'custom'>({
    message: 'Human review gates:',
    choices: [
      {
        name: 'Use defaults (recommended)',
        value: 'auto',
        description: `architect=on, plan=on, bottleneck=auto, root-cause=on, expert-council=on — pause at every load-bearing decision.`,
      },
      {
        name: 'Customize each gate',
        value: 'custom',
        description:
          'Pick on / off / auto for each gate independently. `auto` = pause only when dispatcher escalates the task to Tier 4 or hits an escalation keyword.',
      },
    ],
    default: allDefault ? 'auto' : 'custom',
  });

  if (mode === 'auto') {
    return {
      architect: DEFAULT_GATES.architect,
      plan: DEFAULT_GATES.plan,
      bottleneck: DEFAULT_GATES.bottleneck,
      'root-cause': DEFAULT_GATES['root-cause'],
      'expert-council': DEFAULT_GATES['expert-council'],
    };
  }

  const out: Partial<GatesConfig> = {};
  for (const gate of GATE_NAMES) {
    out[gate] = await select<GateMode>({
      message: gateLabel(gate),
      choices: [
        { name: 'on  — always pause', value: 'on' },
        { name: 'off — never pause', value: 'off' },
        {
          name: 'auto — pause only on Tier 4 / escalation keyword',
          value: 'auto',
        },
      ],
      default: current[gate],
    });
  }
  return out as GatesConfig;
}

function gateLabel(name: GateName): string {
  switch (name) {
    case 'architect':
      return 'architect — pause after solution-architect, before planner:';
    case 'plan':
      return 'plan — pause after feature-planner, before implementer:';
    case 'bottleneck':
      return 'bottleneck — pause after performance-hunter in /perf-hunt:';
    case 'root-cause':
      return 'root-cause — pause after root-cause-analyst in /bug-audit:';
    case 'expert-council':
      return 'expert-council — pause after expert-council ends /bug-audit:';
  }
}
