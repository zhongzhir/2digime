import type {
  CollaborationRequest,
  CollaborationResponse,
  PublicSubjectCard,
} from './types';

export interface AttachedSubject {
  subjectId: string;
  getCard: () => Promise<PublicSubjectCard>;
  handle: (request: CollaborationRequest) => Promise<CollaborationResponse>;
}

export interface SubjectCollabNetwork {
  attach(peer: AttachedSubject): () => void;
  listCards(exceptSubjectId?: string): Promise<PublicSubjectCard[]>;
  deliver(request: CollaborationRequest): Promise<CollaborationResponse>;
}

export function createInMemorySubjectNetwork(): SubjectCollabNetwork {
  const peers = new Map<string, AttachedSubject>();
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
      const peer = peers.get(request.toSubjectId);
      if (!peer) {
        return {
          exchangeId: request.exchangeId,
          fromSubjectId: request.toSubjectId,
          toSubjectId: request.fromSubjectId,
          at: request.at,
          decision: 'decline',
          reply: '对方当前不可达。',
        };
      }
      const card = await peer.getCard();
      if (!card.reachable) {
        return {
          exchangeId: request.exchangeId,
          fromSubjectId: request.toSubjectId,
          toSubjectId: request.fromSubjectId,
          at: request.at,
          decision: 'decline',
          reply: '对方当前不可达。',
        };
      }
      return peer.handle(request);
    },
  };
}
