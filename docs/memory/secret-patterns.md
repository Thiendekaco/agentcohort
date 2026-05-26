# Secret patterns blocked by the memory write guard

`agentcohort memory write` runs each entry's serialized body through the
following regex patterns. A match anywhere causes a hard reject with
disposition `rejected-secret`.

The intent is conservative — better to miss an exotic format than block a
legitimate write. The doctor's `memory.secrets-scan` check provides
retroactive detection for anything that slipped through.

| Pattern name | Regex | Example match |
|---|---|---|
| `aws-access-key-id` | `\bAKIA[0-9A-Z]{16}\b` | `AKIAIOSFODNN7EXAMPLE` |
| `openai-secret-key` | `\bsk-[a-zA-Z0-9]{48}\b` | `sk-aBcDeF...` (48 chars) |
| `github-token` | `\bgh[pousr]_[A-Za-z0-9]{36,255}\b` | `ghp_aBcDeF...` |
| `anthropic-key` | `\bsk-ant-[a-zA-Z0-9\-_]{90,}\b` | `sk-ant-aBcDeF...` |
| `bearer-token` | `\bBearer\s+[A-Za-z0-9_\-\.=]{20,}` | `Bearer aBcDeF...` |
| `private-key` | `-----BEGIN (?:RSA \|EC \|OPENSSH \|DSA \|PGP )?PRIVATE KEY-----` | (PEM block header) |
| `env-secret-line` | `\b(?:API_KEY\|SECRET\|TOKEN\|PASSWORD)=\S{8,}` | `API_KEY=abc123def...` |

**False positive?** Open an issue at
https://github.com/Thiendekaco/agentcohort/issues — include the literal
string that was rejected (with sensitive parts redacted) and the pattern
name from the error message.

**Adding a new pattern?** Edit `src/memorySecretGuard.ts` and add the
corresponding test in `test/memorySecretGuard.test.ts`. Update this doc.
