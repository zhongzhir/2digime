/**
 * 复现：仅 GitHub URL/账号审计不得落到写作，失败须有可复制提示词与重试依据。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deriveWorkIntentSync } from '../work-intent';
import {
  OVERVIEW_ONLY_NOTICE,
  buildExternalAuditHandoffPrompt,
  coverageImpliesFullCodeAudit,
  fetchGitHubPublicIntoDir,
  formatRemoteAuditFailureActionable,
  classifyGitHubFailure,
  HANDOFF_PROMPT_MARKER,
  isAllowedGitHubDownloadUrl,
  isRemoteCodeAuditGoal,
  isTechnicalLeadTask,
  looksLikeBroughtBackAudit,
  looksLikeFileGenerationGoal,
  parseGitHubTarget,
  type HttpGetFn,
} from '../remote-github-audit';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal } from '../job-runner';
import { CapabilityRegistry } from '../../capability/registry';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import {
  CODE_ANALYSIS_ARTIFACT_TYPE,
  CODE_REPO_ANALYSIS_CAPABILITY_ID,
  buildCodeRepoAnalysisRegistration,
} from '../../capability/adapters/code-repo-analysis-contract';

const GITHUB_AUDIT_GOAL = '审计 github.com/zhongzhir 账号下的项目，看看有没有问题。';
const FILE_EXPORT_GOAL = '根据已有文稿和 PPT 大纲，生成可下载的 Word 和 PPT 文件。';

test('GitHub 账号 URL + 审计 → 远程代码审计意图，不得当普通写作', () => {
  assert.equal(isRemoteCodeAuditGoal(GITHUB_AUDIT_GOAL), true);
  const target = parseGitHubTarget(GITHUB_AUDIT_GOAL);
  assert.ok(target);
  assert.equal(target.kind, 'user');
  assert.equal(target.owner, 'zhongzhir');
  const intent = deriveWorkIntentSync({ goal: GITHUB_AUDIT_GOAL, contextRefs: [] });
  assert.equal(intent.intentKind, 'analyze_code');
  assert.equal(intent.expectedOutputFamily, 'code-analysis');
  assert.equal(intent.highConfidence, false);
  assert.ok(intent.userFacingNotice);
  assert.doesNotMatch(intent.userFacingNotice || '', /写作|周报/);
});

test('GitHub 仓库 URL 同样识别为代码审计', () => {
  const goal = '审查 https://github.com/zhongzhir/demo 有没有安全问题';
  assert.equal(isRemoteCodeAuditGoal(goal), true);
  const target = parseGitHubTarget(goal);
  assert.equal(target?.kind, 'repo');
  assert.equal(target?.repo, 'demo');
  const intent = deriveWorkIntentSync({ goal, contextRefs: [] });
  assert.equal(intent.intentKind, 'analyze_code');
});

test('selectForNeed：远程审计不得回退写作', () => {
  const registry = new CapabilityRegistry();
  registry.register(
    asLocalCapabilityAdapter({
      registration: {
        id: 'cap_document_openai',
        kind: 'model',
        displayName: '文档生成',
        description: '写作',
        inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
        outputArtifactTypes: ['document'],
        permissions: ['network', 'secret_access'],
        cost: { estimate: 'tokens' },
        latencyEstimate: 'seconds',
        location: 'local',
        availability: 'available',
        adapter: { type: 'openai-compatible-model', adapterId: 'document' },
      },
      async execute() {
        return {
          artifact: {
            type: 'document',
            title: '假审计',
            payload: { kind: 'text', text: '这不是代码审计', format: 'markdown' },
          },
        };
      },
    }),
  );
  registry.register(
    asLocalCapabilityAdapter({
      registration: buildCodeRepoAnalysisRegistration('needs_setup'),
      async execute() {
        throw new Error('should not run');
      },
    }),
  );
  const denied = registry.selectForNeed({
    intentKind: 'analyze_code',
    expectedOutputFamily: CODE_ANALYSIS_ARTIFACT_TYPE,
    materialKinds: ['unknown'],
  });
  assert.equal(denied.reason, 'none');
  assert.ok(denied.actionable && /不会改用普通写作冒充/.test(denied.actionable));
  assert.equal(denied.adapter, undefined);
});

test('失败兜底：可复制完整提示词，并说明把结果带回来', () => {
  const target = parseGitHubTarget(GITHUB_AUDIT_GOAL)!;
  const prompt = buildExternalAuditHandoffPrompt(target, GITHUB_AUDIT_GOAL);
  assert.match(prompt, /zhongzhir/);
  assert.match(prompt, /问题清单|已证实/);
  assert.ok(prompt.length > 80);
  const actionable = formatRemoteAuditFailureActionable({
    ok: false,
    code: 'network',
    blocker: '现在连不上 GitHub',
    nextStep: '请检查网络后点「重试」。',
    copyablePrompt: prompt,
  });
  assert.match(actionable, new RegExp(HANDOFF_PROMPT_MARKER));
  assert.match(actionable, /重试/);
  assert.match(actionable, /发回/);
  assert.ok(actionable.includes(prompt));
});

test('用户带回长审计报告时不再当成远程拉取任务', () => {
  const pasted = [
    '# 审计结论',
    '',
    '## 仓库 demo',
    '问题清单：',
    '- 风险：依赖过期',
    '- 建议修改：升级 lodash',
    '依据见 README 与 package.json。',
    'x'.repeat(420),
  ].join('\n');
  assert.equal(looksLikeBroughtBackAudit(pasted), true);
  assert.equal(isRemoteCodeAuditGoal(pasted), false);
});

test('Word/PPT 生成是文档导出任务，不是脚本任务；默认身份不是技术负责人', () => {
  assert.equal(looksLikeFileGenerationGoal(FILE_EXPORT_GOAL), true);
  const intent = deriveWorkIntentSync({ goal: FILE_EXPORT_GOAL, contextRefs: [] });
  assert.equal(intent.intentKind, 'create_document');
  assert.equal(isTechnicalLeadTask(FILE_EXPORT_GOAL), false);
  assert.equal(isTechnicalLeadTask(GITHUB_AUDIT_GOAL), true);
  assert.equal(isTechnicalLeadTask('帮我规划下周学习和沟通安排'), false);
});

function githubRepoMock(files: Record<string, { text?: string; size?: number; binary?: boolean }>): HttpGetFn {
  const blobs = Object.entries(files).map(([filePath, spec], i) => ({
    path: filePath,
    type: 'blob' as const,
    size: spec.size ?? Buffer.byteLength(spec.text || '', 'utf8'),
    sha: `sha-${i}-${filePath.replace(/[^\w.-]+/g, '_')}`,
    text: spec.text,
    binary: spec.binary,
  }));
  return async (url) => {
    if (/\/users\/zhongzhir\/repos/.test(url)) {
      return { status: 200, body: JSON.stringify([{ name: 'demo', fork: false }]) };
    }
    if (/\/repos\/zhongzhir\/demo\/git\/trees\//.test(url)) {
      return {
        status: 200,
        body: JSON.stringify({
          truncated: false,
          tree: blobs.map(({ path: p, type, size, sha }) => ({ path: p, type, size, sha })),
        }),
      };
    }
    const blobHit = blobs.find((b) => url.includes(`/git/blobs/${b.sha}`));
    if (blobHit) {
      if (blobHit.binary) return { status: 200, body: `png\u0000${'x'.repeat(20)}` };
      return { status: 200, body: blobHit.text || '' };
    }
    if (/\/repos\/zhongzhir\/demo$/.test(url)) {
      return { status: 200, body: JSON.stringify({ default_branch: 'main', name: 'demo' }) };
    }
    return { status: 404, body: '' };
  };
}

test('公开仓库可读时写入快照目录', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-ok-'));
  const dest = path.join(dir, 'snap');
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet: githubRepoMock({
      'README.md': { text: '# demo\nhello' },
      'package.json': { text: '{"name":"demo"}' },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fileCount, 2);
  assert.equal(result.foundRepoCount, 1);
  assert.deepEqual(result.auditedRepos, ['demo']);
  assert.equal(await fs.readFile(path.join(dest, 'zhongzhir', 'demo', 'README.md'), 'utf8'), '# demo\nhello');
  assert.match(result.coverageMarkdown, /公开仓库数：1/);
  assert.match(result.coverageMarkdown, /README\.md/);
});

test('src 目录中的源文件会被抓取', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-src-')), 'snap');
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet: githubRepoMock({
      'README.md': { text: '# demo' },
      'src/index.ts': { text: 'export const n = 1;\n' },
      'src/lib/util.ts': { text: 'export function f() { return 1; }\n' },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(await fs.readFile(path.join(dest, 'zhongzhir', 'demo', 'src', 'index.ts'), 'utf8'), 'export const n = 1;\n');
  assert.ok(result.coverage.repos[0]?.sourceFilesRead.includes('src/index.ts'));
  assert.equal(result.overviewOnly, false);
  assert.equal(coverageImpliesFullCodeAudit(result.coverage), true);
});

test('嵌套测试文件会被抓取', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-test-')), 'snap');
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet: githubRepoMock({
      'README.md': { text: '# demo' },
      'src/index.ts': { text: 'export const n = 1;\n' },
      'tests/nested/foo.test.ts': { text: 'test("ok", () => {});\n' },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const nested = path.join(dest, 'zhongzhir', 'demo', 'tests', 'nested', 'foo.test.ts');
  assert.equal(await fs.readFile(nested, 'utf8'), 'test("ok", () => {});\n');
  assert.ok(result.coverage.repos[0]?.filesRead.includes('tests/nested/foo.test.ts'));
});

test('二进制文件和超大文件被跳过', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-skip-')), 'snap');
  const requested: string[] = [];
  const inner = githubRepoMock({
    'README.md': { text: '# demo' },
    'src/index.ts': { text: 'export const n = 1;\n' },
    'logo.png': { text: 'png', size: 120, binary: true },
    'huge.ts': { text: 'export const x = 1;\n', size: 500_000 },
  });
  const httpGet: HttpGetFn = async (url, headers) => {
    requested.push(url);
    return inner(url, headers);
  };
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  await assert.rejects(() => fs.stat(path.join(dest, 'zhongzhir', 'demo', 'logo.png')));
  await assert.rejects(() => fs.stat(path.join(dest, 'zhongzhir', 'demo', 'huge.ts')));
  assert.ok(result.coverage.repos[0]?.skipped.some((s) => s.path === 'logo.png' && s.reason === 'binary'));
  assert.ok(result.coverage.repos[0]?.skipped.some((s) => s.path === 'huge.ts' && s.reason === 'too_large'));
  assert.equal(requested.some((u) => /huge|logo\.png/.test(u) && /git\/blobs/.test(u)), false);
});

test('超出预算时结果明确标记部分覆盖', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-budget-')), 'snap');
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet: githubRepoMock({
      'README.md': { text: '# demo' },
      'package.json': { text: '{"name":"demo"}' },
      'src/index.ts': { text: 'export const n = 1;\n' },
      'tests/foo.test.ts': { text: 'test("ok", () => {});\n' },
    }),
    maxFilesPerRepo: 3,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.partial, true);
  assert.ok(result.coverage.repos[0]?.skipped.some((s) => s.reason === 'budget'));
  assert.match(result.coverageMarkdown, /因预算|部分覆盖/);
});

test('非 GitHub/raw.githubusercontent.com 下载地址被拒绝', async () => {
  assert.equal(isAllowedGitHubDownloadUrl('https://raw.githubusercontent.com/o/r/main/a.ts'), true);
  assert.equal(isAllowedGitHubDownloadUrl('https://api.github.com/repos/o/r/git/blobs/abc'), true);
  assert.equal(isAllowedGitHubDownloadUrl('https://github.com/o/r'), true);
  assert.equal(isAllowedGitHubDownloadUrl('http://raw.githubusercontent.com/o/r/main/a.ts'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://raw.example/README.md'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://evil.com/secret'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://github.com.evil.com/o/r'), false);

  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-url-')), 'snap');
  const fetched: string[] = [];
  const httpGet: HttpGetFn = async (url) => {
    fetched.push(url);
    if (/\/users\/zhongzhir\/repos/.test(url)) {
      return { status: 200, body: JSON.stringify([{ name: 'demo', fork: false }]) };
    }
    if (/\/repos\/zhongzhir\/demo\/git\/trees\//.test(url)) {
      return { status: 404, body: 'not found' };
    }
    if (/\/repos\/zhongzhir\/demo\/contents\?ref=/.test(url) || /\/contents\/?$/.test(url)) {
      return {
        status: 200,
        body: JSON.stringify([
          {
            name: 'README.md',
            path: 'README.md',
            type: 'file',
            size: 12,
            download_url: 'https://raw.example/README.md',
          },
        ]),
      };
    }
    if (/\/repos\/zhongzhir\/demo$/.test(url)) {
      return { status: 200, body: JSON.stringify({ default_branch: 'main' }) };
    }
    if (/raw\.example|evil\.com/.test(url)) {
      return { status: 200, body: 'should-not-download' };
    }
    return { status: 404, body: '' };
  };
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet,
  });
  assert.equal(fetched.some((u) => /raw\.example|evil\.com/.test(u)), false);
  if (result.ok) {
    assert.ok(result.coverage.repos.some((r) => r.skipped.some((s) => s.reason === 'unsafe_url')));
  } else {
    assert.equal(result.code, 'empty');
  }
});

test('只有根文件而没有源码时不得宣称完整审计', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-overview-')), 'snap');
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet: githubRepoMock({
      'README.md': { text: '# demo\nhello' },
      'package.json': { text: '{"name":"demo"}' },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.overviewOnly, true);
  assert.equal(coverageImpliesFullCodeAudit(result.coverage), false);
  assert.match(result.coverageMarkdown, new RegExp(OVERVIEW_ONLY_NOTICE));
  assert.match(result.coverageMarkdown, /不得把本次结果当作完整代码审计/);
  assert.doesNotMatch(result.coverageMarkdown, /已完成代码审计|完整代码审计已完成/);
  const coverageFile = await fs.readFile(path.join(dest, 'AUDIT_COVERAGE.md'), 'utf8');
  assert.match(coverageFile, new RegExp(OVERVIEW_ONLY_NOTICE));
});

test('网络失败时诚实阻断并带可复制提示词，不写空仓库', async () => {
  const dest = path.join(os.tmpdir(), `dmv2-gh-fail-${Date.now()}`);
  const result = await fetchGitHubPublicIntoDir({
    target: { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
    destDir: dest,
    httpGet: async () => {
      throw Object.assign(new Error('ENOTFOUND api.github.com'), { code: 'ENOTFOUND' });
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'network');
  assert.match(result.copyablePrompt, /zhongzhir/);
  await assert.rejects(() => fs.stat(dest), /ENOENT/);
});

test('Job：远程审计失败不得产出写作成果，失败说明含提示词', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-job-'));
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    githubAuditFetch: async () => ({
      ok: false,
      code: 'network',
      blocker: '现在连不上 GitHub，所以还不能直接读取这些公开仓库。',
      nextStep: '请检查网络后点「重试」。',
      copyablePrompt: buildExternalAuditHandoffPrompt(
        { kind: 'user', owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' },
        GITHUB_AUDIT_GOAL,
      ),
    }),
  });
  runtime.start();
  const submitted = await runtime.submitTask({
    goal: GITHUB_AUDIT_GOAL,
    contextRefs: [],
    intentKind: 'create_document',
    requestedArtifactType: 'document',
  });
  assert.equal(submitted.intentKind, 'analyze_code');
  const job = await waitForJobTerminal(runtime, submitted.jobId);
  assert.equal(job.status, 'failed');
  assert.match(String(job.failure?.actionable || ''), new RegExp(HANDOFF_PROMPT_MARKER));
  assert.match(String(job.failure?.actionable || ''), /重试/);
  const detail = await runtime.getTask({ taskId: submitted.taskId });
  assert.equal((detail.artifactIds || []).length, 0);
  await runtime.stop();
});

test('失败诊断含阶段、主机、安全 URL、HTTP 状态与分类；提示词不是完成', () => {
  const actionable = formatRemoteAuditFailureActionable({
    ok: false,
    code: 'not_found',
    blocker: 'GitHub 上没有找到这个公开账号或仓库。',
    nextStep: '请核对地址。',
    copyablePrompt: '请审计',
    diagnostics: {
      stage: 'http_get',
      host: 'api.github.com',
      url: 'https://api.github.com/repos/missing/missing',
      status: 404,
      failureClass: 'http_404',
      traces: [
        {
          stage: 'http_get',
          host: 'api.github.com',
          url: 'https://api.github.com/repos/missing/missing',
          status: 404,
          failureClass: 'http_404',
        },
      ],
    },
  });
  assert.match(actionable, /失败阶段：http_get/);
  assert.match(actionable, /请求主机：api\.github\.com/);
  assert.match(actionable, /HTTP 状态：404/);
  assert.match(actionable, /仓库或账号不存在/);
  assert.match(actionable, /生成外部提示词不是审计完成/);
  assert.equal(classifyGitHubFailure({ status: 404 }), 'http_404');
  assert.equal(classifyGitHubFailure({ status: 403, body: 'API rate limit exceeded' }), 'http_403_rate_limit');
  assert.equal(classifyGitHubFailure({ error: 'ENOTFOUND api.github.com' }), 'dns');
  assert.equal(classifyGitHubFailure({ error: 'certificate TLS' }), 'tls');
  assert.equal(classifyGitHubFailure({ error: 'timeout' }), 'timeout');
});

test('重试会重新发起真实请求，而不是复用提示词结果', async () => {
  let calls = 0;
  const httpGet: HttpGetFn = async (url) => {
    calls += 1;
    if (/\/users\//.test(url)) {
      return { status: 200, body: JSON.stringify([{ name: 'demo', fork: false }]) };
    }
    return { status: 404, body: '' };
  };
  const dest1 = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-retry-')), 'a');
  const dest2 = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gh-retry-')), 'b');
  const target = { kind: 'user' as const, owner: 'zhongzhir', displayUrl: 'https://github.com/zhongzhir' };
  await fetchGitHubPublicIntoDir({ target, destDir: dest1, httpGet });
  const firstCalls = calls;
  assert.ok(firstCalls >= 1);
  await fetchGitHubPublicIntoDir({ target, destDir: dest2, httpGet });
  assert.ok(calls > firstCalls);
});

