import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { newId, nowIso } from '../shared/ids';
import type { CommandMap } from '../runtime/commands';
import {
  SUBJECT_PACKAGE_LAYOUT,
  type SubjectPackage,
} from './subject-package';
import {
  confirmCandidate,
  type GrowthEvent,
} from './growth-event';
import { PackageGrowthLog, readDerivedJson, writeDerivedJson } from './package-growth-log';
import { deriveAllViews, type SubjectDerivedBundle } from './derive-all';
import {
  distillCandidatesFromText,
  requiresOwnerConfirmation,
  type SubjectCaptureSourceKind,
} from './candidate-distill';
import { scheduleGrowthWork } from './growth-async';
import { structuredDistillToEvents } from './structured-distill';
import { authorityFromEvents } from './growth-signal';
import {
  findJitConflict,
  injectionExclusionsForJit,
  type JitChoiceAction,
  type JitConflictPrompt,
  type JitResolution,
} from './jit-confirmation';
import type { SubjectDistillModelRuntime } from './distill-model-runtime';
import {
  deriveArtifactOwnerDecision,
  hasSameVersionDecision,
  type ArtifactOwnerDecision,
} from './artifact-decision';
import { buildUserFacingSubjectSlices } from './user-facing-overview';
import { InMemoryEventBus } from '../work-runtime/event-bus';
import {
  deriveCaptureOutcome,
  type CaptureOutcome,
} from './capture-outcome';

export const SUBJECT_SCHEMA_VERSION = 1 as const;

type CreateInput = CommandMap['subject.createPackage']['input'];
type OpenInput = CommandMap['subject.openPackage']['input'];
type OverviewOutput = CommandMap['subject.getOverview']['output'];

/**
 * SubjectService — 单实例挂载一个 active SubjectPackage。
 * 领域层不得绕过 GrowthEvent 手改派生视图;派生缓存可删可重建。
 *
 * 产品入口纪律:
 * - 创建后即可做事;subjectReadiness 仅为派生提示,永不阻断 Task;
 * - 一句话自我说明即可开始;候选可来自对话/任务/材料/成果反馈等;
 * - 低打扰:仅 C 类建议确认;低风险保持 candidate,不冒充 confirmed。
 */
export class SubjectService {
  private active: SubjectPackage | null = null;
  private growthLog: PackageGrowthLog<GrowthEvent> | null = null;
  private cachedDerived: SubjectDerivedBundle | null = null;
  /** 即将使用前的自然语言冲突确认（不落第二 Store） */
  private pendingJitByTask = new Map<string, JitConflictPrompt>();
  private jitSeen = new Set<string>();
  private jitResolutions = new Map<string, JitResolution>();
  /** 蒸馏诊断（不打扰用户） */
  private lastDistillDiscarded: Array<{ reason: string; title: string }> = [];
  private lastDistillMode: 'model' | 'contract' | 'model_fallback_contract' | 'none' = 'none';
  private lastNormalizeTrace: unknown[] = [];
  private distillRuntime: SubjectDistillModelRuntime | null = null;

  constructor(private readonly eventBus?: InMemoryEventBus) {}

  /** 由 Runtime 注入：与做事模型同一 SecretAccessor / openaiCompatible。 */
  setDistillModelRuntime(runtime: SubjectDistillModelRuntime | null): void {
    this.distillRuntime = runtime;
  }

  getLastDistillMode(): typeof this.lastDistillMode {
    return this.lastDistillMode;
  }

  getLastNormalizeTrace(): unknown[] {
    return [...this.lastNormalizeTrace];
  }

  getActive(): SubjectPackage | null {
    return this.active;
  }

  requireActive(): SubjectPackage {
    if (!this.active) throw new Error('no active subject package');
    return this.active;
  }

  async createPackage(input: CreateInput): Promise<{ subjectId: string }> {
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('displayName must not be empty');
    const rootDir = path.resolve(input.targetDir);
    await fs.mkdir(rootDir, { recursive: true });

    const existing = await this.tryReadManifest(rootDir);
    if (existing) {
      throw new Error(`target already contains a subject package: ${rootDir}`);
    }

    const pkg: SubjectPackage = {
      id: newId('subject'),
      schemaVersion: SUBJECT_SCHEMA_VERSION,
      createdAt: nowIso(),
      identity: { displayName },
      rootDir,
    };
    await this.writeManifest(pkg);
    await fs.mkdir(path.join(rootDir, 'growth'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'materials'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'derived'), { recursive: true });
    await fs.writeFile(path.join(rootDir, SUBJECT_PACKAGE_LAYOUT.growthEvents), '', 'utf8');

    this.mount(pkg);
    await this.rebuildDerivedViews();

    const initial = input.initialSelfDescription?.trim();
    if (initial) {
      // 一句话即可开始:保存来源并生成少量候选;不要求填写完整档案,不阻断后续 Task
      await this.captureInput({
        text: initial,
        sourceKind: 'initial_self_description',
      });
    }

    return { subjectId: pkg.id };
  }

  async openPackage(input: OpenInput): Promise<{ subjectId: string; displayName: string }> {
    const rootDir = path.resolve(input.dir);
    const pkg = await this.tryReadManifest(rootDir);
    if (!pkg) throw new Error(`not a subject package: ${rootDir}`);
    if (pkg.schemaVersion !== SUBJECT_SCHEMA_VERSION) {
      throw new Error(
        `unsupported schemaVersion ${pkg.schemaVersion}; expected ${SUBJECT_SCHEMA_VERSION}`,
      );
    }
    pkg.rootDir = rootDir;
    this.mount(pkg);
    await this.rebuildDerivedViews();
    return { subjectId: pkg.id, displayName: pkg.identity.displayName };
  }

