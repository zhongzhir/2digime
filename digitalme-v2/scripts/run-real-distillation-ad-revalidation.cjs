/**
 * DIGITALME-V2-REAL-DISTILLATION-INTEGRATION-AND-JIT-FIX-01
 * 场景 A / D 真模型复验 — 仅走 captureInput 产品路径（无平行蒸馏入口）。
 */
'use strict';

const { promises: fs } = require('node:fs');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_real-distillation-jit-integration-evidence');
fsSync.mkdirSync(evidenceDir, { recursive: true });

function writeEvidence(name, data) {
  fsSync.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2), 'utf8');
}

function structuralPreferenceSignals(text) {
  const t = String(text || '');
  const head = t.slice(0, Math.min(600, t.length));
  const signals = {
    conclusionEarly: false,
    restrainedLength: t.length <= 2200,
    decisionHighlight: false,
  };
  // 结构：前部出现结论区 / 决策区，而非仅关键词
  const firstConclusion = head.search(/##\s*结论|先讲结论|结论先行|一、结论|【结论】/);
  const firstBody = head.search(/##\s*进展|##\s*详情|##\s*分析|背景说明/);
  signals.conclusionEarly =
    firstConclusion >= 0 && (firstBody < 0 || firstConclusion < firstBody);
  if (!signals.conclusionEarly && /结论/.test(head.slice(0, 280))) {
    signals.conclusionEarly = true;
  }
  signals.decisionHighlight = /##\s*需.*决策|待你决策|需要你决策|请确认|决策事项/.test(t);
  return signals;
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

async function main() {
  const loaded = await loadCredential();
  if (!loaded) {
    const blocked = {
      status: 'real_model_revalidation_blocked',
      reason: 'missing_product_model_credential',
      generatedAt: new Date().toISOString(),
    };
    writeEvidence('ad-revalidation.json', blocked);
    console.log(JSON.stringify(blocked, null, 2));
    process.exit(0);
  }

  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  const { cred, secrets } = loaded;

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-real-distill-ad-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      providerId: cred.providerId,
      baseUrl: cred.baseUrl,
      model: cred.model,
      maxTokens: 2048,
      timeoutMs: 180000,
    },
    secrets,
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: 'real-distill-ad', targetDir: path.join(root, 'pkg') });

  const report = {
    status: 'running',
    generatedAt: new Date().toISOString(),
    modelMeta: {
      model: cred.model,
      providerId: cred.providerId,
      baseUrlHost: (() => {
        try {
          return new URL(cred.baseUrl).host;
        } catch {
          return 'unknown';
        }
      })(),
    },
    scenarios: {},
  };

  // ---- A：对话偏好（唯一正式路径 captureInput）----
  const prefText =
    '以后项目汇报先给结论，控制篇幅，只保留需要我决策的事项。';
  const capA = await runtime.captureSubjectInput({
    text: prefText,
    sourceKind: 'conversation',
  });
  const eventsA = await runtime.subject.listGrowthEvents();
  const adopted = eventsA.filter((e) => (capA.confirmedEventIds || []).includes(e.id));
  const normCat = adopted
    .flatMap((e) => e.payload.tags || [])
    .find((t) => t.startsWith('norm_category:') || t.startsWith('category:'));
  const categoryOk =
    /preference|working_method/.test(String(normCat || '')) ||
    adopted.some((e) => e.type === 'preference_observed');

  const relatedA = await runtime.submitTask({
    goal: '写一份本周项目汇报，说明进展与风险',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobA = await waitForJobTerminal(runtime.workRuntime, relatedA.jobId, 240_000);
  const freezeA = await runtime.readSubjectContextFreeze(jobA.snapshotId);
  const textA = (await runtime.getContent({ artifactId: jobA.artifactId })).text || '';
  const selected = (freezeA?.entries || []).some((e) =>
    /结论|决策|篇幅|简洁|汇报|简短/.test(`${e.title} ${e.detail}`),
  );
  const structure = structuralPreferenceSignals(textA);

  report.scenarios.A = {
    captureInput_mode: capA.distillMode,
    normalized_category_ok: Boolean(categoryOk),
    adoption: (capA.confirmedEventIds || []).length ? 'silent' : 'not_silent',
    later_context_selected: Boolean(selected),
    taskStatus: jobA.status,
    structure,
    normalizeTrace: capA.normalizeTrace || [],
    artifactHead: textA.slice(0, 400),
    pass:
      capA.distillMode === 'model' &&
      categoryOk &&
      (capA.confirmedEventIds || []).length > 0 &&
      selected &&
      structure.conclusionEarly &&
      structure.restrainedLength &&
      structure.decisionHighlight &&
      jobA.status === 'succeeded',
  };

  // ---- D：冲突 JIT ----
  const capShort = await runtime.captureSubjectInput({
    text: '项目汇报先给结论并尽量简短。',
    sourceKind: 'conversation',
  });
  if (!(capShort.confirmedEventIds || []).length && (capShort.candidateEventIds || []).length) {
    await runtime.confirmExperience({ eventIds: capShort.candidateEventIds });
  }
  const capLong = await runtime.captureSubjectInput({
    text: '这类项目汇报要保留完整分析过程和详细论证。',
    sourceKind: 'conversation',
  });

  const unrelated = await runtime.submitTask({
    goal: '整理今日待办：回邮件、备份材料',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime.workRuntime, unrelated.jobId, 240_000);
  const unrelatedView = await runtime.getTask({ taskId: unrelated.taskId });
  const unrelatedConfirm = unrelatedView.ownerChoicePrompt ? 1 : 0;

  const relatedD = await runtime.submitTask({
    goal: '写一份本周项目汇报，说明进展与风险',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  // JIT 在 ContextSnapshot 构建时触发；任务可能已跑完，从 getTask / peek 读
  let relatedView = await runtime.getTask({ taskId: relatedD.taskId });
  let jitPrompt = relatedView.ownerChoicePrompt || null;
  if (!jitPrompt) {
    const prep = await runtime.subject.prepareJitForTask({
      taskId: relatedD.taskId,
      goal: '写一份本周项目汇报，说明进展与风险',
    });
    jitPrompt = prep.prompt;
  }

  let onceEffect = false;
  if (jitPrompt) {
    const onceTask = await runtime.submitTask({
      goal: '再写一份项目汇报，突出完整分析过程',
      contextRefs: [],
      requestedArtifactType: 'document',
      jitChoice: {
        action: 'use_b_once',
        eventIdA: jitPrompt.eventIdA,
        eventIdB: jitPrompt.eventIdB,
      },
    });
    const onceJob = await waitForJobTerminal(runtime.workRuntime, onceTask.jobId, 240_000);
    const freezeOnce = await runtime.readSubjectContextFreeze(onceJob.snapshotId);
    onceEffect = (freezeOnce?.entries || []).some(
      (e) =>
        e.eventId === jitPrompt.eventIdB ||
        /完整分析|详细论证/.test(`${e.title} ${e.detail}`),
    );
    relatedView = await runtime.getTask({ taskId: relatedD.taskId });
  }

  const jobD = await waitForJobTerminal(runtime.workRuntime, relatedD.jobId, 240_000);

  report.scenarios.D = {
    shortPendingOrConfirmed: Boolean(
      (capShort.confirmedEventIds || []).length || (capShort.candidateEventIds || []).length,
    ),
    conflictPending: (capLong.confirmationSuggestedEventIds || []).length > 0,
    conflictSilentOverwrite: (capLong.confirmedEventIds || []).length > 0,
    unrelated_confirmations: unrelatedConfirm,
    jit_triggered: Boolean(jitPrompt),
    once_affects_snapshot: onceEffect,
    main_task_status: jobD.status,
    pass:
      (capLong.confirmationSuggestedEventIds || []).length > 0 &&
      (capLong.confirmedEventIds || []).length === 0 &&
      unrelatedConfirm === 0 &&
      Boolean(jitPrompt) &&
      onceEffect &&
      jobD.status === 'succeeded',
  };

  const aOk = report.scenarios.A.pass;
  const dOk = report.scenarios.D.pass;
  report.status =
    aOk && dOk
      ? 'revalidation_passed'
      : aOk || dOk
        ? 'revalidation_partial'
        : 'revalidation_failed';
  report.verdict = { A: aOk, D: dOk };

  writeEvidence('ad-revalidation.json', report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(aOk && dOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
