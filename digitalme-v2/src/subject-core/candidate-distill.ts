/**
 * 候选提炼(测试/最小 Fake 级) — 不构成完整自动蒸馏管线。
 * 来源可为自我说明、对话、任务要求、材料、成果反馈等,不得限定为表单。
 */
import { newId, nowIso } from '../shared/ids';
import type { GrowthEvent, GrowthEventSourceKind, GrowthEventType } from './growth-event';

/** 产品侧候选来源(服务合同);不暴露给用户面内部词。 */
export type SubjectCaptureSourceKind =
  | 'initial_self_description'
  | 'imported_material'
  | 'conversation'
  | 'task_requirement'
  | 'artifact_edit'
  | 'artifact_acceptance'
  | 'artifact_rejection'
  | 'repeated_correction'
  | 'explicit_boundary';

const SOURCE_TO_EVENT: Record<SubjectCaptureSourceKind, GrowthEventSourceKind> = {
  initial_self_description: 'owner_direct',
  imported_material: 'import',
  conversation: 'owner_direct',
  task_requirement: 'task_feedback',
  artifact_edit: 'artifact_edit',
  artifact_acceptance: 'task_feedback',
  artifact_rejection: 'task_feedback',
  repeated_correction: 'owner_direct',
  explicit_boundary: 'owner_direct',
};

/**
 * 是否建议打扰用户确认(C 类)。
 * 低风险候选可保持 candidate,不冒充 confirmed,也不强制弹确认。
 */
export function requiresOwnerConfirmation(type: string, tags: readonly string[] = []): boolean {
  if (
    type === 'identity_clarified' ||
    type === 'goal_updated' ||
    type === 'principle_stated' ||
    type === 'boundary_updated'
  ) {
    return true;
  }
  if (type === 'feedback_recorded') {
    // 采用/不采用按钮本身即用户决策，不再二次确认打扰。
    if (tags.includes('decision:accept') || tags.includes('decision:reject')) {
      return false;
    }
    // 实践纠正:用户修改成果后的成长确认属于可感知成长路径
    return true;
  }
  if (type === 'preference_observed' && tags.some((t) => /高风险|敏感|隐私|融资|机密/.test(t))) {
    return true;
  }
  if (tags.some((t) => t === 'needs_confirmation' || t === 'conflict' || t === 'low_confidence')) {
    return true;
  }
  return false;
}

export function distillCandidatesFromText(input: {
  subjectId: string;
  text: string;
  sourceKind: SubjectCaptureSourceKind;
  materialRef?: string;
  taskId?: string;
  artifactId?: string;
  artifactVersionId?: string;
  requestedArtifactType?: string;
}): GrowthEvent[] {
  const text = input.text.trim();
  if (!text) return [];

  const at = nowIso();
  const sourceKind = SOURCE_TO_EVENT[input.sourceKind];
  const source: GrowthEvent['source'] = { kind: sourceKind };
  if (input.taskId) source.taskId = input.taskId;
  if (input.artifactId) source.artifactId = input.artifactId;

  const relation = input.materialRef ? { materialRef: input.materialRef } : undefined;
  const out: GrowthEvent[] = [];

  const push = (
    type: GrowthEventType,
    title: string,
    detail: string,
    tags: string[],
  ) => {
    const payload: GrowthEvent['payload'] = { title, detail, tags };
    if (relation) payload.relation = relation;
    if (input.artifactId && input.artifactVersionId) {
      payload.evidence = {
        artifactId: input.artifactId,
        toVersionId: input.artifactVersionId,
      };
    }
    out.push({
      id: newId('growthEvent'),
      subjectId: input.subjectId,
      occurredAt: at,
      type,
      source: { ...source },
      payload,
      confidence: 'candidate',
    });
  };

  // 采用/不采用：只写锚定版本的决策事件，不旁生其它候选（按钮即决策）。
  if (
    input.sourceKind === 'artifact_acceptance' ||
    input.sourceKind === 'artifact_rejection'
  ) {
    const isReject = input.sourceKind === 'artifact_rejection';
    const typeTag = (input.requestedArtifactType || 'document').toLowerCase();
    const decisionTag = isReject ? 'decision:reject' : 'decision:accept';
    push(
      'feedback_recorded',
      isReject ? '本次成果未采用' : '本次成果已采用',
      text.slice(0, 400),
      [decisionTag, typeTag],
    );
    return out;
  }

  // 显式边界优先
  if (
    input.sourceKind === 'explicit_boundary' ||
    (/边界|不要|禁止|勿|不愿|不讨论/.test(text) && /融资|隐私|外传|公开/.test(text))
  ) {
    if (/融资/.test(text)) {
      push(
        'boundary_updated',
        '边界：不讨论未公开融资',
        'exclude-tag:融资',
        ['exclude:融资', '边界', 'needs_confirmation'],
      );
    } else if (input.sourceKind === 'explicit_boundary') {
      push(
        'boundary_updated',
        '边界：用户明确不愿做的事',
        text.slice(0, 400),
        ['边界', 'needs_confirmation'],
      );
    }
  }

  if (/本地优先/.test(text)) {
    push(
      'goal_updated',
      '方向：本地优先',
      '长期以本地优先为产品与工程方向',
      ['方向', '本地优先', 'goal', 'needs_confirmation'],
    );
  }

  if (/正式|结论先行/.test(text)) {
    push(
      'principle_stated',
      '原则：表达正式、结论先行',
      '对外文档采用正式语气,先给结论再展开',
      ['原则', '正式', '结论先行', '周报', 'document', 'needs_confirmation'],
    );
  }

  if (/简洁|短句|少套话|不要空话/.test(text) && !/正式|结论先行/.test(text)) {
    // 低风险偏好:保持 candidate,不标记 needs_confirmation
    push(
      'preference_observed',
      '偏好：表达简洁',
      text.slice(0, 240),
      ['style', '简洁', 'preference'],
    );
  }

  if (/我是|身份/.test(text) || input.sourceKind === 'initial_self_description') {
    const line =
      text
        .split(/\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0) || text;
    // 一句话自我说明:若无更强身份句,仍生成轻量身份候选(需确认才进权威)
    if (/我是|身份/.test(text) || input.sourceKind === 'initial_self_description') {
      const already = out.some((e) => e.type === 'identity_clarified');
      if (!already) {
        push(
          'identity_clarified',
          '现在的我',
          line.slice(0, 240),
          ['身份', 'needs_confirmation'],
        );
      }
    }
  }

  if (input.sourceKind === 'repeated_correction') {
    push(
      'feedback_recorded',
      '成果采用中的稳定偏好',
      text.slice(0, 400),
      [(input.requestedArtifactType || 'document').toLowerCase(), 'needs_confirmation'],
    );
  }

  // 任务要求中的稳定偏好(无其它命中时也留下知识缺口,不注入权威)
  if (input.sourceKind === 'task_requirement' && out.length === 0 && text.length >= 4) {
    push(
      'knowledge_gap_noted',
      '还不确定：任务中提到的偏好',
      text.slice(0, 400),
      ['gap', 'task_requirement'],
    );
  }

  // 对话/自我说明极短且无结构化命中:仅记 gap,不阻断做事
  if (
    (input.sourceKind === 'initial_self_description' ||
      input.sourceKind === 'conversation') &&
    out.length === 0 &&
    text.length >= 2
  ) {
    push(
      'knowledge_gap_noted',
      '还不确定：需要更多了解',
      text.slice(0, 400),
      ['gap'],
    );
  }

  return out;
}
