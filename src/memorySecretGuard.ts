/**
 * Pre-write secret guard for the memory layer.
 *
 * Pure regex scanner. Patterns are intentionally conservative — we'd
 * rather miss an exotic secret format than block a legitimate write.
 * The doctor's `memory.secrets-scan` check provides retroactive
 * detection for anything that slipped through.
 *
 * Each pattern is documented at:
 *   docs/memory/secret-patterns.md
 */

export interface SecretPattern {
  readonly name: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'aws-access-key-id',  regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'openai-secret-key',  regex: /\bsk-[a-zA-Z0-9]{48}\b/g },
  { name: 'github-token',       regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: 'anthropic-key',      regex: /\bsk-ant-[a-zA-Z0-9\-_]{90,}\b/g },
  { name: 'bearer-token',       regex: /\bBearer\s+[A-Za-z0-9_\-\.=]{20,}/g },
  { name: 'private-key',        regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'env-secret-line',    regex: /\b(?:API_KEY|SECRET|TOKEN|PASSWORD)=\S{8,}/g },
];

export interface MatchedSecret {
  patternName: string;
  offset: number;
  length: number;
  /** First 8 chars of the match, for the error message — never log the full secret. */
  preview: string;
}

export function scanForSecrets(text: string): MatchedSecret[] {
  const out: MatchedSecret[] = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    // Reset .lastIndex; SECRET_PATTERNS uses /g so each .exec advances.
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      out.push({
        patternName: name,
        offset: m.index,
        length: m[0].length,
        preview: m[0].slice(0, 8) + '…',
      });
      if (m.index === regex.lastIndex) regex.lastIndex += 1; // avoid zero-width infinite loop
    }
  }
  return out;
}
