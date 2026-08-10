import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/llm/ollama-client.js', () => ({
  isReachable: vi.fn().mockResolvedValue(true),
}));

const { listAvailableInstallers, buildArgv, runPostCheck } = await import(
  '../../src/modules/install/installer-commands.js'
);

describe('ollama installer entry', () => {
  it('is offered in the installer list', () => {
    expect(listAvailableInstallers().map((i) => i.id)).toContain('ollama');
  });

  it('resolves to a shell command', async () => {
    const argv = await buildArgv('ollama');
    // The websocket transport refuses unknown ids, so the entry must be
    // registered rather than constructed ad hoc.
    expect(argv[0]).toBe('bash');
    expect(argv.join(' ')).toContain('ollama.com/install.sh');
  });

  it('post-check reports success when Ollama answers', async () => {
    expect(await runPostCheck('ollama')).toBe(true);
  });
});
