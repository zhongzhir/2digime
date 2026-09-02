/**
 * 端到端：上传真实结构简历 → 提取姓名 → 新会话读取姓名
 * → 创建 PPT → 提出设计和 Word 修改 → 开始做吧 → revision Job → 新版本
 * → 切换任务不串导出状态（运行时任务隔离 + 渲染层按 taskId+artifactId 存储）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { buildFixtureResumeDocx } from '../../infrastructure/tests/feedback-loop-02-fixtures';
import {
  launchDigitalMeElectron,
  sendChat,
  skipWelcomeAndEnterShell,
  waitForOverviewName,
} from './electron-harness';

const ORAL = '我是张元林，我是你的主人。';
const REVISION = '整体界面太简单了，请优化设计和排版。另外再提供一份 Word 版本。';
const START = '开始做吧。';

function lastUserInput(messages: Array<{ content?: string }>): string {
  const content = String(messages[messages.length - 1]?.content || '');
  const idx = content.lastIndexOf('【用户最新输入】');
  return idx >= 0 ? content.slice(idx + '【用户最新输入】'.length).trim() : content.trim();
}

test('使用反馈（2）Electron 对话：我是张元林 → 新对话 → 印象含姓名', { timeout: 120_000 }, async () => {
  const harness = await launchDigitalMeElectron();
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await sendChat(harness.page, ORAL);
    await waitForOverviewName(harness.page, '张元林', 45_000);
    await harness.page.locator('#btn-chat-new').click();
    await harness.page.locator('#chat-status').getByText('新对话').waitFor({ state: 'visible', timeout: 10_000 });
    const afterNew = await harness.page.locator('#chat-turns').innerText();
    assert.doesNotMatch(afterNew, /我是张元林/);
    await sendChat(harness.page, '关于我，你有什么印象？');
    const shown = await harness.page.locator('.chat-turn-assistant .chat-text').last().innerText();
    assert.match(shown, /张元林/);
  } finally {
    await harness.close();
  }
});

test('使用反馈（2）主链：PPT 修订 Job 与任务隔离（运行时）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-fb02-e2e-'));
  const resumePath = path.join(dir, '简历.docx');
  await fs.writeFile(resumePath, buildFixtureResumeDocx());
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    fakeAdapter: {
      text: (input) => {
        const rev = String(input.revision?.request || '');
        if (rev) {
          return [
            '# 产品汇报 PPT（已按说明修改）',
            '',
            '已重做整体界面设计与排版，并同时提供 Word 版本。',
            '',
            `## 本轮修改要求\n${rev}`,
            '',
            '## 进展',
            '',
            '- 封面与章节页重排',
            '- 要点页与双栏对照',
            '- 结论页补充行动项',
            '',
            '## 结论',
            '',
            '- PPT 与 Word 一并交付',
          ].join('\n');
        }
        return [
          '# 产品汇报 PPT',
          '',
          '第一版。',
          '',
          '## 进展',
          '',
          '- 条目一',
          '- 条目二',
          '- 条目三',
          '- 条目四',
          '',
          '## 结论',
          '',
          '- 下一步',
        ].join('\n');
      },
    },
    converseChat: async ({ messages }) => {
      const user = lastUserInput(messages);
      if (user.includes(REVISION)) {
        return {
          text: JSON.stringify({
            intent: 'artifact_feedback',
            confidence: 0.93,
            reply: '已经加入计划。',
          }),
        };
      }
      if (user === START) {
        return {
          text: JSON.stringify({
            intent: 'confirm_start',
            confidence: 0.95,
            reply: '开始做。',
          }),
        };
      }
      return {
        text: JSON.stringify({
          intent: 'discuss_or_question',
          confidence: 0.9,
          reply: '已收到。',
          planUpdate: '目标：产品汇报\n交付：PPT\n路径：先出第一版\n准备：无\n边界：不提交',
        }),
      };
    },
  });
  await runtime.createPackage({ displayName: '闭环验收', targetDir: path.join(dir, 'pkg') });

  const imported = await runtime.importSubjectMaterial({
    sourcePath: resumePath,
    distillCandidates: true,
  });
  assert.equal(imported.readStatus, 'read');
  const overview0 = await runtime.getOverview();
  const toConfirm = [
    ...(overview0.confirmationSuggestedEventIds || []),
    ...(overview0.candidateExperiences || []).map((c) => c.eventId),
  ].filter(Boolean);
  if (toConfirm.length) await runtime.confirmExperience({ eventIds: [...new Set(toConfirm)] });

  const ppt = await runtime.submitTask({
    goal: '做一份产品汇报 PPT',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, ppt.jobId, 20_000);
  assert.equal(
    job1.status,
    'succeeded',
    JSON.stringify({
      status: job1.status,
      failure: job1.failure,
      progress: job1.progress,
      capabilityId: job1.capabilityId,
    }),
  );
  const pptDetail = await runtime.workRuntime.getTask({ taskId: ppt.taskId });
  const artifactId = pptDetail.artifactIds[0];
  assert.ok(artifactId);

  const queued = await runtime.converse({ taskId: ppt.taskId, text: REVISION });
  assert.equal(queued.startAuthorized, false);
  assert.ok(queued.pendingRevisionRequest);
  assert.equal(queued.pendingRevisionRequest?.text, REVISION);
  const pending = (await runtime.workRuntime.getTask({ taskId: ppt.taskId })).task.meta
    ?.pendingRevisionRequest;
  assert.equal(pending?.text, REVISION);

  const start = await runtime.converse({ taskId: ppt.taskId, text: START });
  assert.equal(start.startAuthorized, true);
  assert.equal(start.startMode, 'revision');
  assert.equal(start.revisionRequest, REVISION);
  const startTurnId = String(start.userTurnId || '');
  assert.ok(startTurnId);
  const revised = await runtime.reviseArtifact({
    taskId: ppt.taskId,
    artifactId,
    revisionRequest: start.revisionRequest || START,
    ownerTurnId: startTurnId,
  });
  const replay = await runtime.reviseArtifact({
    taskId: ppt.taskId,
    artifactId,
    revisionRequest: start.revisionRequest || START,
    ownerTurnId: startTurnId,
  });
  assert.equal(replay.jobId, revised.jobId);
  const job2 = await waitForJobTerminal(runtime.workRuntime, revised.jobId, 20_000);
  assert.equal(
    job2.status,
    'succeeded',
    JSON.stringify({
      status: job2.status,
      failure: job2.failure,
      progress: job2.progress,
      capabilityId: job2.capabilityId,
      revisionRequest: job2.revisionRequest,
      actionable: (job2 as { actionable?: string }).actionable,
    }),
  );
  assert.match(String(job2.revisionRequest || ''), /Word|排版|设计/);
  const pptArtifact = await runtime.workRuntime.getArtifact(artifactId);
  assert.ok((pptArtifact?.versions.length || 0) >= 2);

  const article = await runtime.submitTask({
    goal: '写一篇普通说明文章',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobB = await waitForJobTerminal(runtime.workRuntime, article.jobId, 20_000);
  assert.equal(jobB.status, 'succeeded');
  assert.notEqual(article.taskId, ppt.taskId);
  const appJs = await fs.readFile(path.join(process.cwd(), 'electron/renderer/app.js'), 'utf8');
  assert.match(appJs, /exportStateKey\(activeTaskId, activeArtifactId\)/);
  await runtime.stop();
});
