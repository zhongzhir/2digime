/**
 * AI-NATIVE-CORE-RUNTIME-31C
 * CTO 评价必须依据真实材料证据；核心要求未完成或无法验证时不得建议采用。
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
import { buildAiCtoEvidencePack, buildAiDigitalMeCtoReview } from '../../execution/ai-cto-review';
import type { ExecutionJob } from '../execution-job';
import type { Task } from '../task';
import type { ContextSnapshot } from '../context-snapshot';
import { buildMaterialEvidence } from '../material-summary';

const UNIQUE_PLAN = '目标：通读这个项目并形成架构评估\n步骤：31C-CONFIRMED-PLAN-UNIQUE\n交付：一份评估报告';
const GOAL_READ_PROJECT = '通读这个项目，形成一份架构评估报告，说明当前架构、主要问题和建议的下一步。';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-runtime31c-${prefix}-`));
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

function scriptedCto(
  handler: (pack: Record<string, unknown>) => Record<string, unknown> | Error | Promise<Record<string, unknown>>,
) {
  const captured: Record<string, unknown>[] = [];
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    const raw = String(messages[1]?.content || '');
    const pack = JSON.parse(raw) as Record<string, unknown>;
    captured.push(pack);
    const out = await handler(pack);
    if (out instanceof Error) throw out;
    return { text: JSON.stringify(out) };
  };
  return { chat, captured };
}

function refsOf(pack: Record<string, unknown>): string[] {
  return Array.isArray(pack.evidenceRefs) ? (pack.evidenceRefs as string[]).slice(0, 8) : [];
}

function meetsPlanOutput(pack: Record<string, unknown>, extras?: Record<string, unknown>) {
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
    evidenceRefs: refsOf(pack),
    nextAction: 'confirm_adopt',
    revisionPlan: '',
    requirementChecks: [
      {
        requirement: '通读这个项目',
        status: 'completed',
        evidence: 'materials:used',
      },
      {
        requirement: '形成架构评估报告',
        status: 'completed',
        evidence: 'artifact:body',
      },
    ],
    ...extras,
  };
}

function needsRevisionOutput(pack: Record<string, unknown>) {
  return {
    decision: 'needs_revision',
    canUse: '现在还不建议当作最终可用版本。',
    goalAttained: '还不能认定已达到目标。',
    needChange: '需要先获得并阅读项目内容。',
    risks: ['没有项目正文'],
    nextStep: '请先提供可读项目材料后再继续。',
    userSummary: '任务要求通读项目，但执行没有项目内容。',
    completed: [],
    gaps: ['未读取到项目文件'],
    evidenceRefs: refsOf(pack),
    nextAction: 'confirm_continue',
    revisionPlan: '请在可读项目材料上重新执行通读，并据此写架构评估。',
    requirementChecks: [
      { requirement: '通读这个项目', status: 'incomplete', evidence: 'materials:used 为空' },
      { requirement: '形成架构评估报告', status: 'incomplete' },
    ],
  };
}

async function makeRuntime(opts: {
  converse: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
  cto?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
  text?: string | ((input: unknown, extras: { materialSnippets: string[] }) => string);
}) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    converseChat: opts.converse,
    ...(opts.cto ? { ctoReviewChat: opts.cto } : {}),
    fakeAdapter: { text: opts.text as never, title: '架构评估报告' },
  });
  const bus = createCommandBus(runtime);
  return { runtime, bus };
}

async function waitForAcceptance(
  runtime: DigitalMeRuntime,
  artifactId: string,
  timeoutMs = 12_000,
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

async function startDocumentJob(
  bus: ReturnType<typeof createCommandBus>,
  pkgDir: string,
  opts?: {
    goal?: string;
    contextRefs?: Array<{ kind: 'folder'; path: string; projectOrigin: 'user_selected' }>;
  },
) {
  const goal = opts?.goal || GOAL_READ_PROJECT;
  await bus.invoke('subject.createPackage', {
    displayName: '31C 主体',
    targetDir: pkgDir,
  });
  const first = await bus.invoke('work.converse', {
    text: goal,
    ...(opts?.contextRefs ? { contextRefs: opts.contextRefs } : {}),
  });
  await bus.invoke('work.converse', { taskId: first.taskId, text: '按这个做吧，开始。' });
  const submitted = await bus.invoke('work.submitTask', {
    goal,
    contextRefs: opts?.contextRefs || [],
    requestedArtifactType: 'document',
    existingTaskId: first.taskId,
    confirmedPlanVersion: 1,
  });
  return { taskId: first.taskId, jobId: submitted.jobId };
}

function planConverse() {
  return scriptedConverse([
    {
      intent: 'add_goal_info',
      confidence: 0.95,
      reply: '规划已整理，确认后开始。',
      planUpdate: UNIQUE_PLAN,
    },
    { intent: 'confirm_start', confidence: 0.95, reply: '好，按当前方案开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document' },
  ]);
}

const emptyDocInput = {
  userGoal: GOAL_READ_PROJECT,
  artifactBody: '一份没有依据的架构评估。',
  jobExecutionReport: '本轮处理已经完成。',
  verification: {
    overall: 'unverifiable' as const,
    digitalMeVerified: false,
    agentClaimedSuccess: true,
    checks: [],
  },
  changedFileCount: 0,
};

describe('AI-NATIVE-CORE-RUNTIME-31C evidence-grounded CTO', () => {
  it('材料证据区分获得、已抽取、已使用与未读取；路径存在不等于已通读', () => {
    const snapshot = {
      items: [
        {
          sourcePath: 'D:/proj/architecture.md',
          kind: 'folder-entry' as const,
          status: 'ok' as const,
          extractedTextRef: 'ref_arch',
        },
        {
          sourcePath: 'D:/proj/secret.bin',
          kind: 'folder-entry' as const,
          status: 'warning' as const,
          warning: '格式暂不支持',
        },
      ],
    } as unknown as ContextSnapshot;
    const obtainedOnly = buildMaterialEvidence({
      snapshotItems: snapshot.items,
      contextRefs: [{ kind: 'folder', path: 'D:/proj' }],
    });
    assert.equal(obtainedOnly.extracted.length, 1);
    assert.equal(obtainedOnly.used.length, 0);
    assert.equal(obtainedOnly.unread.length, 1);
    assert.ok(obtainedOnly.notes.some((n) => /不得把已抽取等同于已通读|未进入本轮执行/.test(n)));

    const used = buildMaterialEvidence({
      snapshotItems: snapshot.items,
      contextRefs: [{ kind: 'folder', path: 'D:/proj' }],
      materialUse: { usedPaths: ['D:/proj/architecture.md'], includedCount: 1 },
    });
    assert.equal(used.used.length, 1);
    assert.equal(used.used[0]?.displayName, 'architecture.md');
    assert.ok((used.includedCount || 0) >= 1);
    assert.ok(
      (used.notes || []).some((n) => /纳入提示的材料条数当成完整阅读|不等于完整阅读/.test(n)),
    );

    const truncated = buildMaterialEvidence({
      snapshotItems: snapshot.items,
      contextRefs: [{ kind: 'folder', path: 'D:/proj' }],
      materialUse: {
        usedPaths: ['D:/proj/architecture.md'],
        includedCount: 1,
        truncatedCount: 1,
        fullReadCount: 0,
        items: [
          {
            path: 'D:/proj/architecture.md',
            completeness: 'truncated',
            sourceChars: 6808,
            usedChars: 3500,
          },
        ],
      },
    });
    assert.equal(truncated.used[0]?.completeness, 'truncated');
    assert.equal(truncated.used[0]?.sourceChars, 6808);
    assert.equal(truncated.used[0]?.usedChars, 3500);
    assert.equal(truncated.includedCount, 1);
    assert.equal(truncated.fullReadCount, 0);
    assert.equal(truncated.truncatedCount, 1);
    assert.ok((truncated.notes || []).some((n) => /部分读取/.test(n)));
    assert.notEqual(truncated.includedCount, truncated.fullReadCount);

    const pathOnly = buildMaterialEvidence({
      contextRefs: [{ kind: 'folder', path: 'D:/empty-proj' }],
    });
    assert.equal(pathOnly.extracted.length, 0);
    assert.equal(pathOnly.used.length, 0);
    assert.ok(pathOnly.notes.some((n) => /不得把目录存在当作已通读/.test(n)));

    const job = {
      id: 'job_x',
      status: 'succeeded',
      materialUse: { usedPaths: ['D:/proj/architecture.md'], includedCount: 1 },
      confirmedPlanSnapshot: { version: 1, content: UNIQUE_PLAN },
    } as ExecutionJob;
    const evidence = collectGenericCtoEvidence({
      task: {
        id: 'task_x',
        goal: GOAL_READ_PROJECT,
        contextRefs: [{ kind: 'folder', path: 'D:/proj' }],
      } as Task,
      job,
      artifact: { id: 'art_x', jobId: 'job_x', taskId: 'task_x', headVersionId: 'ver_1' } as Artifact,
      artifactVersionId: 'ver_1',
      artifactBody: '依据 architecture.md 的架构评估。',
      snapshot,
    });
    const pack = buildAiCtoEvidencePack(toCtoReviewInput(evidence));
    assert.equal(pack.materials?.used[0]?.displayName, 'architecture.md');
    assert.equal(pack.materials?.unread[0]?.displayName, 'secret.bin');
    assert.ok(pack.evidenceRefs.includes('materials:used'));
    assert.ok(pack.evidenceRefs.includes('materials:unread'));
    assert.match(String(pack.jobExecutionReport || ''), /已经完成/);

    const truncJob = {
      id: 'job_trunc',
      status: 'succeeded',
      materialUse: {
        usedPaths: ['D:/proj/architecture.md'],
        includedCount: 1,
        truncatedCount: 1,
        fullReadCount: 0,
        items: [
          {
            path: 'D:/proj/architecture.md',
            completeness: 'truncated' as const,
            sourceChars: 6808,
            usedChars: 3500,
          },
        ],
      },
      confirmedPlanSnapshot: { version: 1, content: UNIQUE_PLAN },
    } as ExecutionJob;
    const truncPack = buildAiCtoEvidencePack(
      toCtoReviewInput(
        collectGenericCtoEvidence({
          task: {
            id: 'task_trunc',
            goal: GOAL_READ_PROJECT,
            contextRefs: [{ kind: 'folder', path: 'D:/proj' }],
          } as Task,
          job: truncJob,
          artifact: { id: 'art_t', jobId: 'job_trunc', taskId: 'task_trunc', headVersionId: 'ver_1' } as Artifact,
          artifactVersionId: 'ver_1',
          artifactBody: '依据部分材料写成的架构评估。',
          snapshot,
        }),
      ),
    );
    assert.equal(truncPack.materials?.used[0]?.completeness, 'truncated');
    assert.equal(truncPack.materials?.used[0]?.sourceChars, 6808);
    assert.equal(truncPack.materials?.used[0]?.usedChars, 3500);
    assert.equal(truncPack.materials?.includedCount, 1);
    assert.equal(truncPack.materials?.fullReadCount, 0);
    assert.ok(truncPack.evidenceRefs.includes('materials:truncated'));
  });

  it('材料被截断时，脚本化 CTO 依据完整性事实不得建议采用', async () => {
    const review = await buildAiDigitalMeCtoReview(
      {
        userGoal: GOAL_READ_PROJECT,
        artifactBody: '一份声称已完整审阅全部材料的架构评估。',
        materials: {
          obtained: [{ path: 'architecture.md', displayName: 'architecture.md' }],
          extracted: [{ path: 'architecture.md', displayName: 'architecture.md' }],
          used: [
            {
              path: 'architecture.md',
              displayName: 'architecture.md',
              completeness: 'truncated',
              sourceChars: 6808,
              usedChars: 3500,
            },
          ],
          unread: [],
          folderAttached: true,
          includedCount: 1,
          fullReadCount: 0,
          truncatedCount: 1,
          notes: ['有 1 份材料仅部分读取。纳入提示 1 份不等于完整阅读 0 份。'],
        },
        verification: {
          overall: 'unverifiable' as const,
          digitalMeVerified: false,
          agentClaimedSuccess: true,
          checks: [],
        },
        changedFileCount: 0,
      },
      async ({ messages }) => {
        const pack = JSON.parse(String(messages[1]?.content || '')) as {
          materials?: { used?: Array<{ completeness?: string }> };
          evidenceRefs?: string[];
        };
        const truncated = (pack.materials?.used || []).some((u) => u.completeness === 'truncated');
        assert.equal(truncated, true);
        assert.ok((pack.evidenceRefs || []).includes('materials:truncated'));
        return {
          text: JSON.stringify({
            decision: 'needs_revision',
            canUse: '现在还不建议当作最终可用版本。',
            goalAttained: '材料尚未完整读取，只能算部分完成。',
            needChange: '需要继续读取被截断的材料。',
            risks: ['有材料只读了部分'],
            nextStep: '请先读完剩余材料后再判断是否采用。',
            userSummary: '核心材料被截断，不能当作完整审阅。',
            completed: [],
            gaps: ['architecture.md 仅部分读取'],
            evidenceRefs: pack.evidenceRefs || ['materials:truncated'],
            nextAction: 'confirm_continue',
            revisionPlan: '继续分段读取剩余材料，再据此修订评估。',
            requirementChecks: [
              {
                requirement: '完整阅读全部材料',
                status: 'incomplete',
                evidence: 'materials:truncated',
              },
              { requirement: '形成架构评估报告', status: 'completed', evidence: 'artifact:body' },
            ],
          }),
        };
      },
    );
    assert.notEqual(review.decision, 'meets_plan');
    assert.equal(review.goalAttained, false);
    assert.notEqual(review.primaryAction, 'confirm_adopt');
    assert.doesNotMatch(review.report, /本轮目标已达成/);
  });

  it('核心要求未完成时，即使模型输出可采用也不得建议采用', async () => {
    const review = await buildAiDigitalMeCtoReview(emptyDocInput, async () => ({
      text: JSON.stringify(
        meetsPlanOutput({ evidenceRefs: ['artifact:body'] }, {
          requirementChecks: [
            { requirement: '通读这个项目', status: 'incomplete', evidence: 'materials:used 为空' },
            { requirement: '形成架构评估报告', status: 'completed', evidence: 'artifact:body' },
          ],
        }),
      ),
    }));
    assert.notEqual(review.decision, 'meets_plan');
    assert.equal(review.goalAttained, false);
    assert.notEqual(review.primaryAction, 'confirm_adopt');
    assert.doesNotMatch(review.report, /本轮目标已达成/);
    assert.match(review.report, /还不能认定已达到目标|现在还不建议/);
  });

  it('核心要求无法验证时不得判目标达成', async () => {
    const review = await buildAiDigitalMeCtoReview(emptyDocInput, async () => ({
      text: JSON.stringify(
        meetsPlanOutput({ evidenceRefs: ['artifact:body'] }, {
          requirementChecks: [
            { requirement: '通读这个项目', status: 'unverifiable' },
            { requirement: '形成架构评估报告', status: 'completed', evidence: 'artifact:body' },
          ],
        }),
      ),
    }));
    assert.equal(review.decision, 'insufficient_evidence');
    assert.equal(review.goalAttained, false);
    assert.notEqual(review.primaryAction, 'confirm_adopt');
  });

  it('次要验证缺失不必机械否决已有依据的成果', async () => {
    const review = await buildAiDigitalMeCtoReview(
      {
        userGoal: GOAL_READ_PROJECT,
        artifactBody: '依据 architecture.md 与 execution.md 的架构评估。',
        materials: {
          obtained: [{ path: 'architecture.md', displayName: 'architecture.md' }],
          extracted: [{ path: 'architecture.md', displayName: 'architecture.md' }],
          used: [{ path: 'architecture.md', displayName: 'architecture.md' }],
          unread: [],
          folderAttached: true,
          notes: [],
        },
        verification: {
          overall: 'unverifiable',
          digitalMeVerified: false,
          agentClaimedSuccess: true,
          checks: [
            {
              id: 'build_check',
              title: '构建',
              verdict: 'unverifiable',
              detail: '无 build 脚本',
            },
          ],
        },
        changedFileCount: 0,
      },
      async () => ({
        text: JSON.stringify(
          meetsPlanOutput({
            evidenceRefs: ['artifact:body', 'materials:used'],
          }),
        ),
      }),
    );
    assert.equal(review.decision, 'meets_plan');
    assert.equal(review.primaryAction, 'confirm_adopt');
  });

  it('要求通读项目但执行无项目内容 → CTO 不得建议采用', async () => {
    const root = await tempDir('empty');
    const converse = planConverse();
    const { chat: cto, captured } = scriptedCto((pack) => {
      const materials = pack.materials as { used?: unknown[]; extracted?: unknown[] } | undefined;
      const used = materials?.used?.length || 0;
      const extracted = materials?.extracted?.length || 0;
      if (used === 0 && extracted === 0) return needsRevisionOutput(pack);
      return meetsPlanOutput(pack);
    });
    const { runtime, bus } = await makeRuntime({
      converse,
      cto,
      text: '没有项目材料的架构评估。',
    });
    const { taskId, jobId } = await startDocumentJob(bus, path.join(root, 'pkg'));
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const job = await runtime.workRuntime.getJob(jobId);
    assert.equal(job?.status, 'succeeded');
    const artifactId = job?.artifactId as string;
    const acceptance = await waitForAcceptance(runtime, artifactId);
    assert.equal(acceptance.status, 'ready');
    const pack = captured[0];
    assert.ok(pack);
    assert.equal((pack.materials as { used?: unknown[] } | undefined)?.used?.length || 0, 0);
    assert.ok(
      ((pack.materials as { notes?: string[] })?.notes || []).some((n) =>
        /没有可用的项目正文|不得把目录存在当作已通读/.test(n),
      ),
    );
    assert.match(String(acceptance.summary?.ctoReport || ''), /还不能认定|不建议|未读取/);
    assert.equal(acceptance.summary?.canAdoptSuggested, false);
    assert.notEqual(acceptance.summary?.primaryAction, 'confirm_adopt');
    const jobs = await runtime.workRuntime.listJobsForTask(taskId);
    assert.equal(jobs.length, 1);
    await runtime.stop();
  });

  it('执行读到项目内容且成果有依据 → 可按证据评价', async () => {
    const root = await tempDir('with');
    const folder = path.join(root, 'proj');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'README.txt'), '31C-README-MARKER 对话、做事、数字之我。', 'utf8');
    await fs.writeFile(path.join(folder, 'architecture.md'), '31C-ARCH-MARKER 当前架构按三层组织。', 'utf8');
    await fs.writeFile(path.join(folder, 'execution.md'), '31C-EXEC-MARKER 执行以确认为主动作。', 'utf8');
    const converse = planConverse();
    const { chat: cto, captured } = scriptedCto((pack) => meetsPlanOutput(pack));
    const { runtime, bus } = await makeRuntime({
      converse,
      cto,
      text: (_input, extras) =>
        [
          '31C-WITH-CONTENT-BODY',
          '当前架构按对话、做事与数字之我组织。',
          extras.materialSnippets.join('\n'),
        ].join('\n'),
    });
    const { jobId } = await startDocumentJob(bus, path.join(root, 'pkg'), {
      contextRefs: [{ kind: 'folder', path: folder, projectOrigin: 'user_selected' }],
    });
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const job = await runtime.workRuntime.getJob(jobId);
    assert.equal(job?.status, 'succeeded');
    assert.ok((job?.materialUse?.usedPaths || []).length >= 3);
    assert.equal(job?.materialUse?.fullReadCount, 3);
    assert.equal(job?.materialUse?.truncatedCount || 0, 0);
    for (const item of job?.materialUse?.items || []) {
      assert.equal(item.completeness, 'full');
      assert.equal(item.usedChars, item.sourceChars);
      assert.ok((item.sourceChars || 0) > 0);
    }
    const artifactId = job?.artifactId as string;
    const acceptance = await waitForAcceptance(runtime, artifactId);
    assert.equal(acceptance.status, 'ready');
    const pack = captured[0];
    assert.ok(pack);
    const usedEntries = (pack.materials as {
      used?: Array<{ displayName?: string; completeness?: string; sourceChars?: number; usedChars?: number }>;
    })?.used || [];
    const usedNames = usedEntries.map((e) => e.displayName);
    assert.ok(usedNames.includes('README.txt'));
    assert.ok(usedNames.includes('architecture.md'));
    assert.ok(usedNames.includes('execution.md'));
    for (const e of usedEntries) {
      assert.equal(e.completeness, 'full');
      assert.equal(e.usedChars, e.sourceChars);
    }
    assert.equal(acceptance.artifactVersionId, (await runtime.getArtifact(artifactId))?.headVersionId);
    assert.equal(acceptance.summary?.primaryAction, 'confirm_adopt');
    await runtime.stop();
  });

  it('评价期间 Artifact 升版 → 旧结论不覆盖新版本', async () => {
    const root = await tempDir('bump');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const converse = planConverse();
    const { chat: cto, captured } = scriptedCto(async (pack) => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return needsRevisionOutput(pack);
      }
      return meetsPlanOutput(pack);
    });
    const { runtime, bus } = await makeRuntime({
      converse,
      cto,
      text: '31C-VERSION-BODY-V1',
    });
    const { jobId } = await startDocumentJob(bus, path.join(root, 'pkg'));
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const artifactId = (await runtime.workRuntime.getJob(jobId))?.artifactId as string;
    const start = Date.now();
    while (captured.length < 1 && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(captured.length, 1);
    const v1 = String(captured[0]?.artifactVersionId || '');
    assert.ok(v1);
    await runtime.saveEdit({ artifactId, text: '31C-VERSION-BODY-V2' });
    const v2 = (await runtime.getArtifact(artifactId))?.headVersionId || '';
    assert.ok(v2);
    assert.notEqual(v2, v1);
    release();
    const acceptance = await waitForAcceptance(runtime, artifactId, 15_000);
    assert.equal(acceptance.artifactVersionId, v2);
    assert.notEqual(acceptance.artifactVersionId, v1);
    assert.match(String(acceptance.summary?.ctoReport || ''), /可以按当前报告使用|现在能不能用/);
    assert.equal(acceptance.summary?.primaryAction, 'confirm_adopt');
    const resolved = resolveCurrentAcceptance((await runtime.getArtifact(artifactId)) as Artifact, v2);
    assert.equal(resolved?.artifactVersionId, v2);
    assert.ok(captured.some((p) => p.artifactVersionId === v2));
    await runtime.stop();
  });

  it('模型评价失败仍进入可重试状态；无自动修订 Job', async () => {
    const root = await tempDir('fail');
    const converse = planConverse();
    const { chat: cto } = scriptedCto(() => new Error('model down'));
    const { runtime, bus } = await makeRuntime({ converse, cto });
    const { taskId, jobId } = await startDocumentJob(bus, path.join(root, 'pkg'));
    await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
    const artifactId = (await runtime.workRuntime.getJob(jobId))?.artifactId as string;
    const acceptance = await waitForAcceptance(runtime, artifactId);
    assert.equal(acceptance.status, 'failed');
    assert.equal(acceptance.failureMessage, ACCEPTANCE_REVIEW_FAILED_MESSAGE);
    const jobs = await runtime.workRuntime.listJobsForTask(taskId);
    assert.equal(jobs.length, 1);
    await runtime.stop();
  });
});
