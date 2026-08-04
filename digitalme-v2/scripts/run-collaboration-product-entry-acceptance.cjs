/**
 * COLLABORATION-PRODUCT-ENTRY (+ FIX-01) 验收（未宣称正式开放；不提交）。
 * 用法: npm run accept:collaboration-product-entry
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(appRoot, 'electron/renderer/styles.css'), 'utf8');
const hay = `${html}\n${appJs}\n${styles}`;

for (const re of [
  /id="nav-collab"/,
  /id="panel-collab"/,
  /新建协作/,
  /进行中/,
  /已完成/,
  /已撤销/,
  /查看授权范围/,
  /发出协作/,
  /还没有可协作的数字之我/,
  /导入数字之我/,
  /将看到：/,
  /对方可以做：/,
  /对方不能做：/,
  /可以随时撤销这次授权/,
  /另一个数字之我/,
  /交给协作对象|交给另一个数字之我/,
  /id="btn-collab-open"/,
  /id="collab-peer-name"/,
  /id="collab-page-peer-name"/,
  /collab-peer-card/,
  /action:\s*["']list["']/,
  /action:\s*["']issue["']/,
  /action:\s*["']execute["']/,
  /action:\s*["']acceptReturn["']/,
  /action:\s*["']revoke["']/,
  /action:\s*["']status["']/,
  /action:\s*["']resolvePeer["']/,
  /等待对方处理/,
  /正在完成/,
  /已返回成果/,
  /已采用/,
  /未采用/,
  /授权未成功/,
  /对方未能完成/,
  /授权已撤销/,
  /无法读取协作对象/,
  /本地位置：/,
  /协作成果/,
]) {
  if (!re.test(hay)) fail(`missing product-entry marker: ${re}`);
}
ok('product-entry UI markers present');

if (/ensureIssuerTaskForCollab/.test(appJs)) {
  fail('container-task helper ensureIssuerTaskForCollab must be removed');
}
if (/协作：\$\{goal\}|协作：` \+|goal:\s*[`'"]协作：/.test(appJs)) {
  fail('collab issue path must not fabricate container task goals');
}
ok('no A-side container task fabrication in renderer');

// 协作入口必须在主任务区，不得嵌在成果侧栏内
const artifactStart = html.indexOf('id="artifact-panel"');
const artifactEnd = html.indexOf('</section>', artifactStart);
const artifactChunk =
  artifactStart >= 0 && artifactEnd > artifactStart
    ? html.slice(artifactStart, artifactEnd)
    : '';
if (/id="collab-box"|id="btn-collab-open"/.test(artifactChunk)) {
  fail('work-page collab entry must not live inside artifact panel');
}
if (!/id="job-actionable"[\s\S]*id="collab-box"/.test(html)) {
  fail('work-page collab entry must sit near task goal/materials (after job status)');
}
ok('work-page collab entry independent of artifact panel');

if (/AuthorizationGrant|ContextSnapshot|GrowthEvent|Grant ID|Job ID|tool_calls|DSML/i.test(html)) {
  fail('internal terms leaked into collaboration HTML');
}
ok('no internal protocol terms in HTML');

if (/localStorage\.setItem\(["']collab|indexedDB|new CollaborationStore/i.test(appJs)) {
  fail('second collaboration store detected in renderer');
}
ok('no second collaboration store in renderer');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/collaboration/tests/local-collaboration.test.js',
  ],
  { stdio: 'inherit', cwd: appRoot },
);
if (domain.status !== 0) fail(`collaboration domain tests exited ${domain.status}`);
ok('collaboration domain tests passed');

const sample = spawnSync(
  process.execPath,
  [
    '-e',
    `
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { createDigitalMeRuntime } = require('./dist/runtime/digitalme-runtime.js');
const { createCommandBus } = require('./dist/runtime/command-bus.js');
const { waitForJobTerminal } = require('./dist/work-runtime/job-runner.js');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-collab-entry-'));
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  const matX = path.join(root, 'x.md');
  await fs.writeFile(matX, '授权材料X：产品入口验收要点。');

  const rtA = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(rtA);
  await rtA.createPackage({
    displayName: '入口甲',
    targetDir: dirA,
    initialSelfDescription: '我负责主报告。',
  });
  const rtBSeed = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rtBSeed.createPackage({
    displayName: '入口乙',
    targetDir: dirB,
    initialSelfDescription: '我协助整理摘要。',
  });
  await rtBSeed.stop();

  const peer = await bus.invoke('collab.simulateInteraction', {
    action: 'resolvePeer',
    granteePackageDir: dirB,
  });
  assert.equal(peer.displayName, '入口乙');
  assert.ok(peer.packageDir);

  // 1) 协作页新建：无 A 容器 Task / 无 cancel Job
  const aTasks0 = await rtA.listTasks({ limit: 50 });
  const issuedHome = await bus.invoke('collab.simulateInteraction', {
    action: 'issue',
    granteePackageDir: dirB,
    subtaskGoal: '根据授权材料整理要点摘要',
    allowedMaterialPaths: [matX],
  });
  const aTasks1 = await rtA.listTasks({ limit: 50 });
  assert.equal(aTasks1.tasks.length, aTasks0.tasks.length, 'home issue must not create A task');

  const rtB0 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rtB0.openPackage({ dir: dirB });
  assert.equal((await rtB0.listTasks({ limit: 20 })).tasks.length, 0, 'B has no task before execute');
  await rtB0.stop();

  const executedHome = await bus.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issuedHome.grantId,
  });
  assert.equal(executedHome.status, 'completed');
  assert.ok((executedHome.artifactText || '').length > 0);

  const rtB1 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rtB1.openPackage({ dir: dirB });
  const bTasks = await rtB1.listTasks({ limit: 20 });
  assert.equal(bTasks.tasks.length, 1, 'B task created only after execute');
  const bDetail = await rtB1.getTask({ taskId: bTasks.tasks[0].taskId });
  assert.equal(bDetail.task.authorization.grantId, issuedHome.grantId);
  assert.ok(bDetail.latestJob && bDetail.latestJob.jobId);
  assert.ok(bDetail.artifactIds && bDetail.artifactIds[0]);
  await rtB1.stop();

  // 2) 主任务无成果时也可关联发起协作，并在采用后整合
  const main = await rtA.submitTask({
    goal: '主报告骨架（稍后才会有成果）',
    contextRefs: [{ kind: 'file', path: matX }],
    requestedArtifactType: 'document',
  });
  await rtA.cancelJob({ jobId: main.jobId });
  const mainDetailEarly = await rtA.getTask({ taskId: main.taskId });
  assert.ok(!mainDetailEarly.artifactIds || mainDetailEarly.artifactIds.length === 0);

  const issuedWork = await bus.invoke('collab.simulateInteraction', {
    action: 'issue',
    granteePackageDir: dirB,
    issuerTaskId: main.taskId,
    subtaskGoal: '无主成果时的协作摘要',
    allowedMaterialPaths: [matX],
  });
  const stEarly = await bus.invoke('collab.simulateInteraction', {
    action: 'status',
    grantId: issuedWork.grantId,
  });
  assert.equal(stEarly.status, 'authorized');
  assert.ok(stEarly.grant.returnedExcerpt === undefined);

  const executedWork = await bus.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issuedWork.grantId,
  });
  assert.equal(executedWork.status, 'completed');
  assert.ok((executedWork.artifactText || '').length > 0);

  // 先查看协作成果（主任务仍无成果）
  const listed = await bus.invoke('collab.simulateInteraction', { action: 'list' });
  const workItem = listed.items.find((i) => i.grantId === issuedWork.grantId);
  assert.ok(workItem && workItem.returnedExcerpt);

  // 主任务随后出成果，再采用整合
  const retried = await rtA.retryTask({ taskId: main.taskId });
  await waitForJobTerminal(rtA.workRuntime, retried.jobId);
  const mainReady = await rtA.getTask({ taskId: main.taskId });
  assert.ok(mainReady.artifactIds[0]);
  const beforeText = (await rtA.getContent({ artifactId: mainReady.artifactIds[0] })).text || '';

  await bus.invoke('collab.simulateInteraction', {
    action: 'acceptReturn',
    grantId: issuedWork.grantId,
    decision: 'accept',
  });
  const afterText = (await rtA.getContent({ artifactId: mainReady.artifactIds[0] })).text || '';
  assert.match(afterText, /协作摘要（已采用）/);
  assert.ok(afterText.length > beforeText.length);

  await bus.invoke('collab.simulateInteraction', {
    action: 'revoke',
    grantId: issuedWork.grantId,
  });
  const again = await bus.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issuedWork.grantId,
  });
  assert.equal(again.denied, true);

  const rtA2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus2 = createCommandBus(rtA2);
  await rtA2.openPackage({ dir: dirA });
  const listed2 = await bus2.invoke('collab.simulateInteraction', { action: 'list' });
  assert.ok(listed2.items.some((i) => i.grantId === issuedHome.grantId));
  assert.ok(listed2.items.some((i) => i.grantId === issuedWork.grantId && i.status === 'revoked'));

  await rtA.stop();
  await rtA2.stop();
  console.log('product-entry fix domain sample OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
`,
  ],
  { stdio: 'inherit', cwd: appRoot },
);
if (sample.status !== 0) fail('product-entry domain sample failed');
ok('product-entry domain sample passed (no container task; B after execute; integrate)');

console.log('\naccept:collaboration-product-entry PASSED');
console.log(
  'NOTE: product entry fix ready for Owner path review; not claimed product-ready; do not commit unless authorized.',
);
