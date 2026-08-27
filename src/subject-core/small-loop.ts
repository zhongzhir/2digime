/**
 * DIGITALME-V2-SMALL-LOOP-INTEGRATION-01
 * 小循环辅助：域标签 / 项目范围 / 偏好匹配 / 用户面短句。
 * 不引入第二 Memory Store；标签落在既有 GrowthEvent.payload.tags。
 */

const STYLE_DOMAIN_TAGS = new Set([
  'style',
  'preference',
  'document',
  '周报',
  '汇报',
  '介绍',
  'from_edit',
  'correction',
  'category:working_method',
  'category:preference',
]);

const DOC_LIKE = /document|article|周报|汇报|介绍|文案|文章|纪要|摘要/;

/**
 * SUBJECT-GROUNDED-WORK-01：项目名之后/之前的通用文档或工作名词不是项目名。
 * 「项目汇报 / 项目周报 / 项目介绍 / 项目计划 …」应识别为体裁，而不是 project:<name>。
 */
const GENERIC_AFTER_PROJECT =
  /^(汇报|周报|月报|日报|季报|介绍|说明|文档|方案|计划|规划|进度|复盘|总结|纪要|概述|分析|大纲|白皮书|发布|上线|立项|资料|材料|文件|工作|任务|事项|清单|情况|报告|详情|概述|摘要)/;

