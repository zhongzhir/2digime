/**
 * 远程 GitHub 代码审计 — 识别公开账号/仓库目标，有预算地递归读取公开源码，
 * 失败时给出可复制提示词。不把普通写作冒充审计成果。
 */
import { promises as fs } from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import type { CapabilityOutput } from '../capability/adapter';

export interface GitHubAuditTarget {
  kind: 'user' | 'repo';
  owner: string;
  repo?: string;
  displayUrl: string;
}

export interface HttpGetResult {
  status: number;
  body: string;
}

export type HttpGetFn = (
  url: string,
  headers?: Record<string, string>,
) => Promise<HttpGetResult>;

/** 远程审计抓取预算：每个仓库、每次任务都受这些上限约束。 */
export const GITHUB_AUDIT_BUDGET = {
  maxRepos: 8,
  maxFilesPerRepo: 40,
  maxFileBytes: 80_000,
  maxTotalBytes: 1_500_000,
  maxTreeDepth: 6,
} as const;

export const OVERVIEW_ONLY_NOTICE = '仅完成仓库概览，主要源码尚未覆盖';

export type GitHubSkipReason =
  | 'binary'
  | 'too_large'
  | 'budget'
  | 'skip_dir'
  | 'unsafe_url'
  | 'max_depth'
  | 'empty'
  | 'not_text';

export interface GitHubSkippedPath {
  path: string;
  reason: GitHubSkipReason;
}

export interface GitHubRepoCoverage {
  name: string;
  defaultBranch: string;
  filesRead: string[];
  sourceFilesRead: string[];
  skipped: GitHubSkippedPath[];
  truncatedTree: boolean;
  budgetExhausted: boolean;
  overviewOnly: boolean;
  bytesRead: number;
}

export interface GitHubAuditCoverage {
  foundRepoCount: number;
  foundRepos: string[];
  auditedRepos: string[];
  moreReposOmitted: boolean;
  repos: GitHubRepoCoverage[];
  partial: boolean;
  overviewOnly: boolean;
  totalBytes: number;
  budget: {
    maxRepos: number;
    maxFilesPerRepo: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxTreeDepth: number;
  };
  requestTraces?: GitHubRequestTrace[];
}

export type GitHubFailureClass =
  | 'ok'
  | 'http_404'
  | 'http_401_private'
  | 'http_403_rate_limit'
  | 'http_429'
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'network'
  | 'empty'
  | 'invalid'
  | 'parse_error'
  | 'ssrf'
  | 'content_type'
  | 'too_large'
  | 'redirect';

export interface GitHubRequestTrace {
  stage: string;
  host: string;
  url: string;
  status?: number;
  failureClass: GitHubFailureClass;
  error?: string;
}

export interface GitHubFetchOk {
  ok: true;
  dir: string;
  owner: string;
  repos: string[];
  fileCount: number;
  foundRepoCount: number;
  auditedRepos: string[];
  coverage: GitHubAuditCoverage;
  coverageMarkdown: string;
  partial: boolean;
  overviewOnly: boolean;
}

export interface GitHubFetchBlocked {
  ok: false;
  code:
    | 'not_found'
    | 'private_or_auth'
    | 'rate_limited'
    | 'network'
    | 'empty'
    | 'invalid';
  blocker: string;
  nextStep: string;
  copyablePrompt: string;
  diagnostics?: {
    stage: string;
    host: string;
    url: string;
    status?: number;
    failureClass: GitHubFailureClass;
    traces: GitHubRequestTrace[];
  };
}

export type GitHubFetchResult = GitHubFetchOk | GitHubFetchBlocked;

/** owner/repo 只消费 GitHub 合法字符；中文/标点视为结束，不得进入仓库名。 */
const GITHUB_HOST_RE =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?:\/([A-Za-z0-9._-]{1,100}))?(?:\.git)?(?![A-Za-z0-9._-])/i;

/** 仅当确定是 GitHub 主机时把 `\` 写成 `/` 并补全 https，不改写普通路径。 */
export function normalizeUserFacingUrls(text: string): string {
  return String(text || '').replace(
    /(?:https?:\/\/)?(?:www\.)?github\.com[\\/]+([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?:[\\/]+([A-Za-z0-9._-]+))?/gi,
    (_m, owner: string, repo?: string) => {
      const cleanRepo = String(repo || '').replace(/\.git$/i, '');
      if (cleanRepo && /^(settings|organizations|topics|explore|login|signup|marketplace)$/i.test(cleanRepo)) {
        return `https://github.com/${owner}`;
      }
      return cleanRepo ? `https://github.com/${owner}/${cleanRepo}` : `https://github.com/${owner}`;
    },
  );
}

const AUDIT_SIGNAL_RE =
  /审计|审查|分析|问题|风险|缺陷|安全|code\s*review|audit|review/i;

const BROUGHT_BACK_RE =
  /(?:##|问题清单|风险|finding|仓库|建议修改|审计结论|审查结论)/i;

export const HANDOFF_PROMPT_MARKER = '【可复制的提示词】';

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'vendor',
  'coverage',
  '.next',
  'out',
  'target',
  'bin',
  'obj',
  '__pycache__',
  '.venv',
  'venv',
  '.turbo',
  '.cache',
  'release',
  'releases',
  'min',
  '.gradle',
  '.idea',
  '.vs',
]);

