/**
 * 主体资料：UI 上传后不逐条确认即可对话/做事检索；删除后失效；敏感字段不外泄。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import {
  FIXTURE_NAME,
  buildFixtureResumeDocx,
} from '../../infrastructure/tests/feedback-loop-02-fixtures';
import {
  launchDigitalMeElectron,
  sendChat,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';
import { isSensitiveMaterialText } from '../material-index';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-mat-idx-${prefix}-`));
}

const SENSITIVE_RESUME = [
  '个人简历',
  '姓名：张元林',
  '身份证号：110101199001011234',
  '电话：13800138000',
  '住址：北京市示例路 1 号',
  '教育经历：示例大学 本科',
  '工作经历：2019-2024 任职于示例科技公司，负责本地优先产品。',
].join('\n');

test('导入后不确认即可按资料回答姓名；删除后不再命中；敏感字段不进检索', async () => {
  const dir = await tempDir('core');
  const resumePath = path.join(dir, '简历.docx');
  await fs.writeFile(resumePath, buildFixtureResumeDocx());
  const sensitivePath = path.join(dir, 'sensitive-resume.txt');
  await fs.writeFile(sensitivePath, SENSITIVE_RESUME, 'utf8');

  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '资料检索', targetDir: path.join(dir, 'pkg') });
  const imported = await runtime.importSubjectMaterial({ sourcePath: resumePath, distillCandidates: true });
  assert.equal(imported.readStatus, 'read');
  assert.match(String(imported.userFacingReadResult), /已读取/);
  assert.match(String(imported.userFacingReadResult), /已可用于对话和做事/);
  assert.match(String(imported.userFacingReadResult), /敏感信息不会自动对外使用/);

  const grounded = await runtime.tryMaterialGroundedReply('我叫什么名字');
  assert.ok(grounded);
  assert.match(grounded.text, new RegExp(FIXTURE_NAME));
  assert.match(grounded.text, /简历/);

  const submitted = await runtime.submitTask({
    goal: '根据我的经历写一段个人介绍',
    contextRefs: [],
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
  assert.equal(job.status, 'succeeded');
  const detail = await runtime.getTask({ taskId: submitted.taskId });
  const artifactId = detail.artifactIds?.[0];
  assert.ok(artifactId);
  const content = await runtime.getContent({ artifactId });
  const text = String(content.text || '');
  assert.match(text, /示例科技公司|本地优先|示例大学|张元林/);
  assert.ok(job.snapshotId);
  const snap = await runtime.getSnapshot(job.snapshotId);
  assert.ok(snap?.items.some((i) => i.materialRef || /materials\//.test(i.sourcePath)));

  const sensitive = await runtime.importSubjectMaterial({
    sourcePath: sensitivePath,
    distillCandidates: true,
  });
  const hits = await runtime.subject.retrieveMaterials({ query: '我叫什么名字', maxChunks: 8 });
  const joined = hits.map((h) => h.chunk.text).join('\n');
  assert.doesNotMatch(joined, /110101199001011234/);
  assert.doesNotMatch(joined, /13800138000/);
  assert.equal(isSensitiveMaterialText('身份证号：110101199001011234'), true);

  await runtime.removeSubjectMaterial({ materialRef: imported.materialRef });
  await runtime.removeSubjectMaterial({ materialRef: sensitive.materialRef });
  const after = await runtime.tryMaterialGroundedReply('我叫什么名字');
  assert.equal(after, null);
  await runtime.stop();
});

test('Electron：从数字之我页上传简历后，新对话能回答姓名，协作提示不发送字段', { timeout: 180_000 }, async () => {
  const dir = await tempDir('ui');
  const resumePath = path.join(dir, '简历.docx');
  await fs.writeFile(resumePath, buildFixtureResumeDocx());
  const harness = await launchDigitalMeElectron({
    extraEnv: { DIGITALME_V2_TEST_IMPORT_FILES: resumePath },
  });
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await page.locator('#nav-subject').click();
    await page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#btn-growth-other-ways').click({ force: true });
    await page.locator('#btn-import-subject-material').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#btn-import-subject-material').click();
    await page
      .locator('#subject-action-status')
      .getByText(/已读取|已可用于对话和做事/)
      .waitFor({ state: 'visible', timeout: 20_000 });
    const status = await page.locator('#subject-action-status').innerText();
    assert.doesNotMatch(status, /已读取并进入了解流程/);
    await page.locator('#nav-chat').click();
    await page.locator('#btn-chat-new').click();
    await sendChat(page, '我叫什么名字');
    const shown = await page.locator('.chat-turn-assistant .chat-text').last().innerText();
    assert.match(shown, new RegExp(FIXTURE_NAME));
    assert.match(shown, /简历/);
    assert.doesNotMatch(shown, /110101199001011234|13800138000/);

    const created = (await page.evaluate(`(async () => {
      const api = window.digitalMe;
      return api.invoke('work.submitTask', {
        goal: '根据我的经历写一段个人介绍',
        contextRefs: [],
      });
    })()`)) as { taskId: string; jobId: string };
    const started = Date.now();
    let artifactText = '';
    while (Date.now() - started < 40_000) {
      const detail = (await page.evaluate(`(async () => {
        const api = window.digitalMe;
        return api.invoke('work.getTask', { taskId: ${JSON.stringify(created.taskId)} });
      })()`)) as {
        latestJob?: { status?: string };
        artifactIds?: string[];
      };
      if (detail.latestJob?.status === 'succeeded' && detail.artifactIds?.[0]) {
        const content = (await page.evaluate(`(async () => {
          const api = window.digitalMe;
          return api.invoke('artifact.getContent', { artifactId: ${JSON.stringify(detail.artifactIds[0])} });
        })()`)) as { text?: string };
        artifactText = String(content?.text || '');
        break;
      }
      if (detail.latestJob?.status === 'failed') {
        throw new Error(`任务失败：${JSON.stringify(detail.latestJob)}`);
      }
      await page.waitForTimeout(300);
    }
    assert.match(artifactText, /示例科技公司|本地优先|示例大学|张元林/);
    assert.doesNotMatch(artifactText, /110101199001011234|13800138000/);

    await page.locator('#nav-collab').click();
    await page.locator('#panel-collab').waitFor({ state: 'visible', timeout: 10_000 });
    const hint = await page.locator('#collab-local-material-hint').innerText();
    assert.match(hint, /经历|姓名|教育/);
    assert.match(hint, /不会发送|未勾选/);

    await page.locator('#nav-subject').click();
    await page.locator('#btn-growth-other-ways').click({ force: true });
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.locator('#subject-material-list button', { hasText: '移除' }).click();
    await page.locator('#subject-action-status').getByText(/已移除/).waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#nav-chat').click();
    await page.locator('#btn-chat-new').click();
    const emptiedAt = Date.now();
    while (Date.now() - emptiedAt < 10_000) {
      if ((await page.locator('.chat-turn-assistant').count()) === 0) break;
      await page.waitForTimeout(80);
    }
    assert.equal(await page.locator('.chat-turn-assistant').count(), 0, '新对话后仍留有旧回复');
    await sendChat(page, '我叫什么名字');
    const afterRemove = await page.locator('.chat-turn-assistant .chat-text').last().innerText();
    assert.doesNotMatch(afterRemove, new RegExp(FIXTURE_NAME));
  } finally {
    await harness.close();
  }
});
