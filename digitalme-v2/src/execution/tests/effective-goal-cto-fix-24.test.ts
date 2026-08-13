/**
 * 2DIGIME-BUILD-01-EFFECTIVE-GOAL-CTO-FIX-24
 * 当前 Job 有效目标即时派生；CTO 证据包以本轮目标为准；parsed=null 零执行。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { deriveJobEffectiveGoal } from '../effective-goal';
import { buildAiCtoEvidencePack } from '../ai-cto-review';
import { decideConverseEffects, CONVERSE_PLAN_FAILED_NOTICE, runWorkConverse } from '../../work-runtime/work-converse';
import type { Task, TaskPlan } from '../../work-runtime/task';

const root = path.resolve(__dirname, '../../..');

describe('effective-goal-cto-fix-24', () => {
  it('首次 Job：effective goal = Task.goal，不另起事实源', () => {
    const g = deriveJobEffectiveGoal({
      taskGoal: '使 start 返回 start-processing，并运行测试',
      confirmedPlan: '交付：start → start-processing\n路径：改 formatLabel 并跑测试',
    });
    assert.equal(g.currentRoundAuthority, 'initial_task');
    assert.equal(g.acceptanceTarget, '使 start 返回 start-processing，并运行测试');
    assert.equal(g.originalTaskGoal, g.acceptanceTarget);
    assert.equal(g.revisionRequest, undefined);
    assert.match(String(g.background || ''), /start-processing/);
  });

  it('修订 Job：revisionRequest 为本轮权威；Task.goal 仅作背景', () => {
    const original = '使 start 返回 start-processing，并运行测试';
    const revision = '按你说的改吧：把 start 的返回值改成 done，并同步测试。';
    const g = deriveJobEffectiveGoal({
      taskGoal: original,
      confirmedPlan: '交付：start → start-processing',
      revisionRequest: revision,
      currentPlan: '本轮把返回值改为 done，并同步测试',
    });
    assert.equal(g.currentRoundAuthority, 'owner_revision');
    assert.equal(g.acceptanceTarget, revision);
    assert.equal(g.originalTaskGoal, original);
    assert.equal(g.revisionRequest, revision);
    assert.match(String(g.background || ''), /不是本轮验收标准/);
    assert.match(String(g.background || ''), /start-processing/);
    assert.match(String(g.background || ''), /改为 done/);
    assert.notEqual(g.acceptanceTarget, original);
  });

  it('CTO 证据包 goal 是本轮目标，不得把已被替代的 Task.goal 当 goal', () => {
    const revision = '把 start 的返回值改成 done，并同步测试';
    const pack = buildAiCtoEvidencePack({
      userGoal: revision,
      originalTaskGoal: '使 start 返回 start-processing',
      revisionRequest: revision,
      currentRoundAuthority: 'owner_revision',
      understandingBrief: '最初目标（仅作背景，不是本轮验收标准）：使 start 返回 start-processing',
      planSteps: ['按本轮要求把返回值改为 done', '同步测试'],
      verification: {
        overall: 'satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件变化', verdict: 'satisfied', detail: '1 个文件' },
          { id: 'tests_passed', title: '测试', verdict: 'satisfied', detail: '通过' },
        ],
      },
      changedFileCount: 1,
      changedFiles: ['formatLabel.js'],
    });
    assert.equal(pack.goal, revision);
    assert.equal(pack.currentRoundAuthority, 'owner_revision');
    assert.equal(pack.revisionRequest, revision);
    assert.equal(pack.originalTaskGoal, '使 start 返回 start-processing');
    assert.notEqual(pack.goal, pack.originalTaskGoal);
    assert.match(String(pack.understanding || ''), /不是本轮验收标准/);
  });

  it('parsed=null + 关键词「改成」不得授权 revision；零执行', () => {
    const d = decideConverseEffects({
      parsed: null,
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '按你说的改吧：把 start 的返回值改成 done，并同步测试。',
    });
    assert.equal(d.startAuthorized, false);
    assert.equal(d.startMode, undefined);
    assert.equal(d.degraded, true);
    assert.equal(d.reply, CONVERSE_PLAN_FAILED_NOTICE);
    assert.match(d.reply, /理解或规划生成失败/);
  });

  it('模型合同失败：一次 repair 仍失败则零 Job，保留原文与 Task', async () => {
    let chatCalls = 0;
    const task: Task = {
      id: 'task_fix24',
      subjectId: 'sub',
      goal: '使 start 返回 start-processing',
      createdAt: '2026-08-13T00:00:00.000Z',
      requestedArtifactType: 'code-change',
      contextRefs: [],
      meta: {
        plan: {
          version: 2,
          status: 'confirmed',
          content: '交付：start-processing',
          updatedAt: '2026-08-13T00:00:00.000Z',
          source: 'model',
        } as TaskPlan,
        conversation: { turns: [], intents: [] },
      },
    };
    const res = await runWorkConverse(
      {
        chat: async () => {
          chatCalls += 1;
          return { text: 'not-a-json-contract<<<' };
        },
        getTask: async () => task,
        createTask: async () => task,
        appendConversation: async (_id, input) => {
          task.meta = {
            ...task.meta,
            conversation: {
              turns: [...(task.meta?.conversation?.turns || []), ...input.turns],
              intents: [
                ...(task.meta?.conversation?.intents || []),
                ...(input.intents || []),
              ],
            },
          };
          return task;
        },
        updatePlan: async (_id, plan) => {
          task.meta = { ...task.meta, plan };
          return task;
        },
        getTaskFacts: async () => ({
          stageLabel: '待你决定',
          hasArtifact: true,
          jobRunning: false,
          latestJobStatus: 'succeeded',
        }),
      },
      { taskId: task.id, text: '按你说的改吧：把 start 的返回值改成 done，并同步测试。' },
    );
    assert.equal(chatCalls, 2);
    assert.equal(res.startAuthorized, false);
    assert.equal(res.degraded, true);
    assert.equal(res.reply, CONVERSE_PLAN_FAILED_NOTICE);
    assert.equal(task.goal, '使 start 返回 start-processing');
    const userTurn = (task.meta?.conversation?.turns || []).find((t) => t.role === 'user');
    assert.match(String(userTurn?.content || ''), /改成 done/);
  });

  it('源码：CTO 组装使用派生有效目标；不覆盖 Task.goal；无 parsed=null 关键词执行', async () => {
    const workspace = await fs.readFile(path.join(root, 'src/artifact-workspace/workspace.ts'), 'utf8');
    const converse = await fs.readFile(path.join(root, 'src/work-runtime/work-converse.ts'), 'utf8');
    const runner = await fs.readFile(path.join(root, 'src/work-runtime/job-runner.ts'), 'utf8');
    assert.match(workspace, /deriveJobEffectiveGoal/);
    assert.match(workspace, /acceptanceTarget/);
    assert.match(workspace, /currentRoundAuthority/);
    assert.doesNotMatch(runner, /task\.goal\s*=/);
    assert.doesNotMatch(
      converse,
      /parsed[\s\S]{0,200}isClearOwnerDirectedRevision[\s\S]{0,200}startAuthorized:\s*true/,
    );
  });
});
