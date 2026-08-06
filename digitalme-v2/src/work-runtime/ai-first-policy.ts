/**
 * AI-first 执行策略 — 内部档位与轻量 Outcome Check。
 * 用户面不展示档位名；不构成第二状态机。
 */
import { extractTopicTerms } from '../capability/adapters/task-goal-terms';

export type ExecutionProfile = 'standard' | 'careful' | 'high_risk';

export type OutcomeVerdict = 'pass' | 'targeted_revision_required' | 'blocked';

export interface OutcomeCheckResult {
  verdict: OutcomeVerdict;
  defects: string[];
  profile: ExecutionProfile;
}

const HIGH_RISK_RE =
  /法律意见|诉讼|合同签署|转账|支付|汇款|公开发布|对外发布|隐私数据|身份证|银行卡|不可逆|删除全部|清空数据库|敏感个人信息/;

const CARE_RE =
  /高质量|务必认真|详细论证|深度分析|完整方案|正式对外|评审级|慎重/;

/**
 * 自动选择内部执行档位；用户面不出现这些名称。
 */
export function chooseExecutionProfile(input: {
  goal: string;
  requestedArtifactType?: string;
}): ExecutionProfile {
  const goal = String(input.goal || '');
  if (HIGH_RISK_RE.test(goal)) return 'high_risk';
  if (CARE_RE.test(goal)) return 'careful';
  return 'standard';
}

/**
 * 轻量结果检查：主题 / 字数 / 明确要点 / 修订落实 / 实质变化 / 硬边界。
 * 不做复杂评分体系。
 */
export function checkOutcome(input: {
  goal: string;
  text: string;
  hardBoundaryTexts?: string[];
  profile?: ExecutionProfile;
  /** 修订前正文；用于检测“换版本号但正文几乎不变”。 */
  previousText?: string;
  /** 用户修改说明。 */
  revisionRequest?: string;
}): OutcomeCheckResult {
  const profile = input.profile || chooseExecutionProfile({ goal: input.goal });
  const text = String(input.text || '').trim();
  const goal = String(input.goal || '').trim();
  const defects: string[] = [];

  if (!text || text.length < 40) {
    defects.push('成果过短或为空，请补足可读正文。');
  }
  if (!/^#\s+\S+/m.test(text) && text.length < 120) {
    defects.push('成果缺少清晰标题或结构，请整理为可直接使用的文档。');
  }

  // 主题：任务目标中的专名/「关于X」必须出现在正文
  const topics = extractTopicTerms(goal);
  const missingTopics = topics.filter((t) => !includesIgnoreCase(text, t));
  if (missingTopics.length > 0) {
    defects.push(`成果主题未紧扣任务要求：缺少「${missingTopics.slice(0, 3).join('、')}」。`);
  }

  // 明确字数：不少于 N 为硬约束；约 N 仅在严重偏短时记缺陷
  const minLen = parseMinLength(goal);
  if (minLen !== null) {
    const chars = countContentChars(text);
    const strictMin = /不少于\s*\d{2,5}\s*字/.test(goal);
    const threshold = strictMin ? Math.floor(minLen * 0.9) : Math.floor(minLen * 0.45);
    if (chars < threshold) {
      defects.push(
        strictMin
          ? `字数未达到任务要求（需要不少于约 ${minLen} 字，当前约 ${chars} 字）。`
          : `字数明显偏短（任务约 ${minLen} 字，当前约 ${chars} 字）。`,
      );
    }
  }

  // 目标中的明确必含词
  const mustHints = extractMustHints(goal);
  const missing = mustHints.filter((h) => !includesIgnoreCase(text, h));
  if (missing.length >= 1 && mustHints.length >= 1) {
    // 主题词已单独检查；此处对「必须包含」类短语仍要求
    const phraseMissing = missing.filter((h) => !topics.some((t) => t.toLowerCase() === h.toLowerCase()));
    if (phraseMissing.length >= 1) {
      defects.push(`未覆盖任务明确要求的要点：${phraseMissing.slice(0, 3).join('、')}。`);
    }
  }

  // 修订：修改说明中的关键点应有落实痕迹；新旧稿须有实质变化
  const revisionRequest = String(input.revisionRequest || '').trim();
  const previousText = String(input.previousText || '').trim();
  if (revisionRequest) {
    const revHints = extractRevisionHints(revisionRequest);
    const missedRev = revHints.filter((h) => !includesIgnoreCase(text, h));
    if (missedRev.length > 0) {
      defects.push(`修改说明未落实：仍缺少「${missedRev.slice(0, 3).join('、')}」。`);
    }
  }
  if (previousText && text) {
    const similarity = roughSimilarity(previousText, text);
    if (similarity >= 0.92) {
      defects.push('新版本与上一版几乎相同，请按修改要求重写，不得只换版本号。');
    }
  }

  for (const boundary of input.hardBoundaryTexts || []) {
    const b = boundary.trim();
    if (!b) continue;
    const m = /exclude(?:-tag)?:(\S+)/i.exec(b) || /不讨论(\S+)/.exec(b);
    if (m?.[1] && text.includes(m[1])) {
      defects.push(`成果触及硬边界「${m[1]}」，请删除相关内容。`);
    }
  }

  if (HIGH_RISK_RE.test(text) && profile !== 'high_risk') {
    defects.push('成果含有需确认的高风险表述，请改为可核对的中性说明。');
  }

  if (defects.some((d) => /硬边界/.test(d))) {
    return { verdict: 'blocked', defects, profile };
  }
  if (defects.length === 0) {
    return { verdict: 'pass', defects, profile };
  }
  if (!text.trim()) {
    return { verdict: 'blocked', defects, profile };
  }
  return { verdict: 'targeted_revision_required', defects, profile };
}

