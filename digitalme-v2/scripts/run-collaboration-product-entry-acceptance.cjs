/**
 * 产品入口验收 — 适配主体协作主链（propose/fulfill/decideResult）。
 * 不再把协作摘要拼入主成果正文；采用走 Artifact 决策 + Growth。
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

async function main() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');

  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dmv2-collab-entry-'));
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  const matX = path.join(root, 'x.md');
  fs.writeFileSync(matX, '材料X：入口验收要点。', 'utf8');

  const rtA = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(rtA);
  await rtA.createPackage({
    displayName: '入口甲',
    targetDir: dirA,
    initialSelfDescription: '我发起协作。',
  });

  const rtBSeed = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rtBSeed.createPackage({
    displayName: '入口乙',
    targetDir: dirB,
    initialSelfDescription: '我协助整理摘要。',
  });
  await rtBSeed.stop();

  const peer = await bus.invoke('collab.interact', {
    action: 'resolvePeer',
    granteePackageDir: dirB,
  });
  assert.equal(peer.displayName, '入口乙');
  assert.ok(peer.packageDir);
  assert.ok(peer.endpointRef);

  const aTasks0 = await rtA.listTasks({ limit: 50 });
  const issuedHome = await bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '根据授权材料整理要点摘要',
    allowedMaterialPaths: [matX],
    acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  const aTasks1 = await rtA.listTasks({ limit: 50 });
  assert.equal(aTasks1.tasks.length, aTasks0.tasks.length, 'home propose must not create A task');
  assert.ok(issuedHome.recordId);
  assert.ok(issuedHome.grantId);

  const rtB0 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rtB0.openPackage({ dir: dirB });
  assert.equal((await rtB0.listTasks({ limit: 20 })).tasks.length, 0, 'B has no task before fulfill');
  await rtB0.stop();

  const executedHome = await bus.invoke('collab.interact', {
    action: 'fulfill',
    recordId: issuedHome.recordId,
  });
  assert.equal(executedHome.status, 'delivered');
  assert.ok((executedHome.artifactText || '').length > 0);
  assert.ok(executedHome.localArtifactId);

  const rtB1 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rtB1.openPackage({ dir: dirB });
  const bTasks = await rtB1.listTasks({ limit: 20 });
  assert.equal(bTasks.tasks.length, 1, 'B task created only after fulfill');
  const bDetail = await rtB1.getTask({ taskId: bTasks.tasks[0].taskId });
  assert.equal(bDetail.task.authorization.grantId, issuedHome.grantId);
  assert.ok(bDetail.latestJob && bDetail.latestJob.jobId);
  assert.ok(bDetail.artifactIds && bDetail.artifactIds[0]);
  await rtB1.stop();

  const local = await rtA.getContent({ artifactId: executedHome.localArtifactId });
  assert.ok(local.artifact.provenance);
  assert.equal(local.artifact.provenance.sourceArtifactId, executedHome.artifactId);

  await bus.invoke('collab.interact', {
    action: 'decideResult',
    recordId: issuedHome.recordId,
    decision: 'accept',
  });

  const listed = await bus.invoke('collab.interact', { action: 'list' });
  const homeItem = listed.items.find((i) => i.recordId === issuedHome.recordId);
  assert.ok(homeItem);
  assert.equal(homeItem.status, 'completed');

  await bus.invoke('collab.interact', {
    action: 'revoke',
    recordId: issuedHome.recordId,
  });
  const again = await bus.invoke('collab.interact', {
    action: 'fulfill',
    recordId: issuedHome.recordId,
  });
  assert.equal(again.denied, true);

  await rtA.stop();
  const rtA2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus2 = createCommandBus(rtA2);
  await rtA2.openPackage({ dir: dirA });
  const listed2 = await bus2.invoke('collab.interact', { action: 'list' });
  const row = listed2.items.find((i) => i.recordId === issuedHome.recordId);
  assert.equal(row.status, 'revoked');
  await rtA2.stop();

  console.log('collaboration product entry acceptance: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
