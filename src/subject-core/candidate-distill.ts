/**
 * 候选提炼(测试/最小 Fake 级) — 不构成完整自动蒸馏管线。
 * 来源可为自我说明、对话、任务要求、材料、成果反馈等,不得限定为表单。
 * 信号强度 / 产品分类 / 静默采纳由 growth-signal 统一判定。
 */
import { newId, nowIso } from '../shared/ids';
import type { GrowthEvent, GrowthEventSourceKind, GrowthEventType } from './growth-event';
import { enrichGrowthTags, type GrowthAdoptDecision } from './growth-signal';
import {
  distillDecisionReusableSnippet,
  extractDomainTags,
  extractProjectScopeTag,
  looksLikeProjectDecision,
} from './small-loop';
import {
  extractReplacementPreference,
  isCorrectionStatement,
} from './correction-supersede';

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
 * 静默可采纳者不进入确认建议列表。
 */
export function requiresOwnerConfirmation(type: string, tags: readonly string[] = []): boolean {
  // 确定性静默标记优先；模型 needs_confirmation 不得越权
  if (tags.includes('silent_ok') && !tags.includes('conflict')) return false;
  if (
    type === 'identity_clarified' ||
    type === 'goal_updated' ||
    type === 'principle_stated' ||
    type === 'boundary_updated'
  ) {
    return true;
  }
  if (type === 'feedback_recorded') {
    if (tags.includes('decision:accept') || tags.includes('decision:reject')) {
      return false;
    }
    if (tags.includes('doing_experience')) return false;
    return true;
  }
  if (type === 'preference_observed' && tags.some((t) => /高风险|敏感|隐私|融资|机密/.test(t))) {
    return true;
  }
  if (tags.includes('conflict')) return true;
  // 模型建议痕迹（model_suggests_confirm）本身不触发确认；须有本地 needs_confirmation / conflict
  if (tags.includes('needs_confirmation') || tags.includes('low_confidence')) {
    return true;
  }
  return false;
}

/** 从采用文案取出可引用的工作内容，避免把「本次成果已采用」写进本人事实。 */
export function doingExperienceDetailFromAcceptText(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fromTask = raw.match(/任务[：:]\s*(.+)$/);
  const detail = ((fromTask && fromTask[1]) || raw).trim();
  if (detail.length < 4) return '';
  if (/本次成果已采用|本次成果未采用/.test(detail) && detail.length < 20) return '';
  return detail.slice(0, 400);
}

const SELF_IS_CLAUSE_RE = /我是(?!在|否|不是)([^，。,；;！!？?\n]{0,24})/g;

/** 国籍、职业、来意、关系等，不得当姓名。 */
export function isNonNameSelfPredicate(fragment: string): boolean {
  const t = String(fragment || '')
    .replace(/[。！？!?的了啊呀哦呢吧]+$/g, '')
    .trim();
  if (!t) return true;
  if (isNonIdentitySelfPredicate(t)) return true;
  if (/^(中国人|美国人|日本人|英国人|法国人|德国人|韩国人|外国人|本地人)$/.test(t)) return true;
  if (
    /(产品经理|工程师|设计师|程序员|开发|顾问|老师|学生|老板|员工|经理|创始人|负责人)$/.test(t)
  ) {
    return true;
  }
  return false;
}

/** 来意、纯关系称呼：不但不是姓名，也不应记成身份声明。职业/国籍仍可记为身份。 */
export function isNonIdentitySelfPredicate(fragment: string): boolean {
  const t = String(fragment || '')
    .replace(/[。！？!?的了啊呀哦呢吧]+$/g, '')
    .trim();
  if (!t) return true;
  if (/^(你的)?主人$/.test(t)) return true;
  if (/^来/.test(t)) return true;
  if (/(咨询|问题)$/.test(t)) return true;
  return false;
}

function looksLikePersonName(raw: string): boolean {
  const name = String(raw || '')
    .replace(/[。！？!?的了啊呀哦呢吧]+$/g, '')
    .trim();
  if (!name || name.length < 2 || name.length > 8) return false;
  if (isNonNameSelfPredicate(name)) return false;
  if (/在|项目|修改|不是|一个|问题|咨询|函数|变量|文件/.test(name)) return false;
  if (/^[\u4e00-\u9fff]{2,4}$/.test(name)) return true;
  if (/^[A-Za-z][A-Za-z .·-]{1,19}$/.test(name)) return true;
  return false;
}

function collectSelfIsClauses(text: string): string[] {
  const clauses: string[] = [];
  const re = new RegExp(SELF_IS_CLAUSE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    clauses.push(String(match[1] || '').trim());
  }
  return clauses;
}