const BINARY_EXT_RE =
  /\.(png|jpe?g|gif|webp|ico|bmp|svg|pdf|zip|tar|tgz|gz|7z|rar|wasm|exe|dll|so|dylib|class|jar|woff2?|eot|ttf|otf|mp3|mp4|mov|webm|avi|bin|dat|lockb|pyc|pyo|o|obj|lib|a|pdb)$/i;

const SOURCE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|cc|cxx|c|h|hpp|rb|php|swift|vue|svelte|kt|kts)$/i;

const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|(?:\.test|\.spec|_test|_spec)\.[^.\/]+$/i;

const SECURITY_PATH_RE =
  /(?:^|\/)(?:security\.md|security\.txt|codeql|dependabot|gitleaks|auth|oauth|secret|csrf|cve)/i;

interface TreeBlob {
  path: string;
  size: number;
  sha?: string;
  downloadUrl?: string | null;
}

export function parseGitHubTarget(text: string): GitHubAuditTarget | null {
  const raw = normalizeUserFacingUrls(text);
  const match = GITHUB_HOST_RE.exec(raw);
  if (!match) return null;
  const owner = String(match[1] || '').trim();
  if (!owner) return null;
  let repo = String(match[2] || '').trim();
  if (repo && /^(settings|organizations|topics|explore|login|signup|marketplace)$/i.test(repo)) {
    repo = '';
  }
  if (repo) {
    return {
      kind: 'repo',
      owner,
      repo,
      displayUrl: `https://github.com/${owner}/${repo}`,
    };
  }
  return {
    kind: 'user',
    owner,
    displayUrl: `https://github.com/${owner}`,
  };
}

export function isRemoteCodeAuditGoal(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (looksLikeBroughtBackAudit(t)) return false;
  const target = parseGitHubTarget(t);
  if (!target) return false;
  return AUDIT_SIGNAL_RE.test(t) || /账号下的项目|名下的项目|公开项目/.test(t);
}

export function looksLikeBroughtBackAudit(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 400) return false;
  return BROUGHT_BACK_RE.test(t) && /(?:问题|风险|建议|finding|仓库)/i.test(t);
}

export function looksLikeFileGenerationGoal(text: string): boolean {
  const t = String(text || '');
  return /(?:word|docx|ppt|pptx|powerpoint|演示文稿|幻灯片)/i.test(t) &&
    /(?:生成|导出|下载|写成|做成|输出)/i.test(t);
}

export function isTechnicalLeadTask(goal: string): boolean {
  const t = String(goal || '').trim();
  if (!t) return false;
  if (isRemoteCodeAuditGoal(t)) return true;
  if (/运维|系统故障|部署到|服务器|linux|kubernetes|docker\s|单元测试|单测|重构代码|修改代码|修复代码/.test(t)) {
    return true;
  }
  if (/分析.{0,8}(代码|仓库|项目|codebase)|代码审查|静态分析|code\s*review/i.test(t)) {
    return true;
  }
  if (/(修改|修复|实现|开发|重构).{0,12}(代码|仓库|项目|程序|系统|接口)/.test(t)) {
    return true;
  }
  return false;
}

export function buildExternalAuditHandoffPrompt(
  target: GitHubAuditTarget,
  goal: string,
): string {
  const scope =
    target.kind === 'repo'
      ? `仓库 ${target.displayUrl}`
      : `账号 ${target.owner}（${target.displayUrl}）下的公开项目`;
  return [
    `请审计 ${scope}。`,
    `用户原话：${goal.trim().slice(0, 400)}`,
    '',
    '请完成：',
    '1. 列出该范围内能公开访问的仓库（若是账号级审计）。',
    '2. 对每个仓库阅读 README、依赖声明和主要源码入口。',
    '3. 按严重程度给出问题清单：安全、正确性、可维护性、文档与发布风险。',
    '4. 每条问题写清：现象、依据（文件路径或公开页面）、可能影响、建议改法。',
    '5. 区分「已证实 / 推测 / 未覆盖」。不要编造看不到的私有内容。',
    '6. 最后给出优先修复顺序，以及我可以立刻做的下一步。',
    '',
    '请用中文输出完整审计报告（可用 Markdown 标题分节）。',
  ].join('\n');
}