  async getOverview(_input: Record<string, never> = {}): Promise<OverviewOutput> {
    const pkg = this.requireActive();
    const derived = await this.getDerived();
    const slices = buildUserFacingSubjectSlices(derived);
    // readiness 仅为提示,调用方不得据此拒绝 submitTask
    const materials = await this.listSubjectMaterials();
    return {
      subjectId: pkg.id,
      displayName: pkg.identity.displayName,
      confirmedExperienceCount: derived.confirmed.entries.length,
      candidateExperiences: derived.candidates.entries.map((e) => ({
        eventId: e.eventId,
        title: e.title,
        detail: e.detail,
        type: e.type,
        requiresConfirmation: requiresOwnerConfirmation(e.type, e.tags),
      })),
      confirmationSuggestedEventIds: derived.candidates.entries
        .filter((e) => requiresOwnerConfirmation(e.type, e.tags))
        .map((e) => e.eventId),
      readiness: derived.readiness,
      readinessBlocksTasks: false,
      summaryLine: derived.summary.displayLine,
      knowledgeGapCount: derived.knowledgeGaps.entries.length,
      activeUnderstandings: slices.activeUnderstandings,
      recentLearnings: slices.recentLearnings,
      helpfulQuestions: slices.helpfulQuestions,
      materials,
    };
  }

  /**
   * 兼容旧名:确认候选。内部按类型确认,实践反馈 → experience_confirmed。
   */
  async confirmExperience(input: { eventIds: string[] }): Promise<{ confirmedCount: number }> {
    return this.confirmCandidates(input);
  }

  /**
   * 轻量响应用户对要点的处理 — 不暴露事件类型名。
   * JIT：use_a_once / use_b_once / prefer_a / prefer_b / defer。
   */
  async respondToLearning(input: {
    eventId: string;
    action:
      | 'adopt'
      | 'dismiss'
      | 'retire'
      | 'revise'
      | 'use_a_once'
      | 'use_b_once'
      | 'prefer_a'
      | 'prefer_b'
      | 'defer';
    revisionText?: string;
    peerEventId?: string;
    taskId?: string;
  }): Promise<{ ok: boolean }> {
    const jitActions: JitChoiceAction[] = [
      'use_a_once',
      'use_b_once',
      'prefer_a',
      'prefer_b',
      'defer',
    ];
    if (jitActions.includes(input.action as JitChoiceAction)) {
      return this.resolveJitChoice({
        action: input.action as JitChoiceAction,
        eventIdA: input.eventId,
        eventIdB: input.peerEventId || '',
        ...(input.taskId ? { taskId: input.taskId } : {}),
      });
    }

    const pkg = this.requireActive();
    const events = await this.requireLog().list(pkg.id);
    const target = events.find((e) => e.id === input.eventId);
    if (!target) throw new Error('item not found');

    if (input.action === 'adopt') {
      if (target.confidence !== 'candidate') {
        throw new Error('item is not awaiting confirmation');
      }
      await this.confirmCandidates({ eventIds: [input.eventId] });
      return { ok: true };
    }

    if (input.action === 'dismiss' || input.action === 'retire') {
      const correction: GrowthEvent = {
        id: newId('growthEvent'),
        subjectId: pkg.id,
        occurredAt: nowIso(),
        type: 'subject_corrected',
        source: { kind: 'owner_direct' },
        payload: {
          title: input.action === 'retire' ? '不再使用该要点' : '暂时不采用该要点',
          detail: target.payload.title,
          tags: ['action:reject'],
          relation: { targetEventId: input.eventId },
        },
        confidence: 'confirmed',
      };
      await this.appendGrowthEvent(correction);
      return { ok: true };
    }

    const revision = input.revisionText?.trim();
    if (!revision) throw new Error('revision text required');

    const reject: GrowthEvent = {
      id: newId('growthEvent'),
      subjectId: pkg.id,
      occurredAt: nowIso(),
      type: 'subject_corrected',
      source: { kind: 'owner_direct' },
      payload: {
        title: '已按你的修改更新',
        detail: target.payload.title,
        tags: ['action:replace'],
        relation: { targetEventId: input.eventId },
      },
      confidence: 'confirmed',
    };
    await this.appendGrowthEvent(reject);

    if (target.confidence === 'candidate') {
      const replacement: GrowthEvent = {
        id: newId('growthEvent'),
        subjectId: pkg.id,
        occurredAt: nowIso(),
        type: target.type === 'feedback_recorded' ? 'feedback_recorded' : target.type,
        source: { kind: 'owner_direct' },
        payload: {
          title: revision.slice(0, 80),
          detail: revision,
          tags: [...(target.payload.tags ?? []).filter((t) => t !== 'needs_confirmation'), 'revised'],
        },
        confidence: 'candidate',
      };
      await this.appendGrowthEvent(replacement);
      if (requiresOwnerConfirmation(replacement.type, replacement.payload.tags ?? [])) {
        // C 类仍保持待确认;用户可再点「以后这样做」
        return { ok: true };
      }
      await this.confirmCandidates({ eventIds: [replacement.id] });
      return { ok: true };
    }

    const replacementConfirmed: GrowthEvent = {
      id: newId('growthEvent'),
      subjectId: pkg.id,
      occurredAt: nowIso(),
      type:
        target.type === 'experience_confirmed' || target.type === 'feedback_recorded'
          ? 'experience_confirmed'
          : target.type,
      source: { kind: 'owner_direct' },
      payload: {
        title: revision.slice(0, 80),
        detail: revision,
        tags: [...(target.payload.tags ?? []), 'revised'],
        relation: { supersedes: input.eventId },
      },
      confidence: 'confirmed',
    };
    await this.appendGrowthEvent(replacementConfirmed);
    return { ok: true };
  }

