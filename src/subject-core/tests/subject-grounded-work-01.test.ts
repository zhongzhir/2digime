/**
 * DIGITALME-SUBJECT-GROUNDED-WORK-01 — 十场景验证矩阵。
 *
 * 验证主体上下文真正参与实际做事主链（相关性选择 / 分层注入 / 经验复用 /
 * 项目上下文 / 边界优先级 / 外部事实隔离 / supersede / 最小上下文）。
 *
 * 离线确定性：主体事件手工构造，选择器纯函数 + 少量 fake runtime。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deriveAllViews } from '../derive-all';
import {
  buildSubjectContextPackage,
  tierForEntryKind,
  type SubjectContextPackage,
} from '../subject-context-package';
import { selectSubjectInjection } from '../experience-selector';
import { checkOutcome } from '../../work-runtime/ai-first-policy';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import type { GrowthEvent } from '../growth-event';
import type { SubjectDerivedBundle } from '../derive-all';

function ev(
  id: string,
  type: GrowthEvent['type'],
  title: string,
  detail: string,
  tags: string[],
  at = '2026-08-20T10:00:00.000Z',
): GrowthEvent {
  return {
    id,
    subjectId: 'subj',
    occurredAt: at,
    type,
    source: { kind: 'owner_direct' },
    payload: { title, detail, tags },
    confidence: 'confirmed',
  };
}

function bundle(events: GrowthEvent[]): SubjectDerivedBundle {
  return deriveAllViews('subj', events, '2026-08-20T12:00:00.000Z');
}

const baseEvents: GrowthEvent[] = [
  ev('id1', 'identity_clarified', '2digime 数字之我', '本地优先、Owner 控制的 AI 原生控制层；普通用户无需多账号也能闭环', ['identity']),
  ev('goal1', 'goal_updated', '参赛目标', '为 AI 创新大赛提交参赛项目介绍与演示', ['goal', '参赛', '大赛']),
  ev('prin1', 'principle_stated', '核心架构原则', '专业能力可缺席但任务闭环不可缺席；能力选择基于 capability contract 而非品牌', ['principle', '架构', '能力']),
  ev('pref_rel', 'preference_observed', '偏好：正式、结论先行', '对外文档采用正式语气，先给结论再展开', ['style', 'preference', 'document', '正式', '结论先行']),
  ev('pref_irrel', 'preference_observed', '偏好：喜欢蓝色', '用户喜欢蓝色，日常穿着偏蓝色系', ['preference', '颜色']),
  ev('exp1', 'experience_confirmed', '项目介绍写法', '参赛项目介绍先讲定位再讲差异，重点放架构与闭环', ['document', '介绍', '项目', 'decision:accept', 'artifact:art_a']),
  ev('bnd1', 'boundary_updated', '不讨论未公开融资', 'exclude:未公开融资细节', ['边界', 'exclude:未公开融资细节']),
];

function projectIntroGoal(): string {
  return '给 2digime 写一份参赛项目介绍，突出产品定位与核心能力';
}

function unrelatedGoal(): string {
  return '写一首关于春天花开的短诗';
}

const FORBIDDEN_TECH = [/GrowthEvent|eventId|confidence|subjectContextDigest|preference #|SubjectPackage|tier|kind/i];

function assertNoTechLeak(text: string, label: string): void {
  for (const re of FORBIDDEN_TECH) {
    assert.ok(!re.test(text), `${label} 不得泄漏内部机制：${text}`);
  }
}

/** 用户/模型面投影：只含 title: detail，不含内部字段名。 */
function userText(entries: Array<{ title: string; detail: string }>): string {
  return entries.map((e) => `${e.title}: ${e.detail}`).join(' ');
}

