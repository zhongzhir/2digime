import type {
  CollaborationDeliveryMeta,
  CollaborationDeliveryReceipt,
  CollaborationRequest,
  CollaborationResponse,
  PublicSubjectCard,
} from './types';
import { bodyDigest } from './exchange-store';

export interface AttachedSubject {
  subjectId: string;
  getCard: () => Promise<PublicSubjectCard>;
  handle: (
    request: CollaborationRequest,
    delivery?: CollaborationDeliveryMeta,
  ) => Promise<CollaborationResponse>;
}

export interface SubjectCollabDeliveryResult {
  response: CollaborationResponse;
  receipt: CollaborationDeliveryReceipt;
}

export interface SubjectCollabNetwork {
  attach(peer: AttachedSubject): () => void;
  listCards(exceptSubjectId?: string): Promise<PublicSubjectCard[]>;
  deliver(request: CollaborationRequest): Promise<CollaborationResponse>;
  deliverWithReceipt(request: CollaborationRequest): Promise<SubjectCollabDeliveryResult>;
}

export function createInMemorySubjectNetwork(): SubjectCollabNetwork {
  const peers = new Map<string, AttachedSubject>();
  const unreachable = (request: CollaborationRequest): CollaborationResponse => ({
    exchangeId: request.exchangeId,
    fromSubjectId: request.toSubjectId,
    toSubjectId: request.fromSubjectId,
    at: request.at,
    decision: 'decline',
    reply: '对方当前不可达。',
  });
  const deliverWithReceipt = async (
    request: CollaborationRequest,
  ): Promise<SubjectCollabDeliveryResult> => {
    const peer = peers.get(request.toSubjectId);
    const actualBody = JSON.stringify(request);
    const unavailable = {
      delivered: false,
      recipientEndpointRef: '',
      actualBodyDigest: bodyDigest(actualBody),
      actualBytes: Buffer.byteLength(actualBody, 'utf8'),
    };
    if (!peer) return { response: unreachable(request), receipt: unavailable };
    const card = await peer.getCard();
    if (!card.reachable) {
      return {
        response: unreachable(request),
        receipt: { ...unavailable, recipientEndpointRef: card.endpointRef },
      };
    }
    const receipt: CollaborationDeliveryReceipt = {
      delivered: true,
      recipientEndpointRef: card.endpointRef,
      actualBodyDigest: bodyDigest(actualBody),
      actualBytes: Buffer.byteLength(actualBody, 'utf8'),
    };
    return {
      response: await peer.handle(request, {
        recipientEndpointRef: card.endpointRef,
        actualBody,
      }),
      receipt,
    };
  };
  return {
    attach(peer) {
      peers.set(peer.subjectId, peer);
      return () => {
        if (peers.get(peer.subjectId) === peer) peers.delete(peer.subjectId);
      };
    },
    async listCards(exceptSubjectId) {
      const cards: PublicSubjectCard[] = [];
      for (const peer of peers.values()) {
        if (peer.subjectId === exceptSubjectId) continue;
        const card = await peer.getCard();
        cards.push({ ...card, subjectId: peer.subjectId });
      }
      return cards;
    },
    async deliver(request) {
      return (await deliverWithReceipt(request)).response;
    },
    deliverWithReceipt,
  };
}