  /** JIT 决议：仅本次 / 以后优先 / 暂不决定。 */
  async resolveJitChoice(input: JitResolution): Promise<{ ok: boolean }> {
    const key = input.taskId || `${input.eventIdA}|${input.eventIdB}`;
    this.jitResolutions.set(key, input);
    this.jitResolutions.set(`${input.eventIdA}|${input.eventIdB}`, input);
    if (input.taskId) this.pendingJitByTask.delete(input.taskId);

    if (input.action === 'prefer_a') {
      const events = await this.requireLog().list(this.requireActive().id);
      const b = events.find((e) => e.id === input.eventIdB);
      if (b?.confidence === 'candidate') {
        await this.respondToLearning({ eventId: input.eventIdB, action: 'dismiss' });
      } else if (b) {
        await this.respondToLearning({ eventId: input.eventIdB, action: 'retire' });
      }
      return { ok: true };
    }
    if (input.action === 'prefer_b') {
      const events = await this.requireLog().list(this.requireActive().id);
      const b = events.find((e) => e.id === input.eventIdB);
      if (b?.confidence === 'candidate') {
        await this.confirmCandidates({ eventIds: [input.eventIdB] });
      }
      // 旧权威退居：retire A（以后优先 B）
      const a = events.find((e) => e.id === input.eventIdA);
      if (a && a.confidence === 'confirmed') {
        await this.respondToLearning({ eventId: input.eventIdA, action: 'retire' });
      }
      return { ok: true };
    }
    // use_once / defer：仅任务作用域，不改长期权威
    return { ok: true };
  }

  /**
   * 任务即将注入前：检测冲突、登记自然语言提示、返回应排除的事件与是否暂停外部行动。
   */
  async prepareJitForTask(input: {
    taskId: string;
    goal: string;
  }): Promise<{
    prompt: JitConflictPrompt | null;
    excludeEventIds: string[];
    includeEventIds: string[];
    pauseExternalAction: boolean;
  }> {
    const derived = await this.getDerived();
    const found = findJitConflict({
      goal: input.goal,
      derived,
    });
    if (!found) {
      return {
        prompt: null,
        excludeEventIds: [],
        includeEventIds: [],
        pauseExternalAction: false,
      };
    }

    const resolution =
      this.jitResolutions.get(input.taskId) ||
      this.jitResolutions.get(`${found.eventIdA}|${found.eventIdB}`) ||
      null;
    const excl = injectionExclusionsForJit({ prompt: found, resolution });

    // 已对同一冲突展示过：不再弹，但仍用保守排除
    if (this.jitSeen.has(found.fingerprint) && !resolution) {
      this.pendingJitByTask.set(input.taskId, found);
      return {
        prompt: null,
        excludeEventIds: excl.excludeEventIds,
        includeEventIds: excl.includeEventIds,
        pauseExternalAction: excl.pauseExternalAction,
      };
    }

    this.pendingJitByTask.set(input.taskId, found);
    if (!resolution) this.jitSeen.add(found.fingerprint);

    return {
      prompt: resolution ? null : found,
      excludeEventIds: excl.excludeEventIds,
      includeEventIds: excl.includeEventIds,
      pauseExternalAction: excl.pauseExternalAction,
    };
  }

  peekJitPrompt(taskId: string): JitConflictPrompt | null {
    return this.pendingJitByTask.get(taskId) || null;
  }

  getLastDistillDiscarded(): Array<{ reason: string; title: string }> {
    return [...this.lastDistillDiscarded];
  }

  async confirmCandidates(input: { eventIds: string[] }): Promise<{ confirmedCount: number }> {
    const pkg = this.requireActive();
    const log = this.requireLog();
    const events = await log.list(pkg.id);
    const byId = new Map(events.map((e) => [e.id, e]));
    const alreadyConfirmed = new Set(
      events.filter((e) => e.confirms).map((e) => e.confirms),
    );

    let confirmedCount = 0;
    for (const eventId of input.eventIds) {
      const candidate = byId.get(eventId);
      if (!candidate) throw new Error(`event not found: ${eventId}`);
      if (candidate.confidence !== 'candidate') {
        throw new Error(`event ${eventId} is not a candidate`);
      }
      if (alreadyConfirmed.has(eventId)) {
        throw new Error(`event ${eventId} already confirmed`);
      }
      const confirmed = confirmCandidate(candidate, newId('growthEvent'), nowIso());
      if (candidate.payload.evidence && !confirmed.payload.evidence) {
        confirmed.payload = { ...confirmed.payload, evidence: candidate.payload.evidence };
      }
      await log.append(confirmed);
      alreadyConfirmed.add(eventId);
      confirmedCount += 1;
    }
    this.cachedDerived = null;
    await this.rebuildDerivedViews();
    this.eventBus?.publish({
      kind: 'subject.updated',
      subjectId: pkg.id,
      summary: `confirmed ${confirmedCount} item(s)`,
    });
    return { confirmedCount };
  }

