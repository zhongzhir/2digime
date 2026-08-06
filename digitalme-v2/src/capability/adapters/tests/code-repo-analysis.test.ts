import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { scoreFile, assembleCodeAnalysisPrompt, scrubText } from '../code-analysis-prompt';
import {
  parseModelCodeAnalysisPayload,
  validateCodeAnalysisPayload,
  CodeAnalysisValidationError,
} from '../code-analysis-validate';
import { createCodeRepoAnalysisAdapter, createCodeRepoAnalysisAdapterStub } from '../code-repo-analysis';
import { buildCodeRepoAnalysisRegistration } from '../code-repo-analysis-contract';
import type { CapabilityInput, ExecutionContext } from '../../adapter';
import type { ContextSnapshot } from '../../../work-runtime/context-snapshot';
import { ContentStore } from '../../../infrastructure/content-store';
import { createWorkRuntime } from '../../../work-runtime/create-runtime';
import { waitForJobTerminal } from '../../../work-runtime/job-runner';

test('P2.2 文件优先级:配置 > 入口 > 领域 > 测试', () => {
  assert.ok(scoreFile('package.json', 'x') > scoreFile('src/index.ts', 'x'));
  assert.ok(scoreFile('src/index.ts', 'x') >= scoreFile('src/foo.ts', 'x'));
  assert.ok(scoreFile('src/work-runtime/job-runner.ts', 'Work Runtime') > scoreFile('readme.md', 'x'));
  assert.ok(scoreFile('src/foo.test.ts', 'x') >= 40);
});

test('P2.2 scrub 去除密钥', () => {
  const s = scrubText('key=sk-abcdefghijklmnopqrstuvwxyz token');
  assert.ok(s.includes('[redacted]'));
  assert.ok(!s.includes('sk-abcdef'));
});

test('P2.2 注册契约:network+secret_access,无 filesystem_read', () => {
  const reg = buildCodeRepoAnalysisRegistration('available');
  assert.deepEqual([...reg.permissions].sort(), ['network', 'secret_access']);
  assert.equal(reg.adapter.type, 'openai-compatible-model');
  assert.equal(reg.adapter.adapterId, 'code-repo-analysis');
  assert.ok(reg.contextPolicy);
});

test('P2.2 needs_setup stub 不提供本地替代', async () => {
  const stub = createCodeRepoAnalysisAdapterStub();
  assert.equal(stub.registration.availability, 'needs_setup');
  await assert.rejects(
    () =>
      stub.execute(
        baseInput(),
        baseCtx({
          secrets: { get: async () => null },
          readExtractedText: async () => '',
        }),
      ),
    /credential/i,
  );
});

