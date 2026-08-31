/**
 * 复现：对话姓名、做事确认的个人信息、简历已确认事实进入「已经了解」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { distillCandidatesFromText } from '../candidate-distill';
import { buildUserVisibleFacts } from '../user-facing-overview';
import { buildConversationSubjectContext } from '../conversation-context';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-known-${prefix}-`));
}

test('对话「我叫某某」进入权威记录并出现在已经了解，且与对话上下文同一投影', async () => {
  const distilled = distillCandidatesFromText({
    subjectId: 'subj_x',
    text: '我叫张三',
    sourceKind: 'conversation',
  });
  assert.ok(distilled.some((e) => e.type === 'identity_clarified' && e.payload.detail.includes('张三')));
  assert.ok(distilled.some((e) => (e.payload.tags || []).includes('silent_ok')));

  const dir = await tempDir('name');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我叫张三',
    sourceKind: 'conversation',
  });
  assert.ok((cap.confirmedEventIds || cap.candidateEventIds).length > 0);
  const overview = await runtime.getOverview();
  const facts = (overview.userVisibleFacts || []).map((f: { text: string }) => f.text).join('\n');
  assert.match(facts, /张三/);
  const derived = await runtime.subject.getDerived();
  const page = buildUserVisibleFacts(derived).map((f) => f.text);
  const conv = buildConversationSubjectContext(derived).items.map((i) => i.text);
  assert.deepEqual(page, conv);
  await runtime.stop();
});

test('简历导入后，确认的姓名与经历进入已经了解；项目观点仍排除', async () => {
  const resume = [
    '个人简历',
    '姓名：李四',
    '职位：产品经理',
    '工作经历：2019-2024 任职于某科技公司，负责本地优先产品。',
  ].join('\n');
  const distilled = distillCandidatesFromText({
    subjectId: 'subj_x',
    text: resume,
    sourceKind: 'imported_material',
  });
  assert.ok(distilled.some((e) => e.type === 'identity_clarified' && /李四/.test(e.payload.detail)));
  assert.ok(distilled.some((e) => /工作经历/.test(e.payload.title)));
  assert.ok(distilled.every((e) => e.type !== 'identity_clarified' || !(e.payload.tags || []).includes('category:external_claim')));

  const dir = await tempDir('resume');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: resume,
    sourceKind: 'imported_material',
  });
  const already = new Set(cap.confirmedEventIds || []);
  const toConfirm = [...(cap.confirmationSuggestedEventIds || []), ...(cap.candidateEventIds || [])].filter(
    (id) => id && !already.has(id),
  );
  assert.ok(already.size + toConfirm.length > 0);
  if (toConfirm.length > 0) {
    await runtime.confirmExperience({ eventIds: [...new Set(toConfirm)] });
  }
  const overview = await runtime.getOverview();
  const facts = (overview.userVisibleFacts || []).map((f: { text: string }) => f.text).join('\n');
  assert.match(facts, /李四/);
  assert.match(facts, /科技公司|产品经理|工作经历/);

  await runtime.captureSubjectInput({
    text: '项目组主张全部上云',
    sourceKind: 'imported_material',
  });
  const after = await runtime.getOverview();
  const afterText = (after.userVisibleFacts || []).map((f: { text: string }) => f.text).join('\n');
  assert.doesNotMatch(afterText, /全部上云/);
  await runtime.stop();
});

test('做事中确认的长期个人信息可以显示在已经了解', async () => {
  const dir = await tempDir('work');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我叫王五，请以后按这个称呼我。',
    sourceKind: 'conversation',
    taskId: 'task_demo',
  });
  assert.ok((cap.confirmedEventIds || []).length + (cap.candidateEventIds || []).length > 0);
  const overview = await runtime.getOverview();
  const facts = (overview.userVisibleFacts || []).map((f: { text: string }) => f.text).join('\n');
  assert.match(facts, /王五/);
  await runtime.stop();
});