/** 从文本提炼短项目范围标签（project:slug），无则 null。 */
export function extractProjectScopeTag(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const named =
    t.match(/\b([A-Z][a-zA-Z0-9_-]{1,32})\s*项目/) ||
    t.match(/项目\s*[「『"']?\s*([A-Z][a-zA-Z0-9_-]{1,32}|[A-Za-z][\w-]{1,32}|[\u4e00-\u9fff]{2,12})\s*[」』"']?/) ||
    t.match(/(?:项目|代号)\s*[「『"]?\s*([A-Za-z][\w-]{1,32}|[\u4e00-\u9fff]{2,12})\s*[」』"]?/) ||
    t.match(/\b([A-Z][a-zA-Z0-9_-]{2,24})\b/);
  if (named?.[1] && !/^(API|HTTP|JSON|MVP|PDF)$/i.test(named[1])) {
    const captured = String(named[1]);
    if (GENERIC_AFTER_PROJECT.test(captured)) return null;
    return `project:${slugifyProject(captured)}`;
  }
  return null;
}

export function slugifyProject(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .slice(0, 48);
}

/** 域/风格标签（短，可检索；非全文）。 */
export function extractDomainTags(text: string): string[] {
  const tags: string[] = [];
  const t = text;
  if (/周报|汇报/.test(t)) tags.push('周报', '汇报', 'document');
  if (/介绍|产品介绍|项目介绍/.test(t)) tags.push('介绍', 'document');
  if (/结论先行|先给结论|先讲结论/.test(t)) tags.push('结论先行');
  if (/口语|口语化|更口语/.test(t)) tags.push('口语');
  if (/正式|书面/.test(t) && !/不要正式|别正式|反对正式|更口语/.test(t)) tags.push('正式');
  if (/简洁|短句|少套话|控制篇幅|尽量简短/.test(t)) tags.push('简洁');
  if (/完整分析|详细展开|写长一点/.test(t)) tags.push('完整分析');
  if (/交付|范围|冻结|模块/.test(t)) tags.push('project_decision');
  return [...new Set(tags)];
}

export function tagValue(tags: readonly string[], prefix: string): string | null {
  const hit = tags.find((t) => t.toLowerCase().startsWith(prefix.toLowerCase()));
  return hit ? hit.slice(prefix.length) : null;
}

export function isDocumentLikeTask(goal: string, requestedArtifactType: string): boolean {
  return DOC_LIKE.test(`${goal} ${requestedArtifactType}`.toLowerCase());
}

export function hasReusableStyleTags(tags: readonly string[]): boolean {
  return tags.some((t) => STYLE_DOMAIN_TAGS.has(t.toLowerCase()) || t === 'category:working_method');
}

/**
 * 项目范围门禁：带 project:X 的知识仅在目标/提示命中同项目时注入。
 * 无 project: 标签 → 通用，不拦截。
 */
export function projectScopeAllows(input: {
  entryTags: readonly string[];
  goal: string;
  scopeHints?: readonly string[];
}): boolean {
  const project = tagValue(input.entryTags, 'project:');
  if (!project) return true;
  const hay = `${input.goal} ${(input.scopeHints || []).join(' ')}`.toLowerCase();
  const slug = project.toLowerCase();
  if (hay.includes(slug)) return true;
  // 中文项目名可能未 slug 化：比对原片段
  const compact = slug.replace(/-/g, '');
  if (compact && hay.replace(/\s+/g, '').includes(compact)) return true;
  return false;
}

/** 偏好匹配分：含标签；域亲和可降至 1 分门槛。 */
export function scorePreferenceForTask(input: {
  goal: string;
  requestedArtifactType: string;
  title: string;
  detail: string;
  tags: readonly string[];
  tokenize: (text: string) => Set<string>;
  scoreText: (tokens: Set<string>, text: string) => number;
}): { score: number; minScore: number; domainMatch: boolean } {
  const tokens = input.tokenize(input.goal);
  const hay = `${input.title} ${input.detail} ${input.tags.join(' ')}`;
  let score = input.scoreText(tokens, hay);
  const docLike = isDocumentLikeTask(input.goal, input.requestedArtifactType);
  const style = hasReusableStyleTags(input.tags);
  const domainCue =
    (/周报|汇报/.test(input.goal) && input.tags.some((t) => /周报|汇报/.test(t))) ||
    (/介绍/.test(input.goal) && input.tags.some((t) => /介绍/.test(t))) ||
    (/口语|正式|结论|简洁|篇幅/.test(input.goal) && style);
  const domainMatch =
    (docLike && style && (domainCue || score >= 1)) ||
    (docLike && input.tags.includes('correction'));
  if (domainMatch && score < 1) score = 1;
  if (domainMatch && score < 2 && (domainCue || input.tags.includes('correction'))) {
    score = Math.max(score, 1);
  }
  if (input.tags.includes('correction') && docLike) {
    score = Math.max(score, 2);
  }
  const minScore =
    domainMatch || input.tags.includes('correction') || input.tags.includes('project_decision')
      ? 1
      : 2;
  return { score, minScore, domainMatch };
}

/** Owner 验收用短句：不暴露内部类型名。 */
export function phraseRecentLearning(input: {
  title: string;
  detail: string;
  tags?: readonly string[];
}): string {
  const tags = input.tags || [];
  const body = (input.title || input.detail || '').trim();
  if (tags.includes('project_decision') || tags.includes('project_fact')) {
    const project = tagValue(tags, 'project:');
    const about = project ? `关于 ${project}，已确认` : '关于该项目，已确认';
    const tip = (input.detail || input.title).replace(/^项目决策[：:]\s*/, '').slice(0, 60);
    return `${about}：${tip}`;
  }
  if (tags.includes('correction')) {
    return `以后处理这类任务时：${body.replace(/^纠正[：:]\s*|^偏好[：:]\s*/, '').slice(0, 80)}`;
  }
  if (tags.includes('style') || tags.includes('preference') || tags.includes('category:working_method')) {
    return `你更偏好：${body.replace(/^偏好[：:]\s*/, '').slice(0, 80)}`;
  }
  return body.slice(0, 100);
}

/** 是否像明确项目决策（可静默沉淀为可复用短事实）。 */
export function looksLikeProjectDecision(text: string): boolean {
  // 须有明确「确认/决定/已确定」语义；单纯背景介绍、推测、闲聊不得升格
  if (/也许|可能|据说|有人提到|闲聊|不是决定|这只是背景/.test(text)) {
    return false;
  }
  return (
    /(?:本项目|该项目).{0,40}(?:已确认|决定|确定|已经确定|已确定)/.test(text) ||
    /(?:[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_-]{1,24})\s*项目.{0,20}(?:已经确定|已确定|已确认|决定)/.test(
      text,
    ) ||
    /(?:已经确定|已确定|已确认|决定).{0,40}(?:交付|范围|模块|架构|冻结|试用|发布)/.test(text) ||
    /交付范围.{0,20}(?:已确认|决定|冻结为|已经确定)/.test(text)
  );
}

/** 从决策反馈文本提炼可复用短句（禁止全文）。 */
export function distillDecisionReusableSnippet(text: string, kind: 'accept' | 'reject'): {
  title: string;
  detail: string;
  tags: string[];
} | null {
  const t = text.trim().slice(0, 400);
  if (!t || t.length < 4) return null;
  const domain = extractDomainTags(t);
  const project = extractProjectScopeTag(t);

  if (kind === 'reject') {
    if (!/不要|别再|避免|空话|套话|太正式|太长|不对|错误|拒绝|未采用/.test(t) && t.length < 8) {
      return null;
    }
    const detail = /空话|套话/.test(t)
      ? '避免空话套话，写清实质要点'
      : /太正式|不要正式|口语/.test(t)
        ? '表达更口语化，避免过于书面'
        : /太长|篇幅|简洁/.test(t)
          ? '控制篇幅，先给结论'
          : t.slice(0, 200);
    const tags = [
      'style',
      'preference',
      'category:working_method',
      'correction',
      'document',
      'from_reject',
      'silent_ok',
      ...domain,
    ];
    if (project) tags.push(project);
    return { title: '纠正：避免重复同类问题', detail, tags: [...new Set(tags)] };
  }

  if (
    !/简洁|结论|节奏|口语|正式|篇幅|结构|空话|套话|风格|偏好|以后/.test(t) &&
    !looksLikeProjectDecision(t)
  ) {
    return null;
  }

  if (looksLikeProjectDecision(t)) {
    const tags = [
      'project_decision',
      'category:working_method',
      'silent_ok',
      ...domain,
    ];
    if (project) tags.push(project);
    return {
      title: '项目决策',
      detail: t.slice(0, 200),
      tags: [...new Set(tags)],
    };
  }

  const title = /结论先行|先给结论/.test(t)
    ? '偏好：结论先行'
    : /口语/.test(t)
      ? '偏好：更口语化'
      : /正式/.test(t)
        ? '偏好：表达正式'
        : /节奏/.test(t)
          ? '偏好：发布节奏明确'
          : /简洁|空话|套话|篇幅/.test(t)
            ? '偏好：表达简洁'
            : '偏好：修改后的表达方式';
  const tags = [
    'style',
    'preference',
    'category:working_method',
    'document',
    'from_edit',
    'silent_ok',
    ...domain,
  ];
  if (project) tags.push(project);
  return { title, detail: t.slice(0, 200), tags: [...new Set(tags)] };
}
