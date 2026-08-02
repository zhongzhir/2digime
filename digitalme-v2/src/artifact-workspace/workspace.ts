import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ObjectStore } from '../runtime/ports';
import type { ContentStore } from '../infrastructure/content-store';
import { exportDocx, exportMarkdown } from '../infrastructure/export';
import { newId, nowIso } from '../shared/ids';
import type { ArtifactWorkspacePort, ExportFormat } from './contracts';
import {
  headVersion,
  type Artifact,
  type ArtifactContent,
  type ArtifactVersion,
} from '../work-runtime/artifact';
import { InMemoryEventBus } from '../work-runtime/event-bus';
import { extractEditEvidence } from '../subject-core/diff-evidence';
import type { GrowthEvent } from '../subject-core/growth-event';
import type { SubjectService } from '../subject-core/subject-service';

export interface ArtifactWorkspaceOptions {
  artifactStore: ObjectStore<Artifact>;
  contentStore: ContentStore;
  subjectService: SubjectService;
  eventBus: InMemoryEventBus;
  /** 从 Task 取主题词,写入 candidate tags 以便相似任务命中。 */
  resolveTaskTopics?: (taskId: string) => Promise<string[]>;
}

/**
 * Artifact Workspace — 查看/编辑/导出。
 * saveEdit 追加 user 版本;后台确定性提炼 candidate GrowthEvent。
 * 回流失败不影响已保存的 Artifact / Job。
 */
export class ArtifactWorkspace implements ArtifactWorkspacePort {
  private readonly artifactStore: ObjectStore<Artifact>;
  private readonly contentStore: ContentStore;
  private readonly subjectService: SubjectService;
  private readonly eventBus: InMemoryEventBus;
  private readonly resolveTaskTopics?: (taskId: string) => Promise<string[]>;

  constructor(options: ArtifactWorkspaceOptions) {
    this.artifactStore = options.artifactStore;
    this.contentStore = options.contentStore;
    this.subjectService = options.subjectService;
    this.eventBus = options.eventBus;
    if (options.resolveTaskTopics) this.resolveTaskTopics = options.resolveTaskTopics;
  }

  async getContent(
    artifactId: string,
    versionId?: string,
  ): Promise<{ artifact: Artifact; content: ArtifactContent; text?: string }> {
    const artifact = await this.requireArtifact(artifactId);
    const version = versionId
      ? artifact.versions.find((v) => v.versionId === versionId)
      : headVersion(artifact);
    if (!version) throw new Error(`version not found: ${versionId}`);
    const result: { artifact: Artifact; content: ArtifactContent; text?: string } = {
      artifact,
      content: version.content,
    };
    if (version.content.kind === 'text') {
      result.text = await this.contentStore.getText(version.content);
    }
    return result;
  }

  async saveEdit(artifactId: string, text: string): Promise<{ version: ArtifactVersion }> {
    const artifact = await this.requireArtifact(artifactId);
    const previous = headVersion(artifact);
    if (previous.content.kind !== 'text') {
      throw new Error('only text artifacts can be edited in this release');
    }
    const previousText = await this.contentStore.getText(previous.content);
    const stored = await this.contentStore.putText(text, previous.content.format);
    const version: ArtifactVersion = {
      versionId: newId('artifactVersion'),
      createdAt: nowIso(),
      author: 'user',
      content: stored.content,
    };
    const next: Artifact = {
      ...artifact,
      versions: [...artifact.versions, version],
      headVersionId: version.versionId,
    };
    await this.artifactStore.put(next);
    this.eventBus.publish({
      kind: 'artifact.updated',
      artifactId: artifact.id,
      taskId: artifact.taskId,
      headVersionId: version.versionId,
    });

    try {
      await this.recordFeedbackCandidate({
        artifact: next,
        fromVersionId: previous.versionId,
        toVersionId: version.versionId,
        beforeText: previousText,
        afterText: text,
      });
    } catch {
      // learning must not affect delivery
    }

    return { version };
  }

  async export(
    artifactId: string,
    format: ExportFormat,
    targetPath?: string,
  ): Promise<{ path: string }> {
    const { text, artifact } = await this.getContent(artifactId);
    if (text === undefined) throw new Error('export requires text content');
    const dir = targetPath ? path.dirname(targetPath) : artifact.storageDir;
    const base = targetPath
      ? path.basename(targetPath).replace(/\.(md|docx)$/i, '')
      : artifact.title || artifact.id;
    const outBase = path.join(dir, base);
    if (format === 'md') return exportMarkdown(text, outBase);
    return exportDocx(text, outBase);
  }

  async revealInFolder(artifactId: string): Promise<void> {
    const artifact = await this.requireArtifact(artifactId);
    await fs.access(artifact.storageDir);
  }

  private async recordFeedbackCandidate(input: {
    artifact: Artifact;
    fromVersionId: string;
    toVersionId: string;
    beforeText: string;
    afterText: string;
  }): Promise<void> {
    const evidence = extractEditEvidence(input.beforeText, input.afterText);
    if (evidence.facts.length === 0) return;

    const topicTags = this.resolveTaskTopics
      ? await this.resolveTaskTopics(input.artifact.taskId)
      : [];
    const tags = [...new Set([...evidence.tags, ...topicTags])];

    const event: GrowthEvent = {
      id: newId('growthEvent'),
      subjectId: input.artifact.subjectId,
      occurredAt: nowIso(),
      type: 'feedback_recorded',
      source: {
        kind: 'artifact_edit',
        taskId: input.artifact.taskId,
        artifactId: input.artifact.id,
        jobId: input.artifact.jobId,
      },
      payload: {
        title: evidence.title,
        detail: evidence.detail,
        tags,
        evidence: {
          artifactId: input.artifact.id,
          fromVersionId: input.fromVersionId,
          toVersionId: input.toVersionId,
        },
      },
      confidence: 'candidate',
    };
    await this.subjectService.appendGrowthEvent(event);
  }

  private async requireArtifact(id: string): Promise<Artifact> {
    const artifact = await this.artifactStore.get(id);
    if (!artifact) throw new Error(`artifact not found: ${id}`);
    return artifact;
  }
}
