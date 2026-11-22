import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createTestCommCipher, CommIdentityStore } from '../identity-store';
import { SUBJECT_ENDPOINT_PROTOCOL, remoteEndpointRef } from '../endpoint';
import { verifySignedKeyTransition } from '../key-transition';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createRelaySubjectNetwork } from '../../subject-collab/relay-network';
import { writePublicCard } from '../../subject-collab/public-card';
import type { PublicSubjectCard } from '../../subject-collab/types';
import { RelayClient } from '../relay-client';
import { RelayTransport } from '../relay-transport';
import type { RelayWireEnvelope } from '../relay-wire';
import {
  canonicalRelaySignBytes,
  sealForRecipient,
  sealedCanonicalJson,
  signRelayEnvelope,
} from '../crypto-identity';
import { buildEnvelope } from '../local-subject-transport';

async function listenRelay(root: string): Promise<{ server: Server; relayUrl: string }> {
  const store = new FileRelayStore(path.join(root, 'relay'));
  const { server } = createRelayServer({ store, host: '127.0.0.1', port: 0 });
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Relay 未返回监听端口'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test('端点交接证明由旧、新 key 双签名并拒绝篡改、过期和已撤销旧 key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-key-proof-'));
  const store = new CommIdentityStore(root, createTestCommCipher());
  const { profile } = await store.ensureLocalEndpoint({
    subjectId: 'subj_proof',
    displayName: '交接证明主体',
    relayUrl: 'https://relay.example.test',
    endpointId: 'ep_proof_old',
  });
  const transition = await store.prepareLocalTransition({
    endpointId: 'ep_proof_next',
    issuedAt: '2026-11-22T08:00:00.000Z',
    expiresAt: '2026-11-23T08:00:00.000Z',
  });
  const expected = { ...profile, pairedAt: '2026-11-22T07:00:00.000Z' };

  assert.equal(
    verifySignedKeyTransition({
      proof: transition.proof,
      expectedPrevious: expected,
      now: '2026-11-22T09:00:00.000Z',
    }).ok,
    true,
  );
  const tampered = structuredClone(transition.proof);
  tampered.statement.next.endpointId = 'ep_attacker';
  assert.ok(
    verifySignedKeyTransition({
      proof: tampered,
      expectedPrevious: expected,
      now: '2026-11-22T09:00:00.000Z',
    }).reasons.includes('previous_signature_invalid'),
  );
  assert.ok(
    verifySignedKeyTransition({
      proof: transition.proof,
      expectedPrevious: expected,
      now: '2026-11-24T00:00:00.000Z',
    }).reasons.includes('transition_expired'),
  );
  assert.ok(
    verifySignedKeyTransition({
      proof: transition.proof,
      expectedPrevious: expected,
      revokedKeyIds: [profile.keyId],
      now: '2026-11-22T09:00:00.000Z',
    }).reasons.includes('previous_key_revoked'),
  );
});

test('本机激活以完整 key bundle 为前置，重启前后不会出现半切换 profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-key-atomic-'));
  const cipher = createTestCommCipher();
  const first = new CommIdentityStore(root, cipher);
  const { profile: previous } = await first.ensureLocalEndpoint({
    subjectId: 'subj_atomic',
    displayName: '原子轮换主体',
    relayUrl: 'https://relay.example.test',
    endpointId: 'ep_atomic_old',
  });
  await assert.rejects(
    () => first.prepareLocalTransition({ relayUrl: 'https://other-relay.example.test' }),
    /只支持同一 Relay/,
  );
  const pending = await first.prepareLocalTransition({ endpointId: 'ep_atomic_next' });
  assert.equal((await first.getLocalProfile())?.endpointId, previous.endpointId);
  assert.equal((await first.loadKeyMaterial())?.keyId, previous.keyId);

  const afterRestart = new CommIdentityStore(root, cipher);
  assert.equal((await afterRestart.getLocalTransition())?.phase, 'preparing');
  const active = await afterRestart.activateLocalTransition();
  assert.equal(active.phase, 'active');
  assert.equal((await afterRestart.getLocalProfile())?.subjectId, previous.subjectId);
  assert.equal((await afterRestart.getLocalProfile())?.endpointId, pending.nextProfile.endpointId);
  assert.equal((await afterRestart.loadKeyMaterial())?.keyId, pending.nextProfile.keyId);
  assert.equal(await afterRestart.finalizeLocalTransition(), true);
  assert.equal(await afterRestart.getLocalTransition(), null);
  assert.equal(await afterRestart.assertNoPlaintextPrivateKeys(), true);
});

