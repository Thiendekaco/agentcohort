import { createInterface, Interface } from 'node:readline/promises';
import { Readable, Writable } from 'node:stream';

export type Choice = 'skip' | 'overwrite' | 'backup';

export interface ConflictContext {
  targetRelPath: string;
  /** 'regular' => file already exists & differs. 'claude-section' => our section already exists & differs. */
  kind: 'regular' | 'claude-section';
}

export interface ConflictDecision {
  choice: Choice;
  /** Apply this same choice to every remaining conflict without re-asking. */
  applyToAll: boolean;
}

export type ConflictResolver = (ctx: ConflictContext) => Promise<ConflictDecision>;

/**
 * Interactive resolver backed by readline.
 *
 * Key map (lowercase = this file only, UPPERCASE = all remaining conflicts):
 *   s/S  skip
 *   o/O  overwrite        (claude-section: replace our section in place)
 *   b/B  backup + overwrite   <-- default for regular files
 * For claude-section the safe default is "skip" (don't rewrite hand-edited
 * routing rules unless asked).
 */
export function createInteractiveResolver(
  io: { input?: Readable; output?: Writable } = {}
): { resolve: ConflictResolver; close: () => void } {
  const rl: Interface = createInterface({
    input: io.input ?? process.stdin,
    output: io.output ?? process.stdout,
  });

  const resolve: ConflictResolver = async (ctx) => {
    const defaultChoice: Choice = ctx.kind === 'claude-section' ? 'skip' : 'backup';
    const what =
      ctx.kind === 'claude-section'
        ? `CLAUDE.md already has an "Agentcohort Routing Rules" section that differs`
        : `${ctx.targetRelPath} already exists and differs`;
    const defLabel = defaultChoice === 'skip' ? 's' : 'b';
    const question =
      `\n${what}.\n` +
      `  [s] skip   [o] overwrite   [b] backup + overwrite\n` +
      `  (UPPERCASE applies to all remaining, default: ${defLabel}) > `;

    // Loop until a valid answer (or EOF -> default).
    for (;;) {
      let answer: string;
      try {
        answer = (await rl.question(question)).trim();
      } catch {
        return { choice: defaultChoice, applyToAll: true };
      }
      if (answer === '') return { choice: defaultChoice, applyToAll: false };
      const applyToAll = answer === answer.toUpperCase();
      const key = answer[0]!.toLowerCase();
      if (key === 's') return { choice: 'skip', applyToAll };
      if (key === 'o') return { choice: 'overwrite', applyToAll };
      if (key === 'b') return { choice: 'backup', applyToAll };
      // invalid -> ask again
    }
  };

  return { resolve, close: () => rl.close() };
}

/** Non-interactive resolver: always returns the supplied safe decision. */
export function fixedResolver(decision: ConflictDecision): ConflictResolver {
  return async () => decision;
}
