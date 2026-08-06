/**
 * 任务指令与修订完整性 — 运行时 Fake 场景（捕获 prompt / 版本差异）。
 * 不用真实模型；验证合同接线。真实 DeepSeek 见 run-task-instruction-revision-integrity-real.cjs。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const evidenceDir =
  process.env.DIGITALME_TIRI_EVIDENCE ||
  path.join(ROOT, 'scripts', '_task-instruction-revision-integrity-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
const { assembleDocumentPrompt } = require('../dist/capability/adapters/prompt-assemble');
const { checkOutcome } = require('../dist/work-runtime/ai-first-policy');

const report = { startedAt: new Date().toISOString(), checks: [], verdict: null };

function check(name, okFlag, detail) {
  report.checks.push({ name, ok: !!okFlag, ...(detail ? { detail } : {}) });
  if (!okFlag) throw new Error(`CHECK_FAILED: ${name} ${detail ? JSON.stringify(detail) : ''}`);
}

async function main() {
  const goal =
    '写一篇关于 Aivestor 项目的介绍文章，不少于1500字。综合产品定位、目标用户、核心能力和应用价值。';
  const rejectReason = '文章主题错误，未围绕 Aivestor，也没有综合文件夹材料。';
  const reviseReq =
    '重新撰写一篇不少于1500字的 Aivestor 项目介绍，综合材料中的产品定位、目标用户、核心能力和应用价值。';

  // --- Prompt 合同 ---
  const assembled = await assembleDocumentPrompt(
    {
      goal,
      artifactType: 'document',
      snapshot: {
        id: 's',
        taskId: 't',
        createdAt: new Date().toISOString(),
        items: [
          {
            sourcePath: 'waic.md',
            status: 'ok',
            extractedTextRef: 'waic',
          },
          {
            sourcePath: 'aivestor.md',
            status: 'ok',
            extractedTextRef: 'aiv',
          },
        ],
      },
      subjectContext: { subjectId: 'x', derivedAt: 't', entries: [] },
      revision: {
        request: reviseReq,
        previousText: '# WAIC\n'.padEnd(800, '旧'),
        artifactId: 'art',
        rejectionReason: rejectReason,
      },
    },
    async (ref) =>
      ref === 'aiv'
        ? 'Aivestor 产品定位：智能投资助手。目标用户：个人投资者。核心能力：组合分析。应用价值：提升决策效率。'
        : `${'WAIC 券商 Skill 长文无关。'.repeat(80)}`,
  );
  const user = assembled.messages[1].content;
  check('goal_in_prompt', user.includes('Aivestor') && /# 任务/.test(user), {
    preview: user.slice(0, 200),
  });
  check('rejection_in_prompt', user.includes(rejectReason), {});
  check('revision_in_prompt', user.includes(reviseReq), {});
  check('materials_not_answer_contract', /不得整篇当作答案|不得自动成为最终答案/.test(assembled.messages[0].content + user), {});
  check(
    'relevant_material_before_unrelated',
    user.indexOf('aivestor.md') < user.indexOf('waic.md'),
    {},
  );

  // --- Outcome：主题错误不得 pass ---
  const bad = checkOutcome({
    goal,
    text: `# WAIC\n\n${'券商 Skill。'.repeat(200)}`,
  });
  check('outcome_rejects_wrong_theme', bad.verdict !== 'pass', { defects: bad.defects });

  // --- Runtime：首轮 Fake 必须含 Aivestor；修订必须新调用且正文变化 ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-tiri-'));
  /** @type {object[]} */
  const calls = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      onExecute: (info) => {
        calls.push({
          goal: info.input.goal,
          hasRevision: !!info.input.revision,
          rejectionReason: info.input.revision && info.input.revision.rejectionReason,
          revisionRequest: info.input.revision && info.input.revision.request,
          textPreview: String(info.text || '').slice(0, 120),
          chars: String(info.text || '').replace(/\s+/g, '').length,
        });
      },
    },
  });
  await runtime.createPackage({
    displayName: 'TIRI',
    targetDir: path.join(root, 'pkg'),
    initialSelfDescription: '任务指令完整性验收',
  });

  const matDir = path.join(root, 'materials');
  fs.mkdirSync(matDir, { recursive: true });
  fs.writeFileSync(
    path.join(matDir, 'aivestor-notes.md'),
    'Aivestor 产品定位：智能投资助手。目标用户：个人投资者。核心能力：组合分析。应用价值：提升决策效率。\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(matDir, 'waic-unrelated.md'),
    `${'这是一篇完整的 WAIC 券商 Skill 介绍文章，与 Aivestor 无关。'.repeat(40)}\n`,
    'utf8',
  );

  const submitted = await runtime.submitTask({
    goal,
    contextRefs: [{ kind: 'folder', path: matDir }],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 60000);
  check('first_job_succeeded', job1.status === 'succeeded', { status: job1.status, failure: job1.failure });
  const art1Meta = await runtime.getArtifact(job1.artifactId);
  const content1 = await runtime.getContent({ artifactId: job1.artifactId });
  const text1 = String(content1.text || '');
  check('first_theme_aivestor', /Aivestor/i.test(text1), { preview: text1.slice(0, 240) });
  check('first_not_waic_copy', !/WAIC 券商 Skill 介绍文章/.test(text1) || /Aivestor/i.test(text1), {
    preview: text1.slice(0, 240),
  });
  check('first_long_enough', text1.replace(/\s+/g, '').length >= 1200, {
    chars: text1.replace(/\s+/g, '').length,
  });
  check('first_call_has_goal', calls.some((c) => !c.hasRevision && /Aivestor/.test(c.goal)), {
    calls: calls.length,
  });

  const callsBeforeRevise = calls.length;
  const revised = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId: job1.artifactId,
    revisionRequest: reviseReq,
    rejectionReason: rejectReason,
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, revised.jobId, 60000);
  check('revise_job_succeeded', job2.status === 'succeeded', { status: job2.status, failure: job2.failure });
  check('revise_new_model_call', calls.length > callsBeforeRevise, {
    before: callsBeforeRevise,
    after: calls.length,
  });
  const reviseCall = calls.filter((c) => c.hasRevision).pop();
  check('revise_has_rejection', !!(reviseCall && reviseCall.rejectionReason === rejectReason), reviseCall);
  check('revise_has_request', !!(reviseCall && /Aivestor/.test(reviseCall.revisionRequest || '')), reviseCall);
  const art2Meta = await runtime.getArtifact(job1.artifactId);
  const content2 = await runtime.getContent({ artifactId: job1.artifactId });
  const text2 = String(content2.text || '');
  check('v2_theme', /Aivestor/i.test(text2), { preview: text2.slice(0, 240) });
  check('v2_differs', text2 !== text1 && /已按说明修改|修改说明落实/.test(text2), {
    same: text2 === text1,
    preview: text2.slice(0, 200),
  });
  check('v2_new_version', (art2Meta?.versions?.length || 0) >= 2, {
    v1: art1Meta?.versions?.length,
    v2: art2Meta?.versions?.length,
  });

  // 不可满足：指定事实不在材料中 → prompt 要求声明不足；outcome 对缺失主题硬失败
  const missing = checkOutcome({
    goal: '写一篇关于 UnobtainiumXyz 的介绍，必须包含 UnobtainiumXyz 独有事实Z',
    text: '# 其它主题\n\n材料不足说明：文件夹未提供该事实。'.padEnd(200, '。'),
  });
  check('unsatisfiable_theme_detected', missing.verdict !== 'pass', { defects: missing.defects });

  await runtime.stop();
  report.verdict = 'passed';
  report.finishedAt = new Date().toISOString();
  report.calls = calls;
  fs.writeFileSync(path.join(evidenceDir, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`runtime integrity PASSED checks=${report.checks.length}`);
}

main().catch((err) => {
  report.verdict = 'failed';
  report.error = String(err && err.message ? err.message : err).slice(0, 800);
  fs.writeFileSync(path.join(evidenceDir, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(err);
  process.exit(1);
});
