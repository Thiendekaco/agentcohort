import { affinityFor, MemoryAffinityEntry } from './memoryAffinity';
import { generateDispatcherLookupInstructions } from './memoryLookup';

export const MEMORY_MARKERS = {
  start: '<!-- agentcohort-memory-start -->',
  end:   '<!-- agentcohort-memory-end -->',
} as const;

/**
 * Inject (or refresh) the rendered memory section into an agent's boot
 * directive. Mirrors the `injectSkillsList` pattern in skillsBoot.ts.
 *
 * - If the markers are absent the content is returned unchanged.
 * - Idempotent: re-running with the same affinity yields the same output.
 */
export function injectMemorySection(
  content: string,
  agentName: string,
  userOverrides: Record<string, MemoryAffinityEntry> | undefined,
): string {
  const startIdx = content.indexOf(MEMORY_MARKERS.start);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(MEMORY_MARKERS.end, startIdx + MEMORY_MARKERS.start.length);
  if (endIdx === -1) return content;

  // renderMemorySection returns the full block including both markers.
  // We replace everything from start marker to (and including) end marker.
  const fullRendered = renderMemorySection(agentName, userOverrides);
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + MEMORY_MARKERS.end.length);
  return before + fullRendered + after;
}

export function renderMemorySection(
  agent: string,
  user: Record<string, MemoryAffinityEntry> | undefined,
): string {
  const aff = affinityFor(agent, user);
  const readsList = aff.reads.length > 0 ? aff.reads.join(', ') : '(none)';
  const writesList = aff.writes.length > 0 ? aff.writes.join(', ') : '(none)';
  return [
    MEMORY_MARKERS.start,
    `4. Memory layer (agentcohort v0.10+).`,
    `   This agent's memory affinity:`,
    `   - Reads: ${readsList}`,
    `   - Writes: ${writesList}`,
    ``,
    `   Your prompt contains a line like \`Run ID: <uuid>\` from the dispatcher.`,
    `   Substitute that uuid for \`<RUN_ID>\` below (it is NOT a shell env var —`,
    `   subagents have no shell; compose the bash command with the literal uuid).`,
    ``,
    `   At the START of your work:`,
    `   - Load the scratchpad: \`agentcohort memory read scratch --run-id=<RUN_ID>\``,
    `   - For each collection in your "reads" list:`,
    `     \`agentcohort memory read <collection> --filter=<...> --limit=10\``,
    ``,
    `   At the END of your work, if you produced a memorable verdict:`,
    `   - Architecture choice → \`agentcohort memory write decisions --json-body='{...}' --source=${agent} ...\``,
    `   - Verified bug fix → \`agentcohort memory write bugs --json-body='{...}' --source=${agent} ...\``,
    `   - In-pipeline notes → \`agentcohort memory write scratch ... --run-id=<RUN_ID>\``,
    ``,
    `   When a gate fires (you posed approval/rejection to the user):`,
    `   - \`agentcohort gate record --run-id=<RUN_ID> --gate=<name> --outcome=<verb> \\\\\\`,
    `     --proposed-content="<short summary>" --posing-agent=${agent} [--reason="<user text>"]\``,
    `   - REQUIRED on every gate fire — approve, reject, escalate, auto-skip.`,
    ``,
    `   When you VERIFY (or REFUTE) an earlier memory entry:`,
    `   - \`agentcohort memory write verifications --json-body='{...}' --source=${agent} ...\``,
    `   - Verifications are append-only — to refute, append a new entry with verified=false.`,
    ``,
    `   **NEVER store secrets** — API keys, tokens, .env content, private keys,`,
    `   stacktraces with creds. The CLI rejects what it detects, but YOU are the`,
    `   first line of defense. If unsure, redact aggressively.`,
    ``,
    `   At the VERY START of your work, BEFORE reading any memory:`,
    `     \`agentcohort run start --stage=${agent} --run-id=<RUN_ID>\``,
    ``,
    `   At the VERY END, AFTER your last memory write:`,
    `     \`agentcohort run end --stage=${agent} --run-id=<RUN_ID> --outcome=<success|failed|aborted>\``,
    ``,
    ...(agent === 'dispatcher' ? generateDispatcherLookupInstructions().split('\n') : []),
    MEMORY_MARKERS.end,
  ].join('\n');
}
