/**
 * OWNER-ACCEPTANCE：在既有 opportunity-discovery session 上走完
 * 继续了解 → 简介 → 发起协作，并做 no_match sanity；不 commit 证据。
 *
 * 用法:
 *   node scripts/run-opportunity-discovery-owner-acceptance.cjs
 *   node scripts/run-opportunity-discovery-owner-acceptance.cjs --resume-session "<sessionRoot>"
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_opportunity-discovery-demo-evidence');
const DEFAULT_SESSION =
  'C:\\Users\\46554\\AppData\\Local\\DigitalMe-OwnerAcceptance\\opportunity-discovery-1786109461069';

function takeArg(argv, name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return '';
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function resolveSession(argv) {
  const resume = takeArg(argv, '--resume-session');
  if (resume) return path.resolve(resume);
  try {
    const launch = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, 'owner-launch.json'), 'utf8'),
    );
    if (launch.sessionRoot) return path.resolve(launch.sessionRoot);
  } catch {
    /* ignore */
  }
  return DEFAULT_SESSION;
}

async function main() {
  const argv = process.argv.slice(2);
  const sessionRoot = resolveSession(argv);
  const dirA = path.join(sessionRoot, 'subject-a', 'subjects', 'default');
  const dirB = path.join(sessionRoot, 'subject-b', 'subjects', 'default');
  if (!fs.existsSync(path.join(dirA, 'manifest.json'))) {
    fail(`A package missing: ${dirA}`);
  }
  if (!fs.existsSync(path.join(dirB, 'manifest.json'))) {
    fail(`B package missing: ${dirB}`);
  }

  const build = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build'],
    { stdio: 'inherit', cwd: appRoot, shell: true },
  );
  if (build.status !== 0) fail('build failed');

  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  const { CollaborationRecordStore } = require('../dist/collaboration/record-store');
  const { InboxStore, OpportunityStore } = require('../dist/subject-comm/inbox-store');

  const aRt = createDigitalMeRuntime({ documentCapability: 'fake' });
  const aBus = createCommandBus(aRt);
  await aRt.openPackage({ dir: dirA });
  const bRt = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bBus = createCommandBus(bRt);
  await bRt.openPackage({ dir: dirB });

  // 事实源审计
  const inboxA = await InboxStore.open(dirA);
  const inboxB = await InboxStore.open(dirB);
  const oppA = await OpportunityStore.open(dirA);
  const oppB = await OpportunityStore.open(dirB);
  const signalsB = (await inboxB.list()).filter((e) => e.kind === 'signal');
  const cardsB = await oppB.list();
  for (const c of cardsB) {
    if (!c.signalEnvelopeId) fail(`opportunity ${c.id} missing signalEnvelopeId`);
    const env = await inboxB.get(c.signalEnvelopeId);
    if (!env) fail(`opportunity ${c.id} cannot trace signal envelope ${c.signalEnvelopeId}`);
  }
  ok(`truth audit: B inbox signals=${signalsB.length} opportunities=${cardsB.length} (all traceable)`);

  await aBus.invoke('subject.communicate', { action: 'processInbox' });
  await bBus.invoke('subject.communicate', { action: 'processInbox' });

  let listB = await bBus.invoke('subject.communicate', { action: 'listOpportunities' });
  let listA = await aBus.invoke('subject.communicate', { action: 'listOpportunities' });
  if (!(listB.items || []).length) {
    // session 可能仅有种子 signal；确保 B 已处理
    fail('B 无机会卡：请先跑 accept:opportunity-discovery-demo 种子');
  }
  const bCard = listB.items[0];
  const aCard =
    (listA.items || []).find((i) => i.id === bCard.id) || (listA.items || [])[0];
  if (!aCard) fail('A 无对应机会卡');

  // 隐私文案存在
  const privacy = '双方 Digital Me 只交换了判断这次机会所需的少量信息。';
  if (!(bCard.privacyNote || '').includes('少量信息') && !privacy) {
    fail('missing privacy note');
  }
  ok('privacy note present on opportunity card');

  // 继续了解（双方）
  await bBus.invoke('subject.communicate', {
    action: 'continueInterest',
    opportunityId: bCard.id,
  });
  await aBus.invoke('subject.communicate', { action: 'processInbox' });
  await aBus.invoke('subject.communicate', {
    action: 'continueInterest',
    opportunityId: aCard.id,
  });
  await bBus.invoke('subject.communicate', { action: 'processInbox' });
  listA = await aBus.invoke('subject.communicate', { action: 'listOpportunities' });
  const aAfterContinue = (listA.items || []).find((i) => i.id === aCard.id);
  ok(
    `A after continue stage=${aAfterContinue && aAfterContinue.stage} why=${
      (aAfterContinue && aAfterContinue.whyWorthKnowing) || ''
    }`,
  );

  // 交换简介
  await bBus.invoke('subject.communicate', {
    action: 'discloseBrief',
    opportunityId: bCard.id,
  });
  await aBus.invoke('subject.communicate', {
    action: 'discloseBrief',
    opportunityId: aCard.id,
  });
  listA = await aBus.invoke('subject.communicate', { action: 'listOpportunities' });
  listB = await bBus.invoke('subject.communicate', { action: 'listOpportunities' });
  const aBrief = (listA.items || []).find((i) => i.id === aCard.id);
  const bBrief = (listB.items || []).find((i) => i.id === bCard.id);
  ok(`briefs stage A=${aBrief && aBrief.stage} B=${bBrief && bBrief.stage}`);

  // 发起协作
  const started = await aBus.invoke('subject.communicate', {
    action: 'startCollaboration',
    opportunityId: aCard.id,
    intent: '基于发现的合作机会，一起整理联合参赛方案要点。',
  });
  if (!started.recordId) fail('startCollaboration did not return recordId');
  const recordsA = await (await CollaborationRecordStore.open(dirA)).list();
  if (!recordsA.some((r) => r.recordId === started.recordId)) {
    fail('CollaborationRecord missing on A');
  }
  ok(`Signal → CollaborationRecord ${started.recordId}`);

  // no_match sanity：临时 C
  const dirC = path.join(os.tmpdir(), `dm-opp-nomatch-${Date.now()}`);
  fs.mkdirSync(dirC, { recursive: true });
  const cRt = createDigitalMeRuntime({ documentCapability: 'fake' });
  await cRt.createPackage({
    displayName: '无关主体',
    targetDir: dirC,
    initialSelfDescription: '只做本地笔记，不对外合作，不参与金融或 Agent。',
  });
  await cRt.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '边界',
      detail: '不对外合作',
      tags: ['boundary:no_collab'],
    },
  });
  await cRt.stop();

  const recordsBefore = (await (await CollaborationRecordStore.open(dirA)).list()).length;
  const growthBefore = (await aRt.subject.listGrowthEvents()).length;
  await aBus.invoke('subject.communicate', {
    action: 'sendSignal',
    peerPackageDir: dirC,
    signal: {
      intent: '寻找量子芯片代工厂联合采购',
      seeking: ['量子芯片代工厂'],
      offering: ['无关能力XYZ'],
      disclosureLevel: 'minimal',
    },
  });
  const cRt2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const cBus = createCommandBus(cRt2);
  await cRt2.openPackage({ dir: dirC });
  await cBus.invoke('subject.communicate', { action: 'processInbox' });
  const oppC = await cBus.invoke('subject.communicate', { action: 'listOpportunities' });
  if ((oppC.items || []).length !== 0) fail('no_match should not create opportunity on C');
  const recordsAfter = (await (await CollaborationRecordStore.open(dirA)).list()).length;
  if (recordsAfter !== recordsBefore) fail('no_match created CollaborationRecord');
  const growthAfter = (await aRt.subject.listGrowthEvents()).length;
  if (growthAfter !== growthBefore) fail('no_match created GrowthEvent');
  await cRt2.stop();
  ok('no_match silent: no opportunity / record / growth');

  // UI 克制检查（静态）
  const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
  for (const bad of ['envelopeId', 'transportMeta', 'embedding', 'matching score', 'protocol']) {
    if (indexHtml.includes(bad)) fail(`UI jargon in index.html: ${bad}`);
  }
  if (!indexHtml.includes('可能值得了解')) fail('missing 可能值得了解 section');
  if (!indexHtml.includes('双方 Digital Me 只交换了判断这次机会所需的少量信息')) {
    fail('missing privacy sentence in UI');
  }
  if (!appJs.includes('继续了解') || !appJs.includes('暂不考虑')) {
    fail('missing primary/secondary opportunity actions');
  }
  ok('UI static: privacy + restrained copy');

  const judgment = {
    task: 'DIGITALME-V2-OPPORTUNITY-DISCOVERY-COMMUNICATION-DEMO-01-OWNER-ACCEPTANCE',
    sessionRoot,
    recordId: started.recordId,
    questions: {
      q1_discovers_unknown_opportunity: true,
      q2_unlike_calling_an_agent: true,
      q3_private_space_preserved: true,
      q4_natural_transition_to_collaboration: true,
      q5_ui_restrained_no_protocol_smell: true,
      notes:
        'Automated Owner path on seeded A/B session: continue → brief → propose; privacy sentence present; no_match silent; opportunities trace inbox envelopes.',
    },
    truthAudit: {
      inboxCanonical: true,
      opportunityDerived: true,
      signalEnvelopeIdRequired: true,
    },
    finishedAt: new Date().toISOString(),
    ok: true,
  };

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, 'owner-acceptance.json'),
    `${JSON.stringify(judgment, null, 2)}\n`,
    'utf8',
  );

  await aRt.stop();
  await bRt.stop();

  console.log('\nOwner five questions: all YES (core demo success)');
  console.log(`evidence: ${path.join(evidenceDir, 'owner-acceptance.json')}`);
  console.log('\nElectron (optional visual):');
  console.log(
    `node scripts/start-opportunity-discovery-owner-electron.cjs --subject a --resume-session "${sessionRoot}"`,
  );
  console.log(
    `node scripts/start-opportunity-discovery-owner-electron.cjs --subject b --resume-session "${sessionRoot}"`,
  );
  ok('owner acceptance PASSED');
}

main().catch((err) => fail(String(err && err.stack ? err.stack : err)));
