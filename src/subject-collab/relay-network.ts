/**
 * 配对目录 + Relay/E2EE 上的 SubjectCollabNetwork。
 * 不持有对方 runtime 引用；不打开对方 Package。
 */
import { nowIso } from '../shared/ids';
import type { CipherAdapter } from '../infrastructure/secret-store';
import type { SubjectRef } from '../collaboration/schema';
import { CommIdentityStore } from '../subject-comm/identity-store';
import { RelayTransport } from '../subject-comm/relay-transport';
import { buildEnvelope } from '../subject-comm/local-subject-transport';
import {
  isSubjectCollabPayload,
  type SubjectCollabPayload,
  type SubjectEnvelope,
} from '../subject-comm/envelope';
import { remoteEndpointRef } from '../subject-comm/endpoint';
import type { AttachedSubject, SubjectCollabNetwork } from './network';
import type { CollaborationRequest, CollaborationResponse, PublicSubjectCard } from './types';
import { readPeerCard, readPublicCard, sanitizePublicCard, writePeerCard } from './public-card';

const UNREACHABLE = '对方当前不可达。';

export const RELAY_COLLAB_UNREACHABLE = UNREACHABLE;

export interface RelaySubjectNetwork extends SubjectCollabNetwork {
  publishPublicCard(): Promise<void>;
  drainInbox(): Promise<number>;
  start(pollMs?: number): void;
  stopPoll(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRequest(raw: unknown): CollaborationRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const exchangeId = String(o.exchangeId || '').trim();
  const fromSubjectId = String(o.fromSubjectId || '').trim();
  const toSubjectId = String(o.toSubjectId || '').trim();
  if (!exchangeId || !fromSubjectId || !toSubjectId) return null;
  return {
    exchangeId,
    fromSubjectId,
    toSubjectId,
    at: String(o.at || ''),
    goal: String(o.goal || ''),
    hopedContribution: String(o.hopedContribution || ''),
    disclosure: String(o.disclosure || ''),
    threadId: String(o.threadId || ''),
  };
}

function parseResponse(raw: unknown, exchangeId: string): CollaborationResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const decision = o.decision;
  if (
    decision !== 'accept' &&
    decision !== 'decline' &&
    decision !== 'clarify' &&
    decision !== 'alternative'
  ) {
    return null;
  }
  return {
    exchangeId: String(o.exchangeId || exchangeId),
    fromSubjectId: String(o.fromSubjectId || ''),
    toSubjectId: String(o.toSubjectId || ''),
    at: String(o.at || nowIso()),
    decision,
    reply: String(o.reply || ''),
    ...(typeof o.contribution === 'string' && o.contribution
      ? { contribution: o.contribution }
      : {}),
    ...(o.usedOwnCapability ? { usedOwnCapability: true } : {}),
    ...(typeof o.evidenceDigest === 'string' && o.evidenceDigest
      ? { evidenceDigest: o.evidenceDigest }
      : {}),
  };
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

  const drainNow = async (): Promise<number> => {
    const items = await relay.listInbox({ unreadOnly: true });
    let processed = 0;
    for (const env of items) {
      if (env.kind !== 'subject_collab' || !isSubjectCollabPayload(env.payload)) continue;
      const payload = env.payload;
      try {
        if (payload.wire === 'public_card') {
          const peer = (await identity.listPeers()).find((item) => item.subjectId === env.from.subjectId);
          const card = sanitizePublicCard(payload.card, {
            subjectId: env.from.subjectId,
            displayName: env.from.displayName,
            endpointRef: env.from.endpointRef,
          });
          if (card && peer) {
            await writePeerCard(input.packageRoot, {
              ...card,
              subjectId: peer.subjectId,
              endpointRef: remoteEndpointRef(peer.endpointId),
            });
          }
          await relay.acknowledge(env.envelopeId);
          processed += 1;
          continue;
        }
        if (payload.wire === 'collab_response') {
          const exchangeId = String(payload.exchangeId || env.correlationId || '');
          const parsed = parseResponse(payload.response, exchangeId);
          if (parsed && exchangeId) pending.set(exchangeId, parsed);
          await relay.acknowledge(env.envelopeId);
          processed += 1;
          continue;
        }
        if (payload.wire === 'collab_request') {
          const request = parseRequest(payload.request);
          if (!request || !local) {
            await relay.acknowledge(env.envelopeId);
            processed += 1;
            continue;
          }
          const response = await local.handle(request);
          await sendPayload(
            env.from,
            {
              wire: 'collab_response',
              exchangeId: request.exchangeId,
              response: { ...response },
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
    async deliver(request) {
      const peers = await identity.listPeers();
      const peer = peers.find((item) => item.subjectId === request.toSubjectId);
      if (!peer) return unreachableResponse(request);
      const health = await relay.health();
      if (!health.reachable) return unreachableResponse(request);
      const sent = await sendPayload(
        {
          subjectId: peer.subjectId,
          displayName: peer.displayName,
          endpointRef: remoteEndpointRef(peer.endpointId),
        },
        {
          wire: 'collab_request',
          exchangeId: request.exchangeId,
          request: { ...request },
        },
        request.exchangeId,
      );
      if (!sent.delivered) return unreachableResponse(request);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        await drainInbox().catch(() => 0);
        const hit = pending.get(request.exchangeId);
        if (hit) {
          pending.delete(request.exchangeId);
          return hit;
        }
        await sleep(80);
      }
      return unreachableResponse(request);
    },
    async publishPublicCard() {
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
      const peers = await identity.listPeers();
      for (const peer of peers) {
        await sendPayload(
          {
            subjectId: peer.subjectId,
            displayName: peer.displayName,
            endpointRef: remoteEndpointRef(peer.endpointId),
          },
          { wire: 'public_card', card: { ...card } },
        );
      }
    },
    drainInbox,
    start(pollMs = 200) {
      if (pollTimer) return;
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
