/**
 * 公开网页 / GitHub 只读查询 — 与代码审计分开。
 * 只允许 HTTP(S)；拦截内网、凭据 URL、过量重定向与过大响应。
 * 连接前解析全部 A/AAAA，钉死已验证 IP，Host/SNI 仍用原域名。
 */
import type { CapabilityOutput } from '../capability/adapter';
import {
  classifyGitHubFailure,
  normalizeUserFacingUrls,
  parseGitHubTarget,
  type GitHubAuditTarget,
  type GitHubFailureClass,
  type GitHubRequestTrace,
  type HttpGetFn,
  type HttpGetResult,
} from './remote-github-audit';
import {
  assertSafePublicDestination,
  assertSafePublicHttpUrl,
  defaultLookupAddresses,
  safePublicHttpGet,
  type LookupAddressesFn,
  type SafePublicHttpDeps,
} from './public-http-safety';

export { normalizeUserFacingUrls };
export {
  assertSafePublicDestination,
  assertSafePublicHttpUrl,
  createPinnedLookup,
  defaultLookupAddresses,
  isBlockedPublicHost,
  isBlockedPublicIp,
  resolvePublicRedirect,
  safePublicHttpGet,
} from './public-http-safety';
export type { LookupAddressesFn, PinnedPublicDestination } from './public-http-safety';

export type PublicWebQueryKind =
  | 'github_releases'
  | 'github_overview'
  | 'github_readme'
  | 'github_audit'
  | 'public_page';

export interface PublicWebQuery {
  kind: PublicWebQueryKind;
  originalGoal: string;
  normalizedGoal: string;
  target?: GitHubAuditTarget;
  pageUrl?: string;
}

export interface PublicWebQueryOk {
  ok: true;
  kind: PublicWebQueryKind;
  output: CapabilityOutput;
  traces: GitHubRequestTrace[];
}

export interface PublicWebQueryBlocked {
  ok: false;
  kind?: PublicWebQueryKind;
  blocker: string;
  nextStep: string;
  copyablePrompt: string;
  diagnostics: {
    stage: string;
    host: string;
    url: string;
    status?: number;
    failureClass: GitHubFailureClass | 'ssrf' | 'content_type' | 'too_large' | 'redirect';
    traces: GitHubRequestTrace[];
    retries: number;
  };
}

export type PublicWebQueryResult = PublicWebQueryOk | PublicWebQueryBlocked;

const RELEASE_SIGNAL_RE = /release|releases|版本|最新版|可下载|下载资产|有没有\s*release/i;
const README_SIGNAL_RE = /readme|说明文档|仓库说明/i;
const AUDIT_SIGNAL_RE =
  /审计|审查|分析|问题清单|风险|缺陷|安全|code\s*review|audit|review/i;
const VISIT_SIGNAL_RE = /访问|打开|读取|查看|看一下|看看|抓取|浏览/;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const RETRIES = 2;

export function classifyPublicWebQuery(text: string): PublicWebQuery | null {
  const original = String(text || '').trim();
  if (!original) return null;
  const normalizedGoal = normalizeUserFacingUrls(original);
  const target = parseGitHubTarget(normalizedGoal);
  if (target) {
    if (AUDIT_SIGNAL_RE.test(normalizedGoal) && !RELEASE_SIGNAL_RE.test(normalizedGoal)) {
      return { kind: 'github_audit', originalGoal: original, normalizedGoal, target };
    }
    if (RELEASE_SIGNAL_RE.test(normalizedGoal)) {
      return { kind: 'github_releases', originalGoal: original, normalizedGoal, target };
    }
    if (README_SIGNAL_RE.test(normalizedGoal)) {
      return { kind: 'github_readme', originalGoal: original, normalizedGoal, target };
    }
    if (VISIT_SIGNAL_RE.test(normalizedGoal) || target.kind === 'repo') {
      return { kind: 'github_overview', originalGoal: original, normalizedGoal, target };
    }
    return { kind: 'github_overview', originalGoal: original, normalizedGoal, target };
  }
  const pageMatch = /https?:\/\/[^\s\\]+/i.exec(normalizedGoal);
  if (pageMatch && VISIT_SIGNAL_RE.test(normalizedGoal)) {
    try {
      const pageUrl = assertSafePublicHttpUrl(pageMatch[0]).toString();
      return { kind: 'public_page', originalGoal: original, normalizedGoal, pageUrl };
    } catch {
      return null;
    }
  }
  return null;
}

