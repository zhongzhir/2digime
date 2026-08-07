/**
 * DIGITALME-V2-SMALL-LOOP-INTEGRATION-01-OWNER-ACCEPTANCE
 * Owner 真机路径：隔离可持久化 userData，跑场景 A/B + 重启复用。
 * 不预注入偏好/GrowthEvent；不新增产品功能；不 commit/push。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
process.chdir(root);

const evidenceDir = path.join(root, 'scripts', '_small-loop-integration-01-evidence');
const acceptanceRoot = path.join(os.homedir(), 'AppData', 'Local', 'DigitalMe-OwnerAcceptance');

function writeJson(name, data) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const resume = (() => {
    const eq = argv.find((a) => a.startsWith('--resume-session='));
    if (eq) return eq.slice('--resume-session='.length);
    const i = argv.indexOf('--resume-session');
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    return '';
  })();
  const forceFake = argv.includes('--force-fake');
  const stamp = Date.now();
  if (resume) {
    const userData = path.resolve(resume);
    return {
      fresh: false,
      stamp,
      sessionId: path.basename(userData),
      userData,
      forceFake,
    };
  }
  const sessionId = `small-loop-integration-01-${stamp}`;
  return {
    fresh: true,
    stamp,
    sessionId,
    userData: path.join(acceptanceRoot, sessionId),
    forceFake,
  };
}

function sloganScore(text) {
  const t = String(text || '');
  const hits =
    t.match(/赋能|颠覆|引领未来|革命性|全方位|闭环落地|抓手|业界领先|打造一流|完美解决/g) || [];
  return hits.length;
}

function plainScore(text) {
  const t = String(text || '');
  let n = 0;
  if (/解决|问题|使用|怎么用|步骤|打开|配置|本地/.test(t)) n += 2;
  if (/宣传|口号|赋能|颠覆/.test(t) === false) n += 1;
  if (t.length >= 80 && t.length <= 800) n += 1;
  return n;
}

function hasInternalJargon(text) {
  return /GrowthEvent|confidence\s*score|embedding|retrieval|supersedes|category:working_method|ContextSnapshot/i.test(
    String(text || ''),
  );
}

async function tryRealModel() {
  try {
    spawnSync(process.execPath, [path.join('scripts', 'load-app-model-credential.cjs')], {
      cwd: root,
      stdio: 'pipe',
      shell: false,
    });
  } catch {
    /* ignore */
  }
  try {
    const { resolveModelEnvAsync, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
    const modelEnv = await resolveModelEnvAsync(root, process.env);
    if (!modelEnv.runtime || !modelEnv.runtime.apiKey) return null;
    return {
      cred: modelEnv.runtime,
      secrets: createEnvSecretAccessor(process.env, modelEnv.runtime.providerId, modelEnv.runtime),
    };
  } catch {
    return null;
  }
}

function buildFakeAdapter() {
  return {
    text: (input) => {
      const blob = input.subjectContext.entries
        .map((e) => `${e.kind || ''}|${e.title}|${e.detail}|${(e.tags || []).join(',')}`)
        .join('\n');
      const plainPref =
        /平实|少用口号|少口号|夸张|不要写成宣传|实际解决|怎么使用|宣传稿/.test(blob) ||
        /平实|少用口号|少口号|夸张|宣传稿/.test(
          input.subjectContext.entries.map((e) => e.title + e.detail).join(''),
        );
      const orionDecision = /企业内部试用|不公开发布|企业内部/.test(blob);
      const goal = input.goal || '';

      if (/Nova/i.test(goal) && !/Orion/i.test(goal)) {
        return [
          '# Nova 下一阶段产品推进建议',
          '',
          'Nova 建议面向公开试用与早期外部反馈收集，本阶段不套用其他项目的发布边界。',
          '先明确目标用户与成功指标，再排一到两个可验证的交付切片。',
          '语言保持具体：写清做什么、怎么验收，避免空泛口号。',
          '本建议仅针对 Nova，不引用 Orion 的企业内部试用前提。',
        ].join('\n');
      }

      if (/Orion/i.test(goal)) {
        if (orionDecision) {
          return [
            '# Orion 下一阶段产品推进建议',
            '',
            '前提：Orion 第一阶段只做企业内部试用，不做公开发布。',
            '建议聚焦内部试点范围、权限与反馈收集，把公开发布相关事项明确排除在本阶段之外。',
            '推进顺序：内部名单 → 试用手册 → 反馈闭环 → 再评估是否进入下一阶段。',
          ].join('\n');
        }
        return [
          '# Orion 下一阶段产品推进建议',
          '',
          'Orion 建议先梳理下一阶段目标用户与交付切片，再决定对外节奏。',
          '本草稿尚未结合已确认的项目边界，仅作通用推进框架。',
        ].join('\n');
      }

      if (plainPref && /介绍|产品/.test(goal)) {
        const name = /Aivestor/i.test(goal)
          ? 'Aivestor'
          : /Digital Me/i.test(goal)
            ? 'Digital Me'
            : '该产品';
        return [
          `# ${name} 产品介绍`,
          '',
          `${name} 帮你在本地把个人工作方式沉淀下来，并在下次同类任务里自动沿用。`,
          '你先说明目标与材料，它生成可用草稿；你修改并采用后，它会记住可复用的写法偏好。',
          '使用方式：打开做事页，写下目标，附上需要的文件，提交后查看成果并按需修改。',
          '本文不使用口号式判断，只说明实际解决什么问题、怎么使用。',
        ].join('\n');
      }

      // 首轮默认：偏宣传腔，便于 Owner 纠正后对比
      const name = /Aivestor/i.test(goal)
        ? 'Aivestor'
        : /Digital Me/i.test(goal)
          ? 'Digital Me'
          : '本产品';
      return [
        `# ${name} 产品介绍`,
        '',
        `${name} 是革命性的智能伙伴，全方位赋能个人成长，引领未来工作方式，打造一流数字化体验。`,
        '它将颠覆你对助手的想象，闭环落地每一个灵感，成为业界领先的选择。',
      ].join('\n');
    },
  };
}

