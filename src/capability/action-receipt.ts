import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CapabilityOutput, RemoteLifecycleStatus } from './adapter';
import type { CandidateVerificationResult } from './candidate-artifact-verify';
import type { RemoteAuthorizationProjection } from './remote-authorization';

/**
 * Action Receipt — Artifact bundle / audit 附件,不是新的权威 Store。
 * 敏感正文不重复写入;仅记录引用、哈希与审计元数据。
 */
export interface ActionReceipt {
  schemaVersion: 'action-receipt/1';
  receiptId: string;
  subjectId: string;
  taskId: string;
  jobId: string;
  grantId?: string;
  capabilityId: string;
  adapterId: string;
  adapterType: string;
  adapterVersion: string;
  endpoint?: string;
  remoteExecutionId?: string;
  /**
   * 协议与来源映射(审计)。不得作为用户面文案。
   * 例: protocol=a2a, version=1.0, remoteTaskId=...
   */
  protocolMapping?: {
    protocol: string;
    protocolVersion?: string;
    remoteTaskId?: string;
    remoteArtifactId?: string;
    endpointId?: string;
  };
  /** 实际发送的字段名(非正文)。 */
  sentFields: string[];
  /** 材料路径/摘要引用。 */
  materialRefs: Array<{ path?: string; digest?: string }>;
  remoteStatus?: RemoteLifecycleStatus;
  timedOut?: boolean;
  cancelled?: boolean;
  retryCount?: number;
  verification?: {
    verdict: CandidateVerificationResult['verdict'];
    contentDigest?: string;
    issueCodes?: string[];
    modelSelfGradeIgnored?: boolean;
  };
  artifact?: {
    type: string;
    title: string;
    contentDigest?: string;
    provenance?: string;
  };
  /** 采用/拒绝占位 — 由后续 captureInput 回填说明,收据本身不写成长。 */
  adoption?: {
    status: 'undecided' | 'accepted' | 'rejected';
    note?: string;
  };
  startedAt: string;
  finishedAt?: string;
  failedAt?: string;
  failureMessage?: string;
  authorization?: {
    purpose?: string;
    maxCalls?: number;
    allowRemotePersist?: boolean;
    allowRedelegate?: boolean;
  };
}

export interface BuildActionReceiptInput {
  receiptId: string;
  subjectId: string;
  taskId: string;
  jobId: string;
  grantId?: string;
  capabilityId: string;
  adapterId: string;
  adapterType: string;
  adapterVersion: string;
  endpoint?: string;
  remoteExecutionId?: string;
  protocolMapping?: ActionReceipt['protocolMapping'];
  sentFields: string[];
  materialRefs: Array<{ path?: string; digest?: string }>;
  remoteStatus?: RemoteLifecycleStatus;
  timedOut?: boolean;
  cancelled?: boolean;
  retryCount?: number;
  verification?: CandidateVerificationResult;
  output?: CapabilityOutput;
  auth?: RemoteAuthorizationProjection;
  startedAt: string;
  finishedAt?: string;
  failedAt?: string;
  failureMessage?: string;
}

