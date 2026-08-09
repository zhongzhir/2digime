/**
 * REMOTE-RELAY-NETWORK-RECOVERY-FIX-01
 * 同一 Runtime/Transport 实例：断网失败 → 网络恢复 → retryOutbox 自动成功。
 * 不得靠重建整个 Runtime/Transport 让测试通过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Server } from 'node:http';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createTestCommCipher, CommIdentityStore } from '../identity-store';
import { RelayTransport } from '../relay-transport';
import { RelayClient } from '../relay-client';
import { OutboxStore } from '../outbox-store';
import { SUBJECT_ENDPOINT_PROTOCOL, remoteEndpointRef } from '../endpoint';
import { buildEnvelope } from '../local-subject-transport';
import { defaultRelayHttp, type RelayHttpFn } from '../relay-http';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-relay-recovery-${prefix}-`));
}

async function listenRelay(
  dataDir: string,
  port = 0,
): Promise<{ server: Server; relayUrl: string; store: FileRelayStore; port: number }> {
  await fs.mkdir(dataDir, { recursive: true });
  const store = new FileRelayStore(dataDir);
  const { server } = createRelayServer({ store, host: '127.0.0.1', port });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return {
    server,
    relayUrl: `http://127.0.0.1:${addr.port}`,
    store,
    port: addr.port,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // 给 OS 一点时间释放端口，便于同端口重启
  await new Promise((r) => setTimeout(r, 50));
}

async function setupPair(root: string, relayUrl: string) {
  const cipher = createTestCommCipher();
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  await fs.mkdir(dirA, { recursive: true });
  await fs.mkdir(dirB, { recursive: true });

  const idA = new CommIdentityStore(dirA, cipher);
  const idB = new CommIdentityStore(dirB, cipher);
  const a = await idA.ensureLocalEndpoint({
    subjectId: 'subj_a_recovery',
    displayName: 'A',
    relayUrl,
    endpointId: 'ep_a_recovery',
  });
  const b = await idB.ensureLocalEndpoint({
    subjectId: 'subj_b_recovery',
    displayName: 'B',
    relayUrl,
    endpointId: 'ep_b_recovery',
  });
  await idA.putPeer({
    protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
    subjectId: b.profile.subjectId,
    endpointId: b.profile.endpointId,
    displayName: b.profile.displayName,
    relayUrl,
    signPublicKey: b.profile.signPublicKey,
    encPublicKey: b.profile.encPublicKey,
    keyId: b.profile.keyId,
  });
  await idB.putPeer({
    protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
    subjectId: a.profile.subjectId,
    endpointId: a.profile.endpointId,
    displayName: a.profile.displayName,
    relayUrl,
    signPublicKey: a.profile.signPublicKey,
    encPublicKey: a.profile.encPublicKey,
    keyId: a.profile.keyId,
  });

  return { cipher, dirA, dirB, profileA: a.profile, profileB: b.profile };
}

test('同一 Transport：断网失败后恢复网络，retryOutbox 自动成功且 envelope 只投递一次', async () => {
  const root = await tempDir('main');
  const relayData = path.join(root, 'relay-data');
  let relay = await listenRelay(relayData);
  const { cipher, dirA, profileA, profileB } = await setupPair(root, relay.relayUrl);

  // 同一实例贯穿失败与恢复
  const transport = new RelayTransport({
    packageRoot: dirA,
    cipher,
    relayUrl: relay.relayUrl,
  });

  const envelope = buildEnvelope({
    from: {
      subjectId: profileA.subjectId,
      displayName: profileA.displayName,
      endpointRef: remoteEndpointRef(profileA.endpointId),
    },
    to: {
      subjectId: profileB.subjectId,
      displayName: profileB.displayName,
      endpointRef: remoteEndpointRef(profileB.endpointId),
    },
    kind: 'signal',
    payload: {
      intent: '网络恢复后应自动送达',
      seeking: ['协作'],
      offering: ['能力'],
      disclosureLevel: 'minimal',
    },
    correlationId: 'opportunity_network_recovery_01',
  });
  const envelopeId = envelope.envelopeId;

  const first = await transport.send(envelope);
  assert.equal(first.delivered, true);
  assert.equal((await relay.store.listForRecipient(profileB.endpointId)).length, 1);

  // 制造「断网」：关闭 Relay，不重建 Transport
  const port = relay.port;
  await closeServer(relay.server);

  const offlineEnv = buildEnvelope({
    from: envelope.from,
    to: envelope.to,
    kind: 'signal',
    payload: {
      intent: '断网期间发出，待恢复后重试',
      seeking: ['协作'],
      offering: ['能力'],
      disclosureLevel: 'minimal',
    },
    correlationId: 'opportunity_network_recovery_02',
  });
  const offlineId = offlineEnv.envelopeId;
  const offlineSend = await transport.send(offlineEnv);
  assert.equal(offlineSend.delivered, false);

  const failedItem = await (await OutboxStore.open(dirA)).get(offlineId);
  assert.ok(failedItem);
  assert.equal(failedItem!.state, 'failed');
  assert.equal(failedItem!.lastErrorCategory, 'relay_unavailable');
  assert.ok(failedItem!.attempts >= 1);

  // 恢复网络：同端口重启 Relay
  relay = await listenRelay(relayData, port);
  assert.equal(relay.relayUrl, `http://127.0.0.1:${port}`);

  const retry = await transport.retryOutbox();
  assert.equal(retry.submitted, 1);
  assert.equal(retry.failed, 0);

  const pending = await (await OutboxStore.open(dirA)).listPending();
  assert.equal(
    pending.filter((i) => i.envelopeId === offlineId).length,
    0,
    '成功后不得继续挂在 pending/failed',
  );
  const done = await (await OutboxStore.open(dirA)).get(offlineId);
  assert.equal(done?.state, 'submitted');
  assert.equal(done?.lastErrorCategory, undefined);

  const listed = await relay.store.listForRecipient(profileB.endpointId, { includeAcked: true });
  const hits = listed.filter((w) => w.envelopeId === offlineId);
  assert.equal(hits.length, 1, 'Relay 只应收到该 envelope 一次');
  assert.equal(listed.some((w) => w.envelopeId === envelopeId), true);

  const retryAgain = await transport.retryOutbox();
  assert.equal(retryAgain.submitted, 0);
  assert.equal(
    (await relay.store.listForRecipient(profileB.endpointId, { includeAcked: true })).filter(
      (w) => w.envelopeId === offlineId,
    ).length,
    1,
  );

  await closeServer(relay.server);
});

test('同一 RelayClient：http 层先失败后成功，无需重建 client', async () => {
  let calls = 0;
  const http: RelayHttpFn = async (req) => {
    calls += 1;
    if (calls === 1) {
      const err = new Error('fetch failed');
      (err as NodeJS.ErrnoException).code = 'ECONNRESET';
      throw err;
    }
    if (req.url.includes('/health')) {
      return { status: 200, text: JSON.stringify({ ok: true }) };
    }
    return {
      status: 200,
      text: JSON.stringify({ ok: true, duplicate: false, state: 'delivered-to-relay' }),
    };
  };

  const client = new RelayClient('http://127.0.0.1:9', http);
  await assert.rejects(
    () =>
      client.submit({
        version: 1,
        envelopeId: 'e_fail_then_ok',
        fromEndpointId: 'a',
        toEndpointId: 'b',
        keyId: 'k',
        createdAt: new Date().toISOString(),
        sealed: {
          ephPublicSpkiB64: 'e',
          ivB64: 'i',
          tagB64: 't',
          ciphertextB64: 'c',
        },
        signatureB64: 'x',
        deliveryState: 'submitted',
      }),
    /relay/,
  );

  const second = await client.submit({
    version: 1,
    envelopeId: 'e_fail_then_ok',
    fromEndpointId: 'a',
    toEndpointId: 'b',
    keyId: 'k',
    createdAt: new Date().toISOString(),
    sealed: {
      ephPublicSpkiB64: 'e',
      ivB64: 'i',
      tagB64: 't',
      ciphertextB64: 'c',
    },
    signatureB64: 'x',
    deliveryState: 'submitted',
  });
  assert.equal(second.ok, true);
  assert.equal(calls, 2);
});

test('defaultRelayHttp 使用独立连接且可访问本机 Relay', async () => {
  const root = await tempDir('http');
  const relay = await listenRelay(path.join(root, 'data'));
  try {
    const health = await defaultRelayHttp({ url: `${relay.relayUrl}/health` });
    assert.equal(health.status, 200);
    assert.match(health.text, /"ok"\s*:\s*true/);
  } finally {
    await closeServer(relay.server);
  }
});
