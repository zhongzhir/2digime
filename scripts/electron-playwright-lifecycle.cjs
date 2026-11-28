'use strict';

/**
 * Slice 5 release preflight: launch the real Electron main entry through
 * Playwright, observe the first renderer window, and prove bounded shutdown.
 * It uses an isolated temporary userData directory and never reads the
 * Owner's installed profile.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.resolve(os.tmpdir());
let app = null;
let electronPid = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function assertOwnedTempDir(dir) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith('dmv2-release-preflight-')) {
    throw new Error(`refusing to clean non-owned temp directory: ${resolved}`);
  }
}

async function removeOwnedTempDir(dir) {
  assertOwnedTempDir(dir);
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      if (!fs.existsSync(dir)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250 * (attempt + 1));
  }
  throw lastError || new Error(`temporary userData still exists: ${dir}`);
}

async function boundedClose() {
  if (!app) return { forced: false, elapsedMs: 0 };
  const startedAt = Date.now();
  let closed = false;
  await Promise.race([
    app.close().then(() => {
      closed = true;
    }).catch(() => undefined),
    sleep(15_000),
  ]);
  for (let i = 0; i < 20 && isAlive(electronPid); i += 1) await sleep(250);
  const forced = !closed || isAlive(electronPid);
  if (forced) {
    killTree(electronPid);
    for (let i = 0; i < 20 && isAlive(electronPid); i += 1) await sleep(250);
  }
  app = null;
  return { forced, elapsedMs: Date.now() - startedAt };
}

async function main() {
  const userData = fs.mkdtempSync(path.join(tempRoot, 'dmv2-release-preflight-'));
  const startedAt = Date.now();
  let closeResult = { forced: false, elapsedMs: 0 };
  try {
    const { _electron } = require('playwright');
    const electronPath = require('electron');
    if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
      throw new Error('electron binary is unavailable');
    }
    const mainEntry = path.join(root, 'electron', 'main.cjs');
    const constrainedWindows =
      process.platform === 'win32' &&
      (Boolean(process.env.CODEX_PERMISSION_PROFILE) || process.env.DIGITALME_V2_ELECTRON_NO_SANDBOX === '1');
    const args = constrainedWindows ? ['--no-sandbox', '--disable-gpu', mainEntry] : [mainEntry];
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/API_KEY|OPENAI|ANTHROPIC|DEEPSEEK|MINIMAX/i.test(key)) delete env[key];
    }
    Object.assign(env, {
      DIGITALME_V2_ROOT: root,
      DIGITALME_V2_USER_DATA: userData,
      DIGITALME_V2_ELECTRON_TEST: '1',
      DIGITALME_V2_UX_ACCEPTANCE: '1',
      DIGITALME_V2_SEARCH_ENABLED: '0',
      DIGITALME_V2_EXPORT_DELAY_MS: '0',
    });
    delete env.NODE_TEST_CONTEXT;

    app = await _electron.launch({
      executablePath: electronPath,
      args,
      cwd: root,
      env,
      timeout: 120_000,
    });
    electronPid = app.process().pid;
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });
    await page.locator('#view-welcome, #view-shell').first().waitFor({ state: 'attached', timeout: 30_000 });
    const title = await page.title();
    closeResult = await boundedClose();
    if (closeResult.forced) throw new Error('Electron did not close cleanly within the release timeout');
    await removeOwnedTempDir(userData);
    console.log(JSON.stringify({
      ok: true,
      mainEntry: path.relative(root, mainEntry),
      title,
      pid: electronPid,
      startupMs: Date.now() - startedAt - closeResult.elapsedMs,
      closeMs: closeResult.elapsedMs,
      userDataRemoved: !fs.existsSync(userData),
      constrainedWindows,
    }));
  } catch (error) {
    closeResult = await boundedClose();
    try {
      await removeOwnedTempDir(userData);
    } catch {
      // The primary failure remains authoritative; cleanup detail is reported below.
    }
    console.error(JSON.stringify({
      ok: false,
      error: String(error && error.stack ? error.stack : error),
      pid: electronPid,
      forcedClose: closeResult.forced,
      userDataRemoved: !fs.existsSync(userData),
    }));
    process.exitCode = 1;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killTree(electronPid);
    process.exit(1);
  });
}

void main();
