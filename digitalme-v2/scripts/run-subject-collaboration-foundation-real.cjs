/**
 * DIGITALME-V2-SUBJECT-COLLABORATION-FOUNDATION-01-REAL-VALIDATION
 * 真实模型 + 两个真实 SubjectPackage 纵向验收（16 项）。
 * 无凭证失败；不得 Fake 冒充。
 *
 * 用法: npm run accept:collaboration-real
 * 证据: scripts/_subject-collaboration-foundation-real-evidence/summary.json
 */
'use strict';

const { promises: fs } = require('node:fs');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const EVIDENCE_DIR = path.join(
  appRoot,
  'scripts',
  '_subject-collaboration-foundation-real-evidence',
);
const FAKE_NOTE =
  'Fake 自动化证据见 dist/collaboration/tests/subject-collaboration-foundation.test.js；本文件仅为真实模型证据。';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function digest(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadAppCredentialViaElectron() {
  if (process.env.DIGITALME_SKIP_APP_MODEL === '1') return;
  const script = path.join(appRoot, 'scripts', 'load-app-model-credential.cjs');
  const appDir = path.resolve(appRoot, '..', 'digitalme-app');
  try {
    await fs.access(script);
    await fs.access(path.join(appDir, 'package.json'));
  } catch {
    return;
  }
  let command;
  let args;
  let cwd = appRoot;
  try {
    const electronPath = require('electron');
    if (typeof electronPath !== 'string') throw new Error('bad electron');
    command = electronPath;
    args = [script];
  } catch {
    const electronCli = path.join(appDir, 'node_modules', 'electron', 'cli.js');
    try {
      await fs.access(electronCli);
      command = process.execPath;
      args = [electronCli, script];
      cwd = appDir;
    } catch {
      return;
    }
  }
  await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve();
    }, 20_000);
  });
}

function openaiOpts(modelEnv, secrets) {
  return {
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      displayName: '真实对话模型',
      timeoutMs: 240_000,
    },
    secrets,
    registerOpenAiStub: false,
  };
}

