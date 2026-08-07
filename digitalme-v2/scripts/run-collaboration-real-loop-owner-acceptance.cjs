/**
 * DIGITALME-V2-COLLABORATION-REAL-LOOP-01-OWNER-ACCEPTANCE
 * 双独立可持久化 SubjectPackage；走拒绝→接受→履约→修订→采用→重启。
 * 不预注入协作结果；不新增产品功能；不 commit / 不 push。
 *
 * 用法:
 *   npm run accept:collaboration-real-loop-owner
 *   npm run accept:collaboration-real-loop-owner -- --force-fake
 *   npm run accept:collaboration-real-loop-owner -- --resume-session "<sessionRoot>"
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
process.chdir(root);

const evidenceDir = path.join(root, 'scripts', '_collaboration-real-loop-01-evidence');
const acceptanceRoot = path.join(os.homedir(), 'AppData', 'Local', 'DigitalMe-OwnerAcceptance');

function writeJson(name, data) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeText(name, text) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), text.endsWith('\n') ? text : `${text}\n`, 'utf8');
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
    const sessionRoot = path.resolve(resume);
    return {
      fresh: false,
      stamp,
      sessionId: path.basename(sessionRoot),
      sessionRoot,
      userDataA: path.join(sessionRoot, 'subject-a'),
      userDataB: path.join(sessionRoot, 'subject-b'),
      forceFake,
    };
  }
  const sessionId = `collaboration-real-loop-01-${stamp}`;
  const sessionRoot = path.join(acceptanceRoot, sessionId);
  return {
    fresh: true,
    stamp,
    sessionId,
    sessionRoot,
    userDataA: path.join(sessionRoot, 'subject-a'),
    userDataB: path.join(sessionRoot, 'subject-b'),
    forceFake,
  };
}

function pkgDirOf(userData) {
  return path.join(userData, 'subjects', 'default');
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

function createRuntime(opts) {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  if (opts.real) {
    return createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: {
        baseUrl: opts.real.cred.baseUrl,
        model: opts.real.cred.model,
        ...(opts.real.cred.providerId ? { providerId: opts.real.cred.providerId } : {}),
        ...(opts.real.cred.apiKey ? { apiKey: opts.real.cred.apiKey } : {}),
        displayName: '真实对话模型',
        timeoutMs: 240_000,
      },
      secrets: opts.real.secrets,
      codeAnalysisCapability: 'needs_setup',
    });
  }
  return createDigitalMeRuntime({ documentCapability: 'fake', codeAnalysisCapability: 'needs_setup' });
}

async function ensurePackage(runtime, pkgDir, displayName, selfDesc, fresh) {
  fs.mkdirSync(pkgDir, { recursive: true });
  if (fresh || !fs.existsSync(path.join(pkgDir, 'manifest.json'))) {
    await runtime.createPackage({
      displayName,
      targetDir: pkgDir,
      initialSelfDescription: selfDesc,
    });
    return 'created';
  }
  await runtime.openPackage({ dir: pkgDir });
  return 'opened';
}

function hasInternalJargon(text) {
  return /CollaborationRecord|\bGrant\b|event type|SubjectPackage|\bprotocol\b|recordId|GrowthEvent|provenance|transport/i.test(
    String(text || ''),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.sessionRoot, { recursive: true });
  fs.mkdirSync(args.userDataA, { recursive: true });
  fs.mkdirSync(args.userDataB, { recursive: true });

  const pkgA = pkgDirOf(args.userDataA);
  const pkgB = pkgDirOf(args.userDataB);
  const materialsDir = path.join(args.sessionRoot, 'materials');
  fs.mkdirSync(materialsDir, { recursive: true });
  const materialPath = path.join(materialsDir, 'digital-me-project-notes.md');
  if (!fs.existsSync(materialPath)) {
    fs.writeFileSync(
      materialPath,
      [
        '# Digital Me 项目材料（Owner 验收）',
        '',
        '产品主张：本地优先的个人数字主体，能代表我做事，也能与其他数字之我协作。',
        '协作只处理需要双方判断与约定的关系；固定接口与已注册专业能力不属于协作。',
        '用户界面应使用自然语言，说明谁在找我、要做什么、我现在该决定什么。',
        '学习结果分别留在各自主体内，不可混成一份共享记忆。',
        '当前优先验证方向：真实用户体验、主体独立性、少确认负担、重启后事实仍在。',
      ].join('\n'),
      'utf8',
    );
  }

  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (build.status !== 0) process.exit(build.status || 1);

  const real = args.forceFake ? null : await tryRealModel();
  const documentMode = real ? 'openai-compatible' : 'fake-owner-path';

  const { createCommandBus } = require('../dist/runtime/command-bus');
  const { CollaborationRecordStore } = require('../dist/collaboration/record-store');
  const { GrantStore } = require('../dist/collaboration/grant-store');
  const { latestGrantId, deriveCollabStatus } = require('../dist/collaboration/record-derive');

  const judgment = {
    schemaVersion: 'collaboration-real-loop-owner-acceptance/1',
    task: 'DIGITALME-V2-COLLABORATION-REAL-LOOP-01-OWNER-ACCEPTANCE',
    startedAt: new Date().toISOString(),
    head: 'e4f3f4d36a9e0d43cf4e67e44ec5e7d57e2b9b33',
    branch: 'v2/foundation',
    sessionRoot: args.sessionRoot,
    sessionId: args.sessionId,
    userDataA: args.userDataA,
    userDataB: args.userDataB,
    packageA: pkgA,
    packageB: pkgB,
    materialPath,
    documentMode,
    rejectPath: {},
    acceptPath: {},
    revisionAdopt: {},
    restart: {},
    growth: {},
    subjectFeel: {},
    blockers: [],
    verdict: 'pending',
  };

  writeJson('owner-launch.json', {
    launchedAt: new Date().toISOString(),
    sessionRoot: args.sessionRoot,
    packageA: pkgA,
    packageB: pkgB,
    materialPath,
    documentMode,
    startA: `node scripts/start-collaboration-real-loop-owner-electron.cjs --subject a --resume-session "${args.sessionRoot}"`,
    startB: `node scripts/start-collaboration-real-loop-owner-electron.cjs --subject b --resume-session "${args.sessionRoot}"`,
    resumeHint: `npm run accept:collaboration-real-loop-owner -- --resume-session "${args.sessionRoot}"`,
  });

  let runtimeA = createRuntime({ real });
  let busA = createCommandBus(runtimeA);
  await ensurePackage(
    runtimeA,
    pkgA,
    '我的 Digital Me',
    '我发起协作并验收成果，关注普通用户实际体验。',
    args.fresh,
  );

  let runtimeB = createRuntime({ real });
  let busB = createCommandBus(runtimeB);
  await ensurePackage(
    runtimeB,
    pkgB,
    '另一个 Digital Me',
    '我独立评估是否承接协作，并完成分析。',
    args.fresh,
  );
  // B 先关闭，避免与 A propose 时 sibling open 争用；后续按需 reopen
  await runtimeB.stop();

  // -------- 拒绝路径 --------
  const rejectPropose = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: pkgB,
    intent:
      '请帮我根据这些 Digital Me 项目材料，整理出三个当前最值得优先验证的产品风险，并说明理由。',
    expectedOutcome: '三个产品风险与理由',
    allowedMaterialPaths: [materialPath],
    acceptanceCriteria: ['列出三个风险', '每条附理由', '面向普通用户体验'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  if (rejectPropose.status !== 'proposed' || rejectPropose.grantId) {
    judgment.blockers.push('reject_propose_auto_authorized');
  }

  runtimeB = createRuntime({ real });
  busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: pkgB });
  const listedBReject = await busB.invoke('collab.interact', { action: 'list' });
  const inboundReject = (listedBReject.items || []).find(
    (i) => i.recordId === rejectPropose.recordId,
  );
  const rejectRespond = await busB.invoke('collab.interact', {
    action: 'respond',
    recordId: rejectPropose.recordId,
    decision: 'reject',
    note: '这次先不承接',
  });
  const rejectRecB = await (await CollaborationRecordStore.open(pkgB)).get(rejectPropose.recordId);
  const rejectRecA = await (await CollaborationRecordStore.open(pkgA)).get(rejectPropose.recordId);
  const grantsBAfterReject = await (await GrantStore.open(pkgB)).list();
  const grantForReject = grantsBAfterReject.some(
    (g) => g.origin && g.origin.kind === 'collaboration_agreement' && g.origin.recordId === rejectPropose.recordId,
  );
  const listedAReject = await busA.invoke('collab.interact', { action: 'list' });
  const aSeesReject = (listedAReject.items || []).find((i) => i.recordId === rejectPropose.recordId);

  judgment.rejectPath = {
    recordId: rejectPropose.recordId,
    bSawInbound: !!inboundReject,
    bRole: inboundReject && inboundReject.role,
    bStatusBefore: inboundReject && inboundReject.status,
    peerDisplayName: inboundReject && inboundReject.peerDisplayName,
    goalVisible: !!(inboundReject && inboundReject.subtaskGoal),
    materialsVisible: !!(inboundReject && (inboundReject.allowedMaterials || []).length),
    respondStatus: rejectRespond.status,
    aSeesRejected: !!(aSeesReject && aSeesReject.status === 'rejected'),
    // 相对本条协作：拒绝不得签发 Grant / 不得产生履约 Task（允许会话内已有其他协作）
    noGrant: !rejectRespond.grantId && !latestGrantId(rejectRecB || { events: [] }) && !grantForReject,
    noTask: !(rejectRecB && rejectRecB.events.some((e) => e.taskId || e.jobId)),
    noInternalJargonInGoal: !hasInternalJargon(inboundReject && inboundReject.subtaskGoal),
    passed: false,
  };
  judgment.rejectPath.passed =
    judgment.rejectPath.bSawInbound &&
    judgment.rejectPath.bRole === 'responder' &&
    judgment.rejectPath.respondStatus === 'rejected' &&
    judgment.rejectPath.aSeesRejected &&
    judgment.rejectPath.noGrant &&
    judgment.rejectPath.noTask &&
    judgment.rejectPath.noInternalJargonInGoal;
  if (!judgment.rejectPath.passed) judgment.blockers.push('reject_path_failed');
  await runtimeB.stop();

  // -------- 接受 → 履约 --------
  const acceptPropose = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: pkgB,
    intent:
      '请帮我根据这些 Digital Me 项目材料，整理出三个当前最值得优先验证的产品风险，并说明理由。',
    expectedOutcome: '三个产品风险与理由',
    allowedMaterialPaths: [materialPath],
    acceptanceCriteria: ['列出三个风险', '每条附理由', '面向普通用户体验'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  if (acceptPropose.status !== 'proposed') {
    judgment.blockers.push('accept_propose_not_pending');
  }

  runtimeB = createRuntime({ real });
  busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: pkgB });
  const tasksBeforeAccept = await runtimeB.listTasks({ limit: 20 });
  const acceptRespond = await busB.invoke('collab.interact', {
    action: 'respond',
    recordId: acceptPropose.recordId,
    decision: 'accept',
    note: '可以承接这次产品风险整理',
  });
  const tasksAfterAcceptBeforeFulfill = await runtimeB.listTasks({ limit: 20 });
  const noAutoWork =
    (tasksAfterAcceptBeforeFulfill.tasks || []).length === (tasksBeforeAccept.tasks || []).length;

  const grantA = acceptRespond.grantId
    ? await (await GrantStore.open(pkgA)).get(acceptRespond.grantId)
    : null;
  const grantB = acceptRespond.grantId
    ? await (await GrantStore.open(pkgB)).get(acceptRespond.grantId)
    : null;

  const fulfilled = await busB.invoke('collab.interact', {
    action: 'fulfill',
    recordId: acceptPropose.recordId,
  });
  const artText = String(fulfilled.artifactText || '');
  let artOnA = null;
  if (fulfilled.localArtifactId) {
    artOnA = await runtimeA.getContent({ artifactId: fulfilled.localArtifactId });
  }

  judgment.acceptPath = {
    recordId: acceptPropose.recordId,
    grantId: acceptRespond.grantId || null,
    acceptStatus: acceptRespond.status,
    noAutoWorkAfterAccept: noAutoWork,
    grantOnA: !!(grantA && grantA.status === 'granted'),
    grantOnB: !!(grantB && grantB.status === 'granted'),
    grantOriginAgreement: !!(grantA && grantA.origin && grantA.origin.kind === 'collaboration_agreement'),
    fulfillStatus: fulfilled.status,
    hasArtifactText: artText.length >= 40,
    artifactOnA: !!(artOnA && artOnA.text),
    provenanceCollab: !!(artOnA && artOnA.artifact && artOnA.artifact.provenance),
    passed: false,
  };
  judgment.acceptPath.passed =
    ['authorized', 'agreed'].includes(String(acceptRespond.status)) &&
    !!acceptRespond.grantId &&
    judgment.acceptPath.noAutoWorkAfterAccept &&
    judgment.acceptPath.grantOnA &&
    judgment.acceptPath.grantOnB &&
    fulfilled.status === 'delivered' &&
    judgment.acceptPath.hasArtifactText &&
    judgment.acceptPath.artifactOnA;
  if (!judgment.acceptPath.passed) judgment.blockers.push('accept_fulfill_failed');

  // -------- 修订 → 采用 --------
  const revised = await busA.invoke('collab.interact', {
    action: 'requestRevision',
    recordId: acceptPropose.recordId,
    note: '风险描述太偏技术，请更关注普通用户实际体验。',
  });
  const afterRev =
    revised.localArtifactId &&
    (await runtimeA.getContent({ artifactId: revised.localArtifactId }));
  const decided = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: acceptPropose.recordId,
    decision: 'accept',
    note: '修订后可采用',
  });
  const recSameLineage = await (await CollaborationRecordStore.open(pkgA)).get(
    acceptPropose.recordId,
  );
  const hasRevisionEvent = !!(
    recSameLineage &&
    recSameLineage.events.some((e) => e.kind === 'revision_requested')
  );

  judgment.revisionAdopt = {
    sameRecordId: acceptPropose.recordId,
    reviseStatus: revised.status,
    versionsAtLeast2: !!(afterRev && afterRev.artifact && afterRev.artifact.versions.length >= 2),
    hasRevisionEvent,
    decideStatus: decided.status,
    passed: false,
  };
  judgment.revisionAdopt.passed =
    judgment.revisionAdopt.hasRevisionEvent &&
    judgment.revisionAdopt.versionsAtLeast2 &&
    decided.status === 'completed';
  if (!judgment.revisionAdopt.passed) judgment.blockers.push('revision_adopt_failed');

  // -------- 成长轻量 --------
  const growthA = await runtimeA.subject.listGrowthEvents();
  await runtimeB.stop();
  runtimeB = createRuntime({ real });
  await runtimeB.openPackage({ dir: pkgB });
  const growthB = await runtimeB.subject.listGrowthEvents();
  const aTags = growthA.flatMap((e) => e.payload.tags || []);
  const bTags = growthB.flatMap((e) => e.payload.tags || []);
  const aAdopt = growthA.filter((e) => (e.payload.tags || []).includes('collab:external_accept'));
  const bFulfilled = growthB.filter((e) => (e.payload.tags || []).includes('collab:fulfilled'));
  const bPeerAccept = growthB.filter((e) =>
    (e.payload.tags || []).includes('collab:accepted_by_peer'),
  );
  judgment.growth = {
    aHasAdoptExperience: aAdopt.length >= 1,
    bHasFulfillExperience: bFulfilled.length >= 1,
    bHasPeerAccept: bPeerAccept.length >= 1,
    aDoesNotHaveBFulfillTag: !aTags.includes('collab:fulfilled'),
    bDoesNotHaveAAdoptTag: !bTags.includes('collab:external_accept'),
    sampleA: aAdopt[0] ? String(aAdopt[0].payload.detail || aAdopt[0].payload.title || '').slice(0, 200) : '',
    sampleB: bFulfilled[0]
      ? String(bFulfilled[0].payload.detail || bFulfilled[0].payload.title || '').slice(0, 200)
      : '',
    passed: false,
  };
  judgment.growth.passed =
    judgment.growth.aHasAdoptExperience &&
    judgment.growth.bHasFulfillExperience &&
    judgment.growth.aDoesNotHaveBFulfillTag &&
    judgment.growth.bDoesNotHaveAAdoptTag;
  if (!judgment.growth.passed) judgment.blockers.push('growth_not_independent');
  await runtimeB.stop();
  await runtimeA.stop();

  // -------- 重启 --------
  runtimeA = createRuntime({ real });
  busA = createCommandBus(runtimeA);
  await runtimeA.openPackage({ dir: pkgA });
  runtimeB = createRuntime({ real });
  busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: pkgB });

  const listA2 = await busA.invoke('collab.interact', { action: 'list' });
  const listB2 = await busB.invoke('collab.interact', { action: 'list' });
  const rowA = (listA2.items || []).find((i) => i.recordId === acceptPropose.recordId);
  const rowB = (listB2.items || []).find((i) => i.recordId === acceptPropose.recordId);
  const grantsA2 = await (await GrantStore.open(pkgA)).list();
  const grantsB2 = await (await GrantStore.open(pkgB)).list();
  const recordsA2 = await (await CollaborationRecordStore.open(pkgA)).list();
  const recordsB2 = await (await CollaborationRecordStore.open(pkgB)).list();

  judgment.restart = {
    aSeesCompleted: !!(rowA && rowA.status === 'completed'),
    bSeesCompleted: !!(rowB && rowB.status === 'completed'),
    sameRecordId: !!(rowA && rowB && rowA.recordId === rowB.recordId),
    aRole: rowA && rowA.role,
    bRole: rowB && rowB.role,
    noDuplicateNewGrantBurst: grantsA2.length <= 8 && grantsB2.length <= 8,
    bothHaveRecordCopy: recordsA2.some((r) => r.recordId === acceptPropose.recordId) &&
      recordsB2.some((r) => r.recordId === acceptPropose.recordId),
    userFacingStatusA: rowA ? String(rowA.status) : '',
    userFacingStatusB: rowB ? String(rowB.status) : '',
    passed: false,
  };
  judgment.restart.passed =
    judgment.restart.aSeesCompleted &&
    judgment.restart.bSeesCompleted &&
    judgment.restart.sameRecordId &&
    judgment.restart.aRole === 'initiator' &&
    judgment.restart.bRole === 'responder' &&
    judgment.restart.bothHaveRecordCopy;
  if (!judgment.restart.passed) judgment.blockers.push('restart_failed');

  // -------- 主体感（结构证据；目视由 Electron 补充）--------
  judgment.subjectFeel = {
    notCapabilityCall: true,
    bHadIndependentRejectThenAccept: judgment.rejectPath.passed && judgment.acceptPath.passed,
    aCouldTrackStatus: !!rowA,
    revisionSameLineage: judgment.revisionAdopt.passed,
    noInternalJargonInListLabels: !hasInternalJargon(
      [rowA && rowA.subtaskGoal, rowA && rowA.peerDisplayName, rowB && rowB.peerDisplayName]
        .filter(Boolean)
        .join('\n'),
    ),
    feelsLikeSubjectCollaboration:
      judgment.rejectPath.passed &&
      judgment.acceptPath.noAutoWorkAfterAccept &&
      judgment.acceptPath.passed &&
      judgment.revisionAdopt.passed,
    ownerVisualRequired: true,
    note:
      '结构上已证明 B 可拒绝/接受且接受前不自动干活；请用双窗口 Electron 目视确认“像主体协作”。',
  };

  const allPass =
    judgment.rejectPath.passed &&
    judgment.acceptPath.passed &&
    judgment.revisionAdopt.passed &&
    judgment.growth.passed &&
    judgment.restart.passed &&
    judgment.blockers.length === 0;

  judgment.verdict = allPass ? 'owner_path_passed' : 'owner_path_blocked';
  judgment.finishedAt = new Date().toISOString();

  await runtimeA.stop();
  await runtimeB.stop();

  writeJson('owner-judgment.json', judgment);

  const checklist = `# COLLABORATION-REAL-LOOP-01 Owner 验收结果

- sessionRoot: \`${args.sessionRoot}\`
- package A: \`${pkgA}\`
- package B: \`${pkgB}\`
- documentMode: \`${documentMode}\`
- verdict: **${judgment.verdict}**
- finishedAt: ${judgment.finishedAt}

## 双主体启动（目视）

\`\`\`
cd digitalme-v2
node scripts/start-collaboration-real-loop-owner-electron.cjs --subject a --resume-session "${args.sessionRoot}"
node scripts/start-collaboration-real-loop-owner-electron.cjs --subject b --resume-session "${args.sessionRoot}"
\`\`\`

A 协作页选择 B 包目录：\`${pkgB}\`
材料：\`${materialPath}\`

## 拒绝路径
- 通过: ${judgment.rejectPath.passed ? '是' : '否'}
- B 看到来自对方: ${judgment.rejectPath.bSawInbound}
- 拒绝后 A 可见未接受: ${judgment.rejectPath.aSeesRejected}
- 无 Grant: ${judgment.rejectPath.noGrant}
- 无 Task: ${judgment.rejectPath.noTask}

## 接受 → 履约
- 通过: ${judgment.acceptPath.passed ? '是' : '否'}
- 接受后未自动开跑: ${judgment.acceptPath.noAutoWorkAfterAccept}
- 双边 Grant: ${judgment.acceptPath.grantOnA && judgment.acceptPath.grantOnB}
- 成果回到 A: ${judgment.acceptPath.artifactOnA}

## 修订 → 采用
- 通过: ${judgment.revisionAdopt.passed ? '是' : '否'}
- 同一次协作: ${judgment.revisionAdopt.hasRevisionEvent}
- 版本追加: ${judgment.revisionAdopt.versionsAtLeast2}
- 采用完成: ${judgment.revisionAdopt.decideStatus}

## 重启
- 通过: ${judgment.restart.passed ? '是' : '否'}
- A/B 均见已完成: ${judgment.restart.aSeesCompleted && judgment.restart.bSeesCompleted}
- 同 recordId: ${judgment.restart.sameRecordId}

## 成长（轻量）
- 通过: ${judgment.growth.passed ? '是' : '否'}
- A 样例: ${judgment.growth.sampleA || '—'}
- B 样例: ${judgment.growth.sampleB || '—'}

## 主体感（结构）
- 像主体协作（结构）: ${judgment.subjectFeel.feelsLikeSubjectCollaboration ? '是' : '否'}
- Owner 目视仍建议执行: 是

## Blockers
${judgment.blockers.length ? judgment.blockers.map((b) => `- ${b}`).join('\n') : '- （无）'}
`;

  writeText('OWNER_CHECKLIST.md', checklist);
  writeText(
    'OWNER_RESULT.md',
    [
      `# Owner 验收结论`,
      ``,
      `- verdict: **${judgment.verdict}**`,
      `- sessionRoot: \`${args.sessionRoot}\``,
      `- documentMode: \`${documentMode}\``,
      ``,
      `详细见 OWNER_CHECKLIST.md / owner-judgment.json`,
    ].join('\n'),
  );

  console.log(
    JSON.stringify(
      {
        verdict: judgment.verdict,
        sessionRoot: args.sessionRoot,
        documentMode,
        blockers: judgment.blockers,
        startA: `node scripts/start-collaboration-real-loop-owner-electron.cjs --subject a --resume-session "${args.sessionRoot}"`,
        startB: `node scripts/start-collaboration-real-loop-owner-electron.cjs --subject b --resume-session "${args.sessionRoot}"`,
      },
      null,
      2,
    ),
  );

  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
