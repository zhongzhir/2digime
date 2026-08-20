/**
 * AI-NATIVE-CORE-RUNTIME-31B
 * 所有产生 Artifact 的成功 Job 走同一套 AI CTO 评价；不依赖 codeChange。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime, type DigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import { waitForJobTerminal } from '../job-runner';
import {
  ACCEPTANCE_REVIEW_FAILED_MESSAGE,
  resolveCurrentAcceptance,
} from '../artifact-acceptance';
import type { Artifact } from '../artifact';
import { collectGenericCtoEvidence, toCtoReviewInput } from '../../execution/generic-cto-review';
import { buildAiCtoEvidencePack } from '../../execution/ai-cto-review';
import type { ExecutionJob } from '../execution-job';
import type { Task } from '../task';

const DOC_BODY = [
  'ARCH-31B-DOC-BODY',
  '当前架构按对话、做事与数字之我组织。',
  '主要问题是验收说明曾经只挂在代码成果下。',
  '建议下一步改为所有成果共用同一套评价入口。',
].join('\n');
const UNIQUE_PLAN = '目标：写架构评估\n步骤：31B-CONFIRMED-PLAN-UNIQUE\n交付：一份评估报告';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-runtime31b-${prefix}-`));
}

function scriptedConverse(
  replies: Array<{ intent: string; confidence: number; reply: string; planUpdate?: string; executionIntentKind?: string; expectedOutputFamily?: string }>,
) {
  let i = 0;
  return async ({ messages }: { messages: ChatMessage[] }) => {
    void messages;
    const r = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return {
      text: JSON.stringify({
        intent: r.intent,
        confidence: r.confidence,
        reply: r.reply,
        ...(r.planUpdate ? { planUpdate: r.planUpdate } : {}),
        ...(r.executionIntentKind ? { executionIntentKind: r.executionIntentKind } : {}),
        ...(r.expectedOutputFamily ? { expectedOutputFamily: r.expectedOutputFamily } : {}),
      }),
    };
  };
}

function scriptedCto(handler: (pack: Record<string, unknown>) => Record<string, unknown> | Error) {
  const captured: Record<string, unknown>[] = [];
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    const raw = String(messages[1]?.content || '');
    const pack = JSON.parse(raw) as Record<string, unknown>;
    captured.push(pack);
    const out = handler(pack);
    if (out instanceof Error) throw out;
    return { text: JSON.stringify(out) };
  };
  return { chat, captured };
}

function meetsPlanOutput(pack: Record<string, unknown>) {
  const refs = Array.isArray(pack.evidenceRefs) ? (pack.evidenceRefs as string[]).slice(0, 4) : [];
  return {
    decision: 'meets_plan',
    canUse: '可以按当前报告使用。',
    goalAttained: '本轮目标已达成。',
    needChange: '不需要额外修改。',
    risks: ['材料范围有限'],
    nextStep: '可以采用当前报告。',
    userSummary: '架构评估报告已完成。',
    completed: ['已根据材料形成架构评估'],
    gaps: [],
    evidenceRefs: refs,
    nextAction: 'confirm_adopt',
    revisionPlan: '',
  };
}

function needsRevisionOutput(pack: Record<string, unknown>) {
  const refs = Array.isArray(pack.evidenceRefs) ? (pack.evidenceRefs as string[]).slice(0, 4) : [];
  return {
    decision: 'needs_revision',
    canUse: '现在还不建议当作最终可用版本。',
    goalAttained: '还不能认定已达到目标。',
    needChange: '需要补充主要风险的依据后再定。',
    risks: ['依据偏少'],
    nextStep: '请先按缺口补充后再继续。',
    userSummary: '报告方向对，但证据不足。',
    completed: ['已写出架构轮廓'],
    gaps: ['缺少对主要问题的具体依据'],
    evidenceRefs: refs,
    nextAction: 'confirm_continue',
    revisionPlan: '请补充主要问题的具体依据，并明确建议的下一步。',
  };
}

async function makeRuntime(opts: {
  converse: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
  cto?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
  text?: string;
}) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    converseChat: opts.converse,
    ...(opts.cto ? { ctoReviewChat: opts.cto } : {}),
    fakeAdapter: { text: opts.text || DOC_BODY, title: '架构评估报告' },
  });
  const bus = createCommandBus(runtime);
  return { runtime, bus };
}

async function waitForAcceptance(
  runtime: DigitalMeRuntime,
  artifactId: string,
  timeoutMs = 8000,
): Promise<NonNullable<Artifact['acceptance']>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const artifact = await runtime.getArtifact(artifactId);
    if (artifact?.acceptance && (artifact.acceptance.status === 'ready' || artifact.acceptance.status === 'failed')) {
      return artifact.acceptance;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timeout waiting for artifact.acceptance');
}

async function startDocumentJob(bus: ReturnType<typeof createCommandBus>, pkgDir: string) {
  await bus.invoke('subject.createPackage', {
    displayName: '31B 主体',
    targetDir: pkgDir,
  });
  const first = await bus.invoke('work.converse', { text: '通读材料，写一份架构评估报告' });
  await bus.invoke('work.converse', { taskId: first.taskId, text: '按这个做吧，开始。' });
  const submitted = await bus.invoke('work.submitTask', {
    goal: '通读材料，写一份架构评估报告',
    contextRefs: [],
    requestedArtifactType: 'document',
    existingTaskId: first.taskId,
    confirmedPlanVersion: 1,
  });
  return { taskId: first.taskId, jobId: submitted.jobId };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const conv = require('../../../electron/renderer/work-conversation.js') as {
  buildWorkTimeline: (input: Record<string, unknown>) => Array<{
    kind: string;
    text: string;
    actions?: Array<{ id: string; label: string }>;
  }>;
};

describe('AI-NATIVE-CORE-RUNTIME-31B generic CTO review', () => {
  it('非 thin 文档 Job 成功后写入通用 CTO 结论；输入含目标、规划与正文；无 codeChange', async () => {
    const root = await tempDir('doc');
    const { chat: converse } = { chat: scriptedConverse([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: UNIQUE_PLAN,
      },
      { intent: 'confirm_start', confidence: 0.95, reply: '好，按当前方案开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
    ]) };
    const { chat: cto, captured } = scriptedCto(meetsPlanOutput);
    const { runtime, bus } = await makeRuntime({ converse, cto });
    const { taskId, jobId } = await startDocumentJob(bus, path.join(root, 'pkg'));
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const job = await runtime.workRuntime.getJob(jobId);
    assert.equal(job?.status, 'succeeded');
    const artifactId = job?.artifactId as string;
    const acceptance = await waitForAcceptance(runtime, artifactId);
    assert.equal(acceptance.status, 'ready');
    assert.match(String(acceptance.summary?.ctoReport || ''), /现在能不能用|可以按当前报告使用/);
    assert.equal(acceptance.artifactVersionId, (await runtime.getArtifact(artifactId))?.headVersionId);

    const content = (await runtime.getContent({ artifactId, expectedTaskId: taskId })) as {
      text?: string;
      acceptanceSummary?: { ctoReport?: string };
      codeChange?: { acceptanceSummary?: unknown };
    };
    assert.match(String(content.text || ''), /ARCH-31B-DOC-BODY/);
    assert.equal(content.acceptanceSummary?.ctoReport, acceptance.summary?.ctoReport);
    assert.equal(content.codeChange, undefined);

    const pack = captured[0];
    assert.ok(pack);
    assert.match(String(pack.goal || ''), /架构评估/);
    assert.match(String((pack.confirmedPlan as { content?: string } | undefined)?.content || ''), /31B-CONFIRMED-PLAN-UNIQUE/);
    assert.match(String(pack.artifactBody || ''), /ARCH-31B-DOC-BODY/);
    assert.ok(Array.isArray(pack.evidenceRefs) && (pack.evidenceRefs as string[]).includes('artifact:body'));

    const raw = JSON.parse(
      await fs.readFile(
        path.join(root, 'pkg', 'runtime', 'artifacts', `${artifactId}.json`),
        'utf8',
      ),
    ) as Artifact;
    assert.equal(raw.acceptance?.status, 'ready');
    assert.ok(raw.acceptance?.summary?.ctoReport);
    assert.equal((raw as { codeChange?: unknown }).codeChange, undefined);
    await runtime.stop();
  });

  it('代码任务走同一入口并携带测试与 diff 证据', () => {
    const task = { id: 'task_x', goal: '改 formatLabel 并跑测试' } as Task;
    const job = {
      id: 'job_x',
      status: 'succeeded',
      confirmedPlanSnapshot: { version: 1, content: '步骤：改 formatLabel 并跑测试' },
      costActual: { durationMs: 1200 },
    } as ExecutionJob;
    const artifact = {
      id: 'art_x',
      jobId: 'job_x',
      taskId: 'task_x',
      headVersionId: 'ver_1',
    } as Artifact;
    const evidence = collectGenericCtoEvidence({
      task,
      job,
      artifact,
      artifactVersionId: 'ver_1',
      artifactBody: '已修改 formatLabel。',
      codeChange: {
        summary: '改了 formatLabel',
        testResults: [{ command: 'npm test', passed: true, summary: 'ok' }],
        changedFiles: ['formatLabel.js'],
        unifiedDiff: 'diff --git a/formatLabel.js b/formatLabel.js\n+return "start-processing";\n',
        verificationOverall: 'satisfied',
        digitalMeVerified: true,
        checks: [
          { id: 'file_changes', title: '文件变化', verdict: 'satisfied' },
          { id: 'tests_passed', title: '测试', verdict: 'satisfied', detail: 'ok' },
        ],
      },
    });
    const pack = buildAiCtoEvidencePack(toCtoReviewInput(evidence));
    assert.match(pack.goal, /formatLabel/);
    assert.match(String(pack.confirmedPlan?.content || ''), /改 formatLabel/);
    assert.equal(pack.testResults?.[0]?.passed, true);
    assert.ok((pack.changedFiles || []).some((f) => f.path === 'formatLabel.js'));
    assert.ok((pack.changedFileExcerpts || []).length > 0);
    assert.equal(pack.changedFileCount, 1);
  });

  it('模型评价失败时退出等待态，提供可重试说明，不把降级模板当成功', async () => {
    const root = await tempDir('fail');
    const converse = scriptedConverse([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理。',
        planUpdate: UNIQUE_PLAN,
      },
      { intent: 'confirm_start', confidence: 0.95, reply: '开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
    ]);
    const { chat: cto } = scriptedCto(() => new Error('model down'));
    const { runtime, bus } = await makeRuntime({ converse, cto });
    const { taskId, jobId } = await startDocumentJob(bus, path.join(root, 'pkg'));
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const artifactId = (await runtime.workRuntime.getJob(jobId))?.artifactId as string;
    const acceptance = await waitForAcceptance(runtime, artifactId);
    assert.equal(acceptance.status, 'failed');
    assert.equal(acceptance.failureMessage, ACCEPTANCE_REVIEW_FAILED_MESSAGE);
    assert.equal(acceptance.summary, undefined);
    const content = (await runtime.getContent({ artifactId, expectedTaskId: taskId })) as {
      acceptanceStatus?: string;
      acceptanceFailureMessage?: string;
      acceptanceSummary?: { ctoReport?: string };
    };
    assert.equal(content.acceptanceStatus, 'failed');
    assert.equal(content.acceptanceFailureMessage, ACCEPTANCE_REVIEW_FAILED_MESSAGE);
    assert.equal(content.acceptanceSummary, undefined);
    const turns = conv.buildWorkTimeline({
      hasArtifact: true,
      jobRunning: false,
      acceptanceFailed: true,
      acceptanceFailureMessage: content.acceptanceFailureMessage,
    });
    const failed = turns.find((t) => t.kind === 'acceptance');
    assert.ok(failed);
    assert.match(failed!.text, /验收说明暂未完成/);
    assert.ok(failed!.actions?.some((a) => a.id === 'retry_acceptance'));
    assert.ok(!turns.some((t) => /正在整理验收说明/.test(t.text)));
    await runtime.stop();
  });

  it('重启后从同一通用位置恢复 CTO 结论', async () => {
    const root = await tempDir('restart');
    const pkgDir = path.join(root, 'pkg');
    const converse = scriptedConverse([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理。',
        planUpdate: UNIQUE_PLAN,
      },
      { intent: 'confirm_start', confidence: 0.95, reply: '开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
    ]);
    const { chat: cto } = scriptedCto(meetsPlanOutput);
    const first = await makeRuntime({ converse, cto });
    const { jobId } = await startDocumentJob(first.bus, pkgDir);
    await waitForJobTerminal(first.runtime.workRuntime, jobId, 15_000);
    const artifactId = (await first.runtime.workRuntime.getJob(jobId))?.artifactId as string;
    const before = await waitForAcceptance(first.runtime, artifactId);
    const report = String(before.summary?.ctoReport || '');
    await first.runtime.stop();

    const second = await makeRuntime({
      converse: async () => ({ text: '{"intent":"other","confidence":0.2,"reply":"ok"}' }),
      cto: async () => {
        throw new Error('must not re-run CTO on restart');
      },
    });
    await second.bus.invoke('subject.openPackage', { dir: pkgDir });
    const after = (await second.runtime.getArtifact(artifactId))?.acceptance;
    assert.equal(after?.status, 'ready');
    assert.equal(after?.summary?.ctoReport, report);
    const content = (await second.runtime.getContent({ artifactId })) as {
      acceptanceSummary?: { ctoReport?: string };
    };
    assert.equal(content.acceptanceSummary?.ctoReport, report);
    await second.runtime.stop();
  });

  it('needs_revision 只说明缺口，不自动创建修订 Job', async () => {
    const root = await tempDir('revise');
    const converse = scriptedConverse([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理。',
        planUpdate: UNIQUE_PLAN,
      },
      { intent: 'confirm_start', confidence: 0.95, reply: '开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
    ]);
    const { chat: cto } = scriptedCto(needsRevisionOutput);
    const { runtime, bus } = await makeRuntime({ converse, cto });
    const { taskId, jobId } = await startDocumentJob(bus, path.join(root, 'pkg'));
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const artifactId = (await runtime.workRuntime.getJob(jobId))?.artifactId as string;
    const acceptance = await waitForAcceptance(runtime, artifactId);
    assert.equal(acceptance.status, 'ready');
    assert.match(String(acceptance.summary?.ctoReport || ''), /还需不需要修改|缺口|补充/);
    await new Promise((r) => setTimeout(r, 200));
    const jobs = await runtime.workRuntime.listJobsForTask(taskId);
    assert.equal(jobs.length, 1);
    await runtime.stop();
  });

  it('历史旧位置可读取；新结果只写通用位置', () => {
    const legacySummary = {
      title: '验收',
      headline: '旧结论',
      executionStatusLabel: '已结束',
      goalLabel: '已满足',
      goalVerdict: 'satisfied' as const,
      recommendation: '可以采用' as const,
      bullets: [],
      technicalBullets: [],
      adoptWarnings: [],
      digitalMeVerified: true,
      agentClaimedSuccess: true,
      canAdoptSuggested: true,
      ctoReport: '现在能不能用：旧位置结论。',
    };
    const head = 'ver_old';
    const historical = {
      id: 'art_old',
      headVersionId: head,
    } as Artifact;
    const fromLegacy = resolveCurrentAcceptance(historical, head, legacySummary);
    assert.equal(fromLegacy?.source, 'legacy_code_change');
    assert.equal(fromLegacy?.summary?.ctoReport, legacySummary.ctoReport);

    const migrated = {
      ...historical,
      acceptance: {
        artifactVersionId: head,
        jobId: 'job_new',
        status: 'ready' as const,
        updatedAt: new Date().toISOString(),
        summary: {
          title: '验收',
          goalLabel: '已满足',
          recommendation: '可以采用',
          bullets: [],
          canAdoptSuggested: true,
          ctoReport: '现在能不能用：通用位置结论。',
        },
      },
    } as Artifact;
    const fromNew = resolveCurrentAcceptance(migrated, head, legacySummary as never);
    assert.equal(fromNew?.source, 'artifact');
    assert.match(String(fromNew?.summary?.ctoReport || ''), /通用位置结论/);
    assert.doesNotMatch(String(fromNew?.summary?.ctoReport || ''), /旧位置结论/);
  });

  it('评价进行中 stop 不拆除后访问；取消不写失败结论；重复 stop 幂等', async () => {
    const root = await tempDir('lifecycle-stop');
    const pkgDir = path.join(root, 'pkg');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ctoCalls = 0;
    const converse = scriptedConverse([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理。',
        planUpdate: UNIQUE_PLAN,
      },
      { intent: 'confirm_start', confidence: 0.95, reply: '开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
    ]);
    const cto = async ({ messages }: { messages: ChatMessage[] }) => {
      ctoCalls += 1;
      await gate;
      return { text: JSON.stringify(meetsPlanOutput(JSON.parse(String(messages[1]?.content || '{}')))) };
    };
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const { runtime, bus } = await makeRuntime({ converse, cto });
    try {
      const { jobId, taskId } = await startDocumentJob(bus, pkgDir);
      await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
      const artifactId = (await runtime.workRuntime.getJob(jobId))?.artifactId as string;
      const started = Date.now();
      while (ctoCalls === 0 && Date.now() - started < 8000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(ctoCalls, 1);

      await runtime.stop();
      await runtime.stop();
      await runtime.stop();
      release();
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(rejections.length, 0);

      const raw = JSON.parse(
        await fs.readFile(path.join(pkgDir, 'runtime', 'artifacts', `${artifactId}.json`), 'utf8'),
      ) as Artifact;
      assert.equal(raw.acceptance, undefined);

      const callsAfterStop = ctoCalls;
      runtime.eventBus.publish({
        kind: 'job.updated',
        jobId,
        taskId,
        status: 'succeeded',
      });
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(ctoCalls, callsAfterStop);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      release();
      await runtime.stop();
    }
  });

  it('关闭取消后重启，缺失评价可由现有补跑入口恢复', async () => {
    const root = await tempDir('lifecycle-resume');
    const pkgDir = path.join(root, 'pkg');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const converse = scriptedConverse([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理。',
        planUpdate: UNIQUE_PLAN,
      },
      { intent: 'confirm_start', confidence: 0.95, reply: '开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
    ]);
    let entered = 0;
    const firstCto = async () => {
      entered += 1;
      await gate;
      return { text: JSON.stringify({ decision: 'meets_plan' }) };
    };
    const first = await makeRuntime({ converse, cto: firstCto });
    let artifactId = '';
    try {
      const { jobId } = await startDocumentJob(first.bus, pkgDir);
      await waitForJobTerminal(first.runtime.workRuntime, jobId, 15_000);
      artifactId = (await first.runtime.workRuntime.getJob(jobId))?.artifactId as string;
      const started = Date.now();
      while (entered === 0 && Date.now() - started < 8000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(entered, 1);
      await first.runtime.stop();
    } finally {
      release();
      await first.runtime.stop();
    }

    const raw = JSON.parse(
      await fs.readFile(path.join(pkgDir, 'runtime', 'artifacts', `${artifactId}.json`), 'utf8'),
    ) as Artifact;
    assert.equal(raw.acceptance, undefined);

    let backfillCalls = 0;
    const second = await makeRuntime({
      converse: async () => ({ text: '{"intent":"other","confidence":0.2,"reply":"ok"}' }),
      cto: async ({ messages }) => {
        backfillCalls += 1;
        return {
          text: JSON.stringify(meetsPlanOutput(JSON.parse(String(messages[1]?.content || '{}')))),
        };
      },
    });
    await second.bus.invoke('subject.openPackage', { dir: pkgDir });
    assert.equal((await second.runtime.getArtifact(artifactId))?.acceptance, undefined);
    await second.runtime.getContent({ artifactId });
    const after = await waitForAcceptance(second.runtime, artifactId);
    assert.equal(after.status, 'ready');
    assert.ok(backfillCalls >= 1);
    await second.runtime.stop();
  });
});
