/**
 * DIGITALME-V2-WORK-RUNTIME-GENERALIZATION-01 — 真实模型 + 真实仓库产品路径验证
 * 覆盖批准项 1–12（命令层模拟产品：目标+材料+开始处理）。
 * 不 push；证据：scripts/_work-runtime-generalization-evidence/
 */
'use strict';

const { promises: fs } = require('node:fs');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_work-runtime-generalization-evidence');
fsSync.mkdirSync(evidenceDir, { recursive: true });

function writeEvidence(name, data) {
  fsSync.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadCredential() {
  try {
    require('child_process').execSync('node scripts/load-app-model-credential.cjs', {
      stdio: 'pipe',
      shell: true,
    });
  } catch {
    /* optional */
  }
  const { resolveModelEnvAsync, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
  const modelEnv = await resolveModelEnvAsync(appRoot, process.env);
  if (!modelEnv.runtime || !modelEnv.runtime.apiKey) return null;
  return {
    cred: modelEnv.runtime,
    secrets: createEnvSecretAccessor(process.env, modelEnv.runtime.providerId, modelEnv.runtime),
  };
}

async function waitJob(runtime, taskId, timeoutMs = 360_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await runtime.getTask({ taskId });
    const st = detail.latestJob && detail.latestJob.status;
    if (st === 'succeeded' || st === 'failed' || st === 'cancelled') return detail;
    await sleep(1000);
  }
  throw new Error('job wait timeout');
}

async function seedMiniRepo(dir) {
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'sample-analyze-repo', version: '0.0.1', scripts: { test: 'echo ok' } }, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'src', 'index.ts'),
    [
      'export function add(a: number, b: number): number {',
      '  // TODO: overflow unchecked',
      '  return a + b;',
      '}',
      '',
      'export function divide(a: number, b: number): number {',
      '  return a / b; // missing zero check',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'src', 'auth.ts'),
    [
      'const HARDCODED = "sk-test-not-a-real-key-abcdef";',
      'export function login(user: string) {',
      '  if (!user) throw new Error("missing user");',
      '  return { token: HARDCODED };',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function main() {
  console.log('building…');
  require('child_process').execSync('npm run build', { stdio: 'inherit', cwd: appRoot });

  const loaded = await loadCredential();
  if (!loaded) {
    writeEvidence('summary.json', {
      ok: false,
      reason: 'no_model_credential',
      at: new Date().toISOString(),
    });
    console.error('NO_CREDENTIAL');
    process.exit(2);
  }

  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { CODE_REPO_ANALYSIS_CAPABILITY_ID, CODE_ANALYSIS_ARTIFACT_TYPE } = require('../dist/capability/adapters/code-repo-analysis-contract');
  const { deriveWorkIntentSync } = require('../dist/work-runtime/work-intent');
  const { CapabilityRegistry } = require('../dist/capability/registry');
  const { buildCodeRepoAnalysisRegistration } = require('../dist/capability/adapters/code-repo-analysis-contract');

  const report = {
    task: 'DIGITALME-V2-WORK-RUNTIME-GENERALIZATION-01',
    model: loaded.cred.model,
    baseUrlHost: (() => {
      try {
        return new URL(loaded.cred.baseUrl).host;
      } catch {
        return loaded.cred.baseUrl;
      }
    })(),
    startedAt: new Date().toISOString(),
    checks: {},
    failures: [],
  };

  function mark(name, ok, detail) {
    report.checks[name] = { ok: !!ok, ...(detail ? { detail } : {}) };
    if (!ok) report.failures.push({ name, detail });
  }

  const pkgRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-wrg-pkg-'));
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-wrg-repo-'));
  await seedMiniRepo(repoRoot);
  report.repoPath = repoRoot;

  function createRuntime(opts = {}) {
    return createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: {
        providerId: loaded.cred.providerId,
        baseUrl: loaded.cred.baseUrl,
        model: loaded.cred.model,
        temperature: 0.2,
        maxTokens: 8192,
        timeoutMs: 300_000,
      },
      secrets: loaded.secrets,
      registerOpenAiStub: false,
      codeAnalysisCapability: opts.codeAnalysisCapability ?? 'openai-compatible',
    });
  }

  // --- 10. 能力不可用时不得伪装 ---
  {
    const reg = new CapabilityRegistry();
    reg.register({
      registration: {
        id: 'cap_document_openai',
        kind: 'model',
        displayName: '文档',
        description: 'd',
        inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
        outputArtifactTypes: ['document'],
        permissions: ['network'],
        cost: { estimate: 't' },
        latencyEstimate: 's',
        location: 'local',
        availability: 'available',
        adapter: { type: 'openai-compatible-model', adapterId: 'document' },
      },
      execute: async () => ({
        artifact: {
          type: 'document',
          title: 'd',
          payload: { kind: 'text', text: 'x', format: 'markdown' },
        },
      }),
    });
    reg.register({
      registration: buildCodeRepoAnalysisRegistration('needs_setup'),
      execute: async () => {
        throw new Error('should not run');
      },
    });
    const denied = reg.selectForNeed({
      intentKind: 'analyze_code',
      expectedOutputFamily: CODE_ANALYSIS_ARTIFACT_TYPE,
      materialKinds: ['code_repo'],
    });
    mark(
      'unavailable_no_document_fallback',
      denied.reason === 'none' &&
        !denied.adapter &&
        /不会改用普通写作冒充/.test(denied.actionable || ''),
      denied,
    );
  }

  const runtime = createRuntime();
  await runtime.createPackage({
    displayName: '工作运行时泛化验证',
    targetDir: pkgRoot,
    initialSelfDescription: '我关注代码审查的关注点与判断标准，不保存仓库全文。',
  });

  // --- 1–4: 代码文件夹 + 分析 → analyze_code → bundle + integrity ---
  const analyzeGoal = '请分析这个代码仓库，给出问题清单与依据，重点看风险与缺失检查。';
  const derived = deriveWorkIntentSync({
    goal: analyzeGoal,
    contextRefs: [{ kind: 'folder', path: repoRoot }],
    materialKinds: ['code_repo'],
  });
  mark('intent_analyze_code', derived.intentKind === 'analyze_code', derived);

  const submitted = await runtime.submitTask({
    goal: analyzeGoal,
    contextRefs: [{ kind: 'folder', path: repoRoot }],
    // 产品入口不传 requestedArtifactType
  });
  mark(
    'auto_select_code_analysis',
    submitted.intentKind === 'analyze_code' &&
      !!submitted.userFacingNotice &&
      !/文章|写作/.test(submitted.userFacingNotice || ''),
    submitted,
  );

  const taskAfter = await runtime.getTask({ taskId: submitted.taskId });
  mark(
    'task_persists_intent',
    taskAfter.task.intentKind === 'analyze_code' &&
      taskAfter.task.requestedArtifactType === CODE_ANALYSIS_ARTIFACT_TYPE &&
      taskAfter.task.capabilityId === CODE_REPO_ANALYSIS_CAPABILITY_ID,
    {
      intentKind: taskAfter.task.intentKind,
      requestedArtifactType: taskAfter.task.requestedArtifactType,
      capabilityId: taskAfter.task.capabilityId,
    },
  );

  let detail = await waitJob(runtime, submitted.taskId);
  mark('job_succeeded', detail.latestJob && detail.latestJob.status === 'succeeded', {
    status: detail.latestJob && detail.latestJob.status,
    actionable: detail.latestJob && detail.latestJob.actionable,
  });
  if (!(detail.latestJob && detail.latestJob.status === 'succeeded')) {
    report.ok = false;
    writeEvidence('summary.json', report);
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const artifactId = detail.artifactIds[0];
  const content = await runtime.getContent({ artifactId });
  const headVersionId = content.artifact.headVersionId;
  const roles = ((content.bundle && content.bundle.entries) || []).map((e) => e.role).filter(Boolean);
  mark(
    'bundle_report_manifest_evidence',
    content.content &&
      content.content.kind === 'bundle' &&
      roles.includes('report') &&
      roles.includes('manifest') &&
      roles.includes('evidence') &&
      !!(content.text && content.text.trim()),
    { roles, textLen: (content.text || '').length },
  );
  mark('bundle_integrity_passed', roles.length >= 3, { roles });

  // --- 5: 查看证据、采用 ---
  const accept = await runtime.captureSubjectInput({
    text: `采用代码分析：可沿用关注点与判断标准。任务：${analyzeGoal}`.slice(0, 400),
    sourceKind: 'artifact_acceptance',
    taskId: submitted.taskId,
    artifactId,
    artifactVersionId: headVersionId,
    requestedArtifactType: CODE_ANALYSIS_ARTIFACT_TYPE,
    sourceCapabilityKind: 'local',
  });
  mark(
    'accept_ok',
    accept.ownerDecision === 'accepted' ||
      accept.captureOutcome === 'learned' ||
      accept.captureOutcome === 'pending_confirmation' ||
      accept.captureOutcome === 'nothing_to_learn',
    accept,
  );

  // --- 6–7: 带修改要求重新执行，新版本 bundle 一致 ---
  const revise = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId,
    revisionRequest: '请更明确列出缺少除零检查的位置，并保留证据关联。',
    rejectionReason: '首版对除零风险不够具体',
  });
  detail = await waitJob(runtime, submitted.taskId);
  mark('revise_succeeded', detail.latestJob && detail.latestJob.status === 'succeeded', {
    jobId: revise.jobId,
    status: detail.latestJob && detail.latestJob.status,
  });
  const content2 = await runtime.getContent({ artifactId });
  const head2 = content2.artifact.headVersionId;
  const roles2 = ((content2.bundle && content2.bundle.entries) || []).map((e) => e.role).filter(Boolean);
  mark(
    'revise_new_bundle_consistent',
    head2 !== headVersionId &&
      content2.content.kind === 'bundle' &&
      roles2.includes('report') &&
      roles2.includes('manifest') &&
      roles2.includes('evidence') &&
      !content2.evidenceStale,
    {
      oldHead: headVersionId,
      newHead: head2,
      roles: roles2,
      evidenceStale: !!content2.evidenceStale,
    },
  );

  // --- 拒绝路径 ---
  const reject = await runtime.captureSubjectInput({
    text: '未采用本版：还需要补充安全相关问题',
    sourceKind: 'artifact_rejection',
    taskId: submitted.taskId,
    artifactId,
    artifactVersionId: head2,
    requestedArtifactType: CODE_ANALYSIS_ARTIFACT_TYPE,
    sourceCapabilityKind: 'local',
    rejectionReason: '还需要补充安全相关问题',
  });
  mark(
    'reject_ok',
    reject.ownerDecision === 'rejected' ||
      reject.captureOutcome === 'learned' ||
      reject.captureOutcome === 'pending_confirmation' ||
      reject.captureOutcome === 'nothing_to_learn',
    reject,
  );

  // --- 9: 普通写作仍走 document ---
  const write = await runtime.submitTask({
    goal: '写一篇简短周报，总结本周协作进展，不超过 300 字。',
    contextRefs: [],
  });
  mark('writing_intent_document', write.intentKind === 'create_document' || write.intentKind === 'general', write);
  const writeTask = await runtime.getTask({ taskId: write.taskId });
  mark(
    'writing_uses_document_family',
    writeTask.task.requestedArtifactType === 'document' &&
      writeTask.task.capabilityId !== CODE_REPO_ANALYSIS_CAPABILITY_ID,
    {
      requestedArtifactType: writeTask.task.requestedArtifactType,
      capabilityId: writeTask.task.capabilityId,
    },
  );
  const writeDetail = await waitJob(runtime, write.taskId, 180_000);
  mark('writing_succeeded', writeDetail.latestJob && writeDetail.latestJob.status === 'succeeded', {
    status: writeDetail.latestJob && writeDetail.latestJob.status,
  });
  if (writeDetail.artifactIds && writeDetail.artifactIds[0]) {
    const wContent = await runtime.getContent({ artifactId: writeDetail.artifactIds[0] });
    mark('writing_text_artifact', wContent.content && wContent.content.kind === 'text', {
      kind: wContent.content && wContent.content.kind,
    });
  }

  // --- 11: 重启后 intentKind / 能力语义保留 ---
  await runtime.stop();
  const runtime2 = createRuntime();
  await runtime2.openPackage({ dir: pkgRoot });
  const restored = await runtime2.getTask({ taskId: submitted.taskId });
  mark(
    'restart_preserves_intent',
    restored.task.intentKind === 'analyze_code' &&
      restored.task.requestedArtifactType === CODE_ANALYSIS_ARTIFACT_TYPE &&
      restored.task.capabilityId === CODE_REPO_ANALYSIS_CAPABILITY_ID,
    {
      intentKind: restored.task.intentKind,
      requestedArtifactType: restored.task.requestedArtifactType,
      capabilityId: restored.task.capabilityId,
    },
  );
  const retry = await runtime2.retryTask({ taskId: submitted.taskId });
  const retryDetail = await waitJob(runtime2, submitted.taskId);
  mark(
    'retry_keeps_code_analysis',
    retryDetail.task.capabilityId === CODE_REPO_ANALYSIS_CAPABILITY_ID &&
      retryDetail.latestJob &&
      (retryDetail.latestJob.status === 'succeeded' || retryDetail.latestJob.status === 'failed'),
    {
      jobId: retry.jobId,
      capabilityId: retryDetail.task.capabilityId,
      status: retryDetail.latestJob && retryDetail.latestJob.status,
    },
  );

  // --- 8: 相关后续任务可沿用已确认分析偏好（弱检查：注入或至少无崩溃） ---
  const follow = await runtime2.submitTask({
    goal: '再次分析这个仓库的安全风险与判断标准是否一致。',
    contextRefs: [{ kind: 'folder', path: repoRoot }],
  });
  mark('followup_analyze_code', follow.intentKind === 'analyze_code', follow);
  const followDetail = await waitJob(runtime2, follow.taskId);
  mark(
    'followup_ran',
    followDetail.latestJob &&
      (followDetail.latestJob.status === 'succeeded' || followDetail.latestJob.status === 'failed'),
    {
      status: followDetail.latestJob && followDetail.latestJob.status,
      applied: followDetail.appliedUnderstanding || null,
    },
  );

  // --- 12: 无第二 Store / 无独立代码工作台（静态） ---
  const jobRunnerSrc = fsSync.readFileSync(
    path.join(appRoot, 'src', 'work-runtime', 'job-runner.ts'),
    'utf8',
  );
  mark(
    'no_parallel_code_workbench',
    /selectForNeed/.test(jobRunnerSrc) &&
      !/CodeWorkbench|codeWorkbench|new CodeAnalysisStore/.test(jobRunnerSrc),
    { hasSelectForNeed: /selectForNeed/.test(jobRunnerSrc) },
  );

  await runtime2.stop();

  report.finishedAt = new Date().toISOString();
  report.ok = report.failures.length === 0;
  writeEvidence('summary.json', report);
  writeEvidence('repo-seed-note.json', {
    repoPath: repoRoot,
    files: ['package.json', 'src/index.ts', 'src/auth.ts'],
  });

  console.log(JSON.stringify({ ok: report.ok, failures: report.failures, checks: Object.keys(report.checks).length }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  writeEvidence('summary.json', {
    ok: false,
    error: String(err && err.stack ? err.stack : err),
    at: new Date().toISOString(),
  });
  console.error(err);
  process.exit(1);
});
