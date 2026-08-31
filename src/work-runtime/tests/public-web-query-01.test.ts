/**
 * 公开网页 / GitHub 只读查询：反斜杠 URL、Releases API、失败诊断；不是代码审计。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deriveWorkIntentSync } from '../work-intent';
import { isRemoteCodeAuditGoal, parseGitHubTarget, type HttpGetFn } from '../remote-github-audit';
import {
  assertSafePublicHttpUrl,
  classifyPublicWebQuery,
  executePublicWebQuery,
  formatPublicWebFailureActionable,
  isBlockedPublicHost,
  isGitHubReadonlyLookupGoal,
  resolvePublicRedirect,
} from '../public-web-query';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../job-runner';

const RELEASE_GOAL_SLASH = '访问 github.com/zhongzhir/2digime，看有没有 release 版本可下载';
const RELEASE_GOAL_BACKSLASH = '访问 github.com\\zhongzhir\\2digime，看有没有 release 版本可下载';

function mockGitHubHttp(handler: HttpGetFn): HttpGetFn {
  return handler;
}

test('反斜杠与斜杠 GitHub URL 都能解析，release 查询不是代码审计', () => {
  const slash = parseGitHubTarget(RELEASE_GOAL_SLASH);
  const back = parseGitHubTarget(RELEASE_GOAL_BACKSLASH);
  assert.ok(slash && back);
  assert.equal(slash.kind, 'repo');
  assert.equal(back.kind, 'repo');
  assert.equal(slash.owner, 'zhongzhir');
  assert.equal(back.owner, 'zhongzhir');
  assert.equal(slash.repo, '2digime');
  assert.equal(back.repo, '2digime');
  assert.equal(isRemoteCodeAuditGoal(RELEASE_GOAL_BACKSLASH), false);
  assert.equal(isGitHubReadonlyLookupGoal(RELEASE_GOAL_BACKSLASH), true);
  const classified = classifyPublicWebQuery(RELEASE_GOAL_BACKSLASH);
  assert.equal(classified?.kind, 'github_releases');
  const intent = deriveWorkIntentSync({ goal: RELEASE_GOAL_BACKSLASH, contextRefs: [] });
  assert.equal(intent.intentKind, 'general');
  assert.notEqual(intent.intentKind, 'analyze_code');
  assert.notEqual(intent.intentKind, 'create_document');
  assert.match(String(intent.userFacingNotice), /Release/);
});

const USER_GITHUB_SENTENCE =
  '帮我看一下 github.com\\zhongzhir\\2digime项目发布的release版本正常可安装使用吗？';

test('现场原句：中文紧挨仓库名时仍解析 owner/repo，且不把问题正文拼进 URL', async () => {
  const parsed = parseGitHubTarget(USER_GITHUB_SENTENCE);
  assert.ok(parsed, '必须解析出 GitHub 目标');
  assert.equal(parsed.kind, 'repo');
  assert.equal(parsed.owner, 'zhongzhir');
  assert.equal(parsed.repo, '2digime');
  const classified = classifyPublicWebQuery(USER_GITHUB_SENTENCE);
  assert.ok(classified);
  assert.equal(classified.kind, 'github_releases');
  assert.equal(classified.target?.owner, 'zhongzhir');
  assert.equal(classified.target?.repo, '2digime');
  assert.equal(classified.parseError, undefined);
  const seen: string[] = [];
  const result = await executePublicWebQuery(classified, {
    httpGet: async (url) => {
      seen.push(url);
      if (url === 'https://api.github.com/repos/zhongzhir/2digime') {
        return {
          status: 200,
          body: JSON.stringify({
            full_name: 'zhongzhir/2digime',
            default_branch: 'main',
            html_url: 'https://github.com/zhongzhir/2digime',
          }),
        };
      }
      if (url === 'https://api.github.com/repos/zhongzhir/2digime/releases') {
        return { status: 200, body: '[]' };
      }
      return { status: 404, body: 'unexpected ' + url };
    },
  });
  assert.ok(seen.includes('https://api.github.com/repos/zhongzhir/2digime/releases'));
  assert.ok(seen.every((u) => !/项目|发布|版本|安装/.test(u)), '不得请求含中文问题正文的 GitHub URL');
  assert.equal(result.ok, true);
});

test('GitHub 地址解析失败不得说成没有互联网', async () => {
  const q = classifyPublicWebQuery('帮我看一下 github.com 这个网站');
  assert.ok(q);
  const blocked = await executePublicWebQuery(q!, {
    httpGet: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.diagnostics.failureClass, 'parse_error');
    const text = formatPublicWebFailureActionable(blocked);
    assert.match(text, /地址/);
    assert.doesNotMatch(text, /没有互联网/);
    assert.match(text, /不是网络故障/);
  }
});

test('Releases mock：有 release / 无 release / 404 / 限流 / DNS / TLS / 超时 / 恶意重定向', async () => {
  const targetGoal = RELEASE_GOAL_SLASH;
  const query = classifyPublicWebQuery(targetGoal)!;
  const repoUrl = 'https://api.github.com/repos/zhongzhir/2digime';
  const relUrl = 'https://api.github.com/repos/zhongzhir/2digime/releases';
  const repoBody = JSON.stringify({
    full_name: 'zhongzhir/2digime',
    default_branch: 'main',
    description: 'demo',
    html_url: 'https://github.com/zhongzhir/2digime',
  });

  const withReleases = await executePublicWebQuery(query, {
    httpGet: mockGitHubHttp(async (url) => {
      if (url === repoUrl) return { status: 200, body: repoBody };
      if (url === relUrl) {
        return {
          status: 200,
          body: JSON.stringify([
            {
              name: 'v1.0.0',
              tag_name: 'v1.0.0',
              html_url: 'https://github.com/zhongzhir/2digime/releases/tag/v1.0.0',
              assets: [{ name: 'app.zip', browser_download_url: 'https://github.com/zhongzhir/2digime/releases/download/v1.0.0/app.zip' }],
            },
          ]),
        };
      }
      return { status: 404, body: '' };
    }),
  });
  assert.equal(withReleases.ok, true);
  if (withReleases.ok) {
    const text = withReleases.output.artifact.payload.kind === 'text' ? withReleases.output.artifact.payload.text : '';
    assert.match(text, /v1.0.0/);
    assert.match(text, /Releases API/);
    assert.doesNotMatch(text, /请你打开网页复制回来/);
    assert.ok(withReleases.traces.some((t) => /\/releases$/.test(t.url)));
  }

  const empty = await executePublicWebQuery(query, {
    httpGet: async (url) => {
      if (url === repoUrl) return { status: 200, body: repoBody };
      return { status: 200, body: '[]' };
    },
  });
  assert.equal(empty.ok, true);
  if (empty.ok) {
    const text = empty.output.artifact.payload.kind === 'text' ? empty.output.artifact.payload.text : '';
    assert.match(text, /没有 Release/);
  }

  const notFound = await executePublicWebQuery(query, {
    httpGet: async () => ({ status: 404, body: 'Not Found' }),
  });
  assert.equal(notFound.ok, false);
  if (!notFound.ok) {
    assert.equal(notFound.diagnostics.failureClass, 'http_404');
    assert.match(formatPublicWebFailureActionable(notFound), /失败阶段/);
    assert.match(formatPublicWebFailureActionable(notFound), /已自动重试/);
  }

  const limited = await executePublicWebQuery(query, {
    httpGet: async () => ({ status: 403, body: 'API rate limit exceeded' }),
  });
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.match(String(limited.diagnostics.failureClass), /403|429|rate/);

  const dns = await executePublicWebQuery(query, {
    httpGet: async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' });
    },
  });
  assert.equal(dns.ok, false);
  if (!dns.ok) assert.equal(dns.diagnostics.failureClass, 'dns');

  const tls = await executePublicWebQuery(query, {
    httpGet: async () => {
      throw new Error('unable to verify the first certificate');
    },
  });
  assert.equal(tls.ok, false);
  if (!tls.ok) assert.equal(tls.diagnostics.failureClass, 'tls');

  const timeout = await executePublicWebQuery(query, {
    httpGet: async () => {
      throw new Error('timeout');
    },
  });
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.diagnostics.failureClass, 'timeout');

  assert.equal(isBlockedPublicHost('127.0.0.1'), true);
  assert.equal(isBlockedPublicHost('192.168.1.8'), true);
  assert.throws(() => assertSafePublicHttpUrl('http://127.0.0.1/secret'));
  assert.throws(() => assertSafePublicHttpUrl('file:///etc/passwd'));
  assert.throws(() => assertSafePublicHttpUrl('https://user:pass@example.com/x'));
  assert.throws(() => resolvePublicRedirect('https://example.com/page', 'http://127.0.0.1/secret'));
  assert.throws(() => resolvePublicRedirect('https://example.com/page', 'http://192.168.1.8/x'));
  assert.throws(() => resolvePublicRedirect('https://example.com/page', 'file:///etc/passwd'));
  const safeNext = resolvePublicRedirect('https://example.com/page', 'https://example.com/other');
  assert.equal(safeNext, 'https://example.com/other');
});

test('Work Job：release 查询命中 Releases API，失败不写伪成果', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-pubweb-'));
  const seen: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    publicWebHttpGet: async (url) => {
      seen.push(url);
      if (url.includes('/releases')) {
        return { status: 200, body: '[]' };
      }
      return {
        status: 200,
        body: JSON.stringify({
          full_name: 'zhongzhir/2digime',
          default_branch: 'main',
          description: 'demo',
          html_url: 'https://github.com/zhongzhir/2digime',
        }),
      };
    },
  });
  await runtime.createPackage({ displayName: '公开查询', targetDir: path.join(root, 'pkg') });
  const submitted = await runtime.submitTask({
    goal: RELEASE_GOAL_BACKSLASH,
    contextRefs: [],
  });
  assert.equal(submitted.intentKind, 'general');
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'succeeded', String(job.failure?.message || job.failure?.actionable || ''));
  assert.ok(seen.some((u) => /\/releases$/.test(u)), `未请求 Releases API：${seen.join(',')}`);
  const content = await runtime.getContent({ artifactId: job.artifactId as string });
  assert.match(String(content.text || ''), /没有 Release|Releases/);
  assert.doesNotMatch(String(content.text || ''), /请你打开网页复制回来/);
  await runtime.stop();
});

test('Work Job：网络失败显示阶段主机分类重试，不产出成果', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-pubweb-fail-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    publicWebHttpGet: async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    },
  });
  await runtime.createPackage({ displayName: '公开失败', targetDir: path.join(root, 'pkg') });
  const submitted = await runtime.submitTask({
    goal: RELEASE_GOAL_SLASH,
    contextRefs: [],
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'failed');
  const actionable = String(job.failure?.actionable || '');
  assert.match(actionable, /失败阶段/);
  assert.match(actionable, /请求主机/);
  assert.match(actionable, /失败分类/);
  assert.match(actionable, /已自动重试/);
  const detail = await runtime.getTask({ taskId: submitted.taskId });
  assert.equal((detail.artifactIds || []).length, 0);
  await runtime.stop();
});

test('Work Job：公开网页走 SearchConnector.read，不是普通写作', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-pubpage-'));
  const reads: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    publicPageRead: async (url) => {
      reads.push(url);
      return {
        content: '这是公开页面的静态正文，说明项目主页可下载说明。'.repeat(3),
        resolvedUrl: url,
      };
    },
  });
  await runtime.createPackage({ displayName: '网页读取', targetDir: path.join(root, 'pkg') });
  const submitted = await runtime.submitTask({
    goal: '访问 https://example.com/project 看看项目说明',
    contextRefs: [],
  });
  assert.equal(submitted.intentKind, 'general');
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'succeeded', String(job.failure?.message || job.failure?.actionable || ''));
  assert.ok(reads.some((u) => u.includes('example.com/project')), `未调用 pageRead：${reads.join(',')}`);
  const content = await runtime.getContent({ artifactId: job.artifactId as string });
  assert.match(String(content.text || ''), /公开页面的静态正文/);
  assert.doesNotMatch(String(content.text || ''), /请你打开网页复制回来/);
  await runtime.stop();
});

test('live smoke 仅证明公开仓库可访问，不得写成所有网站可用', async (t) => {
  if (process.env.DIGITALME_GITHUB_LIVE_SMOKE !== '1') {
    t.skip('设置 DIGITALME_GITHUB_LIVE_SMOKE=1 才访问公开仓库');
    return;
  }
  const query = classifyPublicWebQuery('访问 https://github.com/octocat/Hello-World 看仓库概览');
  assert.ok(query);
  const result = await executePublicWebQuery(query);
  assert.equal(result.ok, true);
  if (result.ok) {
    const text = result.output.artifact.payload.kind === 'text' ? result.output.artifact.payload.text : '';
    assert.match(text, /octocat\/Hello-World|Hello-World/);
  }
});
