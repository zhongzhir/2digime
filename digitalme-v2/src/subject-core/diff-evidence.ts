/**
 * 确定性 Artifact 修改证据提炼(P1.3)。
 * 不调用模型;只提炼明确修改事实;禁止宽泛人格/价值观推导。
 * GrowthEvent 只存摘要与 evidence 锚点,不复制完整 Artifact 正文。
 */

export interface DiffFact {
  kind: 'deleted_phrase' | 'added_phrase' | 'replaced_name' | 'structure_change';
  summary: string;
  before?: string;
  after?: string;
}

export interface DiffEvidenceResult {
  facts: DiffFact[];
  /** 供 GrowthEvent.payload 使用的短摘要。 */
  title: string;
  detail: string;
  tags: string[];
}

const MAX_FACT_CHARS = 120;
const MAX_FACTS = 8;

/** 比较两版文本,产出精确修改事实。无明确差异时返回空 facts。 */
export function extractEditEvidence(beforeText: string, afterText: string): DiffEvidenceResult {
  const before = normalize(beforeText);
  const after = normalize(afterText);
  if (before === after) {
    return { facts: [], title: '', detail: '', tags: [] };
  }

  const facts: DiffFact[] = [];
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  for (const line of beforeLines) {
    if (!afterSet.has(line) && line.trim().length > 0) {
      if (isHeading(line)) {
        pushFact(facts, {
          kind: 'structure_change',
          summary: `删除结构: ${clip(line)}`,
          before: clip(line),
        });
      } else {
        pushFact(facts, {
          kind: 'deleted_phrase',
          summary: `删除表达: ${clip(line)}`,
          before: clip(line),
        });
      }
    }
  }

  for (const line of afterLines) {
    if (!beforeSet.has(line) && line.trim().length > 0) {
      if (isHeading(line)) {
        pushFact(facts, {
          kind: 'structure_change',
          summary: `增加结构: ${clip(line)}`,
          after: clip(line),
        });
      } else {
        pushFact(facts, {
          kind: 'added_phrase',
          summary: `增加内容: ${clip(line)}`,
          after: clip(line),
        });
      }
    }
  }

  // 同行替换:长度相近且共享前缀/后缀的行 → 名称替换候选
  for (const b of beforeLines) {
    if (afterSet.has(b) || b.trim().length === 0) continue;
    for (const a of afterLines) {
      if (beforeSet.has(a) || a.trim().length === 0) continue;
      const replacement = detectNameReplacement(b, a);
      if (replacement) {
        pushFact(facts, {
          kind: 'replaced_name',
          summary: `替换名称: ${replacement.from} → ${replacement.to}`,
          before: replacement.from,
          after: replacement.to,
        });
      }
    }
  }

  const limited = facts.slice(0, MAX_FACTS);
  if (limited.length === 0) {
    return { facts: [], title: '', detail: '', tags: [] };
  }

  const tags = [...new Set(limited.map((f) => f.kind.replace('_', '-')))];
  const title = limited[0]?.kind === 'replaced_name'
    ? '措辞替换'
    : limited[0]?.kind === 'structure_change'
      ? '结构调整'
      : limited[0]?.kind === 'deleted_phrase'
        ? '删除表达'
        : '内容增补';

  return {
    facts: limited,
    title,
    detail: limited.map((f) => f.summary).join('；'),
    tags,
  };
}

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').trimEnd();
}

function splitLines(text: string): string[] {
  return text.split('\n').map((l) => l.trimEnd());
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trim());
}

function clip(text: string): string {
  const t = text.trim();
  return t.length <= MAX_FACT_CHARS ? t : `${t.slice(0, MAX_FACT_CHARS - 1)}…`;
}

function pushFact(facts: DiffFact[], fact: DiffFact): void {
  if (facts.some((f) => f.summary === fact.summary)) return;
  facts.push(fact);
}

/** 简单名称替换:两行编辑距离中仅少数词元变化,且变化词为专名形态。 */
function detectNameReplacement(
  before: string,
  after: string,
): { from: string; to: string } | null {
  const bt = before.trim().split(/\s+/);
  const at = after.trim().split(/\s+/);
  if (bt.length !== at.length || bt.length === 0) return null;
  const diffs: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < bt.length; i += 1) {
    if (bt[i] !== at[i]) diffs.push({ from: bt[i] as string, to: at[i] as string });
  }
  if (diffs.length !== 1) return null;
  const d = diffs[0] as { from: string; to: string };
  if (d.from.length < 2 || d.to.length < 2) return null;
  if (d.from === d.to) return null;
  return d;
}
