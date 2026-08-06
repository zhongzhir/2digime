'use strict';
/**
 * 新环境首启证据：隔离 userData，禁止自动读 Owner 开发凭证。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'scripts', '_guided-validation-readiness-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

function makeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${String(s)}`, 'utf8'),
    decryptString: (b) => {
      const t = Buffer.from(b).toString('utf8');
      return t.startsWith('enc:') ? t.slice(4) : t;
    },
  };
}

async function main() {
  const { resolveModelConfig } = require(path.join(root, 'electron', 'bootstrap-secrets.cjs'));
  const runtimeCred = path.join(
    root,
    'scripts',
    '_mvp-p14-real-capability-evidence',
    '.runtime-model-credential.json',
  );

  const udBlocked = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-guided-fresh-block-'));
  const blocked = await resolveModelConfig({
    safeStorage: makeSafeStorage(),
    userDataPath: udBlocked,
    isPackaged: false,
    allowDevRuntimeFile: false,
  });

  const udAllowed = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-guided-fresh-allow-'));
  const allowed = await resolveModelConfig({
    safeStorage: makeSafeStorage(),
    userDataPath: udAllowed,
    isPackaged: false,
    allowDevRuntimeFile: true,
  });

  const packagedLike = await resolveModelConfig({
    safeStorage: makeSafeStorage(),
    userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-guided-fresh-pkg-')),
    isPackaged: true,
    allowDevRuntimeFile: false,
  });

  const report = {
    checkedAt: new Date().toISOString(),
    ownerDevCredentialFileExists: fs.existsSync(runtimeCred),
    cases: {
      allowDevRuntimeFile_false: {
        ok: blocked.ok === true,
        needsCredentialSetup: blocked.needsCredentialSetup === true,
        reason: blocked.reason || null,
      },
      allowDevRuntimeFile_true_dev_only: {
        ok: allowed.ok === true,
        needsCredentialSetup: allowed.needsCredentialSetup === true,
        reason: allowed.reason || null,
        note: '仅证明门控有效；产品默认不得开启',
      },
      packaged_like: {
        ok: packagedLike.ok === true,
        needsCredentialSetup: packagedLike.needsCredentialSetup === true,
        reason: packagedLike.reason || null,
      },
    },
    pass:
      blocked.ok === false &&
      blocked.needsCredentialSetup === true &&
      packagedLike.ok === false &&
      packagedLike.needsCredentialSetup === true &&
      // 开发凭证文件存在时，显式允许才会导入成功（若文件存在）
      (!fs.existsSync(runtimeCred) || allowed.ok === true),
  };

  fs.writeFileSync(
    path.join(evidenceDir, 'fresh-env-first-boot.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify({ ok: report.pass, report }, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
