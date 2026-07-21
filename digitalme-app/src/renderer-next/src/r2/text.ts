/** Unicode code point helpers for renderer-next. */

export function codePointCount(text: string): number {
  let n = 0;
  for (const _ of String(text || "")) n += 1;
  return n;
}

export function sliceCodePoints(text: string, maxPoints: number): string {
  const s = String(text || "");
  const max = Math.max(0, maxPoints | 0);
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (n >= max) break;
    out += ch;
    n += 1;
  }
  return out;
}

export function foldPlan(
  text: string,
  opts?: { forbidExpand?: boolean; previewMax?: number; expandMax?: number }
) {
  const forbidExpand = !!opts?.forbidExpand;
  const previewMax = opts?.previewMax ?? 1600;
  const expandMax = opts?.expandMax ?? 8000;
  const raw = String(text || "");
  if (forbidExpand) {
    return { preview: raw, expanded: raw, needsFold: false, forbidExpand: true };
  }
  if (codePointCount(raw) <= previewMax) {
    return { preview: raw, expanded: raw, needsFold: false, forbidExpand: false };
  }
  const expanded =
    codePointCount(raw) > expandMax
      ? sliceCodePoints(raw, expandMax) + "\n\n…（已达展开上限）"
      : raw;
  return {
    preview: sliceCodePoints(raw, previewMax) + "\n\n…",
    expanded,
    needsFold: true,
    forbidExpand: false,
  };
}

/** Legacy user question recovery — never returns attachment bodies. */
export function extractUserQuestionFromRaw(raw: string): string | null {
  const s = String(raw || "");
  if (!s) return null;
  const sep = "\n\n---\n以下是我附上的材料正文";
  const sepIdx = s.indexOf(sep);
  const maxQ = 500;
  if (sepIdx >= 0) {
    let q = s.slice(0, sepIdx).trim();
    if (codePointCount(q) > maxQ) q = sliceCodePoints(q, maxQ) + "…";
    return q || null;
  }
  const mark = s.search(/\n(?:［附件：|已附上：)/);
  if (mark >= 0) {
    let q = s.slice(0, mark).trim();
    if (codePointCount(q) > maxQ) q = sliceCodePoints(q, maxQ) + "…";
    return q || null;
  }
  if (codePointCount(s) <= maxQ) return s.trim() || null;
  return null;
}