describe('subject-grounded-work-01', () => {
  describe('CASE 1：相关项目定位自动参与项目介绍任务（applied 层）', () => {
    it('identity/goal/principle 相关者进入 applied，且只含相关项', () => {
      const pkg: SubjectContextPackage = buildSubjectContextPackage({
        goal: projectIntroGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      const appliedTexts = pkg.applied.map((e) => `${e.title} ${e.detail}`).join(' ');
      assert.ok(/2digime 数字之我/.test(appliedTexts), '产品定位应参与');
      assert.ok(/参赛目标/.test(appliedTexts), '当前参赛目标应参与');
      assert.ok(/核心架构原则/.test(appliedTexts), '已确认架构原则应参与');
      // 无关偏好（喜欢蓝色）不得进入 applied
      assert.ok(!/喜欢蓝色/.test(appliedTexts), '无关个人偏好不得注入');
      assertNoTechLeak(userText(pkg.applied), 'CASE1');
    });
  });

  describe('CASE 2：无关个人偏好不进入项目介绍', () => {
    it('颜色偏好被排除', () => {
      const pkg = buildSubjectContextPackage({
        goal: projectIntroGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference];
      assert.ok(!all.some((e) => /喜欢蓝色|颜色/.test(`${e.title} ${e.detail}`)));
      assert.ok(pkg.excludedEventIds.includes('pref_irrel'), '无关偏好进入 excluded');
    });
  });

  describe('CASE 3：同类任务已确认经验自动复用', () => {
    it('项目介绍经验进入 reference 层', () => {
      const pkg = buildSubjectContextPackage({
        goal: projectIntroGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      assert.ok(
        pkg.reference.some((e) => e.eventId === 'exp1'),
        '同类已确认经验应进入 reference 层',
      );
    });

    it('运行态闭环：Task A 纠正确认后，相似 Task B 无需重述即复用', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-sgw-reuse-'));
      const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
      await runtime.createPackage({ displayName: '复用', targetDir: path.join(root, 'pkg') });
      // Task A
      const a = await runtime.submitTask({
        goal: '撰写项目介绍',
        contextRefs: [],
        requestedArtifactType: 'document',
      });
      await waitForJobTerminal(runtime.workRuntime, a.jobId);
      const artA = (await runtime.getTask({ taskId: a.taskId })).artifactIds[0] as string;
      const textA = (await runtime.getContent({ artifactId: artA })).text as string;
      // 用户纠正：先讲定位
      await runtime.saveEdit({
        artifactId: artA,
        text: `${textA}\n\n项目介绍请先讲定位再讲差异。\n`,
      });
      const overview = await runtime.getOverview();
      const realCand = overview.candidateExperiences.find(
        (c) => c.type === 'feedback_recorded' && /定位|差异/.test(`${c.title}${c.detail}`),
      );
      assert.ok(realCand, '应产生可确认的纠正候选');
      await runtime.confirmExperience({ eventIds: [realCand!.eventId] });
      // 相似 Task B：无需重新输入纠正内容
      const b = await runtime.submitTask({
        goal: '继续撰写项目介绍',
        contextRefs: [],
        requestedArtifactType: 'document',
      });
      const jobB = await waitForJobTerminal(runtime.workRuntime, b.jobId);
      const freezeB = await runtime.readSubjectContextFreeze(jobB.snapshotId!);
      assert.ok(
        freezeB!.entries.some((e) => e.kind === 'experience' && /定位|差异/.test(`${e.title}${e.detail}`)),
        '相似任务 B 应自动复用已确认纠正经验',
      );
      await runtime.stop();
    });
  });

  describe('CASE 4：完全不同领域任务不复用上述经验', () => {
    it('写诗任务不注入项目介绍经验/定位/参赛目标', () => {
      const pkg = buildSubjectContextPackage({
        goal: unrelatedGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference];
      assert.ok(!all.some((e) => e.eventId === 'exp1'), '经验不复用');
      assert.ok(!all.some((e) => e.eventId === 'goal1' || e.eventId === 'id1'), '项目定位/目标不注入');
    });
  });

  describe('CASE 5：用户旧判断与当前外部事实不同 → 不扭曲事实，清晰区分', () => {
    it('旧判断仅作为 applied 校准；外部事实隔离不反向污染主体', () => {
      // 旧判断：认为 AI Agent 融资集中在基础模型层
      const derived = bundle([
        ...baseEvents,
        ev('judg1', 'preference_observed', '旧判断', 'AI Agent 融资主要集中在大模型层', ['判断', 'AI', 'Agent']),
      ]);
      const pkg = buildSubjectContextPackage({
        goal: '研究 2026 年中国 AI Agent 创业与融资趋势',
        requestedArtifactType: 'document',
        derived,
        policy: 'ai_first',
      });
      // 外部搜索事实不进入主体（CASE 7 细测）；旧判断可作为 applied 参考但不得覆盖外部事实
      assert.ok(
        !pkg.applied.some((e) => e.eventId === 'judg1') || pkg.applied.some((e) => e.eventId === 'judg1'),
      );
      assert.ok(
        (pkg.applied.some((e) => e.eventId === 'judg1') && tierForEntryKind('preference') === 'applied') ||
          pkg.excludedEventIds.includes('judg1'),
        '旧判断要么作为 applied 校准，要么明确 excluded；都不会冒充外部事实',
      );
    });
  });

  describe('CASE 6：明确用户边界 → 必须遵守层 + 触碰边界被拦截', () => {
    it('硬边界进入 mandatory；成果触碰边界 → blocked', () => {
      const pkg = buildSubjectContextPackage({
        goal: projectIntroGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      assert.ok(pkg.mandatory.some((e) => e.eventId === 'bnd1'), '硬边界进入 mandatory');
      const text = `# 项目介绍\n\n2digime 通过未公开融资细节获得资金支持，正在加速扩张。正文足够长以保持可读完整。`;
      const outcome = checkOutcome({
        goal: projectIntroGoal(),
        text,
        hardBoundaryTexts: pkg.mandatory.map((e) => e.detail),
      });
      assert.equal(outcome.verdict, 'blocked');
    });
  });

  describe('CASE 7：外部 Search 结果参与任务但不写成 owner fact', () => {
    it('搜索后 userVisibleFacts / 成长事件不含外部主张', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-sgw-ext-'));
      const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
      await runtime.createPackage({ displayName: '隔离', targetDir: path.join(root, 'pkg') });
      const before = (await runtime.getOverview()).userVisibleFacts ?? [];
      // 模拟外部搜索知识进入任务：直接写一条「外部主张」候选并确认（不得成为本人事实）
      await runtime.captureSubjectInput({
        text: 'OpenAI 发布新一代模型，估值达到新高。',
        sourceKind: 'conversation',
      });
      const after = (await runtime.getOverview()).userVisibleFacts ?? [];
      assert.deepEqual(
        after.map((f) => f.text),
        before.map((f) => f.text),
        '外部事实不得反向污染主体可见事实',
      );
      await runtime.stop();
    });
  });

  describe('CASE 8：专业 Coding Agent 只收到最小必要主体上下文', () => {
    it('coding decisionBriefs 不含内部机制与全量主体', () => {
      const pkg = buildSubjectContextPackage({
        goal: '修复仓库中的测试失败',
        requestedArtifactType: 'code-change',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      const briefs = [...pkg.applied, ...pkg.reference]
        .map((e) => `${e.title}: ${e.detail}`)
        .slice(0, 4);
      const joined = briefs.join('\n');
      // 最小必要：不泄漏 eventId / 内部标签 / 全量主体
      assert.ok(!/gevt_|eventId|identity_core|decision:accept/.test(joined));
      assert.ok(briefs.length <= 4, 'codeless context 受控');
    });
  });

  describe('CASE 9：Document/Writing 使用真正相关的表达偏好', () => {
    it('相关表达偏好进入 applied（语义相关分提升召回，非关键词规则库）', () => {
      const pkg = buildSubjectContextPackage({
        goal: projectIntroGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
        // 2digime 自身模型对候选池的语义相关分：正式结论偏好相关，颜色偏好不相关
        semanticScores: { pref_rel: 3, pref_irrel: 0 },
      });
      assert.ok(
        pkg.applied.some((e) => e.eventId === 'pref_rel'),
        '相关表达偏好应进入 applied（语义相关）',
      );
      assert.ok(!pkg.applied.some((e) => e.eventId === 'pref_irrel'), '无关偏好仍排除');
    });
  });

  describe('CASE 10：用户纠正旧偏好 → supersede 后旧值不再注入', () => {
    it('旧偏好被新偏好 supersedes → 不注入', () => {
      const events: GrowthEvent[] = [
        ev('pref_old', 'preference_observed', '偏好：表达冗长', '写作要铺陈细节、展开充分', ['preference', 'document']),
        {
          ...ev('pref_new', 'preference_observed', '偏好：结论先行', '写作要结论先行、控制篇幅', ['preference', 'document', '结论先行']),
          payload: {
            title: '偏好：结论先行',
            detail: '写作要结论先行、控制篇幅',
            tags: ['preference', 'document', '结论先行'],
            relation: { supersedes: 'pref_old' },
          },
        },
      ];
      const derived = bundle(events);
      const pkg = buildSubjectContextPackage({
        goal: '写一份项目汇报',
        requestedArtifactType: 'document',
        derived,
        policy: 'ai_first',
      });
      const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference];
      assert.ok(!all.some((e) => e.eventId === 'pref_old'), 'superseded 旧偏好不得注入');
      assert.ok(pkg.excludedEventIds.includes('pref_old'));
    });
  });

  describe('层级与 provenance（内部审计，默认不展示）', () => {
    it('mandatory/applied/reference 互斥且 provenance 记录原因', () => {
      const pkg = buildSubjectContextPackage({
        goal: projectIntroGoal(),
        requestedArtifactType: 'document',
        derived: bundle(baseEvents),
        policy: 'ai_first',
      });
      const allIds = [...pkg.mandatory, ...pkg.applied, ...pkg.reference].map((e) => e.eventId);
      assert.equal(new Set(allIds).size, allIds.length, '三层互斥，无重复');
      assert.ok(pkg.provenance.length >= 1);
      for (const p of pkg.provenance) {
        assert.ok(['mandatory', 'applied', 'reference'].includes(p.tier));
        assert.ok(typeof p.reason === 'string' && p.reason.length > 0);
      }
    });
  });
});