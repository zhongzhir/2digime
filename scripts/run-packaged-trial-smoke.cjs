/**
 * PACKAGED-TRIAL-01：解压 ZIP → 空 userData 启动烟测（不导入密钥）。
 * 用法: node scripts/run-packaged-trial-smoke.cjs
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function fail(msg, extra) {
  console.error(JSON.stringify({ ok: false, error: msg, ...(extra || {}) }));
  process.exit(1);
}

function latestStaging() {
  const base = path.join(root, 'release-staging');
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .filter((n) => n.startsWith('v2-') && fs.statSync(path.join(base, n)).isDirectory())
    .filter((n) => !fs.existsSync(path.join(base, n, 'REJECTED')))
    .sort();
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}

function findZip(staging) {
  const stack = [staging];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else if (/兔机米-.*-win-x64\.zip$/i.test(name) || /.*-win-x64\.zip$/i.test(name)) return full;
    }
  }
  return null;
}

function findExe(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (/兔机米\.exe$/i.test(name) || /\.exe$/i.test(name) && /win-unpacked/i.test(full)) return full;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeOwnedTempDir(dir, prefix) {
  const resolved = path.resolve(dir);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`refusing to clean non-owned temp directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const staging = process.env.DIGITALME_V2_STAGING || latestStaging();
  if (!staging) fail('no_staging_build');
  const zip = findZip(staging);
  if (!zip) fail('zip_missing', { staging });

  const unpack = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-trial-unpack-'));
  const unzip = spawnSync('tar', ['-xf', zip, '-C', unpack], { shell: false });
  if (unzip.status !== 0) fail('unzip_failed', { stderr: String(unzip.stderr || '') });

  const exe = findExe(unpack);
  if (!exe) fail('exe_missing_after_unzip', { unpack });
  const note = path.join(path.dirname(exe), '试用说明.txt');
  if (!fs.existsSync(note)) fail('trial_note_missing', { dir: path.dirname(exe) });

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-trial-ud-'));
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^DIGITALME_/.test(k) || /API_KEY|OPENAI|ANTHROPIC|DEEPSEEK|MINIMAX/.test(k)) delete env[k];
  }
  Object.assign(env, {
    DIGITALME_V2_USER_DATA: userData,
    DIGITALME_V2_HOME: userData,
  });
  delete env.NODE_TEST_CONTEXT;

  const { _electron } = require('playwright');
  const constrainedWindows =
    process.platform === 'win32' &&
    (Boolean(process.env.CODEX_PERMISSION_PROFILE) || process.env.DIGITALME_V2_ELECTRON_NO_SANDBOX === '1');
  const args = constrainedWindows ? ['--no-sandbox', '--disable-gpu'] : [];
  let app = null;
  let pid = null;
  try {
    app = await _electron.launch({
      executablePath: exe,
      args,
      cwd: path.dirname(exe),
      env,
      timeout: 120_000,
    });
    pid = app.process().pid;
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });
    await page.locator('#view-welcome, #view-shell').first().waitFor({ state: 'attached', timeout: 30_000 });
    let closed = false;
    await Promise.race([
      app.close().then(() => { closed = true; }),
      sleep(15_000),
    ]);
    if (!closed || isAlive(pid)) {
      killTree(pid);
      throw new Error('packaged app did not close cleanly within 15 seconds');
    }
    app = null;
    const secrets = path.join(userData, 'secrets.v2.json');
    const modelCfg = path.join(userData, 'model-config.json');
    if (fs.existsSync(secrets) || fs.existsSync(modelCfg)) {
      fail('unexpected_model_secrets', { userData });
    }
    removeOwnedTempDir(userData, 'dmv2-trial-ud-');
    removeOwnedTempDir(unpack, 'dmv2-trial-unpack-');
    console.log(JSON.stringify({
      ok: true,
      zip: path.relative(root, zip),
      exe: path.basename(exe),
      pid,
      userDataRemoved: !fs.existsSync(userData),
      unpackRemoved: !fs.existsSync(unpack),
      constrainedWindows,
    }));
  } catch (error) {
    if (app) {
      await Promise.race([app.close().catch(() => undefined), sleep(5_000)]);
    }
    killTree(pid);
    fail('packaged_window_smoke_failed', {
      error: String(error && error.stack ? error.stack : error),
      userData,
      unpack,
    });
  }
}

void main();