/** 「我是在修改项目」是近况，不是身份声明。 */
export function looksLikeIdentityClaim(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (extractExplicitSelfName(t)) return true;
  if (/身份/.test(t)) return true;
  const clauses = collectSelfIsClauses(t);
  if (clauses.length === 0) return false;
  if (clauses.every((c) => isNonIdentitySelfPredicate(c))) return false;
  return true;
}

/** 用户亲口说出的姓名（低风险、可静默记下）。 */
export function extractExplicitSelfName(text: string): string | null {
  const t = String(text || '').trim();
  const match = t.match(
    /(?:我(?:的)?名字是|我名叫|我叫|不是[，,。]?(?:其实|应该)?叫|(?:其实|改)叫)\s*([^\s，。,；;：:：]{1,20})/,
  );
  if (match && match[1]) {
    const name = match[1].replace(/[。！？!?的了啊呀哦]+$/g, '').trim();
    if (name && !/在|项目|修改|不是|一个/.test(name) && !isNonNameSelfPredicate(name)) {
      return name.slice(0, 20);
    }
  }
  for (const clause of collectSelfIsClauses(t)) {
    if (looksLikePersonName(clause)) {
      return clause.replace(/[。！？!?的了啊呀哦呢吧]+$/g, '').trim().slice(0, 20);
    }
  }
  return null;
}

export function looksLikePersonalResume(text: string): boolean {
  const t = String(text || '');
  const labeled = /简历|个人简历|curriculum vitae|\bCV\b/.test(t);
  const structured = /姓名[：:]/.test(t) && /(?:教育|工作经历|项目经历|技能|本科|硕士|任职|就职)/.test(t);
  return labeled || structured;
}