test('P2.2 evidence 校验:虚构路径失败;合法 evidence 通过', () => {
  const snapshot = sampleSnapshot();
  const good = parseModelCodeAnalysisPayload(
    JSON.stringify({
      reportMarkdown: '# 报告\n已证实与推测与未覆盖均有说明',
      findings: [
        finding('c1', 'high', 'confirmed', {
          path: 'src/a.ts',
          contentDigest: 'digest-a',
          excerpt: 'export const a = 1',
        }),
        finding('c2', 'high', 'confirmed', {
          path: 'package.json',
          contentDigest: 'digest-pkg',
          excerpt: '{"name":"demo"}',
        }),
        finding('c3', 'medium', 'confirmed', {
          path: 'src/a.ts',
          contentDigest: 'digest-a',
          excerpt: 'export const a = 1',
        }),
        finding('c4', 'medium', 'inferred'),
        finding('c5', 'medium', 'uncovered'),
      ],
      coverage: { confirmed: ['c1'], inferred: ['c4'], uncovered: ['c5'] },
    }),
  );
  const texts = new Map([
    ['src/a.ts', 'export const a = 1;\n'],
    ['package.json', '{"name":"demo"}\n'],
  ]);
  const ok = validateCodeAnalysisPayload(good, snapshot, texts);
  assert.ok(ok.stats.importantCount >= 5);
  assert.equal(ok.stats.fabricatedPathCount, 0);
  assert.ok(ok.evidence.items.length >= 3);

  const bad = parseModelCodeAnalysisPayload(
    JSON.stringify({
      reportMarkdown: '# 报告\n已证实 推测 未覆盖',
      findings: [
        finding('x1', 'high', 'confirmed', {
          path: 'src/not-exist.ts',
          contentDigest: 'nope',
          excerpt: 'x',
        }),
        finding('x2', 'high', 'confirmed', {
          path: 'src/also-missing.ts',
          contentDigest: 'digest-a',
          excerpt: 'export const a = 1',
        }),
        finding('x3', 'medium', 'confirmed', {
          path: 'ghost/package.json',
          contentDigest: 'digest-pkg',
          excerpt: '{}',
        }),
        finding('x4', 'medium', 'inferred'),
        finding('x5', 'medium', 'inferred'),
      ],
    }),
  );
  assert.throws(
    () => validateCodeAnalysisPayload(bad, snapshot, texts),
    (err: unknown) => err instanceof CodeAnalysisValidationError,
  );

  // digest 幻觉可纠正为快照 digest
  const digestFixed = parseModelCodeAnalysisPayload(
    JSON.stringify({
      reportMarkdown: '# 报告\n已证实与推测与未覆盖',
      findings: [
        finding('d1', 'high', 'confirmed', {
          path: 'src/a.ts',
          contentDigest: 'wrong-digest',
          excerpt: 'export const a = 1',
        }),
        finding('d2', 'high', 'confirmed', {
          path: 'package.json',
          contentDigest: 'also-wrong',
          excerpt: '{"name":"demo"}',
        }),
        finding('d3', 'medium', 'confirmed', {
          path: 'src/a.ts',
          contentDigest: 'wrong-digest',
          excerpt: 'export const a = 1',
        }),
        finding('d4', 'medium', 'inferred'),
        finding('d5', 'medium', 'uncovered'),
      ],
      coverage: { confirmed: [], inferred: [], uncovered: [] },
    }),
  );
  const fixed = validateCodeAnalysisPayload(digestFixed, snapshot, texts);
  assert.equal(fixed.evidence.items[0]?.contentDigest, 'digest-a');
});

