import * as path from 'node:path';

/**
 * REAL-MCP-READONLY-01 — 只读投影与用户面结果。
 * 实际允许的工具名必须来自真实 tools/list，再与本候选集求交。
 */
export const REJECTED_BY_DIGITALME_POLICY = 'rejected_by_digitalme_policy';

/** 只读候选（不是猜测清单；gate 必须与真实 tools/list 求交后才启用）。 */
export const MCP_FILESYSTEM_READONLY_CANDIDATES = [
  'read_file',
  'read_text_file',
  'list_directory',
  'search_files',
  'get_file_info',
  'list_allowed_directories',
] as const;

export function isWriteTool(toolName: string): boolean {
  const n = String(toolName || '');
  if (
    /(^|_)(write|create|update|delete|edit|append|remove|move|mkdir|unlink|rename|truncate|put|post|exec|run|pay)(_|$)/i.test(
      n,
    )
  ) {
    return true;
  }
  return /^(write|create|update|delete|edit|append|remove|move|put|post|exec|run|pay)/i.test(n);
}

export function projectReadonlyTools(
  serverTools: ReadonlyArray<{ name: string; annotations?: { readOnlyHint?: boolean } }>,
  candidates: readonly string[] = MCP_FILESYSTEM_READONLY_CANDIDATES,
): string[] {
  const allowed = new Set(candidates);
  const visible: string[] = [];
  for (const tool of serverTools) {
    const name = String(tool.name || '').trim();
    if (!name || !allowed.has(name) || isWriteTool(name)) continue;
    if (tool.annotations?.readOnlyHint === false) continue;
    visible.push(name);
  }
  return visible;
}

export function extractMcpToolText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const rec = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: { content?: unknown };
    notes?: unknown;
    contentText?: unknown;
  };
  if (Array.isArray(rec.content)) {
    const parts = rec.content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => String(c.text));
    if (parts.length) return parts.join('\n');
  }
  if (typeof rec.structuredContent?.content === 'string') {
    return rec.structuredContent.content;
  }
  return '';
}

export function parseListedFileNames(listText: string): string[] {
  const names: string[] = [];
  for (const line of String(listText || '').split(/\r?\n/)) {
    const m = /\[FILE\]\s+(\S+)/.exec(line.trim());
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/** 用户要查看已提供的项目资料时，由 2digime 选用只读资料能力；不是通用关键词路由。 */
export function looksLikeProvidedMaterialsLookup(goal: string): boolean {
  const t = String(goal || '').trim();
  if (!t) return false;
  return /提供的项目资料/.test(t) && /active/i.test(t) && /优先级/.test(t);
}

export function formatActiveProjectAnswer(
  notes: ReadonlyArray<{ name: string; text: string }>,
): string {
  for (const note of notes) {
    const status = /Status:\s*(\S+)/i.exec(note.text);
    if (!status || !/^active$/i.test(status[1] || '')) continue;
    const title =
      note.text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || note.name.replace(/\.md$/i, '');
    const pri = /Priority:\s*(\S+)/i.exec(note.text);
    const priority = pri?.[1] || '未标注';
    return `${title} 处于 active 状态，优先级为 ${priority}。`;
  }
  return '没有找到处于 active 状态的项目。';
}

export function assertPathInsideAllowed(target: string, allowedDirectory: string): string {
  const resolved = path.resolve(target);
  const root = path.resolve(allowedDirectory);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw Object.assign(new Error(REJECTED_BY_DIGITALME_POLICY), {
      stage: 'capability' as const,
      code: REJECTED_BY_DIGITALME_POLICY,
      actionable: '当前只读能力不能访问该范围以外的资料。',
    });
  }
  return resolved;
}

export function buildFilesystemMcpServerCommand(allowedDirectory: string): string[] {
  if (process.platform === 'win32') {
    return [
      'cmd.exe',
      '/c',
      'npx',
      '-y',
      '@modelcontextprotocol/server-filesystem',
      allowedDirectory,
    ];
  }
  return ['npx', '-y', '@modelcontextprotocol/server-filesystem', allowedDirectory];
}
