/**
 * 双主体 Owner 目视启动器。
 * 同一 sessionRoot 下分别打开 A / B 的独立 userData（各自 subjects/default）。
 * 不新建包、不预注入协作结果；需先跑 accept:collaboration-real-loop-owner。
 *
 * 用法:
 *   node scripts/start-collaboration-real-loop-owner-electron.cjs --subject a --resume-session "<sessionRoot>"
 *   node scripts/start-collaboration-real-loop-owner-electron.cjs --subject b --resume-session "<sessionRoot>"
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'scripts', '_collaboration-real-loop-01-evidence');

function takeArg(argv, name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return '';
}

function resolveSession(argv) {
  const resume = takeArg(argv, '--resume-session');
  if (resume) return path.resolve(resume);
  try {
    const launch = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'owner-launch.json'), 'utf8'));
    if (launch.sessionRoot) return path.resolve(launch.sessionRoot);
  } catch {
    /* ignore */
  }
  return '';
}

function main() {
  const argv = process.argv.slice(2);
  const subject = String(takeArg(argv, '--subject') || 'a').toLowerCase();
  if (subject !== 'a' && subject !== 'b') {
    console.error('需要 --subject a 或 --subject b');
    process.exit(1);
  }
  const sessionRoot = resolveSession(argv);
  if (!sessionRoot || !fs.existsSync(sessionRoot)) {
    console.error(
      '需要有效 --resume-session <sessionRoot>，或先跑 npm run accept:collaboration-real-loop-owner',
    );
    process.exit(1);
  }
  const userData = path.join(sessionRoot, subject === 'a' ? 'subject-a' : 'subject-b');
  const pkg = path.join(userData, 'subjects', 'default');
  if (!fs.existsSync(path.join(pkg, 'manifest.json'))) {
    console.error(`主体包不存在: ${pkg}`);
    process.exit(1);
  }

  spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
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

  const peerPkg = path.join(
    sessionRoot,
    subject === 'a' ? 'subject-b' : 'subject-a',
    'subjects',
    'default',
  );
  const material = path.join(sessionRoot, 'materials', 'digital-me-project-notes.md');
  console.log(`COLLAB_OWNER_ELECTRON subject=${subject.toUpperCase()} userData=${userData}`);
  console.log(`package=${pkg}`);
  if (subject === 'a') {
    console.log(`协作对象包（B）: ${peerPkg}`);
    console.log(`材料: ${material}`);
  } else {
    console.log(`打开「协作」页查看来自 A 的请求；主按钮：接受 / 婉拒；接受后再点开始完成。`);
  }

  const mainEntry = path.join(root, 'electron', 'main.cjs');
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
