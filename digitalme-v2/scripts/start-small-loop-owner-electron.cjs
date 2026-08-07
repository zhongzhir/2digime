/**
 * 同会话启动 Electron，便于 Owner 目视「最近学到的内容」。
 * 复用 run-small-loop-owner-acceptance 写入的 userData，不新建、不预注入。
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'scripts', '_small-loop-integration-01-evidence');

function takeResume(argv) {
  const eq = argv.find((a) => a.startsWith('--resume-session='));
  if (eq) return path.resolve(eq.slice('--resume-session='.length));
  const i = argv.indexOf('--resume-session');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  try {
    const launch = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'launch.json'), 'utf8'));
    if (launch.userData) return path.resolve(launch.userData);
  } catch {
    /* ignore */
  }
  return '';
}

function main() {
  const userData = takeResume(process.argv.slice(2));
  if (!userData || !fs.existsSync(userData)) {
    console.error('需要有效 --resume-session <userData>，或先跑 run-small-loop-owner-acceptance.cjs');
    process.exit(1);
  }

  spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  spawnSync(process.execPath, [path.join(root, 'scripts', 'electron-preflight.cjs')], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });

  let electronPath;
  try {
    electronPath = require('electron');
  } catch {
    console.error('electron 未安装');
    process.exit(1);
  }

  const mainEntry = path.join(root, 'electron', 'main.cjs');
  console.log(`SMALL_LOOP_OWNER_ELECTRON userData=${userData}`);
  const child = spawn(electronPath, [`--user-data-dir=${userData}`, mainEntry], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      DIGITALME_V2_ROOT: root,
    },
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code || 0);
  });
}

main();
