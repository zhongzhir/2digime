"use strict";
/**
 * Embed product name + icon into the Windows exe without winCodeSign
 * (winCodeSign extract needs symlink privilege on many Windows setups).
 * Brand Kit: productName / icon come from release-staging/_brand-env.json
 * (written by scripts/apply-brand.cjs) or electron-builder appInfo.
 *
 * Retries once on Windows "Unable to commit changes" (exe briefly locked).
 */
const fs = require("node:fs");
const path = require("node:path");

function readBrandEnv(projectDir) {
  const file = path.join(projectDir, "release-staging", "_brand-env.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rceditWithRetry(exePath, options, attempts = 3) {
  const { rcedit } = await import("rcedit");
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await rcedit(exePath, options);
      return;
    } catch (err) {
      lastErr = err;
      const msg = String((err && err.message) || err);
      if (!/Unable to commit changes|EBUSY|EPERM|EACCES/i.test(msg) || i === attempts - 1) {
        throw err;
      }
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const projectDir = context.packager.projectDir;
  const brandEnv = readBrandEnv(projectDir);
  const productName =
    (brandEnv && brandEnv.productName) ||
    context.packager.appInfo.productName ||
    "兔机米";
  const organizationName =
    (brandEnv && brandEnv.organizationName) || productName;
  const iconPath =
    (brandEnv && brandEnv.icon && fs.existsSync(brandEnv.icon) && brandEnv.icon) ||
    path.join(projectDir, "electron", "build-resources", "icon.ico");
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  await rceditWithRetry(exePath, {
    icon: iconPath,
    "version-string": {
      FileDescription: productName,
      ProductName: productName,
      CompanyName: organizationName,
      LegalCopyright: organizationName,
      OriginalFilename: exeName,
      InternalName: productName,
    },
    "file-version": context.packager.appInfo.version,
    "product-version": context.packager.appInfo.version,
  });
};
