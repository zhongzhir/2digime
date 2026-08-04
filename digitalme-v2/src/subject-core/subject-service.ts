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
import { InMemoryEventBus } from '../work-runtime/event-bus';

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

  constructor(private readonly eventBus?: InMemoryEventBus) {}

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
    // readiness 仅为提示,调用方不得据此拒绝 submitTask
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
    };
  }

  /**
   * 兼容旧名:确认候选。内部按类型确认,实践反馈 → experience_confirmed。
   */
  async confirmExperience(input: { eventIds: string[] }): Promise<{ confirmedCount: number }> {
    return this.confirmCandidates(input);
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

  /**
   * 统一捕获自然语言并生成候选 — 使用即构建的主入口。
   * 当前 Task 仍可直接使用用户原文(goal);未确认候选不进入长期权威注入。
   */
  async captureInput(input: {
    text: string;
    sourceKind: SubjectCaptureSourceKind;
    materialRef?: string;
    taskId?: string;
    artifactId?: string;
  }): Promise<{ candidateEventIds: string[]; confirmationSuggestedEventIds: string[] }> {
    const pkg = this.requireActive();
    const text = input.text.trim();
    if (!text) {
      return { candidateEventIds: [], confirmationSuggestedEventIds: [] };
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

    const distilled = distillCandidatesFromText({
      subjectId: pkg.id,
      text,
      sourceKind: input.sourceKind,
      ...(materialRef ? { materialRef } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    });

    const candidateEventIds: string[] = [];
    const confirmationSuggestedEventIds: string[] = [];
    for (const event of distilled) {
      await this.appendGrowthEvent(event);
      candidateEventIds.push(event.id);
      if (requiresOwnerConfirmation(event.type, event.payload.tags ?? [])) {
        confirmationSuggestedEventIds.push(event.id);
      }
    }
    return { candidateEventIds, confirmationSuggestedEventIds };
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

async function readTextPreview(filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.includes(0)) return '';
    return buf.toString('utf8').slice(0, 4000);
  } catch {
    return '';
  }
}
