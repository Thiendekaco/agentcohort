import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConfigCmd, ConfigCmdResult } from '../src/configCmd';
import { CONFIG_FILENAME } from '../src/config';
import type { ModelsConfig } from '../src/config';

const tmps: string[] = [];
function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'af-ccmd-'));
  tmps.push(d);
  mkdirSync(join(d, '.claude', 'agents'), { recursive: true });
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function agent(modelLine: string): string {
  return `---\nname: x\ndescription: y\n${modelLine}\n---\n\n# Role\n\nbody\n`;
}

const DEFAULT_LIKE: ModelsConfig = {
  premium: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5-20251001',
};

describe('runConfigCmd', () => {
  it('writes config and does not touch files when no changes', async () => {
    const cwd = project();
    writeFileSync(join(cwd, '.claude', 'agents', 'a.md'), agent('model: opus'));

    const promptMock = vi.fn().mockResolvedValue(DEFAULT_LIKE);
    const confirmMock = vi.fn().mockResolvedValue(true);
    const result = await runConfigCmd({
      cwd,
      promptModelStrategy: promptMock,
      confirm: confirmMock,
    });

    expect(result.status).toBe('no-changes');
    expect(existsSync(join(cwd, CONFIG_FILENAME))).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    // Agent file unchanged
    expect(readFileSync(join(cwd, '.claude', 'agents', 'a.md'), 'utf8')).toBe(
      agent('model: opus')
    );
  });

  it('declines diff: writes nothing', async () => {
    const cwd = project();
    writeFileSync(join(cwd, '.claude', 'agents', 'a.md'), agent('model: opus'));
    // Pre-existing config with one set of IDs
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ version: 1, models: DEFAULT_LIKE }, null, 2) + '\n',
      'utf8'
    );

    const newModels: ModelsConfig = { ...DEFAULT_LIKE, premium: 'NEW-OPUS' };
    const promptMock = vi.fn().mockResolvedValue(newModels);
    const confirmMock = vi.fn().mockResolvedValue(false);
    const result = await runConfigCmd({
      cwd,
      promptModelStrategy: promptMock,
      confirm: confirmMock,
    });

    expect(result.status).toBe('cancelled');
    // Config file still has the OLD models
    const reloaded = JSON.parse(
      readFileSync(join(cwd, CONFIG_FILENAME), 'utf8')
    );
    expect(reloaded.models.premium).toBe('claude-opus-4-7');
    // Agent file unchanged
    expect(readFileSync(join(cwd, '.claude', 'agents', 'a.md'), 'utf8')).toBe(
      agent('model: opus')
    );
  });

  it('accepts diff: writes config and rewrites only affected files', async () => {
    const cwd = project();
    writeFileSync(join(cwd, '.claude', 'agents', 'p.md'), agent('model: opus'));
    writeFileSync(join(cwd, '.claude', 'agents', 'm.md'), agent('model: sonnet'));
    writeFileSync(join(cwd, '.claude', 'agents', 'c.md'), agent('model: haiku'));
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ version: 1, models: DEFAULT_LIKE }, null, 2) + '\n',
      'utf8'
    );

    const newModels: ModelsConfig = { ...DEFAULT_LIKE, premium: 'NEW-OPUS' };
    const promptMock = vi.fn().mockResolvedValue(newModels);
    const confirmMock = vi.fn().mockResolvedValue(true);
    const result = await runConfigCmd({
      cwd,
      promptModelStrategy: promptMock,
      confirm: confirmMock,
    });

    expect(result.status).toBe('applied');
    expect(result.changes.map((c) => c.file).sort()).toEqual(['p.md']);
    expect(readFileSync(join(cwd, '.claude', 'agents', 'p.md'), 'utf8')).toContain(
      'NEW-OPUS'
    );
    // mid and cheap files unchanged (they were sonnet/haiku and the
    // mid/cheap IDs didn't change)
    expect(readFileSync(join(cwd, '.claude', 'agents', 'm.md'), 'utf8')).toBe(
      agent('model: sonnet')
    );
    expect(readFileSync(join(cwd, '.claude', 'agents', 'c.md'), 'utf8')).toBe(
      agent('model: haiku')
    );
    // Config updated
    const reloaded = JSON.parse(
      readFileSync(join(cwd, CONFIG_FILENAME), 'utf8')
    );
    expect(reloaded.models.premium).toBe('NEW-OPUS');
  });

  it('reports no-agents when .claude/agents does not exist', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'af-ccmd-'));
    tmps.push(cwd);
    // No .claude/agents dir
    const promptMock = vi.fn().mockResolvedValue(DEFAULT_LIKE);
    const confirmMock = vi.fn().mockResolvedValue(true);
    const result = await runConfigCmd({
      cwd,
      promptModelStrategy: promptMock,
      confirm: confirmMock,
    });
    // Still saved the config
    expect(existsSync(join(cwd, CONFIG_FILENAME))).toBe(true);
    expect(result.status).toBe('no-agents');
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
