/**
 * 2DIGIME-AI-NATIVE-THIN-RUNTIME-26
 * 第一阶段薄主链：绕开意图枚举 / 关键词路由 / 规划升版确认链；
 * 一次确认后走代码修改；失败按真实证据说明；Owner 面不展示规划版本。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime, type DigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import { deriveWorkIntentSync } from '../work-intent';
import { runWorkConverse, type WorkConverseDeps } from '../work-converse';
import { THIN_RUNTIME_PATH } from '../thin-owner-start';
import type { Task, TaskPlan } from '../task';
import { buildAiCtoEvidencePack, buildAiDigitalMeCtoReview } from '../../execution/ai-cto-review';
import { maybeRunControlledRevisionAfterJob } from '../controlled-revision-runner';

const repoRoot = path.resolve(__dirname, '../../..');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    statusLine: string;
    stage: string;
  };
};

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-thin26-${prefix}-`));
}

async function makeSoftwareFolder(root: string): Promise<string> {
  const folder = path.join(root, 'fixture-project');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, 'package.json'),
    JSON.stringify({ name: 'fixture-project', private: true }),
    'utf8',
  );
  return folder;
}

const NL_TASKS = [
  {
    id: 'nl-no-keyword',
    text: '通读仓库文件，让 formatLabel 在输入 start 时返回 start-processing 并跑测试',
  },
  {
    id: 'nl-write-doc-shape',
    text: '给这个小项目加一个简单的帮助说明，写在 README 里',
  },
  {
    id: 'nl-explicit-change',
    text: '先看一下项目现在怎么组织的，然后把页面标题改成欢迎使用',
  },
] as const;

interface ScriptedReply {
  intent: string;
  confidence: number;
  reply: string;
  planUpdate?: string;
}

function scriptedChat(replies: ScriptedReply[]) {
  let i = 0;
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    void messages;
    const r = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return {
      text: JSON.stringify({
        intent: r.intent,
        confidence: r.confidence,
        reply: r.reply,
        ...(r.planUpdate ? { planUpdate: r.planUpdate } : {}),
      }),
    };
  };
  return { chat };
}

async function makeRuntime(
  dir: string,
  chat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    ...(chat ? { converseChat: chat } : {}),
  });
  const bus = createCommandBus(runtime);
  return { runtime, bus };
}

describe('2DIGIME-AI-NATIVE-THIN-RUNTIME-26', () => {
  it('关键词路由对无修改词目标仍判 general；薄主链不依赖该枚举', () => {
    const goal = NL_TASKS[0].text;
    const derived = deriveWorkIntentSync({
      goal,
      contextRefs: [{ kind: 'folder', path: '/tmp/fixture' }],
      materialKinds: ['folder'],
    });
    assert.notEqual(derived.intentKind, 'modify_code');
  });

  it('三个不同自然语言任务：附软件项目后均创建 thin_v1 + modify_code', async () => {
    for (const nl of NL_TASKS) {
      const root = await tempDir(nl.id);
      const folder = await makeSoftwareFolder(root);
      const { chat } = scriptedChat([
        {
          intent: 'add_goal_info',
          confidence: 0.95,
          reply: '这是当前方案，确认后开始。',
          planUpdate: `目标：${nl.text}\n交付：改好并通过检查\n路径：阅读项目后修改\n准备：已有项目位置\n边界：不提交不推送`,
        },
      ]);
      const { runtime, bus } = await makeRuntime(root, chat);
      await bus.invoke('subject.createPackage', {
        displayName: '薄主链主体',
        targetDir: path.join(root, 'pkg'),
      });
      const first = await bus.invoke('work.converse', {
        text: nl.text,
        contextRefs: [{ kind: 'folder', path: folder, projectOrigin: 'user_selected' }],
      });
      assert.equal(first.runtimePath, THIN_RUNTIME_PATH, nl.id);
      assert.equal(first.startAuthorized, false, nl.id);
      assert.equal(first.plan?.status, 'draft', nl.id);
      const detail = await runtime.getTask({ taskId: first.taskId });
      assert.equal(detail.task.meta?.runtimePath, THIN_RUNTIME_PATH, nl.id);
      assert.equal(detail.task.intentKind, 'modify_code', nl.id);
      assert.equal(detail.task.requestedArtifactType, 'code-change', nl.id);
      assert.equal(detail.latestJob, undefined, nl.id);
      await runtime.stop();
    }
  });

  it('确认开始即使附带 planUpdate 也不升版；一次确认即可提交代码修改', async () => {
    const root = await tempDir('one-confirm');
    const folder = await makeSoftwareFolder(root);
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '方案如下，请确认。',
        planUpdate:
          '目标：修 formatLabel\n交付：start 返回 start-processing\n路径：改文件并跑测试\n准备：项目已附\n边界：不提交',
      },
      {
        intent: 'confirm_start',
        confidence: 0.96,
        reply: '好，按当前方案开始。',
        planUpdate: '目标：修 formatLabel（补充说明）\n交付：同上',
      },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', {
      displayName: '一次确认主体',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', {
      text: NL_TASKS[0].text,
      contextRefs: [{ kind: 'folder', path: folder, projectOrigin: 'user_selected' }],
    });
    assert.equal(first.plan?.version, 1);
    assert.equal(first.plan?.status, 'draft');
    const confirm = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '按这个做吧，开始。',
    });
    assert.equal(confirm.startAuthorized, true);
    assert.equal(confirm.plan?.status, 'confirmed');
    assert.equal(confirm.plan?.version, 1, '不得因 planUpdate 升到 v2/v3');
    const submitted = await bus.invoke('work.submitTask', {
      goal: NL_TASKS[0].text,
      contextRefs: [],
      existingTaskId: first.taskId,
      confirmedPlanVersion: 1,
    });
    assert.equal(submitted.intentKind, 'modify_code');
    assert.equal(submitted.jobId, '');
    assert.ok(
      submitted.needsExecutionConfirm || submitted.needsExecutorSetup || submitted.needsProjectFolder,
      '薄主链确认后应进入代码执行准备/授权，而不是文档 Job',
    );
    assert.equal(await jobCount(runtime, first.taskId), 0);
    await runtime.stop();
  });

  it('失败说明根据真实证据生成，且不把触发句写成 Owner 新决策', async () => {
    const now = new Date().toISOString();
    const task: Task = {
      id: 'task_thin_fail',
      subjectId: 'sub_1',
      createdAt: now,
      goal: NL_TASKS[0].text,
      contextRefs: [{ kind: 'folder', path: '/tmp/fixture' }],
      requestedArtifactType: 'code-change',
      intentKind: 'modify_code',
      meta: { runtimePath: THIN_RUNTIME_PATH },
    };
    const evidence = '代码执行能力未能改到指定文件，测试没有跑起来。';
    const deps: WorkConverseDeps = {
      chat: null,
      getTask: async () => task,
      createTask: async () => task,
      appendConversation: async (_id, input) => {
        const prev = task.meta?.conversation ?? { turns: [], intents: [] };
        task.meta = {
          ...(task.meta ?? {}),
          conversation: {
            turns: [...prev.turns, ...input.turns],
            intents: [...prev.intents, ...(input.intents ?? [])],
          },
        };
        return task;
      },
      updatePlan: async (_id, plan: TaskPlan) => {
        task.meta = { ...(task.meta ?? {}), plan };
        return task;
      },
      getTaskFacts: async () => ({
        stageLabel: '执行失败',
        hasArtifact: false,
        jobRunning: false,
        latestJobStatus: 'failed',
        lastFailure: evidence,
      }),
    };
    const res = await runWorkConverse(deps, {
      taskId: task.id,
      text: '请根据刚才的执行结果说明原因和下一步。',
      silentOutcomeExplain: true,
    });
    assert.equal(res.startAuthorized, false);
    assert.equal(res.adoptRequested, false);
    assert.match(res.reply, /没有做成/);
    assert.match(res.reply, /未能改到指定文件/);
    assert.equal(res.newTurns.length, 1);
    assert.equal(res.newTurns[0]?.role, 'digital_me');
    assert.equal(task.meta?.conversation?.turns.some((t) => t.role === 'user'), false);
  });

  it('Owner 面三问文案：不展示规划版本、不把尚未决定当主状态', () => {
    const drafting = ux.deriveWorkUxView({
      thinRuntime: true,
      hasPlanDraft: true,
      workMode: 'task',
    });
    assert.match(drafting.statusLine, /当前方案|确认后开始/);
    assert.doesNotMatch(drafting.statusLine, /规划版本|尚未决定/);
    const review = ux.deriveWorkUxView({
      thinRuntime: true,
      hasArtifact: true,
      decisionStatus: 'undecided',
      jobStatus: 'succeeded',
      workMode: 'task',
    });
    assert.equal(review.stage, 'needs_review');
    assert.match(review.statusLine, /已经做完/);
    assert.doesNotMatch(review.statusLine, /尚未决定|规划版本/);
    const blocked = ux.deriveWorkUxView({
      thinRuntime: true,
      jobStatus: 'failed',
      workMode: 'task',
    });
    assert.match(blocked.statusLine, /没有做成/);
  });

  it('源码接线：一次确认走 fromPlanConfirm；规划版本不对 Owner 展示', async () => {
    const app = await fs.readFile(path.join(repoRoot, 'electron/renderer/app.js'), 'utf8');
    const html = await fs.readFile(path.join(repoRoot, 'electron/renderer/index.html'), 'utf8');
    const workspace = await fs.readFile(
      path.join(repoRoot, 'electron/renderer/task-workspace.js'),
      'utf8',
    );
    const converse = await fs.readFile(
      path.join(repoRoot, 'src/work-runtime/work-converse.ts'),
      'utf8',
    );
    assert.match(app, /fromPlanConfirm:\s*true/);
    // 确认后按 executionIntent 选择能力；thin 仅作兜底，不再单独决定 fromPlanConfirm。
    assert.match(app, /executionIntentKind|executionRequestedArtifactType/);
    assert.match(app, /silentOutcomeExplain: true/);
    assert.match(app, /请决定是否采用这份成果/);
    assert.match(app, /artifactExportsMore\.hidden = !hasArtifact/);
    assert.match(app, /submitWorkNaturalLanguage\("确认"\)/);
    assert.match(app, /ccAcceptanceSection\.hidden = true/);
    assert.match(app, /正在思考…/);
    assert.match(app, /function showAdoptConfirm/);
    assert.match(app, /再看看/);
    assert.doesNotMatch(app, /label \+= ` · \$\{elapsed\}`/);
    assert.doesNotMatch(app, /window\.confirm\(\s*"确认采用/);
    assert.match(html, /发送给 Digital Me/);
    assert.match(html, />导出副本</);
    assert.doesNotMatch(html, /保存副本/);
    assert.match(workspace, /thinRuntime \? '当前方案'/);
    assert.match(workspace, /确认并开始/);
    assert.match(converse, /decision\.confirmPlan && existingPlan && isUserVisiblePlan/);
    assert.match(converse, /silentOutcomeExplain/);
  });

  it('目标和测试通过时，unverifiable build 不得把 meets_plan 降成 needs_revision', async () => {
    const review = await buildAiDigitalMeCtoReview(
      {
        userGoal: '让 formatLabel 在输入 start 时返回 start-processing，并跑测试',
        changedFileCount: 1,
        changedFiles: ['formatLabel.js'],
        testResults: [{ command: 'npm test', passed: true, summary: 'ok' }],
        verification: {
          overall: 'partially_satisfied',
          digitalMeVerified: true,
          agentClaimedSuccess: true,
          checks: [
            { id: 'file_changes', title: '文件变化', verdict: 'satisfied', detail: '1 个文件' },
            { id: 'scope_boundary', title: '范围', verdict: 'satisfied', detail: '范围内' },
            { id: 'git_integrity', title: '版本状态', verdict: 'satisfied', detail: '未提交' },
            { id: 'tests_passed', title: '测试', verdict: 'satisfied', detail: '自动测试通过' },
            {
              id: 'build_check',
              title: '构建',
              verdict: 'unverifiable',
              detail: 'package.json 中无 build 脚本',
            },
            {
              id: 'claim_vs_diff',
              title: '报告与变更',
              verdict: 'partially_satisfied',
              detail: '以独立采集为准',
            },
          ],
        },
      },
      async () => ({
        text: JSON.stringify({
          decision: 'meets_plan',
          canUse: '可以试用当前版本。',
          goalAttained: '已达到本轮目标。',
          needChange: '不是必须再改。',
          nextStep: '建议采用这一版成果。',
          userSummary: 'formatLabel 已按要求修改，测试通过。',
          completed: ['修改 formatLabel', '测试通过'],
          gaps: [],
          evidenceRefs: ['check:file_changes', 'check:tests_passed', 'file:formatLabel.js'],
          risks: ['不会自动提交或发布'],
          nextAction: '你可以确认采用这一版成果。',
        }),
      }),
    );
    assert.equal(review.decision, 'meets_plan');
    assert.equal(review.primaryAction, 'confirm_adopt');
    assert.equal(review.goalAttained, true);
  });

  it('五项结论不含 Job、Artifact、execution_failed 等内部词', async () => {
    const input = {
      userGoal: '把 formatLabel 改成 start-processing 并跑测试',
      changedFileCount: 1,
      changedFiles: ['formatLabel.js'],
      jobId: 'job_leak',
      artifactVersionId: 'art_leak',
      testResults: [
        { command: 'npm test', passed: false, summary: '自动测试失败（execution_failed）' },
      ],
      verification: {
        overall: 'unsatisfied' as const,
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件变化', verdict: 'satisfied' as const, detail: '1 个文件' },
          {
            id: 'tests_passed',
            title: '测试',
            verdict: 'unsatisfied' as const,
            detail: '自动测试失败（execution_failed）',
          },
        ],
      },
    };
    const pack = buildAiCtoEvidencePack(input);
    assert.equal(pack.verification.checks.find((c) => c.ref === 'check:tests_passed')?.detail, '测试未通过');
    assert.equal(pack.testResults?.[0]?.summary, '测试未通过');
    assert.doesNotMatch(JSON.stringify(pack.verification), /execution_failed/);
    const review = await buildAiDigitalMeCtoReview(input, async () => ({
      text: JSON.stringify({
        decision: 'needs_revision',
        canUse: '现在不能用，Job 还不能交付。',
        goalAttained: '未达标，execution_failed。',
        needChange: '需要继续改，Artifact 不能采用。',
        nextStep: '先处理 Job 失败原因。',
        userSummary: '测试失败 execution_failed',
        completed: ['改了 formatLabel'],
        gaps: ['execution_failed'],
        evidenceRefs: ['check:tests_passed', 'file:formatLabel.js'],
        risks: ['自动测试结果为失败（execution_failed）'],
        nextAction: '不要采用这份 Artifact。',
        revisionPlan: '补齐测试环境后重新跑测试。',
      }),
    }));
    assert.doesNotMatch(review.report, /\bJob\b/);
    assert.doesNotMatch(review.report, /\bArtifact\b/);
    assert.doesNotMatch(review.report, /execution_failed/i);
    assert.match(review.report, /测试未通过/);
  });

  it('thin_v1 首轮成功后不进入旧自动修订', async () => {
    const task: Task = {
      id: 'task_thin',
      subjectId: 'sub_1',
      createdAt: new Date().toISOString(),
      goal: '改 formatLabel',
      contextRefs: [],
      requestedArtifactType: 'code-change',
      intentKind: 'modify_code',
      meta: { runtimePath: THIN_RUNTIME_PATH },
    };
    const result = await maybeRunControlledRevisionAfterJob(
      {
        getTask: async () => task,
        withTaskExclusive: async () => {
          throw new Error('thin_v1 must not claim auto revision');
        },
        updateRevisionLoop: async () => task,
        appendConversation: async () => undefined,
        findActiveJob: async () => null,
        getArtifactContent: async () => {
          throw new Error('thin_v1 must not read artifact for auto revision');
        },
        reviseArtifact: async () => {
          throw new Error('thin_v1 must not auto revise');
        },
        nowIso: () => new Date().toISOString(),
      },
      { taskId: task.id, jobId: 'job_1', artifactId: 'art_1' },
    );
    assert.equal(result.action, 'noop');
    assert.equal(result.reason, 'product_main_chain_no_auto_revision');
  });
});

async function jobCount(runtime: DigitalMeRuntime, taskId: string): Promise<number> {
  const detail = await runtime.getTask({ taskId });
  return detail.latestJob ? 1 : 0;
}
