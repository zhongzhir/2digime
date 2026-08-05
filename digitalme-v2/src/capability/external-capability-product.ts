/**
 * 外部专业能力 — 产品面派生（确认文案、状态标签、失败可读性）。
 * 全部由本地 Job / Verification / 授权投影派生，不暴露远端协议态。
 */
import type { ExecutionJob } from '../work-runtime/execution-job';
import type { RemoteAuthorizationProjection } from './remote-authorization';
import { projectRemoteAuthorization } from './remote-authorization';
import * as path from 'node:path';

/** 外部专业能力用户面状态封闭表。 */
export const EXTERNAL_CAPABILITY_USER_LABELS = [
  '准备中',
  '正在交给专业能力',
  '正在处理',
  '正在检查成果',
  '已返回成果',
  '已取消',
  '未完成',
] as const;

export type ExternalCapabilityUserLabel = (typeof EXTERNAL_CAPABILITY_USER_LABELS)[number];

export const EXTERNAL_CAPABILITY_FAILURE = {
  credentialMissing: '尚未连接可用的外部专业能力。',
  unavailable: '研究分析能力目前无法使用，请稍后重试或改用本地能力。',
  timeout: '对方未在限定时间内完成，本次任务已停止。',
  cancelled: '已停止本次外部处理。',
  verificationFailed: '已收到结果，但未通过完整性检查，未加入你的成果。',
  materialAuth: '所选材料无法按当前授权发送，请重新选择。',
} as const;

export interface ExternalCapabilityCardView {
  capabilityId: string;
  displayName: string;
  shortDescription: string;
  suitableFor: string;
  shareSummary: string;
  estimatedDuration: string;
  available: boolean;
  availabilityLabel: string;
}

export interface AuthorizationConfirmView {
  projection: RemoteAuthorizationProjection;
  confirmPoints: string[];
  capabilityDisplayName: string;
}

