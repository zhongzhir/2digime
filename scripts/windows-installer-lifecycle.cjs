'use strict';

/**
 * Slice 5 Windows installer lifecycle gate.
 *
 * Sequence: existing install upgrade (or clean install + reinstall), uninstall,
 * data-retention check, final clean install, isolated installed-app smoke.
 * The script never deletes the Owner profile and never removes an install tree
 * itself; install-tree changes are delegated to the exact NSIS setup/uninstaller.
 */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const installDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'digitalme-v2');
const installedExe = path.join(installDir, '兔机米.exe');
const uninstaller = path.join(installDir, 'Uninstall 兔机米.exe');
const ownerUserData = path.join(process.env.APPDATA || '', 'digitalme-v2');
const evidenceDir = path.join(root, 'build', 'evidence', 'slice5-windows-lifecycle');
const reportFile = path.join(evidenceDir, 'report.json');

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function latestCandidate() {
  const base = path.join(root, 'release-staging');
  const dirs = fs.readdirSync(base)
    .filter((name) => name.startsWith('v2-') && fs.existsSync(path.join(base, name, 'integrity.json')))
    .sort();
  if (!dirs.length) throw new Error('no packaged candidate with integrity.json');
  const dir = path.join(base, dirs[dirs.length - 1]);
  const integrity = JSON.parse(fs.readFileSync(path.join(dir, 'integrity.json'), 'utf8'));
  const setup = path.join(root, integrity.setup.path);
  const unpackedExe = path.join(root, integrity.exe.path);
  if (!fs.existsSync(setup) || !fs.existsSync(unpackedExe)) throw new Error('candidate artifacts missing');
  if (sha256File(setup) !== integrity.setup.sha256 || sha256File(unpackedExe) !== integrity.exe.sha256) {
    throw new Error('candidate hash differs from integrity.json');
  }
  return { dir, integrity, setup, unpackedExe };
}

function shouldSkipProfilePath(relative) {
  const parts = relative.split(path.sep);
  const volatileDirs = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Crashpad']);
  if (parts.some((part) => volatileDirs.has(part))) return true;
  const name = parts[parts.length - 1] || '';
  return name === 'LOCK' || name === 'LOG' || name === 'LOG.old' || name.startsWith('Singleton');
}

function profileDigest(dir) {
  if (!fs.existsSync(dir)) return { exists: false, files: 0, bytes: 0, digest: null, skipped: 0 };
  const rows = [];
  let bytes = 0;
  let skipped = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(dir, full);
      if (shouldSkipProfilePath(relative)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(full);
        const hash = sha256File(full);
        rows.push(`${relative.replace(/\\/g, '/')}\0${stat.size}\0${hash}`);
        bytes += stat.size;
      } catch {
        skipped += 1;
      }
    }
  }
  rows.sort();
  return {
    exists: true,
    files: rows.length,
    bytes,
    digest: crypto.createHash('sha256').update(rows.join('\n')).digest('hex'),
    skipped,
  };
}

