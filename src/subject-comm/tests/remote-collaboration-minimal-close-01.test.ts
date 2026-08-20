/**
 * REMOTE-COLLABORATION-MINIMAL-CLOSE-01
 * A propose → B accept/reject → 双方状态一致（经 Relay collaboration_sync）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Server } from 'node:http';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { CollaborationRecordStore } from '../../collaboration/record-store';
import { deriveCollabStatus } from '../../collaboration/record-derive';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createTestCommCipher, CommIdentityStore } from '../identity-store';
import { remoteEndpointRef } from '../endpoint';
import { LocalCollaborationHost } from '../../collaboration/local-collaboration';
import { LocalPackageTransport } from '../../collaboration/transport';
import { RelayTransport } from '../relay-transport';
import { setCommCipher } from '../transport-factory';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-rclose01-${prefix}-`));
}

async function openPkg(dir: string, name: string) {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: name,
    targetDir: dir,
    initialSelfDescription: `${name} 用于远程协作最小收口验证。`,
  });
  return { runtime, bus };
}

async function listenRelay(dataDir: string): Promise<{
  server: Server;
  relayUrl: string;
}> {
  await fs.mkdir(dataDir, { recursive: true });
  const store = new FileRelayStore(dataDir);
  const { server } = createRelayServer({ store, host: '127.0.0.1', port: 0 });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}` };
}

async function pairOnRelay(
  a: { runtime: ReturnType<typeof createDigitalMeRuntime>; bus: ReturnType<typeof createCommandBus> },
  b: { runtime: ReturnType<typeof createDigitalMeRuntime>; bus: ReturnType<typeof createCommandBus> },
  relayUrl: string,
) {
  await a.bus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
  await b.bus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
  const inviteA = await a.bus.invoke('subject.communicate', { action: 'createInvite' });
  const accepted = await b.bus.invoke('subject.communicate', {
    action: 'acceptInvite',
    inviteJson: inviteA.inviteJson!,
  });
  await a.bus.invoke('subject.communicate', {
    action: 'acceptInvite',
    inviteJson: accepted.inviteJson!,
  });
}

test('remote minimal close: accept syncs 协作已建立 to both sides', async () => {
  const root = await tempDir('accept');
  const cipher = createTestCommCipher();
  setCommCipher(cipher);
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  let runtimeA: ReturnType<typeof createDigitalMeRuntime> | null = null;
  let runtimeB: ReturnType<typeof createDigitalMeRuntime> | null = null;
  try {
    const a = await openPkg(dirA, '发起方');
    const b = await openPkg(dirB, '接收方');
    runtimeA = a.runtime;
    runtimeB = b.runtime;
    await pairOnRelay(a, b, relayUrl);

    const idA = new CommIdentityStore(dirA, cipher);
    const peerB = (await idA.listPeers())[0];
    assert.ok(peerB);
    const peerBRef = remoteEndpointRef(peerB!.endpointId);

    const relayA = new RelayTransport({ packageRoot: dirA, cipher, relayUrl });
    const hostA = new LocalCollaborationHost(
      a.runtime,
      new LocalPackageTransport(a.runtime, { relay: relayA }),
    );
    const proposed = await hostA.propose({
      responderEndpointRef: peerBRef,
      skipAutoEvaluate: true,
      proposal: {
        intent: '共同确认一次最小远程协作收口',
        expectedOutcome: '双方状态一致为协作已建立',
        offeredMaterials: [],
        acceptanceCriteria: ['双方记录状态一致'],
      },
    });
    assert.equal(proposed.status, 'proposed');

    const stA0 = await a.bus.invoke('collab.interact', {
      action: 'status',
      recordId: proposed.recordId,
    });
    assert.equal(stA0.status, 'proposed');
    assert.equal(stA0.role, 'initiator');

    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const stB0 = await b.bus.invoke('collab.interact', {
      action: 'status',
      recordId: proposed.recordId,
    });
    assert.equal(stB0.status, 'proposed');
    assert.equal(stB0.role, 'responder');

    const accepted = await b.bus.invoke('collab.interact', {
      action: 'respond',
      recordId: proposed.recordId,
      decision: 'accept',
    });
    assert.ok(
      accepted.status === 'agreed' || accepted.status === 'authorized',
      `accept status=${accepted.status}`,
    );

    await a.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const stA1 = await a.bus.invoke('collab.interact', {
      action: 'status',
      recordId: proposed.recordId,
    });
    const stB1 = await b.bus.invoke('collab.interact', {
      action: 'status',
      recordId: proposed.recordId,
    });
    assert.ok(
      stA1.status === 'agreed' || stA1.status === 'authorized',
      `A after accept=${stA1.status}`,
    );
    assert.equal(stA1.status, stB1.status);

    // 重启后保持
    await a.runtime.stop();
    await b.runtime.stop();
    runtimeA = null;
    runtimeB = null;
    const a2 = createDigitalMeRuntime({ documentCapability: 'fake' });
    const b2 = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busA2 = createCommandBus(a2);
    const busB2 = createCommandBus(b2);
    await a2.openPackage({ dir: dirA });
    await b2.openPackage({ dir: dirB });
    runtimeA = a2;
    runtimeB = b2;
    const stA2 = await busA2.invoke('collab.interact', {
      action: 'status',
      recordId: proposed.recordId,
    });
    const stB2 = await busB2.invoke('collab.interact', {
      action: 'status',
      recordId: proposed.recordId,
    });
    assert.ok(stA2.status === 'agreed' || stA2.status === 'authorized');
    assert.equal(stA2.status, stB2.status);
    assert.equal(stA2.role, 'initiator');
    assert.equal(stB2.role, 'responder');
  } finally {
    setCommCipher(null);
    if (runtimeA) await runtimeA.stop().catch(() => undefined);
    if (runtimeB) await runtimeB.stop().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('remote minimal close: reject syncs 暂未建立协作 to both sides', async () => {
  const root = await tempDir('reject');
  const cipher = createTestCommCipher();
  setCommCipher(cipher);
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  let runtimeA: ReturnType<typeof createDigitalMeRuntime> | null = null;
  let runtimeB: ReturnType<typeof createDigitalMeRuntime> | null = null;
  try {
    const a = await openPkg(dirA, '发起方');
    const b = await openPkg(dirB, '接收方');
    runtimeA = a.runtime;
    runtimeB = b.runtime;
    await pairOnRelay(a, b, relayUrl);

    const idA = new CommIdentityStore(dirA, cipher);
    const peerB = (await idA.listPeers())[0]!;
    const peerBRef = remoteEndpointRef(peerB.endpointId);
    const relayA = new RelayTransport({ packageRoot: dirA, cipher, relayUrl });
    const hostA = new LocalCollaborationHost(
      a.runtime,
      new LocalPackageTransport(a.runtime, { relay: relayA }),
    );
    const proposed = await hostA.propose({
      responderEndpointRef: peerBRef,
      skipAutoEvaluate: true,
      proposal: {
        intent: '一次将被暂不接受的远程协作提议',
        expectedOutcome: '双方状态为暂未建立协作',
        offeredMaterials: [],
        acceptanceCriteria: ['双方拒绝态一致'],
      },
    });

    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const rejected = await b.bus.invoke('collab.interact', {
      action: 'respond',
      recordId: proposed.recordId,
      decision: 'reject',
      note: '本次不适合',
    });
    assert.equal(rejected.status, 'rejected');

    await a.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const recA = await (await CollaborationRecordStore.open(dirA)).get(proposed.recordId);
    const recB = await (await CollaborationRecordStore.open(dirB)).get(proposed.recordId);
    assert.ok(recA && recB);
    assert.equal(deriveCollabStatus(recA!), 'rejected');
    assert.equal(deriveCollabStatus(recB!), 'rejected');
    assert.ok(recA!.events.some((e) => e.kind === 'rejected'));
    assert.ok(recB!.events.some((e) => e.kind === 'rejected'));
  } finally {
    setCommCipher(null);
    if (runtimeA) await runtimeA.stop().catch(() => undefined);
    if (runtimeB) await runtimeB.stop().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
