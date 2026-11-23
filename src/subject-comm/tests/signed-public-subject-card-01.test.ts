import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createTestCommCipher, CommIdentityStore } from '../identity-store';
import {
  remoteEndpointRef,
  SUBJECT_ENDPOINT_PROTOCOL,
  type PeerEndpointRecord,
} from '../endpoint';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createRelaySubjectNetwork } from '../../subject-collab/relay-network';
import { writePublicCard } from '../../subject-collab/public-card';
import {
  signPublicSubjectCard,
  verifySignedPublicSubjectCard,
  type SignedPublicSubjectCard,
} from '../../subject-collab/signed-public-card';
import type { PublicSubjectCard } from '../../subject-collab/types';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-signed-card-'));
  const identity = new CommIdentityStore(root, createTestCommCipher());
  const { profile } = await identity.ensureLocalEndpoint({
    subjectId: 'subj_bank_customer_01',
    displayName: '机构服务主体',
    relayUrl: 'https://relay.example.test',
    endpointId: 'ep_customer_device_01',
  });
  const expectedPeer: PeerEndpointRecord = { ...profile, pairedAt: '2026-11-22T00:00:00.000Z' };
  const card: PublicSubjectCard = {
    schemaVersion: 1,
    subjectId: profile.subjectId,
    displayName: profile.displayName,
    endpointRef: remoteEndpointRef(profile.endpointId),
    publicSkills: [{ name: '账户材料整理', summary: '按授权范围整理提交材料。' }],
    cooperationScope: '低风险材料整理与核对。',
    protocol: '2digime-subject-collab/1',
    reachable: true,
  };
  const signed = await signPublicSubjectCard({
    card,
    identity,
    issuedAt: '2026-11-22T08:00:00.000Z',
    expiresAt: '2026-11-23T08:00:00.000Z',
  });
  return { identity, expectedPeer, signed };
}

function clone(value: SignedPublicSubjectCard): SignedPublicSubjectCard {
  return JSON.parse(JSON.stringify(value)) as SignedPublicSubjectCard;
}

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

test('签名公开卡：正确绑定的主体、端点与 key 可以验证', async () => {
  const { expectedPeer, signed } = await fixture();
  const result = verifySignedPublicSubjectCard({
    signedCard: signed,
    expectedPeer,
    now: '2026-11-22T09:00:00.000Z',
  });
  assert.equal(result.ok, true);
  assert.equal(result.card?.subjectId, expectedPeer.subjectId);
});

