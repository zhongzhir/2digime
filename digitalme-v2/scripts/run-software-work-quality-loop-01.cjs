/**
 * 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP
 * 真实 Codex 对独立目标仓做有意义软件改动 + 修订 + 采用记录。
 * Env:
 *   DIGITALME_SWQL_TARGET  目标仓根（含 digitalme-v2）
 *   DIGITALME_EECL_REAL=1  必须，真实 Codex
 */
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(__dirname, '_software-work-quality-loop-01-evidence');

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

async function findFile(root, name, max = 40) {
  const out = [];
  async function walk(dir, depth) {
    if (out.length >= max || depth > 8) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) return;
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(abs, depth + 1);
      else if (ent.name === name) out.push(abs);
    }
  }
  await walk(root, 0);
  return out;
}

async function waitJob(rt, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let detail = await rt.getTask({ taskId });
  while (
    Date.now() < deadline &&
    detail.latestJob &&
    (detail.latestJob.status === 'queued' || detail.latestJob.status === 'running')
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    detail = await rt.getTask({ taskId });
  }
  return detail;
}

function runNodeTest(cwd, testGlob) {
  const r = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', testGlob],
    {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 180_000,
      env: process.env,
    },
  );
  return {
    status: r.status,
    stdout: String(r.stdout || '').slice(0, 8000),
    stderr: String(r.stderr || '').slice(0, 4000),
    error: r.error ? String(r.error.message) : null,
  };
}

