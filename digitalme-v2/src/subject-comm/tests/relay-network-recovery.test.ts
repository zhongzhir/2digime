/**
 * REMOTE-RELAY-NETWORK-RECOVERY-FIX-02
 * 使用与 Electron 主进程相同的 defaultRelayHttp（node:http(s)+每请求 Agent.destroy），
 * 真实 socket 生命周期：不可达 → 恢复 → 同 Transport 自动 retry 成功。
 * 禁止用 mock fetch 代替真实连接。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';
import type { Server } from 'node:http';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createTestCommCipher, CommIdentityStore } from '../identity-store';
import { RelayTransport } from '../relay-transport';
import { OutboxStore } from '../outbox-store';
import { SUBJECT_ENDPOINT_PROTOCOL, remoteEndpointRef } from '../endpoint';
import { buildEnvelope } from '../local-subject-transport';
import { defaultRelayHttp } from '../relay-http';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-relay-rec2-${prefix}-`));
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
  await new Promise((r) => setTimeout(r, 80));
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
    subjectId: 'subj_a_rec2',
    displayName: 'A',
    relayUrl,
    endpointId: 'ep_a_rec2',
  });
  const b = await idB.ensureLocalEndpoint({
    subjectId: 'subj_b_rec2',
    displayName: 'B',
    relayUrl,
    endpointId: 'ep_b_rec2',
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
  return { cipher, dirA, profileA: a.profile, profileB: b.profile };
}

test('defaultRelayHttp：真实 socket 先不可达再恢复，同函数实例成功', async () => {
  // 真实 TCP：先占端口但不 accept HTTP → ECONNRESET/失败；再换成正常 Relay
  const root = await tempDir('sock');
  const holder = net.createServer(() => {
    /* 接受后立即销毁，模拟坏连接 */
  });
  const port = await new Promise<number>((resolve, reject) => {
    holder.listen(0, '127.0.0.1', () => {
      const a = holder.address();
      if (a && typeof a === 'object') resolve(a.port);
      else reject(new Error('no port'));
    });
    holder.on('error', reject);
  });

  // 关闭 holder，使端口在短窗内不可达
  await new Promise<void>((resolve, reject) => {
    holder.close((err) => (err ? reject(err) : resolve()));
  });
  await new Promise((r) => setTimeout(r, 30));

  await assert.rejects(
    () => defaultRelayHttp({ url: `http://127.0.0.1:${port}/health`, timeoutMs: 800 }),
    /relay_/,
  );

  const relay = await listenRelay(path.join(root, 'data'), port);
  try {
    const ok = await defaultRelayHttp({ url: `${relay.relayUrl}/health`, timeoutMs: 3000 });
    assert.equal(ok.status, 200);
    assert.match(ok.text, /"ok"\s*:\s*true/);
  } finally {
    await closeServer(relay.server);
  }
});

test('同一 Transport：真实断连→同端口恢复→retryOutbox 成功且只投递一次', async () => {
  const root = await tempDir('main');
  const relayData = path.join(root, 'relay-data');
  let relay = await listenRelay(relayData);
  const { cipher, dirA, profileA, profileB } = await setupPair(root, relay.relayUrl);

  const transport = new RelayTransport({
    packageRoot: dirA,
    cipher,
    relayUrl: relay.relayUrl,
  });

  const offlineEnv = buildEnvelope({
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
      intent: '断网期间发出，待恢复后重试',
      seeking: ['协作'],
      offering: ['能力'],
      disclosureLevel: 'minimal',
    },
    correlationId: 'opportunity_rec2_01',
  });
  const offlineId = offlineEnv.envelopeId;

  const port = relay.port;
  await closeServer(relay.server);

  const offlineSend = await transport.send(offlineEnv);
  assert.equal(offlineSend.delivered, false);
  const failedItem = await (await OutboxStore.open(dirA)).get(offlineId);
  assert.equal(failedItem?.state, 'failed');
  assert.ok(failedItem?.lastErrorCategory);
  assert.ok(failedItem?.lastErrorDetail, '应保留开发诊断细节');
  assert.match(failedItem!.lastErrorDetail!, /relay_|ECONN|timeout|Error/i);

  relay = await listenRelay(relayData, port);
  const retry = await transport.retryOutbox();
  assert.equal(retry.submitted, 1);
  assert.equal(retry.failed, 0);

  const done = await (await OutboxStore.open(dirA)).get(offlineId);
  assert.equal(done?.state, 'submitted');
  assert.equal(done?.lastErrorDetail, undefined);

  const listed = await relay.store.listForRecipient(profileB.endpointId, { includeAcked: true });
  assert.equal(listed.filter((w) => w.envelopeId === offlineId).length, 1);

  const again = await transport.retryOutbox();
  assert.equal(again.submitted, 0);
  assert.equal(
    (await relay.store.listForRecipient(profileB.endpointId, { includeAcked: true })).filter(
      (w) => w.envelopeId === offlineId,
    ).length,
    1,
  );

  await closeServer(relay.server);
});

test('defaultRelayHttp 未使用 global fetch（源码与运行时约束）', async () => {
  const src = await fs.readFile(
    path.resolve(__dirname, '../relay-http.ts'),
    'utf8',
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.match(src, /agent\.destroy|createRelayAgent/);
  assert.match(src, /keepAlive:\s*false/);
  assert.match(src, /family:\s*4/);
});