test('签名公开卡：篡改声明后签名失效', async () => {
  const { expectedPeer, signed } = await fixture();
  const tampered = clone(signed);
  tampered.card.cooperationScope = '可以读取完整 Digital Self。';
  const result = verifySignedPublicSubjectCard({
    signedCard: tampered,
    expectedPeer,
    now: '2026-11-22T09:00:00.000Z',
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('signature_invalid'));
});

test('签名公开卡：过期、撤销 key、错误主体、端点与 key 均被拒绝', async () => {
  const { identity, expectedPeer, signed } = await fixture();

  const expired = verifySignedPublicSubjectCard({
    signedCard: signed,
    expectedPeer,
    now: '2026-11-24T00:00:00.000Z',
  });
  assert.ok(expired.reasons.includes('card_expired'));

  await identity.revokePeerKey({
    subjectId: expectedPeer.subjectId,
    keyId: expectedPeer.keyId,
    revokedAt: '2026-11-22T09:00:00.000Z',
  });
  const revokedKeyIds = await identity.listRevokedPeerKeyIds(expectedPeer.subjectId);
  assert.deepEqual(revokedKeyIds, [expectedPeer.keyId]);
  const revoked = verifySignedPublicSubjectCard({
    signedCard: signed,
    expectedPeer,
    revokedKeyIds,
    now: '2026-11-22T10:00:00.000Z',
  });
  assert.ok(revoked.reasons.includes('key_revoked'));

  const wrongSubject = verifySignedPublicSubjectCard({
    signedCard: signed,
    expectedPeer: { ...expectedPeer, subjectId: 'subj_other' },
    now: '2026-11-22T09:00:00.000Z',
  });
  assert.ok(wrongSubject.reasons.includes('subject_binding_mismatch'));

  const wrongEndpoint = verifySignedPublicSubjectCard({
    signedCard: signed,
    expectedPeer: { ...expectedPeer, endpointId: 'ep_replaced_without_pairing' },
    now: '2026-11-22T09:00:00.000Z',
  });
  assert.ok(wrongEndpoint.reasons.includes('endpoint_binding_mismatch'));

  const wrongKey = verifySignedPublicSubjectCard({
    signedCard: signed,
    expectedPeer: { ...expectedPeer, keyId: 'ck_untrusted_replacement' },
    now: '2026-11-22T09:00:00.000Z',
  });
  assert.ok(wrongKey.reasons.includes('key_binding_mismatch'));
});

test('签名公开卡：签发者不能用本机身份签另一个 Subject 或 Endpoint', async () => {
  const { identity, expectedPeer } = await fixture();
  const base: PublicSubjectCard = {
    schemaVersion: 1,
    subjectId: expectedPeer.subjectId,
    displayName: expectedPeer.displayName,
    endpointRef: remoteEndpointRef(expectedPeer.endpointId),
    publicSkills: [],
    cooperationScope: '低风险协作。',
    protocol: '2digime-subject-collab/1',
    reachable: true,
  };
  await assert.rejects(
    () => signPublicSubjectCard({ card: { ...base, subjectId: 'subj_forged' }, identity }),
    /subjectId/,
  );
  await assert.rejects(
    () => signPublicSubjectCard({ card: { ...base, endpointRef: 'dmep:ep_forged' }, identity }),
    /endpointRef/,
  );
});

test('签名公开卡：真实 Relay 只接收已配对端点签发的卡', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-signed-card-relay-'));
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
      subjectId: 'subj_signed_a',
      displayName: '签发主体 A',
      relayUrl: relay.relayUrl,
      endpointId: 'ep_signed_a',
    });
    const b = await idB.ensureLocalEndpoint({
      subjectId: 'subj_signed_b',
      displayName: '接收主体 B',
      relayUrl: relay.relayUrl,
      endpointId: 'ep_signed_b',
    });
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
    const cardA: PublicSubjectCard = {
      schemaVersion: 1,
      subjectId: a.profile.subjectId,
      displayName: a.profile.displayName,
      endpointRef: remoteEndpointRef(a.profile.endpointId),
      publicSkills: [{ name: '材料核验', summary: '核对明确授权的材料。' }],
      cooperationScope: '低风险材料核验。',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    };
    await writePublicCard(dirA, cardA);
    const networkA = createRelaySubjectNetwork({ packageRoot: dirA, cipher });
    const networkB = createRelaySubjectNetwork({ packageRoot: dirB, cipher });
    const detach = networkA.attach({
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
    try {
      await networkA.publishPublicCard();
      assert.equal(await networkB.drainInbox(), 1);
      const received = (await networkB.listCards()).find(
        (card) => card.subjectId === a.profile.subjectId,
      );
      assert.equal(received?.endpointRef, remoteEndpointRef(a.profile.endpointId));
      assert.equal(received?.publicSkills[0]?.name, '材料核验');
      const a2aCards = await networkB.listA2AAgentCards();
      const a2a = a2aCards.find((card) => card.name === a.profile.displayName);
      assert.equal(a2a?.supportedInterfaces[0]?.protocolBinding, '2DIGIME-RELAY');
      assert.equal(a2a?.supportedInterfaces[0]?.protocolVersion, '1.0');
      assert.equal(a2a?.skills[0]?.name, '材料核验');
      assert.equal(a2a?.signatures.length, 1);
    } finally {
      detach();
      networkA.stopPoll();
      networkB.stopPoll();
    }
  } finally {
    await closeServer(relay.server);
  }
});
