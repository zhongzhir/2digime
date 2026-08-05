/**
 * DIGITALME-V2-EXTERNAL-CAPABILITY-CONNECTION-AND-IA-FIX-02
 * 用法: npm run accept:external-capability-owner-path
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(appRoot, 'electron/renderer/styles.css'), 'utf8');
const mainCjs = fs.readFileSync(path.join(appRoot, 'electron/main.cjs'), 'utf8');
const preloadCjs = fs.readFileSync(path.join(appRoot, 'electron/preload.cjs'), 'utf8');
const bootstrapRemote = fs.readFileSync(
  path.join(appRoot, 'electron/bootstrap-remote-capability.cjs'),
  'utf8',
);
const lifecycle = fs.readFileSync(
  path.join(appRoot, 'scripts/_research-a2a-agent-lifecycle.cjs'),
  'utf8',
);
const pkgJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const productTs = fs.readFileSync(
  path.join(appRoot, 'src/capability/external-capability-product.ts'),
  'utf8',
);
const hay = `${html}\n${appJs}\n${styles}\n${productTs}`;

for (const re of [
  /用专业能力|使用已连接的外部专业能力/,
  /id="btn-external-cap-open"/,
  /id="external-cap-panel"/,
  /研究分析能力/,
  /已连接的专业能力/,
  /外部专业能力/,
  /另一个数字之我/,
  /查看授权说明/,
  /将发送的任务要求/,
  /不会发送的内容/,
  /不允许保存|对方是否允许保存/,
  /是否允许再委托/,
  /可随时取消/,
  /准备中/,
  /正在交给专业能力/,
  /正在处理/,
  /正在检查成果/,
  /已返回成果/,
  /已取消/,
  /未完成/,
  /尚未连接可用的外部专业能力/,
  /前往协作/,
  /对方未在限定时间内完成/,
  /已停止本次外部处理/,
  /未通过完整性检查/,
  /所选材料无法按当前授权发送/,
  /来源：已连接的研究分析能力/,
  /返回的成果|id="external-cap-result"/,
  /previewAuthorization/,
  /authorizationPreview/,
  /协作对象/,
  /其他数字之我/,
  /id="collab-external-cap-manage"/,
  /id="remote-cap-base-url"/,
  /id="btn-remote-cap-test"/,
  /id="btn-remote-cap-save"/,
  /id="btn-remote-cap-disable"/,
  /保存并连接/,
  /连接外部专业能力（高级）/,
  /查看授权边界/,
  /setNav\(["']collab["']\)/,
  /userFacingRemoteError|REMOTE_CONNECT_FAIL/,
  /无法连接研究分析能力，请确认服务正在运行并检查地址/,
]) {
  if (!re.test(hay)) fail(`missing owner-path marker: ${re}`);
}
ok('owner-path UI markers present');

{
  const navMatch = html.match(/class="main-nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navMatch) fail('main-nav missing');
  const labels = [...navMatch[1].matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  if (labels.join('|') !== '做事|对话|数字之我|协作') {
    fail(`primary nav must be 做事/对话/数字之我/协作; got ${labels.join('/')}`);
  }
  if (/id="btn-open-settings"/.test(navMatch[1])) {
    fail('设置 must not live in primary main-nav');
  }
  if (!/topbar-actions[\s\S]*id="btn-open-settings"/.test(html)) {
    fail('设置 must live in secondary topbar-actions');
  }
}
ok('primary nav frozen as 做事 / 对话 / 数字之我 / 协作; 设置 secondary');

for (const bad of [
  /A2A/,
  /Agent Card/,
  /endpointId/,
  /protocolMapping/,
  /environment variable/i,
  /\bSDK\b/,
  /\btaskId\b/,
  /\bprotocol\b/i,
  /\bendpoint\b/i,
]) {
  if (bad.test(html)) fail(`protocol jargon leaked into HTML: ${bad}`);
}
if (/settings-external-capability|外部专业能力/.test(html.slice(0, html.indexOf('view-shell')))) {
  // settings view must not contain external capability management
  const settingsBlock = html.slice(html.indexOf('view-settings'), html.indexOf('view-shell'));
  if (/外部专业能力|remote-cap-base-url|id="btn-remote-cap-save"/.test(settingsBlock)) {
    fail('settings page must not contain external capability connection UI');
  }
  if (/保存并连接/.test(settingsBlock)) {
    fail('settings page must not contain remote-capability「保存并连接」action');
  }
}
ok('settings page cleaned of external capability UI');

if (!pkgJson.scripts || !pkgJson.scripts['start:reference-research-agent']) {
  fail('missing npm run start:reference-research-agent');
}
if (!pkgJson.scripts['verify:reference-research-agent']) {
  fail('missing npm run verify:reference-research-agent');
}
if (!/assertAgentReady/.test(lifecycle)) {
  fail('start lifecycle must assert real readiness before success');
}
if (!/rebootstrapAndNotify/.test(mainCjs) || !/shell:saveRemoteCapability/.test(mainCjs)) {
  fail('saveRemoteCapability must rebootstrap without restart');
}
{
  const saveSlice = mainCjs.slice(
    mainCjs.indexOf('shell:saveRemoteCapability'),
    mainCjs.indexOf('shell:disableRemoteCapability'),
  );
  if (!/validateResearchEndpoint/.test(saveSlice) || !/rebootstrapAndNotify/.test(saveSlice)) {
    fail('saveRemoteCapability handler must validate then rebootstrap');
  }
  if (!/return \{\s*ok:\s*false/.test(saveSlice) && !/ok:\s*false/.test(saveSlice)) {
    fail('saveRemoteCapability must return ok:false instead of throwing IPC errors');
  }
  if (!/writeRemoteCapabilityConfig/.test(saveSlice)) {
    fail('saveRemoteCapability must persist config before rebootstrap');
  }
  const orderValidate = saveSlice.indexOf('validateResearchEndpoint');
  const orderWrite = saveSlice.indexOf('writeRemoteCapabilityConfig');
  if (orderValidate < 0 || orderWrite < 0 || orderValidate > orderWrite) {
    fail('must validate before writing connected config');
  }
}
if (!/validateResearchEndpoint/.test(mainCjs) || !/validateResearchEndpoint/.test(bootstrapRemote)) {
  fail('save must validate via RemoteEndpointPolicy / Agent Card');
}
if (!/getRemoteCapabilityStatus/.test(preloadCjs) || !/saveRemoteCapability/.test(preloadCjs)) {
  fail('preload must expose remote capability shell APIs');
}
if (/ConnectionStore|capability-connection-store|createConnectionStore/i.test(bootstrapRemote + mainCjs)) {
  fail('must not introduce a second Connection Store');
}
if (!/remote-capability-config\.json/.test(bootstrapRemote)) {
  fail('config must reuse remote-capability-config.json (settings file, not new store)');
}
if (!/env_override|DIGITALME_V2_A2A_RESEARCH_BASE_URL/.test(bootstrapRemote)) {
  fail('env must remain optional override only');
}
if (/openSettings\(\{\s*section:\s*['"]external-capability['"]/.test(appJs)) {
  fail('work page must not jump to settings for connection');
}
ok('connection settings wiring (collab-managed; no second store; rebootstrap; policy validate)');
const panelStart = html.indexOf('id="external-cap-panel"');
const panelEnd = html.indexOf('id="collab-form"');
if (panelStart < 0 || panelEnd < 0) fail('external panel / collab form missing');
const panel = html.slice(panelStart, panelEnd);
if (/另一个数字之我/.test(panel)) fail('external panel must not call peer another digital me');
ok('HTML hides protocol jargon; external ≠ 另一个数字之我');

if (!/previewAuthorization/.test(appJs) || !/authorizationPreview\.confirmPoints/.test(appJs)) {
  fail('UI must consume projection confirmPoints, not invent authorization logic');
}
ok('authorization confirm consumes projection');

const unit = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/capability/tests/external-capability-product.test.js',
    'dist/capability/adapters/tests/controlled-remote.test.js',
    'dist/capability/tests/remote-capability-contract.test.js',
    'dist/capability/tests/a2a-remote-capability.test.js',
    'dist/capability/tests/a2a-connection-probe.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (unit.status !== 0) fail('owner-path unit/integration tests failed');
ok('owner-path unit/integration tests passed');

async function runConnectionSettingsPath() {
  const { promises: fsp } = fs;
  const remoteBoot = require('../electron/bootstrap-remote-capability.cjs');
  const {
    buildResearchEndpointPolicy,
  } = require('../dist/capability/remote-endpoint-policy.js');
  const { startResearchA2AAgent } = require('./_research-a2a-agent-lifecycle.cjs');

  const userData = await fsp.mkdtemp(path.join(os.tmpdir(), 'dmv2-remote-cfg-'));
  try {
    // 1) 初始未连接
    const initial = remoteBoot.readRemoteCapabilityConfig(userData);
    if (initial.enabled) throw new Error('initial should be disabled');
    const resolved0 = remoteBoot.resolveResearchBaseUrl(userData, {});
    if (resolved0.enabled || resolved0.source !== 'none') {
      throw new Error(`initial resolve unexpected: ${JSON.stringify(resolved0)}`);
    }
    const st0 = remoteBoot.publicRemoteCapabilityStatus({
      saved: initial,
      resolved: resolved0,
      registered: false,
      connectionState: 'disconnected',
    });
    if (st0.statusLabel !== '未连接' || st0.requiresCredential !== false) {
      throw new Error(`initial status=${JSON.stringify(st0)}`);
    }
    ok('connection: initial disconnected');

    // 2) 无效地址 / 非 HTTPS 公网拒绝（不得写入 enabled）
    let rejectedInvalid = false;
    try {
      await remoteBoot.validateResearchEndpoint('not-a-url', appRoot);
    } catch {
      rejectedInvalid = true;
    }
    if (!rejectedInvalid) throw new Error('invalid url should fail validate');

    let rejectedPublicHttp = false;
    try {
      const policy = buildResearchEndpointPolicy({ baseUrl: 'http://example.com:8080' });
      const {
        assertEndpointPolicyShape,
      } = require('../dist/capability/remote-endpoint-policy.js');
      assertEndpointPolicyShape(policy);
    } catch {
      rejectedPublicHttp = true;
    }
    if (!rejectedPublicHttp) throw new Error('non-HTTPS public must be rejected by policy');
    try {
      await remoteBoot.validateResearchEndpoint('http://example.com:8080', appRoot);
      throw new Error('validate should reject public http');
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/A2A|stack|ECONNREFUSED|fetch failed/i.test(msg) && /at Object/.test(msg)) {
        throw new Error(`user-facing error leaked stack: ${msg}`);
      }
      if (!/安全|https|服务地址|无法连接/i.test(msg)) {
        throw new Error(`unexpected public-http message: ${msg}`);
      }
    }
    const still = remoteBoot.readRemoteCapabilityConfig(userData);
    if (still.enabled) throw new Error('failed validate must not persist enabled');
    ok('connection: invalid + non-HTTPS public rejected');

    // 3) 保存并连接（设置驱动，无环境变量）+ 即时可用语义
    const agent = await startResearchA2AAgent({
      RESEARCH_A2A_PORT: String(43221 + Math.floor(Math.random() * 400)),
    });
    try {
      const { probeA2AConnection } = require('../dist/capability/a2a-connection-probe.js');
      const productProbe = await probeA2AConnection({ baseUrl: agent.baseUrl });
      if (!productProbe.ok) {
        throw new Error(`product probe failed: ${JSON.stringify(productProbe.diagnostic)}`);
      }
      // localhost 与 127.0.0.1 必须等价（根因修复）
      const localProbe = await probeA2AConnection({
        baseUrl: agent.baseUrl.replace('127.0.0.1', 'localhost'),
      });
      if (!localProbe.ok) {
        throw new Error(`localhost probe failed: ${JSON.stringify(localProbe.diagnostic)}`);
      }
      ok('connection: unified probe succeeds for 127.0.0.1 and localhost');

      await remoteBoot.validateResearchEndpoint(agent.baseUrl, appRoot);
      await remoteBoot.validateResearchEndpoint(
        agent.baseUrl.replace('127.0.0.1', 'localhost'),
        appRoot,
      );
      ok('connection: product validateResearchEndpoint uses same probe contract');

      remoteBoot.writeRemoteCapabilityConfig(userData, {
        enabled: true,
        baseUrl: agent.baseUrl,
      });
      const envEmpty = { ...process.env };
      delete envEmpty.DIGITALME_V2_A2A_RESEARCH_BASE_URL;
      const resolved1 = remoteBoot.resolveResearchBaseUrl(userData, envEmpty);
      if (!resolved1.enabled || resolved1.source !== 'saved_config') {
        throw new Error(`saved resolve failed: ${JSON.stringify(resolved1)}`);
      }
      if (resolved1.baseUrl !== agent.baseUrl.replace(/\/+$/, '')) {
        // normalize may strip trailing slash
        if (remoteBoot.normalizeBaseUrl(resolved1.baseUrl) !== remoteBoot.normalizeBaseUrl(agent.baseUrl)) {
          throw new Error('resolved baseUrl mismatch');
        }
      }

      // 环境变量缺失不影响设置驱动注册
      const resolvedNoEnv = remoteBoot.resolveResearchBaseUrl(userData, {
        PATH: process.env.PATH,
      });
      if (!resolvedNoEnv.enabled || resolvedNoEnv.source !== 'saved_config') {
        throw new Error('missing env must still resolve from saved config');
      }

      // 模拟即时注册：用 saved 配置构建 runtime（无需进程重启）
      const {
        createDigitalMeRuntime,
      } = require('../dist/runtime/digitalme-runtime.js');
      const {
        A2A_REMOTE_CAPABILITY_ID,
      } = require('../dist/capability/adapters/a2a-remote.js');
      const runtime = createDigitalMeRuntime({
        documentCapability: 'none',
        registerOpenAiStub: false,
        a2aRemoteCapability: {
          endpoint: buildResearchEndpointPolicy({ baseUrl: resolved1.baseUrl }),
          pollIntervalMs: 50,
        },
      });
      try {
        const listed = await runtime.listCapabilities({ includeAvailability: true });
        const card = listed.externalCapabilityCard;
        if (!card || !card.available) {
          throw new Error(`expected available after connect: ${JSON.stringify(card)}`);
        }
        const hasRemote = (listed.capabilities || []).some((c) => c.id === A2A_REMOTE_CAPABILITY_ID);
        if (!hasRemote) throw new Error('a2a research capability not registered after connect');
        ok('connection: save+connect without env; usable without restart');

        // 凭证不得进入配置文件
        const rawCfg = await fsp.readFile(remoteBoot.configPath(userData), 'utf8');
        if (/apiKey|api_key|secret|Bearer|sk-/i.test(rawCfg)) {
          throw new Error('credentials leaked into remote-capability-config.json');
        }
        if (!/remote-capability-config\.json$/.test(remoteBoot.configPath(userData))) {
          throw new Error('unexpected config path');
        }
        const dirFiles = await fsp.readdir(userData);
        if (dirFiles.some((f) => /connection.?store/i.test(f))) {
          throw new Error('second connection store file found');
        }
        ok('connection: no secrets in config; no second store');
      } finally {
        await runtime.stop();
      }

      // 4) 停用后禁止新任务注册语义（停用优先于 env 覆盖）
      remoteBoot.disableRemoteCapabilityConfig(userData);
      const resolvedOff = remoteBoot.resolveResearchBaseUrl(userData, {
        DIGITALME_V2_A2A_RESEARCH_BASE_URL: agent.baseUrl,
      });
      if (resolvedOff.enabled) {
        throw new Error('product disable must win over env override');
      }
      const stOff = remoteBoot.publicRemoteCapabilityStatus({
        saved: remoteBoot.readRemoteCapabilityConfig(userData),
        resolved: resolvedOff,
        registered: false,
        connectionState: 'disconnected',
      });
      if (stOff.statusLabel !== '未连接') throw new Error('disable status must be 未连接');
      const runtimeOff = createDigitalMeRuntime({
        documentCapability: 'none',
        registerOpenAiStub: false,
      });
      try {
        const listedOff = await runtimeOff.listCapabilities({ includeAvailability: true });
        if (listedOff.externalCapabilityCard && listedOff.externalCapabilityCard.available) {
          throw new Error('disabled must not show available');
        }
        ok('connection: disable blocks new external capability use');
      } finally {
        await runtimeOff.stop();
      }

      // 5) 重启后连接配置恢复（重新写入启用并再读）
      remoteBoot.writeRemoteCapabilityConfig(userData, {
        enabled: true,
        baseUrl: agent.baseUrl,
      });
      const userData2 = userData; // same path = simulate restart reading same userData
      const restored = remoteBoot.resolveResearchBaseUrl(userData2, {});
      if (!restored.enabled || restored.source !== 'saved_config') {
        throw new Error('restart must restore saved connection');
      }
      ok('connection: restart restores saved config');

      // 独立验证脚本（真实监听）— 必须与产品探测一致，且拒绝 HTTP 500 假阳性
      const verify = spawnSync('npm', ['run', 'verify:reference-research-agent'], {
        cwd: appRoot,
        encoding: 'utf8',
        shell: true,
        env: {
          ...process.env,
          RESEARCH_A2A_HOST: agent.host,
          RESEARCH_A2A_PORT: String(agent.port),
        },
      });
      if (verify.status !== 0) {
        throw new Error(`verify script failed: ${verify.stdout || ''}\n${verify.stderr || ''}`);
      }
      let parsedVerify = null;
      {
        const text = verify.stdout || '';
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) parsedVerify = JSON.parse(text.slice(start, end + 1));
      }
      if (!parsedVerify || parsedVerify.ready_for_connection !== true) {
        throw new Error(`verify missing ready_for_connection: ${verify.stdout}`);
      }
      if (parsedVerify.a2a_protocol_probe_valid !== true) {
        throw new Error('verify must require a2a_protocol_probe_valid');
      }
      if (parsedVerify.details && parsedVerify.details.httpStatus === 500) {
        throw new Error('verify must not treat HTTP 500 as ready');
      }
      const again = await probeA2AConnection({ baseUrl: agent.baseUrl });
      if (again.ok !== true) {
        throw new Error('product probe must remain ok while verify passes');
      }
      ok('connection: verify:reference-research-agent passes; agrees with product probe');

      // Agent 停止后：校验应失败且不得落为已连接
      await agent.stop();
      let stoppedRejected = false;
      try {
        await remoteBoot.validateResearchEndpoint(agent.baseUrl, appRoot);
      } catch {
        stoppedRejected = true;
      }
      if (!stoppedRejected) throw new Error('stopped agent must fail validate');
      ok('connection: agent stop makes endpoint unreachable');
    } finally {
      try {
        await agent.stop();
      } catch {
        /* ignore */
      }
    }
  } finally {
    try {
      await fsp.rm(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function runDomainOwnerPath() {
  const { promises: fsp } = fs;
  const {
    createDigitalMeRuntime,
  } = require('../dist/runtime/digitalme-runtime.js');
  const {
    startControlledRemotePeer,
    CONTROLLED_REMOTE_CAPABILITY_ID,
  } = require('../dist/capability/adapters/controlled-remote.js');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner.js');
  const {
    EXTERNAL_CAPABILITY_FAILURE,
    previewExternalAuthorization,
  } = require('../dist/capability/external-capability-product.js');

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dmv2-ext-owner-'));
  const pkgDir = path.join(root, 'subject');
  const matDir = path.join(root, 'materials');
  await fsp.mkdir(matDir, { recursive: true });
  const allowedFile = path.join(matDir, 'project-brief.md');
  const secretFile = path.join(matDir, 'UNAUTHORIZED-SECRET.md');
  await fsp.writeFile(
    allowedFile,
    [
      '# 青竹枢纽项目简报（公开）',
      '',
      '目标：在两周内交付可演示的协作入口。',
      '主要风险：范围漂移、依赖外部能力可用性、材料不完整。',
      '验收：用户能看懂授权范围并处理失败。',
    ].join('\n'),
    'utf8',
  );
  await fsp.writeFile(secretFile, 'SECRET_UNAUTHORIZED_PAYLOAD_XYZ\n', 'utf8');

  // Owner 手验材料副本（手验步骤见同目录 OWNER_HAND_PATH.md，验收不覆盖）
  const evidenceDir = path.join(appRoot, 'scripts', '_external-capability-owner-path-evidence');
  await fsp.mkdir(evidenceDir, { recursive: true });
  await fsp.writeFile(path.join(evidenceDir, 'authorized-project-brief.md'), await fsp.readFile(allowedFile));
  await fsp.writeFile(path.join(evidenceDir, 'unauthorized-secret.md'), await fsp.readFile(secretFile));
  const handPath = path.join(evidenceDir, 'OWNER_HAND_PATH.md');
  if (!fs.existsSync(handPath)) {
    fail('OWNER_HAND_PATH.md missing');
  }
  const handText = fs.readFileSync(handPath, 'utf8');
  if (!/start:reference-research-agent/.test(handText)) {
    fail('OWNER_HAND_PATH must document npm run start:reference-research-agent');
  }
  if (!/verify:reference-research-agent/.test(handText)) {
    fail('OWNER_HAND_PATH must document verify:reference-research-agent');
  }
  if (!/协作/.test(handText) || !/服务地址/.test(handText) || !/检查连接/.test(handText)) {
    fail('OWNER_HAND_PATH must document collab connect flow');
  }
  if (/打开「设置」|设置 →「外部|在设置中连接|进入「设置」/.test(handText)) {
    fail('OWNER_HAND_PATH must not require Settings for connection');
  }
  if (/设置 `DIGITALME_V2_A2A_RESEARCH_BASE_URL`|export DIGITALME|\$env:DIGITALME|编辑 \.env|修改 \.env/.test(handText)) {
    fail('OWNER_HAND_PATH must not require env/.env setup');
  }
  ok('OWNER_HAND_PATH documents collab-driven connect (no settings/env)');

  const preview = previewExternalAuthorization({
    goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
    allowedMaterialPaths: [allowedFile],
  });
  if (preview.projection.allowRemotePersist !== false) throw new Error('persist default');
  if (preview.projection.allowRedelegate !== false) throw new Error('redelegate default');

  async function withPeerRuntime(peerOpts, runtimeOpts, fn) {
    const peer = await startControlledRemotePeer({ processDelayMs: 40, ...peerOpts });
    const runtime = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      remoteCapability: {
        endpoint: peer.baseUrl,
        allowedEndpoints: [peer.baseUrl],
        timeoutMs: 15_000,
        maxCallsPerTask: 3,
        pollIntervalMs: 30,
        ...runtimeOpts,
      },
    });
    try {
      return await fn(runtime, peer);
    } finally {
      try {
        runtime.workRuntime.stop();
      } catch {
        /* ignore */
      }
      await peer.close();
    }
  }

  try {
    await withPeerRuntime({}, {}, async (runtime) => {
      await runtime.createPackage({
        displayName: 'Owner Path A',
        targetDir: pkgDir,
        initialSelfDescription: '产品负责人，重视可核对风险摘要',
      });
      const submitted = await runtime.submitTask({
        goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
        contextRefs: [{ kind: 'file', path: allowedFile }],
        requestedArtifactType: 'document',
        capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
      });
      const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 30_000);
      if (job.status !== 'succeeded') {
        throw new Error(`happy expected succeeded, got ${job.status}: ${job.failure?.actionable}`);
      }
      const detail = await runtime.getTask({ taskId: submitted.taskId });
      if (detail.userFacingLabel !== '已返回成果') {
        throw new Error(`label=${detail.userFacingLabel}`);
      }
      const artId = detail.artifactIds[0];
      if (!artId) throw new Error('missing artifact');
      const art = await runtime.getArtifact(artId);
      if (!art) throw new Error('artifact missing');
      const versionId = art.headVersionId;
      if (!versionId) throw new Error('missing head version');
      const content = await runtime.getContent({ artifactId: artId, versionId });
      const text = String(content.text || '');
      if (/SECRET_UNAUTHORIZED_PAYLOAD_XYZ/.test(text)) throw new Error('unauthorized leaked');
      // 投影隔离：未勾选/未授权路径不得进入 allowedMaterials
      const previewIso = previewExternalAuthorization({
        goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
        allowedMaterialPaths: [allowedFile],
      });
      if (previewIso.projection.allowedMaterials.some((p) => /UNAUTHORIZED-SECRET/i.test(p))) {
        throw new Error('projection included unauthorized material');
      }
      if (!fs.readFileSync(secretFile, 'utf8').includes('SECRET_UNAUTHORIZED_PAYLOAD_XYZ')) {
        throw new Error('fixture secret missing');
      }
      await runtime.captureSubjectInput({
        text: '采用已连接的研究分析能力返回的成果',
        sourceKind: 'artifact_acceptance',
        taskId: submitted.taskId,
        artifactId: artId,
        artifactVersionId: versionId,
        requestedArtifactType: 'document',
      });
      await runtime.captureSubjectInput({
        text: '不采用外部专业能力返回的成果（审计保留）',
        sourceKind: 'artifact_rejection',
        taskId: submitted.taskId,
        artifactId: artId,
        artifactVersionId: versionId,
        requestedArtifactType: 'document',
      });
      ok('domain happy + accept/reject + unauthorized isolation');
    });

    await withPeerRuntime({ defaultFault: 'delay_complete', processDelayMs: 200 }, {}, async (runtime) => {
      await runtime.openPackage({ dir: pkgDir });
      const submitted = await runtime.submitTask({
        goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
        contextRefs: [{ kind: 'file', path: allowedFile }],
        requestedArtifactType: 'document',
        capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
      });
      await new Promise((r) => setTimeout(r, 80));
      await runtime.cancelJob({ jobId: submitted.jobId });
      const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
      if (job.status !== 'cancelled') {
        throw new Error(`cancel expected cancelled, got ${job.status}`);
      }
      const detail = await runtime.getTask({ taskId: submitted.taskId });
      if (detail.userFacingLabel !== '已取消') throw new Error(`cancel label=${detail.userFacingLabel}`);
      if (detail.artifactIds.length) throw new Error('late artifact written');
      await new Promise((r) => setTimeout(r, 900));
      const again = await runtime.getTask({ taskId: submitted.taskId });
      if (again.latestJob.status !== 'cancelled') throw new Error('cancelled resurrected');
      if (again.artifactIds.length) throw new Error('late artifact after cancel');
      ok('domain cancel + late result rejected');
    });

    await withPeerRuntime({ defaultFault: 'malformed_artifact' }, {}, async (runtime) => {
      await runtime.openPackage({ dir: pkgDir });
      const submitted = await runtime.submitTask({
        goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
        contextRefs: [{ kind: 'file', path: allowedFile }],
        requestedArtifactType: 'document',
        capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
      });
      const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
      if (job.status !== 'failed') throw new Error('verify fail expected failed');
      const detail = await runtime.getTask({ taskId: submitted.taskId });
      if (detail.userFacingLabel !== '未完成') throw new Error(`verify label=${detail.userFacingLabel}`);
      const actionable = String(detail.latestJob.actionable || '');
      if (/A2A|stack|sk-|Bearer/i.test(actionable)) throw new Error(`unsafe actionable: ${actionable}`);
      if (detail.artifactIds.length) throw new Error('failed verify must not write artifact');
      ok('domain verification failure');
    });

    await withPeerRuntime(
      { defaultFault: 'never_complete' },
      { timeoutMs: 300 },
      async (runtime) => {
        await runtime.openPackage({ dir: pkgDir });
        const submitted = await runtime.submitTask({
          goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
          contextRefs: [{ kind: 'file', path: allowedFile }],
          requestedArtifactType: 'document',
          capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
        });
        const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
        if (job.status !== 'failed') throw new Error('timeout expected failed');
        const detail = await runtime.getTask({ taskId: submitted.taskId });
        const actionable = String(detail.latestJob.actionable || '');
        if (
          actionable !== EXTERNAL_CAPABILITY_FAILURE.timeout &&
          !/超时|未在限定时间/.test(actionable)
        ) {
          throw new Error(`timeout actionable=${actionable}`);
        }
        ok('domain timeout');
      },
    );

    // restart recover
    {
      const peer = await startControlledRemotePeer({
        processDelayMs: 80,
        defaultFault: 'delay_complete',
      });
      const runtime = createDigitalMeRuntime({
        documentCapability: 'none',
        registerOpenAiStub: false,
        remoteCapability: {
          endpoint: peer.baseUrl,
          allowedEndpoints: [peer.baseUrl],
          timeoutMs: 20_000,
          maxCallsPerTask: 3,
          pollIntervalMs: 30,
        },
      });
      await runtime.openPackage({ dir: pkgDir });
      const submitted = await runtime.submitTask({
        goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
        contextRefs: [{ kind: 'file', path: allowedFile }],
        requestedArtifactType: 'document',
        capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
      });
      await new Promise((r) => setTimeout(r, 100));
      runtime.workRuntime.stop();

      const runtime2 = createDigitalMeRuntime({
        documentCapability: 'none',
        registerOpenAiStub: false,
        remoteCapability: {
          endpoint: peer.baseUrl,
          allowedEndpoints: [peer.baseUrl],
          timeoutMs: 20_000,
          maxCallsPerTask: 3,
          pollIntervalMs: 30,
        },
      });
      await runtime2.openPackage({ dir: pkgDir });
      const job = await waitForJobTerminal(runtime2.workRuntime, submitted.jobId, 30_000);
      if (job.id !== submitted.jobId) throw new Error('duplicate job after restart');
      if (job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'cancelled') {
        throw new Error(`restart unexpected status ${job.status}`);
      }
      const listed = await runtime2.listTasks({ limit: 50 });
      const same = listed.tasks.filter((t) => t.taskId === submitted.taskId);
      if (same.length !== 1) throw new Error('task duplicated');
      runtime2.workRuntime.stop();
      await peer.close();
      ok('domain restart recover without duplicate job');
    }

    {
      const runtime = createDigitalMeRuntime({
        documentCapability: 'none',
        registerOpenAiStub: false,
      });
      await runtime.openPackage({ dir: pkgDir });
      const listed = await runtime.listCapabilities({
        includeAvailability: true,
        previewAuthorization: {
          goal: '请根据已授权材料，形成 500–800 字结构化项目风险摘要。',
          allowedMaterialPaths: [allowedFile],
        },
      });
      if (!listed.authorizationPreview) throw new Error('missing authorizationPreview');
      if (!listed.externalCapabilityCard) throw new Error('missing card');
      if (listed.externalCapabilityCard.available) {
        throw new Error('should be unavailable without adapter');
      }
      if (!/尚未连接|不可用|无法使用/.test(listed.externalCapabilityCard.availabilityLabel)) {
        throw new Error(`avail label=${listed.externalCapabilityCard.availabilityLabel}`);
      }
      runtime.workRuntime.stop();
      ok('domain credential/unavailable card + projection preview');
    }
  } finally {
    try {
      await fsp.rm(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

runConnectionSettingsPath()
  .then(() => runDomainOwnerPath())
  .then(() => {
    console.log('\nPASS: accept:external-capability-owner-path');
  })
  .catch((err) => {
    console.error(err);
    fail(err.message || String(err));
  });