test('真实 Relay：准备后重启可续跑，提交后同步撤销且旧端点真实密文投递被拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-key-relay-'));
  const relay = await listenRelay(root);
  try {
    const dirA = path.join(root, 'a');
    const dirB = path.join(root, 'b');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    const cipher = createTestCommCipher();
    const idA = new CommIdentityStore(dirA, cipher);
    const idB = new CommIdentityStore(dirB, cipher);
    const a = await idA.ensureLocalEndpoint({
      subjectId: 'subj_rotate_a',
      displayName: '轮换主体 A',
      relayUrl: relay.relayUrl,
      endpointId: 'ep_rotate_a_old',
    });
    const b = await idB.ensureLocalEndpoint({
      subjectId: 'subj_rotate_b',
      displayName: '接收主体 B',
      relayUrl: relay.relayUrl,
      endpointId: 'ep_rotate_b',
    });
    const oldKeys = await idA.loadKeyMaterial();
    assert.ok(oldKeys);
    await idA.putPeer({
      protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
      subjectId: b.profile.subjectId,
      endpointId: b.profile.endpointId,
      displayName: b.profile.displayName,
      relayUrl: relay.relayUrl,
      signPublicKey: b.profile.signPublicKey,
      encPublicKey: b.profile.encPublicKey,
      keyId: b.profile.keyId,
    });
    await idB.putPeer({
      protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
      subjectId: a.profile.subjectId,
      endpointId: a.profile.endpointId,
      displayName: a.profile.displayName,
      relayUrl: relay.relayUrl,
      signPublicKey: a.profile.signPublicKey,
      encPublicKey: a.profile.encPublicKey,
      keyId: a.profile.keyId,
    });

    const networkA = createRelaySubjectNetwork({ packageRoot: dirA, cipher });
    const networkB = createRelaySubjectNetwork({ packageRoot: dirB, cipher });
    const started = await networkA.beginIdentityTransition({ endpointId: 'ep_rotate_a_next' });
    assert.equal(started.phase, 'preparing');
    assert.equal((await idA.getLocalProfile())?.endpointId, 'ep_rotate_a_old');

    assert.equal(await networkB.drainInbox(), 1);
    assert.ok(await idB.getPeer('ep_rotate_a_old'));
    assert.ok(await idB.getPeer('ep_rotate_a_next'));
    assert.equal(await idB.isPeerKeyRevoked(a.profile.subjectId, a.profile.keyId), false);

    // 模拟 A 在收到 ready 前退出；新实例从持久化记录续跑并激活新端点。
    const networkAfterRestart = createRelaySubjectNetwork({ packageRoot: dirA, cipher });
    const cardA: PublicSubjectCard = {
      schemaVersion: 1,
      subjectId: a.profile.subjectId,
      displayName: a.profile.displayName,
      endpointRef: remoteEndpointRef(a.profile.endpointId),
      publicSkills: [],
      cooperationScope: '低风险协作。',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    };
    await writePublicCard(dirA, cardA);
    const detach = networkAfterRestart.attach({
      subjectId: a.profile.subjectId,
      getCard: async () => cardA,
      handle: async (request) => ({
        exchangeId: request.exchangeId,
        fromSubjectId: request.toSubjectId,
        toSubjectId: request.fromSubjectId,
        at: request.at,
        decision: 'decline',
        reply: '本测试不处理协作请求。',
      }),
    });
    assert.equal(await networkAfterRestart.drainInbox(), 1);
    const activeA = await idA.getLocalProfile();
    assert.equal(activeA?.subjectId, a.profile.subjectId);
    assert.equal(activeA?.endpointId, 'ep_rotate_a_next');
    assert.equal((await idA.getLocalTransition())?.phase, 'active');

    // 再模拟一次：新端点已经激活、commit 已发出，但本机在收到 committed 前退出。
    const networkAfterActivation = createRelaySubjectNetwork({ packageRoot: dirA, cipher });
    assert.equal(await networkB.drainInbox(), 2);
    assert.equal(await idB.getPeer('ep_rotate_a_old'), null);
    assert.ok(await idB.getPeer('ep_rotate_a_next'));
    assert.equal(await idB.isPeerKeyRevoked(a.profile.subjectId, a.profile.keyId), true);
    const rotatedCard = (await networkB.listCards()).find(
      (card) => card.subjectId === a.profile.subjectId,
    );
    assert.equal(rotatedCard?.endpointRef, remoteEndpointRef('ep_rotate_a_next'));

    assert.equal(await networkAfterActivation.drainInbox(), 1);
    assert.equal(await idA.getLocalTransition(), null);

    // 已撤销旧 key 即使仍能构造密码学上有效的旧 wire，也不能再进入 B 的 inbox。
    const staleEnvelope = buildEnvelope({
      from: {
        subjectId: a.profile.subjectId,
        displayName: a.profile.displayName,
        endpointRef: remoteEndpointRef(a.profile.endpointId),
      },
      to: {
        subjectId: b.profile.subjectId,
        displayName: b.profile.displayName,
        endpointRef: remoteEndpointRef(b.profile.endpointId),
      },
      kind: 'identity_control',
      payload: {
        wire: 'endpoint_key_commit',
        transitionId: 'ktr_stale_old_key',
      },
    });
    const plaintext = JSON.stringify({
      version: staleEnvelope.version,
      envelopeId: staleEnvelope.envelopeId,
      from: staleEnvelope.from,
      to: staleEnvelope.to,
      kind: staleEnvelope.kind,
      createdAt: staleEnvelope.createdAt,
      payload: staleEnvelope.payload,
    });
    const sealed = sealForRecipient(b.profile.encPublicKey, plaintext);
    const signBytes = canonicalRelaySignBytes({
      envelopeId: staleEnvelope.envelopeId,
      fromEndpointId: a.profile.endpointId,
      toEndpointId: b.profile.endpointId,
      keyId: oldKeys!.keyId,
      createdAt: staleEnvelope.createdAt,
      sealedJson: sealedCanonicalJson(sealed),
    });
    const staleWire: RelayWireEnvelope = {
      version: 1,
      envelopeId: staleEnvelope.envelopeId,
      fromEndpointId: a.profile.endpointId,
      toEndpointId: b.profile.endpointId,
      keyId: oldKeys!.keyId,
      createdAt: staleEnvelope.createdAt,
      sealed,
      signatureB64: signRelayEnvelope(oldKeys!.signPrivatePem, signBytes),
      deliveryState: 'submitted',
    };
    await new RelayClient(relay.relayUrl).submit(staleWire);
    const rejected = await new RelayTransport({ packageRoot: dirB, cipher }).pullFromRelay();
    assert.deepEqual(rejected, { fetched: 0, rejected: 1 });

    networkA.stopPoll();
    networkB.stopPoll();
    detach();
    networkAfterRestart.stopPoll();
    networkAfterActivation.stopPoll();
  } finally {
    await closeServer(relay.server);
  }
});
