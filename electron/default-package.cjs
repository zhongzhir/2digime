'use strict';
/**
 * 默认工作包：userData/subjects/default
 * 主进程幂等挂载；不得为每个命令新建包。
 */
const fs = require('node:fs');
const path = require('node:path');

function resolveDefaultSubjectDir(userDataPath) {
  return path.join(userDataPath, 'subjects', 'default');
}

function defaultPackageExists(userDataPath) {
  return fs.existsSync(path.join(resolveDefaultSubjectDir(userDataPath), 'manifest.json'));
}

/**
 * @param {{
 *   runtime: {
 *     isPackageAttached?: () => boolean,
 *     openPackage: (input: { dir: string }) => Promise<unknown>,
 *     createPackage: (input: { displayName: string, targetDir: string }) => Promise<unknown>,
 *   },
 *   userDataPath: string,
 *   displayName?: string,
 * }} opts
 */
async function ensureDefaultPackageAttached(opts) {
  const runtime = opts && opts.runtime;
  const userDataPath = opts && opts.userDataPath;
  if (!runtime || !userDataPath) {
    return { ok: false, reason: 'no_runtime_or_userData' };
  }
  const dir = resolveDefaultSubjectDir(userDataPath);
  if (typeof runtime.isPackageAttached === 'function' && runtime.isPackageAttached()) {
    return { ok: true, created: false, alreadyAttached: true, dir };
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const exists = defaultPackageExists(userDataPath);
  try {
    if (exists) {
      await runtime.openPackage({ dir });
      return { ok: true, created: false, dir };
    }
    await runtime.createPackage({
      displayName: (opts && opts.displayName) || '我的数字之我',
      targetDir: dir,
    });
    return { ok: true, created: true, dir };
  } catch (err) {
    return {
      ok: false,
      reason: String(err && err.message ? err.message : err),
      dir,
    };
  }
}

function countSubjectPackages(userDataPath) {
  const subjects = path.join(userDataPath, 'subjects');
  if (!fs.existsSync(subjects)) return 0;
  return fs
    .readdirSync(subjects, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && fs.existsSync(path.join(subjects, d.name, 'manifest.json')),
    ).length;
}

const USER_FACING_ATTACH_FAILED =
  'Digital Me 暂时无法开始这项任务，请重新打开应用后重试。';

function sanitizeCommandError(err) {
  const msg = String(err && err.message ? err.message : err || '');
  if (
    /work runtime not attached|artifact workspace not attached|no active subject|open or create a package|runtime not ready|command not exposed|Error invoking remote method|command:invoke/i.test(
      msg,
    )
  ) {
    return Object.assign(new Error(USER_FACING_ATTACH_FAILED), {
      code: (err && err.code) || 'PACKAGE_ATTACH_FAILED',
    });
  }
  return err;
}

module.exports = {
  resolveDefaultSubjectDir,
  defaultPackageExists,
  ensureDefaultPackageAttached,
  countSubjectPackages,
  sanitizeCommandError,
  USER_FACING_ATTACH_FAILED,
};
