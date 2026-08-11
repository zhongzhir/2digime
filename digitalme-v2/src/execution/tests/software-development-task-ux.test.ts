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
    assert.match(
      preview.needsExecutionConfirm!.title || '',
      /修改项目文件|确认权限|开始前请确认/,
    );
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
    assert.match(result.needsExecutorSetup!.message, /尚未检测|需要连接|代码执行能力/);
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

  it('成果区提供提出修改且说明字段不承担修订', async () => {
    const html = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/index.html'),
      'utf8',
    );
    const appJs = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/app.js'),
      'utf8',
    );
    assert.match(html, /id="btn-propose-revision"/);
    assert.match(html, /提出修改/);
    assert.match(html, /id="artifact-decision-note"/);
    assert.match(html, /采用说明/);
    assert.doesNotMatch(html, /采用或不采用说明（可选）/);
    assert.match(html, /id="revision-composer"/);
    assert.match(html, /id="btn-revise"/);
    assert.equal((html.match(/id="btn-accept-artifact"/g) || []).length, 1);
    assert.equal((html.match(/id="btn-reject-artifact"/g) || []).length, 1);
    assert.doesNotMatch(html, /填写修改要求后点击不采用/);
    assert.match(appJs, /hideRevisionComposer/);
    assert.match(appJs, /showRevisionComposer/);
    assert.match(appJs, /采用\/不采用说明不得作为 revisionRequest/);
    assert.doesNotMatch(appJs, /不采用后自然进入修订/);
  });

  it('修订复用同一 task/artifact 主链', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-rev-repo-'));
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-rev-pkg-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"r"}', 'utf8');
    await fs.writeFile(
      path.join(dir, 'formatLabel.js'),
      "module.exports={formatLabel:(i)=>i};\n",
      'utf8',
    );
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        executeHook: async ({ pkg: taskPkg }) => {
          const target = path.join(taskPkg.workingDirectory, 'formatLabel.js');
          const done = !!(taskPkg.previousRun && taskPkg.previousRun.revisionRequest);
          await fs.writeFile(
            target,
            done
              ? "module.exports={formatLabel:(i)=>i==='start'?'done':i};\n"
              : "module.exports={formatLabel:(i)=>i==='start'?'start-processing':i};\n",
            'utf8',
          );
          return {
            exitCode: 0,
            summary: done ? 'done' : 'start-processing',
            claimedChangedFiles: ['formatLabel.js'],
          };
        },
      },
    });
    await rt.createPackage({ displayName: 'rev', targetDir: pkg });
    const preview = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel，使 start 返回 start-processing，并运行测试',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(preview.needsExecutionConfirm);
    const started = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel，使 start 返回 start-processing，并运行测试',
      contextRefs: [{ kind: 'folder', path: dir }],
      executionAuthorization: {
        confirmed: true,
        workingDirectory: dir,
        readScope: ['.'],
        writeScope: ['.'],
      },
    });
    const { waitForJobTerminal } = await import('../../work-runtime/job-runner');
    await waitForJobTerminal(rt.workRuntime, started.jobId, 20000);
    const after = await rt.getTask({ taskId: started.taskId });
    assert.equal(after.latestJob?.status, 'succeeded');
    const artifactId = after.artifactIds[0];
    assert.ok(artifactId);
    const rev = await rt.reviseArtifact({
      taskId: started.taskId,
      artifactId,
      revisionRequest: '将 start-processing 改为 done，并同步更新测试。',
    });
    await waitForJobTerminal(rt.workRuntime, rev.jobId, 20000);
    const afterRev = await rt.getTask({ taskId: started.taskId });
    assert.equal(afterRev.latestJob?.status, 'succeeded');
    assert.equal(afterRev.artifactIds.length, 1);
    assert.equal(afterRev.artifactIds[0], artifactId);
    const body = await fs.readFile(path.join(dir, 'formatLabel.js'), 'utf8');
    assert.match(body, /done/);
  });

  it('rebootstrap 后默认包可再挂载且执行器仍注册', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(__filename);
    const {
      ensureDefaultPackageAttached,
      countSubjectPackages,
    } = req(path.join(__dirname, '../../../electron/default-package.cjs')) as {
      ensureDefaultPackageAttached: (opts: {
        runtime: ReturnType<typeof createDigitalMeRuntime>;
        userDataPath: string;
      }) => Promise<{ ok: boolean; created?: boolean }>;
      countSubjectPackages: (userDataPath: string) => number;
    };
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-reboot-ud-'));
    const makeRt = () =>
      createDigitalMeRuntime({
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
    let rt = makeRt();
    const first = await ensureDefaultPackageAttached({ runtime: rt, userDataPath: userData });
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(rt.isPackageAttached(), true);
    let caps = await rt.listCapabilities();
    assert.ok(
      caps.capabilities.some((c) => /external-executor|codex|代码执行/i.test(JSON.stringify(c))),
    );
    await rt.stop();
    rt = makeRt();
    assert.equal(rt.isPackageAttached(), false);
    const second = await ensureDefaultPackageAttached({ runtime: rt, userDataPath: userData });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(rt.isPackageAttached(), true);
    assert.equal(countSubjectPackages(userData), 1);
    caps = await rt.listCapabilities();
    assert.ok(
      caps.capabilities.some((c) => /external-executor|codex|代码执行/i.test(JSON.stringify(c))),
    );
  });
});
