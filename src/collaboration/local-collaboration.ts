/**
 * 主体协作协调器（部署无关）。
 * - CollaborationRecord：提议/协商/约定/交付事件（append-only）
 * - AuthorizationGrant：约定后的纯授权
 * - 执行复用 WorkRuntime；成果物化保留 provenance
 * - 绝对路径仅经 LocalPackageTransport
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { newId, nowIso } from '../shared/ids';
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../work-runtime/job-runner';
import type { ContextRef } from '../work-runtime/task';
import { OPENAI_COMPATIBLE_CAPABILITY_ID } from '../capability/adapters/openai-compatible';
import { isRemoteEndpointRef } from '../subject-comm/endpoint';
import { GrantStore } from './grant-store';
import { CollaborationRecordStore } from './record-store';
import { LocalPackageTransport, type CollaborationTransport } from './transport';
import {
  deriveCollabStatus,
  findAgreement,
  latestDelivery,
  latestFulfillmentFailure,
  latestGrantId,
  latestLinkedFulfillment,
  latestOwnerDecision,
  latestTerms,
  mergeIncomingEvents,
  termsDigestOf,
  tryFormAgreementDigest,
} from './record-derive';
import {
  evaluateProposalForSubject,
  selfCheckDelivery,
  verifyDeliveryByInitiator,
} from './evaluate';
import {
  LOCAL_COLLAB_ACTIONS,
  type AuthorizationGrant,
  type CollaborationEvent,
  type CollaborationProposalTerms,
  type CollaborationRecord,
  type CollabUserStatus,
  type InteractionRequest,
  type SubjectRef,
} from './schema';

export interface CollabPeerPreview {
  displayName: string;
  packageDir: string;
  brief?: string;
  subjectId?: string;
  endpointRef?: string;
}

export interface CollabListItem {
  recordId: string;
  grantId?: string;
  status: CollabUserStatus;
  /** 本方在协作中的角色（派生，不另存）。 */
  role?: 'initiator' | 'responder';
  /** 对方显示名（发起方看 B，接收方看 A）。 */
  peerDisplayName?: string;
  ownerDecision?: 'accept' | 'reject' | 'revise';
  subtaskGoal?: string;
  granteeDisplayName?: string;
  allowedMaterials: string[];
  returnedExcerpt?: string;
  issuerTaskId?: string;
  failureMessage?: string;
  reachedModel?: boolean;
  localArtifactId?: string;
  evaluationBasis?: string[];
}

function normPath(p: string): string {
  return path.resolve(p);
}

function contentDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function assertGrantUsable(grant: AuthorizationGrant): void {
  if (grant.status === 'revoked') throw new Error('authorization grant has been revoked');
  if (grant.status === 'expired') throw new Error('authorization grant has expired');
  if (grant.expiresAt && Date.parse(grant.expiresAt) < Date.now()) {
    throw new Error('authorization grant has expired');
  }
  const actions = new Set(grant.scope.actions.map(String));
  for (const required of LOCAL_COLLAB_ACTIONS) {
    if (!actions.has(required)) {
      throw new Error(`grant missing required action: ${required}`);
    }
  }
}

export class LocalCollaborationHost {
  private readonly transport: CollaborationTransport;

  constructor(
    private readonly issuer: DigitalMeRuntime,
    transport?: CollaborationTransport,
  ) {
    this.transport = transport ?? new LocalPackageTransport(issuer);
  }

  private async recordStore(): Promise<CollaborationRecordStore> {
    return CollaborationRecordStore.open(this.issuer.subject.requireActive().rootDir);
  }

  private async grantStore(): Promise<GrantStore> {
    return GrantStore.open(this.issuer.subject.requireActive().rootDir);
  }

  /** 将 Grant 写入发起方（权威）并投影到接收方，不新建 Store。 */
  private async persistGrantBothSides(
    record: CollaborationRecord,
    grant: AuthorizationGrant,
  ): Promise<void> {
    const selfId = this.issuer.subject.requireActive().id;
    const writeLocal = async () => {
      const store = await this.grantStore();
      await store.put(grant);
    };
    const writePeer = async (endpointRef: string) => {
      try {
        const opened = await this.transport.openByEndpointRef(endpointRef);
        try {
          const store = await GrantStore.open(opened.runtime.subject.requireActive().rootDir);
          await store.put(grant);
        } finally {
          await opened.stop();
        }
      } catch {
        // 远程端点无法直写对方包；Grant 留在本机，对端经协作事件本地重建
      }
    };

    if (selfId === record.initiator.subjectId) {
      await writeLocal();
      await writePeer(record.responder.endpointRef);
      return;
    }
    if (selfId === record.responder.subjectId) {
      await writePeer(record.initiator.endpointRef);
      await writeLocal();
      return;
    }
    await writePeer(record.initiator.endpointRef);
    await writePeer(record.responder.endpointRef);
  }

  /** 从本包或发起方包解析 Grant（成约后投影）。 */
  private async resolveGrant(
    record: CollaborationRecord,
    grantId: string,
  ): Promise<AuthorizationGrant | null> {
    const local = await this.grantStore();
    const hit = await local.get(grantId);
    if (hit) return hit;
    const selfId = this.issuer.subject.requireActive().id;
    if (selfId === record.initiator.subjectId) return null;
    try {
      const opened = await this.transport.openByEndpointRef(record.initiator.endpointRef);
      try {
        const remote = await GrantStore.open(opened.runtime.subject.requireActive().rootDir);
        const grant = await remote.get(grantId);
        if (grant) await local.put(grant);
        return grant;
      } finally {
        await opened.stop();
      }
    } catch {
      return null;
    }
  }

  private selfRole(record: CollaborationRecord): 'initiator' | 'responder' {
    const selfId = this.issuer.subject.requireActive().id;
    return record.initiator.subjectId === selfId ? 'initiator' : 'responder';
  }

  private async loadRecord(recordId: string): Promise<CollaborationRecord> {
    const store = await this.recordStore();
    const record = await store.get(recordId);
    if (!record) throw new Error(`collaboration record not found: ${recordId}`);
    return record;
  }

  private async saveLocal(record: CollaborationRecord): Promise<void> {
    const store = await this.recordStore();
    await store.put(record);
  }

  /** 追加本方事件并推送到对方副本（幂等 eventId）。 */
  private async appendAndSync(
    record: CollaborationRecord,
    events: CollaborationEvent[],
    peerEndpointRef: string,
  ): Promise<CollaborationRecord> {
    const next = await this.appendLocalOnly(record, events);
    await this.transport.pushEvents({
      endpointRef: peerEndpointRef,
      recordId: record.recordId,
      events,
      seedRecord: next,
    });
    return next;
  }

  /** 仅追加本方事件（对端 Runtime 打开期间禁止 push，以免 recover 打断 Job）。 */
  private async appendLocalOnly(
    record: CollaborationRecord,
    events: CollaborationEvent[],
  ): Promise<CollaborationRecord> {
    const next: CollaborationRecord = {
      ...record,
      events: [...record.events, ...events],
      updatedAt: events[events.length - 1]?.at || nowIso(),
    };
    await this.saveLocal(next);
    return next;
  }

  private async syncFullRecordToPeer(record: CollaborationRecord): Promise<void> {
    const selfId = this.issuer.subject.requireActive().id;
    const peer =
      record.initiator.subjectId === selfId ? record.responder : record.initiator;
    await this.transport.pushEvents({
      endpointRef: peer.endpointRef,
      recordId: record.recordId,
      events: record.events,
      seedRecord: record,
    });
  }

