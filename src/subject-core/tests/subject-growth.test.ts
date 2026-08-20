import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { extractEditEvidence } from '../diff-evidence';
import { selectConfirmedExperiences } from '../experience-selector';
import { deriveAllViews } from '../derive-all';
import type { GrowthEvent } from '../growth-event';
import { SUBJECT_PACKAGE_LAYOUT } from '../subject-package';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-${prefix}-`));
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

test('精确 evidence:删除/增加/结构/名称替换', () => {
  const result = extractEditEvidence(
    '# 标题\n\n空话连篇的开场\nAlice 负责发布\n',
    '# 新标题\n\n发布节奏要明确\nBob 负责发布\n',
  );
  assert.ok(result.facts.length >= 2);
  assert.ok(result.facts.some((f) => f.kind === 'deleted_phrase' || f.kind === 'structure_change'));
  assert.ok(result.facts.some((f) => f.kind === 'added_phrase' || f.kind === 'structure_change' || f.kind === 'replaced_name'));
  assert.ok(result.detail.length > 0);
  assert.ok(!result.detail.includes('价值观'));
});

test('event 重放与派生视图重建;candidate/confirmed 隔离', async () => {
  const root = await tempDir('subj');
  const runtime = createDigitalMeRuntime();
  const { subjectId } = await runtime.createPackage({
    displayName: '测试主体',
    targetDir: path.join(root, 'pkg'),
  });

  const candidate: GrowthEvent = {
    id: 'gevt_cand_1',
    subjectId,
    occurredAt: new Date().toISOString(),
    type: 'feedback_recorded',
    source: { kind: 'artifact_edit', artifactId: 'art_x' },
    payload: {
      title: '删除表达',
      detail: '删除表达: 空话连篇',
      tags: ['周报', 'document'],
      evidence: { artifactId: 'art_x', fromVersionId: 'ver_a', toVersionId: 'ver_b' },
    },
    confidence: 'candidate',
  };
  await runtime.subject.appendGrowthEvent(candidate);
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: { title: '偏好简洁', detail: '句子短', tags: ['style'] },
  });

  let derived = await runtime.subject.getDerived();
  assert.equal(derived.candidates.entries.length, 1);
  assert.equal(derived.confirmed.entries.length, 0);
  assert.equal(derived.preferences.entries.length, 1);

  await runtime.confirmExperience({ eventIds: ['gevt_cand_1'] });
  derived = await runtime.subject.getDerived();
  assert.equal(derived.candidates.entries.length, 0);
  assert.equal(derived.confirmed.entries.length, 1);
  assert.ok(derived.confirmed.entries[0]?.eventId);
  const confirmedEvents = (await runtime.subject.listGrowthEvents()).filter(
    (e) => e.type === 'experience_confirmed',
  );
  assert.equal(confirmedEvents[0]?.confirms, 'gevt_cand_1');
  assert.deepEqual(confirmedEvents[0]?.payload.evidence, candidate.payload.evidence);

  await runtime.subject.wipeDerivedCache();
  const rebuilt = await runtime.subject.rebuildDerivedViews();
  assert.equal(rebuilt.confirmed.entries.length, 1);
  assert.equal(rebuilt.preferences.entries.length, 1);

  // 纯函数重放确定性
  const events = await runtime.subject.listGrowthEvents();
  const a = deriveAllViews(subjectId, events, 't1');
  const b = deriveAllViews(subjectId, events, 't1');
  assert.deepEqual(a.confirmed.entries, b.confirmed.entries);

  await assert.rejects(() => runtime.confirmExperience({ eventIds: ['gevt_cand_1'] }), /already confirmed/);
  await runtime.stop();
});

test('完整成长闭环:Task A 编辑确认后 Task B 复用;未确认与不相似隔离', async () => {
  const root = await tempDir('loop');
  const runtime = createDigitalMeRuntime();
  await runtime.createPackage({ displayName: '成长主体', targetDir: path.join(root, 'pkg') });

  // Task A
  const a = await runtime.submitTask({
    goal: '撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime.workRuntime, a.jobId);
  const artA = (await runtime.getTask({ taskId: a.taskId })).artifactIds[0] as string;
  const before = await runtime.getContent({ artifactId: artA });
  assert.ok(before.text);

  // 未确认前先跑 Task B' — 不应含沿用经验
  const early = await runtime.submitTask({
    goal: '再次撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime.workRuntime, early.jobId);
  const earlyArt = (await runtime.getTask({ taskId: early.taskId })).artifactIds[0] as string;
  const earlyText = (await runtime.getContent({ artifactId: earlyArt })).text as string;
  assert.ok(!earlyText.includes('## 沿用经验'));

  // 编辑 Artifact A → candidate
  const edited = `${before.text}\n\n发布节奏要明确，避免空话。\n`;
  const { versionId } = await runtime.saveEdit({ artifactId: artA, text: edited });
  assert.ok(versionId);

  const overview = await runtime.getOverview();
  assert.ok(overview.candidateExperiences.length >= 1);
  const candidateId = overview.candidateExperiences[0]?.eventId as string;
  const cand = (await runtime.subject.listGrowthEvents()).find((e) => e.id === candidateId);
  assert.equal(cand?.confidence, 'candidate');
  assert.ok(cand?.payload.evidence?.toVersionId);

  // 确认
  await runtime.confirmExperience({ eventIds: [candidateId] });
  const afterConfirm = await runtime.getOverview();
  assert.equal(afterConfirm.confirmedExperienceCount, 1);
  assert.equal(afterConfirm.candidateExperiences.length, 0);

  // 相似 Task B — 应注入
  const b = await runtime.submitTask({
    goal: '继续撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime.workRuntime, b.jobId);
  const artB = (await runtime.getTask({ taskId: b.taskId })).artifactIds[0] as string;
  const textB = (await runtime.getContent({ artifactId: artB })).text as string;
  assert.match(textB, /## 沿用经验/);
  const confirmedId = (await runtime.subject.listGrowthEvents()).find(
    (e) => e.type === 'experience_confirmed' && e.confirms === candidateId,
  )?.id as string;
  assert.match(textB, new RegExp(confirmedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // 不相似任务 — 不注入
  const c = await runtime.submitTask({
    goal: '整理旅行装箱清单',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime.workRuntime, c.jobId);
  const artC = (await runtime.getTask({ taskId: c.taskId })).artifactIds[0] as string;
  const textC = (await runtime.getContent({ artifactId: artC })).text as string;
  assert.ok(!textC.includes('## 沿用经验'), 'unrelated task must not inject');

  await runtime.stop();
});

test('边界过滤排除标签;选择器数量上限', () => {
  const confirmed = {
    subjectId: 'subj_x',
    derivedAt: 't',
    entries: [
      {
        eventId: 'e1',
        title: '正式语气',
        detail: '使用正式措辞',
        tags: ['formal', '周报'],
        occurredAt: 't1',
      },
      {
        eventId: 'e2',
        title: '产品周报节奏',
        detail: '发布节奏',
        tags: ['产品', '周报'],
        occurredAt: 't2',
      },
    ],
  };
  const boundaries = {
    subjectId: 'subj_x',
    derivedAt: 't',
    excludedTags: ['formal'],
    excludedAssetTags: [],
    entries: [],
  };
  const selected = selectConfirmedExperiences({
    goal: '撰写产品周报',
    requestedArtifactType: 'document',
    confirmed,
    boundaries,
  });
  assert.equal(selected.entries.length, 1);
  assert.equal(selected.entries[0]?.eventId, 'e2');
});

test('package 迁移后可重新打开;重启重放一致', async () => {
  const root = await tempDir('migrate');
  const src = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime();
  const created = await runtime.createPackage({ displayName: '可迁移', targetDir: src });
  await runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    payload: { title: '长期目标', detail: '保持本地优先', tags: ['goal'] },
  });
  await runtime.stop();

  const dest = path.join(root, 'pkg-copy');
  await copyDir(src, dest);

  const runtime2 = createDigitalMeRuntime();
  const opened = await runtime2.openPackage({ dir: dest });
  assert.equal(opened.subjectId, created.subjectId);
  assert.equal(opened.displayName, '可迁移');
  const overview = await runtime2.getOverview();
  assert.equal(overview.displayName, '可迁移');
  const derived = await runtime2.subject.getDerived();
  assert.equal(derived.goals.entries.length, 1);
  assert.ok(
    await fs
      .access(path.join(dest, SUBJECT_PACKAGE_LAYOUT.manifest))
      .then(() => true),
  );
  await runtime2.stop();
});

test('回流失败不影响已成功 Artifact', async () => {
  const root = await tempDir('feedback-fail');
  const runtime = createDigitalMeRuntime();
  await runtime.createPackage({ displayName: '回流', targetDir: path.join(root, 'pkg') });
  const { taskId, jobId } = await runtime.submitTask({
    goal: '写说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime.workRuntime, jobId);
  const artId = (await runtime.getTask({ taskId })).artifactIds[0] as string;
  const before = await runtime.getContent({ artifactId: artId });

  // 破坏 append:临时替换
  const original = runtime.subject.appendGrowthEvent.bind(runtime.subject);
  runtime.subject.appendGrowthEvent = async () => {
    throw new Error('simulated growth failure');
  };

  const { versionId } = await runtime.saveEdit({
    artifactId: artId,
    text: `${before.text}\n\n新增一句不会丢。\n`,
  });
  assert.ok(versionId);

  const after = await runtime.getContent({ artifactId: artId });
  assert.match(after.text as string, /新增一句不会丢/);
  assert.equal(after.artifact.headVersionId, versionId);
  const job = await runtime.getJob(jobId);
  assert.equal(job?.status, 'succeeded');

  runtime.subject.appendGrowthEvent = original;
  await runtime.stop();
});

test('SubjectPackage 权威结构与 schema 校验;视图非第二事实源', async () => {
  const root = await tempDir('schema');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime();
  await runtime.createPackage({ displayName: '结构', targetDir: pkgDir });

  const manifest = JSON.parse(
    await fs.readFile(path.join(pkgDir, 'manifest.json'), 'utf8'),
  ) as { schemaVersion: number; identity: { displayName: string }; rootDir?: string };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.identity.displayName, '结构');
  assert.equal(manifest.rootDir, undefined); // 可迁移:路径不写进权威清单

  await fs.access(path.join(pkgDir, 'growth', 'events.ndjson'));
  await fs.access(path.join(pkgDir, 'materials'));
  await fs.access(path.join(pkgDir, 'derived'));

  // 手改派生视图不得成为权威:wipe + rebuild 以事件为准
  await runtime.appendOwnerEvent({
    type: 'asset_added',
    confidence: 'confirmed',
    payload: { title: '素材A', detail: 'index', tags: ['asset'] },
  });
  await fs.writeFile(
    path.join(pkgDir, 'derived', 'assets.json'),
    JSON.stringify({ subjectId: 'x', derivedAt: 't', entries: [{ eventId: 'fake' }] }),
    'utf8',
  );
  const rebuilt = await runtime.subject.rebuildDerivedViews();
  assert.equal(rebuilt.assets.entries.length, 1);
  assert.notEqual(rebuilt.assets.entries[0]?.eventId, 'fake');

  // 错误 schema
  const bad = path.join(root, 'bad');
  await fs.mkdir(bad, { recursive: true });
  await fs.writeFile(
    path.join(bad, 'manifest.json'),
    JSON.stringify({
      id: 'subj_bad',
      schemaVersion: 99,
      createdAt: new Date().toISOString(),
      identity: { displayName: 'bad' },
    }),
  );
  const runtime3 = createDigitalMeRuntime();
  await assert.rejects(() => runtime3.openPackage({ dir: bad }), /schemaVersion/);

  await runtime.stop();
});