export function isGitHubReadonlyLookupGoal(text: string): boolean {
  const q = classifyPublicWebQuery(text);
  return !!q && q.kind !== 'github_audit';
}

function failureClassLabel(cls: PublicWebQueryBlocked['diagnostics']['failureClass']): string {
  switch (cls) {
    case 'http_404':
      return '仓库或页面不存在';
    case 'http_401_private':
      return '私有资源或缺少授权';
    case 'http_403_rate_limit':
    case 'http_429':
      return '访问次数被限制';
    case 'dns':
      return 'DNS 解析失败';
    case 'tls':
      return 'TLS 连接失败';
    case 'timeout':
      return '请求超时';
    case 'ssrf':
    case 'redirect':
      return '目标地址不安全';
    case 'content_type':
      return '内容类型不受支持';
    case 'too_large':
      return '响应过大';
    default:
      return '网络失败';
  }
}

export function formatPublicWebFailureActionable(blocked: PublicWebQueryBlocked): string {
  const diag = blocked.diagnostics;
  return [
    blocked.blocker,
    blocked.nextStep,
    `失败阶段：${diag.stage}`,
    `请求主机：${diag.host}`,
    `请求地址：${diag.url}`,
    ...(typeof diag.status === 'number' ? [`HTTP 状态：${diag.status}`] : []),
    `失败分类：${diag.failureClass}（${failureClassLabel(diag.failureClass)}）`,
    `已自动重试：${diag.retries} 次`,
    '',
    '可以连接其他只读网页或搜索能力后再点「重试」。任务会保留，不必重新描述。',
    '',
    '【可复制的提示词】',
    blocked.copyablePrompt,
  ].join('\n');
}

function copyableLookupPrompt(query: PublicWebQuery): string {
  if (query.target) {
    return [
      `请只读查询 ${query.target.displayUrl}。`,
      query.kind === 'github_releases'
        ? '请列出 Releases、最新版本和可下载资产；没有 Release 时请如实说明。'
        : '请给出仓库公开概览（默认分支、说明、是否有 Release）。',
      `用户原话：${query.originalGoal.slice(0, 400)}`,
    ].join('\n');
  }
  return `请只读访问 ${query.pageUrl || query.normalizedGoal}，并摘录与用户问题相关的公开内容。不要登录，不要提交表单。`;
}

export interface PublicWebExecuteOptions {
  httpGet?: HttpGetFn;
  pageRead?: (url: string) => Promise<{ content: string; resolvedUrl?: string } | null>;
  lookupAddresses?: LookupAddressesFn;
}

function classifyFromError(err: unknown): GitHubFailureClass | 'ssrf' {
  const msg = String((err as Error)?.message || err || '');
  const code = (err as { code?: string })?.code || '';
  if (code === 'ssrf' || /内网|本机|凭据|不可路由/.test(msg)) return 'ssrf';
  if (code === 'ENOTFOUND' || code === 'dns' || /DNS 解析失败/.test(msg)) return 'dns';
  return classifyGitHubFailure({ error: msg });
}

async function getWithRetry(
  url: string,
  httpGet: HttpGetFn,
  traces: GitHubRequestTrace[],
  extraHeaders?: Record<string, string>,
): Promise<{ result?: HttpGetResult; retries: number; lastError?: unknown }> {
  let lastError: unknown;
  let retries = 0;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) retries = attempt;
    try {
      const result = await httpGet(url, extraHeaders);
      traces.push({
        stage: 'http_get',
        host: safeHost(url),
        url,
        status: result.status,
        failureClass:
          result.status >= 400
            ? classifyGitHubFailure({ status: result.status, body: result.body })
            : 'ok',
      });
      if (result.status >= 500 || result.status === 429) {
        lastError = new Error(`http_${result.status}`);
        continue;
      }
      return { result, retries };
    } catch (err) {
      lastError = err;
      traces.push({
        stage: 'http_get',
        host: safeHost(url),
        url,
        failureClass: classifyFromError(err),
        error: String((err as Error)?.message || err).slice(0, 180),
      });
    }
  }
  return { retries, lastError };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function jsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function documentOutput(title: string, text: string, usedUrl: string): CapabilityOutput {
  return {
    artifact: {
      type: 'document',
      title,
      payload: { kind: 'text', format: 'markdown', text },
    },
    materialUse: {
      usedPaths: [usedUrl],
      includedCount: 1,
      fullReadCount: 1,
      items: [
        {
          path: usedUrl,
          completeness: 'full',
          sourceChars: text.length,
          usedChars: text.length,
        },
      ],
    },
    candidateMeta: {
      provenance: 'public_web_query',
      sourceBinding: usedUrl,
    },
  };
}

