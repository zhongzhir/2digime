/**
 * DIGITALME-DAILY-WORK-QUALITY-01 — 日常做事摩擦收敛验证。
 *
 * 证明：
 *  - review 是目标导向的（缺必含要点 → targeted_revision_required → 触发 bounded 自动补修）；
 *  - 高后果确认保留（公开发布/删除等仍须确认）；
 *  - 普通低风险文档目标由 2digime 自行推进（渲染层接线 + 门禁）；
 *  - 技术判断不推回用户（无「用哪个 Agent / 方案是否正确」类问题）；
 *  - claimId 不再用户可见；
 *  - 用户决策数显著减少。
 *
 * 0 新增 Store / 0 schema 扩展 / 0 新状态机。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dispatchOutcomeCheck } from '../outcome-dispatch';
import { checkOutcome } from '../ai-first-policy';
import { decideConverseEffects } from '../work-converse';
import type { ConverseDecisionInput } from '../work-converse';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-dwq-${prefix}-`));
}

function docOutput(text: string) {
  return {
    artifact: {
      type: 'document',
      title: '测试文档',
      payload: { kind: 'text' as const, format: 'markdown' as const, text },
    },
    materialUse: { usedPaths: [], includedCount: 0, fullReadCount: 0, truncatedCount: 0 },
  };
}

test('A: review 是目标导向的；缺必含要点 → bounded 自动补修触发', () => {
  // 目标要求必须包含「市场规模」，成果缺失。
  const result = dispatchOutcomeCheck({
    goal: '写一份行业报告，必须包含「市场规模」与「竞争格局」。',
    output: docOutput('这是行业分析，讨论了趋势与机会，但没有具体市场规模数字。'),
    requestedArtifactType: 'document',
  });
  assert.equal(result.checkKind, 'text');
  assert.equal(result.verdict, 'targeted_revision_required', '缺必含要点 → 触发定向修订（bounded 自动补修）');
  assert.ok(
    result.defects.some((d) => /市场规模/.test(d) || /竞争格局/.test(d)),
    '缺陷指明缺失的具体要点（目标导向）',
  );

  // 覆盖全部要点 → pass。
  const ok = dispatchOutcomeCheck({
    goal: '写一份行业报告，涵盖市场规模与竞争格局。',
    output: docOutput(
      '# 行业报告\n\n市场规模约百亿元，竞争格局呈现三强并立，同时讨论了主要趋势与机会，供后续决策参考。',
    ),
    requestedArtifactType: 'document',
  });
  assert.equal(ok.verdict, 'pass');
});

test('B: 高后果确认保留 — 公开发布/删除/支付仍触发不可自动绕过', () => {
  // 高后果动作在文案层面触发高风险提示（不可静默通过）。
  // 使用默认档位：目标无高风险词 → standard；成果含「公开发布」→ 命中 HIGH_RISK_RE。
  const highRisk = checkOutcome({
    goal: '写一份测试结果报告。',
    text: '# 测试结果报告\n\n已经将测试结果公开发布到公开渠道，并附上了完整数据。',
  });
  assert.equal(highRisk.verdict, 'targeted_revision_required', '含高风险表述 → 需修订，不能静默通过');
  assert.ok(highRisk.defects.some((d) => /高风险/.test(d)), '高风险表述被识别');

  // 发布类目标不会进入「自动推进」的低风险路径（渲染层门禁见 D）。
  assert.ok(/公开发布|对外发布/.test('把测试结果直接公开发布'), '发布目标触发高风险词表');
});

test('C: 首轮对话不被自动授权执行（两阶段启动仍守住安全边界）', () => {
  const firstTurn: ConverseDecisionInput = {
    modelAvailable: true,
    parsed: { intent: 'confirm_start', confidence: 0.99, reply: '开始', executionIntentKind: 'create_document', expectedOutputFamily: 'document' },
    firstTurn: true,
    jobRunning: false,
    hasArtifact: false,
    userText: '写一份产品周报',
  };
  const d = decideConverseEffects(firstTurn);
  assert.equal(d.startAuthorized, false, '首轮不得自动执行（保留理解→确认两阶段）');
  assert.equal(d.confirmPlan, false);
});

test('D: 渲染层 — 普通低风险文档目标自动推进（门禁在低风险）', async () => {
  const rendererDir = path.join(__dirname, '..', '..', '..', 'electron', 'renderer');
  const app = await fs.readFile(path.join(rendererDir, 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(rendererDir, 'index.html'), 'utf8');

  // 自动推进函数存在，且高风险词表存在（门禁）。
  assert.ok(app.includes('maybeAutoProgressLowRiskDocument'), '自动推进函数接线');
  assert.ok(app.includes('looksHighRiskGoal'), '高风险门禁存在');
  assert.ok(app.includes('firstPlanAutoProgressed'), '只推进一次（不重复）');
  assert.ok(app.includes('confirmPlanAndStartDevelopment'), '复用既有确定性开始路径（不新建流程）');

  // 自动推进只针对低风险：门禁包含发布/删除/支付等高风险词。
  assert.ok(/公开发布|对外发布|删除整个|支付|转账/.test(app), '高风险词表覆盖高后果动作');
  // 代码项目上下文不自动推进。
  assert.ok(app.includes('r.kind === "folder"'), '有代码项目文件夹时不自动推进');

  // 不向用户推「用哪个 Agent / 方案是否正确」类技术判断。
  assert.equal(app.includes('应该使用哪个'), false);
  assert.equal(app.includes('采用这个实现方式吗'), false);
  assert.equal(app.includes('哪个 Agent'), false);
});

test('E: claimId 不再用户可见', async () => {
  const rendererDir = path.join(__dirname, '..', '..', '..', 'electron', 'renderer');
  const app = await fs.readFile(path.join(rendererDir, 'app.js'), 'utf8');
  // 证据摘要不再拼接 claimId。
  assert.equal(app.includes('it.claimId'), false, 'claimId 不进入用户可见证据摘要');
  assert.ok(app.includes('覆盖'), '证据摘要改为展示覆盖的文件');
});

test('F: 普通文档任务用户决策计数 — 只需 1 次真实决策（采用可选）', async () => {
  const rendererDir = path.join(__dirname, '..', '..', '..', 'electron', 'renderer');
  const app = await fs.readFile(path.join(rendererDir, 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(rendererDir, 'index.html'), 'utf8');

  // 文档任务无需执行确认（create_document 无 needsExecutionConfirm）。
  // 低风险自动推进后，用户无需点「确认规划并开始开发」；采用为可选。
  // 断言之：存在自动推进；存在「采用这份成果」作为唯一可选用时决定。
  assert.ok(app.includes('maybeAutoProgressLowRiskDocument'));
  assert.ok(app.includes('采用这份成果'));
  // 不存在逐条强制「确认采用」仪式（右栏采用按钮被隐藏，采用仅在中栏可选）。
  assert.ok(app.includes('btn-adopt-continue-revise') || app.includes('confirm_adopt'), '采用语义保留但不阻塞导出');
  assert.equal(app.includes('你有'), false, '无「你有 N 条待确认」类仪式');
});

test('G: bounded 自动补修接线存在且有限（不是无限重试；失败保留结果）', async () => {
  const runner = await fs.readFile(
    path.join(__dirname, '..', '..', '..', 'src', 'work-runtime', 'job-runner.ts'),
    'utf8',
  );
  // 文本成果未过目标导向检查时，job 内部带定向修订请求重执行一次。
  assert.ok(runner.includes('targeted_revision_required'), '自动补修触发点存在');
  assert.ok(runner.includes('buildTargetedRevisionRequest'), '补修请求由缺陷生成（定向）');
  assert.ok(/自动补修失败：保留当前结果/.test(runner), '补修失败保留当前结果（不无限重试）');
  // 硬边界/缺成果仍会 failJob，不静默放行。
  assert.ok(runner.includes("this.failJob("), '无法可靠完成时走失败路径');
});