function basenamePath(p: string): string {
  const n = String(p || '').replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

/**
 * 由确定性投影生成授权确认要点。
 * UI 只能展示本函数结果，不得自行再写一套授权逻辑。
 */
export function buildAuthorizationConfirmPoints(
  auth: RemoteAuthorizationProjection,
  opts?: { capabilityDisplayName?: string; extraNote?: string },
): string[] {
  const name = opts?.capabilityDisplayName || '研究分析能力';
  const mats = auth.allowedMaterials.length
    ? auth.allowedMaterials.map((m) => `「${basenamePath(m)}」`).join('、')
    : '无文件材料（仅任务要求文字）';
  const purpose = auth.purpose?.trim() || '（未填写）';
  const persist = auth.allowRemotePersist ? '允许保存' : '不允许保存';
  const redelegate = auth.allowRedelegate ? '允许再委托' : '不允许再委托';
  return [
    `将发送的任务要求：${purpose}${opts?.extraNote ? `；补充说明：${opts.extraNote}` : ''}`,
    `将发送的材料：${mats}`,
    '不会发送的内容：完整数字之我资料、对话记录、其它任务、长期记忆，以及未勾选的材料。',
    `对方是否允许保存：${persist}`,
    `是否允许再委托：${redelegate}`,
    '可随时取消：取消后对方不能继续处理，迟到成果不会加入你的成果。',
    `能力：${name}`,
  ];
}

/** 预览授权：投影 + 确认要点（单一权威）。 */
export function previewExternalAuthorization(input: {
  goal: string;
  allowedMaterialPaths?: string[];
  capabilityDisplayName?: string;
  extraNote?: string;
  maxRuntimeMs?: number;
}): AuthorizationConfirmView {
  const projection = projectRemoteAuthorization({
    goal: input.goal,
    allowedMaterialPaths: input.allowedMaterialPaths ?? [],
    defaults: {
      allowRemotePersist: false,
      allowRedelegate: false,
      maxCalls: 1,
      ...(input.maxRuntimeMs !== undefined ? { maxRuntimeMs: input.maxRuntimeMs } : {}),
    },
  });
  return {
    projection,
    confirmPoints: buildAuthorizationConfirmPoints(projection, {
      ...(input.capabilityDisplayName
        ? { capabilityDisplayName: input.capabilityDisplayName }
        : {}),
      ...(input.extraNote ? { extraNote: input.extraNote } : {}),
    }),
    capabilityDisplayName: input.capabilityDisplayName || '研究分析能力',
  };
}

export function buildExternalCapabilityCard(input: {
  capabilityId: string;
  displayName?: string;
  description?: string;
  latencyEstimate?: string;
  available: boolean;
  availabilityReason?: string;
  selectedMaterialNames?: string[];
}): ExternalCapabilityCardView {
  const displayName = input.displayName || '研究分析能力';
  const share =
    input.selectedMaterialNames && input.selectedMaterialNames.length
      ? `本次将共享已勾选材料：${input.selectedMaterialNames.map((n) => `「${n}」`).join('、')}`
      : '本次默认只共享你勾选的材料；未勾选则仅发送任务要求文字。';
  let availabilityLabel = input.available ? '当前可用' : '当前不可用';
  if (!input.available && input.availabilityReason === 'credential') {
    availabilityLabel = '尚未连接可用的外部专业能力';
  } else if (!input.available && input.availabilityReason === 'unreachable') {
    availabilityLabel = '暂时无法使用';
  }
  return {
    capabilityId: input.capabilityId,
    displayName,
    shortDescription:
      input.description || '已连接的专业能力，可根据授权材料形成结构化项目风险摘要。',
    suitableFor: '适合完成：基于明确授权材料的结构化项目风险摘要（约 500–800 字）。',
    shareSummary: share,
    estimatedDuration: input.latencyEstimate || '预计可能耗时：数秒到两分钟。',
    available: input.available,
    availabilityLabel,
  };
}

/**
 * 外部能力用户面状态 — 仅由本地 Job 五态 + 进度/验证派生。
 */
export function externalCapabilityUserFacingLabel(
  job: ExecutionJob | undefined,
  opts?: { hasArtifact?: boolean },
): ExternalCapabilityUserLabel {
  if (!job) return '准备中';
  switch (job.status) {
    case 'queued':
      return '准备中';
    case 'cancelled':
      return '已取消';
    case 'failed':
      return '未完成';
    case 'succeeded':
      return job.artifactId || opts?.hasArtifact ? '已返回成果' : '未完成';
    case 'running': {
      const note = String(job.progress?.note || '');
      if (/保存|检查|验证|整理/.test(note)) return '正在检查成果';
      if (!job.remoteExecution?.executionId) return '正在交给专业能力';
      if (/准备材料|调用能力|交给/.test(note) && !job.remoteExecution?.lastRemoteStatus) {
        return '正在交给专业能力';
      }
      return '正在处理';
    }
  }
}

/**
 * 将内部失败/actionable 映射为用户可读文案（不泄漏协议与密钥字段）。
 */
export function mapExternalCapabilityFailure(input: {
  actionable?: string;
  message?: string;
  code?: string;
  cancelled?: boolean;
}): { message: string; action?: 'check_connection' | 'retry_or_local' | 'reselect_materials' | 'none' } {
  if (input.cancelled) {
    return { message: EXTERNAL_CAPABILITY_FAILURE.cancelled, action: 'none' };
  }
  const blob = `${input.actionable || ''} ${input.message || ''} ${input.code || ''}`.toLowerCase();
  if (
    /credential|尚未连接|独立凭证|secret|api[_-]?key|unauthorized|401/.test(blob) ||
    input.code === 'credential_reuse_forbidden'
  ) {
    return {
      message: EXTERNAL_CAPABILITY_FAILURE.credentialMissing,
      action: 'check_connection',
    };
  }
  if (/timeout|超时|timed?\s*out|deadline/.test(blob)) {
    return { message: EXTERNAL_CAPABILITY_FAILURE.timeout, action: 'retry_or_local' };
  }
  if (
    /verif|完整性|未通过验证|malformed|length_insufficient|template_padding|content_integrity/.test(
      blob,
    )
  ) {
    return { message: EXTERNAL_CAPABILITY_FAILURE.verificationFailed, action: 'none' };
  }
  if (/material|授权|projection|persist|redelegate|snapshot|无法按当前授权/.test(blob)) {
    return { message: EXTERNAL_CAPABILITY_FAILURE.materialAuth, action: 'reselect_materials' };
  }
  if (/unavailable|agent_card|disabled|无法使用|unreachable|econnrefused|network/.test(blob)) {
    return { message: EXTERNAL_CAPABILITY_FAILURE.unavailable, action: 'retry_or_local' };
  }
  if (/取消|cancel/.test(blob)) {
    return { message: EXTERNAL_CAPABILITY_FAILURE.cancelled, action: 'none' };
  }
  // 未知失败：仍用不完成语义，避免堆栈/SDK 原文
  return { message: EXTERNAL_CAPABILITY_FAILURE.unavailable, action: 'retry_or_local' };
}

export function isExternalResearchCapabilityId(capabilityId: string | undefined): boolean {
  if (!capabilityId) return false;
  return (
    capabilityId === 'cap_a2a_research_analysis' ||
    capabilityId === 'cap_controlled_remote_subject' ||
    capabilityId === 'cap_private_http_remote'
  );
}

export function materialDisplayNames(paths: readonly string[]): string[] {
  return paths.map((p) => path.basename(p));
}