export function formatRemoteAuditFailureActionable(blocked: GitHubFetchBlocked): string {
  const diag = blocked.diagnostics;
  const diagLines = diag
    ? [
        `失败阶段：${diag.stage}`,
        `请求主机：${diag.host}`,
        `请求地址：${diag.url}`,
        ...(typeof diag.status === 'number' ? [`HTTP 状态：${diag.status}`] : []),
        `失败分类：${failureClassLabel(diag.failureClass)}`,
      ]
    : [];
  return [
    blocked.blocker,
    blocked.nextStep,
    ...diagLines,
    '',
    '生成外部提示词不是审计完成。重试会重新向 GitHub 发起真实请求。',
    '',
    HANDOFF_PROMPT_MARKER,
    blocked.copyablePrompt,
    '',
    '把其他工具给出的完整结果发回这里，我会检查并给出下一轮修改要求。',
  ].join('\n');
}

function failureClassLabel(cls: GitHubFailureClass): string {
  switch (cls) {
    case 'http_404':
      return '仓库或账号不存在';
    case 'http_401_private':
      return '私有仓库或缺少授权';
    case 'http_403_rate_limit':
    case 'http_429':
      return '访问次数被限制';
    case 'dns':
      return 'DNS 解析失败';
    case 'tls':
      return 'TLS/证书失败';
    case 'timeout':
      return '请求超时';
    case 'network':
      return '网络不可用';
    case 'empty':
      return '没有可公开读取的内容';
    case 'invalid':
      return '请求无效';
    case 'ssrf':
      return '目标地址不安全';
    case 'content_type':
      return '内容类型不受支持';
    case 'too_large':
      return '响应过大';
    case 'redirect':
      return '重定向不安全或过多';
    default:
      return cls;
  }
}

function safeGitHubUrl(url: string): { host: string; url: string } {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.search = '';
    parsed.hash = '';
    return { host: parsed.hostname.toLowerCase(), url: `${parsed.origin}${parsed.pathname}` };
  } catch {
    return { host: '', url: String(url || '').slice(0, 180) };
  }
}

export function classifyGitHubFailure(input: {
  status?: number;
  body?: string;
  error?: string;
}): GitHubFailureClass {
  const status = Number(input.status || 0);
  const body = String(input.body || '');
  const err = String(input.error || '');
  if (status === 404) return 'http_404';
  if (status === 429) return 'http_429';
  if (status === 403 && /rate limit/i.test(body + err)) return 'http_403_rate_limit';
  if (status === 401 || status === 403) return 'http_401_private';
  if (/ENOTFOUND|getaddrinfo|dns/i.test(err)) return 'dns';
  if (/CERT|TLS|SSL|unable to verify/i.test(err)) return 'tls';
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(err)) return 'timeout';
  if (/ECONNRESET|ECONNREFUSED|network|fetch/i.test(err)) return 'network';
  if (status >= 400) return 'network';
  return 'invalid';
}

/**
 * 只允许 https 下的 GitHub 官方主机，避免把仓库元数据里的任意 URL 当成下载地址。
 */
export function isAllowedGitHubDownloadUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'api.github.com' ||
    host === 'raw.githubusercontent.com' ||
    host === 'github.com' ||
    host === 'www.github.com'
  );
}

export function isSourceCodePath(relPath: string): boolean {
  const p = String(relPath || '').replace(/\\/g, '/');
  if (!p || shouldSkipDirPath(p)) return false;
  return SOURCE_EXT_RE.test(p);
}

export function coverageImpliesFullCodeAudit(coverage: GitHubAuditCoverage): boolean {
  if (coverage.overviewOnly || coverage.partial) return false;
  return coverage.repos.length > 0 && coverage.repos.every((r) => !r.overviewOnly && r.sourceFilesRead.length > 0);
}

export function formatAuditCoverageMarkdown(coverage: GitHubAuditCoverage): string {
  const lines: string[] = [
    '# 本次读取范围',
    '',
    `公开仓库数：${coverage.foundRepoCount}`,
    `找到的公开仓库：${coverage.foundRepos.length ? coverage.foundRepos.join('、') : '（无）'}`,
    `实际审计的仓库：${coverage.auditedRepos.length ? coverage.auditedRepos.join('、') : '（无）'}`,
  ];
  if (coverage.moreReposOmitted) {
    lines.push('因预算未覆盖：账号下还有更多公开仓库未纳入本次读取。');
  }
  lines.push('');
  for (const repo of coverage.repos) {
    lines.push(`## 仓库 ${repo.name}`);
    lines.push(`默认分支：${repo.defaultBranch || '未知'}`);
    lines.push('已读关键文件：');
    if (repo.filesRead.length === 0) {
      lines.push('- （无）');
    } else {
      for (const f of repo.filesRead) lines.push(`- ${f}`);
    }
    if (repo.skipped.length > 0) {
      lines.push('因预算或规则未覆盖：');
      for (const s of repo.skipped.slice(0, 40)) {
        lines.push(`- ${s.path}（${skipReasonLabel(s.reason)}）`);
      }
      if (repo.skipped.length > 40) {
        lines.push(`- 另有 ${repo.skipped.length - 40} 个路径未列出`);
      }
    }
    if (repo.truncatedTree) {
      lines.push('因预算未覆盖：仓库文件树被截断，未能枚举全部路径。');
    }
    if (repo.overviewOnly) {
      lines.push(OVERVIEW_ONLY_NOTICE);
    }
    lines.push('');
  }
  if (coverage.overviewOnly) {
    lines.push(OVERVIEW_ONLY_NOTICE);
    lines.push('不得把本次结果当作完整代码审计。');
  } else if (coverage.partial) {
    lines.push('覆盖判断：部分覆盖。结论必须区分已证实、推测、未覆盖。');
  } else {
    lines.push('覆盖判断：已读取主要源码（仍须按文件依据标注已证实 / 推测 / 未覆盖）。');
  }
  lines.push('');
  lines.push('结论分类（分析阶段必须遵守）：已证实 = 依据本次已读文件；推测 = 由已读内容合理推断；未覆盖 = 不在本次读取范围内，不得写成已证实。');
  if (coverage.requestTraces && coverage.requestTraces.length > 0) {
    lines.push('');
    lines.push('## 请求记录');
    for (const tr of coverage.requestTraces.slice(0, 40)) {
      const status = typeof tr.status === 'number' ? ` HTTP ${tr.status}` : '';
      lines.push(`- ${tr.stage} ${tr.host} ${tr.url}${status}（${failureClassLabel(tr.failureClass)}）`);
    }
  }
  return lines.join('\n');
}

