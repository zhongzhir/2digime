/** 原始 intent 是语义判断的权威输入；字段仅承担协议兼容，不做词表推断。 */
import type { SignalPayload } from './signal';

export function deriveSignalFieldsFromIntent(intent: string): {
  seeking: string[];
  offering: string[];
} {
  const text = String(intent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return { seeking: text ? [text] : [], offering: [] };
}

/** 以 intent 为权威，纠正空壳 offering / seeking（如「相关能力与经验」）。 */
export function enrichSignalPayload(signal: SignalPayload): SignalPayload {
  const derived = deriveSignalFieldsFromIntent(signal.intent);
  const seekingEmpty = !signal.seeking?.length;
  const offeringGeneric =
    !signal.offering?.length ||
    signal.offering.every((item) =>
      /相关能力与经验|相关经验|相关协作意向|基于当前工作方向/.test(String(item || '')),
    );

  return {
    ...signal,
    seeking: seekingEmpty ? derived.seeking : unique(signal.seeking),
    offering: offeringGeneric ? [] : unique(signal.offering),
  };
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