export function buildActionReceipt(input: BuildActionReceiptInput): ActionReceipt {
  const receipt: ActionReceipt = {
    schemaVersion: 'action-receipt/1',
    receiptId: input.receiptId,
    subjectId: input.subjectId,
    taskId: input.taskId,
    jobId: input.jobId,
    capabilityId: input.capabilityId,
    adapterId: input.adapterId,
    adapterType: input.adapterType,
    adapterVersion: input.adapterVersion,
    sentFields: [...input.sentFields],
    materialRefs: input.materialRefs.map((m) => ({
      ...(m.path ? { path: m.path } : {}),
      ...(m.digest ? { digest: m.digest } : {}),
    })),
    startedAt: input.startedAt,
    adoption: { status: 'undecided' },
  };
  if (input.grantId) receipt.grantId = input.grantId;
  if (input.endpoint) receipt.endpoint = input.endpoint;
  if (input.remoteExecutionId) receipt.remoteExecutionId = input.remoteExecutionId;
  if (input.protocolMapping) receipt.protocolMapping = { ...input.protocolMapping };
  if (input.remoteStatus) receipt.remoteStatus = input.remoteStatus;
  if (input.timedOut !== undefined) receipt.timedOut = input.timedOut;
  if (input.cancelled !== undefined) receipt.cancelled = input.cancelled;
  if (input.retryCount !== undefined) receipt.retryCount = input.retryCount;
  if (input.finishedAt) receipt.finishedAt = input.finishedAt;
  if (input.failedAt) receipt.failedAt = input.failedAt;
  if (input.failureMessage) {
    receipt.failureMessage = scrubSensitive(input.failureMessage).slice(0, 400);
  }
  if (input.verification) {
    receipt.verification = {
      verdict: input.verification.verdict,
      ...(input.verification.contentDigest
        ? { contentDigest: input.verification.contentDigest }
        : {}),
      issueCodes: input.verification.issues.map((i) => i.code),
      modelSelfGradeIgnored: input.verification.modelSelfGradeIgnored,
    };
  }
  if (input.output) {
    const digest =
      input.output.candidateMeta?.contentDigest ??
      (input.output.artifact.payload.kind === 'text'
        ? sha256(input.output.artifact.payload.text)
        : undefined);
    receipt.artifact = {
      type: input.output.artifact.type,
      title: input.output.artifact.title,
      ...(digest ? { contentDigest: digest } : {}),
      ...(input.output.candidateMeta?.provenance
        ? { provenance: input.output.candidateMeta.provenance }
        : {}),
    };
  }
  if (input.auth) {
    receipt.authorization = {
      purpose: input.auth.purpose,
      maxCalls: input.auth.maxCalls,
      allowRemotePersist: input.auth.allowRemotePersist,
      allowRedelegate: input.auth.allowRedelegate,
    };
  }
  return receipt;
}

/** 将收据写入工作目录,供 bundle 附件引用。不创建权威 Store。 */
export async function writeActionReceiptFile(
  workDir: string,
  receipt: ActionReceipt,
): Promise<string> {
  const filePath = path.join(workDir, 'action-receipt.json');
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * 将文本成果与 Action Receipt 组装为 bundle 载荷。
 * 主成果仍可读;收据为 audit 附件。
 */
export async function attachReceiptToOutput(
  output: CapabilityOutput,
  workDir: string,
  receipt: ActionReceipt,
): Promise<CapabilityOutput> {
  const receiptPath = await writeActionReceiptFile(workDir, receipt);
  if (output.artifact.payload.kind === 'text') {
    const bodyPath = path.join(workDir, 'artifact-body.md');
    await fs.writeFile(bodyPath, output.artifact.payload.text, 'utf8');
    return {
      ...output,
      artifact: {
        ...output.artifact,
        payload: {
          kind: 'bundle',
          entries: [
            { sourcePath: bodyPath, mediaType: 'text/markdown', role: 'report' },
            {
              sourcePath: receiptPath,
              mediaType: 'application/json',
              role: 'action-receipt',
            },
          ],
        },
      },
    };
  }
  if (output.artifact.payload.kind === 'bundle') {
    return {
      ...output,
      artifact: {
        ...output.artifact,
        payload: {
          kind: 'bundle',
          entries: [
            ...output.artifact.payload.entries,
            {
              sourcePath: receiptPath,
              mediaType: 'application/json',
              role: 'action-receipt',
            },
          ],
        },
      },
    };
  }
  // file:升为 bundle
  return {
    ...output,
    artifact: {
      ...output.artifact,
      payload: {
        kind: 'bundle',
        entries: [
          {
            sourcePath: output.artifact.payload.sourcePath,
            mediaType: output.artifact.payload.mediaType,
            role: 'report',
          },
          {
            sourcePath: receiptPath,
            mediaType: 'application/json',
            role: 'action-receipt',
          },
        ],
      },
    },
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function scrubSensitive(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}