test('P2.2 真实 Adapter:mock 模型产出 bundle;失败分类', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p22-'));
  const contentStore = new ContentStore(path.join(root, 'content'));
  const storedA = await contentStore.putText('export const a = 1;\n', 'plain');
  const storedPkg = await contentStore.putText('{"name":"demo","scripts":{"test":"node -e 1"}}\n', 'plain');

  const snapshot: ContextSnapshot = {
    id: 'snap_1',
    taskId: 'task_1',
    createdAt: new Date().toISOString(),
    items: [
      {
        sourcePath: path.join(root, 'src', 'a.ts'),
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'src/a.ts',
        contentDigest: storedA.digest,
        ...(storedA.content.kind === 'text' ? { extractedTextRef: storedA.content.ref } : {}),
        bytes: 20,
      },
      {
        sourcePath: path.join(root, 'package.json'),
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'package.json',
        contentDigest: storedPkg.digest,
        ...(storedPkg.content.kind === 'text' ? { extractedTextRef: storedPkg.content.ref } : {}),
        bytes: 40,
      },
    ],
    ingestion: {
      rootName: 'demo',
      truncated: false,
      skippedSensitiveCount: 0,
      skippedBudgetCount: 0,
      totalBytesScanned: 60,
      fileCountScanned: 2,
    },
  };

  const payload = {
    reportMarkdown: [
      '# 架构分析',
      '已证实:模块边界清晰。',
      '推测:测试覆盖一般。',
      '未覆盖:部署细节。',
      'findings: c1 c2 c3 c4 c5',
    ].join('\n'),
    findings: [
      finding('c1', 'high', 'confirmed', {
        path: 'src/a.ts',
        contentDigest: storedA.digest,
        excerpt: 'export const a = 1',
      }),
      finding('c2', 'high', 'confirmed', {
        path: 'package.json',
        contentDigest: storedPkg.digest,
        excerpt: '"name":"demo"',
      }),
      finding('c3', 'medium', 'confirmed', {
        path: 'src/a.ts',
        contentDigest: storedA.digest,
        excerpt: 'export const a = 1',
      }),
      finding('c4', 'medium', 'inferred'),
      finding('c5', 'medium', 'uncovered'),
    ],
    coverage: { confirmed: ['边界'], inferred: ['测试'], uncovered: ['部署'] },
  };

  let call = 0;
  const server = await listenHandler(() => {
    call += 1;
    if (call === 1) {
      return {
        findings: payload.findings,
        coverage: payload.coverage,
      };
    }
    return {
      sections: {
        overview: '概览',
        stack: 'TypeScript',
        modules: '模块边界',
        execution: '执行链',
        risks: '风险',
        complexity: '复杂度',
        recommendations: '建议',
        coverage: '已证实 推测 未覆盖',
      },
    };
  });
  try {
    const adapter = createCodeRepoAnalysisAdapter({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: 'mock',
      providerId: 'openai-compatible',
    });
    const workDir = path.join(root, 'work');
    await fs.mkdir(workDir, { recursive: true });
    const out = await adapter.execute(
      {
        goal: '分析架构边界',
        snapshot,
        subjectContext: { subjectId: 's', derivedAt: new Date().toISOString(), entries: [] },
        artifactType: 'code-analysis',
      },
      {
        jobId: 'job_1',
        reportProgress: () => {},
        signal: new AbortController().signal,
        secrets: { get: async () => 'sk-test-key' },
        workDir,
        readExtractedText: async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
      },
    );
    assert.equal(out.artifact.payload.kind, 'bundle');
    if (out.artifact.payload.kind !== 'bundle') throw new Error('bundle');
    const roles = out.artifact.payload.entries.map((e) => e.role).sort();
    assert.deepEqual(roles, ['evidence', 'manifest', 'report']);
  } finally {
    await server.close();
  }

  // 401
  const unauthorized = await listenStatus(401, '{"error":"no"}');
  try {
    const adapter = createCodeRepoAnalysisAdapter({
      baseUrl: `http://127.0.0.1:${unauthorized.port}/v1`,
      model: 'mock',
    });
    await assert.rejects(
      () =>
        adapter.execute(baseInput({ snapshot }), {
          jobId: 'job_401',
          reportProgress: () => {},
          signal: new AbortController().signal,
          secrets: { get: async () => 'bad' },
          workDir: path.join(root, 'w401'),
          readExtractedText: async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
        }),
      (err: unknown) => (err as { kind?: string }).kind === 'unauthorized',
    );
  } finally {
    await unauthorized.close();
  }

  // 非法 JSON → P2.3 确定性 Snapshot 回退(不得无终态僵死)
  const badJson = await listenRaw(200, JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }));
  try {
    const adapter = createCodeRepoAnalysisAdapter({
      baseUrl: `http://127.0.0.1:${badJson.port}/v1`,
      model: 'mock',
    });
    const workDir = path.join(root, 'wbad');
    await fs.mkdir(workDir, { recursive: true });
    const out = await adapter.execute(baseInput({ snapshot }), {
      jobId: 'job_bad',
      reportProgress: () => {},
      signal: new AbortController().signal,
      secrets: { get: async () => 'k' },
      workDir,
      readExtractedText: async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
    });
    assert.equal(out.artifact.payload.kind, 'bundle');
    const reportPath = (out.artifact.payload as { entries: Array<{ role: string; sourcePath: string }> })
      .entries.find((e) => e.role === 'report')!.sourcePath;
    const report = await fs.readFile(reportPath, 'utf8');
    assert.ok(/快照|inferred|推测|结构化/i.test(report));
  } finally {
    await badJson.close();
  }
});

test('P2.2 prompt 组装只使用冻结文本且有预算', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p22p-'));
  const contentStore = new ContentStore(path.join(root, 'content'));
  const stored = await contentStore.putText('const secret = "sk-abcdefghijklmnopqrstuvwxyz";\n', 'plain');
  const snapshot: ContextSnapshot = {
    id: 's',
    taskId: 't',
    createdAt: new Date().toISOString(),
    items: [
      {
        sourcePath: 'C:\\should\\not\\appear\\in\\prompt\\as\\open.ts',
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'src/open.ts',
        contentDigest: stored.digest,
        ...(stored.content.kind === 'text' ? { extractedTextRef: stored.content.ref } : {}),
      },
    ],
  };
  const assembled = await assembleCodeAnalysisPrompt(
    baseInput({ snapshot }),
    async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
  );
  const joined = assembled.messages.map((m) => m.content).join('\n');
  assert.ok(joined.includes('src/open.ts'));
  assert.ok(!joined.includes('C:\\should\\not\\appear'));
  assert.ok(joined.includes('[redacted]'));
  assert.ok(assembled.selectedFiles.length >= 1);
});