export async function executePublicWebQuery(
  query: PublicWebQuery,
  options: PublicWebExecuteOptions = {},
): Promise<PublicWebQueryResult> {
  const traces: GitHubRequestTrace[] = [];
  const httpGet =
    options.httpGet ||
    ((url, headers) =>
      defaultSafePublicHttpGet(url, headers, MAX_REDIRECTS, {
        ...(options.lookupAddresses ? { lookupAddresses: options.lookupAddresses } : {}),
      }));
  if (query.kind === 'github_audit') {
    return blocked('github_audit', query, '这项请求应按代码审计处理。', traces, 0, 'invalid');
  }
  if (query.target && query.target.kind !== 'repo') {
    return blocked(query.kind, query, '需要具体的仓库地址才能查询公开版本或概览。', traces, 0, 'invalid');
  }
  if (query.target?.kind === 'repo' && (query.kind === 'github_releases' || query.kind === 'github_overview' || query.kind === 'github_readme')) {
    return fetchGitHubRepoLookup(query, httpGet, traces, options.pageRead, options.lookupAddresses);
  }
  if (query.kind === 'public_page' && query.pageUrl) {
    return fetchPublicPage(query, httpGet, traces, options.pageRead, options.lookupAddresses);
  }
  return blocked(query.kind, query, '目前还不能识别这次公开网页请求。', traces, 0, 'invalid');
}

