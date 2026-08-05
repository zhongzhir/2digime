/**
 * DIGITALME-V2-AI-FIRST-EXECUTION-SIMPLIFICATION-01 领域验收。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../job-runner';
import {
  buildTargetedRevisionRequest,
  checkOutcome,
  chooseExecutionProfile,
} from '../ai-first-policy';
import {
  selectConfirmedExperiences,
  selectSubjectInjection,
} from '../../subject-core/experience-selector';
import { DECISION_ACCEPT_TAG } from '../../subject-core/artifact-decision';
import type { SubjectDerivedBundle } from '../../subject-core/derive-all';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-ai-first-${prefix}-`));
}

test('chooseExecutionProfile: standard / careful / high_risk', () => {
  assert.equal(chooseExecutionProfile({ goal: '写一篇产品介绍' }), 'standard');
  assert.equal(chooseExecutionProfile({ goal: '高质量深度分析竞品' }), 'careful');
  assert.equal(chooseExecutionProfile({ goal: '起草合同签署说明并准备转账' }), 'high_risk');
});

test('checkOutcome: pass / targeted_revision / blocked', () => {
  const pass = checkOutcome({
    goal: '写一份项目周报',
    text: '# 周报\n\n本周完成了交付范围冻结与风险梳理，下一步推进验收。\n\n详情补充如下，保证可读完整。',
  });
  assert.equal(pass.verdict, 'pass');

  const revise = checkOutcome({
    goal: '写一份必须包含Alpha里程碑且需要包含Beta验收的周报',
    text: '# 周报\n\n本周只谈了日常进度，没有触及关键里程碑名称。补充足够长度以保证可读。',
  });
  assert.equal(revise.verdict, 'targeted_revision_required');
  assert.ok(revise.defects.length >= 1);

  const blocked = checkOutcome({
    goal: '写文档',
    text: '',
  });
  assert.equal(blocked.verdict, 'blocked');

  const shortRevise = checkOutcome({
    goal: '写文档',
    text: '太短',
  });
  assert.equal(shortRevise.verdict, 'targeted_revision_required');

  const boundary = checkOutcome({
    goal: '写分析',
    text: '# 分析\n\n本文讨论了秘密话题 ForbiddenTopicX 以及相关扩展，内容足够长以保证可读完整。',
    hardBoundaryTexts: ['exclude:ForbiddenTopicX'],
  });
  assert.equal(boundary.verdict, 'blocked');
});

test('buildTargetedRevisionRequest only lists defects', () => {
  const req = buildTargetedRevisionRequest(['缺标题', '触碰边界']);
  assert.match(req, /缺标题/);
  assert.match(req, /触碰边界/);
  assert.doesNotMatch(req, /主体|GrowthEvent|ContextSnapshot/);
});

test('no relevant experience → empty inject is legal', () => {
  const view = selectConfirmedExperiences({
    goal: '整理旅行装箱清单',
    requestedArtifactType: 'document',
    confirmed: {
      subjectId: 's',
      derivedAt: 't',
      entries: [
        {
          eventId: 'e1',
          title: '产品周报节奏',
          detail: '发布节奏保持每周一次',
          tags: [DECISION_ACCEPT_TAG, 'document', '周报'],
          occurredAt: 't1',
        },
      ],
    },
    boundaries: {
      subjectId: 's',
      derivedAt: 't',
      excludedTags: [],
      excludedAssetTags: [],
      entries: [],
    },
  });
  assert.equal(view.entries.length, 0);
});

test('highly related experiences capped at 3', () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    eventId: `e${i}`,
    title: `项目风险摘要写法 ${i}`,
    detail: `项目风险摘要优先冻结交付范围 token_${i}`,
    tags: [DECISION_ACCEPT_TAG, 'document', '风险', '摘要'],
    occurredAt: `2026-08-0${i + 1}T10:00:00.000Z`,
  }));
  const view = selectConfirmedExperiences({
    goal: '再写一份项目风险摘要，继续强调冻结交付范围',
    requestedArtifactType: 'document',
    confirmed: { subjectId: 's', derivedAt: 't', entries },
    boundaries: {
      subjectId: 's',
      derivedAt: 't',
      excludedTags: [],
      excludedAssetTags: [],
      entries: [],
    },
  });
  assert.ok(view.entries.length <= 3);
  assert.ok(view.entries.length >= 1);
});

test('hard boundary injects even without memory; identity skipped on standard', () => {
  const derived = {
    summary: { subjectId: 's', derivedAt: 't', activeCount: 2, inactiveCount: 0 },
    identity: {
      subjectId: 's',
      derivedAt: 't',
      entries: [
        {
          eventId: 'id1',
          title: '我是产品经理',
          detail: '本地优先',
          tags: ['identity'],
        },
      ],
    },
    goals: { subjectId: 's', derivedAt: 't', entries: [] },
    principles: { subjectId: 's', derivedAt: 't', entries: [] },
    confirmed: { subjectId: 's', derivedAt: 't', entries: [] },
    boundaries: {
      subjectId: 's',
      derivedAt: 't',
      excludedTags: ['融资'],
      excludedAssetTags: [],
      entries: [
        {
          eventId: 'b1',
          title: '不讨论融资',
          detail: 'exclude:融资细节',
          tags: ['边界', 'exclude:融资细节'],
        },
      ],
    },
    knowledgeGaps: { subjectId: 's', derivedAt: 't', entries: [] },
    inactiveEventIds: [],
    activeItems: [],
  } as unknown as SubjectDerivedBundle;

  const standard = selectSubjectInjection({
    goal: '写一份市场分析',
    requestedArtifactType: 'document',
    derived,
    policy: 'ai_first',
    includeCoreMatching: false,
  });
  assert.ok(standard.freeze.selectedEventIds.includes('b1'));
  assert.ok(!standard.freeze.selectedEventIds.includes('id1'));

  const careful = selectSubjectInjection({
    goal: '写一份市场分析',
    requestedArtifactType: 'document',
    derived,
    policy: 'ai_first',
    includeCoreMatching: true,
  });
  assert.ok(careful.freeze.selectedEventIds.includes('id1'));
});

test('ordinary task succeeds with one primary model call (fake)', async () => {
  const root = await tempDir('one-call');
  let calls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        calls += 1;
        return `# 成果\n\n针对「${input.goal}」的完整说明。包含背景、要点与下一步，保证可直接使用。`;
      },
    },
  });
  await runtime.createPackage({
    displayName: 'AI-first',
    targetDir: path.join(root, 'pkg'),
    initialSelfDescription: '测试主体',
  });
  const submitted = await runtime.submitTask({
    goal: '写一份产品介绍短文',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(calls, 1);
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  assert.ok(freeze);
  // 无相关经验 → Snapshot 可不含经验条目
  const expCount = (freeze!.entries || []).filter((e) => e.kind === 'experience').length;
  assert.equal(expCount, 0);
  await runtime.stop();
});

test('learning failure does not change artifact completion', async () => {
  const root = await tempDir('learn-fail');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '学习失败隔离',
    targetDir: path.join(root, 'pkg'),
  });
  const submitted = await runtime.submitTask({
    goal: '整理一份会议纪要提纲',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'succeeded');
  assert.ok(job.artifactId);

  // 模拟学习副作用失败：append 非法后任务成果仍保持可用
  await assert.rejects(async () => {
    await runtime.subject.appendGrowthEvent({
      id: 'gevt_bad',
      subjectId: 'wrong-subject',
      occurredAt: new Date().toISOString(),
      type: 'feedback_recorded',
      source: { kind: 'owner_direct' },
      payload: { title: 'x', detail: 'y' },
      confidence: 'candidate',
    });
  });

  const content = await runtime.getContent({ artifactId: job.artifactId as string });
  assert.ok(String(content.text || '').length > 20);
  const again = await runtime.getTask({ taskId: submitted.taskId });
  assert.ok(again.artifactIds.includes(job.artifactId as string));
  await runtime.stop();
});

test('pass outcome does not trigger revision; clear defect revises at most once', async () => {
  const root = await tempDir('revise-once');
  let calls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        calls += 1;
        if (input.revision) {
          return `# 修订稿\n\n已补齐 Alpha里程碑 与 Beta验收。正文足够完整，可直接使用。`;
        }
        // 首次故意缺 must 要点 → Outcome Check 触发一次修订
        return `# 草稿\n\n本周只写了日常进度，尚未展开关键里程碑名称，但仍有足够长度保证正文可读、结构完整、可直接交付使用。`;
      },
    },
  });
  await runtime.createPackage({
    displayName: '修订一次',
    targetDir: path.join(root, 'pkg'),
  });
  const submitted = await runtime.submitTask({
    goal: '写一份必须包含Alpha里程碑且需要包含Beta验收的周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(calls, 2);
  const art = await runtime.getContent({ artifactId: job.artifactId as string });
  assert.match(String(art.text || ''), /Alpha里程碑/);
  await runtime.stop();
});

test('A/B path comparison: ai_first vs legacy injection volume', async () => {
  const evidenceDir = path.join(
    process.cwd(),
    'scripts',
    '_ai-first-execution-evidence',
  );
  await fs.mkdir(evidenceDir, { recursive: true });

  const tasks = [
    {
      name: 'wechat_article',
      goal: '写一篇公众号宣传稿，介绍本地优先的产品价值，约 400 字',
    },
    {
      name: 'project_plan',
      goal: '写一份项目分析与下季度规划，包含风险与里程碑',
    },
    {
      name: 'doc_review',
      goal: '整理并审查这份说明文档的结构与可读性建议',
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const policy of ['legacy', 'ai_first'] as const) {
    for (const task of tasks) {
      const root = await tempDir(`${policy}-${task.name}`);
      let calls = 0;
      const t0 = Date.now();
      const runtime = createDigitalMeRuntime({
        documentCapability: 'fake',
        executionPolicy: policy,
        fakeAdapter: {
          text: (input) => {
            calls += 1;
            const injected = input.subjectContext.entries.length;
            return `# ${task.name}\n\n目标：${input.goal}\n注入条目：${injected}\n\n正文覆盖价值、风险与结构建议，保证可直接使用。`;
          },
        },
      });
      await runtime.createPackage({
        displayName: `对照-${policy}`,
        targetDir: path.join(root, 'pkg'),
        initialSelfDescription: '我是 Owner 的数字分身，关注产品与风险。',
      });
      // 预置弱相关确认经验 + 身份：放大 legacy 注入差
      for (let i = 0; i < 4; i += 1) {
        await runtime.appendOwnerEvent({
          type: 'experience_confirmed',
          confidence: 'confirmed',
          payload: {
            title: `风格偏好 ${i}`,
            detail: `写作时保持简洁语气与结构完整 ${i}`,
            tags: ['风格', 'document', '结构'],
          },
        });
      }
      const submitted = await runtime.submitTask({
        goal: task.goal,
        contextRefs: [],
        requestedArtifactType: 'document',
      });
      const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
      const elapsed = Date.now() - t0;
      const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
      rows.push({
        policy,
        task: task.name,
        status: job.status,
        modelCalls: calls,
        durationMs: elapsed,
        selectedCount: freeze?.selectedEventIds.length ?? 0,
        experienceCount: (freeze?.entries || []).filter((e) => e.kind === 'experience').length,
        identityCount: (freeze?.entries || []).filter((e) => e.kind === 'identity').length,
      });
      assert.equal(job.status, 'succeeded');
      await runtime.stop();
    }
  }

  const byTask = Object.fromEntries(
    tasks.map((t) => {
      const legacy = rows.find((r) => r.policy === 'legacy' && r.task === t.name)!;
      const ai = rows.find((r) => r.policy === 'ai_first' && r.task === t.name)!;
      return [
        t.name,
        {
          legacySelected: legacy.selectedCount,
          aiFirstSelected: ai.selectedCount,
          legacyCalls: legacy.modelCalls,
          aiFirstCalls: ai.modelCalls,
          durationDeltaMs: Number(ai.durationMs) - Number(legacy.durationMs),
        },
      ];
    }),
  );

  await fs.writeFile(
    path.join(evidenceDir, 'ab-comparison.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), rows, byTask }, null, 2),
    'utf8',
  );

  // 核心：调用次数不上升；AI-first 注入条目不高于 legacy
  for (const t of tasks) {
    const c = byTask[t.name] as {
      legacySelected: number;
      aiFirstSelected: number;
      legacyCalls: number;
      aiFirstCalls: number;
    };
    assert.ok(c.aiFirstCalls <= c.legacyCalls);
    assert.ok(c.aiFirstSelected <= c.legacySelected);
  }
});
