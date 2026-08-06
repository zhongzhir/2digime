/** 从任务目标抽取主题词（英文专名 + 「关于X」）。供 prompt 与 outcome check 共用。 */
export function extractTopicTerms(goal: string): string[] {
  const terms: string[] = [];
  const about = /关于\s*([A-Za-z][A-Za-z0-9_-]{1,}|\S{2,24}?)(?:\s*项目|\s*的|，|。|$)/.exec(
    goal,
  );
  if (about?.[1]) terms.push(about[1].replace(/的$/, '').trim());
  for (const part of goal.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || []) {
    if (!/^(the|and|for|with|from|about|article|document)$/i.test(part)) {
      terms.push(part);
    }
  }
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 6);
}
