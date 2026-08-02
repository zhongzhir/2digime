import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
import { InMemoryEventBus } from '../work-runtime/event-bus';

export const SUBJECT_SCHEMA_VERSION = 1 as const;

type CreateInput = CommandMap['subject.createPackage']['input'];
type OpenInput = CommandMap['subject.openPackage']['input'];
type OverviewOutput = CommandMap['subject.getOverview']['output'];

/**
 * SubjectService — 单实例挂载一个 active SubjectPackage。
 * 领域层不得绕过 GrowthEvent 手改派生视图;派生缓存可删可重建。
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
    return {
      subjectId: pkg.id,
      displayName: pkg.identity.displayName,
      confirmedExperienceCount: derived.confirmed.entries.length,
      candidateExperiences: derived.candidates.entries.map((e) => ({
        eventId: e.eventId,
        title: e.title,
        detail: e.detail,
      })),
    };
  }

  async confirmExperience(input: { eventIds: string[] }): Promise<{ confirmedCount: number }> {
    const pkg = this.requireActive();
    const log = this.requireLog();
    const events = await log.list(pkg.id);
    const byId = new Map(events.map((e) => [e.id, e]));
    const alreadyConfirmed = new Set(
      events.filter((e) => e.type === 'experience_confirmed' && e.confirms).map((e) => e.confirms),
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
      // 确认事件必须保留 evidence
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
      summary: `confirmed ${confirmedCount} experience(s)`,
    });
    return { confirmedCount };
  }

  /**
   * 追加 GrowthEvent。回流失败由调用方捕获;
   * 本方法本身在重复 id / 序列化错误时抛错。
   */
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

  /** 删除派生缓存后仍可通过重放完全重建。 */
  async wipeDerivedCache(): Promise<void> {
    const pkg = this.requireActive();
    const derivedDir = path.join(pkg.rootDir, 'derived');
    await fs.rm(derivedDir, { recursive: true, force: true });
    await fs.mkdir(derivedDir, { recursive: true });
    this.cachedDerived = null;
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
    this.cachedDerived = derived;
    return derived;
  }

  /** 读取缓存(若损坏则重建)。 */
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
        const bundle = {
          confirmed,
          candidates,
          preferences,
          goals,
          boundaries,
          assets,
        } as SubjectDerivedBundle;
        this.cachedDerived = bundle;
        return bundle;
      }
    } catch {
      // fall through to rebuild
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
    // rootDir 不写入 manifest(可迁移路径由打开时注入)
    await writeDerivedJson(manifestPath, rest);
  }
}
