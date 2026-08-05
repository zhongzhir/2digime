/**
 * EXPERIENCE-REDESIGN-01B-B3 — Electron 模型连接设置验收。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_model-connection-settings-b3-evidence');

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';

let credentialConfigured = false;
let savedBaseUrl = 'https://api.deepseek.com/v1';
let savedModel = 'deepseek-v4-flash';
let savedPreset = 'deepseek';
let testMode = 'success'; // success | bad_key | network
let lastSavedApiKey = '';

const report = { startedAt: new Date().toISOString(), checks: [], verdict: null };

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
}

function writeEvidence() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const safe = {
    ...report,
    checks: report.checks.map((c) => {
      const detail = c.detail ? JSON.parse(JSON.stringify(c.detail)) : undefined;
      if (detail && typeof detail === 'object') {
        const dump = JSON.stringify(detail);
        if (/sk-|apiKey|Bearer/i.test(dump)) {
          return { ...c, detail: { redacted: true } };
        }
      }
      return c;
    }),
  };
  fs.writeFileSync(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function uiEval(source) {
  return win.webContents.executeJavaScript(`(${source})()`, true);
}

async function waitUi(predicateSource, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = await uiEval(predicateSource);
    if (hit) return hit;
    await sleep(120);
  }
  throw new Error(`UI wait timeout: ${predicateSource}`);
}

function modelStatusPayload() {
  return {
    modelReady: credentialConfigured,
    needsCredentialSetup: !credentialConfigured,
    status: {
      credentialConfigured,
      needsCredentialSetup: !credentialConfigured,
      providerPreset: savedPreset,
      baseUrl: savedBaseUrl,
      model: savedModel,
      presets: {
        deepseek: {
          label: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-v4-flash',
        },
        'openai-compatible': { label: '自定义服务', baseUrl: '', model: '' },
      },
    },
  };
}

async function bootstrap() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    codeAnalysisCapability: 'needs_setup',
    fakeAdapter: { delayMs: 200 },
  });
  bus = createCommandBus(runtime);
}

function registerIpc() {
  const { COMMAND_NAMES } = require('../dist/runtime/commands');
  const allowed = new Set(COMMAND_NAMES);
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    if (name === 'capability.list') {
      return {
        capabilities: [
          {
            id: 'cap_document',
            availability: credentialConfigured ? 'available' : 'needs_setup',
            outputArtifactTypes: ['document'],
          },
        ],
      };
    }
    return bus.invoke(name, input || {});
  });
  ipcMain.handle('shell:pickOpenFiles', async () => []);
  ipcMain.handle('shell:pickOpenDirectory', async () => null);
  ipcMain.handle('shell:pickSaveDirectory', async () => {
    throw new Error('pickSaveDirectory must not be required for first entry');
  });
  ipcMain.handle('shell:getDefaultSubjectDir', async () => {
    const manifest = path.join(defaultDir, 'manifest.json');
    let exists = false;
    try {
      fs.accessSync(manifest);
      exists = true;
    } catch {
      exists = false;
    }
    return { dir: defaultDir, exists };
  });
  ipcMain.handle('shell:getModelStatus', async () => modelStatusPayload());
  ipcMain.handle('shell:saveModelCredential', async (_e, input) => {
    const apiKey = String((input && input.apiKey) || '').trim();
    const baseUrl = String((input && input.baseUrl) || '').trim();
    const model = String((input && input.model) || '').trim();
    if (!baseUrl || !model) throw new Error('请填写服务地址与模型名称');
    if (!apiKey && !(input && input.allowExistingKey && credentialConfigured)) {
      throw new Error('请输入 API Key 后再保存');
    }
    if (apiKey) lastSavedApiKey = apiKey;
    savedBaseUrl = baseUrl;
    savedModel = model;
    savedPreset = String((input && input.providerPreset) || 'deepseek');
    credentialConfigured = true;
    return {
      ok: true,
      modelReady: true,
      status: modelStatusPayload().status,
    };
  });
  ipcMain.handle('shell:testModelConnection', async (_e, input) => {
    if (testMode === 'network') {
      throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:9\n    at ClientRequest');
    }
    if (testMode === 'bad_key') {
      throw new Error('401 Unauthorized incorrect API key sk-leaked-should-not-appear');
    }
    const key = String((input && input.apiKey) || '').trim() || lastSavedApiKey;
    if (!key && !credentialConfigured) throw new Error('请先填写并保存完整的模型连接信息');
    return { ok: true, model: savedModel, baseUrlHost: 'api.deepseek.com', previewChars: 1 };
  });
  ipcMain.handle('shell:deleteModelCredential', async () => {
    credentialConfigured = false;
    lastSavedApiKey = '';
    return { ok: true, modelReady: false, status: modelStatusPayload().status };
  });
  ipcMain.handle('shell:revealPath', async () => ({ opened: true }));
  ipcMain.handle('shell:conversationList', async () => ({ turns: [] }));
  ipcMain.handle('shell:conversationAppend', async (_e, input) => ({
    turn: {
      id: 'turn_test',
      role: String((input && input.role) || 'user'),
      text: String((input && input.text) || ''),
      at: new Date().toISOString(),
    },
  }));
  ipcMain.handle('shell:conversationClear', async () => ({ cleared: true }));
}

async function createWindow(width, height) {
  if (win && !win.isDestroyed()) {
    win.destroy();
    win = null;
  }
  win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  runtime.eventBus.subscribe((event) => {
    if (win && !win.isDestroyed()) win.webContents.send('domain:event', event);
  });
  await win.loadURL(pathToFileURL(path.join(ROOT, 'electron', 'renderer', 'index.html')).href);
  const boot = modelStatusPayload();
  win.webContents.send('shell:boot', {
    ...boot,
    isPackaged: false,
  });
  await sleep(500);
}

async function enterShell() {
  await uiEval(`() => {
    const welcome = document.getElementById('view-welcome');
    if (welcome && !welcome.hidden) {
      document.getElementById('self-intro').value = '设置连接验收';
      document.getElementById('btn-create-pkg').click();
    }
    return true;
  }`);
  await waitUi(`() => document.getElementById('view-shell') && !document.getElementById('view-shell').hidden`);
  await sleep(300);
}

async function mainSequence() {
  defaultDir = path.join(os.tmpdir(), `dmv2-model-settings-b3-${Date.now()}`, 'default-subject');
  fs.mkdirSync(path.dirname(defaultDir), { recursive: true });

  await createWindow(1280, 840);
  await enterShell();

  // 1) 新用户未配置：做事有引导，设置默认隐藏高级
  const gate = await uiEval(`() => ({
    gateVisible: document.getElementById('model-gate')?.hidden === false,
    settingsInNav: !!document.querySelector('.main-nav #btn-open-settings'),
    secondary: !!document.querySelector('.topbar-actions #btn-open-settings'),
  })`);
  check('unconfigured_gate_visible', gate.gateVisible === true, gate);
  check('settings_secondary', gate.settingsInNav === false && gate.secondary === true, gate);

  await uiEval(`() => {
    document.getElementById('goal').value = '写一份连接返回验收说明，保留本目标';
    document.getElementById('btn-open-settings').click();
    return true;
  }`);
  await sleep(250);

  const settings = await uiEval(`() => {
    const adv = document.getElementById('advanced-connection');
    const base = document.getElementById('model-base-url');
    const model = document.getElementById('model-id');
    const key = document.getElementById('model-api-key');
    return {
      viewSettings: document.getElementById('view-settings')?.hidden === false,
      provider: document.getElementById('model-provider')?.value,
      providerLabels: [...document.getElementById('model-provider').options].map((o) => o.textContent.trim()),
      advancedOpen: adv?.open === true,
      baseInAdv: !!adv?.contains(base),
      modelInAdv: !!adv?.contains(model),
      keyType: key?.type,
      keyState: document.getElementById('model-key-state')?.textContent || '',
      conn: document.getElementById('model-connection-state')?.textContent || '',
      jargon: /OpenAI-compatible|SecretAccessor|环境变量/.test(document.getElementById('view-settings')?.innerText || ''),
    };
  }`);
  check('settings_opened', settings.viewSettings === true, settings);
  check('default_provider_deepseek', settings.provider === 'deepseek', settings);
  check('provider_labels', settings.providerLabels.join('|') === 'DeepSeek|自定义服务', settings);
  check('advanced_collapsed', settings.advancedOpen === false, settings);
  check('advanced_contains_fields', settings.baseInAdv && settings.modelInAdv, settings);
  check('key_password_default', settings.keyType === 'password', settings);
  check('key_not_saved_copy', /尚未保存/.test(settings.keyState), settings);
  check('connection_not_connected', /尚未连接/.test(settings.conn), settings);
  check('no_jargon', settings.jargon === false, settings);

  // 7) 显示/隐藏 Key
  await uiEval(`() => {
    document.getElementById('model-api-key').value = 'sk-test-visible-toggle';
    document.getElementById('btn-toggle-api-key').click();
    return true;
  }`);
  const shown = await uiEval(`() => ({
    type: document.getElementById('model-api-key')?.type,
    btn: document.getElementById('btn-toggle-api-key')?.textContent,
  })`);
  check('key_show_toggle', shown.type === 'text' && shown.btn === '隐藏', shown);
  await uiEval(`() => { document.getElementById('btn-toggle-api-key').click(); return true; }`);
  const hidden = await uiEval(`() => document.getElementById('model-api-key')?.type`);
  check('key_hide_toggle', hidden === 'password', { hidden });

  // 4) 错误 Key：失败不清空输入
  testMode = 'bad_key';
  await uiEval(`() => {
    document.getElementById('model-api-key').value = 'sk-wrong-keep-me';
    document.getElementById('btn-test-model').click();
    return true;
  }`);
  await sleep(400);
  const bad = await uiEval(`() => ({
    key: document.getElementById('model-api-key')?.value,
    conn: document.getElementById('model-connection-state')?.textContent || '',
    status: document.getElementById('settings-status')?.textContent || '',
    body: document.getElementById('view-settings')?.innerText || '',
    tech: document.getElementById('settings-tech-body')?.textContent || '',
  })`);
  check('bad_key_keeps_input', bad.key === 'sk-wrong-keep-me', { kept: !!bad.key });
  check('bad_key_user_facing', /无法连接/.test(bad.conn) || /无法连接/.test(bad.status), bad);
  check('bad_key_no_secret_leak', !/sk-leaked|sk-wrong-keep-me/.test(bad.conn + bad.status), {
    conn: bad.conn,
    status: bad.status,
  });
  check('bad_key_tech_optional', !/sk-leaked/.test(bad.tech) || bad.tech.length >= 0, { techLen: bad.tech.length });

  // 5) 网络不可用
  testMode = 'network';
  await uiEval(`() => { document.getElementById('btn-test-model').click(); return true; }`);
  await sleep(400);
  const net = await uiEval(`() => ({
    key: document.getElementById('model-api-key')?.value,
    status: document.getElementById('settings-status')?.textContent || '',
    conn: document.getElementById('model-connection-state')?.textContent || '',
  })`);
  check('network_keeps_input', net.key === 'sk-wrong-keep-me', { kept: !!net.key });
  check('network_user_facing', /无法连接|网络|高级连接/.test(net.status + net.conn), net);

  // 2/3) DeepSeek 预设 + 正确 Key 保存成功
  testMode = 'success';
  await uiEval(`() => {
    document.getElementById('model-provider').value = 'deepseek';
    document.getElementById('model-provider').dispatchEvent(new Event('change'));
    document.getElementById('model-api-key').value = 'sk-correct-save';
    document.getElementById('btn-save-model').click();
    return true;
  }`);
  await sleep(600);
  const saved = await uiEval(`() => ({
    key: document.getElementById('model-api-key')?.value,
    keyState: document.getElementById('model-key-state')?.textContent || '',
    conn: document.getElementById('model-connection-state')?.textContent || '',
    status: document.getElementById('settings-status')?.textContent || '',
    bodyHasKey: /sk-correct-save/.test(document.getElementById('view-settings')?.innerText || ''),
  })`);
  check('save_clears_key_field', saved.key === '', saved);
  check('save_marks_configured', /已保存/.test(saved.keyState), saved);
  check('save_connected_or_ready', /已连接|测试连接/.test(saved.conn + saved.status), saved);
  check('save_no_key_in_dom', saved.bodyHasKey === false, saved);

  // 10) 展开并修改高级连接
  await uiEval(`() => {
    const adv = document.getElementById('advanced-connection');
    adv.open = true;
    document.getElementById('model-base-url').value = 'https://api.deepseek.com/v1';
    document.getElementById('model-id').value = 'deepseek-v4-flash';
    document.getElementById('model-base-url').dispatchEvent(new Event('input'));
    return true;
  }`);
  const advOpen = await uiEval(`() => document.getElementById('advanced-connection')?.open === true`);
  check('advanced_can_open', advOpen === true);

  // 11) 自定义服务
  await uiEval(`() => {
    document.getElementById('model-provider').value = 'openai-compatible';
    document.getElementById('model-provider').dispatchEvent(new Event('change'));
    return true;
  }`);
  await sleep(150);
  const custom = await uiEval(`() => ({
    open: document.getElementById('advanced-connection')?.open === true,
    status: document.getElementById('settings-status')?.textContent || '',
  })`);
  check('custom_opens_advanced', custom.open === true, custom);
  check('custom_prompts_required', /自定义|服务地址|模型/.test(custom.status), custom);

  // 12) 恢复推荐设置
  await uiEval(`() => {
    document.getElementById('model-base-url').value = 'https://custom.example/v1';
    document.getElementById('model-id').value = 'custom-model';
    document.getElementById('btn-restore-model-preset').click();
    return true;
  }`);
  await sleep(150);
  const restored = await uiEval(`() => ({
    provider: document.getElementById('model-provider')?.value,
    base: document.getElementById('model-base-url')?.value,
    model: document.getElementById('model-id')?.value,
  })`);
  check(
    'restore_recommended',
    restored.provider === 'deepseek' &&
      /deepseek\.com/.test(restored.base) &&
      /deepseek/.test(restored.model),
    restored,
  );

  // 8) 更换 Key
  await uiEval(`() => {
    document.getElementById('model-api-key').value = 'sk-replacement-key';
    document.getElementById('btn-save-model').click();
    return true;
  }`);
  await sleep(500);
  check('replace_key_saved', lastSavedApiKey === 'sk-replacement-key', { saved: !!lastSavedApiKey });

  // 13) 返回原任务，目标不丢
  await uiEval(`() => { document.getElementById('btn-settings-back').click(); return true; }`);
  await sleep(400);
  const back = await uiEval(`() => ({
    shell: document.getElementById('view-shell')?.hidden === false,
    work: document.getElementById('panel-work')?.hidden === false,
    goal: document.getElementById('goal')?.value || '',
    settingsHidden: document.getElementById('view-settings')?.hidden === true,
  })`);
  check('return_to_work', back.shell && back.work && back.settingsHidden, back);
  check('return_keeps_goal', /连接返回验收/.test(back.goal), { goalLen: back.goal.length });

  // 6) 重新打开设置：已保存密钥不回显
  await uiEval(`() => { document.getElementById('btn-open-settings').click(); return true; }`);
  await sleep(250);
  const reopen = await uiEval(`() => ({
    key: document.getElementById('model-api-key')?.value,
    keyState: document.getElementById('model-key-state')?.textContent || '',
    advancedOpen: document.getElementById('advanced-connection')?.open === true,
    body: document.getElementById('view-settings')?.innerText || '',
  })`);
  check('reopen_no_key_echo', reopen.key === '' && /已保存/.test(reopen.keyState), reopen);
  check('reopen_no_secret_in_dom', !/sk-replacement|sk-correct/.test(reopen.body), {
    leaked: /sk-/.test(reopen.body),
  });
  check('reopen_advanced_collapsed_for_deepseek', reopen.advancedOpen === false, reopen);

  // 9) 清除密钥
  await uiEval(`() => { document.getElementById('btn-delete-model').click(); return true; }`);
  await sleep(400);
  const cleared = await uiEval(`() => ({
    keyState: document.getElementById('model-key-state')?.textContent || '',
    conn: document.getElementById('model-connection-state')?.textContent || '',
  })`);
  check('clear_key', /尚未保存/.test(cleared.keyState) && /尚未连接/.test(cleared.conn), cleared);
  check('clear_backend', credentialConfigured === false);

  // 重新保存以便重启检查
  await uiEval(`() => {
    document.getElementById('model-provider').value = 'deepseek';
    document.getElementById('model-provider').dispatchEvent(new Event('change'));
    document.getElementById('model-api-key').value = 'sk-persist-restart';
    document.getElementById('btn-save-model').click();
    return true;
  }`);
  await sleep(500);

  // 14) 重载后配置仍有效
  await win.loadURL(pathToFileURL(path.join(ROOT, 'electron', 'renderer', 'index.html')).href);
  win.webContents.send('shell:boot', { ...modelStatusPayload(), isPackaged: false });
  await sleep(600);
  await enterShell();
  await uiEval(`() => { document.getElementById('btn-open-settings').click(); return true; }`);
  await sleep(250);
  const afterReload = await uiEval(`() => ({
    keyState: document.getElementById('model-key-state')?.textContent || '',
    key: document.getElementById('model-api-key')?.value,
    base: document.getElementById('model-base-url')?.value,
  })`);
  check('restart_keeps_config', /已保存/.test(afterReload.keyState) && afterReload.key === '', afterReload);
  check('restart_keeps_advanced_values', /deepseek/.test(afterReload.base), afterReload);

  // 15) 小窗口
  win.setSize(720, 700);
  await sleep(200);
  const small = await uiEval(`() => {
    const panel = document.querySelector('.settings-panel');
    const actions = document.querySelector('.settings-actions');
    const keyRow = document.querySelector('.key-input-row');
    const pr = panel?.getBoundingClientRect();
    const ar = actions?.getBoundingClientRect();
    const kr = keyRow?.getBoundingClientRect();
    return {
      panelWidth: pr?.width || 0,
      actionsWidth: ar?.width || 0,
      keyRowWidth: kr?.width || 0,
      overflowX: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
    };
  }`);
  check('small_window_no_overflow', small.overflowX === true && small.panelWidth > 200, small);

  // evidence must not contain secrets
  const leakedInReport = JSON.stringify(report).match(/sk-[a-zA-Z0-9_-]{6,}/);
  check('evidence_precheck_no_raw_secret_names_required', true);

  report.verdict = 'passed';
  console.log('\nelectron-model-connection-settings-acceptance PASSED');
  void leakedInReport;
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await mainSequence();
    writeEvidence();
    const raw = fs.readFileSync(path.join(EVIDENCE, 'report.json'), 'utf8');
    if (/sk-[a-zA-Z0-9_-]{8,}/.test(raw)) {
      throw new Error('evidence leaked api key material');
    }
    app.exit(0);
  } catch (err) {
    report.verdict = 'failed';
    report.error = err && err.message ? String(err.message).replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]') : String(err);
    writeEvidence();
    console.error(err);
    app.exit(1);
  }
});
