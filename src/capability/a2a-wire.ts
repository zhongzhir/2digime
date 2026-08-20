/**
 * A2A 1.0 wire helpers — ClientFactory + Agent Card 校验。
 * 不引入第二 Job 状态机;仅协议映射。
 */
import { randomUUID } from 'node:crypto';
import {
  A2A_PROTOCOL_VERSION,
  Role,
  TaskState,
  type AgentCard,
  type CancelTaskRequest,
  type GetTaskRequest,
  type Message,
  type Part,
  type SendMessageRequest,
  type Task,
} from '@a2a-js/sdk';
import { ClientFactory, JsonRpcTransportFactory, type Client } from '@a2a-js/sdk/client';
import {
  fetchAllowlisted,
  type AgentCardView,
  type RemoteEndpointPolicy,
  validateAgentCardAgainstPolicy,
} from './remote-endpoint-policy';
import type { RemoteLifecycleStatus } from './adapter';

export const A2A_ADAPTER_PROTOCOL = 'a2a';
export const A2A_ADAPTER_PROTOCOL_VERSION = A2A_PROTOCOL_VERSION;

export interface A2AAuthorizedPayload {
  goal: string;
  purpose: string;
  materials: Array<{ path: string; digest?: string; excerpt: string }>;
  grantId?: string;
  jobId: string;
  fault?: string;
}

export function mapA2AStateToLocal(state: TaskState | number | string | undefined): RemoteLifecycleStatus {
  const value = typeof state === 'string' ? state : Number(state);
  switch (value) {
    case TaskState.TASK_STATE_SUBMITTED:
    case 'TASK_STATE_SUBMITTED':
    case 1:
      return 'pending';
    case TaskState.TASK_STATE_WORKING:
    case TaskState.TASK_STATE_INPUT_REQUIRED:
    case TaskState.TASK_STATE_AUTH_REQUIRED:
    case 'TASK_STATE_WORKING':
    case 'TASK_STATE_INPUT_REQUIRED':
    case 'TASK_STATE_AUTH_REQUIRED':
    case 2:
    case 6:
    case 8:
      return 'running';
    case TaskState.TASK_STATE_COMPLETED:
    case 'TASK_STATE_COMPLETED':
    case 3:
      return 'completed';
    case TaskState.TASK_STATE_FAILED:
    case TaskState.TASK_STATE_REJECTED:
    case 'TASK_STATE_FAILED':
    case 'TASK_STATE_REJECTED':
    case 4:
    case 7:
      return 'failed';
    case TaskState.TASK_STATE_CANCELED:
    case 'TASK_STATE_CANCELED':
    case 5:
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function buildAuthorizedMessageText(payload: A2AAuthorizedPayload): string {
  const lines = [
    `目标：${payload.goal}`,
    `用途：${payload.purpose}`,
    payload.grantId ? `授权引用：${payload.grantId}` : '',
    `本地作业引用：${payload.jobId}`,
    '',
    '授权材料：',
    ...payload.materials.map(
      (m, i) =>
        `材料[${i + 1}] path=${m.path}${m.digest ? ` digest=${m.digest}` : ''}\n${m.excerpt}`,
    ),
    '',
    '约束：仅使用以上明确授权内容；不得索要额外材料；不得再委托；输出结构化项目风险摘要。',
  ].filter(Boolean);
  return lines.join('\n');
}

export function extractTaskTextArtifact(task: Task): {
  text: string;
  artifactId?: string;
  name?: string;
  reachedModel?: boolean;
  contentIntegrity?: {
    modelGeneratedContent: string;
    modelContentDigest: string;
    deterministicFormatting: string[];
    reachedModel?: boolean;
    revisionAttempted?: boolean;
    insufficientLength?: boolean;
  };
} {
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  for (const art of artifacts) {
    const text = partsToText(art.parts || []);
    const integrity = extractIntegrity(art);
    if (text.trim() || integrity) {
      const result: {
        text: string;
        artifactId?: string;
        name?: string;
        reachedModel?: boolean;
        contentIntegrity?: NonNullable<ReturnType<typeof extractIntegrity>>;
      } = { text };
      if (art.artifactId) result.artifactId = art.artifactId;
      if (art.name) result.name = art.name;
      const reachedModel =
        typeof art.metadata?.reachedModel === 'boolean'
          ? art.metadata.reachedModel
          : typeof integrity?.reachedModel === 'boolean'
            ? integrity.reachedModel
            : undefined;
      if (reachedModel !== undefined) result.reachedModel = reachedModel;
      if (integrity) result.contentIntegrity = integrity;
      return result;
    }
  }
  const history = Array.isArray(task.history) ? task.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (msg?.role === Role.ROLE_AGENT) {
      const text = partsToText(msg.parts || []);
      if (text.trim()) return { text };
    }
  }
  return { text: '' };
}

function extractIntegrity(art: {
  metadata?: Record<string, unknown> | undefined;
  parts?: Part[];
}):
  | {
      modelGeneratedContent: string;
      modelContentDigest: string;
      deterministicFormatting: string[];
      reachedModel?: boolean;
      revisionAttempted?: boolean;
      insufficientLength?: boolean;
    }
  | undefined {
  const fromMeta = art.metadata;
  if (
    fromMeta &&
    typeof fromMeta.modelGeneratedContent === 'string' &&
    typeof fromMeta.modelContentDigest === 'string'
  ) {
    return {
      modelGeneratedContent: fromMeta.modelGeneratedContent,
      modelContentDigest: fromMeta.modelContentDigest,
      deterministicFormatting: Array.isArray(fromMeta.deterministicFormatting)
        ? fromMeta.deterministicFormatting.map(String)
        : [],
      ...(typeof fromMeta.reachedModel === 'boolean'
        ? { reachedModel: fromMeta.reachedModel }
        : {}),
      ...(typeof fromMeta.revisionAttempted === 'boolean'
        ? { revisionAttempted: fromMeta.revisionAttempted }
        : {}),
      ...(typeof fromMeta.insufficientLength === 'boolean'
        ? { insufficientLength: fromMeta.insufficientLength }
        : {}),
    };
  }
  for (const part of art.parts || []) {
    const c = part.content;
    if (c && typeof c === 'object' && '$case' in c && c.$case === 'data') {
      const value = c.value as Record<string, unknown>;
      if (value && typeof value.modelGeneratedContent === 'string') {
        return {
          modelGeneratedContent: value.modelGeneratedContent,
          modelContentDigest: String(value.modelContentDigest || ''),
          deterministicFormatting: Array.isArray(value.deterministicFormatting)
            ? value.deterministicFormatting.map(String)
            : [],
          ...(typeof value.reachedModel === 'boolean'
            ? { reachedModel: value.reachedModel }
            : {}),
          ...(typeof value.revisionAttempted === 'boolean'
            ? { revisionAttempted: value.revisionAttempted }
            : {}),
          ...(typeof value.insufficientLength === 'boolean'
            ? { insufficientLength: value.insufficientLength }
            : {}),
        };
      }
    }
  }
  return undefined;
}

function partsToText(parts: Part[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    const c = part.content;
    if (c && typeof c === 'object' && '$case' in c && c.$case === 'text') {
      chunks.push(String(c.value || ''));
    }
  }
  return chunks.join('\n\n');
}

export async function fetchAndValidateAgentCard(
  policy: RemoteEndpointPolicy,
): Promise<{ card: AgentCard; validation: ReturnType<typeof validateAgentCardAgainstPolicy> }> {
  const res = await fetchAllowlisted(policy.expectedAgentCardUrl, policy, {
    method: 'GET',
    timeoutMs: Math.min(15_000, policy.maxTaskDuration),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`agent card HTTP ${res.status}`), {
      stage: 'capability' as const,
      actionable: '外部能力说明不可用',
      code: 'agent_card_unavailable',
    });
  }
  const raw = (await res.json()) as AgentCardView;
  const validation = validateAgentCardAgainstPolicy(policy, raw);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.reasons.join('; ')), {
      stage: 'capability' as const,
      actionable: '外部能力与白名单不匹配',
      code: 'agent_card_mismatch',
    });
  }
  return { card: raw as unknown as AgentCard, validation };
}

