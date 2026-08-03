import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, after } from 'node:test';
import { createDigitalMeRuntime } from '../digitalme-runtime';

describe('DigitalMeRuntime documentCapability none', () => {
  const dirs: string[] = [];
  after(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not register fake or available document capabilities', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dmv2-none-cap-'));
    dirs.push(dir);
    const runtime = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
    });
    await runtime.createPackage({ displayName: 'none-cap', targetDir: dir });
    const { capabilities } = await runtime.listCapabilities();
    assert.equal(capabilities.length, 0);
    await assert.rejects(
      () =>
        runtime.submitTask({
          goal: 'blocked',
          contextRefs: [],
          requestedArtifactType: 'document',
        }),
      /no available capability/i,
    );
    await runtime.stop();
  });
});
