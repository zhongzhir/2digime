/**
 * AI-first 执行策略 — 内部档位与轻量 Outcome Check。
 * 用户面不展示档位名；不构成第二状态机。
 */
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
 * 轻量结果检查：明确要求 / 硬边界 / 可读完整 / 明显冲突 / 高风险泄漏。
 * 不做复杂评分体系。
 */
export function checkOutcome(input: {
  goal: string;
  text: string;
  hardBoundaryTexts?: string[];
  profile?: ExecutionProfile;
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

  // 目标中的明确必含词（长度≥2 的中文词或英文词）若完全未出现，记为可修订缺陷
  const mustHints = extractMustHints(goal);
  const missing = mustHints.filter((h) => !text.toLowerCase().includes(h.toLowerCase()));
  if (missing.length >= 2 && mustHints.length >= 2) {
    defects.push(`未覆盖任务明确要求的要点：${missing.slice(0, 3).join('、')}。`);
  }

  for (const boundary of input.hardBoundaryTexts || []) {
    const b = boundary.trim();
    if (!b) continue;
    // 边界条目中 exclude:X → 正文不得出现 X
    const m = /exclude(?:-tag)?:(\S+)/i.exec(b) || /不讨论(\S+)/.exec(b);
    if (m?.[1] && text.includes(m[1])) {
      defects.push(`成果触及硬边界「${m[1]}」，请删除相关内容。`);
    }
  }

  if (HIGH_RISK_RE.test(text) && profile !== 'high_risk') {
    // 普通任务突然出现高风险操作表述 → 阻断展示前需修订或拦截
    defects.push('成果含有需确认的高风险表述，请改为可核对的中性说明。');
  }

  if (defects.some((d) => /硬边界/.test(d))) {
    return { verdict: 'blocked', defects, profile };
  }
  if (defects.length === 0) {
    return { verdict: 'pass', defects, profile };
  }
  // 完全空成果才 blocked；过短及其他明确缺陷走一次针对性修订
  if (!text.trim()) {
    return { verdict: 'blocked', defects, profile };
  }
  return { verdict: 'targeted_revision_required', defects, profile };
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
  // 英文关键词
  for (const part of goal.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || []) {
    hints.push(part);
  }
  return [...new Set(hints)].slice(0, 6);
}

/** 修订提示：只含明确缺陷，不回灌全部主体上下文。 */
export function buildTargetedRevisionRequest(defects: string[]): string {
  return ['请仅针对以下问题修改全文，不要改变无关部分：', ...defects.map((d, i) => `${i + 1}. ${d}`)].join(
    '\n',
  );
}