export async function createA2AClientForPolicy(policy: RemoteEndpointPolicy): Promise<{
  client: Client;
  card: AgentCard;
  validation: ReturnType<typeof validateAgentCardAgainstPolicy>;
}> {
  const { card, validation } = await fetchAndValidateAgentCard(policy);
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory()],
  });
  const client = await factory.createFromAgentCard(card);
  return { client, card, validation };
}

export function buildUserMessage(payload: A2AAuthorizedPayload): Message {
  return {
    role: Role.ROLE_USER,
    messageId: randomUUID(),
    parts: [
      {
        content: { $case: 'text', value: buildAuthorizedMessageText(payload) },
        metadata: undefined,
        filename: '',
        mediaType: 'text/plain',
      },
    ],
    taskId: '',
    contextId: '',
    extensions: [],
    metadata: {
      digitalMeJobId: payload.jobId,
      ...(payload.grantId ? { digitalMeGrantId: payload.grantId } : {}),
      ...(payload.fault ? { fault: payload.fault } : {}),
      noRedelegate: true,
    },
    referenceTaskIds: [],
  };
}

export function buildSendMessageRequest(message: Message): SendMessageRequest {
  return {
    tenant: '',
    message,
    configuration: {
      acceptedOutputModes: ['text/plain', 'text/markdown'],
      taskPushNotificationConfig: undefined,
      returnImmediately: true,
    },
    metadata: undefined,
  };
}

export function buildGetTaskRequest(id: string): GetTaskRequest {
  return { tenant: '', id };
}

export function buildCancelTaskRequest(id: string): CancelTaskRequest {
  return { tenant: '', id, metadata: undefined };
}

export function isTaskResult(value: unknown): value is Task {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'status' in value);
}