  async appendGrowthEvent(event: GrowthEvent): Promise<void> {
    const pkg = this.requireActive();
    if (event.subjectId !== pkg.id) {
      throw new Error('growth event subjectId mismatch');
    }
    await this.requireLog().append(event);
    this.cachedDerived = null;
    await this.rebuildDerivedViews();
    this.eventBus?.publish({
      kind: 'subject.updated',
      subjectId: pkg.id,
      summary: `growth event ${event.type}`,
    });
  }

  async listGrowthEvents(): Promise<GrowthEvent[]> {
    const pkg = this.requireActive();
    return this.requireLog().list(pkg.id);
  }

  async getDerived(): Promise<SubjectDerivedBundle> {
    if (this.cachedDerived) return this.cachedDerived;
    return this.rebuildDerivedViews();
  }

  async wipeDerivedCache(): Promise<void> {
    const pkg = this.requireActive();
    const derivedDir = path.join(pkg.rootDir, 'derived');
    await fs.rm(derivedDir, { recursive: true, force: true });
    await fs.mkdir(derivedDir, { recursive: true });
    this.cachedDerived = null;
  }

  /** 由 GrowthEvent 派生当前 Artifact 版本的采用状态。 */
  async getArtifactOwnerDecision(
    artifactId: string,
    artifactVersionId: string,
  ): Promise<ArtifactOwnerDecision> {
    const pkg = this.requireActive();
    const events = await this.requireLog().list(pkg.id);
    return deriveArtifactOwnerDecision(events, artifactId, artifactVersionId);
  }

