/**
 * D11-B 规划工作区：渲染层接线与行为边界回归。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tw = require('../../../electron/renderer/task-workspace.js') as {
  parsePlanSections: (c: string, goal?: string) => Record<string, string>;
  isHighRiskExecution: (
    goal: string,
    preview: { workingDirectory?: string; writeScope?: string[] },
  ) => boolean;
  renderTaskWorkspace: (input: object) => void;
  titleForMode: (mode: string) => string;
};

const root = path.resolve(__dirname, '../../..');

describe('D11-B planning workspace', () => {
  it('右栏改为任务工作区并含规划卡与开始开发', async () => {
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    assert.match(html, /id="task-workspace-title"[^>]*>任务工作区/);
    assert.match(html, /id="task-workspace-plan"/);
    assert.match(html, /id="btn-start-development"[^>]*>确认规划并开始开发/);
    assert.match(html, /id="task-workspace-prep"/);
    assert.match(html, /task-workspace\.js/);
    assert.doesNotMatch(html, /<h2>成果<\/h2>/);
    assert.doesNotMatch(html, />采用说明（可选）</);
  });

  it('中栏三步技术确认卡已从 DOM/CSS 删除，开发前准备只走右栏', async () => {
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    const css = await fs.readFile(path.join(root, 'electron/renderer/styles.css'), 'utf8');
    assert.doesNotMatch(html, /id="executor-setup-card"/);
    assert.doesNotMatch(html, /id="project-folder-card"/);
    assert.doesNotMatch(html, /id="execution-confirm-card"/);
    assert.doesNotMatch(css, /#executor-setup-card/);
    assert.doesNotMatch(css, /#project-folder-card/);
    assert.doesNotMatch(css, /#execution-confirm-card/);
    assert.match(html, /id="task-workspace-prep"/);
    assert.match(html, /id="btn-tw-create-project"/);
  });

  it('右栏含开发中面板；Job 执行后即可刷新进展', async () => {
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    assert.match(html, /id="task-workspace-running"/);
    assert.match(html, /id="tw-running-title"[^>]*>开发中/);
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(app, /showPrepBlocked/);
    assert.match(app, /deriveWorkspaceMode/);
    assert.match(app, /fromPlanConfirm && !highRisk/);
    assert.match(app, /请先在右侧确认最新规划后再开始/);
    assert.equal(app.includes('sealLegacyMidConfirmCards'), false);
    assert.equal(app.includes('非规划确认入口的遗留路径：仍自动授权'), false);
  });

  it('app.js：规划水合、确认开始、低风险自动授权、准备受阻', async () => {
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(app, /hydratePlanFromTask/);
    assert.match(app, /confirmPlanAndStartDevelopment/);
    assert.match(app, /confirmedPlanVersion/);
    assert.match(app, /fromPlanConfirm/);
    assert.match(app, /showPrepBlocked/);
    assert.match(app, /isHighRiskExecution/);
    assert.equal(app.includes('els.decisionStatus.textContent = "请确认成果"'), false);
    assert.match(app, /规划已更新，请查看右侧最新规划后再确认开始/);
  });

  it('task-workspace：解析规划栏目、高风险判定与开发中渲染', () => {
    const sections = tw.parsePlanSections(
      '目标：打飞机\n交付：网页版\n路径：先做基础版\n准备：需要项目位置\n边界：不联网',
      'fallback',
    );
    assert.equal(sections.goal, '打飞机');
    assert.equal(sections.delivery, '网页版');
    assert.equal(sections.path, '先做基础版');
    assert.equal(
      tw.isHighRiskExecution('做一个小游戏', { workingDirectory: 'D:/a', writeScope: ['D:/a'] }),
      false,
    );
    assert.equal(
      tw.isHighRiskExecution('做一个小游戏', {
        workingDirectory: 'D:\\tmp\\proj',
        writeScope: ['D:/tmp/proj'],
      }),
      false,
    );
    assert.equal(
      tw.isHighRiskExecution('删除整个项目目录', {
        workingDirectory: 'D:/a',
        writeScope: ['D:/a'],
      }),
      true,
    );
    assert.equal(typeof tw.renderTaskWorkspace, 'function');
    assert.equal(tw.titleForMode('running'), '任务工作区 · 开发中');
  });

  it('work.converse 首轮仅模型规划可见；submitTask 校验规划版本与确认门', async () => {
    const converse = await fs.readFile(
      path.join(root, 'src/work-runtime/work-converse.ts'),
      'utf8',
    );
    assert.match(converse, /seed_internal/);
    assert.match(converse, /CONVERSE_PLAN_FAILED_NOTICE/);
    const runner = await fs.readFile(path.join(root, 'src/work-runtime/job-runner.ts'), 'utf8');
    assert.match(runner, /confirmedPlanVersion/);
    assert.match(runner, /plan_version_mismatch/);
    assert.match(runner, /plan_confirmation_required/);
  });
});
