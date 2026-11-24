/**
 * 配对目录 + Relay/E2EE 上的 SubjectCollabNetwork。
 * 不持有对方 runtime 引用；不打开对方 Package。
 */
import type { AgentCard as A2AAgentCard } from '@a2a-js/sdk';
import type { CipherAdapter } from '../infrastructure/secret-store';
import type { SubjectRef } from '../collaboration/schema';
import { CommIdentityStore } from '../subject-comm/identity-store';
import { RelayTransport } from '../subject-comm/relay-transport';
import { buildEnvelope } from '../subject-comm/local-subject-transport';
import {
  isIdentityControlPayload,
  isSubjectCollabPayload,
  type IdentityControlPayload,
  type SubjectCollabPayload,
  type SubjectEnvelope,
} from '../subject-comm/envelope';
import { parseRemoteEndpointRef, remoteEndpointRef } from '../subject-comm/endpoint';
import type { AttachedSubject, SubjectCollabDeliveryResult, SubjectCollabNetwork } from './network';
import type { CollaborationRequest, CollaborationResponse, PublicSubjectCard } from './types';
import { bodyDigest } from './exchange-store';
import { readPeerCard, readPublicCard, sanitizePublicCard, writePeerCard } from './public-card';
import { signPublicSubjectCard, verifySignedPublicSubjectCard } from './signed-public-card';
import {
  DIGITALME_A2A_RELAY_BINDING,
  a2aAgentCardToJSON,
  a2aMessageToJSON,
  a2aTaskToJSON,
  collaborationRequestFromA2AMessage,
  collaborationRequestToA2AMessage,
  collaborationResponseFromA2ATask,
  collaborationResponseToA2ATask,
  createSignedA2AAgentCard,
  readPeerA2AAgentCard,
  verifyA2AAgentCard,
  writePeerA2AAgentCard,
} from './a2a-subject-mapping';

const UNREACHABLE = '对方当前不可达。';

export const RELAY_COLLAB_UNREACHABLE = UNREACHABLE;