  /**
   * 统一捕获自然语言并生成候选 — 使用即构建的主入口。
   * 当前 Task 仍可直接使用用户原文(goal);未确认候选不进入长期权威注入。
   * 采用/不采用：用户按钮即决策，写入后自动确认进成长链；同版本同决策幂等。
   * captureOutcome 区分无可学 / 蒸馏失败 / 待确认 / 已学会；失败不得伪装成功。
   */
  async captureInput(input: {
    text: string;
    sourceKind: SubjectCaptureSourceKind;
    materialRef?: string;
    taskId?: string;
    artifactId?: string;
    artifactVersionId?: string;
    requestedArtifactType?: string;
    capabilityId?: string;
    capabilityVersion?: string;
    sourceCapabilityKind?: 'local' | 'external_capability';
    /** 幂等键（如 conversation:turnId / task_requirement:taskId），写入 tags。 */
    captureKey?: string;
    /** 修订要求 / 拒绝原因 / 版本差异短摘要 — 仅作蒸馏输入，不存全文。 */
    revisionRequest?: string;
    rejectionReason?: string;
    editSummary?: string;
    /** 助手回复截断上下文（不得归因于 Owner）。 */
    assistantContext?: string;
  }): Promise<{
    candidateEventIds: string[];
    confirmationSuggestedEventIds: string[];
    confirmedEventIds?: string[];
    idempotent?: boolean;
    ownerDecision?: 'undecided' | 'accepted' | 'rejected';
    captureOutcome: CaptureOutcome;
    /** 验收追溯：model | contract_fallback（合同为 contract）；不上用户面 */
    distillMode?: 'model' | 'contract' | 'model_fallback_contract' | 'none';
    normalizeTrace?: unknown[];
  }> {
    const pkg = this.requireActive();
    const isDecision =
      input.sourceKind === 'artifact_acceptance' || input.sourceKind === 'artifact_rejection';

    if (input.captureKey) {
      const existing = await this.requireLog().list(pkg.id);
      const keyTag = `captureKey:${input.captureKey}`;
      if (existing.some((e) => (e.payload.tags ?? []).includes(keyTag))) {
        return {
          candidateEventIds: [],
          confirmationSuggestedEventIds: [],
          confirmedEventIds: [],
          idempotent: true,
          captureOutcome: 'learned',
        };
      }
    }

    let text = input.text.trim();
    if (!text && isDecision) {
      text =
        input.sourceKind === 'artifact_acceptance'
          ? '用户采用了本次成果。'
          : '用户未采用本次成果。';
    }
    if (!text) {
      return {
        candidateEventIds: [],
        confirmationSuggestedEventIds: [],
        captureOutcome: 'nothing_to_learn',
      };
    }

    if (isDecision) {
      if (!input.artifactId || !input.artifactVersionId) {
        throw new Error('artifact decision requires artifactId and artifactVersionId');
      }
      const desired = input.sourceKind === 'artifact_acceptance' ? 'accepted' : 'rejected';
      const events = await this.requireLog().list(pkg.id);
      if (
        hasSameVersionDecision(events, input.artifactId, input.artifactVersionId, desired)
      ) {
        return {
          candidateEventIds: [],
          confirmationSuggestedEventIds: [],
          confirmedEventIds: [],
          idempotent: true,
          ownerDecision: desired,
          captureOutcome: 'learned',
        };
      }
    }

    // 自我说明/对话:落一份来源到 materials,便于追溯(非表单档案)
    let materialRef = input.materialRef;
    if (
      !materialRef &&
      (input.sourceKind === 'initial_self_description' ||
        input.sourceKind === 'conversation' ||
        input.sourceKind === 'task_requirement')
    ) {
      materialRef = await this.writeTextMaterial(
        text,
        input.sourceKind === 'initial_self_description' ? 'self' : 'note',
      );
    }

    const existing = await this.requireLog().list(pkg.id);
    const experienceText = buildExperienceDistillText({
      base: text,
      ...(input.revisionRequest ? { revisionRequest: input.revisionRequest } : {}),
      ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
      ...(input.editSummary ? { editSummary: input.editSummary } : {}),
    });

    let distilled: GrowthEvent[] = [];
    let distillFailed = false;
    try {
      if (isDecision) {
        // 采用/不采用为确定性决策事件，不经蒸馏质量门（避免误丢弃）
        distilled = distillCandidatesFromText({
          subjectId: pkg.id,
          text,
          sourceKind: input.sourceKind,
          ...(materialRef ? { materialRef } : {}),
          ...(input.taskId ? { taskId: input.taskId } : {}),
          ...(input.artifactId ? { artifactId: input.artifactId } : {}),
          ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
          ...(input.requestedArtifactType
            ? { requestedArtifactType: input.requestedArtifactType }
            : {}),
          ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
          ...(input.capabilityVersion ? { capabilityVersion: input.capabilityVersion } : {}),
          ...(input.sourceCapabilityKind
            ? { sourceCapabilityKind: input.sourceCapabilityKind }
            : {}),
          authority: authorityFromEvents(existing),
        });
        this.lastDistillDiscarded = [];
        this.lastDistillMode = 'contract';

        // 有来源的可复用经验：修改要求 / 拒绝原因 / 版本差异（禁止整篇正文）
        if (experienceText.length > text.length || input.revisionRequest || input.rejectionReason || input.editSummary) {
          const expOpts: Parameters<typeof structuredDistillToEvents>[0] = {
            subjectId: pkg.id,
            text: experienceText,
            sourceKind:
              input.sourceKind === 'artifact_rejection' ? 'repeated_correction' : 'artifact_edit',
            ...(input.taskId ? { taskId: input.taskId } : {}),
            ...(input.artifactId ? { artifactId: input.artifactId } : {}),
            ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
            ...(input.requestedArtifactType
              ? { requestedArtifactType: input.requestedArtifactType }
              : {}),
            existingEvents: existing,
          };
          if (this.distillRuntime?.enabled) {
            expOpts.chatComplete = this.distillRuntime.chatComplete;
            expOpts.model = {
              baseUrl: this.distillRuntime.model.baseUrl,
              model: this.distillRuntime.model.model,
            };
          }
          try {
            const exp = await structuredDistillToEvents(expOpts);
            distilled = [...distilled, ...exp.events];
            this.lastDistillDiscarded = [...this.lastDistillDiscarded, ...exp.discarded];
            this.lastDistillMode = exp.mode;
            this.lastNormalizeTrace = exp.normalizeTrace || [];
          } catch {
            // 决策事件已可写；附加经验蒸馏失败不抹掉决策，记为部分失败由 outcome 反映
            distillFailed = distilled.length === 0;
          }
        }
      } else {
        const distillText =
          input.sourceKind === 'conversation' && input.assistantContext
            ? `${text}\n\n（对话上下文，非用户观点）\n${input.assistantContext.slice(0, 400)}`
            : text;
        const distillOpts: Parameters<typeof structuredDistillToEvents>[0] = {
          subjectId: pkg.id,
          text: distillText,
          sourceKind: input.sourceKind,
          ...(materialRef ? { materialRef } : {}),
          ...(input.taskId ? { taskId: input.taskId } : {}),
          ...(input.artifactId ? { artifactId: input.artifactId } : {}),
          ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
          ...(input.requestedArtifactType
            ? { requestedArtifactType: input.requestedArtifactType }
            : {}),
          ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
          ...(input.capabilityVersion ? { capabilityVersion: input.capabilityVersion } : {}),
          ...(input.sourceCapabilityKind
            ? { sourceCapabilityKind: input.sourceCapabilityKind }
            : {}),
          existingEvents: existing,
        };
        if (this.distillRuntime?.enabled) {
          distillOpts.chatComplete = this.distillRuntime.chatComplete;
          distillOpts.model = {
            baseUrl: this.distillRuntime.model.baseUrl,
            model: this.distillRuntime.model.model,
          };
        }
        const result = await structuredDistillToEvents(distillOpts);
        distilled = result.events;
        this.lastDistillDiscarded = result.discarded;
        this.lastDistillMode = result.mode;
        this.lastNormalizeTrace = result.normalizeTrace || [];
      }
    } catch {
      // 硬失败：不得伪装为空成功
      this.lastDistillDiscarded = [{ reason: 'distill_failure', title: 'distill' }];
      this.lastDistillMode = this.distillRuntime?.enabled ? 'none' : 'none';
      return {
        candidateEventIds: [],
        confirmationSuggestedEventIds: [],
        distillMode: 'none',
        captureOutcome: 'distill_failed',
      };
    }

    if (distillFailed && distilled.length === 0) {
      return {
        candidateEventIds: [],
        confirmationSuggestedEventIds: [],
        distillMode: this.lastDistillMode,
        captureOutcome: 'distill_failed',
      };
    }

    const captureKeyTag = input.captureKey ? `captureKey:${input.captureKey}` : null;
    const candidateEventIds: string[] = [];
    const confirmationSuggestedEventIds: string[] = [];
    const silentAdoptIds: string[] = [];
    for (const event of distilled) {
      if (captureKeyTag) {
        const tags = event.payload.tags ?? [];
        if (!tags.includes(captureKeyTag)) {
          event.payload = { ...event.payload, tags: [...tags, captureKeyTag] };
        }
      }
      await this.appendGrowthEvent(event);
      candidateEventIds.push(event.id);
      const tags = event.payload.tags ?? [];
      if (tags.includes('silent_ok') && !requiresOwnerConfirmation(event.type, tags)) {
        silentAdoptIds.push(event.id);
      } else if (requiresOwnerConfirmation(event.type, tags)) {
        confirmationSuggestedEventIds.push(event.id);
      }
    }

    // 低风险静默采纳：写入后立即确认，不打断用户
    if (silentAdoptIds.length > 0 && !isDecision) {
      await this.confirmCandidates({ eventIds: silentAdoptIds });
    }

    if (isDecision && candidateEventIds.length > 0) {
      const decisionOnly = distilled.filter((e) =>
        (e.payload.tags ?? []).some((t) => t === 'decision:accept' || t === 'decision:reject'),
      );
      const toConfirm = decisionOnly.map((e) => e.id);
      const alsoSilent = silentAdoptIds.filter((id) => !toConfirm.includes(id));
      if (toConfirm.length > 0) {
        await this.confirmCandidates({ eventIds: toConfirm });
      }
      if (alsoSilent.length > 0) {
        await this.confirmCandidates({ eventIds: alsoSilent });
      }
      const decision = await this.getArtifactOwnerDecision(
        input.artifactId as string,
        input.artifactVersionId as string,
      );
      const captureOutcome = deriveCaptureOutcome({
        candidateCount: candidateEventIds.length,
        confirmationSuggestedCount: confirmationSuggestedEventIds.length,
        confirmedCount: toConfirm.length + alsoSilent.length,
      });
      return {
        candidateEventIds,
        confirmationSuggestedEventIds,
        confirmedEventIds: [...toConfirm, ...alsoSilent],
        idempotent: false,
        ownerDecision: decision.status,
        captureOutcome,
        distillMode: this.lastDistillMode,
        normalizeTrace: this.lastNormalizeTrace,
      };
    }

    const captureOutcome = deriveCaptureOutcome({
      candidateCount: candidateEventIds.length,
      confirmationSuggestedCount: confirmationSuggestedEventIds.length,
      confirmedCount: silentAdoptIds.length,
    });

    // 带 captureKey 的空结果仍写回执，供重放幂等；标记 capture:noop，不得注入任务。
    if (
      captureOutcome === 'nothing_to_learn' &&
      captureKeyTag &&
      candidateEventIds.length === 0
    ) {
      const receipt: GrowthEvent = {
        id: newId('growthEvent'),
        subjectId: pkg.id,
        occurredAt: nowIso(),
        type: 'feedback_recorded',
        source: {
          kind:
            input.sourceKind === 'task_requirement' ||
            input.sourceKind === 'artifact_acceptance' ||
            input.sourceKind === 'artifact_rejection'
              ? 'task_feedback'
              : 'owner_direct',
          ...(input.taskId ? { taskId: input.taskId } : {}),
          ...(input.artifactId ? { artifactId: input.artifactId } : {}),
        },
        payload: {
          title: '本次输入无可沉淀要点',
          detail: text.slice(0, 200),
          tags: [captureKeyTag, 'capture:noop', 'silent_ok'],
        },
        confidence: 'candidate',
      };
      await this.appendGrowthEvent(receipt);
      return {
        candidateEventIds: [receipt.id],
        confirmationSuggestedEventIds: [],
        distillMode: this.lastDistillMode,
        normalizeTrace: this.lastNormalizeTrace,
        captureOutcome: 'nothing_to_learn',
      };
    }

    return {
      candidateEventIds,
      confirmationSuggestedEventIds,
      ...(silentAdoptIds.length ? { confirmedEventIds: silentAdoptIds } : {}),
      distillMode: this.lastDistillMode,
      normalizeTrace: this.lastNormalizeTrace,
      captureOutcome,
    };
  }

