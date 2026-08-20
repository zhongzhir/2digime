import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import {
  createOpenAiCompatibleAdapter,
  OPENAI_COMPATIBLE_CAPABILITY_ID,
} from '../openai-compatible';
import { assembleDocumentPrompt, PROMPT_MATERIAL_BUDGET_CHARS } from '../prompt-assemble';
import { providerCredentialKey } from '../../../infrastructure/secret-store';
import type { CapabilityInput, ExecutionContext } from '../../adapter';
import type { ContextSnapshot } from '../../../work-runtime/context-snapshot';

function baseInput(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    goal: '写一份简报',
    artifactType: 'document',
    snapshot: {
      id: 'snap_1',
      taskId: 'task_1',
      createdAt: new Date().toISOString(),
      items: [],
    },
    subjectContext: {
      subjectId: 'subj_1',
      derivedAt: new Date().toISOString(),
      entries: [],
    },
    ...overrides,
  };
}

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    jobId: 'job_1',
    reportProgress: () => undefined,
    signal: new AbortController().signal,
    secrets: {
      get: async (key) =>
        key === providerCredentialKey('openai-compatible') ? 'sk-test-key' : null,
    },
    workDir: os.tmpdir(),
    readExtractedText: async () => '材料正文',
    ...overrides,
  };
}

test('CapabilityRegistration 声明完整且无 provider 专有领域字段', () => {
  const adapter = createOpenAiCompatibleAdapter({
    baseUrl: 'https://example.test/v1',
    model: 'deepseek-v4-flash',
  });
  const reg = adapter.registration;
  assert.equal(reg.id, OPENAI_COMPATIBLE_CAPABILITY_ID);
  assert.equal(reg.adapter.type, 'openai-compatible-model');
  assert.equal(reg.adapter.adapterId, 'openai-compatible-chat');
  assert.ok(reg.displayName);
  assert.ok(reg.inputContract.acceptsGoal);
  assert.deepEqual(reg.outputArtifactTypes, ['document']);
  assert.ok(reg.permissions.includes('network'));
  assert.ok(reg.permissions.includes('secret_access'));
  assert.ok(reg.latencyEstimate);
  assert.ok(reg.cost.estimate);
  assert.equal(reg.availability, 'available');
  const dumped = JSON.stringify(reg);
  assert.ok(!dumped.includes('baseUrl'));
  assert.ok(!dumped.includes('apiKey'));
  assert.ok(!dumped.includes('deepseek-v4-flash'));
});

