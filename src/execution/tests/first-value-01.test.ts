/**
 * DIGITALME-FIRST-VALUE-01 — 首次价值：新用户尽快获得第一项真实结果。
 *
 * 验证三场景（runtime 级，真实命令路径）：
 *   CASE A 全新 + 已有可用模型 → 进入 → 目标 → 结果。
 *   CASE B 全新 + 无模型 → 仍可进入产品、不出现技术错误 → 连接后原目标续接、不重新输入。
 *   CASE C 连接失败 → 用户可理解信息、产品其它部分仍可用。
 *
 * 指标：time_to_main / steps_before_first_goal / goal_reentry_required / technical_fields_exposed。
 * 0 新增 Store / 0 schema 扩展。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { OPENAI_COMPATIBLE_CAPABILITY_ID } from '../../capability/adapters/openai-compatible';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-firstvalue-${prefix}-`));
}

function converseHook(text: string) {
  return async () => ({
    text: JSON.stringify({
      intent: 'add_goal_info',
      confidence: 0.95,
      reply: '已理解目标，准备好开始。',
      planUpdate:
        '目标：完成这项任务\n交付：形成一份可用的成果\n路径：在确认范围内完成\n边界：不提交、不推送、不发布',
    }),
  });
}

function ctoHook() {
  return async () => ({
    text: JSON.stringify({
      decision: 'meets_plan',
      canUse: '可以按当前成果使用。',
      goalAttained: '本轮目标已达成。',
      needChange: '不需要额外修改。',
      risks: [],
      nextStep: '可以采用当前成果。',
      userSummary: '成果已完成并通过验收。',
      completed: ['已形成成果'],
      gaps: [],
      evidenceRefs: [],
      nextAction: 'confirm_adopt',
      revisionPlan: '',
    }),
  });
}

const FORBIDDEN_TECH = /401|quota|baseUrl|adapter|OpenAI-compatible|model gateway|HTTP|stack|MODEL_NOT_CONFIGURED|fetch failed|ECONNREFUSED/i;

test('FIRST-VALUE CASE A: 全新安装 + 已有可用模型 → 极简进入 → 第一项真实结果', async () => {
  const root = await tempDir('caseA');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    converseChat: converseHook('已理解目标'),
    ctoReviewChat: ctoHook() as never,
  });
  const pkgDir = path.join(root, 'pkg');
  const t0 = Date.now();
  try {
    await runtime.createPackage({ displayName: '新用户', targetDir: pkgDir });
    const timeToMain = Date.now() - t0;

    // 进入主界面：不要求模型设置。
    const overview = await runtime.getOverview();
    assert.ok(overview.displayName, '进入主界面');

    // 目标 → 对话 → 确认规划 → 执行 → 结果。
    const converse = await runtime.converse({
      text: '根据下面这份材料写一份简洁的产品要点摘要。',
      contextRefs: [],
    });
    assert.ok(converse.taskId);
    assert.equal(converse.degraded, false, '有模型时不降级');

    const submitted = await runtime.submitTask({
      goal: '根据下面这份材料写一份简洁的产品要点摘要。',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: converse.taskId,
      confirmedPlanVersion: converse.plan!.version,
    });
    assert.ok(submitted.taskId && submitted.jobId);
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 60_000);
    assert.equal(job.status, 'succeeded');
    assert.ok(job.artifactId, '第一项真实结果（成果）产生');

    const content = await runtime.getContent({ artifactId: job.artifactId });
    assert.ok((content.text || '').length >= 20, '成果有正文');

    // 指标记录。
    assert.ok(timeToMain < 30_000, `进入主界面 < 30s（实际 ${timeToMain}ms）`);
  } finally {
    await runtime.stop();
  }
});

test('FIRST-VALUE CASE B: 全新安装 + 无模型 → 可进入产品 → 连接后原目标续接', async () => {
  const root = await tempDir('caseB');
  const pkgDir = path.join(root, 'pkg');

  // 阶段1：无模型。
  const noModel = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
  await noModel.createPackage({ displayName: '新用户', targetDir: pkgDir });
  try {
    // 进入主界面正常。
    const overview = await noModel.getOverview();
    assert.ok(overview.displayName, '无模型也能进入主界面');

    // 输入目标：任务被创建并保存（不丢失）。
    const converse = await noModel.converse({
      text: '把这份材料整理成一段市场要点。',
      contextRefs: [],
    });
    assert.ok(converse.taskId, '无模型时目标仍被记录为任务');
    assert.equal(converse.degraded, true, '无模型时明确降级（不伪装可用）');
    assert.ok(!FORBIDDEN_TECH.test(converse.reply), '降级文案不暴露技术字段');

    // 用户能做的其它事不受影响：看数字之我、导入资料入口仍可用。
    const subjects = await noModel.subject.listGrowthEvents();
    assert.ok(Array.isArray(subjects), '数字之我面板可用');
    await noModel.stop();
  } finally {
    await noModel.stop().catch(() => undefined);
  }

  // 阶段2：连接模型后重开同一主体包，原目标续接。
  const connected = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    converseChat: converseHook('已连接'),
    ctoReviewChat: ctoHook() as never,
  });
  await connected.openPackage({ dir: pkgDir });
  try {
    // 原任务仍在。
    const tasks = await connected.listTasks();
    assert.ok((tasks.tasks || []).length >= 1, '连接后原任务仍在');
    const resumed = (tasks.tasks || []).find((t) => /市场要点/.test(t.goal || ''));
    assert.ok(resumed, '原目标在连接后仍可找到（无需重新输入）');

    // 继续原任务 → 得到真实结果。
    const submitted = await connected.submitTask({
      goal: resumed!.goal,
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: resumed!.taskId,
    });
    assert.ok(submitted.taskId && submitted.jobId);
    const job = await waitForJobTerminal(connected.workRuntime, submitted.jobId, 60_000);
    assert.equal(job.status, 'succeeded');
    assert.ok(job.artifactId, '续接后得到真实结果');
    const content = await connected.getContent({ artifactId: job.artifactId });
    assert.ok((content.text || '').length >= 20);
  } finally {
    await connected.stop();
  }
});

test('FIRST-VALUE CASE C: 连接失败 → 可理解信息 + 产品其余部分可用', async () => {
  const root = await tempDir('caseC');
  const runtime = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
  const pkgDir = path.join(root, 'pkg');
  await runtime.createPackage({ displayName: '新用户', targetDir: pkgDir });
  try {
    // 连接失败 = 仍无模型：触发需要模型的动作时，得到可理解信息，而非技术错误。
    const converse = await runtime.converse({ text: '请分析这份材料。', contextRefs: [] });
    assert.equal(converse.degraded, true);
    assert.ok(!FORBIDDEN_TECH.test(converse.reply), '失败信息不暴露技术字段');
    assert.ok(!/MODEL_NOT_CONFIGURED|Error:|at \w+/.test(converse.reply), '无内部错误堆栈');

    // 产品其它部分仍可用：主界面、数字之我、资料导入入口。
    const overview = await runtime.getOverview();
    assert.ok(overview.displayName);
    const events = await runtime.subject.listGrowthEvents();
    assert.ok(Array.isArray(events));
    const materials = await runtime.subject.listSubjectMaterials();
    assert.ok(Array.isArray(materials));

    // 可以重试 / 稍后：目标被保留，可再发起。
    const again = await runtime.converse({ text: '请分析这份材料。', contextRefs: [] });
    assert.ok(again.taskId, '重试仍记录目标');
  } finally {
    await runtime.stop();
  }
});

test('FIRST-VALUE metrics: 目标续接无需重新输入 + 默认不暴露技术字段', async () => {
  const root = await tempDir('metrics');
  const pkgDir = path.join(root, 'pkg');
  const noModel = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
  await noModel.createPackage({ displayName: '新用户', targetDir: pkgDir });
  let goalReentryRequired = true;
  let technicalFieldsExposed = 0;
  try {
    const converse = await noModel.converse({ text: '把材料整理成摘要。', contextRefs: [] });
    const firstTaskId = converse.taskId;
    const reply = String(converse.reply || '');
    technicalFieldsExposed += FORBIDDEN_TECH.test(reply) ? 1 : 0;
    await noModel.stop();

    const connected = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      converseChat: converseHook('已连接'),
      ctoReviewChat: ctoHook() as never,
    });
    await connected.openPackage({ dir: pkgDir });
    const tasks = await connected.listTasks();
    const resumed = (tasks.tasks || []).find((t) => t.taskId === firstTaskId);
    // 连接后使用同一 taskId（同一目标），无需用户重新输入。
    if (resumed) {
      goalReentryRequired = false;
      await connected.submitTask({
        goal: resumed.goal,
        contextRefs: [],
        requestedArtifactType: 'document',
        existingTaskId: resumed.taskId,
      });
    }
    await connected.stop();
  } finally {
    await noModel.stop().catch(() => undefined);
  }
  assert.equal(goalReentryRequired, false, 'goal_reentry_required = false');
  assert.equal(technicalFieldsExposed, 0, 'technical_fields_exposed_default = 0');
});

test('FIRST-VALUE renderer: 首次面「我能帮你做什么」存在；默认不暴露技术字段；连接入口轻量', async () => {
  const rendererDir = path.join(__dirname, '..', '..', '..', 'electron', 'renderer');
  const html = await fs.readFile(path.join(rendererDir, 'index.html'), 'utf8');
  const app = await fs.readFile(path.join(rendererDir, 'app.js'), 'utf8');

  // 首次价值自然起点存在。
  assert.ok(html.includes('我能帮你做什么'), '首次价值标题存在');
  assert.ok(html.includes('btn-first-chat'), '聊聊起点存在');
  assert.ok(html.includes('btn-first-material'), '交资料起点存在');
  assert.ok(html.includes('btn-first-do'), '做一件事起点存在');
  assert.ok(html.includes('btn-first-connect'), '连接 AI 能力入口存在');

  // 起点接线。
  assert.ok(app.includes('els.btnFirstChat'), '聊聊接线');
  assert.ok(app.includes('els.btnFirstMaterial'), '交资料接线');
  assert.ok(app.includes('els.btnFirstDo'), '做一件事接线');
  assert.ok(app.includes('els.btnFirstConnect'), '连接入口接线');

  // 首次面不暴露技术概念（只检查首次价值块，设置页连接表单属合理的高级面）。
  const fvStart = html.indexOf('id="first-value"');
  const fvEnd = html.indexOf('</section>', fvStart);
  const fvBlock = fvStart >= 0 && fvEnd > fvStart ? html.slice(fvStart, fvEnd) : html;
  for (const term of ['API key', 'API Key', 'base URL', 'baseUrl', 'model ID', 'model-id', 'MCP', 'adapter', 'OpenAI-compatible']) {
    assert.equal(fvBlock.includes(term), false, term);
  }
  // 连接入口指向自然语言「连接 AI 能力」，不是「配置模型」。
  assert.ok(html.includes('连接 AI 能力'), '连接文案自然化');
});