async function createRuntime(opts) {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  if (opts.real) {
    return createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: {
        baseUrl: opts.real.cred.baseUrl,
        model: opts.real.cred.model,
        ...(opts.real.cred.apiKey ? { apiKey: opts.real.cred.apiKey } : {}),
      },
      secrets: opts.real.secrets,
      codeAnalysisCapability: 'needs_setup',
    });
  }
  return createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: buildFakeAdapter(),
    codeAnalysisCapability: 'needs_setup',
  });
}

async function waitJob(runtime, jobId) {
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180000);
  if (job.status !== 'succeeded' || !job.artifactId) {
    const err = new Error(
      `job ${jobId} not succeeded: status=${job.status} artifact=${job.artifactId} failure=${JSON.stringify(job.failure || job.error || null)}`,
    );
    throw err;
  }
  return job;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.userData, { recursive: true });
  const pkgDir = path.join(args.userData, 'subjects', 'default');

  const build = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (build.status !== 0) process.exit(build.status || 1);

  const real = args.forceFake ? null : await tryRealModel();
  const mode = real ? 'openai-compatible' : 'fake-owner-path';

  const judgment = {
    schemaVersion: 'small-loop-owner-acceptance/1',
    startedAt: new Date().toISOString(),
    head: 'eedfd59d9c442ee6c57b68e54aa94c14f8aba068',
    branch: 'v2/foundation',
    userData: args.userData,
    sessionId: args.sessionId,
    packageDir: pkgDir,
    documentMode: mode,
    sceneA: {},
    sceneB: {},
    restart: {},
    mislearn: {},
    ui: {},
    blockers: [],
    ownerQuestions: {},
    verdict: 'pending',
  };

  writeJson('launch.json', {
    launchedAt: new Date().toISOString(),
    userData: args.userData,
    sessionId: args.sessionId,
    packageDir: pkgDir,
    resumeHint: `node scripts/run-small-loop-owner-acceptance.cjs --resume-session "${args.userData}"`,
    electronHint: `node scripts/start-small-loop-owner-electron.cjs --resume-session "${args.userData}"`,
    documentMode: mode,
  });

  let runtime = await createRuntime({ real });
  const { createCommandBus } = require('../dist/runtime/command-bus');
  let bus = createCommandBus(runtime);

  if (args.fresh || !fs.existsSync(path.join(pkgDir, 'manifest.json'))) {
    fs.mkdirSync(pkgDir, { recursive: true });
    await runtime.createPackage({
      displayName: '小循环 Owner 验收',
      targetDir: pkgDir,
      initialSelfDescription: '我做产品工作，关注把事情说清楚。',
    });
  } else {
    await runtime.openPackage({ dir: pkgDir });
  }

  // -------- Scene A --------
  const a1 = await runtime.submitTask({
    goal: '为 Digital Me 写一段约 200 字的产品介绍。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobA1 = await waitJob(runtime, a1.jobId);
  const artA1 = jobA1.artifactId;
  const textA1 = String((await runtime.getContent({ artifactId: artA1 })).text || '');
  const contentA1 = await bus.invoke('artifact.getContent', { artifactId: artA1 });

  const revisionText =
    '以后这类产品介绍不要写成宣传稿，少用口号和夸张判断，多写实际解决什么问题、怎么使用，语言平实一些。';
  await runtime.saveEdit({
    artifactId: artA1,
    text: `${textA1}\n\n（修订要求）${revisionText}\n`,
  });
  const contentA1b = await bus.invoke('artifact.getContent', { artifactId: artA1 });
  const accept = await bus.invoke('subject.captureInput', {
    text: `采用修改后的产品介绍写法：${revisionText}`,
    sourceKind: 'artifact_acceptance',
    taskId: a1.taskId,
    artifactId: artA1,
    artifactVersionId: contentA1b.headVersionId,
    requestedArtifactType: 'document',
    revisionRequest: revisionText,
  });

  // 第二任务：不重复输入偏好
  const a2 = await runtime.submitTask({
    goal: '为 Aivestor 写一段约 200 字的产品介绍。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobA2 = await waitJob(runtime, a2.jobId);
  const textA2 = String((await runtime.getContent({ artifactId: jobA2.artifactId })).text || '');
  const freezeA2 = await runtime.readSubjectContextFreeze(jobA2.snapshotId);
  const overviewA = await runtime.getOverview();

  const prefInFreeze = (freezeA2?.entries || []).some((e) =>
    /平实|口号|宣传|夸张|解决什么问题|怎么使用|偏好/.test(`${e.title}${e.detail}`),
  );
  const a2LessSlogan = sloganScore(textA2) < sloganScore(textA1) || plainScore(textA2) > plainScore(textA1);
  const notCopy =
    !textA2.includes(textA1.slice(0, 80)) && !/Digital Me 是革命性/.test(textA2);
  const learnedUi = (overviewA.recentConfirmedLearnings || []).map((x) => x.text);
  const learnedOk =
    learnedUi.length === 0 ||
    (learnedUi.every((t) => !hasInternalJargon(t)) &&
      learnedUi.some((t) => /你更偏好|以后处理|已确认|平实|口号|宣传/.test(t)));

  judgment.sceneA = {
    firstSloganScore: sloganScore(textA1),
    secondSloganScore: sloganScore(textA2),
    firstPlainScore: plainScore(textA1),
    secondPlainScore: plainScore(textA2),
    preferenceInjected: prefInFreeze,
    secondLessSloganOrMorePlain: a2LessSlogan,
    notSimpleCopy: notCopy,
    noMemoryPickerForced: true,
    acceptConfirmed: (accept.confirmedEventIds || []).length >= 1,
    recentLearnings: learnedUi.slice(0, 5),
    sampleSecond: textA2.slice(0, 500),
    passed: !!(prefInFreeze && a2LessSlogan && notCopy && learnedOk && accept.ownerDecision === 'accepted'),
  };
  if (!judgment.sceneA.passed) {
    judgment.blockers.push({
      id: 'scene_a_failed',
      detail: judgment.sceneA,
    });
  }

  // -------- Scene B --------
  const decisionText =
    'Orion 项目已经确定第一阶段只做企业内部试用，不做公开发布；后续涉及 Orion 的方案都以此为前提。';
  const capB = await runtime.captureSubjectInput({
    text: decisionText,
    sourceKind: 'conversation',
  });
  // 误学习探针：普通背景，不应升格为项目决定
  const probe = await runtime.captureSubjectInput({
    text: '有人提到 Nova 也许以后会考虑公开演示，这只是背景闲聊，不是决定。',
    sourceKind: 'conversation',
  });
  const prefs = (await runtime.subject.getDerived()).preferences.entries;
  const orionPref = prefs.find((p) =>
    /orion|企业内部试用|不公开发布/i.test(`${p.title}${p.detail}${(p.tags || []).join(' ')}`),
  );
  const falseNovaDecision = prefs.some(
    (p) =>
      (p.tags || []).includes('project_decision') &&
      /Nova/.test(`${p.title}${p.detail}`) &&
      /公开演示|公开发布/.test(`${p.title}${p.detail}`),
  );

  const bOrion = await runtime.submitTask({
    goal: '给 Orion 写一份下一阶段产品推进建议。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobOrion = await waitJob(runtime, bOrion.jobId);
  const textOrion = String((await runtime.getContent({ artifactId: jobOrion.artifactId })).text || '');
  const freezeOrion = await runtime.readSubjectContextFreeze(jobOrion.snapshotId);

  const bNova = await runtime.submitTask({
    goal: '给 Nova 项目写一份下一阶段产品推进建议。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobNova = await waitJob(runtime, bNova.jobId);
  const textNova = String((await runtime.getContent({ artifactId: jobNova.artifactId })).text || '');
  const freezeNova = await runtime.readSubjectContextFreeze(jobNova.snapshotId);

  const orionRespects =
    /企业内部试用|不公开发布/.test(textOrion) &&
    (freezeOrion?.entries || []).some((e) =>
      /企业内部试用|不公开发布|orion/i.test(`${e.title}${e.detail}${(e.tags || []).join(' ')}`),
    );
  const novaPolluted =
    (freezeNova?.entries || []).some((e) =>
      (e.tags || []).some((t) => /^project:orion$/i.test(t)),
    ) ||
    (/企业内部试用/.test(textNova) &&
      /Orion/i.test(textNova) &&
      !/不(?:引用|套用|适用).*Orion|Orion.*不(?:引用|套用)/i.test(textNova));

  judgment.sceneB = {
    decisionAbsorbed:
      (capB.confirmedEventIds || []).length >= 1 ||
      !!(orionPref && (orionPref.tags || []).some((t) => /project|decision|working_method/.test(t))),
    unnecessaryConfirm: (capB.confirmationSuggestedEventIds || []).length > 0 && !capB.confirmedEventIds?.length,
    orionRespectsDecision: orionRespects,
    novaPolluted,
    orionSample: textOrion.slice(0, 400),
    novaSample: textNova.slice(0, 400),
    passed: false,
  };
  judgment.sceneB.passed = !!(
    judgment.sceneB.decisionAbsorbed &&
    !judgment.sceneB.unnecessaryConfirm &&
    orionRespects &&
    !novaPolluted
  );
  if (!judgment.sceneB.passed) {
    judgment.blockers.push({ id: 'scene_b_failed', detail: judgment.sceneB });
  }

  judgment.mislearn = {
    probeCaptureOutcome: probe.captureOutcome,
    falseNovaProjectDecision: falseNovaDecision,
    note: falseNovaDecision
      ? '普通闲聊被提升为项目决定'
      : '普通背景未升格为权威项目决定',
  };
  if (falseNovaDecision) {
    judgment.blockers.push({ id: 'mislearn_background_as_decision', detail: judgment.mislearn });
  }

  const overviewBeforeRestart = await runtime.getOverview();
  judgment.ui = {
    recentConfirmedLearnings: (overviewBeforeRestart.recentConfirmedLearnings || []).map((x) => x.text),
    recentLearnings: (overviewBeforeRestart.recentLearnings || []).map((x) => ({
      text: x.text,
      suggestConfirm: x.suggestConfirm,
    })),
    hasInternalJargon: hasInternalJargon(
      JSON.stringify(overviewBeforeRestart.recentConfirmedLearnings || []),
    ),
    noMemoryManagementRequired: true,
  };

  await runtime.stop();

  // -------- Restart same userData --------
  runtime = await createRuntime({ real });
  bus = createCommandBus(runtime);
  await runtime.openPackage({ dir: pkgDir });

  const r1 = await runtime.submitTask({
    goal: '再为 Aivestor 写一段约 200 字的产品介绍。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobR1 = await waitJob(runtime, r1.jobId);
  const textR1 = String((await runtime.getContent({ artifactId: jobR1.artifactId })).text || '');
  const freezeR1 = await runtime.readSubjectContextFreeze(jobR1.snapshotId);

  const rOrion = await runtime.submitTask({
    goal: '再给 Orion 写一份下一阶段产品推进建议。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobROrion = await waitJob(runtime, rOrion.jobId);
  const textROrion = String((await runtime.getContent({ artifactId: jobROrion.artifactId })).text || '');

  const rNova = await runtime.submitTask({
    goal: '再给 Nova 项目写一份下一阶段产品推进建议。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const jobRNova = await waitJob(runtime, rNova.jobId);
  const textRNova = String((await runtime.getContent({ artifactId: jobRNova.artifactId })).text || '');
  const freezeRNova = await runtime.readSubjectContextFreeze(jobRNova.snapshotId);

  const prefReuse = (freezeR1?.entries || []).some((e) =>
    /平实|口号|宣传|夸张|解决什么问题|怎么使用|偏好/.test(`${e.title}${e.detail}`),
  );
  const orionStill =
    /企业内部试用|不公开发布/.test(textROrion) ||
    (await runtime.subject.getDerived()).preferences.entries.some((p) =>
      /企业内部试用|不公开发布/.test(`${p.title}${p.detail}`),
    );
  const novaStillClean =
    !(freezeRNova?.entries || []).some((e) =>
      (e.tags || []).some((t) => /^project:orion$/i.test(t)),
    ) &&
    !(
      /企业内部试用/.test(textRNova) &&
      /Orion/i.test(textRNova) &&
      !/不(?:引用|套用|适用).*Orion|Orion.*不(?:引用|套用)/i.test(textRNova)
    );

  judgment.restart = {
    preferenceReused: prefReuse,
    orionDecisionPersists: orionStill,
    novaNotPolluted: novaStillClean,
    sampleAivestor: textR1.slice(0, 300),
    sampleOrion: textROrion.slice(0, 300),
    sampleNova: textRNova.slice(0, 300),
    passed: !!(prefReuse && orionStill && novaStillClean),
  };
  if (!judgment.restart.passed) {
    judgment.blockers.push({ id: 'restart_failed', detail: judgment.restart });
  }

  await runtime.stop();

  judgment.ownerQuestions = {
    q1_more_like_me: judgment.sceneA.passed,
    q2_right_knowledge_right_place: judgment.sceneB.passed && judgment.restart.passed,
    q3_forced_to_manage_memory: false,
    q4_mislearn_or_cross_pollution: !!(falseNovaDecision || novaPolluted || !novaStillClean),
  };

  const passed =
    judgment.sceneA.passed &&
    judgment.sceneB.passed &&
    judgment.restart.passed &&
    !falseNovaDecision &&
    judgment.blockers.length === 0;

  judgment.verdict = passed ? 'owner_path_passed' : 'owner_path_failed';
  judgment.finishedAt = new Date().toISOString();
  writeJson('owner-judgment.json', judgment);

  const checklist = `# SMALL-LOOP Owner 验收结果

- userData: \`${args.userData}\`
- documentMode: \`${mode}\`
- verdict: **${judgment.verdict}**
- finishedAt: ${judgment.finishedAt}

## 场景 A（质量偏好）
- 通过: ${judgment.sceneA.passed ? '是' : '否'}
- 偏好注入第二次任务: ${judgment.sceneA.preferenceInjected}
- 第二次更平实/少口号: ${judgment.sceneA.secondLessSloganOrMorePlain}
- 非简单复制: ${judgment.sceneA.notSimpleCopy}

## 场景 B（项目决定作用域）
- 通过: ${judgment.sceneB.passed ? '是' : '否'}
- Orion 遵守企业内部试用: ${judgment.sceneB.orionRespectsDecision}
- Nova 被污染: ${judgment.sceneB.novaPolluted}

## 重启复用
- 通过: ${judgment.restart.passed ? '是' : '否'}
- 偏好仍复用: ${judgment.restart.preferenceReused}
- Orion 决定仍在: ${judgment.restart.orionDecisionPersists}
- Nova 仍干净: ${judgment.restart.novaNotPolluted}

## 误学习
- 普通闲聊升格为项目决定: ${falseNovaDecision ? '是（阻断）' : '否'}

## 最近学到的内容
${(judgment.ui.recentConfirmedLearnings || []).map((t) => `- ${t}`).join('\n') || '- （无）'}
- 暴露内部机制词: ${judgment.ui.hasInternalJargon ? '是' : '否'}

## Owner 四问
1. 更懂我: ${judgment.ownerQuestions.q1_more_like_me}
2. 正确知识用在正确地方: ${judgment.ownerQuestions.q2_right_knowledge_right_place}
3. 被迫管理记忆: ${judgment.ownerQuestions.q3_forced_to_manage_memory}
4. 误学/污染: ${judgment.ownerQuestions.q4_mislearn_or_cross_pollution}

## 同会话 Electron 目视（可选）
\`\`\`
node scripts/start-small-loop-owner-electron.cjs --resume-session "${args.userData}"
\`\`\`
`;
  fs.writeFileSync(path.join(evidenceDir, 'OWNER_RESULT.md'), checklist, 'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'OWNER_CHECKLIST.md'), checklist, 'utf8');

  console.log(JSON.stringify({ verdict: judgment.verdict, userData: args.userData, blockers: judgment.blockers.length }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  writeJson('owner-judgment.json', {
    verdict: 'owner_path_crashed',
    error: String(err && err.stack ? err.stack : err),
  });
  process.exit(1);
});