test('prompt 组装:warning 不进正文;长材料截断;confirmed 可注入', async () => {
  const long = '字'.repeat(PROMPT_MATERIAL_BUDGET_CHARS + 1000);
  const snapshot: ContextSnapshot = {
    id: 'snap_x',
    taskId: 'task_x',
    createdAt: new Date().toISOString(),
    items: [
      {
        sourcePath: '/a.txt',
        kind: 'file',
        status: 'ok',
        extractedTextRef: 'text/aa/ok.txt',
      },
      {
        sourcePath: '/bad.docx',
        kind: 'file',
        status: 'warning',
        warning: 'broken',
      },
      {
        sourcePath: '/big.md',
        kind: 'file',
        status: 'ok',
        extractedTextRef: 'text/bb/big.md',
      },
    ],
  };
  const texts: Record<string, string> = {
    'text/aa/ok.txt': '短材料内容',
    'text/bb/big.md': long,
  };
  const assembled = await assembleDocumentPrompt(
    baseInput({
      snapshot,
      subjectContext: {
        subjectId: 'subj',
        derivedAt: 't',
        entries: [
          {
            eventId: 'gevt_1',
            title: '措辞替换',
            detail: '避免空话',
            tags: ['周报'],
            occurredAt: 't',
          },
        ],
      },
    }),
    async (ref) => texts[ref] ?? '',
  );
  assert.match(assembled.messages[1]?.content as string, /短材料内容/);
  assert.doesNotMatch(assembled.messages[1]?.content as string, /broken|bad\.docx/);
  assert.match(assembled.messages[1]?.content as string, /已确认经验/);
  assert.match(assembled.messages[1]?.content as string, /gevt_1/);
  assert.match(assembled.messages[1]?.content as string, /# 任务/);
  assert.doesNotMatch(assembled.messages[1]?.content as string, /# 任务概要\n/);
  assert.equal(assembled.taskBrief.artifactType, 'document');
  assert.ok(assembled.truncatedCount >= 1 || assembled.materialCount >= 1);
  assert.equal(assembled.skippedWarningCount, 1);
  assert.ok(!JSON.stringify(assembled).includes('ContextSnapshot'));
});

test('Task Brief:Owner 获奖报道目标抽取新闻体裁与禁止项', async () => {
  const { extractTaskBrief } = await import('../prompt-assemble');
  const goal =
    '撰写一篇 Digital Me 项目参加 AIGO 比赛的获奖报道，发布到公众号，约 500 字，需要介绍 Digital Me 的优势。';
  const brief = extractTaskBrief({ goal, artifactType: 'document' }, []);
  assert.equal(brief.genre, '新闻报道');
  assert.match(brief.publishScene, /公众号|对外/);
  assert.match(brief.lengthHint, /500/);
  assert.ok(brief.mustCover.some((x) => /优势|价值/.test(x)));
  assert.ok(brief.styleAndForbid.some((x) => /新闻报道|事实开篇/.test(x)));
  assert.ok(brief.styleAndForbid.some((x) => /规格说明书|白皮书|虚构/.test(x)));
});

test('修改要求进入 prompt,不发起第二次模型调用', async () => {
  const assembled = await assembleDocumentPrompt(
    baseInput({
      revision: {
        request: '开篇改成获奖事实',
        previousText: '# 旧稿\n内容',
        artifactId: 'art_1',
        rejectionReason: '主题错误，未围绕目标',
      },
    }),
    async () => '',
  );
  assert.match(assembled.messages[0]?.content as string, /材料不得自动成为最终答案/);
  assert.match(assembled.messages[1]?.content as string, /# 优先级/);
  assert.match(assembled.messages[1]?.content as string, /# 不采用理由/);
  assert.match(assembled.messages[1]?.content as string, /主题错误/);
  assert.match(assembled.messages[1]?.content as string, /# 修改要求/);
  assert.match(assembled.messages[1]?.content as string, /开篇改成获奖事实/);
  assert.match(assembled.messages[1]?.content as string, /# 当前成果\(待改对象/);
  assert.match(assembled.messages[1]?.content as string, /旧稿/);
});

test('多材料按目标相关度排序，且不得整篇当答案', async () => {
  const snapshot = {
    id: 'snap_1',
    taskId: 'task_1',
    createdAt: 't',
    items: [
      {
        sourcePath: 'C:/mats/waic-long.md',
        status: 'ok' as const,
        extractedTextRef: 'text/waic',
      },
      {
        sourcePath: 'C:/mats/aivestor-notes.md',
        status: 'ok' as const,
        extractedTextRef: 'text/aiv',
      },
    ],
  };
  const assembled = await assembleDocumentPrompt(
    baseInput({
      goal: '写一篇关于 Aivestor 项目的介绍文章，不少于1500字。',
      snapshot: snapshot as never,
    }),
    async (ref) =>
      ref === 'text/aiv'
        ? 'Aivestor 是面向投资者的智能助手，定位清晰。'
        : `${'WAIC 券商 Skill 无关长文。'.repeat(200)}`,
  );
  const user = assembled.messages[1]?.content as string;
  assert.match(user, /材料（事实与素材；不得整篇当作答案）/);
  const aivPos = user.indexOf('aivestor-notes.md');
  const waicPos = user.indexOf('waic-long.md');
  assert.ok(aivPos >= 0 && waicPos >= 0);
  assert.ok(aivPos < waicPos, 'Aivestor 相关材料应排在无关长文之前');
});

test('材料完整性:合计未超总预算时续读剩余段，全部完整读取', async () => {
  const architecture = '架构说明。'.repeat(900); // > 3500，旧单篇上限会截断
  const execution = '执行步骤。'.repeat(250);
  const readme = '项目说明。';
  assert.ok(architecture.length > 3500);
  assert.ok(architecture.length + execution.length + readme.length < PROMPT_MATERIAL_BUDGET_CHARS);
  const snapshot = {
    id: 'snap_full',
    taskId: 'task_full',
    createdAt: 't',
    items: [
      { sourcePath: '/proj/README.txt', status: 'ok' as const, extractedTextRef: 'text/readme' },
      { sourcePath: '/proj/architecture.md', status: 'ok' as const, extractedTextRef: 'text/arch' },
      { sourcePath: '/proj/execution.md', status: 'ok' as const, extractedTextRef: 'text/exec' },
    ],
  };
  const assembled = await assembleDocumentPrompt(
    baseInput({
      goal: '形成一份架构评估报告，说明当前架构、主要问题和建议的下一步。',
      snapshot: snapshot as never,
    }),
    async (ref) =>
      ref === 'text/arch' ? architecture : ref === 'text/exec' ? execution : readme,
  );
  assert.equal(assembled.materialCount, 3);
  assert.equal(assembled.fullReadCount, 3);
  assert.equal(assembled.truncatedCount, 0);
  const byPath = new Map(assembled.items.map((it) => [it.sourcePath.replace(/\\/g, '/'), it]));
  assert.equal(byPath.get('/proj/architecture.md')?.completeness, 'full');
  assert.equal(byPath.get('/proj/architecture.md')?.usedChars, architecture.length);
  assert.equal(byPath.get('/proj/architecture.md')?.sourceChars, architecture.length);
  assert.equal(byPath.get('/proj/execution.md')?.completeness, 'full');
  assert.equal(byPath.get('/proj/README.txt')?.completeness, 'full');
  const user = assembled.messages[1]?.content as string;
  assert.match(user, /材料完整性/);
  assert.match(user, /完整读取/);
  assert.match(user, /续读第2段|architecture\.md：完整读取/);
});

test('材料完整性:超过总预算时标记部分读取，不得把纳入条数当成完整阅读', async () => {
  const huge = '字'.repeat(PROMPT_MATERIAL_BUDGET_CHARS + 4000);
  const snapshot = {
    id: 'snap_trunc',
    taskId: 'task_trunc',
    createdAt: 't',
    items: [
      { sourcePath: '/proj/short.txt', status: 'ok' as const, extractedTextRef: 'text/short' },
      { sourcePath: '/proj/huge.md', status: 'ok' as const, extractedTextRef: 'text/huge' },
    ],
  };
  const assembled = await assembleDocumentPrompt(
    baseInput({
      goal: '写一份简报',
      snapshot: snapshot as never,
    }),
    async (ref) => (ref === 'text/huge' ? huge : '短材料'),
  );
  assert.equal(assembled.materialCount, 2);
  assert.ok(assembled.truncatedCount >= 1);
  const hugeItem = assembled.items.find((it) => it.sourcePath.includes('huge.md'));
  assert.ok(hugeItem);
  assert.equal(hugeItem.completeness, 'truncated');
  assert.ok(hugeItem.sourceChars > hugeItem.usedChars);
  assert.ok(hugeItem.usedChars > 0);
  assert.ok(assembled.fullReadCount < assembled.materialCount);
  const user = assembled.messages[1]?.content as string;
  assert.match(user, /部分读取/);
  assert.match(user, /纳入提示的材料条数不是完整阅读数/);
});

async function withMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

test('真实 Adapter:成功返回 document ArtifactPayload', async () => {
  await withMockServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '# 简报\n\n正文内容' } }],
        usage: { total_tokens: 12 },
      }),
    );
  }, async (baseUrl) => {
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: 'mock-model' });
    const out = await adapter.execute(baseInput(), ctx());
    assert.equal(out.artifact.type, 'document');
    assert.equal(out.artifact.payload.kind, 'text');
    if (out.artifact.payload.kind === 'text') {
      assert.match(out.artifact.payload.text, /正文内容/);
    }
    assert.equal(out.costActual?.tokens, 12);
  });
});

