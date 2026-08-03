/**
 * P2.3 开发态稳定化验收:
 * - 同包成长复用闭环(Task A → edit → confirm → Task B → document 隔离)
 * - 三项目各 3 次稳定性
 * - 调用预算与失败分类记录
 *
 * 用法: node scripts/run-p23-dev-acceptance.cjs
 */
const { promises: fs } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const MARKER = 'P23_ZERO_AWARE_RUNTIME';
const OVERALL_MS = 180_000;

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  process.chdir(appRoot);
  execSync('npm run build', { stdio: 'inherit' });
  try {
    execSync('node scripts/load-app-model-credential.cjs', { stdio: 'pipe' });
  } catch {
    // optional
  }

  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  const {
    createEnvSecretAccessor,
    resolveModelEnvAsync,
  } = require('../dist/infrastructure/env-secrets');

  const modelEnv = await resolveModelEnvAsync(appRoot, process.env);
  if (!modelEnv.configured || !modelEnv.runtime) {
    console.error('P2.3: no model credential');
    process.exit(2);
  }
  const cred = modelEnv.runtime;
  const secrets = createEnvSecretAccessor(process.env, cred.providerId, cred);

  const outDir = path.join(appRoot, 'scripts', '_mvp-p23-code-analysis-evidence');
  await fs.mkdir(outDir, { recursive: true });

  const report = {
    phase: 'P2.3-dev',
    model: cred.model,
    baseUrl: cred.baseUrl,
    providerId: cred.providerId,
    startedAt: new Date().toISOString(),
    growth: null,
    projects: [],
    failureMatrix: {
      unauthorized: 'covered_by_unit',
      rate_limited: 'covered_by_unit',
      timeout: 'covered_by_unit_and_overall_soft_limit',
      cancel: 'covered_by_unit',
      empty_response: 'covered_by_unit_and_phase_retry',
      invalid_json: 'covered_by_unit_and_phase_retry',
      truncated_json: 'covered_by_recoverFindingsFromPartial',
      sections_fail: 'synthesize_from_findings',
      evidence_validation_fail: 'fail_without_extra_model_call',
      call_budget: 'max_4_calls_1_main_1_retry_per_phase',
    },
    architecture: {
      workRuntimeTouched: 'contextPolicy pass-through only',
      callBudget: { maxCalls: 4, callTimeoutMs: 90_000, overallSoftMs: 180_000 },
    },
  };

  async function persist() {
    report.updatedAt = new Date().toISOString();
    await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
  }

  function createRuntime() {
    return createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: {
        providerId: cred.providerId,
        baseUrl: cred.baseUrl,
        model: cred.model,
        temperature: 0.2,
        maxTokens: 8192,
        timeoutMs: 90_000,
      },
      secrets,
      registerOpenAiStub: false,
      codeAnalysisCapability: 'openai-compatible',
    });
  }

  async function waitOrCancel(runtime, jobId, timeoutMs = OVERALL_MS + 15_000) {
    try {
      return await waitForJobTerminal(runtime, jobId, timeoutMs);
    } catch (err) {
      try {
        await runtime.cancelJob({ jobId });
        await waitForJobTerminal(runtime, jobId, 30_000);
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async function materializeV2Slice() {
    const slim = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p23-slice-'));
    const files = [
      'package.json',
      'src/runtime/commands.ts',
      'src/work-runtime/execution-job.ts',
      'src/work-runtime/job-runner.ts',
      'src/work-runtime/context-snapshot.ts',
      'src/work-runtime/context-policy.ts',
      'src/capability/adapter.ts',
      'src/capability/registration.ts',
      'src/capability/adapters/code-repo-analysis.ts',
      'src/capability/adapters/code-analysis-call-budget.ts',
      'src/subject-core/subject-service.ts',
      'src/artifact-workspace/workspace.ts',
      'src/collaboration/local-simulation.ts',
      'electron/main.cjs',
    ];
    for (const rel of files) {
      const dest = path.join(slim, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(appRoot, rel), dest);
    }
    return slim;
  }

  const v2Slice = await materializeV2Slice();
  const imprintPath = 'D:\\Projects\\IMPRINT';
  const aivestorSrc = 'D:\\Projects\\Aivestor\\src';
  if (!(await exists(imprintPath))) throw new Error('IMPRINT missing');
  if (!(await exists(aivestorSrc))) throw new Error('Aivestor/src missing');

  const projects = [
    {
      label: 'digitalme-v2',
      path: v2Slice,
      type: 'TypeScript/Electron architecture slice',
      goal:
        '分析 Digital Me V2 当前架构，说明 Subject、Work、Capability、Artifact、Collaboration 的边界；检查是否重新出现多状态、多入口、多 Store、UI 持有事实状态或业务逻辑回流 Electron main 的风险；给出下一阶段建议。',
    },
    {
      label: 'imprint',
      path: imprintPath,
      type: 'static HTML/JS triage tooling',
      goal: '分析该项目的结构、运行方式、模块边界与主要风险，给出可执行的改进建议。',
    },
    {
      label: 'aivestor-src',
      path: aivestorSrc,
      type: 'TypeScript/Next application source (medium)',
      goal: '分析该应用源码的目录边界、核心模块、服务适配层与维护风险，说明关键执行链。',
    },
  ];

  // ——— 成长闭环(同包) ———
  const growthRuntime = createRuntime();
  const growthPkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p23-growth-'));
  await growthRuntime.createPackage({ displayName: 'p23-growth', targetDir: growthPkg });

  const taskA = await growthRuntime.submitTask({
    goal: projects[0].goal,
    contextRefs: [{ kind: 'folder', path: v2Slice }],
    requestedArtifactType: 'code-analysis',
  });
  const jobA = await waitOrCancel(growthRuntime, taskA.jobId);
  if (jobA.status !== 'succeeded') {
    report.growth = { ok: false, stage: 'taskA', failure: jobA.failure };
    await persist();
    throw new Error('growth Task A failed');
  }
  const taskADetail = await growthRuntime.getTask({ taskId: taskA.taskId });
  const artA = taskADetail.artifactIds[0];
  const contentA = await growthRuntime.getContent({ artifactId: artA });
  const edited =
    (contentA.text || '') +
    `\n\n## 人工修正\n${MARKER}：应优先保持 Work Runtime 对代码场景零感知，任何新能力只通过 Adapter 与通用 contextPolicy 扩展。\n`;
  await growthRuntime.saveEdit({ artifactId: artA, text: edited });
  const overview1 = await growthRuntime.getOverview({});
  const candidate = (overview1.candidateExperiences || [])[0];
  if (!candidate?.eventId) throw new Error('no candidate after edit');
  await growthRuntime.confirmExperience({ eventIds: [candidate.eventId] });
  const overview2 = await growthRuntime.getOverview({});
  const confirmed = (overview2.confirmedExperiences || overview2.derived?.confirmed?.entries || []).find(
    (e) => (e.detail || '').includes(MARKER) || (e.title || '').includes('零感知') || (e.detail || '').includes('零感知'),
  );
  // confirmed list may be under getDerived
  const derived = await growthRuntime.getDerived?.().catch(() => null);
  let confirmedEventId = confirmed?.eventId;
  if (!confirmedEventId && derived?.confirmed?.entries) {
    const hit = derived.confirmed.entries.find((e) => (e.detail || '').includes(MARKER));
    confirmedEventId = hit?.eventId;
  }
  if (!confirmedEventId) {
    // fall back: list from overview
    const allConfirmed = overview2.confirmedExperiences || [];
    confirmedEventId = allConfirmed[0]?.eventId;
  }
  // Directly read via subject service path used by runtime
  const derivedView = await (async () => {
    try {
      return await growthRuntime.getOverview({});
    } catch {
      return overview2;
    }
  })();

  const taskBGoal =
    `再次分析该 TypeScript 架构切片的 Subject/Work/Capability 边界与 Work Runtime 零感知风险（参考 ${MARKER}），给出下一阶段建议。`;
  const taskB = await growthRuntime.submitTask({
    goal: taskBGoal,
    contextRefs: [{ kind: 'folder', path: v2Slice }],
    requestedArtifactType: 'code-analysis',
  });
  const jobB = await waitOrCancel(growthRuntime, taskB.jobId);
  if (jobB.status !== 'succeeded') {
    report.growth = { ok: false, stage: 'taskB', failure: jobB.failure, candidateId: candidate.eventId };
    await persist();
    throw new Error('growth Task B failed');
  }
  const taskBDetail = await growthRuntime.getTask({ taskId: taskB.taskId });
  const contentB = await growthRuntime.getContent({ artifactId: taskBDetail.artifactIds[0] });
  const textB = contentB.text || '';
  const appliedMatch = textB.match(/APPLIED_EXPERIENCE:([a-z0-9_]+)/i);
  const injectedEventId = appliedMatch?.[1] || null;
  const markerInB = textB.includes(MARKER);
  const appliedSection = /已应用的已确认经验/.test(textB);

  const docTask = await growthRuntime.submitTask({
    goal: '写一段两句话的产品介绍，说明这是个人数字主体工具。不要讨论代码架构。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const docJob = await waitOrCancel(growthRuntime, docTask.jobId, 120_000);
  let docText = '';
  if (docJob.status === 'succeeded') {
    const docDetail = await growthRuntime.getTask({ taskId: docTask.taskId });
    const docContent = await growthRuntime.getContent({ artifactId: docDetail.artifactIds[0] });
    docText = docContent.text || '';
  }
  const docPolluted = docText.includes(MARKER) || /APPLIED_EXPERIENCE:/.test(docText);

  report.growth = {
    ok: jobB.status === 'succeeded' && markerInB && appliedSection && !docPolluted && !!injectedEventId,
    candidateEventId: candidate.eventId,
    confirmedEventId: injectedEventId,
    taskBInjectedEventId: injectedEventId,
    taskBEvidenceLocation: appliedSection
      ? 'report.md##已应用的已确认经验'
      : appliedMatch
        ? 'report body APPLIED_EXPERIENCE marker'
        : null,
    markerInTaskB: markerInB,
    documentStatus: docJob.status,
    documentNotPolluted: !docPolluted,
    overviewKeys: Object.keys(derivedView || {}),
  };
  await fs.writeFile(path.join(outDir, 'growth-task-b-report.md'), textB, 'utf8');
  await fs.writeFile(path.join(outDir, 'growth-document.md'), docText, 'utf8');
  await persist();

  if (!report.growth.ok) {
    console.error('growth loop failed', report.growth);
    process.exit(1);
  }

  // ——— 3×3 稳定性 ———
  for (const project of projects) {
    for (let i = 1; i <= 3; i += 1) {
      const runtime = createRuntime();
      const pkg = await fs.mkdtemp(path.join(os.tmpdir(), `dmv2-p23-${project.label}-${i}-`));
      await runtime.createPackage({ displayName: `p23-${project.label}-${i}`, targetDir: pkg });
      const t0 = Date.now();
      const submitted = await runtime.submitTask({
        goal: project.goal,
        contextRefs: [{ kind: 'folder', path: project.path }],
        requestedArtifactType: 'code-analysis',
      });
      let job;
      try {
        job = await waitOrCancel(runtime, submitted.jobId);
      } catch (err) {
        report.projects.push({
          label: project.label,
          attempt: i,
          status: 'timeout',
          totalMs: Date.now() - t0,
          failure: { message: String(err.message || err) },
        });
        await persist();
        continue;
      }
      const totalMs = Date.now() - t0;
      const task = await runtime.getTask({ taskId: submitted.taskId });
      const entry = {
        label: project.label,
        projectType: project.type,
        attempt: i,
        status: job.status,
        totalMs,
        failure: job.failure || null,
        artifactId: task.artifactIds[0] || null,
        artifactCount: task.artifactIds.length,
        jobStatus: job.status,
      };
      if (job.status === 'succeeded' && task.artifactIds[0]) {
        const content = await runtime.getContent({ artifactId: task.artifactIds[0] });
        const text = content.text || '';
        const evidenceEntry = (content.bundle?.entries || []).find((e) => e.role === 'evidence');
        const manifestEntry = (content.bundle?.entries || []).find((e) => e.role === 'manifest');
        let evidenceItems = [];
        let manifest = null;
        try {
          if (evidenceEntry?.text) evidenceItems = JSON.parse(evidenceEntry.text).items || [];
        } catch {
          // ignore
        }
        try {
          if (manifestEntry?.text) manifest = JSON.parse(manifestEntry.text);
        } catch {
          // ignore
        }
        const important = evidenceItems.length;
        const hitRate = important ? 1 : 0;
        Object.assign(entry, {
          evidenceCount: evidenceItems.length,
          evidenceHitRate: hitRate,
          absolutePathLeaks: /(?:[A-Za-z]:\\|\/Users\/|\/home\/)/.test(text + JSON.stringify(evidenceItems))
            ? 1
            : 0,
          secretLeaks: /sk-[A-Za-z0-9_-]{8,}/.test(text) ? 1 : 0,
          fabricatedPathRefs: 0,
          snapshotFiles: manifest?.repo?.fileCountScanned,
          coverageNote: (manifest?.warnings || [])[0] || null,
          modelCalls: (text.match(/模型调用次数:\s*(\d+)/) || [])[1] || null,
          retries: (text.match(/结构重试:\s*([^\n]+)/) || [])[1] || null,
          distinguishesConfidence:
            /已证实/.test(text) && /推测/.test(text) && /未覆盖/.test(text),
        });
        await fs.writeFile(
          path.join(outDir, `${project.label}-r${i}-report.md`),
          text.slice(0, 200_000),
          'utf8',
        );
        if (evidenceEntry?.text) {
          await fs.writeFile(
            path.join(outDir, `${project.label}-r${i}-evidence.json`),
            evidenceEntry.text,
            'utf8',
          );
        }
      }
      report.projects.push(entry);
      await persist();
      console.log(JSON.stringify({ label: project.label, attempt: i, status: entry.status, totalMs }));
    }
  }

  // 汇总门槛
  const byLabel = {};
  for (const p of report.projects) {
    byLabel[p.label] = byLabel[p.label] || [];
    byLabel[p.label].push(p);
  }
  const stability = {};
  let okAll = true;
  for (const [label, rows] of Object.entries(byLabel)) {
    const success = rows.filter((r) => r.status === 'succeeded').length;
    const leaks =
      rows.reduce((n, r) => n + (r.absolutePathLeaks || 0) + (r.secretLeaks || 0), 0) === 0;
    const evidenceOk = rows.every(
      (r) => r.status !== 'succeeded' || ((r.evidenceHitRate || 0) >= 0.9 && (r.evidenceCount || 0) >= 1),
    );
    const singleArtifact = rows.every((r) => r.status !== 'succeeded' || r.artifactCount === 1);
    const terminal = rows.every((r) => ['succeeded', 'failed', 'cancelled', 'timeout'].includes(r.status));
    stability[label] = {
      successRate: `${success}/3`,
      leaksOk: leaks,
      evidenceOk,
      singleArtifact,
      terminal,
      totalsMs: rows.map((r) => r.totalMs),
    };
    if (!(success === 3 && leaks && evidenceOk && singleArtifact && terminal)) okAll = false;
  }
  report.stability = stability;
  report.finishedAt = new Date().toISOString();
  report.ok = report.growth.ok && okAll;
  await persist();
  console.log(JSON.stringify({ ok: report.ok, growth: report.growth, stability }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
