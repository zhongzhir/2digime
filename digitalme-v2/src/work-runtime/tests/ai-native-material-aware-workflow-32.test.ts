/**
 * AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32
 * 确认前材料事实进入 converse；确认后按方案选 Coding Agent。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractFile, extractFolder, SUPPORTED_EXTENSIONS } from '../../infrastructure/extract';
import {
  buildConverseMaterialBrief,
  resolveConfirmedPlanExecutionIntent,
} from '../converse-material-brief';
import { buildConverseMessages, decideConverseEffects } from '../work-converse';
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
  });

  it('确认后：实施类方案 → modify_code；纯报告 → document', () => {
    const impl = resolveConfirmedPlanExecutionIntent({
      goal: '提出项目优化升级方案，待批准后实施。',
      planContent:
        '目标：优化 IMPRINT\n交付：按方案修改项目文件\n路径：批准后实施效率优化\n边界：不推送',
      contextRefs: [{ kind: 'folder', path: 'D:\\Projects\\IMPRINT' }],
    });
    assert.equal(impl.intentKind, 'modify_code');
    assert.equal(impl.expectedOutputFamily, 'code-change');

    const report = resolveConfirmedPlanExecutionIntent({
      goal: '写一份行业综述报告',
      planContent: '目标：只输出一份综述报告文档\n交付：Markdown 报告\n边界：不修改任何项目文件',
      contextRefs: [{ kind: 'folder', path: 'D:\\Projects\\docs' }],
    });
    assert.equal(report.intentKind, 'create_document');
    assert.equal(report.expectedOutputFamily, 'document');
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

  it('UI 文件夹落盘后后续 converse 仍能获得材料；确认前零 Job；确认后按方案走 Coding', async () => {
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

    // 模拟后续 converse：不再传 contextRefs，但仍应注入 Task 落盘材料
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

    // 确定性提交（与 Renderer 一致）
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