test('401 / 429 / timeout / abort / 空内容 / 非法响应 分类', async () => {
  await withMockServer((req, res) => {
    if (req.url?.includes('/unauthorized/')) res.writeHead(401).end('{"error":"no"}');
    else if (req.url?.includes('/ratelimited/')) res.writeHead(429).end('{"error":"slow"}');
    else if (req.url?.includes('/empty/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }));
    } else if (req.url?.includes('/bad/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [] }));
    } else if (req.url?.includes('/slow/')) {
      // hang
    } else {
      res.writeHead(500).end('err');
    }
  }, async (baseUrl) => {
    const run = async (suffix: string, execCtx?: ExecutionContext) => {
      const adapter = createOpenAiCompatibleAdapter({
        baseUrl: `${baseUrl.replace('/v1', '')}${suffix}/v1`,
        model: 'm',
        timeoutMs: 150,
      });
      try {
        await adapter.execute(baseInput(), execCtx ?? ctx());
        return null;
      } catch (error) {
        return error as Error & { stage?: string; kind?: string };
      }
    };

    const u = await run('/unauthorized');
    assert.equal(u?.stage, 'capability');
    assert.equal(u?.kind, 'unauthorized');
    assert.ok(!String(u?.message).includes('sk-test'));

    const r = await run('/ratelimited');
    assert.equal(r?.stage, 'model');
    assert.equal(r?.kind, 'rate_limited');

    const t = await run('/slow');
    assert.equal(t?.stage, 'model');
    assert.equal(t?.kind, 'timeout');

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const a = await run('/slow', ctx({ signal: controller.signal }));
    assert.ok(a?.name === 'AbortError' || a?.kind === 'aborted' || /abort/i.test(a?.message ?? ''));

    const e = await run('/empty');
    assert.equal(e?.stage, 'model');
    assert.match(e?.message ?? '', /empty|missing usable|reasoning discarded/i);

    const b = await run('/bad');
    assert.equal(b?.stage, 'model');
    assert.equal(b?.kind, 'bad_response');
  });
});

test('缺少凭证 → capability 阶段,不读文件 Store', async () => {
  const adapter = createOpenAiCompatibleAdapter({
    baseUrl: 'https://example.invalid/v1',
    model: 'm',
  });
  await assert.rejects(
    () =>
      adapter.execute(
        baseInput(),
        ctx({
          secrets: { get: async () => null },
        }),
      ),
    (error: unknown) =>
      error instanceof Error &&
      (error as { stage?: string }).stage === 'capability' &&
      /credential/i.test(error.message),
  );
});

test('错误消息不含 Authorization / 密钥', async () => {
  await withMockServer((_req, res) => {
    res.writeHead(401).end('{"error":"Bearer sk-leak-should-not-pass"}');
  }, async (baseUrl) => {
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: 'm' });
    try {
      await adapter.execute(baseInput(), ctx());
      assert.fail('expected throw');
    } catch (error) {
      const msg = String((error as Error).message);
      assert.ok(!msg.includes('sk-test-key'));
      assert.ok(!/Bearer\s+sk-/i.test(msg));
    }
  });
});
