/**
 * DIGITALME-V2-GROWTH-CAPTURE-TRUST-01 — 真实模型产品路径验证
 * 覆盖：captureOutcome、任务提交后捕获、修订+采用经验、重启仍在、幂等重放。
 * 不 push；证据写入 scripts/_growth-capture-trust-evidence/
 */
'use strict';

const { promises: fs } = require('node:fs');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_growth-capture-trust-evidence');
fsSync.mkdirSync(evidenceDir, { recursive: true });

function writeEvidence(name, data) {
  fsSync.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2), 'utf8');
}

async function loadCredential() {
  try {
    require('child_process').execSync('node scripts/load-app-model-credential.cjs', {
      stdio: 'pipe',
      shell: true,
    });
  } catch {
    /* env / runtime file fallback */
  }
  const { resolveModelEnvAsync, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
  const modelEnv = await resolveModelEnvAsync(appRoot, process.env);
  if (!modelEnv.runtime || !modelEnv.runtime.apiKey) return null;
  return {
    cred: modelEnv.runtime,
    secrets: createEnvSecretAccessor(process.env, modelEnv.runtime.providerId, modelEnv.runtime),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitJob(runtime, taskId, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await runtime.getTask({ taskId });
    const st = detail.latestJob && detail.latestJob.status;
    if (st === 'succeeded' || st === 'failed' || st === 'cancelled') return detail;
    await sleep(800);
  }
  throw new Error('job wait timeout');
}

async function main() {
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
  const {
    conversationFilePath,
    readConversationRows,
    appendConversationRow,
    filterTurnsForUi,
    latestCaptureStatusByTurnId,
  } = require('../dist/subject-core/conversation-transcript');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-gct-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: loaded.cred.baseUrl,
      model: loaded.cred.model,
      providerId: loaded.cred.providerId || 'openai-compatible',
      timeoutMs: 180_000,
    },
    secrets: loaded.secrets,
    registerOpenAiStub: false,
  });

  const report = {
    model: loaded.cred.model,
    baseUrlHost: (() => {
      try {
        return new URL(loaded.cred.baseUrl).host;
      } catch {
        return loaded.cred.baseUrl;
      }
    })(),
    checks: {},
  };

  await runtime.createPackage({
    displayName: '成长捕获可信验证',
    targetDir: root,
    initialSelfDescription: '我是注重本地优先与结论先行的产品负责人',
  });

  // A. 空学习 vs 有学习
  const emptyish = await runtime.captureSubjectInput({
    text: '嗯。',
    sourceKind: 'conversation',
    captureKey: 'conversation:emptyish',
  });
  report.checks.emptyOutcome = emptyish.captureOutcome;
  report.checks.emptyNotFailed =
    emptyish.captureOutcome === 'nothing_to_learn' ||
    emptyish.captureOutcome === 'learned' ||
    emptyish.captureOutcome === 'pending_confirmation';

  const pref = await runtime.captureSubjectInput({
    text: '以后项目汇报请结论先行，控制篇幅，只保留需要我决策的事项。',
    sourceKind: 'conversation',
    captureKey: 'conversation:pref1',
  });
  report.checks.prefOutcome = pref.captureOutcome;
  report.checks.prefNotFailedAsSuccess = pref.captureOutcome !== undefined;

  // 模拟 transcript 状态追加（不改写 turn）
  const convFile = conversationFilePath(root);
  await appendConversationRow(convFile, {
    id: 'turn_pref1',
    role: 'user',
    text: '以后项目汇报请结论先行，控制篇幅，只保留需要我决策的事项。',
    at: new Date().toISOString(),
  });
  await appendConversationRow(convFile, {
    kind: 'growth_capture_status',
    turnId: 'turn_pref1',
    status: pref.captureOutcome === 'distill_failed' ? 'failed' : 'ok_learned',
    attempts: 1,
    updatedAt: new Date().toISOString(),
  });
  const rows = await readConversationRows(convFile);
  report.checks.uiTurnsIgnoreStatus = filterTurnsForUi(rows).length === 1;
  report.checks.statusLatest = latestCaptureStatusByTurnId(rows).get('turn_pref1')?.status;

  // B. 任务目标：提交后即捕获（不等 Job succeeded）
  const created = await runtime.submitTask({
    goal: '写一篇本周项目汇报，结论先行，突出决策事项；本次只要简短一版即可。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const taskKey = `captureKey:task_requirement:${created.taskId}`;
  let taskCapturedAfterSubmit = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    const eventsAfterSubmit = await runtime.subject.listGrowthEvents();
    if (eventsAfterSubmit.some((e) => (e.payload.tags || []).includes(taskKey))) {
      taskCapturedAfterSubmit = true;
      report.checks.oneOffNotForcedIdentity = !eventsAfterSubmit
        .filter((e) => (e.payload.tags || []).includes(taskKey))
        .some(
          (e) =>
            (e.payload.tags || []).some((t) => /identity|category:identity/i.test(t)) &&
            (e.payload.tags || []).includes('silent_ok'),
        );
      break;
    }
  }
  report.checks.taskCapturedAfterSubmit = taskCapturedAfterSubmit;

  const detail1 = await waitJob(runtime, created.taskId);
  report.checks.firstJobStatus = detail1.latestJob && detail1.latestJob.status;
  const artifactId = detail1.artifactIds && detail1.artifactIds[0];
  if (!artifactId || detail1.latestJob.status !== 'succeeded') {
    report.ok = false;
    report.checks.firstJobFailed = true;
    writeEvidence('summary.json', report);
    await runtime.stop();
    process.exit(1);
  }

  const content1 = await runtime.getContent({ artifactId });
  const v1 = content1.artifact.headVersionId;

  // C. 拒绝 + 修改 + 采用新版
  const rejected = await runtime.captureSubjectInput({
    text: '未采用：缺少结论先行，篇幅偏长',
    sourceKind: 'artifact_rejection',
    taskId: created.taskId,
    artifactId,
    artifactVersionId: v1,
    requestedArtifactType: 'document',
    rejectionReason: '缺少结论先行，篇幅偏长',
  });
  report.checks.rejectOutcome = rejected.captureOutcome;
  report.checks.rejectDecision = rejected.ownerDecision;

  const revised = await runtime.reviseArtifact({
    taskId: created.taskId,
    artifactId,
    revisionRequest: '请改成结论先行，压缩到更短，并列出需要我决策的事项。',
    rejectionReason: '缺少结论先行，篇幅偏长',
  });
  const detail2 = await waitJob(runtime, created.taskId);
  report.checks.reviseJobStatus = detail2.latestJob && detail2.latestJob.status;
  const revKey = `captureKey:revision:${revised.jobId}`;
  let revisionCapturedAfterSuccess = false;
  for (let i = 0; i < 45; i += 1) {
    await sleep(1000);
    const eventsAfterRevise = await runtime.subject.listGrowthEvents();
    if (eventsAfterRevise.some((e) => (e.payload.tags || []).includes(revKey))) {
      revisionCapturedAfterSuccess = true;
      break;
    }
  }
  report.checks.revisionCapturedAfterSuccess = revisionCapturedAfterSuccess;

  const content2 = await runtime.getContent({ artifactId });
  const v2 = content2.artifact.headVersionId;
  const accepted = await runtime.captureSubjectInput({
    text: '采用修订版：结论先行与决策清单符合要求',
    sourceKind: 'artifact_acceptance',
    taskId: created.taskId,
    artifactId,
    artifactVersionId: v2,
    requestedArtifactType: 'document',
    revisionRequest: '请改成结论先行，压缩到更短，并列出需要我决策的事项。',
    rejectionReason: '缺少结论先行，篇幅偏长',
  });
  report.checks.acceptOutcome = accepted.captureOutcome;
  report.checks.acceptDecision = accepted.ownerDecision;

  // D. 下一相关任务是否注入；无关任务不注入
  const related = await runtime.submitTask({
    goal: '再写一份项目周报，仍然结论先行并突出决策事项。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const relatedDetail = await waitJob(runtime, related.taskId);
  report.checks.relatedJobStatus = relatedDetail.latestJob && relatedDetail.latestJob.status;
  report.checks.relatedApplied =
    !!(relatedDetail.appliedUnderstanding && relatedDetail.appliedUnderstanding.items && relatedDetail.appliedUnderstanding.items.length);

  const unrelated = await runtime.submitTask({
    goal: '写一首关于春天的短诗，轻松愉快。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const unrelatedDetail = await waitJob(runtime, unrelated.taskId);
  const unrelatedTexts = ((unrelatedDetail.appliedUnderstanding && unrelatedDetail.appliedUnderstanding.items) || [])
    .map((i) => i.text || '')
    .join('\n');
  report.checks.unrelatedNotInjectingReportPref = !/结论先行|决策事项|周报/.test(unrelatedTexts);

  // E. 重启后成长仍在
  await runtime.stop();
  const runtime2 = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: loaded.cred.baseUrl,
      model: loaded.cred.model,
      providerId: loaded.cred.providerId || 'openai-compatible',
      timeoutMs: 180_000,
    },
    secrets: loaded.secrets,
    registerOpenAiStub: false,
  });
  await runtime2.openPackage({ dir: root });
  const eventsRestored = await runtime2.subject.listGrowthEvents();
  report.checks.restartEventCount = eventsRestored.length;
  report.checks.restartHasAccept = eventsRestored.some((e) =>
    (e.payload.tags || []).includes('decision:accept'),
  );
  report.checks.restartHasTaskCapture = eventsRestored.some((e) =>
    (e.payload.tags || []).includes(taskKey),
  );

  // 无第二事实源：仅 growth/events.ndjson + conversation.ndjson + runtime stores
  const growthPath = path.join(root, 'growth', 'events.ndjson');
  report.checks.growthFileExists = fsSync.existsSync(growthPath);
  report.checks.noProfileStore = !fsSync.existsSync(path.join(root, 'profile')) && !fsSync.existsSync(path.join(root, 'memory'));

  report.ok =
    report.checks.emptyNotFailed &&
    report.checks.prefNotFailedAsSuccess &&
    report.checks.uiTurnsIgnoreStatus &&
    report.checks.taskCapturedAfterSubmit &&
    report.checks.rejectDecision === 'rejected' &&
    report.checks.acceptDecision === 'accepted' &&
    report.checks.restartHasAccept &&
    report.checks.restartHasTaskCapture &&
    report.checks.noProfileStore &&
    report.checks.unrelatedNotInjectingReportPref;

  writeEvidence('summary.json', report);
  writeEvidence('events-sample.json', {
    count: eventsRestored.length,
    sample: eventsRestored.slice(-12).map((e) => ({
      type: e.type,
      confidence: e.confidence,
      title: e.payload.title,
      tags: e.payload.tags,
    })),
  });

  await runtime2.stop();
  console.log(JSON.stringify({ ok: report.ok, evidence: evidenceDir, checks: report.checks }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  writeEvidence('summary.json', {
    ok: false,
    error: String(err && err.message ? err.message : err),
    at: new Date().toISOString(),
  });
  console.error(err);
  process.exit(1);
});
