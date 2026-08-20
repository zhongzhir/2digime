import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  A2A_REMOTE_ADAPTER_ID,
  A2A_REMOTE_CAPABILITY_ID,
  createA2ARemoteCapabilityAdapter,
} from '../a2a-remote';
import { buildResearchEndpointPolicy } from '../../remote-endpoint-policy';
import { createDigitalMeRuntime } from '../../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../../work-runtime/job-runner';

const AGENT_DIR = path.resolve(__dirname, '../../../../reference-agents/research-a2a-agent');

async function startAgent(port: number) {
  const child = spawn(process.execPath, [path.join(AGENT_DIR, 'server.cjs')], {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      RESEARCH_A2A_HOST: '127.0.0.1',
      RESEARCH_A2A_PORT: String(port),
      RESEARCH_A2A_DELAY_MS: '40',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const control = `http://127.0.0.1:${port + 1}/health`;
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const res = await fetch(control);
      if (res.ok) {
        return {
          baseUrl: `http://127.0.0.1:${port}`,
          async stop() {
            try {
              await fetch(`http://127.0.0.1:${port + 1}/shutdown`, { method: 'POST' });
            } catch {
              /* ignore */
            }
            try {
              child.kill();
            } catch {
              /* ignore */
            }
          },
        };
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  throw new Error('agent failed to start for unit test');
}

test('A2A adapter describe/checkAvailability against live agent card', async () => {
  const port = 43211 + Math.floor(Math.random() * 200);
  const agent = await startAgent(port);
  try {
    const endpoint = buildResearchEndpointPolicy({ baseUrl: agent.baseUrl });
    const adapter = createA2ARemoteCapabilityAdapter({ endpoint });
    const desc = adapter.describe();
    assert.equal(desc.adapterId, A2A_REMOTE_ADAPTER_ID);
    assert.equal(desc.capabilityId, A2A_REMOTE_CAPABILITY_ID);
    assert.equal(desc.supportsAsyncRemote, true);
    const avail = await adapter.checkAvailability();
    assert.equal(avail.available, true);
  } finally {
    await agent.stop();
  }
});

test('A2A malformed artifact is rejected by verification gate', async () => {
  const port = 43411 + Math.floor(Math.random() * 200);
  const agent = await startAgent(port);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-a2a-unit-'));
  const pkgDir = path.join(root, 'pkg');
  const mat = path.join(root, 'm.txt');
  await fs.writeFile(mat, '授权材料：范围与风险', 'utf8');
  try {
    const endpoint = buildResearchEndpointPolicy({
      baseUrl: agent.baseUrl,
      maxTaskDuration: 30_000,
    });
    const runtime = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      a2aRemoteCapability: {
        endpoint,
        pollIntervalMs: 40,
        defaultFault: 'malformed_artifact',
      },
    });
    await runtime.createPackage({
      displayName: 'unit',
      targetDir: pkgDir,
      initialSelfDescription: 'unit',
    });
    const { jobId } = await runtime.submitTask({
      goal: '形成项目风险摘要',
      contextRefs: [{ kind: 'file', path: mat }],
      requestedArtifactType: 'document',
      capabilityId: A2A_REMOTE_CAPABILITY_ID,
    });
    const job = await waitForJobTerminal(runtime.workRuntime, jobId, 30_000);
    assert.equal(job.status, 'failed');
    runtime.workRuntime.stop();
  } finally {
    await agent.stop();
  }
});

test('A2A agent card mismatch fails availability', async () => {
  const port = 43611 + Math.floor(Math.random() * 200);
  const agent = await startAgent(port);
  try {
    const bad = {
      ...buildResearchEndpointPolicy({ baseUrl: agent.baseUrl }),
      capabilityAllowlist: ['not_a_real_skill'] as const,
    };
    const adapter = createA2ARemoteCapabilityAdapter({ endpoint: bad });
    const avail = await adapter.checkAvailability();
    assert.equal(avail.available, false);
  } finally {
    await agent.stop();
  }
});