export interface RelaySubjectNetwork extends SubjectCollabNetwork {
  deliverWithReceipt(request: CollaborationRequest): Promise<SubjectCollabDeliveryResult>;
  publishPublicCard(): Promise<void>;
  listA2AAgentCards(exceptSubjectId?: string): Promise<A2AAgentCard[]>;
  drainInbox(): Promise<number>;
  beginIdentityTransition(input?: {
    endpointId?: string;
    relayUrl?: string;
  }): Promise<{ transitionId: string; phase: 'preparing' | 'active' | 'complete' }>;
  resumeIdentityTransition(): Promise<{
    transitionId?: string;
    phase: 'idle' | 'preparing' | 'active' | 'complete';
  }>;
  start(pollMs?: number): void;
  stopPoll(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unreachableResponse(request: CollaborationRequest): CollaborationResponse {
  return {
    exchangeId: request.exchangeId,
    fromSubjectId: request.toSubjectId,
    toSubjectId: request.fromSubjectId,
    at: request.at,
    decision: 'decline',
    reply: UNREACHABLE,
  };
}

export function createRelaySubjectNetwork(input: {
  packageRoot: string;
  cipher: CipherAdapter;
}): RelaySubjectNetwork {
  const identity = new CommIdentityStore(input.packageRoot, input.cipher);
  const relay = new RelayTransport({
    packageRoot: input.packageRoot,
    cipher: input.cipher,
  });
  let local: AttachedSubject | null = null;
  const pending = new Map<string, CollaborationResponse>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let draining = Promise.resolve(0);

  const selfRef = async (): Promise<SubjectRef | null> => {
    const profile = await identity.getLocalProfile();
    if (!profile) return null;
    return {
      subjectId: profile.subjectId,
      displayName: profile.displayName,
      endpointRef: remoteEndpointRef(profile.endpointId),
    };
  };

  const sendPayload = async (to: SubjectRef, payload: SubjectCollabPayload, correlationId?: string) => {
    const from = await selfRef();
    if (!from) return { delivered: false };
    const envelope = buildEnvelope({
      from,
      to,
      kind: 'subject_collab',
      payload,
      ...(correlationId ? { correlationId } : {}),
    });
    envelope.transportMeta = { mode: 'remote', encrypted: true };
    return relay.send(envelope);
  };

  const sendIdentityPayload = async (to: SubjectRef, payload: IdentityControlPayload) => {
    const from = await selfRef();
    if (!from) return { delivered: false };
    const envelope = buildEnvelope({
      from,
      to,
      kind: 'identity_control',
      payload,
      correlationId: payload.transitionId,
    });
    envelope.transportMeta = { mode: 'remote', encrypted: true };
    return relay.send(envelope);
  };

  const resumeIdentityTransition = async (): Promise<{
    transitionId?: string;
    phase: 'idle' | 'preparing' | 'active' | 'complete';
  }> => {
    let transition = await identity.getLocalTransition();
    if (!transition) return { phase: 'idle' };
    const transitionId = transition.proof.statement.transitionId;
    if (transition.phase === 'preparing') {
      const readyPeerEndpointIds = transition.readyPeerEndpointIds;
      const missingReady = transition.requiredPeerEndpointIds.filter(
        (id) => !readyPeerEndpointIds.includes(id),
      );
      for (const endpointId of missingReady) {
        const peer = await identity.getPeer(endpointId);
        if (!peer) continue;
        await sendIdentityPayload(identity.toSubjectRef(peer), {
          wire: 'endpoint_key_prepare',
          transitionId,
          proof: transition.proof,
        });
      }
      if (missingReady.length) return { transitionId, phase: 'preparing' };
      transition = await identity.activateLocalTransition();
    }
    const missingCommitted = transition.requiredPeerEndpointIds.filter(
      (id) => !transition.committedPeerEndpointIds.includes(id),
    );
    for (const endpointId of missingCommitted) {
      const peer = await identity.getPeer(endpointId);
      if (!peer) continue;
      await sendIdentityPayload(identity.toSubjectRef(peer), {
        wire: 'endpoint_key_commit',
        transitionId,
      });
    }
    if (missingCommitted.length) return { transitionId, phase: 'active' };
    const completed = await identity.finalizeLocalTransition();
    return { transitionId, phase: completed ? 'complete' : 'active' };
  };

  const publishPublicCard = async (): Promise<void> => {
    if (!local) return;
    const from = await selfRef();
    if (!from) return;
    const own = await readPublicCard(input.packageRoot, local.subjectId, from.displayName);
    const card = {
      ...own,
      subjectId: local.subjectId,
      displayName: from.displayName,
      endpointRef: from.endpointRef,
      reachable: true,
    };
    const signedCard = await signPublicSubjectCard({ card, identity });
    const a2aCard = await createSignedA2AAgentCard({ card, identity });
    const peers = await identity.listPeers();
    for (const peer of peers) {
      await sendPayload(
        {
          subjectId: peer.subjectId,
          displayName: peer.displayName,
          endpointRef: remoteEndpointRef(peer.endpointId),
        },
        {
          wire: 'public_card',
          card: {
            legacySignedCard: signedCard,
            a2aAgentCard: await a2aAgentCardToJSON(a2aCard),
          },
        },
      );
    }
  };

  const drainNow = async (): Promise<number> => {
    const items = await relay.listInbox({ unreadOnly: true });
    let processed = 0;
    for (const env of items) {
      if (env.kind === 'identity_control' && isIdentityControlPayload(env.payload)) {
        const control = env.payload;
        try {
          const fromEndpointId = parseRemoteEndpointRef(env.from.endpointRef);
          if (!fromEndpointId) continue;
          if (control.wire === 'endpoint_key_prepare') {
            if (!control.proof || control.proof.statement.transitionId !== control.transitionId) {
              continue;
            }
            await identity.acceptPeerTransition({
              proof: control.proof,
              fromEndpointId,
            });
            await sendIdentityPayload(env.from, {
              wire: 'endpoint_key_ready',
              transitionId: control.transitionId,
            });
          } else if (control.wire === 'endpoint_key_ready') {
            await identity.markLocalTransitionReady(control.transitionId, fromEndpointId);
          } else if (control.wire === 'endpoint_key_commit') {
            await identity.commitPeerTransition({
              transitionId: control.transitionId,
              fromEndpointId,
            });
            await sendIdentityPayload(env.from, {
              wire: 'endpoint_key_committed',
              transitionId: control.transitionId,
            });
          } else if (control.wire === 'endpoint_key_committed') {
            await identity.markLocalTransitionCommitted(control.transitionId, fromEndpointId);
          }
          // ready 必须先以旧 profile ACK；随后才允许 resume 激活新端点。
          await relay.acknowledge(env.envelopeId);
          processed += 1;
        } catch {
          /* 无效证明或不匹配端点不得 ACK；保留用于诊断/恢复。 */
        }
        continue;
      }
      if (env.kind !== 'subject_collab' || !isSubjectCollabPayload(env.payload)) continue;
      const payload = env.payload;
      try {
        if (payload.wire === 'public_card') {
          const fromEndpointId = parseRemoteEndpointRef(env.from.endpointRef);
          const peer = (await identity.listPeers()).find(
            (item) =>
              item.subjectId === env.from.subjectId && item.endpointId === fromEndpointId,
          );
          if (peer) {
            const cardEnvelope = payload.card || {};
            const legacySignedCard =
              cardEnvelope.legacySignedCard && typeof cardEnvelope.legacySignedCard === 'object'
                ? cardEnvelope.legacySignedCard
                : null;
            const a2aAgentCard = cardEnvelope.a2aAgentCard;
            const verified = verifySignedPublicSubjectCard({
              signedCard: legacySignedCard,
              expectedPeer: peer,
              revokedKeyIds: await identity.listRevokedPeerKeyIds(peer.subjectId),
            });
            const a2aVerified = await verifyA2AAgentCard({
              card: a2aAgentCard,
              expectedPeer: peer,
              revokedKeyIds: await identity.listRevokedPeerKeyIds(peer.subjectId),
              expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
            });
            if (
              verified.ok &&
              verified.card &&
              a2aVerified.ok &&
              a2aVerified.card &&
              a2aVerified.publicCard &&
              JSON.stringify(verified.card) === JSON.stringify(a2aVerified.publicCard)
            ) {
              await writePeerCard(input.packageRoot, a2aVerified.publicCard);
              await writePeerA2AAgentCard(input.packageRoot, peer.subjectId, a2aVerified.card);
            }
          }
          await relay.acknowledge(env.envelopeId);
          processed += 1;
          continue;
        }
        if (payload.wire === 'collab_response') {
          const exchangeId = String(payload.exchangeId || env.correlationId || '');
          const parsed = await collaborationResponseFromA2ATask({
            task: payload.response,
            expectedExchangeId: exchangeId,
            expectedFromSubjectId: env.from.subjectId,
            expectedToSubjectId: env.to.subjectId,
          });
          if (parsed && exchangeId) pending.set(exchangeId, parsed);
          await relay.acknowledge(env.envelopeId);
          processed += 1;
          continue;
        }
        if (payload.wire === 'collab_request') {
          const request = await collaborationRequestFromA2AMessage({
            message: payload.request,
            expectedFromSubjectId: env.from.subjectId,
            expectedToSubjectId: env.to.subjectId,
          });
          if (!request || !local) {
            await relay.acknowledge(env.envelopeId);
            processed += 1;
            continue;
          }
          const response = await local.handle(request, {
            recipientEndpointRef: env.to.endpointRef,
            actualBody: JSON.stringify(payload.request),
          });
          await sendPayload(
            env.from,
            {
              wire: 'collab_response',
              exchangeId: request.exchangeId,
              response: await a2aTaskToJSON(collaborationResponseToA2ATask(response, request.threadId)),
            },
            request.exchangeId,
          );
          await relay.acknowledge(env.envelopeId);
          processed += 1;
        }
      } catch {
        /* 保留未 ACK 以便重试 */
      }
    }
    const beforeResume = await identity.getLocalTransition();
    const progress = await resumeIdentityTransition();
    if (beforeResume?.phase === 'preparing' && progress.phase === 'active') {
      await publishPublicCard();
    }
    return processed;
  };

  const drainInbox = (): Promise<number> => {
    const run = draining.then(drainNow, drainNow);
    draining = run.then(
      () => 0,
      () => 0,
    );
    return run;
  };

  const network: RelaySubjectNetwork = {
    attach(peer) {
      local = peer;
      return () => {
        if (local === peer) local = null;
      };
    },
    async beginIdentityTransition(options = {}) {
      const transition = await identity.prepareLocalTransition(options);
      const progress = await resumeIdentityTransition();
      return {
        transitionId: transition.proof.statement.transitionId,
        phase: progress.phase === 'idle' ? 'preparing' : progress.phase,
      };
    },
    resumeIdentityTransition,
    async listA2AAgentCards(exceptSubjectId) {
      await drainInbox().catch(() => 0);
      const peers = await identity.listPeers();
      const cards: A2AAgentCard[] = [];
      for (const peer of peers) {
        if (peer.subjectId === exceptSubjectId) continue;
        const card = await readPeerA2AAgentCard(input.packageRoot, peer.subjectId);
        if (!card) continue;
        const verified = await verifyA2AAgentCard({
          card: await a2aAgentCardToJSON(card),
          expectedPeer: peer,
          revokedKeyIds: await identity.listRevokedPeerKeyIds(peer.subjectId),
          expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
        });
        if (verified.ok && verified.card) cards.push(verified.card);
      }
      return cards;
    },
    async listCards(exceptSubjectId) {
      await drainInbox().catch(() => 0);
      const profile = await identity.getLocalProfile();
      const peers = await identity.listPeers();
      const health = await relay.health();
      const cards: PublicSubjectCard[] = [];
      for (const peer of peers) {
        if (peer.subjectId === exceptSubjectId || peer.subjectId === profile?.subjectId) continue;
        const endpointRef = remoteEndpointRef(peer.endpointId);
        const cached = await readPeerCard(input.packageRoot, peer.subjectId);
        const card =
          cached ||
          sanitizePublicCard(
            {
              schemaVersion: 1,
              displayName: peer.displayName,
              publicSkills: [],
              cooperationScope: '低风险知识与判断合作。',
            },
            { subjectId: peer.subjectId, displayName: peer.displayName, endpointRef },
          );
        if (!card) continue;
        cards.push({
          ...card,
          subjectId: peer.subjectId,
          endpointRef,
          reachable: health.reachable,
        });
      }
      return cards;
    },
    async deliverWithReceipt(request): Promise<SubjectCollabDeliveryResult> {
      const message = collaborationRequestToA2AMessage(request);
      const wireRequest = await a2aMessageToJSON(message);
      const actualBody = JSON.stringify(wireRequest);
      const baseReceipt = {
        delivered: false,
        recipientEndpointRef: '',
        actualBodyDigest: bodyDigest(actualBody),
        actualBytes: Buffer.byteLength(actualBody, 'utf8'),
      };
      const peers = await identity.listPeers();
      const peer = peers.find((item) => item.subjectId === request.toSubjectId);
      if (!peer) return { response: unreachableResponse(request), receipt: baseReceipt };
      const endpointRef = remoteEndpointRef(peer.endpointId);
      const health = await relay.health();
      if (!health.reachable) {
        return {
          response: unreachableResponse(request),
          receipt: { ...baseReceipt, recipientEndpointRef: endpointRef },
        };
      }
      const sent = await sendPayload(
        {
          subjectId: peer.subjectId,
          displayName: peer.displayName,
          endpointRef,
        },
        {
          wire: 'collab_request',
          exchangeId: request.exchangeId,
          request: wireRequest,
        },
        request.exchangeId,
      );
      if (!sent.delivered) {
        return {
          response: unreachableResponse(request),
          receipt: { ...baseReceipt, recipientEndpointRef: endpointRef },
        };
      }
      const receipt = {
        ...baseReceipt,
        delivered: true,
        recipientEndpointRef: endpointRef,
      };
      const waitMs = Number(process.env.DIGITALME_COLLAB_RESPONSE_WAIT_MS);
      const budget = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 45_000;
      const deadline = Date.now() + budget;
      while (Date.now() < deadline) {
        await drainInbox().catch(() => 0);
        const hit = pending.get(request.exchangeId);
        if (hit) {
          pending.delete(request.exchangeId);
          return { response: hit, receipt };
        }
        await sleep(80);
      }
      return { response: unreachableResponse(request), receipt };
    },
    async deliver(request) {
      return (await network.deliverWithReceipt(request)).response;
    },
    publishPublicCard,
    drainInbox,
    start(pollMs = 800) {
      if (pollTimer) return;
      void drainInbox();
      pollTimer = setInterval(() => {
        void drainInbox();
      }, pollMs);
      if (typeof pollTimer === 'object' && 'unref' in pollTimer) pollTimer.unref();
    },
    stopPoll() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
  };
  return network;
}

export function isRelayCollabEnvelope(env: SubjectEnvelope): boolean {
  return env.kind === 'subject_collab' && isSubjectCollabPayload(env.payload);
}
