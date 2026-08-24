/**
 * DIGITALME-SUBJECT-EXPERIENCE-CLOSURE-01
 * 主体体验闭环：用户能查看「它目前了解的我」，并能用一句话自然纠正；
 * 纠正走既有 correction/supersede/inactiveEventIds/Growth Closed Loop；
 * 纠正后旧值立即不再展示、不再注入；新值参与后续相关任务；无关任务不注入；外部搜索事实不入本人认识。
 *
 * 0 新增 Subject Store / 0 第二真值源 / 0 schema 扩展 / 0 确认队列。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { buildSubjectContextPackage } from '../subject-context-package';
import { collectInactiveEventIds } from '../derive-all';
import type { GrowthEvent } from '../growth-event';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-expclosure-${prefix}-`));
}

async function newSubject(prefix: string) {
  const root = await tempDir(prefix);
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  const pkgDir = path.join(root, 'pkg');
  await runtime.createPackage({ displayName: '体验闭环主体', targetDir: pkgDir });
  return { runtime, pkgDir };
}

async function appendConfirmed(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
  type: string,
  title: string,
  detail: string,
  tags: string[] = [],
) {
  return runtime.appendOwnerEvent({
    type: type as GrowthEvent['type'],
    confidence: 'confirmed',
    payload: { title, detail, tags },
  });
}

async function overviewFacts(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
): Promise<string[]> {
  const overview = await runtime.getOverview();
  return (overview.userVisibleFacts || []).map((f) => f.text);
}

test('CASE1: 纠正偏好 A→B — 旧值立即不展示、不注入；新值进入相关任务上下文', async () => {
  const { runtime } = await newSubject('case1');
  const prefA = await appendConfirmed(runtime, 'preference_observed', '偏好：周报简洁', '写周报要简短、结论先行', [
    'preference',
    'document',
    '周报',
  ]);
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');

  // Before：当前理解展示 A。
  const before = await overviewFacts(runtime);
  assert.ok(before.some((t) => t.includes('周报简洁')), '纠正前展示偏好 A');

  // 用户自然纠正：不是 A，是 B。
  await runtime.respondToLearning({
    eventId: prefA.id,
    action: 'revise',
    revisionText: '偏好：周报完整：写周报要完整详实、覆盖充分',
  });

  // UI 当前理解立即变 B；A 不再展示。
  const after = await overviewFacts(runtime);
  assert.ok(after.some((t) => t.includes('周报完整')), '纠正后展示新偏好 B');
  assert.ok(!after.some((t) => t.includes('周报简洁')), '纠正后旧值 A 不再展示');

  // 旧值 A inactive。
  const events = await runtime.subject.listGrowthEvents();
  assert.ok(collectInactiveEventIds(events).includes(prefA.id), '旧值 A 被标记 inactive');

  // 相关 Do task 注入 B，不使用 A。
  const pkg = buildSubjectContextPackage({
    goal: '写一份产品周报',
    requestedArtifactType: 'document',
    derived: await runtime.subject.getDerived(),
    policy: 'ai_first',
  });
  const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference].map((e) => e.title + e.detail);
  assert.ok(all.some((t) => t.includes('周报完整')), '相关任务使用新偏好 B');
  assert.ok(!all.some((t) => t.includes('周报简洁')), '相关任务不再使用旧偏好 A');
  assert.ok(pkg.excludedEventIds.includes(prefA.id), 'A 在注入时被排除');

  // 对话模型请求上下文（Talk 真实路径）同样使用 B，不再使用 A。
  const ctx = await runtime.buildConversationSubjectContext();
  assert.equal(ctx.ok, true);
  const system = runtime.buildConversationSystemContent({
    subjectContext: (ctx as { text: string }).text,
    growthGuide: '',
  });
  assert.ok(system.includes('周报完整'), '对话上下文使用新偏好 B');
  assert.ok(!system.includes('周报简洁'), '对话上下文不再使用旧偏好 A');

  await runtime.stop();
});

test('CASE2: 纠正项目定位 — 下一项目介绍自动体现新定位', async () => {
  const { runtime } = await newSubject('case2');
  const oldPos = await appendConfirmed(
    runtime,
    'goal_updated',
    '项目定位：工具型产品',
    '把这个项目定位为效率工具',
    ['goal', 'project:alpha'],
  );

  // 用户纠正定位。
  await runtime.respondToLearning({
    eventId: oldPos.id,
    action: 'revise',
    revisionText: '项目定位：平台型产品：把这个项目定位为开放平台',
  });

  const events = await runtime.subject.listGrowthEvents();
  assert.ok(collectInactiveEventIds(events).includes(oldPos.id), '旧定位 inactive');

  const pkg = buildSubjectContextPackage({
    goal: '介绍这个项目给新用户',
    requestedArtifactType: 'document',
    derived: await runtime.subject.getDerived(),
    policy: 'ai_first',
  });
  const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference].map((e) => e.title + e.detail);
  assert.ok(all.some((t) => t.includes('平台型产品')), '下一项目介绍体现新定位');
  assert.ok(!all.some((t) => t.includes('工具型产品')), '不再体现旧定位');

  await runtime.stop();
});

test('CASE3: 完全无关任务 — 不注入上述纠正', async () => {
  const { runtime } = await newSubject('case3');
  const prefA = await appendConfirmed(runtime, 'preference_observed', '偏好：简洁表达', '写作要简短、结论先行', [
    'preference',
    'document',
  ]);
  await runtime.respondToLearning({
    eventId: prefA.id,
    action: 'revise',
    revisionText: '偏好：完整详实：写作要覆盖充分、展开细节',
  });

  // 完全无关的稳定知识任务。
  const pkg = buildSubjectContextPackage({
    goal: '解释什么是差分隐私',
    requestedArtifactType: 'document',
    derived: await runtime.subject.getDerived(),
    policy: 'ai_first',
  });
  const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference].map((e) => e.title + e.detail);
  assert.ok(!all.some((t) => t.includes('完整详实') || t.includes('简洁表达')), '无关任务不注入纠正');

  await runtime.stop();
});

test('CASE4: 外部 Search 事实 — 不进入「它了解的我」', async () => {
  const { runtime } = await newSubject('case4');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  // 外部网页断言（搜索引擎页面的观点），不属于本人事实。
  await appendConfirmed(runtime, 'experience_confirmed', '外部观点：某技术将被淘汰', '来自外部搜索页面的行业观点', [
    'category:external_claim',
  ]);
  // 任务临时上下文也不属于长期本人认识。
  await appendConfirmed(runtime, 'boundary_updated', '临时范围', '仅本次任务的临时要求', [
    'category:temporary_context',
    'expiresAt:2099-01-01T00:00:00.000Z',
  ]);

  const facts = await overviewFacts(runtime);
  assert.ok(facts.some((t) => t.includes('产品负责人')), '本人事实正常展示');
  assert.ok(!facts.some((t) => t.includes('某技术将被淘汰')), '外部搜索观点不得进入「它了解的我」');
  assert.ok(!facts.some((t) => t.includes('临时范围')), '任务临时上下文不得进入「它了解的我」');
  assert.ok(facts.every((t) => !/gevt_|confidence|eventId/.test(t)), '不展示内部标识');

  await runtime.stop();
});

test('CASE5 (欢迎自我介绍): 初始自我介绍进入权威 capture 链，单一真值', async () => {
  const root = await tempDir('welcome');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  const pkgDir = path.join(root, 'pkg');
  // 与 electron/default-package.cjs 相同入口：createPackage 带 initialSelfDescription。
  await runtime.createPackage({
    displayName: '我的数字之我',
    targetDir: pkgDir,
    initialSelfDescription: '我最近在做一个本地优先的产品，重视真实用户价值。',
  });

  const events = await runtime.subject.listGrowthEvents();
  // 自我介绍必须进入成长链（候选或确认），不是独立 manifest 之外的第二个真值源。
  assert.ok(events.length > 0, '自我介绍进入权威 capture 链');
  const introEvent = events.find(
    (e) =>
      e.source.kind === 'owner_direct' &&
      /本地优先/.test(`${e.payload.title} ${e.payload.detail}`),
  );
  assert.ok(introEvent, '自我介绍文本以成长事件进入同一链');

  const overview = await runtime.getOverview();
  // 若已确认则出现在「它了解的我」；未确认则至少进入候选（不要求强制确认）。
  const facts = (overview.userVisibleFacts || []).map((f) => f.text);
  const candidates = (overview.candidateExperiences || []).map((c) => `${c.title} ${c.detail}`);
  const pool = [...facts, ...candidates].join(' ');
  assert.ok(/本地优先/.test(pool), '自我介绍进入本人认识或候选链，单一真值来源');

  await runtime.stop();
});

test('CASE6 (渲染面): 「它目前了解的我」入口存在；不恢复确认队列；无内部机制外泄', async () => {
  const rendererDir = path.join(__dirname, '..', '..', '..', 'electron', 'renderer');
  const html = await fs.readFile(path.join(rendererDir, 'index.html'), 'utf8');
  const app = await fs.readFile(path.join(rendererDir, 'app.js'), 'utf8');
  const css = await fs.readFile(path.join(rendererDir, 'styles.css'), 'utf8');

  // 轻入口存在。
  assert.ok(html.includes('btn-growth-understanding'), '「它目前了解的我」入口按钮存在');
  assert.ok(html.includes('growth-understanding'), '理解子页存在');
  assert.ok(html.includes('它目前了解的我'), '自然语言标题存在');

  // 入口只展示 userVisibleFacts（已裁剪、当前有效），不恢复候选确认队列。
  assert.ok(app.includes('renderUnderstandingList'), '渲染函数接线');
  assert.ok(app.includes('overview.userVisibleFacts'), '使用与对话模型共用的裁剪事实源');

  // 修改用内联编辑，不引入逐条确认队列文案（无「确认采用/待确认 N 条」类负担）。
  assert.ok(app.includes('openInlineEdit'), '内联修改接线');
  assert.ok(!app.includes('你有'), '不引入「你有 N 条」式确认队列负担');

  // 理解条目展示只输出裁剪事实文本，不把 eventId / confidence 之类内部字段拼进用户可见文本。
  assert.ok(
    /textNode\.textContent = String\(item\.text \|\| ""\)/.test(app),
    '理解条目仅展示裁剪事实文本',
  );
  assert.ok(!/innerHTML = `.*\$\{item\.eventId/.test(app), '不把 eventId 拼入展示 DOM');

  // HTML 结构不包含内部机制术语。
  for (const term of ['GrowthEvent', 'SubjectPackage', 'supersede', 'inactiveEventIds']) {
    assert.equal(html.includes(term), false, term);
  }
});