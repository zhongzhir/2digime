/**
 * 最小 pairing invite — 无公开目录；交换 subject / endpoint / 公钥 / relay。
 */
import {
  SUBJECT_ENDPOINT_PROTOCOL,
  type SubjectEndpointPublic,
} from './endpoint';
import type { CommIdentityStore } from './identity-store';

export const INVITE_KIND = 'digitalme.subject_invite.v1' as const;

export interface SubjectInvite {
  kind: typeof INVITE_KIND;
  createdAt: string;
  endpoint: SubjectEndpointPublic;
}

export function createInvite(endpoint: SubjectEndpointPublic, createdAt: string): SubjectInvite {
  return {
    kind: INVITE_KIND,
    createdAt,
    endpoint: {
      ...endpoint,
      protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
      relayUrl: endpoint.relayUrl.replace(/\/+$/, ''),
    },
  };
}

export function parseInvite(raw: unknown): SubjectInvite {
  if (!raw || typeof raw !== 'object') throw new Error('邀请无效');
  const o = raw as Record<string, unknown>;
  if (o.kind !== INVITE_KIND) throw new Error('邀请格式不受支持');
  const ep = o.endpoint as SubjectEndpointPublic | undefined;
  if (!ep || !ep.subjectId || !ep.endpointId || !ep.relayUrl) {
    throw new Error('邀请缺少端点信息');
  }
  if (!ep.signPublicKey || !ep.encPublicKey || !ep.keyId) {
    throw new Error('邀请缺少公钥');
  }
  return {
    kind: INVITE_KIND,
    createdAt: String(o.createdAt || ''),
    endpoint: {
      protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
      subjectId: ep.subjectId,
      endpointId: ep.endpointId,
      displayName: ep.displayName || ep.subjectId,
      relayUrl: String(ep.relayUrl).replace(/\/+$/, ''),
      signPublicKey: ep.signPublicKey,
      encPublicKey: ep.encPublicKey,
      keyId: ep.keyId,
    },
  };
}

export async function acceptInvite(
  store: CommIdentityStore,
  inviteRaw: unknown,
): Promise<{ peer: SubjectEndpointPublic; replyInvite: SubjectInvite }> {
  const invite = parseInvite(inviteRaw);
  const self = await store.getLocalProfile();
  if (!self) throw new Error('请先完成本机端点与 Relay 连接');
  if (self.relayUrl.replace(/\/+$/, '') !== invite.endpoint.relayUrl) {
    // 允许同 host 不同写法已规范化；仍要求同一 Relay
    throw new Error('双方需使用同一 Relay 地址');
  }
  const peer = await store.putPeer(invite.endpoint);
  const replyInvite = createInvite(self, new Date().toISOString());
  return { peer, replyInvite };
}