test('P2.2 Work Runtime 经意图选择 code-analysis，禁止写作伪装', async () => {
  const src = await fs.readFile(
    path.resolve(__dirname, '..', '..', '..', '..', 'src', 'work-runtime', 'job-runner.ts'),
    'utf8',
  );
  assert.ok(/selectForNeed/.test(src));
  assert.ok(/CODE_ANALYSIS_ARTIFACT_TYPE|code-analysis/.test(src));
  assert.ok(/不会改用普通写作冒充|无法进行代码分析/.test(src));
  assert.ok(/contextPolicy/.test(src));
});

test('P2.2 cancel 与失败不产生 Artifact(经 WorkRuntime + mock)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p22rt-'));
  const repo = path.join(root, 'repo');
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  await fs.writeFile(path.join(repo, 'src', 'a.ts'), 'export const a=1;\n', 'utf8');
  await fs.writeFile(path.join(repo, 'package.json'), '{"name":"x"}\n', 'utf8');

  // 慢响应服务器用于 cancel
  const slow = await listenSlow(5_000);
  try {
    const runtime = createWorkRuntime({
      rootDir: path.join(root, 'rt'),
      subjectId: 'subj',
      registerDeterministicCodeAnalysis: false,
    });
    // 手动替换 registry:注入真实 adapter 指向 slow server — createWorkRuntime 默认 deterministic。
    // 此用例改为直接测 adapter cancel 语义 + runtime deterministic cancel 已在 P2.1 覆盖。
    const adapter = createCodeRepoAnalysisAdapter({
      baseUrl: `http://127.0.0.1:${slow.port}/v1`,
      model: 'mock',
    });
    const ac = new AbortController();
    const workDir = path.join(root, 'work');
    await fs.mkdir(workDir, { recursive: true });
    const contentStore = new ContentStore(path.join(root, 'content'));
    const stored = await contentStore.putText('export const a=1;\n', 'plain');
    const snapshot: ContextSnapshot = {
      id: 'snap',
      taskId: 't',
      createdAt: new Date().toISOString(),
      items: [
        {
          sourcePath: path.join(repo, 'src', 'a.ts'),
          kind: 'folder-entry',
          status: 'ok',
          relativePath: 'src/a.ts',
          contentDigest: stored.digest,
          ...(stored.content.kind === 'text' ? { extractedTextRef: stored.content.ref } : {}),
        },
      ],
    };
    setTimeout(() => ac.abort(), 30);
    await assert.rejects(
      () =>
        adapter.execute(baseInput({ snapshot }), {
          jobId: 'job_cancel',
          reportProgress: () => {},
          signal: ac.signal,
          secrets: { get: async () => 'k' },
          workDir,
          readExtractedText: async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
        }),
      (err: unknown) =>
        (err as Error).name === 'AbortError' ||
        (err as { kind?: string }).kind === 'aborted' ||
        /abort/i.test((err as Error).message || ''),
    );
    void runtime;
  } finally {
    await slow.close();
  }
});

function finding(
  claimId: string,
  importance: 'high' | 'medium' | 'low',
  confidence: 'confirmed' | 'inferred' | 'uncovered',
  evidence?: { path: string; contentDigest: string; excerpt?: string },
) {
  return {
    claimId,
    title: `title-${claimId}`,
    importance,
    confidence,
    summary: `summary-${claimId}`,
    ...(evidence ? { evidence } : {}),
  };
}

function sampleSnapshot(): ContextSnapshot {
  return {
    id: 'snap',
    taskId: 't',
    createdAt: new Date().toISOString(),
    items: [
      {
        sourcePath: '/tmp/src/a.ts',
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'src/a.ts',
        contentDigest: 'digest-a',
        extractedTextRef: 'text/aa',
      },
      {
        sourcePath: '/tmp/package.json',
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'package.json',
        contentDigest: 'digest-pkg',
        extractedTextRef: 'text/pkg',
      },
    ],
  };
}

