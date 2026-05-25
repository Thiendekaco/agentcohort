import { affinityFor, MemoryAffinityEntry } from './memoryAffinity';

export const MEMORY_MARKERS = {
  start: '<!-- agentcohort-memory-start -->',
  end:   '<!-- agentcohort-memory-end -->',
} as const;

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
    MEMORY_MARKERS.end,
  ].join('\n');
}
