/**
 * DIGITALME-V2-SUBJECT-GROWTH-REAL-WORKFLOW-VALIDATION-01
 * 真实产品路径验证。
 * - 文档任务：openai-compatible 真模型
 * - 蒸馏：仅 captureInput（产品模型运行时）；禁止平行蒸馏入口
 */
'use strict';

const { promises: fs } = require('node:fs');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_subject-growth-real-workflow-validation-evidence');
fsSync.mkdirSync(evidenceDir, { recursive: true });

function writeEvidence(name, data) {
  fsSync.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2), 'utf8');
}

function countIssues(text) {
  const t = String(text || '');
  const issues = [];
  if (!/结论|先讲结论|先给结论|结论先行/.test(t)) issues.push('missing_conclusion_first');
  if (t.length > 1800) issues.push('too_long');
  // 空话套话启发式
  const fluff = (t.match(/综上所述|赋能|抓手|闭环落地|深入探讨|全方位/g) || []).length;
  if (fluff >= 2) issues.push('fluff_phrases');
  // 缺少“决策事项”清单感
  if (!/决策|需要你|请确认|待定|是否/.test(t)) issues.push('missing_decision_items');
  return issues;
}

async function loadCredential() {
  try {
    require('child_process').execSync('node scripts/load-app-model-credential.cjs', {
      stdio: 'pipe',
      shell: true,
    });
  } catch {
    // electron 加载可能失败；仍可读已有 runtime 文件 / env
  }
  const { resolveModelEnvAsync, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
  const modelEnv = await resolveModelEnvAsync(appRoot, process.env);
  if (!modelEnv.runtime || !modelEnv.runtime.apiKey) {
    return null;
  }
  return {
    cred: modelEnv.runtime,
    secrets: createEnvSecretAccessor(process.env, modelEnv.runtime.providerId, modelEnv.runtime),
  };
}

async function productCapture(runtime, input) {
  const result = await runtime.captureSubjectInput({
    text: input.text,
    sourceKind: input.sourceKind,
    ...(input.materialRef ? { materialRef: input.materialRef } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
    ...(input.requestedArtifactType
      ? { requestedArtifactType: input.requestedArtifactType }
      : {}),
  });
  const events = await runtime.subject.listGrowthEvents();
  const byId = new Map(events.map((e) => [e.id, e]));
  const mapped = (result.candidateEventIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      type: e.type,
      title: e.payload.title,
      detail: e.payload.detail,
      tags: e.payload.tags,
      confidence: e.confidence,
    }));
  return {
    mode: result.distillMode || runtime.subject.getLastDistillMode(),
    discarded: runtime.subject.getLastDistillDiscarded(),
    candidateEventIds: result.candidateEventIds || [],
    confirmedEventIds: result.confirmedEventIds || [],
    confirmationSuggestedEventIds: result.confirmationSuggestedEventIds || [],
    normalizeTrace: result.normalizeTrace || [],
    events: mapped,
  };
}

