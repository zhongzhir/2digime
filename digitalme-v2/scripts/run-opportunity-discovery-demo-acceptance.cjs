/**
 * OPPORTUNITY-DISCOVERY-COMMUNICATION-DEMO-01 自动化验收。
 * 预置 A/B 主体事实 → Signal → 匹配 → 继续了解 → 简介 → 发起协作。
 *
 * 用法: npm run accept:opportunity-discovery-demo
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_opportunity-discovery-demo-evidence');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

fs.mkdirSync(evidenceDir, { recursive: true });

const build = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  { stdio: 'inherit', cwd: appRoot, shell: true },
);
if (build.status !== 0) fail('build failed');

const testFile = path.join('dist', 'subject-comm', 'tests', 'opportunity-discovery-01.test.js');
if (!fs.existsSync(path.join(appRoot, testFile))) {
  fail(`missing ${testFile}`);
}

const run = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', testFile],
  { stdio: 'inherit', cwd: appRoot, env: { ...process.env } },
);
if (run.status !== 0) fail(`opportunity-discovery-01 tests exited ${run.status}`);
ok('opportunity-discovery-01 tests passed');

// 额外：写入 Owner Demo 会话骨架（双 userData + 预置事实 + 已发 Signal）
const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
const { createCommandBus } = require('../dist/runtime/command-bus');

async function seedOwnerSession() {
  const base = path.join(
    process.env.LOCALAPPDATA || os.tmpdir(),
    'DigitalMe-OwnerAcceptance',
    `opportunity-discovery-${Date.now()}`,
  );
  const userA = path.join(base, 'subject-a');
  const userB = path.join(base, 'subject-b');
  const dirA = path.join(userA, 'subjects', 'default');
  const dirB = path.join(userB, 'subjects', 'default');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  const aRt = createDigitalMeRuntime({ documentCapability: 'fake' });
  const aBus = createCommandBus(aRt);
  await aRt.createPackage({
    displayName: '主体甲',
    targetDir: dirA,
    initialSelfDescription:
      '我有 Agent / Digital Me 技术能力，正在寻找适合 AI/Agent 比赛的成熟金融应用场景。',
  });
  await aRt.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '合作意向',
      detail: '可提供 Agent / Digital Me 技术；寻找金融应用场景联合参赛。',
      tags: ['seeking:finance_scenario', 'offering:agent_tech'],
    },
  });

  const bRt = createDigitalMeRuntime({ documentCapability: 'fake' });
  await bRt.createPackage({
    displayName: '主体乙',
    targetDir: dirB,
    initialSelfDescription:
      '我拥有成熟金融投资应用项目 Aivestor，希望寻找 Agent / Digital Me 技术能力进一步升级，愿意考虑联合参赛。',
  });
  await bRt.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: 'Aivestor 项目',
      detail: '成熟金融投资应用 Aivestor；希望升级 Agent / Digital Me 技术；寻找联合参赛伙伴。',
      tags: ['project:aivestor', 'finance', 'seeking:agent_tech'],
    },
  });
  await bRt.stop();

  const sent = await aBus.invoke('subject.communicate', {
    action: 'sendSignal',
    peerPackageDir: dirB,
    signal: {
      intent:
        '正在寻找适合联合参赛的成熟金融 AI 应用场景；可提供 Agent / Digital Me 技术能力。',
      seeking: ['成熟金融应用场景', '联合参赛'],
      offering: ['Agent / Digital Me 技术能力'],
      disclosureLevel: 'minimal',
    },
  });

  await aRt.stop();

  return {
    sessionRoot: base,
    dirA,
    dirB,
    opportunityId: sent.opportunityId,
    envelopeId: sent.envelopeId,
  };
}

seedOwnerSession()
  .then((seed) => {
    const launch = {
      task: 'OPPORTUNITY-DISCOVERY-COMMUNICATION-DEMO-01',
      sessionRoot: seed.sessionRoot,
      opportunityId: seed.opportunityId,
      envelopeId: seed.envelopeId,
      packageA: seed.dirA,
      packageB: seed.dirB,
      resumeHintA: `node scripts/start-opportunity-discovery-owner-electron.cjs --subject a --resume-session "${seed.sessionRoot}"`,
      resumeHintB: `node scripts/start-opportunity-discovery-owner-electron.cjs --subject b --resume-session "${seed.sessionRoot}"`,
      finishedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(evidenceDir, 'owner-launch.json'),
      `${JSON.stringify(launch, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(evidenceDir, 'summary.json'),
      `${JSON.stringify(
        {
          task: 'OPPORTUNITY-DISCOVERY-COMMUNICATION-DEMO-01',
          ok: true,
          finishedAt: new Date().toISOString(),
          testFile,
          sessionRoot: seed.sessionRoot,
          notes: [
            'SubjectTransport + SubjectEnvelope (local_trusted)',
            'Signal independent of CollaborationRecord',
            'Match local to B; no_match silent',
            'Continue → brief → startCollaboration → existing propose loop',
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const checklist = `# Owner Checklist — 机会发现 Demo

## 启动

1. 已跑 \`npm run accept:opportunity-discovery-demo\`（本清单随证据生成）
2. 开两个窗口：

\`\`\`
${launch.resumeHintA}
${launch.resumeHintB}
\`\`\`

## 核对路径

1. 打开「协作」页，看到「可能值得了解」
2. A / B 均有机会卡；文案无 envelope / transport / protocol / confidence 等内部词
3. 隐私句可见：双方 Digital Me 只交换了判断这次机会所需的少量信息
4. 点「继续了解」→「交换简介」→「发起协作」
5. 进入既有协作详情（可接受 / 完成 / 修订），不另建协作体系
6. B 的 Aivestor 私有细节未整包暴露给 A 的界面

## 不做宣称

- 不宣称跨设备 / 公网协作已可用
- 不宣称已做端到端加密或签名（本轮 local_trusted）
`;

    fs.writeFileSync(path.join(evidenceDir, 'OWNER_CHECKLIST.md'), checklist, 'utf8');

    ok(`owner session seeded: ${seed.sessionRoot}`);
    console.log('\naccept:opportunity-discovery-demo PASSED');
    console.log(`evidence: ${path.join(evidenceDir, 'summary.json')}`);
    console.log(`Owner checklist: ${path.join(evidenceDir, 'OWNER_CHECKLIST.md')}`);
    console.log(launch.resumeHintA);
    console.log(launch.resumeHintB);
  })
  .catch((err) => {
    fail(String(err && err.stack ? err.stack : err));
  });