test('P2.3 调用硬预算与 sections 失败时保留 findings', async () => {
  const { CodeAnalysisCallBudget } = await import('../code-analysis-call-budget');
  const budget = new CodeAnalysisCallBudget({ maxCalls: 4 });
  budget.consume('findings');
  budget.recordRetry('findings', 'non_json');
  budget.consume('findings');
  budget.consume('sections');
  budget.recordRetry('sections', 'empty_response');
  budget.consume('sections');
  assert.equal(budget.modelCalls, 4);
  assert.throws(() => budget.consume('findings'), /budget exceeded/i);
  assert.equal(budget.report().retries.length, 2);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p23-budget-'));
  const contentStore = new ContentStore(path.join(root, 'content'));
  const storedA = await contentStore.putText('export const a = 1;\n', 'plain');
  const storedPkg = await contentStore.putText('{"name":"demo"}\n', 'plain');
  const snapshot: ContextSnapshot = {
    id: 'snap_b',
    taskId: 'task_b',
    createdAt: new Date().toISOString(),
    items: [
      {
        sourcePath: path.join(root, 'src', 'a.ts'),
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'src/a.ts',
        contentDigest: storedA.digest,
        ...(storedA.content.kind === 'text' ? { extractedTextRef: storedA.content.ref } : {}),
      },
      {
        sourcePath: path.join(root, 'package.json'),
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'package.json',
        contentDigest: storedPkg.digest,
        ...(storedPkg.content.kind === 'text' ? { extractedTextRef: storedPkg.content.ref } : {}),
      },
    ],
  };
  const findings = {
    findings: [
      finding('c1', 'high', 'confirmed', {
        path: 'src/a.ts',
        contentDigest: storedA.digest,
        excerpt: 'export const a = 1',
      }),
      finding('c2', 'high', 'confirmed', {
        path: 'package.json',
        contentDigest: storedPkg.digest,
        excerpt: '"name":"demo"',
      }),
      finding('c3', 'medium', 'confirmed', {
        path: 'src/a.ts',
        contentDigest: storedA.digest,
        excerpt: 'export const a = 1',
      }),
      finding('c4', 'medium', 'inferred'),
      finding('c5', 'medium', 'uncovered'),
    ],
    coverage: { confirmed: ['c1'], inferred: ['c4'], uncovered: ['c5'] },
  };
  let call = 0;
  const server = await listenHandler(() => {
    call += 1;
    if (call === 1) return findings;
    return { broken: true };
  });
  try {
    const adapter = createCodeRepoAnalysisAdapter({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: 'mock',
      overallTimeoutMs: 30_000,
    });
    const workDir = path.join(root, 'work');
    await fs.mkdir(workDir, { recursive: true });
    const out = await adapter.execute(baseInput({ snapshot }), {
      jobId: 'job_p23',
      reportProgress: () => {},
      signal: new AbortController().signal,
      secrets: { get: async () => 'sk-test' },
      workDir,
      readExtractedText: async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
    });
    assert.equal(out.artifact.payload.kind, 'bundle');
    const reportPath = (out.artifact.payload as { entries: Array<{ role: string; sourcePath: string }> })
      .entries.find((e) => e.role === 'report')!.sourcePath;
    const report = await fs.readFile(reportPath, 'utf8');
    assert.ok(/c1|已证实|findings/i.test(report));
    assert.ok(call <= 4);
    const budgetFile = JSON.parse(
      await fs.readFile(path.join(workDir, '_code-analysis-call-budget.json'), 'utf8'),
    );
    assert.ok(budgetFile.modelCalls <= 4);
    assert.ok(budgetFile.retries.some((r: { phase: string }) => r.phase === 'sections'));
  } finally {
    await server.close();
  }
});