function skipReasonLabel(reason: GitHubSkipReason): string {
  switch (reason) {
    case 'binary':
      return '二进制或非文本';
    case 'too_large':
      return '超过单文件上限';
    case 'budget':
      return '超过读取预算';
    case 'skip_dir':
      return '跳过依赖/构建目录';
    case 'unsafe_url':
      return '下载地址不在 GitHub 官方主机';
    case 'max_depth':
      return '超过最大目录深度';
    case 'not_text':
      return '不是可分析的文本';
    default:
      return '无法读取';
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'DigitalMe-Owner-Audit',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export function defaultGitHubHttpGet(url: string, headers?: Record<string, string>): Promise<HttpGetResult> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { ...DEFAULT_HEADERS, ...(headers || {}) },
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

export async function fetchGitHubPublicIntoDir(input: {
  target: GitHubAuditTarget;
  destDir: string;
  httpGet?: HttpGetFn;
  maxRepos?: number;
  maxFilesPerRepo?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxTreeDepth?: number;
}): Promise<GitHubFetchResult> {
  const traces: GitHubRequestTrace[] = [];
  const rawGet = input.httpGet || defaultGitHubHttpGet;
  const httpGet: HttpGetFn = async (url, headers) => {
    const safe = safeGitHubUrl(url);
    try {
      const result = await rawGet(url, headers);
      traces.push({
        stage: 'http_get',
        host: safe.host,
        url: safe.url,
        status: result.status,
        failureClass: result.status >= 400 ? classifyGitHubFailure({ status: result.status, body: result.body }) : 'ok',
      });
      return result;
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      traces.push({
        stage: 'http_get',
        host: safe.host,
        url: safe.url,
        failureClass: classifyGitHubFailure({ error: msg }),
        error: msg,
      });
      throw err;
    }
  };
  const budget = {
    maxRepos: input.maxRepos ?? GITHUB_AUDIT_BUDGET.maxRepos,
    maxFilesPerRepo: input.maxFilesPerRepo ?? GITHUB_AUDIT_BUDGET.maxFilesPerRepo,
    maxFileBytes: input.maxFileBytes ?? GITHUB_AUDIT_BUDGET.maxFileBytes,
    maxTotalBytes: input.maxTotalBytes ?? GITHUB_AUDIT_BUDGET.maxTotalBytes,
    maxTreeDepth: input.maxTreeDepth ?? GITHUB_AUDIT_BUDGET.maxTreeDepth,
  };
  const prompt = buildExternalAuditHandoffPrompt(input.target, input.target.displayUrl);

  const blocked = (
    code: GitHubFetchBlocked['code'],
    blocker: string,
    nextStep: string,
  ): GitHubFetchBlocked => {
    const last = traces[traces.length - 1];
    const failureClass =
      last?.failureClass && last.failureClass !== 'ok'
        ? last.failureClass
        : code === 'not_found'
          ? 'http_404'
          : code === 'rate_limited'
            ? 'http_429'
            : code === 'private_or_auth'
              ? 'http_401_private'
              : code === 'empty'
                ? 'empty'
                : code === 'network'
                  ? 'network'
                  : 'invalid';
    const safe = last || { host: 'api.github.com', url: 'https://api.github.com/', stage: 'request' };
    return {
      ok: false,
      code,
      blocker,
      nextStep,
      copyablePrompt: prompt,
      diagnostics: {
        stage: last?.stage || 'request',
        host: safe.host,
        url: last?.url || safe.url,
        ...(typeof last?.status === 'number' ? { status: last.status } : {}),
        failureClass,
        traces: traces.slice(),
      },
    };
  };

  try {
    const listed = await listPublicRepos(input.target, httpGet, budget.maxRepos);
    if (listed.names.length === 0) {
      return blocked(
        'empty',
        `已经确认这是 GitHub ${input.target.kind === 'user' ? '账号' : '仓库'} ${input.target.displayUrl}，但没有读到可公开访问的项目内容。`,
        '请确认该账号/仓库是公开的；若是私有仓库，需要你先授权或把代码文件夹添加到任务里。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
      );
    }

    await fs.mkdir(input.destDir, { recursive: true });
    const repoCoverages: GitHubRepoCoverage[] = [];
    let fileCount = 0;
    let totalBytes = 0;
    const writtenRepos: string[] = [];
    for (const repo of listed.names) {
      if (totalBytes >= budget.maxTotalBytes) {
        repoCoverages.push({
          name: repo,
          defaultBranch: '',
          filesRead: [],
          sourceFilesRead: [],
          skipped: [{ path: '/', reason: 'budget' }],
          truncatedTree: false,
          budgetExhausted: true,
          overviewOnly: true,
          bytesRead: 0,
        });
        continue;
      }
      const remainingBytes = budget.maxTotalBytes - totalBytes;
      const coverage = await writeRepoSnapshot({
        owner: input.target.owner,
        repo,
        destDir: path.join(input.destDir, input.target.owner, repo),
        httpGet,
        maxFiles: budget.maxFilesPerRepo,
        maxFileBytes: budget.maxFileBytes,
        maxTotalBytes: remainingBytes,
        maxTreeDepth: budget.maxTreeDepth,
      });
      repoCoverages.push(coverage);
      if (coverage.filesRead.length > 0) {
        fileCount += coverage.filesRead.length;
        totalBytes += coverage.bytesRead;
        writtenRepos.push(repo);
      }
    }
    if (fileCount === 0) {
      return blocked(
        'empty',
        `已找到公开仓库（${listed.names.join('、')}），但没能读取到可分析的文件。`,
        '请稍后重试，或把项目文件夹添加到任务里。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
      );
    }

    const coverage: GitHubAuditCoverage = {
      foundRepoCount: listed.foundCount,
      foundRepos: listed.allFoundNames,
      auditedRepos: writtenRepos,
      moreReposOmitted: listed.moreOmitted,
      repos: repoCoverages,
      partial:
        listed.moreOmitted ||
        repoCoverages.some((r) => r.budgetExhausted || r.truncatedTree || r.skipped.some((s) => s.reason === 'budget' || s.reason === 'too_large' || s.reason === 'max_depth')),
      overviewOnly: repoCoverages.every((r) => r.overviewOnly),
      totalBytes,
      budget,
      requestTraces: traces.slice(),
    };
    coverage.partial = coverage.partial || coverage.overviewOnly;
    const coverageMarkdown = formatAuditCoverageMarkdown(coverage);
    await fs.writeFile(path.join(input.destDir, 'AUDIT_COVERAGE.md'), coverageMarkdown, 'utf8');

    return {
      ok: true,
      dir: input.destDir,
      owner: input.target.owner,
      repos: writtenRepos,
      fileCount,
      foundRepoCount: listed.foundCount,
      auditedRepos: writtenRepos,
      coverage,
      coverageMarkdown,
      partial: coverage.partial,
      overviewOnly: coverage.overviewOnly,
    };
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    const status = Number((err as { status?: number })?.status || 0);
    const cls = classifyGitHubFailure({ status, error: msg, body: msg });
    if (status >= 400) {
      return mapStatusToBlocked(status, msg, blocked);
    }
    if (cls === 'dns' || cls === 'tls' || cls === 'timeout' || cls === 'network') {
      const reason =
        cls === 'dns'
          ? '现在无法解析 GitHub 的域名。'
          : cls === 'tls'
            ? '现在无法安全连接到 GitHub。'
            : cls === 'timeout'
              ? '读取 GitHub 超时。'
              : '现在连不上 GitHub，所以还不能直接读取这些公开仓库。';
      return blocked(
        'network',
        reason,
        '请检查网络后点「重试」。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
      );
    }
    return mapStatusToBlocked(0, msg, blocked);
  }
}

export async function attachRemoteAuditCoverage(
  output: CapabilityOutput,
  coverageMarkdown: string,
): Promise<CapabilityOutput> {
  const md = String(coverageMarkdown || '').trim();
  if (!md) return output;
  const marker = '本次读取范围';
  const artifact = output.artifact;
  if (!artifact) return output;
  if (artifact.payload.kind === 'text') {
    const text = artifact.payload.text || '';
    if (text.includes(marker)) return output;
    return {
      ...output,
      artifact: {
        ...artifact,
        payload: { ...artifact.payload, text: `${md}\n\n${text}` },
      },
    };
  }
  if (artifact.payload.kind === 'bundle') {
    for (const entry of artifact.payload.entries) {
      const rel = String(entry.sourcePath || '').replace(/\\/g, '/');
      if (entry.role !== 'report' && !/report\.md$/i.test(rel)) continue;
      try {
        const existing = await fs.readFile(entry.sourcePath, 'utf8');
        if (!existing.includes(marker)) {
          await fs.writeFile(entry.sourcePath, `${md}\n\n${existing}`, 'utf8');
        }
      } catch {
        /* bundle 条目可能尚未落盘 */
      }
    }
  }
  return output;
}

async function listPublicRepos(
  target: GitHubAuditTarget,
  httpGet: HttpGetFn,
  maxRepos: number,
): Promise<{ names: string[]; foundCount: number; allFoundNames: string[]; moreOmitted: boolean }> {
  if (target.kind === 'repo' && target.repo) {
    const meta = await githubJson(
      httpGet,
      `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
    );
    if (meta.status === 404) return { names: [], foundCount: 0, allFoundNames: [], moreOmitted: false };
    if (meta.status >= 400) throw statusError(meta.status, meta.body);
    return { names: [target.repo], foundCount: 1, allFoundNames: [target.repo], moreOmitted: false };
  }
  const listed = await githubJson(
    httpGet,
    `https://api.github.com/users/${encodeURIComponent(target.owner)}/repos?type=public&sort=updated&per_page=${maxRepos + 1}`,
  );
  if (listed.status === 404) return { names: [], foundCount: 0, allFoundNames: [], moreOmitted: false };
  if (listed.status >= 400) throw statusError(listed.status, listed.body);
  const arr = JSON.parse(listed.body) as Array<{ name?: string; fork?: boolean }>;
  if (!Array.isArray(arr)) return { names: [], foundCount: 0, allFoundNames: [], moreOmitted: false };
  const names = arr.filter((r) => r && r.name && !r.fork).map((r) => String(r.name));
  const moreOmitted = names.length > maxRepos;
  const capped = names.slice(0, maxRepos);
  return {
    names: capped,
    foundCount: names.length,
    allFoundNames: names,
    moreOmitted,
  };
}

async function writeRepoSnapshot(input: {
  owner: string;
  repo: string;
  destDir: string;
  httpGet: HttpGetFn;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxTreeDepth: number;
}): Promise<GitHubRepoCoverage> {
  const skipped: GitHubSkippedPath[] = [];
  const meta = await githubJson(
    input.httpGet,
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
  );
  let defaultBranch = 'main';
  if (meta.status < 400) {
    try {
      const parsed = JSON.parse(meta.body) as { default_branch?: string };
      if (parsed && parsed.default_branch) defaultBranch = String(parsed.default_branch);
    } catch {
      /* 使用 main */
    }
  }

  let truncatedTree = false;
  let blobs = await listTreeBlobs(input.owner, input.repo, defaultBranch, input.httpGet);
  if (blobs.ok) {
    truncatedTree = blobs.truncated;
  } else {
    const walked = await listContentsRecursive({
      owner: input.owner,
      repo: input.repo,
      branch: defaultBranch,
      httpGet: input.httpGet,
      maxDepth: input.maxTreeDepth,
      skipped,
    });
    blobs = { ok: true, truncated: false, blobs: walked };
  }

  const ranked = rankTreeBlobs(blobs.blobs);
  await fs.mkdir(input.destDir, { recursive: true });
  const filesRead: string[] = [];
  const sourceFilesRead: string[] = [];
  let bytesRead = 0;
  let budgetExhausted = truncatedTree;

  for (const blob of ranked) {
    const rel = String(blob.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.includes('..')) continue;
    if (shouldSkipDirPath(rel)) {
      skipped.push({ path: rel, reason: 'skip_dir' });
      continue;
    }
    if (BINARY_EXT_RE.test(rel)) {
      skipped.push({ path: rel, reason: 'binary' });
      continue;
    }
    const size = Number(blob.size || 0);
    if (size > input.maxFileBytes) {
      skipped.push({ path: rel, reason: 'too_large' });
      continue;
    }
    if (filesRead.length >= input.maxFiles || bytesRead >= input.maxTotalBytes) {
      skipped.push({ path: rel, reason: 'budget' });
      budgetExhausted = true;
      continue;
    }
    const fetched = await fetchBlobText({
      owner: input.owner,
      repo: input.repo,
      branch: defaultBranch,
      blob,
      httpGet: input.httpGet,
      maxFileBytes: input.maxFileBytes,
    });
    if (!fetched.ok) {
      skipped.push({ path: rel, reason: fetched.reason });
      continue;
    }
    const byteLen = Buffer.byteLength(fetched.text, 'utf8');
    if (byteLen > input.maxFileBytes) {
      skipped.push({ path: rel, reason: 'too_large' });
      continue;
    }
    if (bytesRead + byteLen > input.maxTotalBytes) {
      skipped.push({ path: rel, reason: 'budget' });
      budgetExhausted = true;
      continue;
    }
    const abs = path.join(input.destDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, fetched.text, 'utf8');
    filesRead.push(rel);
    bytesRead += byteLen;
    if (isSourceCodePath(rel)) sourceFilesRead.push(rel);
  }

  return {
    name: input.repo,
    defaultBranch,
    filesRead,
    sourceFilesRead,
    skipped,
    truncatedTree,
    budgetExhausted,
    overviewOnly: sourceFilesRead.length === 0,
    bytesRead,
  };
}

async function listTreeBlobs(
  owner: string,
  repo: string,
  branch: string,
  httpGet: HttpGetFn,
): Promise<{ ok: boolean; truncated: boolean; blobs: TreeBlob[] }> {
  const tree = await githubJson(
    httpGet,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (tree.status >= 400) return { ok: false, truncated: false, blobs: [] };
  let parsed: {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>;
  };
  try {
    parsed = JSON.parse(tree.body);
  } catch {
    return { ok: false, truncated: false, blobs: [] };
  }
  if (!parsed || !Array.isArray(parsed.tree)) return { ok: false, truncated: false, blobs: [] };
  const blobs: TreeBlob[] = [];
  for (const item of parsed.tree) {
    if (!item || item.type !== 'blob' || !item.path) continue;
    const blob: TreeBlob = {
      path: String(item.path),
      size: Number(item.size || 0),
    };
    if (item.sha) blob.sha = String(item.sha);
    blobs.push(blob);
  }
  return { ok: true, truncated: !!parsed.truncated, blobs };
}

async function listContentsRecursive(input: {
  owner: string;
  repo: string;
  branch: string;
  httpGet: HttpGetFn;
  maxDepth: number;
  skipped: GitHubSkippedPath[];
}): Promise<TreeBlob[]> {
  const blobs: TreeBlob[] = [];
  const walk = async (relPath: string, depth: number): Promise<void> => {
    if (depth > input.maxDepth) {
      input.skipped.push({ path: relPath || '/', reason: 'max_depth' });
      return;
    }
    const encodedPath = relPath
      .split('/')
      .filter(Boolean)
      .map((p) => encodeURIComponent(p))
      .join('/');
    const url = encodedPath
      ? `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(input.branch)}`
      : `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents?ref=${encodeURIComponent(input.branch)}`;
    const res = await githubJson(input.httpGet, url);
    if (res.status >= 400) return;
    let entries: Array<{
      name?: string;
      type?: string;
      path?: string;
      size?: number;
      sha?: string;
      download_url?: string | null;
    }>;
    try {
      entries = JSON.parse(res.body);
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const p = String(entry.path || entry.name || '').replace(/\\/g, '/');
      if (!p) continue;
      if (entry.type === 'dir') {
        if (shouldSkipDirPath(p)) {
          input.skipped.push({ path: p, reason: 'skip_dir' });
          continue;
        }
        await walk(p, depth + 1);
        continue;
      }
      if (entry.type === 'file') {
        const blob: TreeBlob = {
          path: p,
          size: Number(entry.size || 0),
        };
        if (entry.sha) blob.sha = String(entry.sha);
        if (entry.download_url) blob.downloadUrl = entry.download_url;
        blobs.push(blob);
      }
    }
  };
  await walk('', 0);
  return blobs;
}

async function fetchBlobText(input: {
  owner: string;
  repo: string;
  branch: string;
  blob: TreeBlob;
  httpGet: HttpGetFn;
  maxFileBytes: number;
}): Promise<{ ok: true; text: string } | { ok: false; reason: GitHubSkipReason }> {
  const sha = String(input.blob.sha || '').trim();
  if (sha) {
    const blobUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/blobs/${encodeURIComponent(sha)}`;
    if (!isAllowedGitHubDownloadUrl(blobUrl)) return { ok: false, reason: 'unsafe_url' };
    const file = await input.httpGet(blobUrl, { Accept: 'application/vnd.github.raw' });
    if (file.status >= 400 || !file.body) return { ok: false, reason: 'empty' };
    const text = decodeBlobBody(file.body);
    if (text == null) return { ok: false, reason: 'not_text' };
    if (looksBinary(text)) return { ok: false, reason: 'binary' };
    return { ok: true, text };
  }

  const contentsUrl = githubContentsUrl(input.owner, input.repo, input.blob.path, input.branch);
  if (!isAllowedGitHubDownloadUrl(contentsUrl)) return { ok: false, reason: 'unsafe_url' };
  const listed = await input.httpGet(contentsUrl);
  if (listed.status < 400 && listed.body) {
    const fromJson = decodeContentsJson(listed.body, input.maxFileBytes);
    if (fromJson.ok) {
      if (looksBinary(fromJson.text)) return { ok: false, reason: 'binary' };
      return fromJson;
    }
  }

  const download = String(input.blob.downloadUrl || '').trim();
  if (download) {
    if (!isAllowedGitHubDownloadUrl(download)) return { ok: false, reason: 'unsafe_url' };
    const file = await input.httpGet(download, { Accept: 'application/octet-stream' });
    if (file.status >= 400 || !file.body) return { ok: false, reason: 'empty' };
    if (looksBinary(file.body)) return { ok: false, reason: 'binary' };
    return { ok: true, text: file.body };
  }
  return { ok: false, reason: 'empty' };
}

function githubContentsUrl(owner: string, repo: string, relPath: string, branch: string): string {
  const encodedPath = relPath
    .split('/')
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
}

function decodeBlobBody(body: string): string | null {
  const trimmed = String(body || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { encoding?: string; content?: string; truncated?: boolean };
      if (parsed.truncated) return null;
      if (parsed.encoding === 'base64' && typeof parsed.content === 'string') {
        return Buffer.from(parsed.content.replace(/\s+/g, ''), 'base64').toString('utf8');
      }
    } catch {
      return body;
    }
  }
  return body;
}

function decodeContentsJson(
  body: string,
  maxFileBytes: number,
): { ok: true; text: string } | { ok: false; reason: GitHubSkipReason } {
  try {
    const parsed = JSON.parse(body) as {
      encoding?: string;
      content?: string;
      size?: number;
      download_url?: string | null;
    };
    if (Number(parsed.size || 0) > maxFileBytes) return { ok: false, reason: 'too_large' };
    if (parsed.encoding === 'base64' && typeof parsed.content === 'string') {
      const text = Buffer.from(parsed.content.replace(/\s+/g, ''), 'base64').toString('utf8');
      return { ok: true, text };
    }
  } catch {
    /* 不是 JSON */
  }
  return { ok: false, reason: 'empty' };
}

function looksBinary(text: string): boolean {
  if (!text) return false;
  if (text.includes('\u0000')) return true;
  const sample = text.slice(0, 800);
  let weird = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32) weird += 1;
  }
  return sample.length > 0 && weird / sample.length > 0.3;
}

function shouldSkipDirPath(relPath: string): boolean {
  const parts = String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  return parts.some((p) => SKIP_DIR_NAMES.has(p.toLowerCase()));
}

export function rankTreeBlobs(blobs: TreeBlob[]): TreeBlob[] {
  return [...blobs].sort((a, b) => scoreAuditPath(String(b.path)) - scoreAuditPath(String(a.path)));
}

export function scoreAuditPath(relPath: string): number {
  const p = String(relPath || '').replace(/\\/g, '/');
  const name = path.posix.basename(p).toLowerCase();
  if (/^readme(\.|$)/i.test(name)) return 1000;
  if (
    name === 'package.json' ||
    name === 'pyproject.toml' ||
    name === 'go.mod' ||
    name === 'cargo.toml' ||
    name === 'requirements.txt' ||
    name === 'composer.json' ||
    name === 'gemfile' ||
    name === 'pom.xml'
  ) {
    return 950;
  }
  if (SECURITY_PATH_RE.test(p.toLowerCase()) || name === 'security.md' || name === 'license' || name === 'license.md') {
    return 900;
  }
  if (/^(tsconfig|jsconfig|dockerfile|docker-compose)/.test(name) || /\.(ya?ml|toml)$/.test(name)) {
    return 820;
  }
  if (/^(src|app|lib|source)\/(?:index|main|app)\./i.test(p)) return 780;
  if (TEST_PATH_RE.test(p)) return 660;
  if (/^(src|app|lib|source)\//i.test(p) && SOURCE_EXT_RE.test(p)) return 700;
  if (SOURCE_EXT_RE.test(p)) return 500;
  if (name.startsWith('.')) return 40;
  return 80;
}

async function githubJson(httpGet: HttpGetFn, url: string): Promise<HttpGetResult> {
  const result = await httpGet(url);
  if (result.status === 403 || result.status === 429 || result.status === 401 || result.status === 404) {
    return result;
  }
  if (result.status >= 400) {
    throw statusError(result.status, result.body);
  }
  return result;
}

function statusError(status: number, body: string): Error {
  const err = new Error(`github_http_${status}:${String(body || '').slice(0, 180)}`);
  (err as Error & { status?: number }).status = status;
  return err;
}

function mapStatusToBlocked(
  status: number,
  body: string,
  blocked: (code: GitHubFetchBlocked['code'], blocker: string, nextStep: string) => GitHubFetchBlocked,
): GitHubFetchBlocked {
  if (status === 404) {
    return blocked(
      'not_found',
      'GitHub 上没有找到这个公开账号或仓库。',
      '请核对地址是否写对。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
    );
  }
  if (status === 401 || status === 403) {
    return blocked(
      status === 403 && /rate limit/i.test(body) ? 'rate_limited' : 'private_or_auth',
      /rate limit/i.test(body)
        ? 'GitHub 暂时限制了访问次数，现在读不了这些公开仓库。'
        : '这个仓库可能是私有的，或当前没有访问授权，所以不能直接读取。',
      '请稍后再点「重试」，或把项目文件夹添加到任务里。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
    );
  }
  if (status === 429) {
    return blocked(
      'rate_limited',
      'GitHub 暂时限制了访问次数，现在读不了这些公开仓库。',
      '请稍后再点「重试」。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
    );
  }
  return blocked(
    'network',
    '现在无法读取 GitHub 上的公开内容。',
    '请检查网络后点「重试」。也可以先用下面的提示词请其他 AI 工具审计，再把结果发回来。',
  );
}