export function parseMinLength(goal: string): number | null {
  const min = /不少于\s*(\d{2,5})\s*字/.exec(goal);
  if (min) return Number(min[1]);
  const approx = /约\s*(\d{2,5})\s*字/.exec(goal);
  if (approx) return Number(approx[1]);
  return null;
}

function countContentChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function includesIgnoreCase(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(String(needle || '').toLowerCase());
}

function extractMustHints(goal: string): string[] {
  const hints: string[] = [];
  for (const re of [
    /必须包含([^，。；、\s]{2,16})/g,
    /必须([^，。；、\s]{2,16})/g,
    /需要包含([^，。；、\s]{2,16})/g,
    /需要([^，。；、\s]{2,16})/g,
    /突出([^，。；、\s]{2,16})/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(goal))) {
      if (m[1]) hints.push(m[1]);
    }
  }
  return [...new Set(hints)].slice(0, 6);
}

function extractRevisionHints(request: string): string[] {
  const hints = extractTopicTerms(request);
  for (const re of [
    /综合材料中的([^，。；]{2,24})/g,
    /必须(?:包含|围绕|写明)([^，。；]{2,24})/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(request))) {
      if (m[1]) {
        for (const part of m[1].split(/[、和与及,/]/)) {
          const p = part.trim();
          if (p.length >= 2) hints.push(p.slice(0, 16));
        }
      }
    }
  }
  return [...new Set(hints)].slice(0, 6);
}

/** 粗相似度：基于去空白后的公共前缀 + 长度比，避免引入重型依赖。 */
export function roughSimilarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, '');
  const y = b.replace(/\s+/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const minLen = Math.min(x.length, y.length);
  const maxLen = Math.max(x.length, y.length);
  let same = 0;
  const window = Math.min(minLen, 1200);
  for (let i = 0; i < window; i += 1) {
    if (x[i] === y[i]) same += 1;
  }
  const prefixRatio = window === 0 ? 0 : same / window;
  const lengthRatio = minLen / maxLen;
  // 前缀很像且长度接近 → 高相似
  return prefixRatio * 0.7 + lengthRatio * 0.3;
}

/** 修订提示：只含明确缺陷，不回灌全部主体上下文。 */
export function buildTargetedRevisionRequest(defects: string[]): string {
  return ['请仅针对以下问题修改全文，不要改变无关部分：', ...defects.map((d, i) => `${i + 1}. ${d}`)].join(
    '\n',
  );
}
