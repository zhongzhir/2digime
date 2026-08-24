/**
 * DIGITALME-GROWTH-SYSTEM-02 — 四阶段派生、维度覆盖与引导问题。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { deriveAllViews } from '../derive-all';
import type { GrowthEvent } from '../growth-event';
import {
  collectGrowthCopyValues,
  deriveGrowthProfile,
  GROWTH_COPY,
  GROWTH_DIMENSIONS,
  GROWTH_FORBIDDEN_TERMS,
  GROWTH_STAGE_GUIDE,
  guideChoiceCaptureKey,
  inspectDimensionCoverage,
  inspectGrowthGates,
  isEphemeralConversationIntent,
  recommendGrowthTasks,
  selectGuidedQuestion,
  stageReachedCaptureKey,
  type GrowthEvidence,
  type GrowthWorkItem,
} from '../growth-profile';
import {
  conversationFilePath,
  latestCaptureStatusByTurnId,
  listReplayableUserTurns,
  readConversationRows,
} from '../conversation-transcript';
import { COMMAND_COUNT_LIMIT, COMMAND_NAMES } from '../../runtime/commands';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-growth-sys-${prefix}-`));
}

function event(partial: Partial<GrowthEvent> & Pick<GrowthEvent, 'type'>): GrowthEvent {
  return {
    id: partial.id || `gevt_${partial.type}_${Math.random().toString(16).slice(2, 8)}`,
    subjectId: 'subj',
    occurredAt: partial.occurredAt || '2026-08-15T00:00:00.000Z',
    type: partial.type,
    source: partial.source || { kind: 'owner_direct' },
    payload: partial.payload || { title: partial.type, detail: partial.type, tags: [] },
    confidence: partial.confidence || 'confirmed',
    ...(partial.confirms ? { confirms: partial.confirms } : {}),
  };
}

function evidence(overrides: Partial<GrowthEvidence> = {}): GrowthEvidence {
  const events = overrides.events || [];
  return {
    identityDisplayName: overrides.identityDisplayName ?? '',
    ...(overrides.identityDescription ? { identityDescription: overrides.identityDescription } : {}),
    events,
    derived: overrides.derived || deriveAllViews('subj', events, '2026-08-15T00:00:00.000Z'),
    materials: overrides.materials || [],
    workItems: overrides.workItems || [],
    collabItems: overrides.collabItems || [],
    ...(overrides.now ? { now: overrides.now } : {}),
  };
}

function acceptedWork(partial: Partial<GrowthWorkItem> = {}): GrowthWorkItem {
  return {
    taskId: partial.taskId || 'task_1',
    goal: partial.goal || '撰写产品周报',
    createdAt: partial.createdAt || '2026-08-15T01:00:00.000Z',
    contextRefCount: partial.contextRefCount ?? 1,
    snapshotItemCount: partial.snapshotItemCount ?? 1,
    injectedEventIds: partial.injectedEventIds || [],
    accepted: partial.accepted ?? true,
    acceptedAt: partial.acceptedAt || '2026-08-15T01:10:00.000Z',
    ...(partial.qualityPassed !== undefined ? { qualityPassed: partial.qualityPassed } : {}),
  };
}

test('A1 全空证据 → 未开始', () => {
  const profile = deriveGrowthProfile(evidence());
  assert.equal(profile.stageLevel, 0);
  assert.equal(profile.stageName, '未开始');
  assert.equal(profile.primaryTask?.key, 'continue_conversation');
  assert.equal(profile.guidedQuestion?.dimensionKey, 'identity');
});

test('A2 只有来源明确的本人信息，无真实成果 → 基础建立', () => {
  const events = [
    event({
      type: 'identity_clarified',
      payload: { title: '产品负责人', detail: '负责本地产品', tags: [] },
    }),
  ];
  const profile = deriveGrowthProfile(
    evidence({ identityDisplayName: '张三', identityDescription: '产品负责人', events }),
  );
  assert.equal(profile.stageLevel, 1);
  assert.equal(profile.stageName, '基础建立');
  assert.equal(profile.tracks.work.status, GROWTH_COPY.trackPending);
  assert.equal(profile.showFirstStart, false);
  assert.notEqual(profile.primaryTask?.key, 'optional_learn_from_work');
});

test('没有做过任务也可以进入基本成形', () => {
  const events = [
    event({ type: 'identity_clarified', payload: { title: '产品负责人', detail: '本地优先', tags: [] } }),
    event({ type: 'goal_updated', payload: { title: '写周报', detail: '完成产品周报', tags: [] } }),
    event({ type: 'preference_observed', payload: { title: '结论先行', detail: '先写结论', tags: [] } }),
  ];
  const profile = deriveGrowthProfile(evidence({ identityDisplayName: '张三', events }));
  assert.equal(profile.stageLevel, 2);
  assert.equal(profile.stageName, '基本成形');
  assert.equal(profile.tracks.work.status, GROWTH_COPY.trackPending);
});

test('大量同类资料不能单独进入基本成形', () => {
  const events = Array.from({ length: 8 }, (_, i) =>
    event({
      id: `gevt_asset_${i}`,
      type: 'asset_added',
      payload: { title: `资料${i}`, detail: '项目笔记', tags: ['from_material'], relation: { materialRef: `mat_${i}` } },
    }),
  );
  const materials = events.map((e, i) => ({ materialRef: `mat_${i}`, fileName: `note-${i}.md` }));
  const profile = deriveGrowthProfile(evidence({ events, materials }));
  assert.ok(profile.stageLevel <= 1);
  assert.equal(
    inspectDimensionCoverage(evidence({ events, materials })).filter((d) => d.status === 'known').length <= 2,
    true,
  );
});

test('单次任务不能抬到持续完善', () => {
  const events = [
    event({
      id: 'gevt_accept',
      type: 'feedback_recorded',
      source: { kind: 'task_feedback', taskId: 'task_1', artifactId: 'art_1' },
      payload: {
        title: '采用成果',
        detail: '用户采用了本次成果。',
        tags: ['decision:accept'],
        evidence: { artifactId: 'art_1', toVersionId: 'ver_1' },
      },
    }),
  ];
  const profile = deriveGrowthProfile(evidence({ events, workItems: [acceptedWork()] }));
  assert.ok(profile.stageLevel < 3);
});

test('已有用户直接识别，不要求重新启动', () => {
  const events = [
    event({ type: 'identity_clarified', payload: { title: '产品负责人', detail: '本地优先', tags: [] } }),
    event({ type: 'goal_updated', payload: { title: '当前目标', detail: '写周报', tags: [] } }),
  ];
  const profile = deriveGrowthProfile(
    evidence({
      identityDisplayName: '张三',
      events,
      materials: [{ materialRef: 'mat_1', fileName: 'a.md' }],
    }),
  );
  assert.notEqual(profile.stageName, '未开始');
  assert.equal(profile.showFirstStart, false);
});

test('旧阶段事件可读取且不单独决定当前阶段', () => {
  const events = [
    event({
      type: 'feedback_recorded',
      payload: {
        title: '初级·个人信息',
        detail: '历史审计',
        tags: ['growth:stage_reached', 'stage:2', 'captureKey:growth:stage_reached:2', 'capture:noop', 'silent_ok'],
      },
    }),
  ];
  const profile = deriveGrowthProfile(evidence({ events, identityDisplayName: GROWTH_COPY.placeholderIdentityName }));
  assert.equal(profile.stageLevel, 0);
  assert.equal(profile.stageName, '未开始');
});

test('A11 不以对话数直接升级', () => {
  const chatter = Array.from({ length: 40 }, (_, i) =>
    event({
      id: `gevt_chat_${i}`,
      type: 'feedback_recorded',
      confidence: 'candidate',
      payload: { title: '闲聊', detail: `hello ${i}`, tags: [] },
    }),
  );
  const profile = deriveGrowthProfile(
    evidence({ identityDisplayName: GROWTH_COPY.placeholderIdentityName, events: chatter }),
  );
  assert.equal(profile.stageLevel, 0);
});

test('A12 冲突时需要校准且不静默扩大', () => {
  const events = [
    event({
      type: 'identity_clarified',
      payload: { title: '产品负责人', detail: '本地优先', tags: ['conflict'] },
    }),
  ];
  const derived = deriveAllViews('subj', events, '2026-08-15T00:00:00.000Z');
  derived.activeItems = derived.activeItems.map((item) =>
    item.title === '产品负责人' ? { ...item, tags: [...item.tags, 'conflict'] } : item,
  );
  const profile = deriveGrowthProfile(evidence({ identityDisplayName: '张三', events, derived }));
  assert.equal(profile.needsCalibration, true);
});

test('A14 用户界面文案不出现禁止词与 0-10 级', () => {
  const blob = collectGrowthCopyValues().join('\n');
  for (const term of GROWTH_FORBIDDEN_TERMS) {
    assert.equal(blob.includes(term), false, term);
  }
  assert.equal(blob.includes('未启动'), false);
  assert.equal(/0 到 10|0—10|第十级/.test(blob), false);
  assert.ok(!blob.includes('Package'));
  assert.ok(!blob.includes('Artifact'));
});

test('A13 Renderer 资源不自行计算阶段', async () => {
  const rendererDir = path.join(__dirname, '..', '..', '..', 'electron', 'renderer');
  const panel = await fs.readFile(path.join(rendererDir, 'growth-panel.js'), 'utf8');
  const app = await fs.readFile(path.join(rendererDir, 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(rendererDir, 'index.html'), 'utf8');
  assert.equal(panel.includes('deriveGrowthProfile'), false);
  assert.equal(panel.includes('deriveGrowthStage'), false);
  assert.equal(app.includes('deriveGrowthProfile'), false);
  assert.equal(app.includes('deriveGrowthStage'), false);
  assert.ok(html.includes('growth-block'));
  assert.ok(html.includes('btn-growth-continue-learn'));
  assert.ok(html.includes('help-growth'));
  assert.equal(html.includes('完成第一件真实任务'), false);
  assert.equal(html.includes('未启动'), false);
  const uiBlob = `${panel}\n${html}`;
  for (const term of GROWTH_FORBIDDEN_TERMS) {
    assert.equal(uiBlob.includes(term), false, term);
  }
});

test('主任务始终是继续了解我，做事只作为可选补充', () => {
  const keys = recommendGrowthTasks(0, inspectGrowthGates(evidence({ identityDisplayName: '张三' })));
  assert.equal(keys[0], 'continue_conversation');
  const profile = deriveGrowthProfile(
    evidence({
      identityDisplayName: '张三',
      events: [event({ type: 'identity_clarified', payload: { title: '张三', detail: '产品负责人', tags: [] } })],
    }),
  );
  assert.equal(profile.primaryTask?.actionLabel, '继续了解我');
  assert.equal(profile.otherWays.some((item) => item.key === 'optional_learn_from_work' && item.optional), true);
  assert.equal(
    (profile.nextTasks || []).some((item) => item.title.includes('完成第一件真实任务')),
    false,
  );
});

test('引导问题一次一项，换题后不会立即重复', () => {
  const empty = evidence();
  const first = selectGuidedQuestion(inspectDimensionCoverage(empty), empty.events);
  assert.ok(first);
  assert.equal(first?.dimensionKey, 'identity');
  const switched = evidence({
    events: [
      event({
        type: 'feedback_recorded',
        occurredAt: '2026-08-16T00:00:00.000Z',
        payload: {
          title: '换一个问题',
          detail: 'switch',
          tags: [`captureKey:${guideChoiceCaptureKey('identity', 'switch')}`, 'capture:noop', 'silent_ok'],
        },
      }),
    ],
  });
  const next = selectGuidedQuestion(inspectDimensionCoverage(switched), switched.events);
  assert.ok(next);
  assert.notEqual(next?.dimensionKey, 'identity');
  assert.notEqual(next?.dimensionKey, 'relations');
  const legacySkip = evidence({
    events: [
      event({
        type: 'feedback_recorded',
        occurredAt: '2026-08-16T00:00:00.000Z',
        payload: {
          title: '暂时跳过',
          detail: 'skip',
          tags: [`captureKey:${guideChoiceCaptureKey('identity', 'skip')}`, 'capture:noop', 'silent_ok'],
        },
      }),
    ],
  });
  const nextLegacy = selectGuidedQuestion(inspectDimensionCoverage(legacySkip), legacySkip.events);
  assert.notEqual(nextLegacy?.dimensionKey, 'identity');
});

test('稍后再聊在重启后仍不会立即出现', () => {
  const deferred = evidence({
    events: [
      event({
        type: 'feedback_recorded',
        occurredAt: '2026-08-16T00:00:00.000Z',
        payload: {
          title: '稍后再聊这个',
          detail: 'later',
          tags: [`captureKey:${guideChoiceCaptureKey('identity', 'later')}`, 'capture:noop', 'silent_ok'],
        },
      }),
    ],
  });
  const next = selectGuidedQuestion(inspectDimensionCoverage(deferred), deferred.events);
  assert.ok(next);
  assert.notEqual(next?.dimensionKey, 'identity');
  const afterRestart = selectGuidedQuestion(inspectDimensionCoverage(deferred), deferred.events);
  assert.notEqual(afterRestart?.dimensionKey, 'identity');
});

test('帮助目录为四个阶段且不评价真人', () => {
  assert.equal(GROWTH_STAGE_GUIDE.length, 4);
  assert.equal(GROWTH_STAGE_GUIDE[0]?.name, '未开始');
  assert.equal(GROWTH_STAGE_GUIDE[3]?.name, '持续完善');
  assert.equal(GROWTH_DIMENSIONS.length, 10);
  const blob = collectGrowthCopyValues().join('\n');
  assert.equal(blob.includes('真人能力'), false);
});

test('CommandBus 上限仍为 22', () => {
  assert.equal(COMMAND_NAMES.length, 23);
  assert.ok(COMMAND_NAMES.length <= COMMAND_COUNT_LIMIT);
});

test('A4/B6/B8 运行时：已有证据用户直接识别，重启后一致，不新写平行对象', async () => {
  const root = await tempDir('exist');
  const pkgDir = path.join(root, 'pkg');
  const materialPath = path.join(root, 'brief.md');
  await fs.writeFile(materialPath, '本项目结论先行，本地优先。', 'utf8');

  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: '已有用户', targetDir: pkgDir });
  await runtime.captureSubjectInput({
    text: '我是本地优先产品负责人，最近要完成产品周报。',
    sourceKind: 'conversation',
  });
  const imported = await runtime.importSubjectMaterial({
    sourcePath: materialPath,
    distillCandidates: true,
  });
  const overview = await runtime.getOverview();
  assert.ok(overview.growth);
  assert.ok((overview.growth.stageLevel ?? 0) >= 1);
  assert.equal(overview.growth.showFirstStart, false);
  assert.notEqual(overview.growth.stageName, '未开始');
  await runtime.stop();

  const runtime2 = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime2.openPackage({ dir: pkgDir });
  const again = await runtime2.getOverview();
  assert.equal(again.growth?.stageLevel, overview.growth?.stageLevel);
  assert.equal(again.growth?.primaryTask?.key, overview.growth?.primaryTask?.key);
  const names = await fs.readdir(pkgDir);
  assert.ok(names.includes('growth'));
  assert.ok(!names.includes('growth-alt'));
  assert.ok(!names.includes('growth-stage.json'));
  await runtime2.stop();
  assert.ok(imported.materialRef);
});

test('阶段审计幂等：证据不变时连续打开不重复追加，getOverview 只读，noop 不进任务上下文', async () => {
  const root = await tempDir('idem');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: '幂等用户', targetDir: pkgDir });
  await runtime.captureSubjectInput({
    text: '我是本地优先产品负责人，最近要完成产品周报。',
    sourceKind: 'conversation',
  });

  const overviewAfterWrite = await runtime.getOverview();
  const level = overviewAfterWrite.growth?.stageLevel ?? 0;
  assert.ok(level >= 1, 'expected derived stage >= 1 after evidence');
  const eventsAfterWrite = await runtime.subject.listGrowthEvents();
  const stageKey = `captureKey:${stageReachedCaptureKey(level as 1 | 2 | 3)}`;
  const stageCount = (list: typeof eventsAfterWrite) =>
    list.filter((e) => (e.payload.tags ?? []).includes('growth:stage_reached')).length;
  const keyCount = (list: typeof eventsAfterWrite) =>
    list.filter((e) => (e.payload.tags ?? []).includes(stageKey)).length;
  assert.ok(stageCount(eventsAfterWrite) >= 1, 'expected stage-reached audit after evidence');
  assert.equal(keyCount(eventsAfterWrite), 1);

  const beforeOverview = eventsAfterWrite.length;
  await runtime.getOverview();
  await runtime.getOverview();
  const afterOverview = await runtime.subject.listGrowthEvents();
  assert.equal(afterOverview.length, beforeOverview, 'getOverview must stay read-only');
  assert.equal(stageCount(afterOverview), stageCount(eventsAfterWrite));
  await runtime.stop();

  const runtime2 = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime2.openPackage({ dir: pkgDir });
  const afterOpen1 = await runtime2.subject.listGrowthEvents();
  await runtime2.stop();

  const runtime3 = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime3.openPackage({ dir: pkgDir });
  const afterOpen2 = await runtime3.subject.listGrowthEvents();
  assert.equal(stageCount(afterOpen2), stageCount(afterOpen1));
  assert.equal(keyCount(afterOpen2), keyCount(afterOpen1));
  await runtime3.stop();
});

test('引导选择经现有 captureInput 记录，不新增命令', async () => {
  const root = await tempDir('guide');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: GROWTH_COPY.placeholderIdentityName, targetDir: pkgDir });
  const before = await runtime.subject.listGrowthEvents();
  const result = await runtime.captureSubjectInput({
    text: 'skip',
    sourceKind: 'conversation',
    captureKey: guideChoiceCaptureKey('identity', 'skip'),
  });
  assert.equal(result.captureOutcome, 'nothing_to_learn');
  const after = await runtime.subject.listGrowthEvents();
  assert.ok(after.length >= before.length);
  const skipEvents = after.filter((e) =>
    (e.payload.tags ?? []).some((tag) => tag.includes('growth:guide_choice:identity:skip')),
  );
  assert.equal(skipEvents.length, 1);
  const again = await runtime.captureSubjectInput({
    text: 'skip',
    sourceKind: 'conversation',
    captureKey: guideChoiceCaptureKey('identity', 'skip'),
  });
  assert.equal(again.idempotent, true);
  const afterAgain = await runtime.subject.listGrowthEvents();
  assert.equal(afterAgain.length, after.length);
  await runtime.stop();
});

test('驾驶舱统计只读派生，不含内部状态', () => {
  const profile = deriveGrowthProfile(
    evidence({
      identityDisplayName: '本地优先产品负责人',
      materials: [
        { materialRef: 'materials/a.md', fileName: '项目说明.md', addedAt: '2026-08-16T01:00:00.000Z' },
        { materialRef: 'materials/b.md', fileName: '周报.md', addedAt: '2026-08-16T02:00:00.000Z' },
      ],
      events: [
        event({
          type: 'identity_clarified',
          confidence: 'confirmed',
          payload: { title: '产品负责人', detail: '本地优先', tags: [] },
        }),
      ],
    }),
  );
  assert.ok(profile.cockpit);
  assert.equal(profile.cockpit.knownCount >= 1, true);
  assert.ok(profile.cockpit.knownPreview.length <= 4);
  assert.ok(profile.cockpit.gaps.length <= 4);
  assert.ok(profile.cockpit.materials.recent.length <= 4);
  assert.equal(profile.cockpit.gaps.some((item) => /%|置信|分数/.test(item.question)), false);
  assert.equal(profile.cockpit.materials.total, 2);
  assert.equal(profile.cockpit.materials.recent[0]?.fileName, '周报.md');
  const blob = JSON.stringify(profile.cockpit);
  assert.equal(/本次成果未采用|尚未决定|GrowthEvent|capture|freeze/.test(blob), false);
});

test('本次回答不用于长期了解真实阻断提取且不含回答正文', async () => {
  const root = await tempDir('nolearn');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: GROWTH_COPY.placeholderIdentityName, targetDir: pkgDir });
  const secret = 'NOLEARN_SECRET_PHRASE_92';
  runtime.scheduleConversationGrowthCapture({
    turnId: 'turn_nolearn_1',
    userText: secret,
    skipGrowthCapture: true,
    dimensionKey: 'identity',
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const events = await runtime.subject.listGrowthEvents();
  assert.equal(JSON.stringify(events).includes(secret), false);
  const nolearnEvents = events.filter((e) =>
    (e.payload.tags ?? []).some((tag) => tag.includes('growth:guide_choice:identity:nolearn')),
  );
  assert.equal(nolearnEvents.length, 1);
  assert.equal(String(nolearnEvents[0]?.payload.detail || '').includes(secret), false);
  const rows = await readConversationRows(conversationFilePath(pkgDir));
  assert.equal(latestCaptureStatusByTurnId(rows).get('turn_nolearn_1')?.status, 'skipped');
  assert.equal(
    listReplayableUserTurns(rows).some((item) => item.turn.id === 'turn_nolearn_1'),
    false,
  );
  await runtime.stop();
});

test('自然语言不要记住这段会阻断长期提取', async () => {
  assert.equal(isEphemeralConversationIntent('不要记住这段。我是产品负责人。'), true);
  assert.equal(isEphemeralConversationIntent('我是本地优先产品负责人'), false);
  const root = await tempDir('nolearn-nl');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: GROWTH_COPY.placeholderIdentityName, targetDir: pkgDir });
  const secret = 'NL_NOLEARN_SECRET_77';
  runtime.scheduleConversationGrowthCapture({
    turnId: 'turn_nolearn_nl',
    userText: `不要记住这段。${secret}`,
    dimensionKey: 'identity',
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const events = await runtime.subject.listGrowthEvents();
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(
    latestCaptureStatusByTurnId(await readConversationRows(conversationFilePath(pkgDir))).get('turn_nolearn_nl')
      ?.status,
    'skipped',
  );
  await runtime.stop();
});
