import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Regression guard for the data-loss incident: a `test-verifier`
 * subagent ran `git restore .` and wiped 11 uncommitted file edits.
 * Root cause was the absence of explicit destructive-git boundaries
 * in the agent prompts.
 *
 * These tests pin the safety language into the source-of-truth
 * boot directive AND verify it's propagated into every bundled
 * agent template. If a future refactor accidentally removes the
 * boundary, CI catches it before another user loses work.
 */

const REPO_ROOT = resolve(process.cwd());
const DIRECTIVE_PATH = join(
  REPO_ROOT,
  'src',
  'templates',
  '_boot-directive.md'
);
const AGENT_DIR = join(REPO_ROOT, 'src', 'templates', 'agents');

const REQUIRED_FORBIDDEN_COMMANDS = [
  'git restore',
  'git reset --hard',
  'git clean -f',
  'git checkout --',
  'git stash drop',
  'git push --force',
];

const REQUIRED_PHRASES = [
  'Git safety',
  'destructive git commands',
  'NEVER',
  'Read-only git inspection is always allowed',
];

describe('boot directive — git safety boundary', () => {
  it('source _boot-directive.md contains the Git safety section', () => {
    const body = readFileSync(DIRECTIVE_PATH, 'utf8');
    for (const phrase of REQUIRED_PHRASES) {
      expect(body, `expected phrase "${phrase}" in _boot-directive.md`).toContain(
        phrase
      );
    }
  });

  it('source _boot-directive.md explicitly forbids each destructive command', () => {
    const body = readFileSync(DIRECTIVE_PATH, 'utf8');
    for (const cmd of REQUIRED_FORBIDDEN_COMMANDS) {
      expect(body, `expected forbidden command "${cmd}" in _boot-directive.md`).toContain(
        cmd
      );
    }
  });
});

describe('every bundled agent inherits the git safety boundary', () => {
  const agentFiles = readdirSync(AGENT_DIR).filter((f) => f.endsWith('.md'));

  it('finds at least 16 bundled agents (sanity check)', () => {
    expect(agentFiles.length).toBeGreaterThanOrEqual(16);
  });

  for (const f of agentFiles) {
    it(`${f} contains all git-safety phrases`, () => {
      const body = readFileSync(join(AGENT_DIR, f), 'utf8');
      for (const phrase of REQUIRED_PHRASES) {
        expect(body, `${f} missing phrase "${phrase}"`).toContain(phrase);
      }
    });

    it(`${f} contains every forbidden-command literal`, () => {
      const body = readFileSync(join(AGENT_DIR, f), 'utf8');
      for (const cmd of REQUIRED_FORBIDDEN_COMMANDS) {
        expect(body, `${f} missing forbidden command "${cmd}"`).toContain(cmd);
      }
    });

    it(`${f} keeps the safety section INSIDE the boot-directive region`, () => {
      const body = readFileSync(join(AGENT_DIR, f), 'utf8');
      const safetyIdx = body.indexOf('Git safety');
      const startIdx = body.indexOf('<!-- boot-directive-start -->');
      const endIdx = body.indexOf('<!-- boot-directive-end -->');
      expect(safetyIdx).toBeGreaterThan(startIdx);
      expect(safetyIdx).toBeLessThan(endIdx);
    });
  }
});

describe('per-agent safety reinforcement (defense in depth)', () => {
  const agentFiles = readdirSync(AGENT_DIR).filter((f) => f.endsWith('.md'));

  function hasBash(body: string): boolean {
    const m = body.match(/^tools:\s*(.+?)\s*$/m);
    if (!m) return false;
    return m[1]!.split(',').map((s) => s.trim()).includes('Bash');
  }

  const bashAgents = agentFiles.filter((f) =>
    hasBash(readFileSync(join(AGENT_DIR, f), 'utf8'))
  );
  const noBashAgents = agentFiles.filter(
    (f) => !hasBash(readFileSync(join(AGENT_DIR, f), 'utf8'))
  );

  it('identifies exactly the expected agents (Bash vs no-Bash) — sanity', () => {
    expect(bashAgents.length).toBeGreaterThanOrEqual(11);
    expect(noBashAgents.length).toBeGreaterThanOrEqual(5);
    expect(bashAgents.length + noBashAgents.length).toBe(agentFiles.length);
  });

  for (const f of bashAgents) {
    it(`${f} (has Bash) carries the per-agent safety block`, () => {
      const body = readFileSync(join(AGENT_DIR, f), 'utf8');
      expect(body).toContain('<!-- agent-git-safety-start -->');
      expect(body).toContain('<!-- agent-git-safety-end -->');
      expect(body).toContain(
        'Git safety (binding — re-stated because this agent has shell access)'
      );
      // Reinforcement repeats the most-dangerous forbidden commands.
      for (const cmd of ['git restore', 'git reset --hard', 'git clean -f']) {
        expect(body, `${f} per-agent block missing "${cmd}"`).toContain(cmd);
      }
    });

    it(`${f} per-agent safety block sits OUTSIDE the boot-directive markers`, () => {
      // The boot directive is auto-synced; the per-agent block must live
      // outside it so `sync-boot-directive` doesn't rewrite it on every
      // directive update.
      const body = readFileSync(join(AGENT_DIR, f), 'utf8');
      const bootEnd = body.indexOf('<!-- boot-directive-end -->');
      const perAgentStart = body.indexOf('<!-- agent-git-safety-start -->');
      expect(bootEnd).toBeGreaterThan(-1);
      expect(perAgentStart).toBeGreaterThan(bootEnd);
    });
  }

  for (const f of noBashAgents) {
    it(`${f} (no Bash) does NOT carry the per-agent block (it would be noise)`, () => {
      const body = readFileSync(join(AGENT_DIR, f), 'utf8');
      expect(body).not.toContain('<!-- agent-git-safety-start -->');
    });
  }
});