async function main() {
  const runId = `swql_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const evidenceDir = path.join(EVIDENCE_ROOT, runId);
  await fsp.mkdir(evidenceDir, { recursive: true });

  const targetRoot = String(process.env.DIGITALME_SWQL_TARGET || '').trim();
  if (!targetRoot || !fs.existsSync(targetRoot)) {
    throw new Error(`DIGITALME_SWQL_TARGET missing or not found: ${targetRoot}`);
  }
  const workDir = path.join(targetRoot, 'digitalme-v2');
  if (!fs.existsSync(path.join(workDir, 'src', 'shared', 'ids.ts'))) {
    throw new Error(`target missing src/shared/ids.ts under ${workDir}`);
  }

  const initialHead = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: targetRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  const initialStatus = spawnSync('git', ['status', '--porcelain'], {
    cwd: targetRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  const summary = {
    phase: '2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP',
    runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    targetRoot,
    workingDirectory: workDir,
    targetHead: String(initialHead.stdout || '').trim(),
    initialStatusPorcelain: String(initialStatus.stdout || ''),
    realCodex: false,
    understandingPresent: false,
    understandingRefsReal: false,
    diffMeaningful: false,
    testsPassed: false,
    revisionChanged: false,
    adoptionRecorded: false,
    committed: false,
    pushed: false,
    conclusion: 'incomplete',
    ownerAccepted: false,
    failureStage: null,
    failureMessage: null,
    testOutput: null,
    steps: [],
    limitations: [],
  };

  const writeJson = async (name, value) => {
    await fsp.writeFile(path.join(evidenceDir, name), JSON.stringify(value, null, 2), 'utf8');
  };

  const flush = async () => {
    summary.completedAt = new Date().toISOString();
    await writeJson('summary.json', summary);
    const md = [
      '# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP',
      '',
      `- phase: ${summary.phase}`,
      `- realCodex: ${summary.realCodex}`,
      `- understandingPresent: ${summary.understandingPresent}`,
      `- understandingRefsReal: ${summary.understandingRefsReal}`,
      `- diffMeaningful: ${summary.diffMeaningful}`,
      `- testsPassed: ${summary.testsPassed}`,
      `- revisionChanged: ${summary.revisionChanged}`,
      `- adoptionRecorded: ${summary.adoptionRecorded}`,
      `- conclusion: ${summary.conclusion}`,
      `- ownerAccepted: ${summary.ownerAccepted}`,
      `- targetRoot: ${summary.targetRoot}`,
      `- targetHead: ${summary.targetHead}`,
      `- failureStage: ${summary.failureStage || '（无）'}`,
      `- failureMessage: ${summary.failureMessage || '（无）'}`,
      '',
      '## 说明',
      '',
      '本摘要为工程验证证据，**不是** Owner 运行时验收。`ownerAccepted` 必须为 false。',
      '',
    ].join('\n');
    await fsp.writeFile(path.join(evidenceDir, 'ACCEPTANCE_SUMMARY.md'), md, 'utf8');
    await fsp.writeFile(path.join(EVIDENCE_ROOT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    await fsp.copyFile(
      path.join(evidenceDir, 'ACCEPTANCE_SUMMARY.md'),
      path.join(EVIDENCE_ROOT, 'ACCEPTANCE_SUMMARY.md'),
    );
    await fsp.writeFile(
      path.join(EVIDENCE_ROOT, 'latest.json'),
      JSON.stringify(
        {
          runId,
          evidenceDir,
          realCodex: summary.realCodex,
          conclusion: summary.conclusion,
        },
        null,
        2,
      ),
      'utf8',
    );
  };

  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { probeCodexAvailability } = require('../dist/capability/adapters/external-executor-codex');

    const probe = await probeCodexAvailability();
    summary.codexProbe = probe;
    await writeJson('codex-probe.json', probe);
    await writeJson('target-initial.json', {
      targetRoot,
      workDir,
      head: summary.targetHead,
      statusPorcelain: summary.initialStatusPorcelain,
    });

    if (!probe.available) {
      summary.realCodex = false;
      summary.failureStage = 'codex_probe';
      summary.failureMessage = probe.detail || 'Codex unavailable';
      summary.conclusion = 'blocked_codex_unavailable';
      summary.limitations.push('真实 Codex 不可用；按任务要求 STOP，不假装。');
      await flush();
      console.log(JSON.stringify({ ok: false, evidenceDir, summary }, null, 2));
      process.exitCode = 1;
      return;
    }

    if (process.env.DIGITALME_EECL_REAL !== '1') {
      summary.failureStage = 'env';
      summary.failureMessage = 'DIGITALME_EECL_REAL=1 required for real Codex';
      summary.conclusion = 'blocked_codex_unavailable';
      await flush();
      process.exitCode = 1;
      return;
    }

    summary.realCodex = true;

    const idsBefore = await fsp.readFile(path.join(workDir, 'src', 'shared', 'ids.ts'), 'utf8');
    await writeJson('ids-before.ts.json', { text: idsBefore });

    const pkgWorkRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-swql-pkg-'));
    summary.packageWorkRoot = pkgWorkRoot;

    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {},
    });
    await rt.createPackage({ displayName: 'SWQL-01', targetDir: pkgWorkRoot });
    summary.steps.push({ step: 'package_created', pkgWorkRoot });

    const goal1 = [
      '修改 digitalme-v2 项目文件：在 src/shared/ids.ts 实现并导出纯函数 clampString(s: string, max: number): string。',
      '当 s 长度超过 max 时截断到 max（max<=0 时返回空字符串），否则返回原字符串。',
      '添加单元测试功能：新建 src/infrastructure/tests/ids-clamp-string.test.ts（node:test + node:assert/strict），覆盖截断、不截断、max<=0。',
      '完成后务必执行 npm run build，再跑：node --test --test-concurrency=1 dist/infrastructure/tests/ids-clamp-string.test.js ，确保通过。',
      '不要 git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"，不要 git push，不要改无关文件。改完后停止。',
    ].join('');

    const preview = await rt.submitTask({
      goal: goal1,
      contextRefs: [{ kind: 'folder', path: workDir }],
    });
    await writeJson('preview.json', preview);
    if (!preview.needsExecutionConfirm) {
      throw Object.assign(new Error('expected needsExecutionConfirm'), {
        failureStage: 'confirm',
      });
    }
    summary.steps.push({
      step: 'confirm_card',
      workingDirectory: preview.needsExecutionConfirm.workingDirectory,
      understandingSummary: preview.needsExecutionConfirm.understandingSummary || null,
    });

    const started = await rt.submitTask({
      goal: goal1,
      contextRefs: [{ kind: 'folder', path: workDir }],
      executionAuthorization: {
        confirmed: true,
        workingDirectory: preview.needsExecutionConfirm.workingDirectory,
        readScope: preview.needsExecutionConfirm.readScope,
        writeScope: preview.needsExecutionConfirm.writeScope,
      },
    });
    summary.steps.push({ step: 'job_started', ...started });

    const first = await waitJob(rt, started.taskId, 900_000);
    await writeJson('first-job.json', {
      status: first.latestJob?.status,
      actionable: first.latestJob?.actionable,
      lastExecutorStatus: first.latestJob?.externalExecution?.lastExecutorStatus,
      artifactIds: first.artifactIds,
      failureKind: first.latestJob?.failureKind,
    });
    summary.steps.push({
      step: 'first_result',
      status: first.latestJob?.status,
      actionable: first.latestJob?.actionable,
    });

    const understandingPaths = await findFile(pkgWorkRoot, 'understanding.json');
    let understanding = null;
    if (understandingPaths[0]) {
      understanding = JSON.parse(await fsp.readFile(understandingPaths[0], 'utf8'));
      await fsp.copyFile(understandingPaths[0], path.join(evidenceDir, 'understanding.json'));
      summary.understandingPresent = true;
      const keyPaths = (understanding.keyFiles || []).map((k) => k.path || k).join('\n');
      const symbols = (understanding.symbols || []).join('\n');
      summary.understandingRefsReal =
        /ids\.ts|clampString|shared\/ids/i.test(keyPaths + '\n' + symbols + '\n' + JSON.stringify(understanding));
    }
    summary.steps.push({
      step: 'understanding',
      present: summary.understandingPresent,
      refsReal: summary.understandingRefsReal,
      path: understandingPaths[0] || null,
    });

    if (first.latestJob?.status !== 'succeeded') {
      const msg = first.latestJob?.actionable || first.latestJob?.status || 'first job failed';
      summary.failureStage = 'first_execution';
      summary.failureMessage = msg;
      if (/auth|login|needs_setup|not logged|unauthorized/i.test(String(msg))) {
        summary.conclusion = 'blocked_codex_unavailable';
      } else {
        summary.conclusion = 'failed_first_execution';
      }
      await flush();
      console.log(JSON.stringify({ ok: false, evidenceDir, summary }, null, 2));
      process.exitCode = 1;
      return;
    }

    const idsAfter1 = await fsp.readFile(path.join(workDir, 'src', 'shared', 'ids.ts'), 'utf8');
    const testPath = path.join(workDir, 'src', 'infrastructure', 'tests', 'ids-clamp-string.test.ts');
    const testExists = fs.existsSync(testPath);
    const hasClamp = /function\s+clampString|clampString\s*=/.test(idsAfter1);
    summary.diffMeaningful = hasClamp && testExists && idsAfter1 !== idsBefore;
    await writeJson('ids-after-first.json', {
      hasClamp,
      testExists,
      len: idsAfter1.length,
      snippet: idsAfter1.slice(-800),
    });

    // 确保 dist 与测试
    const build1 = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'build'],
      { cwd: workDir, encoding: 'utf8', windowsHide: true, timeout: 180_000, shell: false },
    );
    await writeJson('build-after-first.json', {
      status: build1.status,
      stdout: String(build1.stdout || '').slice(0, 4000),
      stderr: String(build1.stderr || '').slice(0, 4000),
    });
    const test1 = runNodeTest(workDir, 'dist/infrastructure/tests/ids-clamp-string.test.js');
    summary.testOutput = test1;
    summary.testsPassed = test1.status === 0;
    await writeJson('test-after-first.json', test1);

    const artifactId = first.artifactIds?.[0];
    if (!artifactId) {
      throw Object.assign(new Error('no artifact after first job'), { failureStage: 'artifact' });
    }
    const content1 = await rt.getContent({ artifactId });
    await writeJson('artifact-v1.json', {
      headVersionId: content1.artifact?.headVersionId,
      changedFiles: content1.codeChange?.changedFiles || content1.codeChange?.files || null,
      textHead: String(content1.text || '').slice(0, 2500),
    });

    const revGoal =
      '请修订 clampString：在截断前先对输入做 String(s) 规范化；若 max 不是有限数字则视为 0；同步更新 ids-clamp-string.test.ts 覆盖这些边界，并 npm run build 后跑通该测试。不要 commit/push。';
    const revised = await rt.reviseArtifact({
      taskId: started.taskId,
      artifactId,
      revisionRequest: revGoal,
    });
    const second = await waitJob(rt, started.taskId, 900_000);
    await writeJson('second-job.json', {
      jobId: revised.jobId,
      status: second.latestJob?.status,
      actionable: second.latestJob?.actionable,
      lastExecutorStatus: second.latestJob?.externalExecution?.lastExecutorStatus,
    });

    const idsAfter2 = await fsp.readFile(path.join(workDir, 'src', 'shared', 'ids.ts'), 'utf8');
    summary.revisionChanged =
      second.latestJob?.status === 'succeeded' && idsAfter2 !== idsAfter1;
    summary.steps.push({
      step: 'revise_result',
      status: second.latestJob?.status,
      revisionChanged: summary.revisionChanged,
    });
    await writeJson('ids-after-revise.json', {
      changedFromFirst: idsAfter2 !== idsAfter1,
      snippet: idsAfter2.slice(-1000),
    });

    if (second.latestJob?.status !== 'succeeded') {
      summary.failureStage = 'revise';
      summary.failureMessage = second.latestJob?.actionable || 'revise failed';
      summary.conclusion = 'failed_revision';
      await flush();
      process.exitCode = 1;
      return;
    }

    const build2 = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'build'],
      { cwd: workDir, encoding: 'utf8', windowsHide: true, timeout: 180_000, shell: false },
    );
    const test2 = runNodeTest(workDir, 'dist/infrastructure/tests/ids-clamp-string.test.js');
    summary.testsPassed = summary.testsPassed && test2.status === 0;
    summary.testOutput = { first: test1, second: test2, build2Status: build2.status };
    await writeJson('test-after-revise.json', { build2: { status: build2.status }, test2 });

    const content2 = await rt.getContent({ artifactId });
    const accept = await rt.captureSubjectInput({
      text: '采用当前代码修改。以后同类小函数与单测补强可继续用已连接的代码执行能力；不要自动 push。',
      sourceKind: 'artifact_acceptance',
      taskId: started.taskId,
      artifactId,
      artifactVersionId: content2.artifact.headVersionId,
      requestedArtifactType: 'code-change',
    });
    await writeJson('accept.json', accept);
    summary.adoptionRecorded = !!(accept && (accept.ok !== false));
    summary.steps.push({ step: 'accepted', adoptionRecorded: summary.adoptionRecorded });

    const finalStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd: targetRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    const finalHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    const logAhead = spawnSync('git', ['status', '-sb'], {
      cwd: targetRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    summary.finalStatusPorcelain = String(finalStatus.stdout || '');
    summary.finalHead = String(finalHead.stdout || '').trim();
    summary.committed = summary.finalHead !== summary.targetHead;
    summary.pushed = /ahead\s+\d+/.test(String(logAhead.stdout || '')) && summary.committed;
    await writeJson('target-final.json', {
      head: summary.finalHead,
      statusPorcelain: summary.finalStatusPorcelain,
      shortBranch: String(logAhead.stdout || ''),
    });

    const ok =
      summary.realCodex &&
      summary.understandingPresent &&
      summary.diffMeaningful &&
      summary.testsPassed &&
      summary.revisionChanged &&
      summary.adoptionRecorded &&
      !summary.committed &&
      !summary.pushed;

    summary.conclusion = ok
      ? 'ready_for_owner_runtime_acceptance'
      : 'failed_quality_gates';
    summary.ownerAccepted = false;
    await flush();
    console.log(
      JSON.stringify(
        {
          ok,
          evidenceDir,
          realCodex: summary.realCodex,
          conclusion: summary.conclusion,
          summaryPath: path.join(evidenceDir, 'summary.json'),
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
  } catch (err) {
    summary.failureStage = err.failureStage || 'uncaught';
    summary.failureMessage = err.message || String(err);
    if (/auth_failed|needs_setup|not logged|login/i.test(summary.failureMessage)) {
      summary.conclusion = 'blocked_codex_unavailable';
    } else {
      summary.conclusion = 'failed_uncaught';
    }
    await writeJson('uncaught-error.json', {
      message: err.message,
      stack: String(err.stack || '').slice(0, 5000),
    });
    await flush();
    console.error(err);
    console.log(JSON.stringify({ ok: false, evidenceDir, summary }, null, 2));
    process.exitCode = 1;
  }
}

main();