async function fetchGitHubRepoLookup(
  query: PublicWebQuery,
  httpGet: HttpGetFn,
  traces: GitHubRequestTrace[],
  pageRead?: PublicWebExecuteOptions['pageRead'],
  lookupAddresses?: LookupAddressesFn,
): Promise<PublicWebQueryResult> {
  const target = query.target!;
  if (target.kind !== 'repo' || !target.repo) {
    return blocked(query.kind, query, '需要具体的仓库地址才能查询 Release。', traces, 0, 'invalid');
  }
  const repoApi = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  const repoGot = await getWithRetry(repoApi, httpGet, traces);
  if (!repoGot.result) {
    const cls = classifyFromError(repoGot.lastError);
    return blocked(query.kind, query, '现在连不上 GitHub。', traces, repoGot.retries, cls, {
      stage: 'repo',
      host: 'api.github.com',
      url: repoApi,
    });
  }
  if (repoGot.result.status === 404) {
    return blocked(query.kind, query, '找不到这个公开仓库。', traces, repoGot.retries, 'http_404', {
      stage: 'repo',
      host: 'api.github.com',
      url: repoApi,
      status: 404,
    });
  }
  if (repoGot.result.status === 403 || repoGot.result.status === 429) {
    const cls = classifyGitHubFailure({
      status: repoGot.result.status,
      body: repoGot.result.body,
    });
    return blocked(query.kind, query, 'GitHub 暂时限制了访问次数。', traces, repoGot.retries, cls, {
      stage: 'repo',
      host: 'api.github.com',
      url: repoApi,
      status: repoGot.result.status,
    });
  }
  if (repoGot.result.status >= 400) {
    const cls = classifyGitHubFailure({ status: repoGot.result.status, body: repoGot.result.body });
    return blocked(query.kind, query, '读取 GitHub 仓库信息失败。', traces, repoGot.retries, cls, {
      stage: 'repo',
      host: 'api.github.com',
      url: repoApi,
      status: repoGot.result.status,
    });
  }
  const repoJson = jsonBody(repoGot.result.body) as {
    full_name?: string;
    default_branch?: string;
    description?: string;
    html_url?: string;
    stargazers_count?: number;
  } | null;
  const defaultBranch = String(repoJson?.default_branch || 'unknown');
  const description = String(repoJson?.description || '（无简介）');
  const htmlUrl = String(repoJson?.html_url || target.displayUrl);

  if (query.kind === 'github_releases') {
    const relApi = `https://api.github.com/repos/${target.owner}/${target.repo}/releases`;
    const relGot = await getWithRetry(relApi, httpGet, traces);
    if (!relGot.result) {
      if (pageRead) {
        const fallback = await pageRead(htmlUrl).catch(() => null);
        if (fallback?.content) {
          try {
            await assertSafePublicDestination(fallback.resolvedUrl || htmlUrl, lookupAddresses ?? defaultLookupAddresses);
            traces.push({
              stage: 'backup_read',
              host: safeHost(fallback.resolvedUrl || htmlUrl),
              url: fallback.resolvedUrl || htmlUrl,
              status: 200,
              failureClass: 'ok',
            });
          } catch (err) {
            traces.push({
              stage: 'backup_read',
              host: safeHost(fallback.resolvedUrl || htmlUrl),
              url: fallback.resolvedUrl || htmlUrl,
              failureClass: classifyFromError(err),
              error: String((err as Error)?.message || err).slice(0, 180),
            });
          }
        }
      }
      const cls = classifyFromError(relGot.lastError);
      return blocked(query.kind, query, '现在读不到这个仓库的 Releases。', traces, relGot.retries, cls, {
        stage: 'releases',
        host: 'api.github.com',
        url: relApi,
      });
    }
    if (relGot.result.status >= 400) {
      const cls = classifyGitHubFailure({ status: relGot.result.status, body: relGot.result.body });
      return blocked(query.kind, query, '读取 Releases 失败。', traces, relGot.retries, cls, {
        stage: 'releases',
        host: 'api.github.com',
        url: relApi,
        status: relGot.result.status,
      });
    }
    const releases = jsonBody(relGot.result.body);
    const list = Array.isArray(releases) ? releases : [];
    const lines = [
      `# ${target.owner}/${target.repo} 的公开版本`,
      '',
      `来源：GitHub Releases API（${relApi}）`,
      `默认分支：${defaultBranch}`,
      `简介：${description}`,
      '',
    ];
    if (list.length === 0) {
      lines.push('该仓库目前没有 Release 可下载。这不是代码审计，也没有生成写作稿。');
    } else {
      lines.push(`共找到 ${list.length} 个 Release。`);
      for (const rel of list.slice(0, 8) as Array<{
        name?: string;
        tag_name?: string;
        html_url?: string;
        assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
        published_at?: string;
      }>) {
        lines.push('', `## ${rel.name || rel.tag_name || '未命名版本'}`);
        if (rel.tag_name) lines.push(`- 标签：${rel.tag_name}`);
        if (rel.published_at) lines.push(`- 发布时间：${rel.published_at}`);
        if (rel.html_url) lines.push(`- 页面：${rel.html_url}`);
        const assets = Array.isArray(rel.assets) ? rel.assets : [];
        if (!assets.length) {
          lines.push('- 没有可下载资产');
        } else {
          for (const asset of assets.slice(0, 12)) {
            lines.push(
              `- 资产：${asset.name || 'file'}（${asset.browser_download_url || '无下载地址'}）`,
            );
          }
        }
      }
    }
    return {
      ok: true,
      kind: query.kind,
      traces,
      output: documentOutput(
        `${target.owner}/${target.repo} Releases`,
        lines.join('\n'),
        relApi,
      ),
    };
  }

  const overview = [
    `# ${target.owner}/${target.repo} 仓库概览`,
    '',
    `来源：GitHub Repo API（${repoApi}）`,
    `- 页面：${htmlUrl}`,
    `- 默认分支：${defaultBranch}`,
    `- 简介：${description}`,
    typeof repoJson?.stargazers_count === 'number' ? `- Stars：${repoJson.stargazers_count}` : '',
    '',
    query.kind === 'github_readme'
      ? '本次只读取公开仓库说明，不是代码审计。'
      : '本次只读取公开仓库概览，不是代码审计，也没有生成普通写作稿。',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    ok: true,
    kind: query.kind,
    traces,
    output: documentOutput(`${target.owner}/${target.repo} 概览`, overview, repoApi),
  };
}

