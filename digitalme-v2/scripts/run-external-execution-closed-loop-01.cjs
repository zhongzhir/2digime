/**
 * DIGITALME-V2-EXTERNAL-EXECUTION-CLOSED-LOOP-01
 * 真实验证：每次独立 runId 证据目录；可选真实 Codex（DIGITALME_EECL_REAL=1）。
 */
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(__dirname, '_external-execution-closed-loop-01-evidence');

async function main() {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const evidenceDir = path.join(EVIDENCE_ROOT, runId);
  await fsp.mkdir(evidenceDir, { recursive: true });

  const report = {
    schemaVersion: 'eecl-summary/1',
    runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    ok: false,
    realCodex: false,
    failureStage: null,
    failureMessage: null,
    workRoot: null,
    evidenceDir,
    headHint: 'v2/foundation',
    productionCallChain: [
      'UI work.submitTask',
      'deriveWorkIntent(modify_code)',
      'needsExecutionConfirm → user confirm',
      'WorkRuntime.createQueuedJob + externalExecution',
      'external-executor-codex.execute',
      'baseline → codex exec → collect → verify → code-change bundle',
      'ArtifactCommitter',
      'reviseArtifact / captureSubjectInput(accept) / restore_baseline',
      'GrowthEvent via subject.captureInput',
    ],
    steps: [],
    limitations: [],
    failureLogIndex: [],
  };

  const writeJson = async (name, value) => {
    await fsp.writeFile(path.join(evidenceDir, name), JSON.stringify(value, null, 2), 'utf8');
  };

  const flushSummary = async () => {
    report.completedAt = new Date().toISOString();
    await writeJson('summary.json', report);
    const md = [
      '# EXTERNAL-EXECUTION-CLOSED-LOOP-01 Evidence',
      '',
      `- runId: ${report.runId}`,
      `- ok: ${report.ok}`,
      `- realCodex: ${report.realCodex}`,
      `- startedAt: ${report.startedAt}`,
      `- completedAt: ${report.completedAt}`,
      `- failureStage: ${report.failureStage || '（无）'}`,
      `- failureMessage: ${report.failureMessage || '（无）'}`,
      `- workRoot: ${report.workRoot || ''}`,
      `- evidenceDir: ${report.evidenceDir}`,
      '',
      '## Failure log index',
      ...(report.failureLogIndex.length
        ? report.failureLogIndex.map((x) => `- ${x}`)
        : ['- （无）']),
      '',
      '## Steps',
      '```json',
      JSON.stringify(report.steps, null, 2),
      '```',
      '',
      '## Limitations',
      ...(report.limitations.length ? report.limitations.map((x) => `- ${x}`) : ['- （无）']),
      '',
    ].join('\n');
    await fsp.writeFile(path.join(evidenceDir, 'report.md'), md, 'utf8');
    // latest 指针（不混入旧 hook 文件内容，仅复制本次 summary/report）
    await fsp.mkdir(EVIDENCE_ROOT, { recursive: true });
    await fsp.writeFile(
      path.join(EVIDENCE_ROOT, 'latest.json'),
      JSON.stringify({ runId, evidenceDir, ok: report.ok, realCodex: report.realCodex }, null, 2),
      'utf8',
    );
    await fsp.copyFile(path.join(evidenceDir, 'summary.json'), path.join(EVIDENCE_ROOT, 'summary.json'));
    await fsp.copyFile(path.join(evidenceDir, 'report.md'), path.join(EVIDENCE_ROOT, 'report.md'));
  };

  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { probeCodexAvailability } = require('../dist/capability/adapters/external-executor-codex');

    const probe = await probeCodexAvailability();
    report.codexProbe = probe;
    await writeJson('codex-probe.json', probe);

    const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-eecl-pkg-'));
    report.workRoot = workRoot;
    const repoRoot = path.join(evidenceDir, 'fixture-repo');
    await fsp.mkdir(repoRoot, { recursive: true });
    await fsp.writeFile(
      path.join(repoRoot, 'README.md'),
      '# Fixture\n\nPRIMARY_LABEL=start\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(repoRoot, 'package.json'),
      JSON.stringify(
        { name: 'eecl-fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } },
        null,
        2,
      ),
      'utf8',
    );
    spawnSync('git', ['init'], { cwd: repoRoot, shell: false, windowsHide: true });
    spawnSync('git', ['config', 'user.email', 'eecl@digitalme.local'], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
    });
    spawnSync('git', ['config', 'user.name', 'EECL'], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
    });
    spawnSync('git', ['add', '-A'], { cwd: repoRoot, shell: false, windowsHide: true });
    spawnSync('git', ['commit', '-m', 'baseline'], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
    });

    const useRealCodex = !!probe.available && process.env.DIGITALME_EECL_REAL === '1';
    report.realCodex = useRealCodex;
    if (!useRealCodex) {
      report.limitations.push(
        probe.available
          ? '本机已安装 Codex；默认 hook。设置 DIGITALME_EECL_REAL=1 跑真实 Codex。'
          : '本机 Codex 不可用：使用 executeHook。',
      );
    }

    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: useRealCodex
        ? {}
        : {
            executeHook: async ({ pkg, prompt }) => {
              const target = path.join(pkg.workingDirectory, 'README.md');
              let text = await fsp.readFile(target, 'utf8');
              const isRevision = !!(pkg.previousRun && pkg.previousRun.revisionRequest);
              if (isRevision || /PRIMARY_LABEL=done|改为 done/i.test(prompt)) {
                text = text.replace(/PRIMARY_LABEL=\S+/, 'PRIMARY_LABEL=done');
              } else {
                text = text.replace(/PRIMARY_LABEL=\S+/, 'PRIMARY_LABEL=start-processing');
              }
              await fsp.writeFile(target, text, 'utf8');
              return {
                exitCode: 0,
                summary: `Updated README.md PRIMARY_LABEL. promptChars=${prompt.length}`,
                claimedChangedFiles: ['README.md'],
              };
            },
          },
    });

    await rt.createPackage({ displayName: 'EECL-01', targetDir: workRoot });
    report.steps.push({ step: 'package_created', workRoot });

    const goal1 = useRealCodex
      ? '将 README.md 中的 PRIMARY_LABEL=start 改为 PRIMARY_LABEL=start-processing。不要 commit 或 push。改完后停止。'
      : '把 README.md 里的 PRIMARY_LABEL 改成 start-processing';

    const preview = await rt.submitTask({
      goal: goal1,
      contextRefs: [{ kind: 'folder', path: repoRoot }],
    });
    await writeJson('preview.json', preview);
    if (!preview.needsExecutionConfirm) {
      throw Object.assign(new Error('expected needsExecutionConfirm'), {
        failureStage: 'confirm',
      });
    }
    report.steps.push({ step: 'confirm_card', preview: preview.needsExecutionConfirm });

    const started = await rt.submitTask({
      goal: goal1,
      contextRefs: [{ kind: 'folder', path: repoRoot }],
      executionAuthorization: {
        confirmed: true,
        workingDirectory: preview.needsExecutionConfirm.workingDirectory,
        readScope: preview.needsExecutionConfirm.readScope,
        writeScope: preview.needsExecutionConfirm.writeScope,
      },
    });
    report.steps.push({ step: 'job_started', ...started });

    const first = await waitJob(rt, started.taskId, useRealCodex ? 600_000 : 20_000);
    await writeJson('first-job.json', first);
    report.steps.push({
      step: 'first_result',
      status: first.latestJob?.status,
      lastExecutorStatus: first.latestJob?.externalExecution?.lastExecutorStatus,
      actionable: first.latestJob?.actionable,
      artifactIds: first.artifactIds,
      readme: await fsp.readFile(path.join(repoRoot, 'README.md'), 'utf8'),
    });

    if (first.latestJob?.status !== 'succeeded') {
      report.failureStage = 'first_execution';
      report.failureMessage =
        first.latestJob?.actionable || first.latestJob?.status || 'first job not succeeded';
      report.failureLogIndex.push('first-job.json');
      report.limitations.push(`首次执行未 succeeded：${report.failureMessage}`);
      await flushSummary();
      console.log(
        JSON.stringify(
          { ok: false, evidence: evidenceDir, realCodex: useRealCodex, runId },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    const artifactId = first.artifactIds[0];
    if (!artifactId) {
      throw Object.assign(new Error('no artifact after succeeded job'), {
        failureStage: 'artifact',
      });
    }
    const content1 = await rt.getContent({ artifactId });
    await writeJson('artifact-v1.json', {
      headVersionId: content1.artifact?.headVersionId,
      textHead: String(content1.text || '').slice(0, 2000),
      codeChange: content1.codeChange || null,
      roles: content1.bundle?.entries?.map((e) => e.role),
    });

    const revGoal = '请将 PRIMARY_LABEL 改为 done（实质修订）。不要 commit。';
    const revised = await rt.reviseArtifact({
      taskId: started.taskId,
      artifactId,
      revisionRequest: revGoal,
    });
    const second = await waitJob(rt, started.taskId, useRealCodex ? 600_000 : 20_000);
    await writeJson('second-job.json', second);
    report.steps.push({
      step: 'revise_result',
      jobId: revised.jobId,
      status: second.latestJob?.status,
      lastExecutorStatus: second.latestJob?.externalExecution?.lastExecutorStatus,
      readme: await fsp.readFile(path.join(repoRoot, 'README.md'), 'utf8'),
    });

    if (second.latestJob?.status !== 'succeeded') {
      report.failureStage = 'revise';
      report.failureMessage = second.latestJob?.actionable || 'revise not succeeded';
      report.failureLogIndex.push('second-job.json');
      await flushSummary();
      console.log(
        JSON.stringify(
          { ok: false, evidence: evidenceDir, realCodex: useRealCodex, runId },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    const content2 = await rt.getContent({ artifactId });
    const accept = await rt.captureSubjectInput({
      text: '采用当前代码修改。以后同类文案小改可继续用已连接的代码执行能力；不要自动 push。',
      sourceKind: 'artifact_acceptance',
      taskId: started.taskId,
      artifactId,
      artifactVersionId: content2.artifact.headVersionId,
      requestedArtifactType: 'code-change',
    });
    await writeJson('accept.json', accept);
    report.steps.push({ step: 'accepted', accept });

    const rt2 = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: useRealCodex
        ? {}
        : {
            executeHook: async () => ({
              exitCode: 0,
              summary: 'noop',
              claimedChangedFiles: [],
            }),
          },
    });
    await rt2.openPackage({ dir: workRoot });
    const afterRestart = await rt2.getTask({ taskId: started.taskId });
    await writeJson('after-restart.json', {
      state: afterRestart.state,
      status: afterRestart.latestJob?.status,
      artifactIds: afterRestart.artifactIds,
    });
    report.steps.push({
      step: 'after_restart',
      state: afterRestart.state,
      status: afterRestart.latestJob?.status,
      artifactCount: afterRestart.artifactIds.length,
    });

    const restore = await rt2.retryTask({
      taskId: started.taskId,
      action: 'restore_baseline',
      jobId: second.latestJob?.jobId || started.jobId,
    });
    await writeJson('restore.json', restore);
    report.steps.push({
      step: 'restore',
      restore,
      readmeAfterRestore: await fsp.readFile(path.join(repoRoot, 'README.md'), 'utf8'),
    });

    report.ok =
      first.latestJob?.status === 'succeeded' &&
      second.latestJob?.status === 'succeeded' &&
      afterRestart.artifactIds.length > 0 &&
      afterRestart.latestJob?.status === 'succeeded' &&
      /PRIMARY_LABEL=start-processing/.test(
        report.steps.find((s) => s.step === 'first_result')?.readme || '',
      ) &&
      /PRIMARY_LABEL=done/.test(
        report.steps.find((s) => s.step === 'revise_result')?.readme || '',
      );

    await flushSummary();
    console.log(
      JSON.stringify(
        { ok: report.ok, evidence: evidenceDir, realCodex: useRealCodex, runId },
        null,
        2,
      ),
    );
    if (!report.ok) process.exitCode = 1;
  } catch (err) {
    report.failureStage = err.failureStage || 'uncaught';
    report.failureMessage = err.message || String(err);
    report.failureLogIndex.push('uncaught-error');
    report.limitations.push(report.failureMessage);
    await writeJson('uncaught-error.json', {
      message: err.message,
      stack: String(err.stack || '').slice(0, 4000),
    });
    await flushSummary();
    console.error(err);
    console.log(
      JSON.stringify(
        {
          ok: false,
          evidence: evidenceDir,
          realCodex: report.realCodex,
          runId,
          failureMessage: report.failureMessage,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function waitJob(rt, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let detail = await rt.getTask({ taskId });
  while (
    Date.now() < deadline &&
    detail.latestJob &&
    (detail.latestJob.status === 'queued' || detail.latestJob.status === 'running')
  ) {
    await new Promise((r) => setTimeout(r, 200));
    detail = await rt.getTask({ taskId });
  }
  return detail;
}

main();
