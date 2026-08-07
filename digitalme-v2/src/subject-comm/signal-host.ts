/**
 * Signal / 机会发现宿主 — 正式协作前的最小披露与匹配提示。
 * 不创建第二 Collaboration / Growth Store；发起协作复用 collab.propose。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import { LocalPackageTransport } from '../collaboration/transport';
import { LocalSubjectTransport, buildEnvelope } from './local-subject-transport';
import type { SubjectTransport } from './subject-transport';
import { InboxStore, OpportunityStore } from './inbox-store';
import { matchSignalLocally } from './opportunity-match';
import {
  OPPORTUNITY_PRIVACY_NOTE,
  type OpportunityCard,
  type OpportunityStage,
  type SignalPayload,
  type SignalResponsePayload,
} from './signal';
import type { SubjectEnvelope } from './envelope';
import type { SubjectRef } from '../collaboration/schema';
import { nowIso } from '../shared/ids';
import { LocalCollaborationHost } from '../collaboration/local-collaboration';
import { isRemoteEndpointRef, parseRemoteEndpointRef } from './endpoint';
import type { RelayTransport } from './relay-transport';

function makeCommId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function selfRef(runtime: DigitalMeRuntime): SubjectRef {
  const pkg = runtime.subject.requireActive();
  return {
    subjectId: pkg.id,
    displayName: pkg.identity.displayName,
    endpointRef: `subject:${pkg.id}`,
  };
}

function isSignalPayload(p: unknown): p is SignalPayload {
  return !!p && typeof p === 'object' && 'intent' in p && 'seeking' in p && 'offering' in p;
}

function isSignalResponsePayload(p: unknown): p is SignalResponsePayload {
  return !!p && typeof p === 'object' && 'verdict' in p && 'signalEnvelopeId' in p;
}

export class SignalOpportunityHost {
  private readonly transport: SubjectTransport;
  private readonly relay: RelayTransport | null;

  constructor(
    private readonly runtime: DigitalMeRuntime,
    transport?: SubjectTransport,
    relay?: RelayTransport | null,
  ) {
    this.relay = relay ?? null;
    this.transport =
      transport ??
      new LocalPackageTransport(runtime, { relay: this.relay }).asSubjectTransport();
  }

  private async opportunityStore(): Promise<OpportunityStore> {
    return OpportunityStore.open(this.runtime.subject.requireActive().rootDir);
  }

  private async inboxStore(): Promise<InboxStore> {
    return InboxStore.open(this.runtime.subject.requireActive().rootDir);
  }

  /** 处理收件箱中未消化的 signal / signal_response（幂等；已 ACK 的不再重放）。 */
  async processInbox(): Promise<{ processed: number }> {
    const items = await this.transport.listInbox({ unreadOnly: true });
    let processed = 0;
    for (const env of items) {
      if (env.kind === 'signal') {
        const did = await this.onInboundSignal(env);
        if (did) processed += 1;
      } else if (env.kind === 'signal_response') {
        const did = await this.onInboundSignalResponse(env);
        if (did) processed += 1;
      }
    }
    return { processed };
  }

  async sendSignal(input: {
    peerPackageDir?: string;
    peerEndpointRef?: string;
    signal: SignalPayload;
  }): Promise<{ envelopeId: string; opportunityId: string; delivered: boolean }> {
    const from = selfRef(this.runtime);
    let to: SubjectRef;
    let peerDisplayName: string;
    let peerEndpointRef: string;
    let peerSubjectId: string;

    if (input.peerEndpointRef && isRemoteEndpointRef(input.peerEndpointRef)) {
      if (!this.relay) throw new Error('远程信号需要 Relay');
      const epId = parseRemoteEndpointRef(input.peerEndpointRef);
      const peer = epId ? await this.relay.identityStore().getPeer(epId) : null;
      if (!peer) throw new Error('尚未与对方建立连接');
      const self = await this.relay.identityStore().getLocalProfile();
      if (!self) throw new Error('尚未配置远程端点');
      from.endpointRef = `dmep:${self.endpointId}`;
      from.displayName = self.displayName;
      to = {
        subjectId: peer.subjectId,
        displayName: peer.displayName,
        endpointRef: input.peerEndpointRef,
      };
      peerDisplayName = peer.displayName;
      peerEndpointRef = input.peerEndpointRef;
      peerSubjectId = peer.subjectId;
    } else {
      if (!input.peerPackageDir) throw new Error('sendSignal requires peerPackageDir or peerEndpointRef');
      const local =
        this.transport instanceof LocalSubjectTransport
          ? this.transport
          : new LocalPackageTransport(this.runtime).asLocalSubjectTransport();
      const peer = await local.resolvePeer(input.peerPackageDir);
      await local.registerEndpoint(from, this.runtime.subject.requireActive().rootDir);
      to = {
        subjectId: peer.subjectId,
        displayName: peer.displayName,
        endpointRef: peer.endpointRef,
      };
      peerDisplayName = peer.displayName;
      peerEndpointRef = peer.endpointRef;
      peerSubjectId = peer.subjectId;
    }

    const correlationId = makeCommId('opportunity');
    const envelope = buildEnvelope({
      from,
      to,
      kind: 'signal',
      payload: input.signal,
      correlationId,
      ...(input.signal.expiresAt ? { expiresAt: input.signal.expiresAt } : {}),
    });
    if (isRemoteEndpointRef(peerEndpointRef)) {
      envelope.transportMeta = { mode: 'remote', encrypted: true };
    }

    const sent = await this.transport.send(envelope);

    const card: OpportunityCard = {
      id: correlationId,
      derivedFrom: 'signal_envelope',
      peerDisplayName,
      peerEndpointRef,
      peerSubjectId,
      stage: 'potential',
      seekingSummary: (input.signal.seeking || []).join('、') || input.signal.intent,
      offeringSummary: (input.signal.offering || []).join('、'),
      whyWorthKnowing: '已向对方发出最小需求与供给说明，等待对方 Digital Me 判断。',
      privacyNote: OPPORTUNITY_PRIVACY_NOTE,
      signalEnvelopeId: envelope.envelopeId,
      correlationId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await (await this.opportunityStore()).put(card);
    return {
      envelopeId: envelope.envelopeId,
      opportunityId: card.id,
      delivered: sent.delivered !== false,
    };
  }

  private async onInboundSignal(env: SubjectEnvelope): Promise<boolean> {
    if (!isSignalPayload(env.payload)) return false;
    const store = await this.opportunityStore();
    const existing = await store.findBySignalEnvelopeId(env.envelopeId);
    if (existing) {
      await this.transport.acknowledge(env.envelopeId);
      return false;
    }

    const match = await matchSignalLocally(this.runtime, env.payload);
    await this.transport.acknowledge(env.envelopeId);

    if (match.verdict === 'no_match') {
      // 静默：不建 CollaborationRecord / Grant / Task / GrowthEvent / Opportunity 卡
      return true;
    }

    const correlationId = env.correlationId || makeCommId('opportunity');
    const card: OpportunityCard = {
      id: correlationId,
      derivedFrom: 'signal_envelope',
      peerDisplayName: env.from.displayName,
      peerEndpointRef: env.from.endpointRef,
      peerSubjectId: env.from.subjectId,
      stage: 'inbound_pending',
      seekingSummary: (env.payload.seeking || []).join('、'),
      offeringSummary: (env.payload.offering || []).join('、'),
      whyWorthKnowing: match.response.whyWorthKnowing || '双方需求存在明显互补。',
      privacyNote: OPPORTUNITY_PRIVACY_NOTE,
      signalEnvelopeId: env.envelopeId,
      correlationId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await store.put(card);

    const responsePayload: SignalResponsePayload = {
      ...match.response,
      verdict: 'potential_match',
      signalEnvelopeId: env.envelopeId,
      peerMayNeed: match.response.peerMayNeed || env.payload.offering.slice(0, 2),
      youMayOffer: match.response.youMayOffer || env.payload.seeking.slice(0, 2),
    };
    const replyFrom = await this.selfCommRef(env.from.endpointRef);
    const reply = buildEnvelope({
      from: replyFrom,
      to: env.from,
      kind: 'signal_response',
      payload: responsePayload,
      correlationId,
      replyTo: env.envelopeId,
    });
    if (isRemoteEndpointRef(env.from.endpointRef)) {
      reply.transportMeta = { mode: 'remote', encrypted: true };
    }
    await this.ensureLocalEndpointRegistered(replyFrom);
    await this.transport.send(reply);
    card.responseEnvelopeId = reply.envelopeId;
    card.stage = 'potential';
    card.updatedAt = nowIso();
    await store.put(card);
    return true;
  }

  private async onInboundSignalResponse(env: SubjectEnvelope): Promise<boolean> {
    if (!isSignalResponsePayload(env.payload)) return false;
    const responsePayload = env.payload;
    const store = await this.opportunityStore();
    let card =
      (await store.list()).find((c) => c.signalEnvelopeId === responsePayload.signalEnvelopeId) ||
      (env.correlationId ? await store.get(env.correlationId) : null);
    await this.transport.acknowledge(env.envelopeId);
    if (responsePayload.verdict === 'no_match') {
      return true;
    }
    const isContinue = /愿意进一步了解/.test(String(responsePayload.whyWorthKnowing || ''));
    const isBrief = String(responsePayload.whyWorthKnowing || '').startsWith('项目简介：');
    if (!card) {
      card = {
        id: env.correlationId || makeCommId('opportunity'),
        derivedFrom: 'signal_envelope',
        peerDisplayName: env.from.displayName,
        peerEndpointRef: env.from.endpointRef,
        peerSubjectId: env.from.subjectId,
        stage: isContinue ? 'mutual_interest' : 'potential',
        seekingSummary: (responsePayload.youMayOffer || []).join('、'),
        offeringSummary: (responsePayload.peerMayNeed || []).join('、'),
        whyWorthKnowing: responsePayload.whyWorthKnowing || '双方需求存在互补',
        privacyNote: OPPORTUNITY_PRIVACY_NOTE,
        signalEnvelopeId: responsePayload.signalEnvelopeId,
        responseEnvelopeId: env.envelopeId,
        correlationId: env.correlationId || makeCommId('opportunity'),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(isBrief
          ? {
              peerBrief: String(responsePayload.whyWorthKnowing || '').replace(/^项目简介：/, ''),
              stage: 'brief_shared' as const,
            }
          : {}),
      };
    } else {
      card.derivedFrom = 'signal_envelope';
      card.responseEnvelopeId = env.envelopeId;
      if (isBrief) {
        card.peerBrief = String(responsePayload.whyWorthKnowing || '').replace(/^项目简介：/, '');
        card.stage = 'brief_shared';
      } else if (isContinue) {
        const localAlreadyContinued =
          card.stage === 'continued' ||
          card.stage === 'mutual_interest' ||
          card.stage === 'brief_shared';
        if (localAlreadyContinued) {
          card.stage = 'mutual_interest';
          card.whyWorthKnowing = '对方也愿意进一步了解。';
        } else {
          card.stage = 'continued';
          card.whyWorthKnowing = '对方也愿意进一步了解。';
        }
      } else {
        card.stage = 'potential';
        card.whyWorthKnowing = responsePayload.whyWorthKnowing || card.whyWorthKnowing;
        if (responsePayload.youMayOffer?.length) {
          card.seekingSummary = responsePayload.youMayOffer.join('、');
        }
        if (responsePayload.peerMayNeed?.length) {
          card.offeringSummary = responsePayload.peerMayNeed.join('、');
        }
      }
      card.updatedAt = nowIso();
    }
    await store.put(card);
    return true;
  }

  async listOpportunities(): Promise<{ items: OpportunityCard[] }> {
    await this.processInbox();
    const store = await this.opportunityStore();
    const items = await store.list();
    const refreshed: OpportunityCard[] = [];
    for (const card of items) {
      refreshed.push(await this.refreshDerivedDisplay(card));
    }
    refreshed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      items: refreshed.filter((c) => c.stage !== 'declined'),
    };
  }

  /**
   * 从 inbox 权威信封刷新展示缓存；本地 stage / collaborationRecordId 等业务态保留。
   * 删除派生卡后可用 rebuildDerivedFromInbox 重建。
   */
  private async refreshDerivedDisplay(card: OpportunityCard): Promise<OpportunityCard> {
    const inbox = await this.inboxStore();
    const signalEnv = await inbox.get(card.signalEnvelopeId);
    const next: OpportunityCard = {
      ...card,
      derivedFrom: 'signal_envelope',
      privacyNote: OPPORTUNITY_PRIVACY_NOTE,
    };
    if (signalEnv && isSignalPayload(signalEnv.payload)) {
      next.seekingSummary =
        (signalEnv.payload.seeking || []).join('、') || signalEnv.payload.intent;
      next.offeringSummary = (signalEnv.payload.offering || []).join('、');
      if (signalEnv.from.displayName && signalEnv.to.subjectId === selfRef(this.runtime).subjectId) {
        next.peerDisplayName = signalEnv.from.displayName;
        next.peerEndpointRef = signalEnv.from.endpointRef;
        next.peerSubjectId = signalEnv.from.subjectId;
      }
    }
    if (card.responseEnvelopeId) {
      const resp = await inbox.get(card.responseEnvelopeId);
      if (resp && isSignalResponsePayload(resp.payload) && resp.payload.whyWorthKnowing) {
        if (!String(resp.payload.whyWorthKnowing).startsWith('项目简介：')) {
          if (
            next.stage === 'potential' ||
            next.stage === 'inbound_pending' ||
            next.stage === 'continued'
          ) {
            // 不覆盖已进入 mutual / brief / collaboration 的文案决策
            if (next.stage === 'potential' || next.stage === 'inbound_pending') {
              next.whyWorthKnowing = resp.payload.whyWorthKnowing;
            }
          }
        }
      }
    }
    next.updatedAt = card.updatedAt;
    await (await this.opportunityStore()).put(next);
    return next;
  }

  /** 从 inbox 中已有 signal 信封重建缺失的派生机会卡（不损失原始消息）。 */
  async rebuildDerivedFromInbox(): Promise<{ rebuilt: number }> {
    const inbox = await this.inboxStore();
    const store = await this.opportunityStore();
    let rebuilt = 0;
    for (const env of await inbox.list()) {
      if (env.kind !== 'signal') continue;
      if (!isSignalPayload(env.payload)) continue;
      const existing = await store.findBySignalEnvelopeId(env.envelopeId);
      if (existing) continue;
      // 仅对本方收到的 inbound signal 重建；outbound 副本若无卡则跳过匹配重跑
      const selfId = selfRef(this.runtime).subjectId;
      if (env.to.subjectId !== selfId) continue;
      const match = await matchSignalLocally(this.runtime, env.payload);
      if (match.verdict === 'no_match') continue;
      const correlationId = env.correlationId || makeCommId('opportunity');
      const card: OpportunityCard = {
        id: correlationId,
        derivedFrom: 'signal_envelope',
        peerDisplayName: env.from.displayName,
        peerEndpointRef: env.from.endpointRef,
        peerSubjectId: env.from.subjectId,
        stage: 'potential',
        seekingSummary: (env.payload.seeking || []).join('、'),
        offeringSummary: (env.payload.offering || []).join('、'),
        whyWorthKnowing: match.response.whyWorthKnowing || '双方需求存在明显互补。',
        privacyNote: OPPORTUNITY_PRIVACY_NOTE,
        signalEnvelopeId: env.envelopeId,
        correlationId,
        createdAt: env.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      await store.put(card);
      rebuilt += 1;
    }
    return { rebuilt };
  }

  async continueInterest(opportunityId: string): Promise<{ item: OpportunityCard }> {
    const store = await this.opportunityStore();
    const card = await store.get(opportunityId);
    if (!card) throw new Error('未找到该合作机会');
    if (card.stage === 'declined') throw new Error('该机会已关闭');

    const nextStage: OpportunityStage =
      card.stage === 'inbound_pending' || card.stage === 'potential'
        ? 'continued'
        : card.stage === 'continued'
          ? 'mutual_interest'
          : card.stage;

    card.stage = nextStage === 'continued' ? 'continued' : nextStage;
    // 记录本方已继续；若对方也已 continued/mutual → mutual_interest
    const markerId = `cont_${card.id}_${selfRef(this.runtime).subjectId}`.replace(
      /[^A-Za-z0-9_-]/g,
      '_',
    );
    const inbox = await this.inboxStore();
    const continueFrom = await this.selfCommRef(card.peerEndpointRef);
    const continueEnv = buildEnvelope({
      from: continueFrom,
      to: {
        subjectId: card.peerSubjectId,
        displayName: card.peerDisplayName,
        endpointRef: card.peerEndpointRef,
      },
      kind: 'signal_response',
      payload: {
        verdict: 'potential_match',
        signalEnvelopeId: card.signalEnvelopeId,
        whyWorthKnowing: '对方也愿意进一步了解。',
        peerMayNeed: [card.offeringSummary].filter(Boolean),
        youMayOffer: [card.seekingSummary].filter(Boolean),
      },
      correlationId: card.correlationId,
      replyTo: card.signalEnvelopeId,
    });
    // 复用 envelopeId 稳定幂等键：用固定 id 前缀
    continueEnv.envelopeId = markerId.slice(0, 80);
    continueEnv.id = markerId.slice(0, 80);
    if (isRemoteEndpointRef(card.peerEndpointRef)) {
      continueEnv.transportMeta = { mode: 'remote', encrypted: true };
    }

    await this.ensureLocalEndpointRegistered(continueFrom);
    await this.transport.send(continueEnv);

    // 检查对方是否已发过 continue（inbox 中同 correlation）
    const peerContinued = (await inbox.list()).some(
      (e) =>
        e.kind === 'signal_response' &&
        e.correlationId === card.correlationId &&
        e.from.subjectId === card.peerSubjectId &&
        isSignalResponsePayload(e.payload) &&
        /愿意进一步了解/.test(String(e.payload.whyWorthKnowing || '')),
    );
    if (peerContinued || card.stage === 'mutual_interest') {
      card.stage = 'mutual_interest';
    } else {
      card.stage = 'continued';
    }
    card.updatedAt = nowIso();
    await store.put(card);
    return { item: card };
  }

  async decline(opportunityId: string): Promise<{ ok: boolean }> {
    const store = await this.opportunityStore();
    const card = await store.get(opportunityId);
    if (!card) return { ok: false };
    card.stage = 'declined';
    card.updatedAt = nowIso();
    await store.put(card);
    return { ok: true };
  }

  async discloseBrief(opportunityId: string): Promise<{ item: OpportunityCard }> {
    const store = await this.opportunityStore();
    const card = await store.get(opportunityId);
    if (!card) throw new Error('未找到该合作机会');
    if (card.stage !== 'mutual_interest' && card.stage !== 'brief_shared' && card.stage !== 'continued') {
      // 允许在双方继续后披露；若仅本方 continued，仍给最小本地简介占位
    }
    const localBrief = await this.localProjectBrief();
    card.localBrief = localBrief;

    // 向对方发送最小简介（仍走 signal_response，disclosure 层）
    const briefFrom = await this.selfCommRef(card.peerEndpointRef);
    const briefEnv = buildEnvelope({
      from: briefFrom,
      to: {
        subjectId: card.peerSubjectId,
        displayName: card.peerDisplayName,
        endpointRef: card.peerEndpointRef,
      },
      kind: 'signal_response',
      payload: {
        verdict: 'potential_match',
        signalEnvelopeId: card.signalEnvelopeId,
        whyWorthKnowing: `项目简介：${localBrief}`,
      },
      correlationId: card.correlationId,
    });
    if (isRemoteEndpointRef(card.peerEndpointRef)) {
      briefEnv.transportMeta = { mode: 'remote', encrypted: true };
    }
    await this.transport.send(briefEnv);

    // 收取对方已披露的简介
    await this.processInbox();
    const refreshed = await store.get(opportunityId);
    const peerBrief = await this.findPeerBrief(card);
    if (refreshed) {
      if (peerBrief) refreshed.peerBrief = peerBrief;
      refreshed.localBrief = localBrief;
      refreshed.stage = 'brief_shared';
      refreshed.updatedAt = nowIso();
      await store.put(refreshed);
      return { item: refreshed };
    }
    if (peerBrief) card.peerBrief = peerBrief;
    card.stage = 'brief_shared';
    card.updatedAt = nowIso();
    await store.put(card);
    return { item: card };
  }

  private async findPeerBrief(card: OpportunityCard): Promise<string | undefined> {
    const inbox = await this.inboxStore();
    const hits = (await inbox.list())
      .filter(
        (e) =>
          e.kind === 'signal_response' &&
          e.correlationId === card.correlationId &&
          e.from.subjectId === card.peerSubjectId &&
          isSignalResponsePayload(e.payload) &&
          String(e.payload.whyWorthKnowing || '').startsWith('项目简介：'),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const text = hits[0] && isSignalResponsePayload(hits[0].payload)
      ? String(hits[0].payload.whyWorthKnowing || '').replace(/^项目简介：/, '')
      : undefined;
    return text;
  }

  private async localProjectBrief(): Promise<string> {
    const pkg = this.runtime.subject.requireActive();
    const growth = await this.runtime.subject.listGrowthEvents();
    const hit = growth.find((e) =>
      /项目|Aivestor|金融|Agent|参赛/.test(`${e.payload.title}${e.payload.detail}`),
    );
    if (hit?.payload.detail) return String(hit.payload.detail).slice(0, 200);
    return (pkg.identity.description || pkg.identity.displayName).slice(0, 200);
  }

  async startCollaboration(input: {
    opportunityId: string;
    intent?: string;
  }): Promise<{ recordId: string; status?: string }> {
    const store = await this.opportunityStore();
    const card = await store.get(input.opportunityId);
    if (!card) throw new Error('未找到该合作机会');
    if (card.stage === 'declined') throw new Error('该机会已关闭');
    if (card.stage !== 'mutual_interest' && card.stage !== 'brief_shared' && card.stage !== 'continued') {
      throw new Error('请先与对方互相了解后再发起协作');
    }
    // 需要双方都愿意：mutual_interest 或 brief_shared
    if (card.stage === 'continued') {
      // 再扫一次对方 continue
      await this.processInbox();
      const again = await store.get(input.opportunityId);
      if (again && again.stage === 'continued') {
        // 允许 Demo：本方已继续且对方曾 potential_match 响应即可升 mutual（若对方也点了继续会 mutual）
        const inbox = await this.inboxStore();
        const peerContinued = (await inbox.list()).some(
          (e) =>
            e.correlationId === card.correlationId &&
            e.from.subjectId === card.peerSubjectId &&
            isSignalResponsePayload(e.payload) &&
            /愿意进一步了解/.test(String(e.payload.whyWorthKnowing || '')),
        );
        if (!peerContinued) {
          throw new Error('对方尚未表示愿意进一步了解');
        }
        again.stage = 'mutual_interest';
        await store.put(again);
      }
    }

    const intent =
      input.intent ||
      `基于双方已确认的潜在合作机会，希望一起推进：${card.seekingSummary || card.whyWorthKnowing}`;

    const collab = new LocalCollaborationHost(
      this.runtime,
      new LocalPackageTransport(this.runtime, { relay: this.relay }),
    );
    const proposed = isRemoteEndpointRef(card.peerEndpointRef)
      ? await collab.propose({
          responderEndpointRef: card.peerEndpointRef,
          proposal: {
            intent,
            expectedOutcome: '形成可验收的合作成果',
            offeredMaterials: [],
            acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
          },
          skipAutoEvaluate: true,
        })
      : await collab.propose({
          responderPackageDir: (await this.localLookupDir(card.peerEndpointRef))!,
          proposal: {
            intent,
            expectedOutcome: '形成可验收的合作成果',
            offeredMaterials: [],
            acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
          },
          skipAutoEvaluate: true,
        });

    const latest = (await store.get(input.opportunityId))!;
    latest.stage = 'collaboration_started';
    latest.collaborationRecordId = proposed.recordId;
    latest.updatedAt = nowIso();
    await store.put(latest);

    return { recordId: proposed.recordId, status: proposed.status };
  }

  private async selfCommRef(peerEndpointRef: string): Promise<SubjectRef> {
    if (isRemoteEndpointRef(peerEndpointRef) && this.relay) {
      const self = await this.relay.identityStore().getLocalProfile();
      if (self) {
        return {
          subjectId: self.subjectId,
          displayName: self.displayName,
          endpointRef: `dmep:${self.endpointId}`,
        };
      }
    }
    return selfRef(this.runtime);
  }

  private async ensureLocalEndpointRegistered(ref: SubjectRef): Promise<void> {
    if (isRemoteEndpointRef(ref.endpointRef)) return;
    if (typeof (this.transport as LocalSubjectTransport).registerEndpoint === 'function') {
      try {
        await (this.transport as LocalSubjectTransport).registerEndpoint(
          ref,
          this.runtime.subject.requireActive().rootDir,
        );
      } catch {
        /* relay 无此方法 */
      }
    }
  }

  private async localLookupDir(endpointRef: string): Promise<string | null> {
    try {
      if (typeof (this.transport as LocalSubjectTransport).lookupPackageDir === 'function') {
        return await (this.transport as LocalSubjectTransport).lookupPackageDir(endpointRef);
      }
    } catch {
      /* ignore */
    }
    return new LocalPackageTransport(this.runtime).lookupPackageDir(endpointRef);
  }
}