  /**
   * 异步捕获成长信号：主任务只调度，不等待完成；蒸馏失败有限重试。
   */
  captureInputAsync(
    input: {
      text: string;
      sourceKind: SubjectCaptureSourceKind;
      materialRef?: string;
      taskId?: string;
      artifactId?: string;
      artifactVersionId?: string;
      requestedArtifactType?: string;
      capabilityId?: string;
      capabilityVersion?: string;
      sourceCapabilityKind?: 'local' | 'external_capability';
      captureKey?: string;
      revisionRequest?: string;
      rejectionReason?: string;
      editSummary?: string;
      assistantContext?: string;
    },
    onDone?: (result: {
      ok: boolean;
      attempts: number;
      captureOutcome?: CaptureOutcome;
      error?: string;
    }) => void,
  ): void {
    scheduleGrowthWork(
      async () => {
        const r = await this.captureInput(input);
        if (r.captureOutcome === 'distill_failed') {
          throw Object.assign(new Error('distill_failed'), { captureOutcome: r.captureOutcome });
        }
        return r;
      },
      {
        maxAttempts: 2,
        onDone: (r) => {
          const value = r.value as
            | { captureOutcome?: CaptureOutcome }
            | undefined;
          onDone?.({
            ok: r.ok,
            attempts: r.attempts,
            ...(value?.captureOutcome ? { captureOutcome: value.captureOutcome } : {}),
            ...(r.error ? { error: r.error } : {}),
            ...(!r.ok ? { captureOutcome: 'distill_failed' as const } : {}),
          });
        },
      },
    );
  }

