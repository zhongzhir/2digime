/**
 * 使用反馈（2）场景 A/B：真实结构资料导入 + 姓名跨会话。
 * 使用与反馈相同的表达，不用更容易通过的替代表述。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import {
  distillCandidatesFromText,
  extractExplicitSelfName,
  looksLikeIdentityClaim,
} from '../candidate-distill';
import { extractFile } from '../../infrastructure/extract';
import {
  FIXTURE_NAME,
  buildFixtureResumeDocx,
  buildFixtureResumePdf,
  buildFixtureResumePdfZh,
} from '../../infrastructure/tests/feedback-loop-02-fixtures';
import { buildUnreadableChinesePdf } from '../../infrastructure/tests/helpers';
import { buildControlledFactualReply } from '../conversation-context';

const ORAL = '我是张元林，我是你的主人。';
const IMPRESSION = '关于我，你有什么印象？';
const CORRECT = '不是，应该叫李四。';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-fb02-${prefix}-`));
}

test('extractFile 从 DOCX 段落和表格读到正文，而不是文件名', async () => {
  const dir = await tempDir('docx');
  const file = path.join(dir, 'resume-fixture.docx');
  await fs.writeFile(file, buildFixtureResumeDocx());
  const outcome = await extractFile(file);
  assert.equal(outcome.status, 'ok');
  assert.match(String(outcome.text), new RegExp(FIXTURE_NAME));
  assert.match(String(outcome.text), /示例大学/);
  assert.doesNotMatch(String(outcome.text), /resume-fixture/);
});

test('extractFile 从 PDF 读到正文，而不是文件名', async () => {
  const dir = await tempDir('pdf');
  const file = path.join(dir, 'resume-fixture.pdf');
  await fs.writeFile(file, buildFixtureResumePdf());
  const outcome = await extractFile(file);
  assert.equal(outcome.status, 'ok');
  assert.match(String(outcome.text), /ZhangYuanlin/);
  assert.doesNotMatch(String(outcome.text), /resume-fixture/);
});

test('无隐私中文 PDF 提取张元林；编码失败不得声称已读', async () => {
  const dir = await tempDir('pdf-zh');
  const zh = path.join(dir, '简历.pdf');
  await fs.writeFile(zh, buildFixtureResumePdfZh());
  const extracted = await extractFile(zh);
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '中文PDF', targetDir: path.join(dir, 'pkg') });
  const imported = await runtime.importSubjectMaterial({ sourcePath: zh, distillCandidates: true });
  if (/张元林/.test(String(extracted.text || ''))) {
    assert.equal(extracted.status, 'ok');
    assert.equal(imported.readStatus, 'read');
    assert.equal(imported.enteredUnderstanding, true);
  } else {
    assert.notEqual(imported.readStatus, 'read');
    assert.equal(imported.enteredUnderstanding, false);
    assert.match(String(imported.readWarning || extracted.warning || ''), /正文|编码|无法/);
  }
  const blank = path.join(dir, '空白中文.pdf');
  await fs.writeFile(blank, buildUnreadableChinesePdf());
  const blankImported = await runtime.importSubjectMaterial({
    sourcePath: blank,
    distillCandidates: true,
  });
  assert.notEqual(blankImported.readStatus, 'read');
  assert.equal(blankImported.enteredUnderstanding, false);
  await runtime.stop();
});

test('我是张元林，我是你的主人。提取姓名且不把主人当姓名', () => {
  assert.equal(extractExplicitSelfName(ORAL), '张元林');
  assert.equal(looksLikeIdentityClaim(ORAL), true);
  const distilled = distillCandidatesFromText({
    subjectId: 'subj_x',
    text: ORAL,
    sourceKind: 'conversation',
  });
  const names = distilled.filter((e) => (e.payload.tags || []).includes('self_name'));
  assert.equal(names.length, 1);
  assert.equal(names[0]?.payload.detail, '张元林');
  assert.ok(distilled.every((e) => !/主人/.test(e.payload.detail) || e.type !== 'identity_clarified'));
});

test('反例不得当姓名：中国人 / 产品经理 / 来咨询 / 你的主人', () => {
  const anti = ['我是中国人', '我是产品经理', '我是来咨询问题的', '我是你的主人'];
  for (const text of anti) {
    assert.equal(extractExplicitSelfName(text), null, text);
    const distilled = distillCandidatesFromText({
      subjectId: 'subj_x',
      text,
      sourceKind: 'conversation',
    });
    assert.ok(
      distilled.every((e) => !(e.payload.tags || []).includes('self_name')),
      text,
    );
  }
  assert.equal(looksLikeIdentityClaim('我是来咨询问题的'), false);
  assert.equal(looksLikeIdentityClaim('我是你的主人'), false);
  assert.equal(looksLikeIdentityClaim('我是产品经理'), true);
  assert.equal(looksLikeIdentityClaim('我是本地优先产品负责人'), true);
});

test('导入真实结构 DOCX：提取正文，复制成功不得显示已经了解', async () => {
  const dir = await tempDir('import');
  const source = path.join(dir, '简历.docx');
  await fs.writeFile(source, buildFixtureResumeDocx());
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '导入验收', targetDir: path.join(dir, 'pkg') });
  const imported = await runtime.importSubjectMaterial({ sourcePath: source, distillCandidates: true });
  assert.equal(imported.readStatus, 'read');
  assert.ok(imported.extractedLength > 0);
  assert.equal(imported.enteredUnderstanding, true);
  const overview = await runtime.getOverview();
  const mat = (overview.materials || []).find((m) => m.materialRef === imported.materialRef);
  assert.ok(mat);
  assert.equal(mat?.readStatus, 'read');
  assert.equal(mat?.enteredUnderstanding, true);
  const factsBeforeConfirm = (overview.userVisibleFacts || []).map((f) => f.text).join('\n');
  assert.doesNotMatch(factsBeforeConfirm, /已经了解/);
  const toConfirm = [
    ...(overview.confirmationSuggestedEventIds || []),
    ...(overview.candidateExperiences || []).map((c) => c.eventId),
  ].filter(Boolean);
  if (toConfirm.length > 0) {
    await runtime.confirmExperience({ eventIds: [...new Set(toConfirm)] });
  }
  const after = await runtime.getOverview();
  const facts = (after.userVisibleFacts || []).map((f) => f.text).join('\n');
  assert.match(facts, new RegExp(FIXTURE_NAME));
  await runtime.stop();
});

test('损坏文件读取失败有原因，不得用文件名当内容', async () => {
  const dir = await tempDir('bad');
  const source = path.join(dir, '张元林简历.docx');
  await fs.writeFile(source, Buffer.from('not-a-zip'));
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '失败导入', targetDir: path.join(dir, 'pkg') });
  const imported = await runtime.importSubjectMaterial({ sourcePath: source, distillCandidates: true });
  assert.equal(imported.readStatus, 'failed');
  assert.ok(imported.readWarning);
  assert.equal(imported.enteredUnderstanding, false);
  const overview = await runtime.getOverview();
  const facts = (overview.userVisibleFacts || []).map((f) => f.text).join('\n');
  assert.doesNotMatch(facts, /张元林/);
  await runtime.stop();
});

test('跨会话：我是张元林 → 新会话仍能回答姓名；不是应该叫李四 supersede；同 turn 不重复', async () => {
  const dir = await tempDir('session');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '姓名跨会话', targetDir: path.join(dir, 'pkg') });
  const first = await runtime.captureSubjectInput({ text: ORAL, sourceKind: 'conversation' });
  assert.ok((first.confirmedEventIds || first.candidateEventIds).length > 0);
  const overview1 = await runtime.getOverview();
  const facts1 = (overview1.userVisibleFacts || []).map((f) => f.text).join('\n');
  assert.match(facts1, /张元林/);
  assert.doesNotMatch(facts1, /主人/);

  runtime.createConversationSession();
  const overview2 = await runtime.getOverview();
  const facts2 = (overview2.userVisibleFacts || []).map((f) => f.text);
  assert.ok(facts2.some((t) => /张元林/.test(t)));
  const impression = buildControlledFactualReply(facts2);
  assert.match(impression, /张元林/);
  assert.match(IMPRESSION, /关于我，你有什么印象/);

  const beforeCount = (await runtime.subject.listGrowthEvents()).filter(
    (e) => e.type === 'identity_clarified' && /李四/.test(e.payload.detail),
  ).length;
  await runtime.captureSubjectInput({ text: CORRECT, sourceKind: 'conversation' });
  const afterFirst = (await runtime.subject.listGrowthEvents()).filter(
    (e) => e.type === 'identity_clarified' && /李四/.test(e.payload.detail),
  );
  assert.ok(afterFirst.length > beforeCount);
  await runtime.captureSubjectInput({
    text: CORRECT,
    sourceKind: 'conversation',
    captureKey: 'replay-same-turn',
  });
  await runtime.captureSubjectInput({
    text: CORRECT,
    sourceKind: 'conversation',
    captureKey: 'replay-same-turn',
  });
  const liSi = (await runtime.subject.listGrowthEvents()).filter(
    (e) => e.type === 'identity_clarified' && /李四/.test(e.payload.detail),
  );
  assert.equal(liSi.length, afterFirst.length);
  await runtime.stop();
});
