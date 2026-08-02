import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ObjectStore } from '../runtime/ports';
import type { ContentStore } from '../infrastructure/content-store';
import { newId, nowIso } from '../shared/ids';
import type { CapabilityOutput } from '../capability/adapter';
import {
  artifactIdForJob,
  type Artifact,
  type ArtifactContent,
  type ArtifactVersion,
} from './artifact';

/**
 * Artifact 幂等提交协议:
 * 1. artifactId = artifactIdForJob(jobId)
 * 2. 若已存在则直接返回(重放不得生成第二个)
 * 3. 先写 ContentStore,再写 Artifact 对象
 * Job succeeded 由 Runner 在 Artifact 写入成功后单独落盘。
 */
export class ArtifactCommitter {
  constructor(
    private readonly artifactStore: ObjectStore<Artifact>,
    private readonly contentStore: ContentStore,
    private readonly artifactsRoot: string,
  ) {}

  async get(id: string): Promise<Artifact | null> {
    return this.artifactStore.get(id);
  }

  async listByTask(taskId: string): Promise<Artifact[]> {
    return this.artifactStore.list((a) => a.taskId === taskId);
  }

  async existsForJob(jobId: string): Promise<boolean> {
    const existing = await this.artifactStore.get(artifactIdForJob(jobId));
    return existing !== null;
  }

  async commit(input: {
    jobId: string;
    taskId: string;
    subjectId: string;
    output: CapabilityOutput;
  }): Promise<Artifact> {
    const id = artifactIdForJob(input.jobId);
    const existing = await this.artifactStore.get(id);
    if (existing) return existing;

    const storageDir = path.join(this.artifactsRoot, id);
    await fs.mkdir(storageDir, { recursive: true });

    const content = await this.persistPayload(input.output.artifact.payload);
    const versionId = newId('artifactVersion');
    const createdAt = nowIso();
    const version: ArtifactVersion = {
      versionId,
      createdAt,
      author: 'capability',
      content,
    };
    const artifact: Artifact = {
      id,
      taskId: input.taskId,
      jobId: input.jobId,
      subjectId: input.subjectId,
      createdAt,
      type: input.output.artifact.type,
      title: input.output.artifact.title,
      versions: [version],
      headVersionId: versionId,
      storageDir,
    };
    await this.artifactStore.put(artifact);
    return artifact;
  }

  private async persistPayload(
    payload: CapabilityOutput['artifact']['payload'],
  ): Promise<ArtifactContent> {
    if (payload.kind === 'text') {
      const stored = await this.contentStore.putText(payload.text, payload.format);
      return stored.content;
    }
    if (payload.kind === 'file') {
      return this.contentStore.putFile(payload.sourcePath, payload.mediaType);
    }
    return this.contentStore.putBundle(payload.entries);
  }
}
