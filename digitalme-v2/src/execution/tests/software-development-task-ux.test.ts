/**
 * SOFTWARE-DEVELOPMENT-TASK-UX-01 — 识别、确认、不可用提示、成果结构、恢复语义。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  deriveWorkIntent,
  deriveWorkIntentSync,
  inspectSoftwareProject,
} from '../../work-runtime/work-intent';
import { buildExecutionConfirmPreview } from '../task-package';
import { restoreExecutionBaseline } from '../restore';
import { captureExecutionBaseline } from '../baseline';
import { collectExecutionChanges } from '../run-collector';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';

describe('software-development-task-ux', () => {
  it('识别含 package.json 的文件夹为软件项目', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-sw-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    const inspected = await inspectSoftwareProject(dir);
    assert.equal(inspected.isSoftwareProject, true);
    assert.ok(inspected.markersHit.includes('package.json'));
    assert.match(inspected.userFacingHint, /确认范围/);
  });

  it('普通文件夹不误判为软件项目', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-plain-'));
    await fs.writeFile(path.join(dir, 'notes.txt'), 'hello', 'utf8');
    const inspected = await inspectSoftwareProject(dir);
    assert.equal(inspected.isSoftwareProject, false);
    assert.equal(inspected.userFacingHint, '');
  });

  it('仅普通文件夹时不同时污染其他材料种类', async () => {
    const soft = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-soft-'));
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-plain2-'));
    await fs.writeFile(path.join(soft, 'go.mod'), 'module x\n', 'utf8');
    await fs.writeFile(path.join(plain, 'readme.txt'), 'x', 'utf8');
    const intent = await deriveWorkIntent({
      goal: '修改登录页并运行测试',
      contextRefs: [
        { kind: 'folder', path: soft },
        { kind: 'folder', path: plain },
      ],
    });
    assert.equal(intent.intentKind, 'modify_code');
    assert.ok(intent.materialKinds.includes('code_repo'));
    assert.ok(intent.materialKinds.includes('folder'));
  });

  it('modify_code + 软件项目触发执行确认', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-mod-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        executeHook: async () => ({
          exitCode: 0,
          summary: 'ok',
          claimedChangedFiles: [],
        }),
      },
    });
    await rt.createPackage({ displayName: 'ux', targetDir: pkg });
    const preview = await rt.submitTask({
      goal: '修改这个项目中的登录页，并运行相关测试',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(preview.needsExecutionConfirm);
    assert.equal(preview.intentKind, 'modify_code');
    assert.match(preview.needsExecutionConfirm!.title || '', /修改项目文件/);
    assert.equal(
      preview.needsExecutionConfirm!.workingDirectory,
      path.resolve(dir),
    );
    assert.ok((preview.needsExecutionConfirm!.allowed || []).length >= 3);
    assert.ok(
      preview.needsExecutionConfirm!.forbidden.some((x) => /commit/i.test(x)),
    );
  });

  it('普通写作任务不触发开发确认', async () => {
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-doc-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: false,
    });
    await rt.createPackage({ displayName: 'doc', targetDir: pkg });
    const result = await rt.submitTask({
      goal: '根据现有资料撰写一篇公众号文章',
      contextRefs: [],
    });
    assert.equal(result.needsExecutionConfirm, undefined);
    assert.equal(result.needsExecutorSetup, undefined);
    assert.ok(result.taskId);
    assert.ok(result.jobId);
  });

  it('执行能力不可用时显示可行动提示且不回退文档', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-nosetup-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg2-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: false,
    });
    await rt.createPackage({ displayName: 'nosetup', targetDir: pkg });
    const result = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(result.needsExecutorSetup);
    assert.match(result.needsExecutorSetup!.message, /尚未连接/);
    assert.equal(result.taskId, '');
    assert.equal(result.needsExecutionConfirm, undefined);
  });

  it('确认卡内容与 executionAuthorization 字段一致', () => {
    const preview = buildExecutionConfirmPreview({
      goal: '修改登录页并运行测试',
      workingDirectory: 'D:/demo/app',
      projectName: 'app',
      executorDisplayName: '代码执行能力',
    });
    assert.equal(preview.projectName, 'app');
    assert.equal(preview.workingDirectory, path.resolve('D:/demo/app'));
    assert.deepEqual(preview.readScope, ['.']);
    assert.deepEqual(preview.writeScope, ['.']);
    assert.ok(preview.acceptancePreview.tests.length >= 1);
    assert.ok(preview.allowed.includes('运行本地测试'));
  });

  it('写作目标同步派生不为 modify_code', () => {
    const intent = deriveWorkIntentSync({
      goal: '根据现有资料撰写一篇公众号文章',
      contextRefs: [],
    });
    assert.equal(intent.intentKind, 'create_document');
    assert.equal(intent.requiresExecutionConfirm, undefined);
  });

  it('不采用不会自动恢复文件；恢复冲突时停止', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-restore-'));
    const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ev-'));
    await fs.writeFile(path.join(repo, 'a.txt'), 'before', 'utf8');
    const baseline = await captureExecutionBaseline({
      workingDirectory: repo,
      writeScope: ['.'],
      readScope: ['.'],
      jobEvidenceDir: evidence,
    });
    await fs.writeFile(path.join(repo, 'a.txt'), 'after', 'utf8');
    const collected = await collectExecutionChanges({ baseline, jobEvidenceDir: evidence });
    // 用户再次修改 → 冲突
    await fs.writeFile(path.join(repo, 'a.txt'), 'user-edit', 'utf8');
    const restored = await restoreExecutionBaseline({ baseline, collected, jobEvidenceDir: evidence });
    assert.equal(restored.ok, false);
    assert.ok(restored.conflicts.length >= 1);
    const still = await fs.readFile(path.join(repo, 'a.txt'), 'utf8');
    assert.equal(still, 'user-edit');
  });

  it('UI 文案不暴露内部枚举', () => {
    const preview = buildExecutionConfirmPreview({
      goal: 'fix bug',
      workingDirectory: process.cwd(),
      executorDisplayName: '代码执行能力',
    });
    const blob = JSON.stringify(preview);
    assert.doesNotMatch(blob, /queued|executorRunId|adapter|artifactType|CapabilityId/i);
  });
});
