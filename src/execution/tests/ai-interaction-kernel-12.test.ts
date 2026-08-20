/**
 * 2DIGIME-BUILD-01-D11-A-AI-INTERACTION-KERNEL-12
 * 渲染层接线回归（只读源码断言，不启动 Electron）：
 * - 自然语言一律先经 work.converse（AI 理解后回应），不做本地关键词路由；
 * - 明确按钮走确定性路径（work.submitTask / 采用确认），不调模型解释按钮；
 * - 对话从 Task.meta.conversation 水合，重启可恢复；
 * - 确定性开始经 existingTaskId 复用同一 Task。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

describe('D11-A 渲染层接线', () => {
  it('自然语言输入调用 work.converse；关键词路由已移除', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const convJs = await fs.readFile(
      path.join(root, 'electron/renderer/work-conversation.js'),
      'utf8',
    );
    assert.match(appJs, /invoke\("work\.converse"/);
    assert.ok(!appJs.includes('routeWorkNaturalLanguage('));
    assert.ok(!convJs.includes('function routeWorkNaturalLanguage'));
    // 降级/澄清时不触发任何执行入口
    assert.match(appJs, /if \(res\.degraded \|\| res\.needsClarification\)/);
  });

  it('对话从 Task.meta.conversation 水合；确定性开始复用同一 Task', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /function hydrateConversationFromTask/);
    assert.match(appJs, /meta\.conversation/);
    assert.match(appJs, /persistedConversationTurns\.concat\(workExtraTurns\)/);
    assert.match(appJs, /existingTaskId/);
    assert.match(appJs, /function startConversationTaskExecution/);
  });

  it('主进程暴露 work.converse；命令面登记一致', async () => {
    const mainCjs = await fs.readFile(path.join(root, 'electron/main.cjs'), 'utf8');
    assert.match(mainCjs, /"work\.converse"/);
  });

  it('确定性效果只经既有路径：对话中明确接受则直接结束成果、暂停走既有暂停态', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /res\.adoptRequested/);
    assert.match(appJs, /submitArtifactDecision\("accept", \{ forceAdopt: true \}\)/);
    assert.match(appJs, /res\.pauseRequested/);
    assert.match(appJs, /res\.startAuthorized/);
  });
});