async function main() {
  const loaded = await loadCredential();
  if (!loaded) {
    const blocked = {
      status: 'real_model_validation_blocked',
      reason: 'missing_product_model_credential',
      generatedAt: new Date().toISOString(),
    };
    writeEvidence('summary.json', blocked);
    console.log(JSON.stringify(blocked, null, 2));
    process.exit(0);
  }
  const { cred, secrets } = loaded;
  const modelMeta = { .model,
    baseUrlHost: (() => {
      try {
        return new URL(cred.baseUrl).host;
      } catch {
        return 'unknown';
      }
    })(),
    providerId: cred.providerId,
    source: 'app_runtime_file_or_env',
  };

  // 连通性探针：失败则 blocked
  const { chatComplete } = require('../dist/infrastructure/model-http');
  try {
    const ping = await chatComplete({
      baseUrl: cred.baseUrl,
      apiKey: cred.apiKey .model,
      messages: [
        { role: 'system', content: '只回复 ok' },
        { role: 'user', content: 'ping' },
      ],
      temperature: 0,
      maxTokens: 8,
      timeoutMs: 60000,
    });
    if (!String(ping.text || '').trim()) {
      throw new Error('empty_ping');
    }
  } catch (err) {
    const blocked = {
      status: 'real_model_validation_blocked',
      reason: 'real_model_unreachable',
      error: String(err && err.message ? err.message : err),
      modelMeta,
      generatedAt: new Date().toISOString(),
    };
    writeEvidence('summary.json', blocked);
    console.log(JSON.stringify(blocked, null, 2));
    process.exit(0);
  }

  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-growth-real-wf-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      providerId: cred.providerId,
      baseUrl: cred.baseUrl .model,
      maxTokens: 2048,
      timeoutMs: 180000,
    },
    secrets,
    registerOpenAiStub: false,
  });
  await runtime.createPackage({
    displayName: '成长真实验证',
    targetDir: path.join(root, 'pkg'),
  });

  const report = {
    status: 'in_progress',
    modelMeta,
    metrics: {
      erroneous_user_attribution: 0,
      unrelated_pollution: 0,
      unnecessary_confirmations: 0,
      learning_failure_blocks_task: false,
      artifact_ready_time_ms: [],
      growth_completed_time_ms: [],
      first_draft_issue_count: null,
      second_draft_same_issue_count: null,
      repeated_correction_reduced: null,
      first_acceptance_signal: null,
    },
    scenarios: {},
  };

  // ---------- 场景 A：对话学习 ----------
  const prefText =
    '以后给我的项目汇报先讲结论，控制篇幅，只保留需要我决策的事项。';
  const gA0 = Date.now();
  const distillA = await productCapture(runtime, {
    text: prefText,
    sourceKind: 'conversation' 
  });
  report.metrics.growth_completed_time_ms.push(Date.now() - gA0);
  const overviewA = await runtime.getOverview();
  const activeA = (overviewA.activeUnderstandings || []).map((i) => i.text).join('\n');
  const recentA = (overviewA.recentLearnings || []).map((i) => i.text).join('\n');
  const uiSilent =
    !/GrowthEvent|confidence|signal:strong|candidateEventIds/.test(
      JSON.stringify(overviewA.activeUnderstandings || []) + JSON.stringify(overviewA.recentLearnings || []),
    );

  const tA0 = Date.now();
  const relatedA = await runtime.submitTask({
    goal: '写一份本周项目汇报，说明进展与风险',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobA = await waitForJobTerminal(runtime.workRuntime, relatedA.jobId, 240_000);
  report.metrics.artifact_ready_time_ms.push(Date.now() - tA0);
  const freezeA = await runtime.readSubjectContextFreeze(jobA.snapshotId);
  const textA = (await runtime.getContent({ artifactId: jobA.artifactId })).text || '';
  const prefApplied =
    (freezeA?.entries || []).some((e) =>
      /结论|决策|篇幅|简洁|汇报/.test(`${e.title} ${e.detail}`),
    ) || /结论/.test(String(textA).slice(0, 400));

  report.scenarios.A = {
    distillMode: distillA.mode,
    realModelDistill: distillA.mode === 'model',
    confirmedCount: (distillA.confirmedEventIds || []).length,
    pendingCount: (distillA.confirmationSuggestedEventIds || []).length,
    discarded: distillA.discarded,
    candidates: distillA.events,
    uiSilent,
    taskStatus: jobA.status,
    preferenceAppliedSignal: Boolean(prefApplied),
    activeSample: activeA.slice(0, 200),
    recentSample: recentA.slice(0, 200),
    artifactHead: String(textA).slice(0, 280),
  };

  // ---------- 场景 B：做事学习 ----------
  const goalB1 = '撰写产品周报：总结本周进展、风险与下周计划，面向负责人。';
  const tB1 = Date.now();
  const taskB1 = await runtime.submitTask({
    goal: goalB1,
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobB1 = await waitForJobTerminal(runtime.workRuntime, taskB1.jobId, 240_000);
  report.metrics.artifact_ready_time_ms.push(Date.now() - tB1);
  const artB1 = jobB1.artifactId;
  const draft1 = (await runtime.getContent({ artifactId: artB1 })).text || '';
  const issues1 = countIssues(draft1);
  report.metrics.first_draft_issue_count = issues1.length;

  // Owner 真实修改：结论先行、压缩、突出决策
  const edited = [
    '# 本周产品周报（结论先行）',
    '',
    '## 结论',
    '- 主路径可继续；需你决策：是否本周五冻结发布范围。',
    '- 风险：联调延迟 1 天，不影响主里程碑。',
    '',
    '## 需你决策',
    '1. 是否冻结本周五范围？',
    '2. 是否接受联调顺延到下周一？',
    '',
    '## 进展（精简）',
    '- 核心文档路径已打通。',
    '- 验收脚本已跑通。',
    '',
    '## 下周',
    '- 完成冻结范围内收口。',
  ].join('\n');
  const saved = await runtime.saveEdit({ artifactId: artB1, text: edited });
  const gB0 = Date.now();
  const distillB = await productCapture(runtime, {
    text: '我把周报改成结论先行、控制篇幅，并只保留需要我决策的事项。以后同类周报沿用这个结构。',
    sourceKind: 'artifact_edit',
    artifactId: artB1,
    artifactVersionId: saved.versionId,
    requestedArtifactType: 'document',
    taskId: taskB1.taskId 
  });
  // 采用
  await runtime.captureSubjectInput({
    text: '采用修改后的周报结构。',
    sourceKind: 'artifact_acceptance',
    artifactId: artB1,
    artifactVersionId: saved.versionId,
    requestedArtifactType: 'document',
    taskId: taskB1.taskId,
  });
  report.metrics.growth_completed_time_ms.push(Date.now() - gB0);

  const tB2 = Date.now();
  const taskB2 = await runtime.submitTask({
    goal: '再写一份产品周报：总结进展、风险与下周计划，面向负责人。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobB2 = await waitForJobTerminal(runtime.workRuntime, taskB2.jobId, 240_000);
  report.metrics.artifact_ready_time_ms.push(Date.now() - tB2);
  const draft2 = (await runtime.getContent({ artifactId: jobB2.artifactId })).text || '';
  const issues2All = countIssues(draft2);
  const sameIssues = issues1.filter((i) => issues2All.includes(i));
  report.metrics.second_draft_same_issue_count = sameIssues.length;
  report.metrics.repeated_correction_reduced = sameIssues.length < issues1.length;
  report.metrics.first_acceptance_signal =
    /结论/.test(draft2.slice(0, 500)) || /决策/.test(draft2) ? 'improved_structure' : 'mixed';

  const freezeB2 = await runtime.readSubjectContextFreeze(jobB2.snapshotId);
  const erroneousReuse = (freezeB2?.entries || []).some((e) =>
    /第三方|项目组认为|你一定是|政治立场/.test(`${e.title}${e.detail}`),
  );

  report.scenarios.B = {
    task1: jobB1.status,
    task2: jobB2.status,
    issues1,
    issues2: issues2All,
    sameIssues,
    repeatedCorrectionReduced: report.metrics.repeated_correction_reduced,
    distillMode: distillB.mode,
    erroneousReuse: Boolean(erroneousReuse),
    draft1Head: draft1.slice(0, 220),
    draft2Head: draft2.slice(0, 220),
    waitMs: {
      first: report.metrics.artifact_ready_time_ms[report.metrics.artifact_ready_time_ms.length - 2],
      second: report.metrics.artifact_ready_time_ms[report.metrics.artifact_ready_time_ms.length - 1],
    },
  };

  // ---------- 场景 C：资料学习 ----------
  const matPath = path.join(root, 'project-view.md');
  await fs.writeFile(
    matPath,
    [
      '# 项目评审摘录',
      '项目组认为应优先上云，以缩短交付周期。',
      '顾问建议：本期可接受一定可用性风险换取速度。',
      '（以上为资料中的第三方/项目判断，不是 Owner 个人立场。）',
    ].join('\n'),
    'utf8',
  );
  const imported = await runtime.importSubjectMaterial({
    sourcePath: matPath,
    distillCandidates: false,
  });
  const materialText = await fs.readFile(matPath, 'utf8');
  const gC0 = Date.now();
  const distillC = await productCapture(runtime, {
    text: materialText,
    sourceKind: 'imported_material',
    materialRef: imported.materialRef 
  });
  report.metrics.growth_completed_time_ms.push(Date.now() - gC0);

  const overviewC = await runtime.getOverview();
  const activeC = (overviewC.activeUnderstandings || []).map((i) => i.text).join('\n');
  const recentC = (overviewC.recentLearnings || [])
    .map((i) => `${i.text}||${i.sourceNote || ''}`)
    .join('\n');
  const asOwnerOpinion =
    /你认为应优先上云|Owner 认为应优先上云|你主张上云/.test(activeC + recentC) ||
    distillC.events.some(
      (e) =>
        e.type === 'preference_observed' &&
        /上云/.test(e.title + e.detail) &&
        !(e.tags || []).includes('category:external_claim'),
    );
  if (asOwnerOpinion) report.metrics.erroneous_user_attribution += 1;

  // 后续任务：不得无依据写“你认为”
  const tC0 = Date.now();
  const taskC = await runtime.submitTask({
    goal: '根据已有资料写一段项目风险提示（不要臆造个人立场）',
    contextRefs: [{ kind: 'file', path: matPath }],
    requestedArtifactType: 'document',
  });
  const jobC = await waitForJobTerminal(runtime.workRuntime, taskC.jobId, 240_000);
  report.metrics.artifact_ready_time_ms.push(Date.now() - tC0);
  const textC = (await runtime.getContent({ artifactId: jobC.artifactId })).text || '';
  const youThinkLeak = /你认为应优先上云|你主张全部上云/.test(textC);
  if (youThinkLeak) report.metrics.erroneous_user_attribution += 1;

  report.scenarios.C = {
    distillMode: distillC.mode,
    materialRef: imported.materialRef,
    events: distillC.events,
    discarded: distillC.discarded,
    erroneousUserAttribution: report.metrics.erroneous_user_attribution,
    taskStatus: jobC.status,
    youThinkLeak: Boolean(youThinkLeak),
    artifactHead: textC.slice(0, 280),
  };

  // ---------- 场景 D：JIT 冲突 ----------
  // 先确保有简洁偏好，再引入完整分析冲突
  await productCapture(runtime, {
    text: '以后这样：项目汇报保持简洁，少展开。',
    sourceKind: 'conversation' 
  });
  const conflictDistill = await productCapture(runtime, {
    text: '最近一次又要求保留完整分析，把细节写全。',
    sourceKind: 'conversation' 
  });

  // 无关任务不确认
  const unrelated = await runtime.submitTask({
    goal: '整理购物清单：牛奶、鸡蛋、面包',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const unrelatedJob = await waitForJobTerminal(runtime.workRuntime, unrelated.jobId, 240_000);
  const unrelatedView = await runtime.getTask({ taskId: unrelated.taskId });
  const unrelatedPrompt = Boolean(unrelatedView.ownerChoicePrompt);
  if (unrelatedPrompt) report.metrics.unnecessary_confirmations += 1;
  report.metrics.unrelated_pollution = unrelatedPrompt ? 1 : 0;

  // 相关任务应 JIT
  const relatedD = await runtime.submitTask({
    goal: '写一份项目汇报，需要完整分析与结论',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const relatedDJob = await waitForJobTerminal(runtime.workRuntime, relatedD.jobId, 240_000);
  let relatedView = await runtime.getTask({ taskId: relatedD.taskId });
  const jitBeforeUse = Boolean(relatedView.ownerChoicePrompt);

  // 暂不决定 → 任务已成功
  let deferOk = relatedDJob.status === 'succeeded';
  if (relatedView.ownerChoicePrompt) {
    await runtime.respondToLearning({
      eventId: relatedView.ownerChoicePrompt.eventIdA,
      peerEventId: relatedView.ownerChoicePrompt.eventIdB,
      taskId: relatedD.taskId,
      action: 'defer',
    });
  }

  // 仅本次 B
  const onceTask = await runtime.submitTask({
    goal: '再写项目汇报，按完整分析处理',
    contextRefs: [],
    requestedArtifactType: 'document',
    ...(relatedView.ownerChoicePrompt
      ? {
          jitChoice: {
            action: 'use_b_once',
            eventIdA: relatedView.ownerChoicePrompt.eventIdA,
            eventIdB: relatedView.ownerChoicePrompt.eventIdB,
          },
        }
      : {}),
  });
  const onceJob = await waitForJobTerminal(runtime.workRuntime, onceTask.jobId, 240_000);

  // 以后优先 B
  if (relatedView.ownerChoicePrompt) {
    await runtime.respondToLearning({
      eventId: relatedView.ownerChoicePrompt.eventIdA,
      peerEventId: relatedView.ownerChoicePrompt.eventIdB,
      action: 'prefer_b',
    });
  }
  const preferTask = await runtime.submitTask({
    goal: '继续项目汇报，保留完整分析',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const preferJob = await waitForJobTerminal(runtime.workRuntime, preferTask.jobId, 240_000);

  report.scenarios.D = {
    conflictDistillMode: conflictDistill.mode,
    unrelatedPrompt: Boolean(unrelatedPrompt),
    unrelatedStatus: unrelatedJob.status,
    relatedJitPrompt: jitBeforeUse,
    relatedStatus: relatedDJob.status,
    deferContinues: deferOk,
    useOnceStatus: onceJob.status,
    preferForwardStatus: preferJob.status,
    promptSample: relatedView.ownerChoicePrompt
      ? {
          question: relatedView.ownerChoicePrompt.question,
          labelA: relatedView.ownerChoicePrompt.labelA,
          labelB: relatedView.ownerChoicePrompt.labelB,
        }
      : null,
  };

  // ---------- 判定 ----------
  const realDistillOk =
    distillA.mode === 'model' || distillB.mode === 'model' || distillC.mode === 'model';
  const aOk = report.scenarios.A.taskStatus === 'succeeded' && report.scenarios.A.preferenceAppliedSignal;
  const bOk =
    report.scenarios.B.repeatedCorrectionReduced === true ||
    report.scenarios.B.first_acceptance_signal === 'improved_structure' ||
    (report.metrics.second_draft_same_issue_count != null &&
      report.metrics.first_draft_issue_count != null &&
      report.metrics.second_draft_same_issue_count < report.metrics.first_draft_issue_count);
  // fix: use metrics field
  const bPositive =
    report.metrics.repeated_correction_reduced === true ||
    report.metrics.first_acceptance_signal === 'improved_structure';
  const cOk = report.metrics.erroneous_user_attribution === 0 && !report.scenarios.C.youThinkLeak;
  const dOk =
    !report.scenarios.D.unrelatedPrompt &&
    report.scenarios.D.relatedStatus === 'succeeded' &&
    report.scenarios.D.deferContinues &&
    report.scenarios.D.useOnceStatus === 'succeeded' &&
    report.scenarios.D.preferForwardStatus === 'succeeded';
  const mainUninterrupted = [jobA, jobB1, jobB2, jobC, unrelatedJob, relatedDJob, onceJob, preferJob].every(
    (j) => j.status === 'succeeded',
  );
  const waits = report.metrics.artifact_ready_time_ms;
  const medianWait = waits.slice().sort((a, b) => a - b)[Math.floor(waits.length / 2)] || 0;
  const waitOk = medianWait < 180000; // 3min 内视为无明显不可接受等待（真模型）

  let status = 'engineering_validated_value_not_proven';
  if (!realDistillOk) {
    status = 'real_model_validation_blocked';
  } else if (
    realDistillOk &&
    aOk &&
    bPositive &&
    cOk &&
    dOk &&
    report.metrics.unrelated_pollution === 0 &&
    mainUninterrupted &&
    waitOk
  ) {
    status = 'subject_growth_product_value_validated';
  } else if (realDistillOk && (aOk || bPositive || cOk) && mainUninterrupted) {
    status = 'quality_signal_positive_but_mixed';
  }

  report.status = status;
  report.passGates = {
    realDistillOk,
    aOk,
    bPositive,
    cOk,
    dOk,
    unrelatedPollution0: report.metrics.unrelated_pollution === 0,
    mainUninterrupted,
    waitOk,
    medianArtifactReadyMs: medianWait,
  };
  report.generatedAt = new Date().toISOString();

  writeEvidence('summary.json', report);
  writeEvidence('scenario-A.json', report.scenarios.A);
  writeEvidence('scenario-B.json', report.scenarios.B);
  writeEvidence('scenario-C.json', report.scenarios.C);
  writeEvidence('scenario-D.json', report.scenarios.D);
  await runtime.stop();
  console.log(JSON.stringify({ status: report.status, passGates: report.passGates, modelMeta }, null, 2));
}

main().catch((err) => {
  console.error(err);
  writeEvidence('summary.json', {
    status: 'real_model_validation_blocked',
    reason: 'runner_exception',
    error: String(err && err.stack ? err.stack : err),
    generatedAt: new Date().toISOString(),
  });
  process.exit(1);
});