  /** 打开包/进入协作页时的对账：拉取对方事件并入本地副本，并对未完成履行做 Job 对账。 */
  async reconcile(recordId: string): Promise<CollaborationRecord> {
    const local = await this.loadRecord(recordId);
    const selfId = this.issuer.subject.requireActive().id;
    const peer =
      local.initiator.subjectId === selfId ? local.responder : local.initiator;
    let merged = local;
    try {
      const remote = await this.transport.pullRecord(peer.endpointRef, recordId);
      if (remote) {
        merged = mergeIncomingEvents(local, remote.events);
        if (merged.events.length !== local.events.length) {
          await this.saveLocal(merged);
        }
      }
    } catch (err) {
      // 对端不可达时保留本地状态
      void err;
      merged = local;
    }
    return this.recoverInFlightFulfillment(merged);
  }

  /**
   * 履行中断恢复（无持续轮询）：
   * - 已有成功交付但未物化 → 补齐物化；
   * - Job 失败/取消/启动恢复中断 → 可恢复失败态；
   * - Job 已成功 → 补齐交付；
   * - 仅有 fulfillment_started 无 Job 引用 → 可恢复失败态。
   */
  private async recoverInFlightFulfillment(
    record: CollaborationRecord,
  ): Promise<CollaborationRecord> {
    const delivery = latestDelivery(record);
    const localMaterialized = [...record.events]
      .reverse()
      .find((e) => e.localArtifactId)?.localArtifactId;

    if (delivery?.delivery && !localMaterialized) {
      return this.finishMaterializeFromDelivery(record, delivery);
    }
    if (delivery?.delivery && localMaterialized) return record;

    if (!record.events.some((e) => e.kind === 'fulfillment_started')) return record;
    if (latestFulfillmentFailure(record) && !latestLinkedFulfillment(record)?.jobId) {
      return record;
    }

    const linked = latestLinkedFulfillment(record);
    const grantId = latestGrantId(record);

    if (!linked?.jobId) {
      if (latestFulfillmentFailure(record)) return record;
      const failEv: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'fulfillment_started',
        authorSubjectId: record.responder.subjectId,
        at: nowIso(),
        ...(grantId ? { grantId } : {}),
        note: 'recoverable_fail:履行中断，尚未建立执行引用',
      };
      record = await this.appendLocalOnly(record, [failEv]);
      try {
        await this.syncFullRecordToPeer(record);
      } catch {
        /* 对端不可达时仍保留本方可恢复失败态 */
      }
      return record;
    }

    let opened: Awaited<ReturnType<CollaborationTransport['openByEndpointRef']>> | null =
      null;
    try {
      opened = await this.transport.openByEndpointRef(record.responder.endpointRef);
      const job = await opened.runtime.workRuntime.getJob(linked.jobId);
      if (!job) {
        if (latestFulfillmentFailure(record)) return record;
        const failEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'fulfillment_started',
          authorSubjectId: record.responder.subjectId,
          at: nowIso(),
          ...(grantId ? { grantId } : {}),
          jobId: linked.jobId,
          ...(linked.taskId ? { taskId: linked.taskId } : {}),
          note: 'recoverable_fail:找不到对应执行，可重试',
        };
        record = await this.appendLocalOnly(record, [failEv]);
        await this.syncFullRecordToPeer(record).catch(() => undefined);
        return record;
      }

