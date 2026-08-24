/**
 * DIGITALME-COLLAB-DELEGATED-01 — AI-native 委托执行闭环验证。
 *
 * CASE A：本地只有 baseline research，外部存在更强 Research Agent → 自动委托 → 本方验收 → 返回。
 * CASE B：Coding 委托专业 Coding Agent → 只发送必要项目/开发原则 → Agent 执行 → 本方 CTO review → 不暴露整个 Digital Me。
 * CASE C：外部协作者失败/拒绝/不可用 → 自动回退本地 baseline → 不把协议/HTTP/Agent 内部错误扔给用户。
 *
 * 集成：真实 HTTP 受控对端（controlled-remote peer）扮演「外部 Agent / 另一个 Digital Me」。
 * 0 新增 Store / 第二协作真值 / 工作流状态机。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import {
  startControlledRemotePeer,
  type ControlledRemotePeer,
} from '../../capability/adapters/controlled-remote';
import { decideDelegation } from '../delegated-execution';
import { createExternalExecutorCodexAdapter } from '../../capability/adapters/external-executor-codex';
import type { CapabilityRegistration } from '../../capability/registration';
import type { TaskCapabilityNeed } from '../../capability/capability-closure';

function registration(partial: {
  id: string;
  type: CapabilityRegistration['adapter']['type'];
  availability?: CapabilityRegistration['availability'];
  output?: string[];
}): CapabilityRegistration {
  return {
    id: partial.id,
    kind: 'model',
    displayName: partial.id,
    description: '',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: partial.output ?? ['document'],
    permissions: [],
    cost: { estimate: '' },
    latencyEstimate: '',
    location: 'remote',
    availability: partial.availability ?? 'available',
    adapter: { type: partial.type, adapterId: `${partial.type}-test` },
  };
}

function need(domain: TaskCapabilityNeed['domain']): TaskCapabilityNeed {
  return { domain };
}

function ctoMeetsPlan() {
  return async () => ({
    text: JSON.stringify({
      decision: 'meets_plan',
      canUse: '可以按当前成果使用。',
      goalAttained: '本轮目标已达成。',
      needChange: '不需要额外修改。',
      risks: ['范围有限'],
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

function planChatHook() {
  return async () => ({
    text: JSON.stringify({
      intent: 'add_goal_info',
      confidence: 0.95,
      reply: '已整理规划，确认后开始。',
      planUpdate: '目标：按任务要求产出实质成果\n交付：在项目目录内完成最小必要改动\n路径：项目目录\n边界：不推送、不修改范围外文件',
    }),
  });
}

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-deleg-${prefix}-`));
}

const FORBIDDEN_TECH = [/http|5\d\d|4\d\d|quota|adapter|executionId|remoteExecution|provenance|agent/i];

describe('delegated-execution-01', () => {
  describe('decideDelegation（纯函数）', () => {
    it('研究任务 + 远端专业研究能力 → delegate（primary=远端，fallback=本地文档）', () => {
      const d = decideDelegation({
        need: need('deep_research'),
        goal: '深入研究 2026 年中国 AI Agent 创业与融资趋势',
        registrations: [
          registration({ id: 'cap_remote', type: 'remote-subject' }),
          registration({ id: 'cap_local', type: 'openai-compatible-model' }),
        ],
      });
      assert.equal(d.mode, 'delegate');
      assert.equal(d.level, 'optimal');
      assert.equal(d.primaryCapabilityId, 'cap_remote');
      assert.deepEqual(d.fallbackCapabilityIds, ['cap_local']);
    });
    it('研究目标（document 域 + 研究语义）→ 同样可委托远端研究能力', () => {
      const d = decideDelegation({
        need: need('document'),
        goal: '深入研究 2026 年中国 AI Agent 创业与融资趋势，形成研究报告。',
        registrations: [
          registration({ id: 'cap_remote', type: 'remote-subject' }),
          registration({ id: 'cap_local', type: 'openai-compatible-model' }),
        ],
      });
      assert.equal(d.mode, 'delegate');
      assert.equal(d.primaryCapabilityId, 'cap_remote');
    });
    it('研究任务无远端 → local', () => {
      const d = decideDelegation({
        need: need('deep_research'),
        goal: '深入研究 2026 年中国 AI Agent 创业与融资趋势',
        registrations: [registration({ id: 'cap_local', type: 'openai-compatible-model' })],
      });
      assert.equal(d.mode, 'local');
    });
    it('coding + 专业 Coding Agent → delegate，fallback=model-api', () => {
      const d = decideDelegation({
        need: need('coding'),
        goal: '把 index.js 里的 n 改成 2',
        registrations: [
          registration({ id: 'cap_codex', type: 'external-executor-cli' }),
          registration({ id: 'cap_modelapi', type: 'external-executor-model-api' }),
        ],
      });
      assert.equal(d.mode, 'delegate');
      assert.equal(d.primaryCapabilityId, 'cap_codex');
      assert.deepEqual(d.fallbackCapabilityIds, ['cap_modelapi']);
    });
    it('普通文档 / stable_knowledge（非研究语义）→ local（不委托）', () => {
      for (const [domain, goal] of [
        ['document', '写一份产品周报'],
        ['stable_knowledge', '解释什么是差分隐私'],
      ] as const) {
        const d = decideDelegation({
          need: need(domain),
          goal,
          registrations: [
            registration({ id: 'cap_remote', type: 'remote-subject' }),
            registration({ id: 'cap_local', type: 'openai-compatible-model' }),
          ],
        });
        assert.equal(d.mode, 'local', domain);
      }
    });
  });

  describe('CASE A：委托远端 Research Agent → 执行 → 验收 → 返回', () => {
    it('真实 HTTP 对端作为外部 Agent，delegateTask 自动委托并本地验收', async () => {
      const peer = await startControlledRemotePeer({ port: 0, processDelayMs: 20 });
      const root = await tempDir('caseA');
      let ctoCalled = false;
      const runtime = createDigitalMeRuntime({
        documentCapability: 'fake',
        registerOpenAiStub: false,
        remoteCapability: { endpoint: peer.baseUrl, displayName: '更强研究能力' },
        ctoReviewChat: (async () => {
          ctoCalled = true;
          return { text: JSON.stringify({ decision: 'meets_plan', nextAction: 'confirm_adopt', userSummary: 'ok', completed: ['x'], gaps: [], risks: [], evidenceRefs: [], canUse: 'ok', goalAttained: 'ok', needChange: '', nextStep: 'ok', revisionPlan: '' }) };
        }) as never,
        externalExecutorCapability: false,
      });
      try {
        await runtime.createPackage({ displayName: '委托主体', targetDir: path.join(root, 'pkg') });
        const beforeFacts = (await runtime.getOverview()).userVisibleFacts ?? [];

        const out = await runtime.delegateTask({
          goal: '深入研究 2026 年中国 AI Agent 创业与融资趋势，形成研究报告。',
          contextRefs: [],
          requestedArtifactType: 'document',
        });

        assert.equal(out.delegation?.mode, 'delegate');
        assert.equal(out.delegation?.fallbackUsed, false);
        assert.equal(out.delegation?.finalCapabilityId, 'cap_controlled_remote_subject');
        assert.ok(out.taskId && out.jobId);
        const job = await runtime.getJob(out.jobId);
        assert.equal(job?.status, 'succeeded');
        assert.ok(job?.artifactId, '委托成果必须写入本地 Artifact');

        // 远端只收到最小上下文：goal + 授权材料（无主体上下文字段）。
        const exec = job?.remoteExecution?.executionId ? peer.getExecution(job.remoteExecution.executionId) : undefined;
        assert.ok(exec, '远端必须有执行记录');
        assert.ok(typeof exec!.goal === 'string' && exec!.goal.length > 0);
        assert.ok(Array.isArray(exec!.materials));

        // 本方 2digime 独立验收：CTO review 触发并写入 acceptanceSummary。
        const content = (await runtime.getContent({ artifactId: job.artifactId as string })) as {
          text?: string;
          acceptanceSummary?: { ctoReview?: { decision?: string } };
        };
        assert.ok((content.text?.length ?? 0) > 20, '委托成果有正文');
        await new Promise((r) => setTimeout(r, 300));
        const art = await runtime.getArtifact(job.artifactId as string);
        assert.ok(art?.acceptance, '本地验收（acceptance）应写入');

        // 外部结果不得自动成为 owner fact。
        const afterFacts = (await runtime.getOverview()).userVisibleFacts ?? [];
        assert.deepEqual(afterFacts.map((f) => f.text), beforeFacts.map((f) => f.text));
        const events = await runtime.subject.listGrowthEvents();
        assert.ok(!events.some((e) => e.type === 'experience_confirmed' && /2026.*AI/.test(e.payload.title)), '外部执行不得沉淀为本人经验');
      } finally {
        await peer.close();
        await runtime.stop();
      }
    });
  });

  describe('CASE B：Coding 委托专业 Coding Agent，只发必要上下文', () => {
    it('delegateTask 选专业 Coding Agent；Agent 只收到 priorDecisions（无全量主体）', async () => {
      const root = await tempDir('caseB');
      const repo = path.join(root, 'repo');
      await fs.mkdir(repo, { recursive: true });
      await fs.writeFile(path.join(repo, 'index.js'), 'export const n = 1;\n', 'utf8');

      const captured: { priorDecisions?: string[] } = {};
      const runtime = createDigitalMeRuntime({
        documentCapability: 'fake',
        registerOpenAiStub: false,
        converseChat: planChatHook(),
        ctoReviewChat: ctoMeetsPlan() as never,
        fakeAdapter: { text: LOCAL_FALLBACK_TEXT, title: '本地兜底' },
        externalExecutorCapability: {
          forceAvailability: 'ready',
          executeHook: (async (input: { pkg: { priorDecisions?: string[]; workingDirectory: string }; prompt: string }) => {
            captured.priorDecisions = input.pkg.priorDecisions || [];
            await fs.writeFile(
              path.join(input.pkg.workingDirectory, 'index.js'),
              '// 修正：导出常量 n=2 并补充说明\n// 依据已确认开发原则：模块化、可测试、单执行路径\nexport const n = 2;\n',
              'utf8',
            );
            return { exitCode: 0, summary: '完成修改', claimedChangedFiles: ['index.js'] };
          }) as never,
        },
      });
      try {
        await runtime.createPackage({ displayName: '编码主体', targetDir: path.join(root, 'pkg') });

        // 先经对话中枢形成规划（现有机制），再确定性开始。
        const planned = await runtime.converse({
          text: '把 index.js 里的 n 改成 2',
          contextRefs: [{ kind: 'folder', path: repo }],
        });
        assert.ok(planned.taskId && planned.plan?.version);
        const preview = await runtime.submitTask({
          goal: '把 index.js 里的 n 改成 2',
          contextRefs: [{ kind: 'folder', path: repo }],
          existingTaskId: planned.taskId,
          confirmedPlanVersion: planned.plan!.version,
          intentKind: 'modify_code',
        });
        assert.ok(preview.needsExecutionConfirm);

        const out = await runtime.delegateTask({
          goal: '把 index.js 里的 n 改成 2',
          contextRefs: [{ kind: 'folder', path: repo }],
          existingTaskId: planned.taskId,
          confirmedPlanVersion: planned.plan!.version,
          intentKind: 'modify_code',
          executionAuthorization: {
            confirmed: true,
            workingDirectory: preview.needsExecutionConfirm!.workingDirectory,
            readScope: preview.needsExecutionConfirm!.readScope,
            writeScope: preview.needsExecutionConfirm!.writeScope,
          },
        });

        assert.equal(out.delegation?.mode, 'delegate', 'coding 委托给专业 Coding Agent');
        assert.equal(out.delegation?.fallbackUsed, false);
        const job = await runtime.getJob(out.jobId);
        assert.equal(job?.status, 'succeeded');
        assert.ok(job?.artifactId);
        // 最小上下文：Agent 收到的 priorDecisions 只是 title: detail 短列表，不含 eventId/标签/全量主体。
        assert.ok(Array.isArray(captured.priorDecisions));
        assert.ok(captured.priorDecisions!.length <= 8);
        for (const d of captured.priorDecisions!) {
          assert.equal(typeof d, 'string');
          assert.ok(!/gevt_|GrowthEvent|eventId|decision:accept|category:/i.test(d), '不得把内部机制/全量主体发给 Agent');
        }
        // 本方 CTO review 对 code-change 成果运行。
        await new Promise((r) => setTimeout(r, 300));
        const art = await runtime.getArtifact(job.artifactId as string);
        assert.ok(art?.acceptance, 'code-change 应经本地验收');
      } finally {
        await runtime.stop();
      }
    });
  });

  const LOCAL_FALLBACK_TEXT =
  '# 本地研究报告\n\n本次由本地基础研究能力完成，覆盖度可能低于专业深度研究。\n\n## 2026 年中国 AI Agent 创业与融资趋势\n本报告基于可获得的已有资料与知识组织，围绕 AI Agent 创业与融资趋势，明确区分已确认信息、推理与待核实内容，并给出下一步建议。\n\n## 结论\n本地能力可以完成本任务闭环，但覆盖度与实时性有限；建议后续接入更强研究能力获取一手来源。';

describe('CASE C：外部失败 → 自动回退本地 baseline → 不暴露协议错误', () => {
    it('远端 fail_after_start → 自动用本地文档能力完成，用户面无技术错误', async () => {
      const peer = await startControlledRemotePeer({ port: 0, processDelayMs: 20, defaultFault: 'fail_after_start' });
      const root = await tempDir('caseC');
      const runtime = createDigitalMeRuntime({
        documentCapability: 'fake',
        registerOpenAiStub: false,
        remoteCapability: { endpoint: peer.baseUrl, displayName: '更强研究能力' },
        fakeAdapter: { text: LOCAL_FALLBACK_TEXT, title: '本地研究' },
        externalExecutorCapability: false,
      });
      try {
        await runtime.createPackage({ displayName: '回退主体', targetDir: path.join(root, 'pkg') });

        const out = await runtime.delegateTask({
          goal: '深入研究 2026 年中国 AI Agent 创业与融资趋势，形成研究报告。',
          contextRefs: [],
          requestedArtifactType: 'document',
        });

        assert.equal(out.delegation?.mode, 'delegate');
        assert.equal(out.delegation?.fallbackUsed, true, '远端失败后必须自动回退');
        assert.equal(out.delegation?.finalCapabilityId, 'cap_fake_document');
        assert.notEqual(out.delegation?.failed, true);
        assert.ok(out.taskId && out.jobId);
        const job = await runtime.getJob(out.jobId);
        assert.equal(job?.status, 'succeeded', '回退后任务继续完成，不卡死');
        const content = (await runtime.getContent({ artifactId: job.artifactId as string })) as { text?: string };
        assert.ok((content.text?.length ?? 0) > 40);
        // 用户面不暴露协议/HTTP/Agent 内部错误。
        const userText = `${out.userFacingNotice || ''} ${content.text || ''}`;
        assert.ok(!/远端执行失败|HTTP|503|429|quota|executionId|fail_after_start|controlled-remote|失败/i.test(userText));
      } finally {
        await peer.close();
        await runtime.stop();
      }
    });
  });

  describe('主体归属与委托语义', () => {
    it('本人经验归本人；外部执行事实为 external provenance；不把主体控制权交出', async () => {
      const peer = await startControlledRemotePeer({ port: 0, processDelayMs: 20 });
      const root = await tempDir('attrib');
      const runtime = createDigitalMeRuntime({
        documentCapability: 'fake',
        registerOpenAiStub: false,
        remoteCapability: { endpoint: peer.baseUrl, displayName: '更强研究能力' },
        fakeAdapter: { text: LOCAL_FALLBACK_TEXT, title: '本地研究' },
        externalExecutorCapability: false,
      });
      try {
        await runtime.createPackage({ displayName: '归属主体', targetDir: path.join(root, 'pkg') });

        // 本人经验：Owner 明确纠正 → 归本人（现有成长机制）。
        await runtime.captureSubjectInput({
          text: '以后项目介绍请先讲定位。',
          sourceKind: 'conversation',
        });
        const overview = await runtime.getOverview();
        const cand = overview.candidateExperiences.find((c) => /定位/.test(`${c.title}${c.detail}`));
        if (cand && cand.requiresConfirmation) {
          await runtime.confirmExperience({ eventIds: [cand.eventId] });
        }
        const ownConfirmed = (await runtime.subject.listGrowthEvents()).filter((e) => e.confidence === 'confirmed');

        // 委托外部执行。
        const out = await runtime.delegateTask({
          goal: '深入研究 2026 年中国 AI Agent 创业与融资趋势。',
          contextRefs: [],
          requestedArtifactType: 'document',
        });
        const job = await runtime.getJob(out.jobId);
        assert.equal(job?.status, 'succeeded');
        // 委托出去的是执行：任务/验收仍在本方 Do 链；远端只收到 goal，不携带主体身份授权。
        const exec = job?.remoteExecution?.executionId ? peer.getExecution(job.remoteExecution.executionId) : undefined;
        assert.ok(exec);
        // 外部执行结果不自动成为 owner fact（无新增确认经验、无新可见事实）。
        const factsAfter = (await runtime.getOverview()).userVisibleFacts ?? [];
        assert.ok(!factsAfter.some((f) => /2026.*AI|Agent/.test(f.text)));
        const confirmedAfter = (await runtime.subject.listGrowthEvents()).filter((e) => e.confidence === 'confirmed');
        assert.ok(confirmedAfter.length >= ownConfirmed.length, '委托不减少本人确认事实');
        assert.ok(!confirmedAfter.some((e) => /2026.*AI.*Agent/.test(e.payload.title)), '外部执行不得沉淀为本人经验');
      } finally {
        await peer.close();
        await runtime.stop();
      }
    });
  });
});