  /**
   * 复制单文件到 materials/,返回稳定 materialRef,并可选经 captureInput 提炼候选。
   */
  async importSubjectMaterial(input: {
    sourcePath: string;
    distillCandidates?: boolean;
  }): Promise<{ materialRef: string; candidateEventIds: string[] }> {
    const pkg = this.requireActive();
    const sourcePath = path.resolve(input.sourcePath);
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error('importSubjectMaterial only accepts a single file');
    }
    const base = path.basename(sourcePath);
    const digest = createHash('sha256')
      .update(await fs.readFile(sourcePath))
      .digest('hex')
      .slice(0, 16);
    const safeBase = base.replace(/[^\w.\u4e00-\u9fff-]+/g, '_').slice(0, 80) || 'material';
    const materialRef = `materials/${digest}_${safeBase}`;
    const dest = path.join(pkg.rootDir, materialRef);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(sourcePath, dest);

    const candidateEventIds: string[] = [];
    if (input.distillCandidates !== false) {
      const text = await readTextPreview(dest);
      const asset: GrowthEvent = {
        id: newId('growthEvent'),
        subjectId: pkg.id,
        occurredAt: nowIso(),
        type: 'asset_added',
        source: { kind: 'import' },
        payload: {
          title: `已导入资料：${safeBase}`,
          detail: text.slice(0, 400) || `材料已保存为 ${materialRef}`,
          tags: ['material', 'import'],
          relation: { materialRef },
        },
        confidence: 'candidate',
      };
      await this.appendGrowthEvent(asset);
      candidateEventIds.push(asset.id);

      const captured = await this.captureInput({
        text: text || safeBase,
        sourceKind: 'imported_material',
        materialRef,
      });
      candidateEventIds.push(...captured.candidateEventIds);
    }

