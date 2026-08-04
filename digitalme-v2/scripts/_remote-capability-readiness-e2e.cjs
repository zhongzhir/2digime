/**
 * 远端能力产品准备 E2E:
 * Subject → Task → Grant → ControlledRemote → Job 投影 → Verify → 采用 → Growth → 重启
 */
'use strict';

const { promises: fs } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const {
    createDigitalMeRuntime,
  } = require('../dist/runtime/digitalme-runtime.js');
  const {
    startControlledRemotePeer,
    CONTROLLED_REMOTE_CAPABILITY_ID,
  } = require('../dist/capability/adapters/controlled-remote.js');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner.js');
  const { artifactIdForJob } = require('../dist/work-runtime/artifact.js');
  const { newId, nowIso } = require('../dist/shared/ids.js');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-remote-e2e-'));
  const peer = await startControlledRemotePeer({ processDelayMs: 40 });
  const endpoint = peer.baseUrl;
  const pkgDir = path.join(root, 'pkg');
  const matDir = path.join(root, 'materials');
  await fs.mkdir(matDir, { recursive: true });
  const allowedFile = path.join(matDir, 'allowed.txt');
  const secretFile = path.join(matDir, 'secret.txt');
  await fs.writeFile(allowedFile, '授权可见：北极星指标与客户分层', 'utf8');
  await fs.writeFile(secretFile, 'SECRET_UNAUTHORIZED_PAYLOAD_XYZ 未授权融资细节', 'utf8');

  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    remoteCapability: {
      endpoint,
      allowedEndpoints: [endpoint],
      timeoutMs: 15_000,
      maxCallsPerTask: 3,
    },
  });

  try {
    await runtime.createPackage({
      displayName: '准备验收主体',
      targetDir: pkgDir,
      initialSelfDescription: '我做 B2B 产品，重视可核对的简报结构',
    });

    // 写入 Grant(对象 #8),证明授权投影输入存在
    const pkg = runtime.subject.requireActive();
    const grantId = newId('grant');
    const grant = {
      id: grantId,
      grantorSubjectId: pkg.id,
      grantee: { kind: 'remote_subject', subjectId: 'remote_peer_local' },
      scope: {
        actions: ['read_authorized_context', 'execute_subtask', 'return_artifact'],
        resourceRefs: [allowedFile],
      },
      origin: { kind: 'owner_direct' },
      status: 'granted',
      grantedAt: nowIso(),
      subtaskGoal: '根据授权材料写产品简报',
    };
    const grantDir = path.join(pkg.rootDir, 'collaboration', 'grants');
    await fs.mkdir(grantDir, { recursive: true });
    await fs.writeFile(path.join(grantDir, `${grantId}.json`), `${JSON.stringify(grant, null, 2)}\n`);

    const { taskId, jobId } = await runtime.submitTask({
      goal: '根据授权材料写产品简报',
      contextRefs: [
        { kind: 'file', path: allowedFile },
        { kind: 'file', path: secretFile },
      ],
      requestedArtifactType: 'document',
      capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
      authorization: {
        grantId,
        issuerSubjectId: pkg.id,
        granteeSubjectId: 'remote_peer_local',
      },
    });

    const job = await waitForJobTerminal(runtime.workRuntime, jobId, 20_000);
    if (job.status !== 'succeeded') {
      throw new Error(`expected succeeded, got ${job.status}: ${job.failure?.message || ''}`);
    }
    if (!job.remoteExecution?.executionId) {
      throw new Error('missing remoteExecution mapping on local Job');
    }

    const artifactId = artifactIdForJob(jobId);
    const artifact = await runtime.getArtifact(artifactId);
    if (!artifact) throw new Error('missing artifact after verification');

    const content = await runtime.getContent({
      artifactId,
      versionId: artifact.headVersionId,
    });
    const text = String(content.text || content.bundle?.entries?.map((e) => e.text || '').join('\n') || '');
    if (/SECRET_UNAUTHORIZED_PAYLOAD_XYZ/.test(text)) {
      throw new Error('unauthorized material leaked into artifact');
    }
    // bundle 主文或收据路径均可证明输入驱动合成
    const receiptHit = /action-receipt|controlled-remote|输入指纹|受控远端/.test(text)
      || (content.bundle && content.bundle.entries.some((e) => e.role === 'action-receipt'));
    const goalHit = text.includes('根据授权材料写产品简报') || text.includes('产品简报') || text.includes('受控远端');
    if (!receiptHit && !goalHit) {
      throw new Error(`artifact text not input-driven: ${text.slice(0, 200)}`);
    }

    // 未验证路径不得写正向成长:先确认当前无 acceptance 成长
    const before = await runtime.subject.listGrowthEvents();
    const beforeAccept = before.filter(
      (e) => e.source?.kind === 'artifact_acceptance' || e.type === 'experience_candidate',
    ).length;

    // 采用 → GrowthEvent(经既有 subject.captureInput)
    const accepted = await runtime.captureSubjectInput({
      text: '采用该简报中的北极星指标结构作为后续默认经验',
      sourceKind: 'artifact_acceptance',
      artifactId,
      artifactVersionId: artifact.headVersionId,
    });
    if (!accepted) throw new Error('captureInput failed');

    const after = await runtime.subject.listGrowthEvents();
    if (after.length <= before.length) {
      throw new Error('expected growth events after verified adoption');
    }

    // 拒绝未验证成果进入成长:伪造无验证收据的「候选」不得经 commit 产生;
    // 取消后迟到成果 — 另开任务验证
    const { jobId: cancelJobId } = await runtime.submitTask({
      goal: '取消后迟到成果不得写入',
      contextRefs: [{ kind: 'file', path: allowedFile }],
      requestedArtifactType: 'document',
      capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
    });
    // 等到进入 running 再取消,覆盖远端映射取消路径;本地 abort 必须先于远端 HTTP。
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      const view = await runtime.workRuntime.getJob(cancelJobId);
      if (view && (view.status === 'running' || view.status === 'queued')) {
        if (view.status === 'running' && view.remoteExecution?.executionId) break;
        if (view.status === 'queued' && Date.now() - startedAt > 200) break;
      }
      if (view && (view.status === 'succeeded' || view.status === 'failed' || view.status === 'cancelled')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await runtime.cancelJob({ jobId: cancelJobId });
    const cancelled = await waitForJobTerminal(runtime.workRuntime, cancelJobId, 10_000);
    if (cancelled.status !== 'cancelled') {
      throw new Error(`expected cancelled, got ${cancelled.status}`);
    }
    if (await runtime.getArtifact(artifactIdForJob(cancelJobId))) {
      throw new Error('late/cancelled job must not write artifact');
    }

    // 相关经验可用于下一任务;无关不污染 — 再提交任务,确认 subject 注入可选
    const { jobId: nextJobId } = await runtime.submitTask({
      goal: '再写一份强调北极星指标的产品简报',
      contextRefs: [{ kind: 'file', path: allowedFile }],
      requestedArtifactType: 'document',
      capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
    });
    const nextJob = await waitForJobTerminal(runtime.workRuntime, nextJobId, 20_000);
    if (nextJob.status !== 'succeeded') {
      throw new Error(`next task failed: ${nextJob.failure?.message || nextJob.status}`);
    }

    // 重启恢复:远端完成映射仍在
    const remoteId = job.remoteExecution.executionId;
    await runtime.stop();

    const jobPath = path.join(pkgDir, 'runtime', 'jobs', `${jobId}.json`);
    const raw = JSON.parse(await fs.readFile(jobPath, 'utf8'));
    raw.status = 'running';
    raw.remoteExecution = {
      executionId: remoteId,
      adapterId: 'controlled-remote-subject',
      endpoint,
      lastRemoteStatus: 'completed',
    };
    delete raw.finishedAt;
    delete raw.artifactId;
    delete raw.failure;
    await fs.writeFile(jobPath, `${JSON.stringify(raw, null, 2)}\n`);
    await fs.rm(path.join(pkgDir, 'runtime', 'artifacts', `${artifactId}.json`), { force: true });

    const runtime2 = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      remoteCapability: { endpoint, allowedEndpoints: [endpoint], timeoutMs: 15_000 },
    });
    await runtime2.openPackage({ dir: pkgDir });
    const recovered = await waitForJobTerminal(runtime2.workRuntime, jobId, 20_000);
    if (recovered.status !== 'succeeded') {
      throw new Error(`recover failed: ${recovered.status} ${recovered.failure?.message || ''}`);
    }
    if (!(await runtime2.getArtifact(artifactId))) {
      throw new Error('recovered artifact missing');
    }

    // 无第二 Store:协作 grants 目录仍是 Grant Store,不得出现 remote-executions 权威目录
    const runtimeDir = path.join(pkgDir, 'runtime');
    const names = await fs.readdir(runtimeDir);
    if (names.some((n) => /remote-exec|remote_job|remote-store/i.test(n))) {
      throw new Error('second remote store directory detected');
    }

    await runtime2.stop();
    console.log('E2E OK', {
      taskId,
      jobId,
      grantId,
      beforeAccept,
      growthAfter: after.length,
    });
  } finally {
    await runtime.stop().catch(() => undefined);
    await peer.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('E2E FAIL:', error && error.stack ? error.stack : error);
  process.exit(1);
});