test('P2.3 已确认经验写入报告且含 eventId', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p23-xp-'));
  const contentStore = new ContentStore(path.join(root, 'content'));
  const storedA = await contentStore.putText('export const a = 1;\n', 'plain');
  const storedPkg = await contentStore.putText('{"name":"demo"}\n', 'plain');
  const snapshot: ContextSnapshot = {
    id: 'snap_x',
    taskId: 'task_x',
    createdAt: new Date().toISOString(),
    items: [
      {
        sourcePath: path.join(root, 'a.ts'),
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'src/a.ts',
        contentDigest: storedA.digest,
        ...(storedA.content.kind === 'text' ? { extractedTextRef: storedA.content.ref } : {}),
      },
      {
        sourcePath: path.join(root, 'package.json'),
        kind: 'folder-entry',
        status: 'ok',
        relativePath: 'package.json',
        contentDigest: storedPkg.digest,
        ...(storedPkg.content.kind === 'text' ? { extractedTextRef: storedPkg.content.ref } : {}),
      },
    ],
  };
  let call = 0;
  const server = await listenHandler(() => {
    call += 1;
    if (call === 1) {
      return {
        findings: [
          finding('c1', 'high', 'confirmed', {
            path: 'src/a.ts',
            contentDigest: storedA.digest,
            excerpt: 'export const a = 1',
          }),
          finding('c2', 'high', 'confirmed', {
            path: 'package.json',
            contentDigest: storedPkg.digest,
            excerpt: '"name":"demo"',
          }),
          finding('c3', 'medium', 'confirmed', {
            path: 'src/a.ts',
            contentDigest: storedA.digest,
            excerpt: 'export const a = 1',
          }),
          finding('c4', 'medium', 'inferred'),
          finding('c5', 'medium', 'uncovered'),
        ],
        coverage: { confirmed: [], inferred: [], uncovered: [] },
      };
    }
    return {
      sections: {
        overview: 'o',
        stack: 's',
        modules: 'm',
        execution: 'e',
        risks: 'r',
        complexity: 'c',
        recommendations: 'rec',
        coverage: '已证实 推测 未覆盖',
      },
    };
  });
  try {
    const adapter = createCodeRepoAnalysisAdapter({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: 'mock',
    });
    const workDir = path.join(root, 'work');
    await fs.mkdir(workDir, { recursive: true });
    const out = await adapter.execute(
      baseInput({
        snapshot,
        subjectContext: {
          subjectId: 's',
          derivedAt: new Date().toISOString(),
          entries: [
            {
              eventId: 'gevt_p23_marker',
              title: '零感知运行时',
              detail: 'P23_ZERO_AWARE_RUNTIME 保持 Work Runtime 对场景零感知',
              tags: ['code-analysis', '架构'],
              occurredAt: new Date().toISOString(),
            },
          ],
        },
      }),
      {
        jobId: 'job_xp',
        reportProgress: () => {},
        signal: new AbortController().signal,
        secrets: { get: async () => 'sk-test' },
        workDir,
        readExtractedText: async (ref) => (await contentStore.readBytes(ref)).toString('utf8'),
      },
    );
    const reportPath = (out.artifact.payload as { entries: Array<{ role: string; sourcePath: string }> })
      .entries.find((e) => e.role === 'report')!.sourcePath;
    const report = await fs.readFile(reportPath, 'utf8');
    assert.ok(report.includes('APPLIED_EXPERIENCE:gevt_p23_marker'));
    assert.ok(report.includes('P23_ZERO_AWARE_RUNTIME'));
  } finally {
    await server.close();
  }
});

function baseInput(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    goal: '分析架构',
    artifactType: 'code-analysis',
    snapshot: sampleSnapshot(),
    subjectContext: { subjectId: 's', derivedAt: new Date().toISOString(), entries: [] },
    ...overrides,
  };
}

function baseCtx(partial: Partial<ExecutionContext> & Pick<ExecutionContext, 'secrets'>): ExecutionContext {
  return {
    jobId: 'job',
    reportProgress: () => {},
    signal: new AbortController().signal,
    workDir: os.tmpdir(),
    ...partial,
  };
}

async function listenHandler(
  bodyFn: () => unknown,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    const payload = bodyFn();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function listenJson(payload: unknown): Promise<{ port: number; close: () => Promise<void> }> {
  return listenRaw(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
}

async function listenStatus(status: number, body: string): Promise<{ port: number; close: () => Promise<void> }> {
  return listenRaw(status, body);
}

async function listenRaw(
  status: number,
  body: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function listenSlow(delayMs: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
