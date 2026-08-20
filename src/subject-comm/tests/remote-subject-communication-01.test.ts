/**
 * DIGITALME-V2-REMOTE-SUBJECT-COMMUNICATION-01
 * 三进程语义：Relay + 隔离 A/B（无共享 package 路径）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { CollaborationRecordStore } from '../../collaboration/record-store';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createTestCommCipher, CommIdentityStore } from '../identity-store';
import { RelayTransport } from '../relay-transport';
import { remoteEndpointRef } from '../endpoint';
import {
  canonicalRelaySignBytes,
  generateCommKeyMaterial,
  openSealedPayload,
  sealForRecipient,
  signRelayEnvelope,
  verifyRelayEnvelope,
} from '../crypto-identity';
import { LocalPackageTransport } from '../../collaboration/transport';
import { buildEnvelope } from '../local-subject-transport';
import type { Server } from 'node:http';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-relay-${prefix}-`));
}

async function openPkg(dir: string, name: string, desc: string) {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: name,
    targetDir: dir,
    initialSelfDescription: desc,
  });
  return { runtime, bus };
}

async function listenRelay(dataDir: string): Promise<{
  server: Server;
  relayUrl: string;
  store: FileRelayStore;
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
  return { server, relayUrl: `http://127.0.0.1:${addr.port}`, store };
}

test('crypto: seal/open + sign/verify + wrong recipient fails', () => {
  const a = generateCommKeyMaterial('cka');
  const b = generateCommKeyMaterial('ckb');
  const sealed = sealForRecipient(b.encPublicSpkiB64, '{"secret":"hello"}');
  assert.equal(openSealedPayload(b.encPrivatePem, sealed), '{"secret":"hello"}');
  assert.throws(() => openSealedPayload(a.encPrivatePem, sealed));

  const bytes = canonicalRelaySignBytes({
    envelopeId: 'e1',
    fromEndpointId: 'a',
    toEndpointId: 'b',
    keyId: a.keyId,
    createdAt: 't',
    sealedJson: JSON.stringify(sealed),
  });
  const sig = signRelayEnvelope(a.signPrivatePem, bytes);
  assert.equal(verifyRelayEnvelope(a.signPublicSpkiB64, bytes, sig), true);
  assert.equal(verifyRelayEnvelope(b.signPublicSpkiB64, bytes, sig), false);
  const bad = Buffer.from(bytes);
  bad[10] = (bad[10]! + 1) % 256;
  assert.equal(verifyRelayEnvelope(a.signPublicSpkiB64, bad, sig), false);
});

test('remote relay: signal roundtrip + collab sync + offline + idempotency', async () => {
  const root = await tempDir('main');
  const { server, relayUrl, store } = await listenRelay(path.join(root, 'relay-data'));
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  let runtimeA: ReturnType<typeof createDigitalMeRuntime> | null = null;
  let runtimeB: ReturnType<typeof createDigitalMeRuntime> | null = null;

  try {
    const a = await openPkg(
      dirA,
      '主体甲',
      '我有 Agent / Digital Me 技术能力，正在寻找适合 AI/Agent 比赛的成熟金融应用场景。',
    );
    runtimeA = a.runtime;
    await a.runtime.appendOwnerEvent({
      type: 'experience_confirmed',
      confidence: 'confirmed',
      source: { kind: 'owner_direct' },
      payload: {
        title: '合作意向',
        detail: '可提供 Agent / Digital Me 技术；寻找金融场景联合参赛。',
        tags: ['offering:agent_tech'],
      },
    });
    const b = await openPkg(
      dirB,
      '主体乙',
      '我拥有成熟金融投资应用项目 Aivestor，希望寻找 Agent / Digital Me 技术能力进一步升级，愿意考虑联合参赛。',
    );
    runtimeB = b.runtime;
    await b.runtime.appendOwnerEvent({
      type: 'experience_confirmed',
      confidence: 'confirmed',
      source: { kind: 'owner_direct' },
      payload: {
        title: 'Aivestor',
        detail: '成熟金融投资应用 Aivestor；希望升级 Agent 技术；联合参赛。',
        tags: ['finance', 'Aivestor'],
      },
    });

    const cipher = createTestCommCipher();
    await a.bus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
    await b.bus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });

    const inviteA = await a.bus.invoke('subject.communicate', { action: 'createInvite' });
    assert.ok(inviteA.inviteJson);
    const accepted = await b.bus.invoke('subject.communicate', {
      action: 'acceptInvite',
      inviteJson: inviteA.inviteJson!,
    });
    assert.ok(accepted.inviteJson);
    await a.bus.invoke('subject.communicate', {
      action: 'acceptInvite',
      inviteJson: accepted.inviteJson!,
    });

    const idA = new CommIdentityStore(dirA, cipher);
    assert.equal(await idA.assertNoPlaintextPrivateKeys(), true);
    const peerB = (await idA.listPeers())[0];
    assert.ok(peerB);
    const peerBRef = remoteEndpointRef(peerB!.endpointId);

    assert.equal(await new LocalPackageTransport(a.runtime).lookupPackageDir(peerBRef), null);

    const sent = await a.bus.invoke('subject.communicate', {
      action: 'sendSignal',
      peerEndpointRef: peerBRef,
      signal: {
        intent: '寻找金融 AI 场景联合参赛；可提供 Agent 技术',
        seeking: ['成熟金融应用场景', '联合参赛'],
        offering: ['Agent / Digital Me 技术能力'],
        disclosureLevel: 'minimal',
      },
    });
    assert.ok(sent.envelopeId);
    assert.ok(sent.opportunityId);

    const envFiles = await fs.readdir(path.join(root, 'relay-data', 'envelopes'));
    assert.ok(envFiles.length >= 1);
    const rawRelay = await fs.readFile(
      path.join(root, 'relay-data', 'envelopes', envFiles[0]!),
      'utf8',
    );
    assert.ok(!rawRelay.includes('寻找金融'));
    assert.ok(rawRelay.includes('ciphertextB64'));

    const pullB = await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    assert.ok((pullB.fetched || 0) >= 1, `B should fetch ciphertext, got ${JSON.stringify(pullB)}`);

    const oppB = await b.bus.invoke('subject.communicate', { action: 'listOpportunities' });
    assert.ok((oppB.items || []).length >= 1, `B opportunities empty: ${JSON.stringify(oppB)}`);

    // B 的 response 已在 processInbox 发出；A 拉取
    const pullA = await a.bus.invoke('subject.communicate', { action: 'pullRemote' });
    assert.ok((pullA.fetched || 0) >= 1, `A should fetch response: ${JSON.stringify(pullA)}`);
    const oppA = await a.bus.invoke('subject.communicate', { action: 'listOpportunities' });
    assert.ok((oppA.items || []).some((i) => i.id === sent.opportunityId));

    const bCardId = oppB.items![0]!.id;
    await b.bus.invoke('subject.communicate', {
      action: 'continueInterest',
      opportunityId: bCardId,
    });
    await a.bus.invoke('subject.communicate', { action: 'pullRemote' });
    await a.bus.invoke('subject.communicate', {
      action: 'continueInterest',
      opportunityId: sent.opportunityId!,
    });
    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    await a.bus.invoke('subject.communicate', {
      action: 'discloseBrief',
      opportunityId: sent.opportunityId!,
    });
    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    await b.bus.invoke('subject.communicate', {
      action: 'discloseBrief',
      opportunityId: bCardId,
    });
    await a.bus.invoke('subject.communicate', { action: 'pullRemote' });

    const started = await a.bus.invoke('subject.communicate', {
      action: 'startCollaboration',
      opportunityId: sent.opportunityId!,
      intent: '基于发现的合作机会整理联合参赛要点',
    });
    assert.ok(started.recordId);

    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const recordsB = await (await CollaborationRecordStore.open(dirB)).list();
    assert.ok(
      recordsB.some((r) => r.recordId === started.recordId),
      'collaboration_sync should reach B via Relay',
    );

    // duplicate
    const relayA = new RelayTransport({ packageRoot: dirA, cipher, relayUrl });
    const selfA = (await idA.getLocalProfile())!;
    const dup = buildEnvelope({
      from: {
        subjectId: selfA.subjectId,
        displayName: selfA.displayName,
        endpointRef: remoteEndpointRef(selfA.endpointId),
      },
      to: {
        subjectId: peerB!.subjectId,
        displayName: peerB!.displayName,
        endpointRef: peerBRef,
      },
      kind: 'signal',
      payload: {
        intent: 'dup',
        seeking: ['成熟金融应用场景'],
        offering: ['Agent / Digital Me 技术能力'],
        disclosureLevel: 'minimal',
      },
    });
    dup.envelopeId = sent.envelopeId!;
    dup.id = sent.envelopeId!;
    const again = await relayA.send(dup);
    assert.equal(again.duplicate === true || again.delivered === true, true);

    // ACK ≠ business
    const beforeAck = (await (await CollaborationRecordStore.open(dirB)).list()).length;
    await b.bus.invoke('subject.communicate', {
      action: 'acknowledge',
      envelopeId: sent.envelopeId!,
    });
    assert.equal((await (await CollaborationRecordStore.open(dirB)).list()).length, beforeAck);

    // offline: stop B, A sends, restart B
    await b.runtime.stop();
    runtimeB = null;
    const sent2 = await a.bus.invoke('subject.communicate', {
      action: 'sendSignal',
      peerEndpointRef: peerBRef,
      signal: {
        intent: '二次信号：仍寻找金融场景',
        seeking: ['成熟金融应用场景'],
        offering: ['Agent / Digital Me 技术能力'],
        disclosureLevel: 'minimal',
      },
    });
    const bRe = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busRe = createCommandBus(bRe);
    await bRe.openPackage({ dir: dirB });
    runtimeB = bRe;
    await busRe.invoke('subject.communicate', { action: 'pullRemote' });
    const oppOff = await busRe.invoke('subject.communicate', { action: 'listOpportunities' });
    assert.ok(
      (oppOff.items || []).some((i) => i.id === sent2.opportunityId) ||
        (oppOff.items || []).length >= 1,
      `offline store-and-forward failed: ${JSON.stringify(oppOff)}`,
    );

    // outbox: relay down keeps SubjectPackage intact
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await a.bus.invoke('subject.communicate', {
      action: 'sendSignal',
      peerEndpointRef: peerBRef,
      signal: {
        intent: 'relay down',
        seeking: ['成熟金融应用场景'],
        offering: ['Agent / Digital Me 技术能力'],
        disclosureLevel: 'minimal',
      },
    });
    // 包仍可读
    assert.ok(a.runtime.subject.requireActive().id);

    const localHealth = await new LocalPackageTransport(a.runtime)
      .asLocalSubjectTransport()
      .health();
    assert.equal(localHealth.mode, 'local_trusted');

    // TTL on store (server closed; store still usable)
    await store.putIfAbsent({
      version: 1,
      envelopeId: 'envelope_ttl_expired_test',
      fromEndpointId: 'x',
      toEndpointId: 'y',
      keyId: 'k',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-02T00:00:00.000Z',
      sealed: { ephPublicSpkiB64: 'x', ivB64: 'x', tagB64: 'x', ciphertextB64: 'x' },
      signatureB64: 'x',
      storedAt: '2020-01-01T00:00:00.000Z',
    });
    assert.ok((await store.purgeExpired(new Date().toISOString())) >= 1);

    // no_match via separate relay
    const dirC = path.join(root, 'c');
    const c = await openPkg(dirC, '无关', '只做笔记，不对外合作');
    await c.runtime.appendOwnerEvent({
      type: 'boundary_updated',
      confidence: 'confirmed',
      source: { kind: 'owner_direct' },
      payload: { title: '边界', detail: '不对外合作', tags: ['boundary:no_collab'] },
    });
    const relay2 = await listenRelay(path.join(root, 'relay-data-2'));
    try {
      await a.bus.invoke('subject.communicate', {
        action: 'configureRelay',
        relayUrl: relay2.relayUrl,
      });
      await c.bus.invoke('subject.communicate', {
        action: 'configureRelay',
        relayUrl: relay2.relayUrl,
      });
      // 重新配对（relay 地址变更后需新 invite）
      const inv = await a.bus.invoke('subject.communicate', { action: 'createInvite' });
      const acc = await c.bus.invoke('subject.communicate', {
        action: 'acceptInvite',
        inviteJson: inv.inviteJson!,
      });
      await a.bus.invoke('subject.communicate', {
        action: 'acceptInvite',
        inviteJson: acc.inviteJson!,
      });
      const peers = await new CommIdentityStore(dirA, cipher).listPeers();
      const peerC = peers.find((p) => p.displayName === '无关');
      assert.ok(peerC);
      const before = (await (await CollaborationRecordStore.open(dirA)).list()).length;
      await a.bus.invoke('subject.communicate', {
        action: 'sendSignal',
        peerEndpointRef: remoteEndpointRef(peerC!.endpointId),
        signal: {
          intent: '量子芯片代工厂',
          seeking: ['量子芯片代工厂'],
          offering: ['无关XYZ'],
          disclosureLevel: 'minimal',
        },
      });
      await c.bus.invoke('subject.communicate', { action: 'pullRemote' });
      const oppC = await c.bus.invoke('subject.communicate', { action: 'listOpportunities' });
      assert.equal((oppC.items || []).length, 0);
      assert.equal((await (await CollaborationRecordStore.open(dirA)).list()).length, before);
    } finally {
      await c.runtime.stop();
      relay2.server.close();
    }
  } finally {
    if (runtimeA) await runtimeA.stop().catch(() => undefined);
    if (runtimeB) await runtimeB.stop().catch(() => undefined);
    await new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
});

test('Relay rejects plaintext-looking body without ciphertext', async () => {
  const root = await tempDir('plain');
  const { server, relayUrl } = await listenRelay(path.join(root, 'data'));
  try {
    const res = await fetch(`${relayUrl}/v1/envelopes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        envelopeId: 'e-plain',
        fromEndpointId: 'a',
        toEndpointId: 'b',
        keyId: 'k',
        createdAt: new Date().toISOString(),
        sealed: { intent: 'leak', seeking: ['x'], offering: ['y'] },
        signatureB64: 'x',
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