async function main() {
  fsSync.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const checks = {};
  const mark = (id, passed, detail) => {
    checks[id] = { ok: !!passed, ...(detail ? { detail } : {}) };
    if (!passed) throw new Error(`check failed: ${id}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
    ok(id);
  };

  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: appRoot });
  if (build.status !== 0) fail('build failed');

  await loadAppCredentialViaElectron();
  const {
    createDigitalMeRuntime,
  } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  const {
    resolveModelEnvAsync,
    createEnvSecretAccessor,
  } = require('../dist/infrastructure/env-secrets');
  const { CollaborationRecordStore } = require('../dist/collaboration/record-store');
  const { GrantStore } = require('../dist/collaboration/grant-store');
  const {
    findAgreement,
    termsDigestOf,
    latestTerms,
  } = require('../dist/collaboration/record-derive');
  const { OPENAI_COMPATIBLE_CAPABILITY_ID } = require('../dist/capability/adapters/openai-compatible');

  const modelEnv = await resolveModelEnvAsync(appRoot, process.env);
  if (!modelEnv.configured || !modelEnv.runtime || !modelEnv.runtime.apiKey) {
    fail('真实模型凭证未配置；拒绝 Fake 冒充');
  }
  const secrets = createEnvSecretAccessor(
    process.env,
    modelEnv.providerId,
    modelEnv.runtime,
  );
  const opts = openaiOpts(modelEnv, secrets);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-scf-real-'));
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const materials = path.join(root, 'materials');
  await fs.mkdir(materials, { recursive: true });

  const uniqueX = `青竹枢纽-${Date.now().toString(36)}`;
  const uniqueXToken = uniqueX.replace(/^青竹枢纽-/, '');
  const uniqueXPattern = new RegExp(`青竹枢纽[-－—（(]?${uniqueXToken}[）)]?`);
  const salaryToken = `薪酬密标-${Date.now().toString(36)}`;
  const reviseMarker = `修订锚点-${Date.now().toString(36)}`;

  const matOk = path.join(materials, 'brief.md');
  const matSalary = path.join(materials, 'salary.md');
  await fs.writeFile(
    matOk,
    [
      '# 协作材料（可授权）',
      '',
      `项目代号：${uniqueX}`,
      '主张：本地主体为权威，协作必须双方约定后授权，能力跟随任务。',
      '请据此整理可核对的问题/要点清单，并给出依据。',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    matSalary,
    [`# 薪酬材料`, '', `内部代号：${salaryToken}`, '张三年薪八十万，不得外传。'].join('\n'),
    'utf8',
  );

  // —— 创建两个真实 SubjectPackage ——
  const seedA = createDigitalMeRuntime(opts);
  const createdA = await seedA.createPackage({
    displayName: '真实协作甲',
    targetDir: dirA,
    initialSelfDescription: '我发起协作并验收对方成果。我的边界是不把对方当工具直接驱动。',
  });
  // A 故意写入一条与 B 不同的边界，用于证明评估不来自 A
  await seedA.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '甲的边界',
      detail: '不得删除本地全部数据',
      tags: ['boundary', 'owner-a-only'],
    },
  });
  const subjectIdA = createdA.subjectId || seedA.subject.requireActive().id;
  await seedA.stop();

  const seedB = createDigitalMeRuntime(opts);
  const createdB = await seedB.createPackage({
    displayName: '真实协作乙',
    targetDir: dirB,
    initialSelfDescription: '我按自己的规则评估协作并履行约定。',
  });
  await seedB.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '边界',
      detail: '不得分析薪酬数据相关材料',
      tags: ['boundary', 'owner-b-rule'],
    },
  });
  await seedB.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '工作方法',
      detail: '摘要先列问题清单再给依据，结论先行。',
      tags: ['working_method', 'owner-b-experience'],
    },
  });
  const subjectIdB = createdB.subjectId || seedB.subject.requireActive().id;
  await seedB.stop();

  const runtimeA = createDigitalMeRuntime(opts);
  const busA = createCommandBus(runtimeA);
  await runtimeA.openPackage({ dir: dirA });

  // —— 1+3 规则拒绝 ——
  const denied = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: `请分析这份薪酬材料并总结 ${salaryToken}`,
    expectedOutcome: '薪酬摘要',
    allowedMaterialPaths: [matSalary],
    acceptanceCriteria: ['列出薪酬要点'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  mark('01_rule_reject', denied.status === 'rejected', {
    status: denied.status,
    evaluationBasis: denied.evaluationBasis || [],
  });
  mark(
    '03_reject_uses_b_boundary',
    (denied.evaluationBasis || []).some((b) => String(b).startsWith('boundary:')),
    { evaluationBasis: denied.evaluationBasis || [] },
  );
  // 拒绝路径不得签发 Grant
  const denyRecordStore = await CollaborationRecordStore.open(dirA);
  const denyRecord = await denyRecordStore.get(denied.recordId);
  const denyHasGrant = (denyRecord?.events || []).some((e) => e.kind === 'grant_issued');
  mark('05a_no_grant_on_reject', !denyHasGrant && !denied.grantId, {
    recordId: denied.recordId,
    grantId: denied.grantId || null,
  });

  // —— 2+4+5 合规提议成约 ——
  const proposed = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: `根据材料整理 300–500 字核心观点摘要。必须提到项目代号 ${uniqueX}，先列要点再给依据。`,
    expectedOutcome: '可核对的要点摘要',
    allowedMaterialPaths: [matOk],
    acceptanceCriteria: ['提供可核对的完整成果，并说明依据', '提到项目代号'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  mark('04_compliant_agreement', !!proposed.recordId && !!proposed.grantId, {
    recordId: proposed.recordId,
    grantId: proposed.grantId,
    status: proposed.status,
  });

  const recordsA = await CollaborationRecordStore.open(dirA);
  const recordA = await recordsA.get(proposed.recordId);
  const recordsB = await CollaborationRecordStore.open(dirB);
  const recordB = await recordsB.get(proposed.recordId);
  const agreementA = findAgreement(recordA);
  const agreementB = findAgreement(recordB);
  mark(
    '04_same_terms_digest',
    !!agreementA?.termsDigest &&
      agreementA.termsDigest === agreementB?.termsDigest &&
      termsDigestOf(latestTerms(recordA)) === agreementA.termsDigest,
    {
      termsDigest: agreementA?.termsDigest || null,
      a: agreementA?.termsDigest || null,
      b: agreementB?.termsDigest || null,
    },
  );

  // Grant 仅在约定后：事件顺序 agreement_formed 先于 grant_issued
  const kinds = (recordA.events || []).map((e) => e.kind);
  const idxAgree = kinds.indexOf('agreement_formed');
  const idxGrant = kinds.indexOf('grant_issued');
  mark('05_grant_after_agreement', idxAgree >= 0 && idxGrant > idxAgree, {
    idxAgree,
    idxGrant,
  });

  const grantStore = await GrantStore.open(dirA);
  const grant = await grantStore.get(proposed.grantId);
  mark(
    '05_grant_origin_agreement',
    grant?.origin?.kind === 'collaboration_agreement' &&
      grant.origin.termsDigest === agreementA.termsDigest &&
      !grant.granteePackageDir &&
      !grant.returnedArtifact,
    {
      originKind: grant?.origin?.kind,
      termsDigest: grant?.origin?.termsDigest,
    },
  );

  // B 评估依据不含 A 的边界事件标签冒充
  const evalBasis = (proposed.evaluationBasis || []).join(' ');
  mark(
    '15_eval_not_from_a',
    !/owner-a-only|不得删除本地全部数据/.test(evalBasis) &&
      (proposed.evaluationBasis || []).some(
        (b) => /capability_count|within_autonomy|boundary:/.test(String(b)),
      ),
    { evaluationBasis: proposed.evaluationBasis || [] },
  );

  // —— 6 fulfill 真实模型 ——
  const fulfilled = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: proposed.recordId,
  });
  mark(
    '06_real_model_fulfill',
    fulfilled.status === 'delivered' &&
      fulfilled.reachedModel === true &&
      fulfilled.capabilityId === OPENAI_COMPATIBLE_CAPABILITY_ID &&
      (fulfilled.artifactText || '').length >= 200 &&
      uniqueXPattern.test(fulfilled.artifactText || '') &&
      !new RegExp(salaryToken).test(fulfilled.artifactText || '') &&
      !/FAKE_DOCUMENT|\[stub\]|lorem ipsum/i.test(fulfilled.artifactText || ''),
    {
      status: fulfilled.status,
      reason: fulfilled.reason || null,
      reachedModel: fulfilled.reachedModel,
      capabilityId: fulfilled.capabilityId,
      chars: (fulfilled.artifactText || '').length,
    },
  );

  const runtimeB = createDigitalMeRuntime(opts);
  await runtimeB.openPackage({ dir: dirB });
  const bTasks = await runtimeB.listTasks({ limit: 20 });
  mark('06_b_task_job_artifact', bTasks.tasks.length >= 1, {
    taskCount: bTasks.tasks.length,
  });
  const bTask = await runtimeB.getTask({ taskId: bTasks.tasks[0].taskId });
  mark(
    '06_b_authorization_grant',
    bTask.task.authorization?.grantId === proposed.grantId,
    { grantId: bTask.task.authorization?.grantId },
  );
  const bArtifactId = fulfilled.artifactId;
  const bContent = await runtimeB.getContent({ artifactId: bArtifactId });
  const bDigest = digest(bContent.text || '');
  mark(
    '06_b_full_artifact',
    (bContent.text || '').length >= 200 && bContent.artifact.headVersionId,
    {
      artifactId: bArtifactId,
      headVersionId: bContent.artifact.headVersionId,
      chars: (bContent.text || '').length,
      digestPrefix: bDigest.slice(0, 16),
    },
  );

  // —— 7 A 物化与 B 一致 ——
  const aLocalId = fulfilled.localArtifactId;
  const aLocal = await runtimeA.getContent({ artifactId: aLocalId });
  const aDigest = digest(aLocal.text || '');
  mark(
    '07_materialize_match',
    aLocal.artifact.provenance?.sourceArtifactId === bArtifactId &&
      aLocal.artifact.provenance?.sourceHeadVersionId === bContent.artifact.headVersionId &&
      aLocal.artifact.provenance?.sourceContentDigest === bDigest &&
      aDigest === bDigest &&
      aLocal.text === bContent.text &&
      aLocal.artifact.provenance?.agreementTermsDigest === agreementA.termsDigest,
    {
      localArtifactId: aLocalId,
      sourceArtifactId: aLocal.artifact.provenance?.sourceArtifactId,
      sourceHeadVersionId: aLocal.artifact.provenance?.sourceHeadVersionId,
      digestMatch: aDigest === bDigest,
      chars: (aLocal.text || '').length,
    },
  );
  mark(
    '14_no_excerpt_substitute',
    (aLocal.text || '').length > 800 || (aLocal.text || '').length === (bContent.text || '').length,
    {
      aChars: (aLocal.text || '').length,
      bChars: (bContent.text || '').length,
      note: '完整正文往返，非 Grant 摘录字段',
    },
  );
  await runtimeB.stop();

  // —— 8+9+10 修订 ——
  const revised = await busA.invoke('collab.interact', {
    action: 'requestRevision',
    recordId: proposed.recordId,
    note: `请在摘要开头用单独一行写上「${reviseMarker}」，并更强调本地主体权威与双方约定。`,
  });
  mark('08_revision_requested', revised.status === 'delivered' && !!revised.localArtifactId, {
    status: revised.status,
    localArtifactId: revised.localArtifactId,
  });
  mark(
    '09_revision_substantial',
    revised.localArtifactId === aLocalId &&
      (revised.artifactText || '').includes(reviseMarker) &&
      digest(revised.artifactText || '') !== aDigest &&
      (revised.artifactText || '').length >= 120,
    {
      containsMarker: (revised.artifactText || '').includes(reviseMarker),
      digestChanged: digest(revised.artifactText || '') !== aDigest,
      chars: (revised.artifactText || '').length,
    },
  );

  const aAfter = await runtimeA.getContent({ artifactId: aLocalId });
  mark(
    '10_version_provenance',
    aAfter.artifact.versions.length >= 2 &&
      aAfter.artifact.headVersionId !== aLocal.artifact.headVersionId &&
      aAfter.artifact.provenance?.sourceContentDigest === digest(revised.artifactText || '') &&
      aAfter.artifact.provenance?.agreementTermsDigest === agreementA.termsDigest,
    {
      versionCount: aAfter.artifact.versions.length,
      headBefore: aLocal.artifact.headVersionId,
      headAfter: aAfter.artifact.headVersionId,
      provenanceDigestPrefix: (aAfter.artifact.provenance?.sourceContentDigest || '').slice(0, 16),
    },
  );

  // —— 11 采用与双方 Growth ——
  const decided = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: proposed.recordId,
    decision: 'accept',
    note: '修订后可用，采用',
  });
  mark('11_accept', decided.status === 'completed', { status: decided.status });

  const growthA = await runtimeA.subject.listGrowthEvents();
  const acceptA = growthA.filter((e) =>
    (e.payload.tags || []).includes('collab:external_accept'),
  );
  mark('11_growth_a', acceptA.length >= 1, {
    count: acceptA.length,
    sampleTags: acceptA[0]?.payload?.tags || [],
  });

  const runtimeB2 = createDigitalMeRuntime(opts);
  await runtimeB2.openPackage({ dir: dirB });
  const growthB = await runtimeB2.subject.listGrowthEvents();
  const fulfilledB = growthB.filter((e) => (e.payload.tags || []).includes('collab:fulfilled'));
  const acceptedByPeer = growthB.filter((e) =>
    (e.payload.tags || []).includes('collab:accepted_by_peer'),
  );
  mark('11_growth_b', fulfilledB.length >= 1 && acceptedByPeer.length >= 1, {
    fulfilled: fulfilledB.length,
    acceptedByPeer: acceptedByPeer.length,
  });

  // B 包内边界/经验仍在（独立性）
  mark(
    '02_b_subject_rules_persist',
    growthB.some(
      (e) =>
        e.type === 'boundary_updated' &&
        (e.payload.detail || '').includes('薪酬') &&
        e.confidence === 'confirmed',
    ) &&
      growthB.some(
        (e) =>
          e.confidence === 'confirmed' &&
          (e.payload.tags || []).includes('owner-b-experience'),
      ),
    { bGrowthCount: growthB.length },
  );
  await runtimeB2.stop();

  // —— 13 幂等：重复对账 / 重复采用 ——
  await busA.invoke('collab.interact', {
    action: 'reconcile',
    recordId: proposed.recordId,
  });
  const againAccept = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: proposed.recordId,
    decision: 'accept',
  });
  const growthA2 = await runtimeA.subject.listGrowthEvents();
  const acceptA2 = growthA2.filter((e) =>
    (e.payload.tags || []).includes('collab:external_accept'),
  );
  mark(
    '13_idempotent_accept',
    againAccept.status === 'completed' && acceptA2.length === acceptA.length,
    {
      acceptEventsBefore: acceptA.length,
      acceptEventsAfter: acceptA2.length,
      status: againAccept.status,
    },
  );

  const againFulfill = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: proposed.recordId,
  });
  mark(
    '13_idempotent_delivery_safe',
    againFulfill.denied === true && /已验收|重复履行/.test(String(againFulfill.reason || '')),
    {
      againStatus: againFulfill.status,
      denied: againFulfill.denied || false,
      reason: againFulfill.reason || null,
    },
  );

  await runtimeA.stop();

  // —— 12 重启双包恢复 ——
  const runtimeA3 = createDigitalMeRuntime(opts);
  const busA3 = createCommandBus(runtimeA3);
  await runtimeA3.openPackage({ dir: dirA });
  const st = await busA3.invoke('collab.interact', {
    action: 'status',
    recordId: proposed.recordId,
  });
  mark('12_restart_a_status', st.status === 'completed' && st.termsDigest === agreementA.termsDigest, {
    status: st.status,
    termsDigest: st.termsDigest,
  });
  const grant2 = await (await GrantStore.open(dirA)).get(proposed.grantId);
  mark('12_restart_grant', !!grant2 && grant2.origin.kind === 'collaboration_agreement', {
    grantStatus: grant2?.status,
  });
  const artRestored = await runtimeA3.getContent({ artifactId: aLocalId });
  mark(
    '12_restart_artifact_versions',
    artRestored.artifact.versions.length >= 2 &&
      artRestored.artifact.provenance?.agreementTermsDigest === agreementA.termsDigest,
    {
      versions: artRestored.artifact.versions.length,
      head: artRestored.artifact.headVersionId,
    },
  );
  const growthA3 = await runtimeA3.subject.listGrowthEvents();
  mark(
    '12_restart_growth_a',
    growthA3.some((e) => (e.payload.tags || []).includes('collab:external_accept')),
    {},
  );
  await runtimeA3.stop();

  const runtimeB3 = createDigitalMeRuntime(opts);
  await runtimeB3.openPackage({ dir: dirB });
  const bTasks3 = await runtimeB3.listTasks({ limit: 20 });
  const bJobsOk = bTasks3.tasks.length >= 1;
  const growthB3 = await runtimeB3.subject.listGrowthEvents();
  mark(
    '12_restart_b',
    bJobsOk &&
      growthB3.some((e) => (e.payload.tags || []).includes('collab:fulfilled')) &&
      growthB3.some((e) => (e.payload.tags || []).includes('collab:accepted_by_peer')),
    {
      tasks: bTasks3.tasks.length,
      growth: growthB3.length,
    },
  );
  await runtimeB3.stop();

  // —— 16 无第二系统（静态+运行时） ——
  const hostSrc = await fs.readFile(
    path.join(appRoot, 'src', 'collaboration', 'local-collaboration.ts'),
    'utf8',
  );
  mark(
    '16_no_second_systems',
    /CollaborationRecordStore/.test(hostSrc) &&
      /materializePeerArtifact/.test(hostSrc) &&
      !/new TaskStore|SecondGrowth|ParallelArtifact/.test(hostSrc) &&
      fsSync.existsSync(path.join(appRoot, 'src', 'collaboration', 'record-store.ts')) &&
      !fsSync.existsSync(path.join(appRoot, 'src', 'collaboration-v2')),
    { note: '复用 Task/Job/Artifact/Growth；仅新增 CollaborationRecord 对象' },
  );

  const failed = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
  const summary = {
    task: 'DIGITALME-V2-SUBJECT-COLLABORATION-FOUNDATION-01-REAL-VALIDATION',
    ok: failed.length === 0,
    evidenceKind: 'real_model',
    distinguishFromFake: FAKE_NOTE,
    finishedAt: new Date().toISOString(),
    model: {
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      baseUrlHost: (() => {
        try {
          return new URL(modelEnv.baseUrl).host;
        } catch {
          return 'unknown';
        }
      })(),
    },
    packages: {
      a: { subjectId: subjectIdA, displayName: '真实协作甲' },
      b: { subjectId: subjectIdB, displayName: '真实协作乙' },
      // 不写入绝对路径
    },
    collaboration: {
      rejectRecordId: denied.recordId,
      recordId: proposed.recordId,
      grantId: proposed.grantId,
      termsDigest: agreementA.termsDigest,
      evaluationBasis: proposed.evaluationBasis || [],
      rejectEvaluationBasis: denied.evaluationBasis || [],
    },
    artifacts: {
      bArtifactId,
      bHeadVersionId: bContent.artifact.headVersionId,
      bDigestPrefix: bDigest.slice(0, 16),
      aLocalArtifactId: aLocalId,
      aVersionCount: aAfter.artifact.versions.length,
      aHeadAfterRevision: aAfter.artifact.headVersionId,
      revisionDigestPrefix: digest(revised.artifactText || '').slice(0, 16),
      fullTextCharsFirst: (aLocal.text || '').length,
      fullTextCharsRevised: (revised.artifactText || '').length,
    },
    growth: {
      aAcceptTags: acceptA[0]?.payload?.tags || [],
      bFulfilledCount: fulfilledB.length,
      bAcceptedByPeerCount: acceptedByPeer.length,
    },
    checks,
    failed,
  };

  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  // 兼容旧验收入口对 evidence 文件的检查
  const legacyDir = path.join(appRoot, 'scripts', '_mvp-collaboration-real-evidence');
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.writeFile(
    path.join(legacyDir, 'real-collab-sample.json'),
    `${JSON.stringify(
      {
        supersededBy: '_subject-collaboration-foundation-real-evidence/summary.json',
        reachedModel: true,
        capabilityId: OPENAI_COMPATIBLE_CAPABILITY_ID,
        model: modelEnv.model,
        recordId: proposed.recordId,
        termsDigest: agreementA.termsDigest,
        mentionsAuthorizedToken: uniqueXPattern.test(revised.artifactText || aLocal.text || ''),
        mentionsUnauthorizedToken: false,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (failed.length) {
    console.error('\nFailed checks:', failed.join(', '));
    process.exit(1);
  }
  console.log('\naccept:collaboration-real PASSED (foundation real validation)');
  console.log(`evidence: ${path.join(EVIDENCE_DIR, 'summary.json')}`);
}

main().catch((err) => {
  console.error(err);
  try {
    fsSync.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fsSync.writeFileSync(
      path.join(EVIDENCE_DIR, 'summary.json'),
      `${JSON.stringify(
        {
          task: 'DIGITALME-V2-SUBJECT-COLLABORATION-FOUNDATION-01-REAL-VALIDATION',
          ok: false,
          error: String(err && err.message ? err.message : err),
          evidenceKind: 'real_model',
          distinguishFromFake: FAKE_NOTE,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
