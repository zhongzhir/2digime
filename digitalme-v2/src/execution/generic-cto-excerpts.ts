/** 从 unified diff 抽取短摘录，供通用 CTO 证据包使用。 */
export function excerptsFromGenericDiff(
  diff: string,
  files: string[],
): Array<{ path: string; excerpt: string }> {
  const text = String(diff || '');
  const out: Array<{ path: string; excerpt: string }> = [];
  for (const file of files.slice(0, 8)) {
    const norm = String(file || '').replace(/\\/g, '/');
    if (!norm) continue;
    const base = norm.split('/').pop() || norm;
    const idx = text.indexOf(base);
    if (idx < 0) continue;
    out.push({
      path: norm,
      excerpt: text.slice(Math.max(0, idx - 40), idx + 560),
    });
  }
  return out;
}
