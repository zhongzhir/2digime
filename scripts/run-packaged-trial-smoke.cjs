/**
 * PACKAGED-TRIAL-01：解压 ZIP → 空 userData 启动烟测（不导入密钥）。
 * 用法: node scripts/run-packaged-trial-smoke.cjs
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
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
      else if (/DigitalMeV2-.*-win-x64\.zip$/i.test(name)) return full;
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
      else if (/DigitalMeV2\.exe$/i.test(name)) return full;
    }
  }
  return null;
}

function main() {
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

  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    cwd: path.dirname(exe),
    env,
    stdio: 'ignore',
    shell: false,
    detached: true,
  });
  child.unref();

  const started = Date.now();
  const deadline = started + 20_000;
  const wait = () => {
    const localState = path.join(userData, 'Local State');
    const secrets = path.join(userData, 'secrets.v2.json');
    const modelCfg = path.join(userData, 'model-config.json');
    if (fs.existsSync(localState)) {
      if (fs.existsSync(secrets) || fs.existsSync(modelCfg)) {
        try {
          process.kill(child.pid);
        } catch {
          /* ignore */
        }
        fail('unexpected_model_secrets', { userData });
      }
      console.log(
        JSON.stringify({
          ok: true,
          zip: path.relative(root, zip),
          unpack,
          exe,
          userData,
          pid: child.pid,
        }),
      );
      return;
    }
    if (Date.now() > deadline) {
      try {
        process.kill(child.pid);
      } catch {
        /* ignore */
      }
      fail('window_did_not_start', { userData, unpack });
    }
    setTimeout(wait, 500);
  };
  wait();
}

main();