export function extractResumePersonalFacts(text: string): Array<{
  type: 'identity_clarified' | 'feedback_recorded';
  title: string;
  detail: string;
}> {
  const t = String(text || '');
  const out: Array<{
    type: 'identity_clarified' | 'feedback_recorded';
    title: string;
    detail: string;
  }> = [];
  const name = t.match(/姓名[：:]\s*([^\s，。,\n]{1,20})/);
  if (name && name[1]) {
    out.push({ type: 'identity_clarified', title: '姓名', detail: name[1].trim() });
  }
  const role = t.match(/(?:职位|岗位|求职意向)[：:]\s*([^\n]{2,40})/);
  if (role && role[1]) {
    out.push({
      type: 'identity_clarified',
      title: '职业方向',
      detail: role[1].trim().slice(0, 80),
    });
  }
  const expBlock = t.match(/工作经历[：:]?\s*([\s\S]{8,600})/);
  if (expBlock && expBlock[1]) {
    const line =
      expBlock[1]
        .split(/\n/)
        .map((l) => l.replace(/^[-*•]\s*/, '').trim())
        .find((l) => l.length >= 6) || expBlock[1].trim();
    if (line) {
      out.push({
        type: 'feedback_recorded',
        title: '工作经历',
        detail: line.slice(0, 240),
      });
    }
  }
  return out.slice(0, 4);
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
  capabilityId?: string;
  capabilityVersion?: string;
  sourceCapabilityKind?: 'local' | 'external_capability';
  /** 已确认权威，用于冲突检测 */
  authority?: Array<{ title: string; detail: string; type?: string; tags?: string[] }>;
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
    rawTags: string[],
  ): GrowthAdoptDecision => {
    const enriched = enrichGrowthTags({
      type,
      sourceKind: input.sourceKind,
      text: type === 'identity_clarified' ? input.text : `${title} ${detail}`,
      tags: rawTags,
      ...(input.authority ? { authority: input.authority } : {}),
    });
    if (enriched.adopt === 'discard') return enriched.adopt;
    let tags = [...enriched.tags];
    if (enriched.adopt === 'silent_adopt') {
      if (!tags.includes('silent_ok')) tags.push('silent_ok');
      tags = tags.filter((t) => t !== 'needs_confirmation');
    } else {
      tags = tags.filter((t) => t !== 'silent_ok');
      if (enriched.adopt === 'must_confirm' && !tags.includes('needs_confirmation')) {
        tags.push('needs_confirmation');
      }
    }
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
    return enriched.adopt;
  };

  if (
    input.sourceKind === 'artifact_acceptance' ||
    input.sourceKind === 'artifact_rejection'
  ) {
    const isReject = input.sourceKind === 'artifact_rejection';
    const decisionTag = isReject ? 'decision:reject' : 'decision:accept';
    const typeTag = (input.requestedArtifactType || 'document').toLowerCase();
    const tags = [decisionTag, typeTag];
    if (input.artifactId) tags.push(`artifact:${input.artifactId}`);
    if (input.artifactVersionId) tags.push(`version:${input.artifactVersionId}`);
    if (input.capabilityId) tags.push(`capability:${input.capabilityId}`);
    if (input.capabilityVersion) tags.push(`capabilityVersion:${input.capabilityVersion}`);
    if (input.sourceCapabilityKind) tags.push(`sourceKind:${input.sourceCapabilityKind}`);
    push(
      'feedback_recorded',
      isReject ? '本次成果未采用' : '本次成果已采用',
      text.slice(0, 400),
      tags,
    );
    if (!isReject) {
      const experienceDetail = doingExperienceDetailFromAcceptText(text);
      if (experienceDetail) {
        push(
          'feedback_recorded',
          '近期完成的工作',
          experienceDetail,
          ['doing_experience', 'silent_ok', 'category:work_experience'],
        );
      }
    }
    // 决策本身带 decision:*；另沉淀可复用偏好/纠正（无 decision 标签，可供下次注入）
    const reusable = distillDecisionReusableSnippet(text, isReject ? 'reject' : 'accept');
    if (reusable) {
      push('preference_observed', reusable.title, reusable.detail, reusable.tags);
    }
    return out;
  }

  // 资料导入：优先按结构化句提炼；无命中再记为外部/项目声明
  if (input.sourceKind === 'imported_material') {
    // 不提前 return，走下方启发式；末尾补 external_claim
  }

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

  if (/全部上云|云端优先|不要本地/.test(text) && !/本地优先/.test(text)) {
    push(
      'goal_updated',
      '方向调整提议',
      text.slice(0, 240),
      ['方向', 'goal', 'needs_confirmation'],
    );
  }

  if (
    input.sourceKind === 'conversation' &&
    /(?:在修改|正在修改|在做|正在做|最近在做).{0,48}项目/.test(text)
  ) {
    push(
      'feedback_recorded',
      '最近在做的事',
      text.slice(0, 240),
      ['doing_experience', 'silent_ok', 'category:work_experience', 'from_conversation'],
    );
  }

  // 明确项目决策（对话/资料）→ 短事实 + project: 范围，可静默
  if (looksLikeProjectDecision(text)) {
    const project = extractProjectScopeTag(text);
    const domain = extractDomainTags(text);
    const tags = [
      'project_decision',
      'category:working_method',
      'silent_ok',
      ...domain,
      ...(project ? [project] : []),
    ];
    if (input.sourceKind === 'imported_material') {
      tags.push('project_fact', 'from_material');
    } else {
      tags.push('from_conversation');
    }
    push('preference_observed', '项目决策', text.slice(0, 200), [...new Set(tags)]);
  }

  // 口语化偏好（与「正式」可冲突，由 enrichGrowthTags 标记）
  if (
    /以后|请记住|下次/.test(text) &&
    /口语|口语化|更口语|别太正式|不要太正式/.test(text)
  ) {
    push(
      'preference_observed',
      '偏好：更口语化',
      text.slice(0, 240),
      [
        'style',
        'preference',
        'category:working_method',
        'document',
        '口语',
        '介绍',
        ...extractDomainTags(text),
      ],
    );
  }

  // 明确“以后这样”的低风险写作偏好 → preference（可静默），不升格为原则
  if (
    /以后这样|以后都|请记住|下次请|以后给|以后.*汇报|以后.*周报/.test(text) &&
    /简洁|短句|少套话|结论先行|先讲结论|先给结论|正式|完整分析|保留完整|控制篇幅|决策事项|需要我决策|尽量简短|口语/.test(
      text,
    )
  ) {
    const title = /完整分析|保留完整|详细展开|详细论证/.test(text)
      ? '偏好：保留完整分析'
      : /口语|口语化/.test(text)
        ? '偏好：更口语化'
        : /结论先行|先讲结论|先给结论/.test(text)
          ? '偏好：结论先行'
          : /控制篇幅|尽量简短|简洁/.test(text)
            ? '偏好：控制篇幅'
            : '偏好：表达简洁';
    const domain = extractDomainTags(text);
    const project = extractProjectScopeTag(text);
    push(
      'preference_observed',
      title,
      text.slice(0, 240),
      [
        'style',
        'preference',
        'category:working_method',
        'document',
        '周报',
        '汇报',
        ...domain,
        ...(project ? [project] : []),
      ],
    );
  } else if (
    /先给结论|先讲结论|结论先行/.test(text) &&
    /尽量简短|控制篇幅|简洁|短句/.test(text) &&
    !/完整分析|保留完整|详细论证/.test(text) &&
    !isCorrectionStatement(text)
  ) {
    push(
      'preference_observed',
      '偏好：结论先行',
      text.slice(0, 240),
      ['style', 'preference', 'category:working_method', 'document', '周报', '汇报'],
    );
  } else if (/正式|结论先行/.test(text) && !/完整分析|保留完整|以后这样|请记住|以后给|尽量简短|先给结论/.test(text) && !isCorrectionStatement(text)) {
    push(
      'principle_stated',
      '原则：表达正式、结论先行',
      '对外文档采用正式语气,先给结论再展开',
      ['原则', '正式', '结论先行', '周报', 'document', 'needs_confirmation'],
    );
  }

  if (
    /完整分析|保留完整|详细展开|详细论证|写长一点/.test(text) &&
    !/以后这样|请记住|仅本次|只这一次/.test(text) &&
    !isCorrectionStatement(text)
  ) {
    push(
      'preference_observed',
      '偏好：保留完整分析',
      text.slice(0, 240),
      ['style', '完整分析', 'preference', 'document', '周报', '汇报'],
    );
  }

  if (
    /简洁|短句|少套话|不要空话|尽量简短/.test(text) &&
    !/正式|结论先行|先给结论|以后这样|请记住|完整分析|保留完整|详细论证/.test(text) &&
    !isCorrectionStatement(text)
  ) {
    push(
      'preference_observed',
      '偏好：表达简洁',
      text.slice(0, 240),
      ['style', '简洁', 'preference', '汇报'],
    );
  }

  // 纠正性陈述：提炼替换后的偏好（低风险可静默），供 supersede 闭环复用
  if (
    (input.sourceKind === 'conversation' ||
      input.sourceKind === 'repeated_correction' ||
      input.sourceKind === 'artifact_edit') &&
    isCorrectionStatement(text)
  ) {
    const replacement = extractReplacementPreference(text);
    if (replacement) {
      const domain = extractDomainTags(text);
      const project = extractProjectScopeTag(text);
      push(
        'preference_observed',
        replacement.title,
        replacement.detail,
        [
          'style',
          'preference',
          'category:working_method',
          'correction',
          'supersede',
          'silent_ok',
          ...domain,
          ...(project ? [project] : []),
        ],
      );
    }
  }

  // 成果修改后采用 → 工作偏好（可静默，易纠正）
  if (input.sourceKind === 'artifact_edit' && /简洁|结构|结论|标题|完整|分析/.test(text)) {
    push(
      'preference_observed',
      '偏好：修改后的表达方式',
      text.slice(0, 240),
      ['style', 'preference', 'category:working_method', 'document', 'from_edit'],
    );
  }

  if (looksLikeIdentityClaim(text) || input.sourceKind === 'initial_self_description') {
    const selfName = extractExplicitSelfName(text);
    const already = out.some((e) => e.type === 'identity_clarified');
    if (!already) {
      if (selfName) {
        push(
          'identity_clarified',
          '姓名',
          selfName,
          ['身份', 'self_name', 'silent_ok', 'from_conversation', 'category:identity_fact'],
        );
      } else {
        const line =
          text
            .split(/\n/)
            .map((l) => l.trim())
            .find((l) => l.length > 0) || text;
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
      [(input.requestedArtifactType || 'document').toLowerCase(), 'silent_ok'],
    );
  }

  if (input.sourceKind === 'task_requirement' && out.length === 0 && text.length >= 4) {
    push(
      'knowledge_gap_noted',
      '还不确定：任务中提到的偏好',
      text.slice(0, 400),
      ['gap', 'task_requirement', 'category:temporary_context'],
    );
  }

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

  if (input.sourceKind === 'imported_material' && looksLikePersonalResume(text)) {
    const facts = extractResumePersonalFacts(text);
    for (const fact of facts) {
      if (fact.type === 'identity_clarified') {
        push(
          'identity_clarified',
          fact.title,
          fact.detail,
          ['身份', 'from_resume', 'needs_confirmation', 'category:identity_fact'],
        );
      } else {
        push(
          'feedback_recorded',
          fact.title,
          fact.detail,
          ['from_resume', 'needs_confirmation', 'category:work_experience'],
        );
      }
    }
  }

  if (input.sourceKind === 'imported_material' && out.length === 0 && text.length >= 2) {
    const project = extractProjectScopeTag(text);
    const tags = ['material', 'category:external_claim', 'project_fact'];
    if (project) tags.push(project);
    // 无决策措辞：仅外部声明候选，不静默成偏好；截断保存，不落全文材料本体
    push('asset_added', '资料中的项目事实', text.slice(0, 240), tags);
  }

  return out;
}