    return { materialRef, candidateEventIds };
  }

  /**
   * 列出 SubjectPackage/materials 下真实文件（不含包外原件）。
   */
  async listSubjectMaterials(): Promise<
    NonNullable<OverviewOutput['materials']>
  > {
    const pkg = this.requireActive();
    const materialsDir = path.join(pkg.rootDir, 'materials');
    let names: string[] = [];
    try {
      names = await fs.readdir(materialsDir);
    } catch {
      return [];
    }
    const items: NonNullable<OverviewOutput['materials']> = [];
    for (const name of names) {
      if (!name || name.startsWith('.')) continue;
      // 对话/自我说明自动落盘的 note_/self_ 不进「已添加的资料」列表
      if (name.startsWith('note_') || name.startsWith('self_')) continue;
      const absolutePath = path.join(materialsDir, name);
      let st;
      try {
        st = await fs.stat(absolutePath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const materialRef = `materials/${name}`;
      items.push({
        materialRef,
        fileName: displayMaterialFileName(name),
        addedAt: st.mtime.toISOString(),
        absolutePath,
      });
    }
    items.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
    return items;
  }

  /**
   * 仅删除包内副本，并软移除指向该资料的引用；不触碰包外原始文件。
   */
  async removeSubjectMaterial(input: {
    materialRef: string;
  }): Promise<{ removed: boolean }> {
    const pkg = this.requireActive();
    const ref = String(input.materialRef || '').replace(/\\/g, '/');
    if (!ref.startsWith('materials/') || ref.includes('..')) {
      throw new Error('invalid materialRef');
    }
    const dest = path.join(pkg.rootDir, ...ref.split('/'));
    const resolvedRoot = path.resolve(pkg.rootDir, 'materials');
    const resolvedDest = path.resolve(dest);
    if (
      resolvedDest !== resolvedRoot &&
      !resolvedDest.startsWith(resolvedRoot + path.sep)
    ) {
      throw new Error('material path escapes package');
    }
    let removedFile = false;
    try {
      await fs.unlink(resolvedDest);
      removedFile = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') throw err;
    }

    const events = await this.requireLog().list(pkg.id);
    const alreadyInactive = new Set(
      events
        .filter(
          (e) =>
            e.type === 'subject_corrected' &&
            e.confidence === 'confirmed' &&
            (e.payload.tags || []).some((t) => t === 'action:reject' || t === 'action:replace'),
        )
        .map((e) => e.payload.relation?.targetEventId)
        .filter((id): id is string => typeof id === 'string'),
    );

    const toInvalidate = new Set<string>();
    for (const event of events) {
      if (event.type === 'subject_corrected') continue;
      if (event.payload?.relation?.materialRef === ref) {
        toInvalidate.add(event.id);
      }
    }
    // 已确认副本若 confirms 指向上述候选，一并失效，避免悬空注入
    for (const event of events) {
      if (event.confirms && toInvalidate.has(event.confirms)) {
        toInvalidate.add(event.id);
      }
    }

    let corrections = 0;
    for (const eventId of toInvalidate) {
      if (alreadyInactive.has(eventId)) continue;
      const event = events.find((e) => e.id === eventId);
      if (!event) continue;
      const correction: GrowthEvent = {
        id: newId('growthEvent'),
        subjectId: pkg.id,
        occurredAt: nowIso(),
        type: 'subject_corrected',
        source: { kind: 'owner_direct' },
        payload: {
          title: '已移除资料引用',
          detail: event.payload.title || ref,
          tags: ['action:reject', 'material:removed'],
          relation: { targetEventId: event.id, materialRef: ref },
        },
        confidence: 'confirmed',
      };
      await this.appendGrowthEvent(correction);
      corrections += 1;
    }

    if (removedFile || corrections > 0) {
      this.cachedDerived = null;
      if (corrections === 0) {
        await this.rebuildDerivedViews();
      }
      this.eventBus?.publish({
        kind: 'subject.updated',
        subjectId: pkg.id,
        summary: `removed material ${ref}`,
      });
    }
    return { removed: removedFile || corrections > 0 };
  }

  private async writeTextMaterial(text: string, prefix: string): Promise<string> {
    const pkg = this.requireActive();
    const digest = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
    const materialRef = `materials/${prefix}_${digest}.txt`;
    const dest = path.join(pkg.rootDir, materialRef);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, text, 'utf8');
    return materialRef;
  }

  async rebuildDerivedViews(): Promise<SubjectDerivedBundle> {
    const pkg = this.requireActive();
    const events = await this.requireLog().list(pkg.id);
    const derived = deriveAllViews(pkg.id, events, nowIso());
    const dir = path.join(pkg.rootDir, 'derived');
    await fs.mkdir(dir, { recursive: true });
    await writeDerivedJson(path.join(dir, 'confirmed-experiences.json'), derived.confirmed);
    await writeDerivedJson(path.join(dir, 'candidates.json'), derived.candidates);
    await writeDerivedJson(path.join(dir, 'preferences.json'), derived.preferences);
    await writeDerivedJson(path.join(dir, 'goals.json'), derived.goals);
    await writeDerivedJson(path.join(dir, 'boundaries.json'), derived.boundaries);
    await writeDerivedJson(path.join(dir, 'assets.json'), derived.assets);
    await writeDerivedJson(path.join(dir, 'identity.json'), derived.identity);
    await writeDerivedJson(path.join(dir, 'principles.json'), derived.principles);
    await writeDerivedJson(path.join(dir, 'knowledge-gaps.json'), derived.knowledgeGaps);
    await writeDerivedJson(path.join(dir, 'summary.json'), derived.summary);
    await writeDerivedJson(path.join(dir, 'readiness.json'), { readiness: derived.readiness });
    await writeDerivedJson(path.join(dir, 'active-items.json'), derived.activeItems);
    this.cachedDerived = derived;
    return derived;
  }

  async readDerivedCacheOrRebuild(): Promise<SubjectDerivedBundle> {
    const pkg = this.requireActive();
    const dir = path.join(pkg.rootDir, 'derived');
    try {
      const confirmed = await readDerivedJson(path.join(dir, 'confirmed-experiences.json'));
      const candidates = await readDerivedJson(path.join(dir, 'candidates.json'));
      const preferences = await readDerivedJson(path.join(dir, 'preferences.json'));
      const goals = await readDerivedJson(path.join(dir, 'goals.json'));
      const boundaries = await readDerivedJson(path.join(dir, 'boundaries.json'));
      const assets = await readDerivedJson(path.join(dir, 'assets.json'));
      if (confirmed && candidates && preferences && goals && boundaries && assets) {
        // 缺新字段时重建,避免旧缓存残片
        const identity = await readDerivedJson(path.join(dir, 'identity.json'));
        if (!identity) return this.rebuildDerivedViews();
        return this.rebuildDerivedViews();
      }
    } catch {
      // fall through
    }
    return this.rebuildDerivedViews();
  }

  private mount(pkg: SubjectPackage): void {
    this.active = pkg;
    this.growthLog = new PackageGrowthLog<GrowthEvent>({ packageRoot: pkg.rootDir });
    this.cachedDerived = null;
  }

  private requireLog(): PackageGrowthLog<GrowthEvent> {
    if (!this.growthLog) throw new Error('no active subject package');
    return this.growthLog;
  }

  private async tryReadManifest(rootDir: string): Promise<SubjectPackage | null> {
    const manifestPath = path.join(rootDir, SUBJECT_PACKAGE_LAYOUT.manifest);
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as SubjectPackage;
      if (typeof parsed.id !== 'string' || typeof parsed.schemaVersion !== 'number') {
        return null;
      }
      return { ...parsed, rootDir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writeManifest(pkg: SubjectPackage): Promise<void> {
    const { rootDir, ...rest } = pkg;
    const manifestPath = path.join(rootDir, SUBJECT_PACKAGE_LAYOUT.manifest);
    await writeDerivedJson(manifestPath, rest);
  }
}

/** 导入文件名常为 `{16hex}_{原名}`；列表展示去掉摘要前缀。 */
function displayMaterialFileName(storedName: string): string {
  const m = /^[a-f0-9]{16}_(.+)$/i.exec(storedName);
  return m?.[1] || storedName;
}

/** 组装有来源的短蒸馏文本；禁止塞入成果全文。 */
function buildExperienceDistillText(input: {
  base: string;
  revisionRequest?: string;
  rejectionReason?: string;
  editSummary?: string;
}): string {
  const parts = [input.base.trim()];
  const rejection = String(input.rejectionReason || '').trim();
  if (rejection) parts.push(`拒绝原因：${rejection.slice(0, 300)}`);
  const revision = String(input.revisionRequest || '').trim();
  if (revision) parts.push(`修改要求：${revision.slice(0, 300)}`);
  const edit = String(input.editSummary || '').trim();
  if (edit) parts.push(`版本差异：${edit.slice(0, 400)}`);
  return parts.filter(Boolean).join('\n').slice(0, 1200);
}

async function readTextPreview(filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.includes(0)) return '';
    return buf.toString('utf8').slice(0, 4000);
  } catch {
    return '';
  }
}
