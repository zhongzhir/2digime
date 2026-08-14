/**
 * AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32 / ROUTING-CLOSE
 * 确认前材料事实进入 converse；确认后由模型瞬时执行族决定能力，确定性代码只校验。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractFile, extractFolder, SUPPORTED_EXTENSIONS } from '../../infrastructure/extract';
import {
  buildConverseMaterialBrief,
  validateConfirmedPlanExecutionIntent,
} from '../converse-material-brief';
import {
  buildConverseMessages,
  decideConverseEffects,
  CONVERSE_EXECUTION_ROUTE_FAILED_NOTICE,
} from '../work-converse';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import { waitForJobTerminal } from '../job-runner';
import { productMainChainBlocksAutoRevision } from '../controlled-revision-runner';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-32-${prefix}-`));
}

async function writeImprintLikeFixture(root: string) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'imprint.html'),
    '<html><body><h1>IMPRINT</h1><p>triage_items and localStorage</p><script>void 0</script></body></html>',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'sample.csv'),
    'id,score,url\n1,3,https://example.com\n2,,https://x.test\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'IMPRINT-PROJECT.md'),
    'IMPRINT 是单文件内容分拣工作台，使用 localStorage 保存 triage_items。',
    'utf8',
  );
  await fs.mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1', 'utf8');
}

describe('AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32', () => {
  it('HTML/CSV 进入抽取白名单并可读', async () => {
    assert.ok((SUPPORTED_EXTENSIONS as readonly string[]).includes('.html'));
    assert.ok((SUPPORTED_EXTENSIONS as readonly string[]).includes('.csv'));
    const root = await tempDir('extract');
    await writeImprintLikeFixture(root);
    const html = await extractFile(path.join(root, 'imprint.html'));
    assert.equal(html.status, 'ok');
    assert.match(String(html.text || ''), /IMPRINT/);
    assert.doesNotMatch(String(html.text || ''), /<script/i);
    const csv = await extractFile(path.join(root, 'sample.csv'));
    assert.equal(csv.status, 'ok');
    assert.match(String(csv.text || ''), /triage|score|example/i);
    const folder = await extractFolder(root);
    assert.ok(folder.some((o) => o.sourcePath.endsWith('imprint.html') && o.status === 'ok'));
    assert.ok(folder.some((o) => o.sourcePath.endsWith('sample.csv') && o.status === 'ok'));
    assert.ok(!folder.some((o) => /node_modules/.test(o.sourcePath)));
  });

  it('材料简报含授权路径、清单、摘录与完整性', async () => {
    const root = await tempDir('brief');
    await writeImprintLikeFixture(root);
    const brief = await buildConverseMaterialBrief({
      contextRefs: [{ kind: 'folder', path: root, projectOrigin: 'user_selected' }],
      goal: '提出项目优化升级方案，待批准后实施。',
    });
    assert.ok(brief.authorizedPaths.includes(root));
    assert.ok(brief.items.some((i) => i.displayName === 'imprint.html' && i.usedChars > 0));
    assert.ok(brief.items.some((i) => i.displayName === 'sample.csv' && i.usedChars > 0));
    assert.match(brief.promptBlock, /已授权材料/);
    assert.match(brief.promptBlock, /完整阅读|部分阅读/);
    assert.match(brief.promptBlock, /imprint\.html|sample\.csv|IMPRINT-PROJECT/);
  });

  it('buildConverseMessages 注入材料后禁止模型装瞎的合同上下文', () => {
    const messages = buildConverseMessages({
      goal: '提出项目优化升级方案，待批准后实施。',
      facts: { stageLabel: '等待开始', hasArtifact: false, jobRunning: false },
      recentTurns: [],
      userText: '你先了解项目。',
      materialBrief: '【已授权材料】\n- 授权路径：D:\\Projects\\IMPRINT\n【材料清单】\n- imprint.html（完整阅读）',
    });
    const blob = messages.map((m) => m.content).join('\n');
    assert.match(blob, /已授权材料/);
    assert.match(blob, /imprint\.html/);
    assert.match(messages[0]!.content, /禁止声称.*无法访问|无法读取本地文件夹/);
    assert.match(messages[0]!.content, /executionIntentKind|expectedOutputFamily/);
  });

  it('校验配对：枚举与配对通过；错配/缺字段失败；不读目标正文', () => {
    assert.deepEqual(
      validateConfirmedPlanExecutionIntent({
        executionIntentKind: 'modify_code',
        expectedOutputFamily: 'code-change',
      }),
      { intentKind: 'modify_code', expectedOutputFamily: 'code-change' },
    );
    assert.deepEqual(
      validateConfirmedPlanExecutionIntent({
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      }),
      { intentKind: 'create_document', expectedOutputFamily: 'document' },
    );
    assert.equal(
      validateConfirmedPlanExecutionIntent({
        executionIntentKind: 'modify_code',
        expectedOutputFamily: 'document',
      }),
      null,
    );
    assert.equal(validateConfirmedPlanExecutionIntent({}), null);
    assert.equal(
      validateConfirmedPlanExecutionIntent({
        executionIntentKind: 'general',
        expectedOutputFamily: 'document',
      }),
      null,
    );
  });

  it('无关键词路由：生产代码不得再按目标/规划正则决定最终能力', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const briefSrc = await fs.readFile(
      path.join(repoRoot, 'src/work-runtime/converse-material-brief.ts'),
      'utf8',
    );
    assert.doesNotMatch(briefSrc, /resolveConfirmedPlanExecutionIntent/);
    assert.doesNotMatch(briefSrc, /待批准后实施|只输出一份综述|wantsModify|reportOnly/);
    const converseSrc = await fs.readFile(
      path.join(repoRoot, 'src/work-runtime/work-converse.ts'),
      'utf8',
    );
    assert.match(converseSrc, /validateConfirmedPlanExecutionIntent/);
    assert.doesNotMatch(converseSrc, /resolveConfirmedPlanExecutionIntent/);
  });

  it('首轮 firstTurn 不得 startAuthorized（确认前零 Job）', () => {
    const d = decideConverseEffects({
      parsed: {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '开始。',
        planUpdate: '目标：方案\n交付：文档',
      },
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: false,
      firstTurn: true,
      userText: '提出项目优化升级方案，待批准后实施。',
    });
    assert.equal(d.startAuthorized, false);
  });

  it('产品主链仍阻断自动修订', () => {
    assert.equal(productMainChainBlocksAutoRevision(), true);
  });

  it('多种实施表达 → Coding；只分析不改文件 → 文档；含优化实施但明确不改 → 文档', async () => {
    const cases: Array<{
      id: string;
      goal: string;
      modelKind: 'modify_code' | 'create_document';
      modelFamily: 'code-change' | 'document';
      expectCap: 'coding' | 'document';
    }> = [
      {
        id: 'zh-impl',
        goal: '提出项目优化升级方案，待批准后实施。',
        modelKind: 'modify_code',
        modelFamily: 'code-change',
        expectCap: 'coding',
      },
      {
        id: 'en-impl',
        goal: 'Please implement the approved upgrade plan in the project files.',
        modelKind: 'modify_code',
        modelFamily: 'code-change',
        expectCap: 'coding',
      },
      {
        id: 'ship-it',
        goal: 'Apply the changes to the codebase and run tests.',
        modelKind: 'modify_code',
        modelFamily: 'code-change',
        expectCap: 'coding',
      },
      {
        id: 'report-only',
        goal: '只分析这个项目并写一份评估报告，暂不修改任何文件。',
        modelKind: 'create_document',
        modelFamily: 'document',
        expectCap: 'document',
      },
      {
        id: 'opt-no-edit',
        goal: '请给出优化与实施建议，但本轮只写报告，明确不修改项目文件。',
        modelKind: 'create_document',
        modelFamily: 'document',
        expectCap: 'document',
      },
    ];

    for (const c of cases) {
      const root = await tempDir(`route-${c.id}`);
      const pkgDir = path.join(root, 'pkg');
      const project = path.join(root, 'project');
      await writeImprintLikeFixture(project);
      let codingHits = 0;
      let docHits = 0;
      const converse = async ({ messages }: { messages: ChatMessage[] }) => {
        const userBlob = String(messages.find((m) => m.role === 'user')?.content || '');
        const latest = String(userBlob.split('【用户最新输入】').pop() || '').trim();
        if (latest === c.goal) {
          return {
            text: JSON.stringify({
              intent: 'add_goal_info',
              confidence: 0.95,
              reply: '规划已整理，确认后开始。',
              planUpdate: `目标：${c.goal}\n交付：按确认方案执行\n边界：按用户意图`,
            }),
          };
        }
        return {
          text: JSON.stringify({
            intent: 'confirm_start',
            confidence: 0.95,
            reply: '好，按确认方案开始。',
            executionIntentKind: c.modelKind,
            expectedOutputFamily: c.modelFamily,
          }),
        };
      };
      const runtime = createDigitalMeRuntime({
        documentCapability: 'fake',
        registerOpenAiStub: false,
        converseChat: converse,
        fakeAdapter: {
          text: `DOC-${c.id}`,
          title: 'report',
          onExecute: () => {
            docHits += 1;
          },
        },
        externalExecutorCapability: {
          forceAvailability: 'ready',
          executeHook: async () => {
            codingHits += 1;
            await fs.writeFile(path.join(project, `hit-${c.id}.txt`), 'ok\n', 'utf8');
            return {
              exitCode: 0,
              summary: `coded ${c.id}`,
              changedFiles: [`hit-${c.id}.txt`],
              unifiedDiff:
                `diff --git a/hit-${c.id}.txt b/hit-${c.id}.txt\n` +
                `new file mode 100644\n` +
                `--- /dev/null\n` +
                `+++ b/hit-${c.id}.txt\n` +
                `@@ -0,0 +1 @@\n` +
                `+ok\n`,
            };
          },
        },
      });
      const bus = createCommandBus(runtime);
      await bus.invoke('subject.createPackage', {
        displayName: `32 ${c.id}`,
        targetDir: pkgDir,
      });
      const first = await bus.invoke('work.converse', {
        text: c.goal,
        contextRefs: [{ kind: 'folder', path: project, projectOrigin: 'user_selected' }],
      });
      assert.equal(first.startAuthorized, false, c.id);
      assert.equal((await runtime.workRuntime.listJobsForTask(first.taskId)).length, 0, c.id);
      const confirm = await bus.invoke('work.converse', {
        taskId: first.taskId,
        text: '按这个方案开始。',
      });
      assert.equal(confirm.startAuthorized, true, c.id);
      assert.equal(confirm.executionIntentKind, c.modelKind, c.id);
      assert.equal(confirm.executionRequestedArtifactType, c.modelFamily, c.id);
      const submitted = await bus.invoke('work.submitTask', {
        goal: c.goal,
        contextRefs: [{ kind: 'folder', path: project, projectOrigin: 'user_selected' }],
        existingTaskId: first.taskId,
        confirmedPlanVersion: confirm.plan?.version || first.plan?.version || 1,
        intentKind: c.modelKind,
        requestedArtifactType: c.modelFamily,
        ...(c.expectCap === 'coding'
          ? {
              executionAuthorization: {
                confirmed: true,
                workingDirectory: project,
                readScope: ['.'],
                writeScope: ['.'],
              },
            }
          : {}),
      });
      assert.ok(submitted.jobId, c.id);
      await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
      const jobs = await runtime.workRuntime.listJobsForTask(first.taskId);
      assert.equal(jobs.length, 1, c.id);
      const capId = String(jobs[0]!.capabilityId || '');
      if (c.expectCap === 'coding') {
        assert.match(capId, /external_executor|codex/i, c.id);
        assert.equal(codingHits, 1, c.id);
        assert.equal(docHits, 0, c.id);
      } else {
        assert.doesNotMatch(capId, /external_executor|codex/i, c.id);
        assert.ok(docHits >= 1, c.id);
        assert.equal(codingHits, 0, c.id);
        assert.equal(jobs[0]!.status, 'succeeded', c.id);
      }
      await runtime.stop();
    }
  });

  it('确认缺执行族：repair 一次仍失败 → 零 Job + 可重试说明；不得静默猜成 Coding', async () => {
    const root = await tempDir('route-fail');
    const pkgDir = path.join(root, 'pkg');
    const project = path.join(root, 'project');
    await writeImprintLikeFixture(project);
    let chatCalls = 0;
    const converse = async ({ messages }: { messages: ChatMessage[] }) => {
      chatCalls += 1;
      const userBlob = String(messages.find((m) => m.role === 'user')?.content || '');
      const latest = String(userBlob.split('【用户最新输入】').pop() || '').trim();
      if (/提出项目优化/.test(latest)) {
        return {
          text: JSON.stringify({
            intent: 'add_goal_info',
            confidence: 0.95,
            reply: '规划已整理。',
            planUpdate: '目标：优化并实施\n交付：改项目\n边界：不推送',
          }),
        };
      }
      return {
        text: JSON.stringify({
          intent: 'confirm_start',
          confidence: 0.95,
          reply: '开始。',
        }),
      };
    };
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      converseChat: converse,
      fakeAdapter: { text: '不应创建', title: 'doc' },
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => {
          throw new Error('must not start coding job');
        },
      },
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', {
      displayName: '32 fail',
      targetDir: pkgDir,
    });
    const first = await bus.invoke('work.converse', {
      text: '提出项目优化升级方案，待批准后实施。',
      contextRefs: [{ kind: 'folder', path: project, projectOrigin: 'user_selected' }],
    });
    const confirm = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '按这个方案开始。',
    });
    assert.equal(confirm.startAuthorized, false);
    assert.equal(confirm.degraded, true);
    assert.match(String(confirm.reply || ''), new RegExp(CONVERSE_EXECUTION_ROUTE_FAILED_NOTICE.slice(0, 12)));
    assert.equal((await runtime.workRuntime.listJobsForTask(first.taskId)).length, 0);
    assert.ok(chatCalls >= 3, '首轮 + confirm + 一次 repair');
    assert.equal(confirm.executionIntentKind, undefined);
    await runtime.stop();
  });

  it('UI 文件夹落盘后后续 converse 仍能获得材料；确认前零 Job；确认后按模型执行族走 Coding', async () => {
    const root = await tempDir('loop');
    const pkgDir = path.join(root, 'pkg');
    const project = path.join(root, 'project');
    await writeImprintLikeFixture(project);

    const captured: string[] = [];
    const converse = async ({ messages }: { messages: ChatMessage[] }) => {
      const userBlob = String(messages.find((m) => m.role === 'user')?.content || '');
      captured.push(userBlob);
      const latest = String(userBlob.split('【用户最新输入】').pop() || '').trim();
      if (/提出项目优化升级方案/.test(latest)) {
        return {
          text: JSON.stringify({
            intent: 'add_goal_info',
            confidence: 0.95,
            reply: '已阅读 IMPRINT 相关材料，整理了优化实施方案，请确认后开始修改项目。',
            planUpdate: [
              '目标：提出并实施 IMPRINT 优化升级方案',
              '交付：按方案修改项目文件，完成效率优化相关改动',
              '路径：1. 基于已读材料分析；2. 批准后实施效率优化改动',
              '准备：已授权项目文件夹',
              '边界：不提交、不推送；仅在授权项目内修改',
            ].join('\n'),
          }),
        };
      }
      if (/了解项目/.test(latest)) {
        return {
          text: JSON.stringify({
            intent: 'discuss_or_question',
            confidence: 0.9,
            reply: '根据已读的 imprint.html 与 CSV，这是本地分拣工作台；建议先做效率优化。',
          }),
        };
      }
      return {
        text: JSON.stringify({
          intent: 'confirm_start',
          confidence: 0.95,
          reply: '好，按确认方案开始实施。',
          executionIntentKind: 'modify_code',
          expectedOutputFamily: 'code-change',
        }),
      };
    };

    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      converseChat: converse,
      fakeAdapter: { text: '不应走文档能力正文', title: 'doc' },
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async ({ pkg, prompt, workDir }) => {
          assert.match(String(pkg.goal || ''), /优化升级/);
          assert.match(String(prompt || ''), /效率优化|修改项目|确认/);
          assert.ok(workDir.includes('project') || workDir.length > 0);
          await fs.writeFile(path.join(project, 'efficiency-note.txt'), 'optimized\n', 'utf8');
          return {
            exitCode: 0,
            summary: '已写入 efficiency-note.txt',
            changedFiles: ['efficiency-note.txt'],
            unifiedDiff:
              'diff --git a/efficiency-note.txt b/efficiency-note.txt\n+optimized\n',
          };
        },
      },
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', {
      displayName: '32 主体',
      targetDir: pkgDir,
    });

    const first = await bus.invoke('work.converse', {
      text: '提出项目优化升级方案，待批准后实施。',
      contextRefs: [{ kind: 'folder', path: project, projectOrigin: 'user_selected' }],
    });
    assert.equal(first.createdTask, true);
    assert.equal(first.startAuthorized, false);
    assert.match(captured[0] || '', /已授权材料|imprint\.html|sample\.csv|IMPRINT-PROJECT/i);
    assert.doesNotMatch(captured[0] || '', /永远无法访问/);
    const jobsAfterPlan = await runtime.workRuntime.listJobsForTask(first.taskId);
    assert.equal(jobsAfterPlan.length, 0, '确认前必须零 Job');

    const ask = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '你先了解项目。',
    });
    assert.equal(ask.startAuthorized, false);
    assert.match(captured[1] || '', /已授权材料|imprint\.html|IMPRINT/i);

    const confirm = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '按这个方案开始。',
    });
    assert.equal(confirm.startAuthorized, true);
    assert.equal(confirm.executionIntentKind, 'modify_code');
    assert.equal(confirm.executionRequestedArtifactType, 'code-change');

    const folderRef = { kind: 'folder' as const, path: project, projectOrigin: 'user_selected' as const };
    const submitted = await bus.invoke('work.submitTask', {
      goal: '提出项目优化升级方案，待批准后实施。',
      contextRefs: [folderRef],
      existingTaskId: first.taskId,
      confirmedPlanVersion: confirm.plan?.version || first.plan?.version || 1,
      intentKind: 'modify_code',
      requestedArtifactType: 'code-change',
      executionAuthorization: {
        confirmed: true,
        workingDirectory: project,
        readScope: ['.'],
        writeScope: ['.'],
      },
    });
    assert.ok(submitted.jobId);
    await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    const jobs = await runtime.workRuntime.listJobsForTask(first.taskId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.status, 'succeeded');
    const note = await fs.readFile(path.join(project, 'efficiency-note.txt'), 'utf8');
    assert.match(note, /optimized/);
    await runtime.stop();
  });

  it('未授权路径不得进入材料简报', async () => {
    const allowed = await tempDir('allow');
    const forbidden = await tempDir('deny');
    await fs.writeFile(path.join(allowed, 'ok.md'), 'allowed text', 'utf8');
    await fs.writeFile(path.join(forbidden, 'secret.md'), 'should not appear', 'utf8');
    const brief = await buildConverseMaterialBrief({
      contextRefs: [{ kind: 'folder', path: allowed }],
      goal: '读材料',
    });
    assert.ok(brief.items.every((i) => i.sourcePath.startsWith(allowed)));
    assert.ok(!brief.promptBlock.includes('should not appear'));
    assert.ok(!brief.promptBlock.includes(forbidden));
  });
});