function runExact(executable, args, timeoutMs) {
  const result = spawnSync(executable, args, {
    cwd: path.dirname(executable),
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed: ${result.error ? result.error.message : `exit ${result.status}`}`);
  }
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function knownFolder(kind) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `[Environment]::GetFolderPath('${kind}')`], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(`cannot resolve Windows ${kind} folder`);
  return String(result.stdout || '').trim();
}

function assertProfileUnchanged(before, after, stage) {
  if (before.exists !== after.exists || before.files !== after.files || before.bytes !== after.bytes || before.digest !== after.digest) {
    throw new Error(`Owner userData changed during ${stage}`);
  }
}

async function installedSmoke() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-installed-smoke-'));
  const env = { ...process.env, DIGITALME_V2_USER_DATA: userData, DIGITALME_V2_HOME: userData };
  for (const key of Object.keys(env)) {
    if (/API_KEY|OPENAI|ANTHROPIC|DEEPSEEK|MINIMAX/i.test(key)) delete env[key];
  }
  delete env.NODE_TEST_CONTEXT;
  const { _electron } = require('playwright');
  const constrainedWindows = Boolean(process.env.CODEX_PERMISSION_PROFILE) || process.env.DIGITALME_V2_ELECTRON_NO_SANDBOX === '1';
  const app = await _electron.launch({
    executablePath: installedExe,
    args: constrainedWindows ? ['--no-sandbox', '--disable-gpu'] : [],
    cwd: installDir,
    env,
    timeout: 120_000,
  });
  const pid = app.process().pid;
  const page = await app.firstWindow({ timeout: 90_000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });
  await page.locator('#view-welcome, #view-shell').first().waitFor({ state: 'attached', timeout: 30_000 });
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return { pid, isolatedUserDataRemoved: !fs.existsSync(userData), constrainedWindows };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows only');
  const candidate = latestCandidate();
  fs.mkdirSync(evidenceDir, { recursive: true });
  const beforeProfile = profileDigest(ownerUserData);
  if (beforeProfile.skipped > 0) throw new Error('Owner userData contains unreadable retained files');
  const startedWithInstall = fs.existsSync(installedExe);
  const previousExeSha256 = startedWithInstall ? sha256File(installedExe) : null;

  runExact(candidate.setup, ['/S'], 240_000);
  waitFor(() => fs.existsSync(installedExe) && fs.existsSync(uninstaller), 60_000, 'candidate install');
  const afterUpgradeProfile = profileDigest(ownerUserData);
  assertProfileUnchanged(beforeProfile, afterUpgradeProfile, startedWithInstall ? 'upgrade' : 'initial clean install');
  if (sha256File(installedExe) !== candidate.integrity.exe.sha256) throw new Error('installed exe hash differs from candidate');

  // A second exact setup run exercises the same-identity upgrade/repair path even on a machine that began clean.
  runExact(candidate.setup, ['/S'], 240_000);
  waitFor(() => fs.existsSync(installedExe) && fs.existsSync(uninstaller), 60_000, 'candidate upgrade');
  const afterSecondInstallProfile = profileDigest(ownerUserData);
  assertProfileUnchanged(beforeProfile, afterSecondInstallProfile, 'candidate upgrade');

  runExact(uninstaller, ['/S'], 180_000);
  waitFor(() => !fs.existsSync(installedExe), 60_000, 'candidate uninstall');
  const afterUninstallProfile = profileDigest(ownerUserData);
  assertProfileUnchanged(beforeProfile, afterUninstallProfile, 'uninstall');

  runExact(candidate.setup, ['/S'], 240_000);
  waitFor(() => fs.existsSync(installedExe) && fs.existsSync(uninstaller), 60_000, 'final clean install');
  const afterFinalInstallProfile = profileDigest(ownerUserData);
  assertProfileUnchanged(beforeProfile, afterFinalInstallProfile, 'final clean install');
  const smoke = await installedSmoke();
  const afterSmokeProfile = profileDigest(ownerUserData);
  assertProfileUnchanged(beforeProfile, afterSmokeProfile, 'isolated installed-app smoke');

  const desktopShortcut = path.join(knownFolder('Desktop'), '兔机米.lnk');
  const startMenuShortcut = path.join(knownFolder('Programs'), '兔机米.lnk');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      buildId: candidate.integrity.buildId,
      gitHead: candidate.integrity.gitHead,
      setupSha256: candidate.integrity.setup.sha256,
      exeSha256: candidate.integrity.exe.sha256,
    },
    startedWithInstall,
    previousExeSha256,
    profile: {
      before: beforeProfile,
      afterUpgrade: afterUpgradeProfile,
      afterSecondInstall: afterSecondInstallProfile,
      afterUninstall: afterUninstallProfile,
      afterFinalInstall: afterFinalInstallProfile,
      afterSmoke: afterSmokeProfile,
      retained: true,
    },
    shortcuts: {
      desktop: fs.existsSync(desktopShortcut),
      startMenu: fs.existsSync(startMenuShortcut),
    },
    smoke,
    finalInstalled: fs.existsSync(installedExe),
    verdict: 'WINDOWS_INSTALL_UPGRADE_UNINSTALL_RETENTION_PASS',
  };
  if (!report.shortcuts.desktop || !report.shortcuts.startMenu || !report.finalInstalled) {
    throw new Error('final install shortcut or executable missing');
  }
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    verdict: report.verdict,
    reportFile: path.relative(root, reportFile),
    candidate: report.candidate,
    startedWithInstall,
    retainedFiles: beforeProfile.files,
    retainedBytes: beforeProfile.bytes,
    shortcuts: report.shortcuts,
    finalInstalled: report.finalInstalled,
    smoke,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
