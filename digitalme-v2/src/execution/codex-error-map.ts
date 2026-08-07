/**
 * Codex JSONL / 退出摘要 → Digital Me 可行动错误分类。
 * 不绑定 Codex 专有字段到合同；仅 Adapter 内部使用。
 */

export type CodexFailureKind =
  | 'cli_outdated_or_model_incompatible'
  | 'auth_failed'
  | 'model_unavailable'
  | 'spawn_failed'
  | 'timeout'
  | 'cancelled'
  | 'no_substantive_change'
  | 'executor_error'
  | 'unknown';

export interface CodexFailureMapping {
  kind: CodexFailureKind;
  /** 面向用户的可行动说明（无密钥、无过长服务端原文）。 */
  actionable: string;
  /** 短摘要，可写入 Job / executor-run / verification。 */
  summary: string;
}

const SECRET_RE =
  /(api[_-]?key|token|secret|bearer\s+[a-z0-9._\-]+|sk-[a-z0-9]+)/gi;

export function sanitizeExecutorMessage(text: string, maxLen = 400): string {
  const cleaned = String(text || '')
    .replace(SECRET_RE, '[redacted]')
    .replace(/\r\n/g, '\n')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen)}…`;
}

/** 从 JSONL stdout / last-message / stderr 抽取错误文本。 */
export function extractCodexErrorTexts(input: {
  stdout?: string;
  stderr?: string;
  lastMessage?: string;
}): string[] {
  const texts: string[] = [];
  const push = (s: string) => {
    const t = String(s || '').trim();
    if (t) texts.push(t);
  };
  push(input.lastMessage || '');
  push(input.stderr || '');

  for (const line of String(input.stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const type = String(obj.type || '');
      if (type === 'error' || type === 'turn.failed' || type.endsWith('.failed')) {
        push(String(obj.message || obj.error || JSON.stringify(obj).slice(0, 300)));
      }
      const item = obj.item as Record<string, unknown> | undefined;
      if (item && (item.type === 'error' || type === 'item.completed')) {
        push(String(item.message || item.error || ''));
      }
      if (obj.error && typeof obj.error === 'object') {
        const err = obj.error as Record<string, unknown>;
        push(String(err.message || err.code || ''));
      }
    } catch {
      /* not json */
    }
  }
  return texts.filter(Boolean);
}

export function mapCodexFailure(input: {
  texts: string[];
  exitCode: number | null;
  aborted?: boolean;
  timedOut?: boolean;
  spawnError?: boolean;
  changedFilesCount?: number;
}): CodexFailureMapping {
  if (input.aborted) {
    return {
      kind: 'cancelled',
      actionable: '执行已取消。需要时可重新开始。',
      summary: '执行已取消',
    };
  }
  if (input.timedOut) {
    return {
      kind: 'timeout',
      actionable: '执行时间过长已停止，请缩小范围后重试。',
      summary: '外部执行超时',
    };
  }
  if (input.spawnError) {
    return {
      kind: 'spawn_failed',
      actionable: '无法启动代码执行组件，请在设置中检查连接与安装。',
      summary: '外部进程启动失败',
    };
  }

  const blob = sanitizeExecutorMessage(input.texts.join('\n'), 2000).toLowerCase();

  if (
    /model[_\s-]?not[_\s-]?found|unsupported model|unknown model|cli .+ outdated|upgrade.*codex|requires? newer|version.*(incompatible|too old)|not supported by this version/i.test(
      blob,
    )
  ) {
    return {
      kind: 'cli_outdated_or_model_incompatible',
      actionable:
        '当前代码执行组件版本或所选模型不兼容。请升级 Codex CLI，或在其配置中改用兼容模型后再试。',
      summary: 'CLI 版本过旧或模型不兼容',
    };
  }

  // 不得把 PowerShell UnauthorizedAccess / 执行策略误判为 Codex 登录失败
  const looksLikeShellAcl =
    /unauthorizedaccess|running scripts is disabled|execution_polic/i.test(blob);
  const looksLikeCodexAuth =
    !looksLikeShellAcl &&
    (/\b401\b/.test(blob) ||
      /invalid api.?key|authentication failed|authorization failed|not logged in|login required|please log in|invalid.*credential/i.test(
        blob,
      ) ||
      (/\bunauthorized\b/i.test(blob) && !/unauthorizedaccess/i.test(blob)));
  if (looksLikeCodexAuth) {
    return {
      kind: 'auth_failed',
      actionable: '代码执行能力需要重新连接。请先打开设置检查连接，然后重试。',
      summary: '未登录或认证失败',
    };
  }

  if (
    /model.*(unavailable|overloaded|capacity|rate limit)|429|service unavailable|provider.*(error|down)/i.test(
      blob,
    )
  ) {
    return {
      kind: 'model_unavailable',
      actionable: '执行所用模型暂时不可用。请稍后重试，或在执行组件中更换可用模型。',
      summary: '模型不可用',
    };
  }

  if (
    (input.changedFilesCount === 0 || input.changedFilesCount === undefined) &&
    (input.exitCode !== 0 || /error|failed|失败/.test(blob))
  ) {
    // 有明确执行器错误文本时，优先归为 executor_error，而不是「无变更」
    if (blob.length > 8 && input.exitCode !== 0) {
      return {
        kind: 'executor_error',
        actionable: sanitizeExecutorMessage(
          input.texts[0] || '代码执行未完成，请查看执行说明后重试。',
          240,
        ),
        summary: sanitizeExecutorMessage(input.texts[0] || '执行器报错', 160),
      };
    }
  }

  if (input.changedFilesCount === 0) {
    return {
      kind: 'no_substantive_change',
      actionable:
        '未检测到项目文件变化。请检查执行能力连接后重试，或缩小并明确修改目标。',
      summary: '执行结束但无实质文件变更',
    };
  }

  if (input.exitCode !== 0 && input.exitCode != null) {
    return {
      kind: 'executor_error',
      actionable: sanitizeExecutorMessage(
        input.texts[0] || `代码执行退出码为 ${input.exitCode}，请查看说明后重试。`,
        240,
      ),
      summary: sanitizeExecutorMessage(
        input.texts[0] || `codex exit=${input.exitCode}`,
        160,
      ),
    };
  }

  return {
    kind: 'unknown',
    actionable: '代码执行未完成，请重试或检查设置中的执行能力连接。',
    summary: sanitizeExecutorMessage(input.texts[0] || '未知执行错误', 160),
  };
}
