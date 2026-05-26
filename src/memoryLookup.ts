/**
 * Boot-directive paragraph appended to the dispatcher's memory section.
 *
 * v0.10.1: dispatcher reads INDEX.jsonl + hotspots + relevant decisions
 * before classifying the user's task. Uses local Jaccard similarity
 * (no external embeddings) — see src/memorySimilarity.ts.
 */

export function generateDispatcherLookupInstructions(): string {
  return [
    '',
    '## Memory-aware routing (v0.10.1+)',
    '',
    'At the START of classification, before producing the plan:',
    '',
    '1. **Read recent runs**: `agentcohort memory list-runs --limit=50 --json`',
    '   For each past run, compute Jaccard similarity between its `task_summary` and',
    "   the user's current task: tokenize (lowercase, alphanumeric split, length > 1),",
    "   drop stopwords (the/a/to/in/for/on/with/and/or/of/is/was/be/at/by/as/from/this/that),",
    '   then `|intersection| / |union|`. If any past run scores ≥ **0.3**, surface in',
    '   your classification output as: `Similar past task <date> (run <short-id>): /<pipeline> → <outcome>`.',
    '',
    '2. **Read hotspots**: `agentcohort memory read hotspots --json`',
    "   If the user's task mentions any file in hotspots with `fragility_score ≥ 0.5`:",
    '   - Force the `architect` gate ON for this run in your plan output.',
    '   - Add note: `File <path> is fragile (<N> prior bugs, score <X>) — architect gate forced ON`.',
    '',
    '3. **Read past decisions for mentioned files**:',
    '   `agentcohort memory read decisions --filter=context.files=<path> --limit=5 --with-verifications`',
    '   For each verified past decision, mention it in your output for the architect to consider.',
    '',
    '4. **Record your routing reasoning** (audit trail):',
    '   `agentcohort gate record --run-id=$RUN_ID --gate=architect --outcome=auto-skipped \\',
    '     --proposed-content="<your routing decision summary>" --posing-agent=dispatcher`',
    '   Use `outcome=auto-skipped` when memory suggested a route and no human gate fired.',
    '   Use `approved` when you forced the architect gate ON.',
    '   The normal flow applies if the human gate actually fires later.',
    '',
  ].join('\n');
}