      if (job.status === 'failed' || job.status === 'cancelled') {
        if (latestFulfillmentFailure(record)) return record;
        const failMessage =
          job.progress?.note?.trim() ||
          job.failure?.message ||
          (job.failure?.stage === 'interrupted' ? '执行中断' : String(job.status));
        const failEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'delivered',
          authorSubjectId: record.responder.subjectId,
          at: nowIso(),
          ...(grantId ? { grantId } : {}),
          jobId: job.id,
          ...(linked.taskId ? { taskId: linked.taskId } : {}),
          note: `recoverable_fail:${failMessage}`,
          selfCheck: { passed: false, notes: [failMessage] },
        };
        record = await this.appendLocalOnly(record, [failEv]);
        await this.syncFullRecordToPeer(record).catch(() => undefined);
        return record;
      }

      if (job.status === 'succeeded' && job.artifactId) {
        const next = await this.completeDeliveryFromJob({
          record,
          opened,
          jobId: job.id,
          artifactId: job.artifactId,
          ...(linked.taskId ? { taskId: linked.taskId } : {}),
          ...(grantId ? { grantId } : {}),
        });
        opened = null;
        return next;
      }

      // queued/running：不做轮询；打开包时 WorkRuntime 会把崩溃中的 running 标为中断失败
      return record;
    } catch (err) {
      void err;
      return record;
    } finally {
      if (opened) {
        try {
          await opened.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async finishMaterializeFromDelivery(
    record: CollaborationRecord,
    deliveryEv: CollaborationEvent,
  ): Promise<CollaborationRecord> {
    const delivery = deliveryEv.delivery;
    if (!delivery) return record;
    if ([...record.events].some((e) => e.localArtifactId && e.delivery?.contentDigest === delivery.contentDigest)) {
      return record;
    }
    let opened: Awaited<ReturnType<CollaborationTransport['openByEndpointRef']>> | null =
      null;
    try {
      // 远端交付：内容已随事件承载，无需打开对方包；本地路径再回退到打开对方读取。
      let artifactText = deliveryEv.artifactText ?? '';
      if (!artifactText && !isRemoteEndpointRef(record.responder.endpointRef)) {
        opened = await this.transport.openByEndpointRef(record.responder.endpointRef);
        const content = await opened.runtime.getContent({
          artifactId: delivery.sourceArtifactId,
        });
        artifactText = content.text ?? '';
        await opened.stop();
        opened = null;
      }
      const terms = latestTerms(record);
      const agreement = findAgreement(record);
      const materialized = await this.issuer.materializePeerArtifact({
        title: terms.intent.slice(0, 80),
        text: artifactText,
        recordId: record.recordId,
        provenance: {
          kind: 'collaboration_delivery',
          recordId: record.recordId,
          sourceSubjectId: delivery.sourceSubjectId,
          sourceArtifactId: delivery.sourceArtifactId,
          sourceHeadVersionId: delivery.sourceHeadVersionId,
          sourceContentDigest: delivery.contentDigest,
          agreementTermsDigest: agreement?.termsDigest || delivery.termsDigest,
        },
      });
      const materializeEv: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'delivered',
        authorSubjectId: record.initiator.subjectId,
        at: nowIso(),
        termsDigest: delivery.termsDigest,
        delivery,
        localArtifactId: materialized.artifactId,
        localHeadVersionId: materialized.headVersionId,
        note: 'initiator_materialized',
      };
      record = await this.appendLocalOnly(record, [materializeEv]);
      await this.syncFullRecordToPeer(record).catch(() => undefined);
      return record;
    } catch (err) {
      void err;
      return record;
    } finally {
      if (opened) {
        try {
          await opened.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async completeDeliveryFromJob(input: {
    record: CollaborationRecord;
    opened: Awaited<ReturnType<CollaborationTransport['openByEndpointRef']>>;
    jobId: string;
    taskId?: string;
    artifactId: string;
    grantId?: string;
  }): Promise<CollaborationRecord> {
    let { record, opened } = input;
    if (latestDelivery(record)) {
      const localId = [...record.events].reverse().find((e) => e.localArtifactId)?.localArtifactId;
      if (localId) return record;
      return this.finishMaterializeFromDelivery(record, latestDelivery(record)!);
    }
    const terms = latestTerms(record);
    const agreement = findAgreement(record);
    if (!agreement?.termsDigest) return record;

    const content = await opened.runtime.getContent({ artifactId: input.artifactId });
    const artifactText = content.text ?? '';
    const digest = contentDigest(artifactText);
    const check = selfCheckDelivery({ text: artifactText, terms });
    const deliveryRef = {
      sourceSubjectId: opened.runtime.subject.requireActive().id,
      sourceArtifactId: input.artifactId,
      sourceHeadVersionId: content.artifact.headVersionId,
      contentDigest: digest,
      agreementEventId: agreement.eventId,
      termsDigest: agreement.termsDigest,
    };
    const delivered: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'delivered',
      authorSubjectId: record.responder.subjectId,
      at: nowIso(),
      ...(input.grantId ? { grantId: input.grantId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      jobId: input.jobId,
      termsDigest: agreement.termsDigest,
      delivery: deliveryRef,
      selfCheck: check,
      note: check.passed ? '对方已提交成果（含自检）' : '对方已提交成果（自检未完全通过）',
    };
    record = await this.appendLocalOnly(record, [delivered]);
    await opened.stop();

    const materialized = await this.issuer.materializePeerArtifact({
      title: terms.intent.slice(0, 80),
      text: artifactText,
      recordId: record.recordId,
      provenance: {
        kind: 'collaboration_delivery',
        recordId: record.recordId,
        sourceSubjectId: deliveryRef.sourceSubjectId,
        sourceArtifactId: deliveryRef.sourceArtifactId,
        sourceHeadVersionId: deliveryRef.sourceHeadVersionId,
        sourceContentDigest: digest,
        agreementTermsDigest: agreement.termsDigest,
      },
    });
    const materializeEv: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'delivered',
      authorSubjectId: record.initiator.subjectId,
      at: nowIso(),
      termsDigest: agreement.termsDigest,
      delivery: deliveryRef,
      localArtifactId: materialized.artifactId,
      localHeadVersionId: materialized.headVersionId,
      note: 'initiator_materialized',
    };
    record = await this.appendLocalOnly(record, [materializeEv]);
    await this.syncFullRecordToPeer(record).catch(() => undefined);
    return record;
  }

  async resolvePeer(granteePackageDir: string): Promise<CollabPeerPreview> {
    const peer = await this.transport.resolvePeer(granteePackageDir);
    const dir = path.resolve(granteePackageDir);
    return {
      displayName: peer.displayName,
      packageDir: dir,
      subjectId: peer.subjectId,
      endpointRef: peer.endpointRef,
      ...(peer.brief ? { brief: peer.brief } : {}),
    };
  }

  /**
   * 发起协作提议。同设备验证阶段随后自动触发 B 评估（规则内自动，越界 JIT）。
   */
  async propose(input: {
    responderPackageDir?: string;
    /** 远程配对端点（dmep:…）；与 responderPackageDir 二选一 */
    responderEndpointRef?: string;
    proposal: CollaborationProposalTerms;
    issuerTaskId?: string;
    /** 为 true 时不自动评估（测试用）。 */
    skipAutoEvaluate?: boolean;
  }): Promise<{
    recordId: string;
    status: CollabUserStatus;
    grantId?: string;
    evaluationBasis?: string[];
    requiresOwnerConfirmation?: boolean;
  }> {
    const issuerPkg = this.issuer.subject.requireActive();
    const intent = input.proposal.intent.trim();
    if (!intent) throw new Error('collaboration intent required');

    let responder: SubjectRef;
    let initiatorEndpointRef = `subject:${issuerPkg.id}`;

    if (input.responderEndpointRef) {
      const { isRemoteEndpointRef, parseRemoteEndpointRef } = await import(
        '../subject-comm/endpoint'
      );
      if (!isRemoteEndpointRef(input.responderEndpointRef)) {
        throw new Error('responderEndpointRef 必须是远程端点');
      }
      const collabTransport = this.transport as LocalPackageTransport;
      const relay = collabTransport.asSubjectTransport();
      const { RelayTransport } = await import('../subject-comm/relay-transport');
      if (!(relay instanceof RelayTransport)) {
        throw new Error('远程协作需要 RelayTransport');
      }
      const epId = parseRemoteEndpointRef(input.responderEndpointRef);
      const peer = epId ? await relay.identityStore().getPeer(epId) : null;
      if (!peer) throw new Error('尚未与对方建立连接');
      const self = await relay.identityStore().getLocalProfile();
      if (!self) throw new Error('尚未配置远程端点');
      responder = {
        subjectId: peer.subjectId,
        displayName: peer.displayName,
        endpointRef: input.responderEndpointRef,
      };
      initiatorEndpointRef = `dmep:${self.endpointId}`;
    } else {
      if (!input.responderPackageDir) {
        throw new Error('propose requires responderPackageDir or responderEndpointRef');
      }
      const resolved = await this.transport.resolvePeer(input.responderPackageDir);
      responder = {
        subjectId: resolved.subjectId,
        displayName: resolved.displayName,
        endpointRef: resolved.endpointRef,
      };
    }

    const materials = input.proposal.offeredMaterials.map((m) => ({
      path: normPath(m.path),
      ...(m.summary ? { summary: m.summary } : {}),
    }));
    for (const m of materials) await fs.access(m.path);

    const terms: CollaborationProposalTerms = {
      ...input.proposal,
      intent,
      expectedOutcome: input.proposal.expectedOutcome.trim() || intent,
      offeredMaterials: materials,
      acceptanceCriteria: [...input.proposal.acceptanceCriteria],
    };
    const digest = termsDigestOf(terms);
    const at = nowIso();
    const recordId = newId('collaborationRecord');
    const proposed: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'proposed',
      authorSubjectId: issuerPkg.id,
      at,
      termsDigest: digest,
      terms,
    };
    const initiator: SubjectRef = {
      subjectId: issuerPkg.id,
      displayName: issuerPkg.identity.displayName,
      endpointRef: initiatorEndpointRef,
    };
    // 仅本地路径登记；远程不写 package path
    if (!input.responderEndpointRef) {
      await this.transport.registerEndpoint(initiator, issuerPkg.rootDir);
    }

    const record: CollaborationRecord = {
      id: recordId,
      recordId,
      initiator,
      responder: {
        subjectId: responder.subjectId,
        displayName: responder.displayName,
        endpointRef: responder.endpointRef,
      },
      proposal: terms,
      events: [proposed],
      createdAt: at,
      updatedAt: at,
      ...(input.issuerTaskId ? { issuerTaskId: input.issuerTaskId } : {}),
    };
    await this.saveLocal(record);
    await this.transport.pushEvents({
      endpointRef: responder.endpointRef,
      recordId,
      events: [proposed],
      seedRecord: record,
    });

    if (input.skipAutoEvaluate) {
      return { recordId, status: deriveCollabStatus(record) };
    }
    return this.autoEvaluateAndMaybeAgree(recordId);
  }

  /** B 规则内自动评估；越界返回 awaiting_owner。可运行于发起方（本地开 B）或接收方自身 runtime。 */
  async autoEvaluateAndMaybeAgree(recordId: string): Promise<{
    recordId: string;
    status: CollabUserStatus;
    grantId?: string;
    evaluationBasis?: string[];
    requiresOwnerConfirmation?: boolean;
  }> {
    let record = await this.reconcile(recordId);
    const selfId = this.issuer.subject.requireActive().id;
    const amResponder = selfId === record.responder.subjectId;
    // 发起方视角 peer=B；接收方视角 peer=A。
    const peerRef = amResponder ? record.initiator.endpointRef : record.responder.endpointRef;

    let opened: Awaited<ReturnType<CollaborationTransport['openByEndpointRef']>> | null = null;
    let evalRuntime = this.issuer;
    if (!amResponder) {
      // 发起方本地代 B 评估（仅本地路径）
      opened = await this.transport.openByEndpointRef(record.responder.endpointRef);
      evalRuntime = opened.runtime;
      // 在 B 侧注册 A 的 endpoint，便于 B 回推
      await new LocalPackageTransport(opened.runtime).registerEndpoint(
        record.initiator,
        this.issuer.subject.requireActive().rootDir,
      );
    }
    try {
      const terms = latestTerms(record);
      const evaluation = await evaluateProposalForSubject(evalRuntime, terms);
      const at = nowIso();

      if (evaluation.requiresOwnerConfirmation || evaluation.decision === 'require_owner_confirmation') {
        const ev: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'owner_confirmation_required',
          authorSubjectId: record.responder.subjectId,
          at,
          note: evaluation.note,
          evaluationBasis: evaluation.basis,
          requiresOwnerConfirmation: true,
        };
        record = await this.appendAndSync(record, [ev], peerRef);
        return {
          recordId,
          status: deriveCollabStatus(record),
          evaluationBasis: evaluation.basis,
          requiresOwnerConfirmation: true,
        };
      }

      if (evaluation.decision === 'reject') {
        const ev: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'rejected',
          authorSubjectId: record.responder.subjectId,
          at,
          note: evaluation.note,
          evaluationBasis: evaluation.basis,
        };
        record = await this.appendAndSync(record, [ev], peerRef);
        return { recordId, status: deriveCollabStatus(record), evaluationBasis: evaluation.basis };
      }

      if (evaluation.decision === 'request_clarification') {
        const ev: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'clarification_requested',
          authorSubjectId: record.responder.subjectId,
          at,
          note: evaluation.note,
          ...(evaluation.terms ? { terms: evaluation.terms, termsDigest: termsDigestOf(evaluation.terms) } : {}),
          evaluationBasis: evaluation.basis,
        };
        record = await this.appendAndSync(record, [ev], peerRef);
        return { recordId, status: deriveCollabStatus(record), evaluationBasis: evaluation.basis };
      }

      if (evaluation.decision === 'counter_propose' && evaluation.terms) {
        const counterDigest = termsDigestOf(evaluation.terms);
        const counterEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'counter_proposed',
          authorSubjectId: record.responder.subjectId,
          at,
          terms: evaluation.terms,
          termsDigest: counterDigest,
          note: evaluation.note,
          evaluationBasis: evaluation.basis,
        };
        record = await this.appendAndSync(record, [counterEv], peerRef);
        // 发起方代 B 评估时自动接受还价；接收方自身运行时交由发起方决定（不自我代答）。
        if (amResponder) {
          return { recordId, status: deriveCollabStatus(record), evaluationBasis: evaluation.basis };
        }
        return this.acceptTerms(recordId, counterDigest, evaluation.terms, evaluation.basis);
      }

      // accept
      const acceptDigest = termsDigestOf(evaluation.terms || terms);
      const acceptEv: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'accepted',
        authorSubjectId: record.responder.subjectId,
        at,
        termsDigest: acceptDigest,
        terms: evaluation.terms || terms,
        note: evaluation.note,
        evaluationBasis: evaluation.basis,
      };
      record = await this.appendAndSync(record, [acceptEv], peerRef);
      return this.finalizeAgreementIfReady(recordId, evaluation.basis);
    } finally {
      if (opened) {
        await opened.stop();
      }
    }
  }

  /** 发起方接受对方还价（绑定同一 termsDigest）。 */
  async acceptTerms(
    recordId: string,
    termsDigest: string,
    terms: CollaborationProposalTerms,
    evaluationBasis?: string[],
  ): Promise<{
    recordId: string;
    status: CollabUserStatus;
    grantId?: string;
    evaluationBasis?: string[];
  }> {
    let record = await this.reconcile(recordId);
    const selfId = this.issuer.subject.requireActive().id;
    const at = nowIso();
    const acceptEv: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'accepted',
      authorSubjectId: selfId,
      at,
      termsDigest,
      terms,
      note: '接受对方调整后的协作条件',
    };
    const peer =
      record.initiator.subjectId === selfId ? record.responder : record.initiator;
    record = await this.appendAndSync(record, [acceptEv], peer.endpointRef);
    return this.finalizeAgreementIfReady(recordId, evaluationBasis);
  }

  private async finalizeAgreementIfReady(
    recordId: string,
    evaluationBasis?: string[],
  ): Promise<{
    recordId: string;
    status: CollabUserStatus;
    grantId?: string;
    evaluationBasis?: string[];
  }> {
    let record = await this.reconcile(recordId);
    if (findAgreement(record)) {
      const existingGrantId = latestGrantId(record);
      return {
        recordId,
        status: deriveCollabStatus(record),
        ...(existingGrantId ? { grantId: existingGrantId } : {}),
        ...(evaluationBasis ? { evaluationBasis } : {}),
      };
    }
    const digest = tryFormAgreementDigest(record);
    if (!digest) {
      return {
        recordId,
        status: deriveCollabStatus(record),
        ...(evaluationBasis ? { evaluationBasis } : {}),
      };
    }
    const terms = latestTerms(record);
    if (termsDigestOf(terms) !== digest) {
      // 找到对应 digest 的条款快照
      for (let i = record.events.length - 1; i >= 0; i -= 1) {
        const ev = record.events[i];
        if (ev?.termsDigest === digest && ev.terms) {
          Object.assign(terms, ev.terms);
          break;
        }
      }
    }
    const at = nowIso();
    const agreementEv: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'agreement_formed',
      authorSubjectId: record.initiator.subjectId,
      at,
      termsDigest: digest,
      terms,
      note: '双方已对同一条款摘要达成约定',
    };
    const peerEndpoint =
      this.selfRole(record) === 'initiator'
        ? record.responder.endpointRef
        : record.initiator.endpointRef;
    record = await this.appendAndSync(record, [agreementEv], peerEndpoint);

    // 签发纯授权 Grant
    const grant: AuthorizationGrant = {
      id: newId('grant'),
      grantorSubjectId: record.initiator.subjectId,
      grantee: { kind: 'remote_subject', subjectId: record.responder.subjectId },
      scope: {
        actions: [...LOCAL_COLLAB_ACTIONS],
        resourceRefs: terms.offeredMaterials.map((m) => normPath(m.path)),
      },
      origin: {
        kind: 'collaboration_agreement',
        recordId: record.recordId,
        agreementEventId: agreementEv.eventId,
        termsDigest: digest,
      },
      status: 'granted',
      grantedAt: at,
    };
    await this.persistGrantBothSides(record, grant);

    const grantEv: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'grant_issued',
      authorSubjectId: record.initiator.subjectId,
      at: nowIso(),
      grantId: grant.id,
      termsDigest: digest,
      // 远端对端无法直写对方 GrantStore：随事件承载完整授权，供其本地重建。
      grant,
    };
    record = await this.appendAndSync(record, [grantEv], peerEndpoint);

    return {
      recordId,
      status: deriveCollabStatus(record),
      grantId: grant.id,
      ...(evaluationBasis ? { evaluationBasis } : {}),
    };
  }

  async respond(input: {
    recordId: string;
    decision: 'accept' | 'reject' | 'counter_propose' | 'request_clarification';
    terms?: CollaborationProposalTerms;
    note?: string;
  }): Promise<{ recordId: string; status: CollabUserStatus; grantId?: string }> {
    let record = await this.reconcile(input.recordId);
    const selfId = this.issuer.subject.requireActive().id;
    const at = nowIso();
    const peer =
      record.initiator.subjectId === selfId ? record.responder : record.initiator;

    if (input.decision === 'reject') {
      const ev: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'rejected',
        authorSubjectId: selfId,
        at,
        ...(input.note ? { note: input.note } : {}),
      };
      record = await this.appendAndSync(record, [ev], peer.endpointRef);
      return { recordId: record.recordId, status: deriveCollabStatus(record) };
    }
    if (input.decision === 'request_clarification') {
      const ev: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'clarification_requested',
        authorSubjectId: selfId,
        at,
        ...(input.note ? { note: input.note } : {}),
      };
      record = await this.appendAndSync(record, [ev], peer.endpointRef);
      return { recordId: record.recordId, status: deriveCollabStatus(record) };
    }
    if (input.decision === 'counter_propose') {
      if (!input.terms) throw new Error('counter_propose requires terms');
      const digest = termsDigestOf(input.terms);
      const ev: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'counter_proposed',
        authorSubjectId: selfId,
        at,
        terms: input.terms,
        termsDigest: digest,
        ...(input.note ? { note: input.note } : {}),
      };
      record = await this.appendAndSync(record, [ev], peer.endpointRef);
      return { recordId: record.recordId, status: deriveCollabStatus(record) };
    }
    const terms = input.terms || latestTerms(record);
    const digest = termsDigestOf(terms);
    const ev: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'accepted',
      authorSubjectId: selfId,
      at,
      terms,
      termsDigest: digest,
      ...(input.note ? { note: input.note } : {}),
    };
    record = await this.appendAndSync(record, [ev], peer.endpointRef);
    return this.finalizeAgreementIfReady(record.recordId);
  }

  /**
   * B 履行约定。立即落盘 fulfillment_started，修复「running 不可达」。
   */
  async fulfill(recordId: string): Promise<{
    recordId: string;
    grantId?: string;
    status: CollabUserStatus;
    artifactId?: string;
    artifactText?: string;
    localArtifactId?: string;
    jobId?: string;
    denied?: boolean;
    reason?: string;
    reachedModel?: boolean;
    capabilityId?: string;
  }> {
    let record = await this.reconcile(recordId);
    const alreadyDecided = latestOwnerDecision(record);
    if (alreadyDecided === 'accept' || alreadyDecided === 'reject') {
      const existingGrantId = latestGrantId(record);
      return {
        recordId,
        status: deriveCollabStatus(record),
        denied: true,
        reason: '协作结果已验收，不能重复履行',
        ...(existingGrantId ? { grantId: existingGrantId } : {}),
      };
    }

    // 幂等：已交付则直接返回（必要时 reconcile 已补齐物化）
    const existingDelivery = latestDelivery(record);
    if (existingDelivery?.delivery) {
      const localId = [...record.events].reverse().find((e) => e.localArtifactId)?.localArtifactId;
      let artifactText: string | undefined;
      if (localId) {
        try {
          const got = await this.issuer.getContent({ artifactId: localId });
          artifactText = got.text ?? '';
        } catch {
          artifactText = undefined;
        }
      }
      return {
        recordId,
        status: deriveCollabStatus(record),
        ...(latestGrantId(record) ? { grantId: latestGrantId(record)! } : {}),
        ...(localId ? { localArtifactId: localId } : {}),
        ...(artifactText !== undefined ? { artifactText } : {}),
        ...(existingDelivery.jobId ? { jobId: existingDelivery.jobId } : {}),
        ...(existingDelivery.delivery.sourceArtifactId
          ? { artifactId: existingDelivery.delivery.sourceArtifactId }
          : {}),
      };
    }

    const currentStatus = deriveCollabStatus(record);
    if (currentStatus === 'running') {
      const runningGrantId = latestGrantId(record);
      return {
        recordId,
        status: 'running',
        denied: true,
        reason: '对方仍在处理，请稍后再打开查看',
        ...(runningGrantId ? { grantId: runningGrantId } : {}),
      };
    }

    const agreement = findAgreement(record);
    if (!agreement?.termsDigest) {
      return { recordId, status: deriveCollabStatus(record), denied: true, reason: '尚未形成协作约定' };
    }
    const grantId = latestGrantId(record);
    if (!grantId) {
      return { recordId, status: deriveCollabStatus(record), denied: true, reason: '尚未签发授权' };
    }
    const grant = await this.resolveGrant(record, grantId);
    if (!grant) {
      return { recordId, status: 'failed', denied: true, reason: 'grant not found', grantId };
    }
    try {
      assertGrantUsable(grant);
    } catch (err) {
      return {
        recordId,
        grantId,
        status: 'revoked',
        denied: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const terms = latestTerms(record);
    const allowed = terms.offeredMaterials.map((m) => normPath(m.path));
    const contextRefs: ContextRef[] = allowed.map((p) => ({ kind: 'file', path: p }));
    const amResponder = this.selfRole(record) === 'responder';

    const started: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'fulfillment_started',
      authorSubjectId: record.responder.subjectId,
      at: nowIso(),
      grantId,
      termsDigest: agreement.termsDigest,
    };
    // 履行前先落本方 running 事实；对端同步延后到 Runtime 关闭后，避免并发 open 打断 Job
    record = await this.appendLocalOnly(record, [started]);

    /** B 本机履行：不 open 自己；A 代履约时 open B。 */
    let responderOpened: Awaited<ReturnType<CollaborationTransport['openByEndpointRef']>> | null =
      null;
    let executionRuntime: DigitalMeRuntime = this.issuer;
    if (!amResponder) {
      responderOpened = await this.transport.openByEndpointRef(record.responder.endpointRef);
      const bGrantStore = await GrantStore.open(
        responderOpened.runtime.subject.requireActive().rootDir,
      );
      await bGrantStore.put(grant);
      executionRuntime = responderOpened.runtime;
    }

    try {
      let submitted: { taskId: string; jobId: string };
      try {
        submitted = await executionRuntime.submitTask({
          goal: terms.intent,
          contextRefs,
          requestedArtifactType: 'document',
          authorization: {
            grantId: grant.id,
            issuerSubjectId: grant.grantorSubjectId,
            granteeSubjectId: executionRuntime.subject.requireActive().id,
          },
        });
      } catch (err) {
        const failMessage = err instanceof Error ? err.message : String(err);
        const failEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'fulfillment_started',
          authorSubjectId: record.responder.subjectId,
          at: nowIso(),
          grantId,
          note: `fail:${failMessage}`,
        };
        record = await this.appendLocalOnly(record, [failEv]);
        await this.syncFullRecordToPeer(record);
        return { recordId, grantId, status: 'failed', reason: failMessage };
      }

      const jobLink: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'fulfillment_started',
        authorSubjectId: record.responder.subjectId,
        at: nowIso(),
        grantId,
        taskId: submitted.taskId,
        jobId: submitted.jobId,
        note: 'job_linked',
      };
      record = await this.appendLocalOnly(record, [jobLink]);

      const job = await waitForJobTerminal(executionRuntime.workRuntime, submitted.jobId, 180_000);
      if (job.status !== 'succeeded' || !job.artifactId) {
        const failMessage = job.progress?.note?.trim() || String(job.status);
        const failEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'delivered',
          authorSubjectId: record.responder.subjectId,
          at: nowIso(),
          grantId,
          jobId: job.id,
          note: `fail:${failMessage}`,
          selfCheck: { passed: false, notes: [failMessage] },
        };
        record = await this.appendLocalOnly(record, [failEv]);
        await this.syncFullRecordToPeer(record);
        return {
          recordId,
          grantId,
          status: 'failed',
          jobId: job.id,
          reason: failMessage,
          reachedModel: job.capabilityId === OPENAI_COMPATIBLE_CAPABILITY_ID,
          ...(job.capabilityId ? { capabilityId: job.capabilityId } : {}),
        };
      }

      const content = await executionRuntime.getContent({ artifactId: job.artifactId });
      const artifactText = content.text ?? '';
      const digest = contentDigest(artifactText);
      const check = selfCheckDelivery({ text: artifactText, terms });

      await executionRuntime.appendOwnerEvent({
        type: 'experience_confirmed',
        confidence: 'confirmed',
        source: {
          kind: 'task_feedback',
          taskId: submitted.taskId,
          artifactId: job.artifactId,
        },
        payload: {
          title: '完成协作履行',
          detail: `已完成：${terms.intent}`.slice(0, 400),
          tags: ['collab:fulfilled', 'document', `collab:record:${recordId}`],
          evidence: {
            artifactId: job.artifactId,
            toVersionId: content.artifact.headVersionId,
          },
        },
      });

      const deliveryRef = {
        sourceSubjectId: executionRuntime.subject.requireActive().id,
        sourceArtifactId: job.artifactId,
        sourceHeadVersionId: content.artifact.headVersionId,
        contentDigest: digest,
        agreementEventId: agreement.eventId,
        termsDigest: agreement.termsDigest,
      };
      const delivered: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'delivered',
        authorSubjectId: record.responder.subjectId,
        at: nowIso(),
        grantId,
        taskId: submitted.taskId,
        jobId: job.id,
        termsDigest: agreement.termsDigest,
        delivery: deliveryRef,
        selfCheck: check,
        // 远端发起方无法打开本方包：把成果内容随事件承载，供其物化（不发完整 SubjectPackage）。
        ...(isRemoteEndpointRef(record.initiator.endpointRef)
          ? { artifactText }
          : {}),
        note: check.passed ? '对方已提交成果（含自检）' : '对方已提交成果（自检未完全通过）',
      };
      record = await this.appendLocalOnly(record, [delivered]);

      if (responderOpened) {
        await responderOpened.stop();
        responderOpened = null;
      }

      // 远端发起方由对方自行物化；仅本地发起方由本方直接物化。
      const remoteInitiator = isRemoteEndpointRef(record.initiator.endpointRef);
      if (amResponder && remoteInitiator) {
        await this.syncFullRecordToPeer(record);
        return {
          recordId,
          grantId,
          status: deriveCollabStatus(record),
          artifactId: job.artifactId,
          artifactText,
          jobId: job.id,
          reachedModel: job.capabilityId === OPENAI_COMPATIBLE_CAPABILITY_ID,
          ...(job.capabilityId ? { capabilityId: job.capabilityId } : {}),
        };
      }

      // 在发起方物化成果（本方是 A 则本地；本方是 B 则 open A）
      let materializeRuntime: DigitalMeRuntime = this.issuer;
      let initiatorOpened: Awaited<
        ReturnType<CollaborationTransport['openByEndpointRef']>
      > | null = null;
      if (amResponder) {
        initiatorOpened = await this.transport.openByEndpointRef(record.initiator.endpointRef);
        materializeRuntime = initiatorOpened.runtime;
      }
      try {
        const materialized = await materializeRuntime.materializePeerArtifact({
          title: terms.intent.slice(0, 80),
          text: artifactText,
          recordId,
          provenance: {
            kind: 'collaboration_delivery',
            recordId,
            sourceSubjectId: deliveryRef.sourceSubjectId,
            sourceArtifactId: deliveryRef.sourceArtifactId,
            sourceHeadVersionId: deliveryRef.sourceHeadVersionId,
            sourceContentDigest: digest,
            agreementTermsDigest: agreement.termsDigest,
          },
        });

        if (initiatorOpened) {
          await initiatorOpened.stop();
          initiatorOpened = null;
        }

        const materializeEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'delivered',
          authorSubjectId: record.initiator.subjectId,
          at: nowIso(),
          termsDigest: agreement.termsDigest,
          delivery: deliveryRef,
          localArtifactId: materialized.artifactId,
          localHeadVersionId: materialized.headVersionId,
          note: 'initiator_materialized',
        };
        record = await this.appendLocalOnly(record, [materializeEv]);
        await this.syncFullRecordToPeer(record);

        return {
          recordId,
          grantId,
          status: deriveCollabStatus(record),
          artifactId: job.artifactId,
          artifactText,
          localArtifactId: materialized.artifactId,
          jobId: job.id,
          reachedModel: job.capabilityId === OPENAI_COMPATIBLE_CAPABILITY_ID,
          ...(job.capabilityId ? { capabilityId: job.capabilityId } : {}),
        };
      } finally {
        if (initiatorOpened) {
          try {
            await initiatorOpened.stop();
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      if (responderOpened) {
        try {
          await responderOpened.stop();
        } catch {
          /* ignore */
        }
      }
      const failMessage = err instanceof Error ? err.message : String(err);
      try {
        const failEv: CollaborationEvent = {
          eventId: newId('collaborationEvent'),
          kind: 'fulfillment_started',
          authorSubjectId: record.responder.subjectId,
          at: nowIso(),
          grantId,
          note: `recoverable_fail:${failMessage}`,
        };
        record = await this.appendLocalOnly(record, [failEv]);
        await this.syncFullRecordToPeer(record).catch(() => undefined);
      } catch {
        /* 尽量落失败态；若写盘失败仍向上抛出 */
      }
      return {
        recordId,
        grantId,
        status: 'failed',
        reason: failMessage,
      };
    }
  }

  async requestRevision(input: {
    recordId: string;
    note: string;
  }): Promise<{
    recordId: string;
    status: CollabUserStatus;
    artifactText?: string;
    localArtifactId?: string;
  }> {
    let record = await this.reconcile(input.recordId);
    const selfId = this.issuer.subject.requireActive().id;
    const revEv: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'revision_requested',
      authorSubjectId: selfId,
      at: nowIso(),
      note: input.note.trim(),
    };
    record = await this.appendAndSync(record, [revEv], record.responder.endpointRef);

    const terms = latestTerms(record);
    const revisedTerms: CollaborationProposalTerms = {
      ...terms,
      intent: `${terms.intent}\n\n修订说明：${input.note.trim()}`,
    };
    const opened = await this.transport.openByEndpointRef(record.responder.endpointRef);
    try {
      const grantId = latestGrantId(record);
      if (!grantId) throw new Error('missing grant');
      const grant = await this.resolveGrant(record, grantId);
      if (!grant) throw new Error('grant not found');
      assertGrantUsable(grant);
      const bGrantStore = await GrantStore.open(opened.runtime.subject.requireActive().rootDir);
      await bGrantStore.put(grant);

      const allowed = terms.offeredMaterials.map((m) => normPath(m.path));
      const submitted = await opened.runtime.submitTask({
        goal: revisedTerms.intent,
        contextRefs: allowed.map((p) => ({ kind: 'file' as const, path: p })),
        requestedArtifactType: 'document',
        intentKind: 'create_document',
        authorization: {
          grantId: grant.id,
          issuerSubjectId: grant.grantorSubjectId,
          granteeSubjectId: opened.runtime.subject.requireActive().id,
        },
      });
      if (!submitted.jobId) {
        await opened.stop();
        return {
          recordId: record.recordId,
          status: 'failed',
        };
      }
      const job = await waitForJobTerminal(opened.runtime.workRuntime, submitted.jobId, 180_000);
      if (job.status !== 'succeeded' || !job.artifactId) {
        await opened.stop();
        return { recordId: record.recordId, status: 'failed' };
      }
      const content = await opened.runtime.getContent({ artifactId: job.artifactId });
      const artifactText = content.text ?? '';
      const digest = contentDigest(artifactText);
      const agreement = findAgreement(record);
      if (!agreement?.termsDigest) throw new Error('missing agreement');
      const prevLocal = [...record.events]
        .reverse()
        .find((e) => e.localArtifactId)?.localArtifactId;

      const deliveryRef = {
        sourceSubjectId: opened.runtime.subject.requireActive().id,
        sourceArtifactId: job.artifactId,
        sourceHeadVersionId: content.artifact.headVersionId,
        contentDigest: digest,
        agreementEventId: agreement.eventId,
        termsDigest: agreement.termsDigest,
      };
      const delivered: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'delivered',
        authorSubjectId: record.responder.subjectId,
        at: nowIso(),
        grantId,
        taskId: submitted.taskId,
        jobId: job.id,
        termsDigest: agreement.termsDigest,
        delivery: deliveryRef,
        selfCheck: selfCheckDelivery({ text: artifactText, terms }),
        note: 'revision_delivery',
      };
      record = await this.appendLocalOnly(record, [delivered]);
      await opened.stop();

      const materialized = await this.issuer.materializePeerArtifact({
        title: terms.intent.slice(0, 80),
        text: artifactText,
        recordId: record.recordId,
        provenance: {
          kind: 'collaboration_delivery',
          recordId: record.recordId,
          sourceSubjectId: deliveryRef.sourceSubjectId,
          sourceArtifactId: deliveryRef.sourceArtifactId,
          sourceHeadVersionId: deliveryRef.sourceHeadVersionId,
          sourceContentDigest: digest,
          agreementTermsDigest: agreement.termsDigest,
        },
        ...(prevLocal ? { existingArtifactId: prevLocal } : {}),
      });

      const matEv: CollaborationEvent = {
        eventId: newId('collaborationEvent'),
        kind: 'delivered',
        authorSubjectId: record.initiator.subjectId,
        at: nowIso(),
        delivery: deliveryRef,
        localArtifactId: materialized.artifactId,
        localHeadVersionId: materialized.headVersionId,
        note: 'initiator_materialized_revision',
      };
      record = await this.appendLocalOnly(record, [matEv]);
      await this.syncFullRecordToPeer(record);

      return {
        recordId: record.recordId,
        status: deriveCollabStatus(record),
        artifactText,
        localArtifactId: materialized.artifactId,
      };
    } catch (err) {
      try {
        await opened.stop();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  async decideResult(input: {
    recordId: string;
    decision: 'accept' | 'reject';
    note?: string;
  }): Promise<{
    recordId: string;
    status: CollabUserStatus;
    issuerEventId: string;
    granteeEventId?: string;
    localArtifactId?: string;
    verificationSatisfied?: boolean;
  }> {
    let record = await this.reconcile(input.recordId);
    const delivery = latestDelivery(record);
    if (!delivery?.delivery) throw new Error('尚无协作成果可验收');

    // 幂等：已有最终决定则直接返回
    const existing = latestOwnerDecision(record);
    if (existing === 'accept' || existing === 'reject') {
      return {
        recordId: record.recordId,
        status: deriveCollabStatus(record),
        issuerEventId: 'idempotent',
        ...(delivery.localArtifactId ? { localArtifactId: delivery.localArtifactId } : {}),
      };
    }

    const terms = latestTerms(record);
    let text = '';
    const localId =
      [...record.events].reverse().find((e) => e.localArtifactId)?.localArtifactId;
    if (localId) {
      const got = await this.issuer.getContent({ artifactId: localId });
      text = got.text ?? '';
    }
    const verification = verifyDeliveryByInitiator({
      text,
      terms,
      contentDigestMatches: contentDigest(text) === delivery.delivery.contentDigest || !text,
    });
    // 最终由 A 定案：用户决策优先；验证信息随事件记录
    const at = nowIso();
    const decideEv: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'result_decided',
      authorSubjectId: record.initiator.subjectId,
      at,
      decision: input.decision,
      verification: {
        satisfied: input.decision === 'accept' ? verification.satisfied : false,
        notes: verification.notes,
      },
      ...(localId ? { localArtifactId: localId, artifactDecisionRef: localId } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    record = await this.appendAndSync(record, [decideEv], record.responder.endpointRef);

    const note = (input.note || '').trim();
    const detailBase =
      input.decision === 'accept'
        ? `采用协作成果：${terms.intent}`
        : `未采用协作成果：${terms.intent}`;
    const detail =
      `${detailBase}${note ? `\n${note}` : ''}\nrecord ${record.recordId}; peer ${record.responder.subjectId}`.slice(
        0,
        400,
      );

    const issuerEvent = await this.issuer.appendOwnerEvent({
      type: 'experience_confirmed',
      confidence: 'confirmed',
      source: {
        kind: 'task_feedback',
        ...(record.issuerTaskId ? { taskId: record.issuerTaskId } : {}),
        ...(localId ? { artifactId: localId } : {}),
      },
      payload: {
        title: input.decision === 'accept' ? '采用了协作成果' : '未采用协作成果',
        detail,
        tags: [
          input.decision === 'accept' ? 'collab:external_accept' : 'collab:external_reject',
          input.decision === 'accept' ? 'decision:accept' : 'decision:reject',
          'document',
          `collab:record:${record.recordId}`,
          `collab:peer:${record.responder.subjectId}`,
        ],
        ...(localId
          ? {
              evidence: {
                artifactId: localId,
                toVersionId:
                  [...record.events].reverse().find((e) => e.localHeadVersionId)
                    ?.localHeadVersionId || localId,
              },
            }
          : {}),
      },
    });

    // 通知 B：被采用/拒绝
    let granteeEventId: string | undefined;
    try {
      const opened = await this.transport.openByEndpointRef(record.responder.endpointRef);
      try {
        const ge = await opened.runtime.appendOwnerEvent({
          type: 'experience_confirmed',
          confidence: 'confirmed',
          source: { kind: 'owner_direct' },
          payload: {
            title:
              input.decision === 'accept' ? '协作成果被对方采用' : '协作成果未被对方采用',
            detail: `record ${record.recordId}; ${input.decision}`.slice(0, 400),
            tags: [
              input.decision === 'accept' ? 'collab:accepted_by_peer' : 'collab:rejected_by_peer',
              `collab:record:${record.recordId}`,
            ],
          },
        });
        granteeEventId = ge.id;
      } finally {
        await opened.stop();
      }
    } catch {
      /* 对端不可达时发起方记录仍成立 */
    }

    return {
      recordId: record.recordId,
      status: deriveCollabStatus(record),
      issuerEventId: issuerEvent.id,
      ...(granteeEventId ? { granteeEventId } : {}),
      ...(localId ? { localArtifactId: localId } : {}),
      ...(decideEv.verification?.satisfied !== undefined
        ? { verificationSatisfied: decideEv.verification.satisfied }
        : {}),
    };
  }

  async revoke(recordIdOrGrantId: string): Promise<{
    recordId?: string;
    grantId?: string;
    status: CollabUserStatus;
  }> {
    // 兼容：可能传入 recordId 或 grantId
    const store = await this.recordStore();
    let record = await store.get(recordIdOrGrantId);
    if (!record) {
      const all = await store.list();
      record =
        all.find((r) => latestGrantId(r) === recordIdOrGrantId) ||
        null;
    }
    if (!record) {
      // 旧 Grant 路径
      const gStore = await this.grantStore();
      const grant = await gStore.get(recordIdOrGrantId);
      if (grant && grant.status !== 'revoked') {
        grant.status = 'revoked';
        grant.revokedAt = nowIso();
        await gStore.put(grant);
      }
      return { grantId: recordIdOrGrantId, status: 'revoked' };
    }

    record = await this.reconcile(record.recordId);
    const grantId = latestGrantId(record);
    if (grantId) {
      const grant = await this.resolveGrant(record, grantId);
      if (grant && grant.status !== 'revoked') {
        grant.status = 'revoked';
        grant.revokedAt = nowIso();
        await this.persistGrantBothSides(record, grant);
      }
    }
    const ev: CollaborationEvent = {
      eventId: newId('collaborationEvent'),
      kind: 'revoked',
      authorSubjectId: this.issuer.subject.requireActive().id,
      at: nowIso(),
      ...(grantId ? { grantId } : {}),
    };
    record = await this.appendAndSync(record, [ev], record.responder.endpointRef);
    return {
      recordId: record.recordId,
      ...(grantId ? { grantId } : {}),
      status: 'revoked',
    };
  }

  async getStatus(recordIdOrGrantId: string): Promise<{
    recordId: string;
    grantId?: string;
    status: CollabUserStatus;
    role?: 'initiator' | 'responder';
    peerDisplayName?: string;
    ownerDecision?: 'accept' | 'reject' | 'revise';
    grant?: {
      id: string;
      status: string;
      subtaskGoal?: string;
      granteeDisplayName?: string;
      returnedExcerpt?: string;
      reachedModel?: boolean;
      allowedMaterials?: string[];
      issuerTaskId?: string;
      failureMessage?: string;
      ownerDecision?: 'accept' | 'reject' | 'revise';
      localArtifactId?: string;
      termsDigest?: string;
      evaluationBasis?: string[];
    };
    artifactId?: string;
    artifactText?: string;
  }> {
    const store = await this.recordStore();
    let record = await store.get(recordIdOrGrantId);
    if (!record) {
      const all = await store.list();
      record = all.find((r) => latestGrantId(r) === recordIdOrGrantId) || null;
    }
    if (!record) throw new Error(`collaboration record not found: ${recordIdOrGrantId}`);
    record = await this.reconcile(record.recordId);

    const terms = latestTerms(record);
    const delivery = latestDelivery(record);
    const grantId = latestGrantId(record);
    const ownerDecision = latestOwnerDecision(record);
    const agreement = findAgreement(record);
    const evalBasis = [...record.events]
      .reverse()
      .find((e) => e.evaluationBasis)?.evaluationBasis;
    const localId = [...record.events].reverse().find((e) => e.localArtifactId)?.localArtifactId;

    let artifactText: string | undefined;
    if (localId) {
      try {
        const got = await this.issuer.getContent({ artifactId: localId });
        artifactText = got.text;
      } catch {
        artifactText = undefined;
      }
    }

    return {
      recordId: record.recordId,
      ...(grantId ? { grantId } : {}),
      status: deriveCollabStatus(record),
      role: this.selfRole(record),
      peerDisplayName:
        this.selfRole(record) === 'initiator'
          ? record.responder.displayName
          : record.initiator.displayName,
      ...(ownerDecision ? { ownerDecision } : {}),
      grant: {
        id: grantId || record.recordId,
        status: deriveCollabStatus(record),
        subtaskGoal: terms.intent,
        granteeDisplayName: record.responder.displayName,
        ...(artifactText ? { returnedExcerpt: artifactText.slice(0, 800) } : {}),
        allowedMaterials: terms.offeredMaterials.map((m) => m.path),
        ...(record.issuerTaskId ? { issuerTaskId: record.issuerTaskId } : {}),
        ...(ownerDecision ? { ownerDecision } : {}),
        ...(localId ? { localArtifactId: localId } : {}),
        ...(agreement?.termsDigest ? { termsDigest: agreement.termsDigest } : {}),
        ...(evalBasis ? { evaluationBasis: evalBasis } : {}),
      },
      ...(localId ? { artifactId: localId } : {}),
      ...(artifactText ? { artifactText } : {}),
    };
  }

  async list(): Promise<{ items: CollabListItem[] }> {
    const store = await this.recordStore();
    const records = await store.list();
    const items: CollabListItem[] = [];
    for (const raw of records) {
      const record = await this.reconcile(raw.recordId).catch(() => raw);
      const terms = latestTerms(record);
      const delivery = latestDelivery(record);
      const grantId = latestGrantId(record);
      const ownerDecision = latestOwnerDecision(record);
      const localId = [...record.events].reverse().find((e) => e.localArtifactId)?.localArtifactId;
      let excerpt: string | undefined;
      if (localId) {
        try {
          const got = await this.issuer.getContent({ artifactId: localId });
          excerpt = (got.text || '').slice(0, 800);
        } catch {
          excerpt = undefined;
        }
      }
      const evalBasis = [...record.events]
        .reverse()
        .find((e) => e.evaluationBasis)?.evaluationBasis;
      items.push({
        recordId: record.recordId,
        ...(grantId ? { grantId } : {}),
        status: deriveCollabStatus(record),
        role: this.selfRole(record),
        peerDisplayName:
          this.selfRole(record) === 'initiator'
            ? record.responder.displayName
            : record.initiator.displayName,
        ...(ownerDecision ? { ownerDecision } : {}),
        subtaskGoal: terms.intent,
        granteeDisplayName: record.responder.displayName,
        allowedMaterials: terms.offeredMaterials.map((m) => m.path),
        ...(excerpt ? { returnedExcerpt: excerpt } : {}),
        ...(record.issuerTaskId ? { issuerTaskId: record.issuerTaskId } : {}),
        ...(localId ? { localArtifactId: localId } : {}),
        ...(evalBasis ? { evaluationBasis: evalBasis } : {}),
      });
    }
    // 兼容：仍列出仅有旧 Grant 扩展字段的记录
    const gStore = await this.grantStore();
    for (const grant of await gStore.list()) {
      if (!grant.subtaskGoal && !grant.granteePackageDir) continue;
      if (items.some((i) => i.grantId === grant.id)) continue;
      items.push({
        recordId: grant.id,
        grantId: grant.id,
        status:
          grant.status === 'revoked'
            ? 'revoked'
            : grant.returnedArtifact
              ? 'delivered'
              : 'authorized',
        ...(grant.subtaskGoal ? { subtaskGoal: grant.subtaskGoal } : {}),
        ...(grant.granteeDisplayName ? { granteeDisplayName: grant.granteeDisplayName } : {}),
        allowedMaterials: (grant.scope.resourceRefs ?? []).map(normPath),
        ...(grant.returnedArtifact?.textExcerpt
          ? { returnedExcerpt: grant.returnedArtifact.textExcerpt }
          : {}),
        ...(grant.issuerTaskId ? { issuerTaskId: grant.issuerTaskId } : {}),
      });
    }
    items.sort((a, b) => b.recordId.localeCompare(a.recordId));
    return { items };
  }

  async assertMaterialAccess(
    recordIdOrGrantId: string,
    materialPath: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const store = await this.recordStore();
    let record = await store.get(recordIdOrGrantId);
    if (!record) {
      const all = await store.list();
      record = all.find((r) => latestGrantId(r) === recordIdOrGrantId) || null;
    }
    const target = normPath(materialPath);
    if (record) {
      const allowed = latestTerms(record).offeredMaterials.map((m) => normPath(m.path));
      if (!allowed.includes(target)) {
        return { allowed: false, reason: 'material not in authorization scope' };
      }
      const grantId = latestGrantId(record);
      if (!grantId) {
        return { allowed: false, reason: 'collaboration not yet authorized' };
      }
      const grant = await this.resolveGrant(record, grantId);
      if (!grant) {
        return { allowed: false, reason: 'grant not found' };
      }
      try {
        assertGrantUsable(grant);
      } catch (err) {
        return {
          allowed: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      return { allowed: true };
    }
    const grant = await (await this.grantStore()).get(recordIdOrGrantId);
    if (!grant) return { allowed: false, reason: 'grant not found' };
    try {
      assertGrantUsable(grant);
    } catch (err) {
      return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
    }
    const allowed = (grant.scope.resourceRefs ?? []).map(normPath);
    if (!allowed.includes(target)) {
      return { allowed: false, reason: 'material not in authorization scope' };
    }
    return { allowed: true };
  }
}

/** @deprecated 仅测试替身。 */
export function buildLegacySimulationRequest(input: {
  grantorSubjectId: string;
  grantorDisplayName: string;
  granteeName: string;
  goal: string;
}): { request: InteractionRequest; grant: AuthorizationGrant } {
  const at = nowIso();
  const granteeSubjectId = newId('subject');
  const request: InteractionRequest = {
    id: newId('interactionRequest'),
    fromSubject: {
      subjectId: granteeSubjectId,
      displayName: input.granteeName,
    },
    toSubject: {
      subjectId: input.grantorSubjectId,
      displayName: input.grantorDisplayName,
    },
    requestedScope: { actions: [...LOCAL_COLLAB_ACTIONS] },
    goal: input.goal,
    createdAt: at,
    mode: 'local_simulation',
  };
  const grant: AuthorizationGrant = {
    id: newId('grant'),
    grantorSubjectId: input.grantorSubjectId,
    grantee: { kind: 'remote_subject', subjectId: granteeSubjectId },
    scope: { actions: [...LOCAL_COLLAB_ACTIONS] },
    origin: {
      kind: 'interaction_request',
      requestId: request.id,
      requestSummary: { fromDisplayName: input.granteeName, goal: input.goal },
    },
    status: 'granted',
    grantedAt: at,
  };
  return { request, grant };
}