async function fetchPublicPage(
  query: PublicWebQuery,
  httpGet: HttpGetFn,
  traces: GitHubRequestTrace[],
  pageRead?: PublicWebExecuteOptions['pageRead'],
  lookupAddresses?: LookupAddressesFn,
): Promise<PublicWebQueryResult> {
  const url = query.pageUrl!;
  if (pageRead) {
    try {
      const read = await pageRead(url);
      if (read?.content) {
        let resolved = String(read.resolvedUrl || url).trim();
        try {
          resolved = (await assertSafePublicDestination(resolved, lookupAddresses ?? defaultLookupAddresses)).url.toString();
        } catch (err) {
          const cls = classifyFromError(err);
          traces.push({
            stage: 'page_read',
            host: safeHost(resolved),
            url: resolved,
            failureClass: cls,
            error: String((err as Error)?.message || err).slice(0, 180),
          });
          return blocked(
            'public_page',
            query,
            '读取结果指向不安全地址，已拒绝写入成果。',
            traces,
            0,
            cls,
            { stage: 'page_read', host: safeHost(resolved), url: resolved },
          );
        }
        traces.push({
          stage: 'page_read',
          host: safeHost(resolved),
          url: resolved,
          status: 200,
          failureClass: 'ok',
        });
        return {
          ok: true,
          kind: 'public_page',
          traces,
          output: documentOutput(
            `公开网页摘录`,
            [`# 公开网页摘录`, '', `来源：${resolved}`, '', read.content.slice(0, 8000)].join('\n'),
            resolved,
          ),
        };
      }
    } catch (err) {
      traces.push({
        stage: 'page_read',
        host: safeHost(url),
        url,
        failureClass: classifyGitHubFailure({ error: String((err as Error)?.message || err) }),
        error: String((err as Error)?.message || err).slice(0, 180),
      });
    }
  }
  const got = await getWithRetry(url, httpGet, traces);
  if (!got.result) {
    const cls = classifyFromError(got.lastError);
    return blocked('public_page', query, '现在读不到这个公开网页。', traces, got.retries, cls, {
      stage: 'page',
      host: safeHost(url),
      url,
    });
  }
  if (got.result.status >= 400) {
    const cls = classifyGitHubFailure({ status: got.result.status, body: got.result.body });
    return blocked('public_page', query, '公开网页返回了错误状态。', traces, got.retries, cls, {
      stage: 'page',
      host: safeHost(url),
      url,
      status: got.result.status,
    });
  }
  const text = htmlToText(got.result.body).slice(0, 8000);
  if (!text.trim()) {
    return blocked('public_page', query, '页面没有可读的静态正文，可能依赖登录或脚本。', traces, got.retries, 'invalid', {
      stage: 'page',
      host: safeHost(url),
      url,
      status: got.result.status,
    });
  }
  return {
    ok: true,
    kind: 'public_page',
    traces,
    output: documentOutput(
      '公开网页摘录',
      [`# 公开网页摘录`, '', `来源：${url}`, '', text].join('\n'),
      url,
    ),
  };
}

function blocked(
  kind: PublicWebQueryKind | undefined,
  query: PublicWebQuery,
  blocker: string,
  traces: GitHubRequestTrace[],
  retries: number,
  failureClass: PublicWebQueryBlocked['diagnostics']['failureClass'],
  extra?: { stage?: string; host?: string; url?: string; status?: number },
): PublicWebQueryBlocked {
  const url = extra?.url || query.pageUrl || query.target?.displayUrl || '';
  return {
    ok: false,
    ...(kind ? { kind } : {}),
    blocker,
    nextStep: '请检查网络或连接其他只读能力后，对同一任务点「重试」。',
    copyablePrompt: copyableLookupPrompt(query),
    diagnostics: {
      stage: extra?.stage || 'lookup',
      host: extra?.host || safeHost(url),
      url,
      ...(typeof extra?.status === 'number' ? { status: extra.status } : {}),
      failureClass,
      traces,
      retries,
    },
  };
}

function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function defaultSafePublicHttpGet(
  url: string,
  headers?: Record<string, string>,
  redirectLeft = MAX_REDIRECTS,
  deps: SafePublicHttpDeps = {},
): Promise<HttpGetResult> {
  const got = await safePublicHttpGet(
    url,
    {
      accept: 'application/vnd.github+json, text/html, text/plain, application/json;q=0.9, */*;q=0.1',
      'user-agent': 'DigitalMe-readonly-lookup',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(headers || {}),
    },
    redirectLeft,
    { ...deps, timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES },
  );
  return { status: got.status, body: got.body };
}
