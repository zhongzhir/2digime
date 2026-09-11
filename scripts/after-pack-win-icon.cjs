"use strict";
/**
 * Embed product name + icon into the Windows exe without winCodeSign
 * (winCodeSign extract needs symlink privilege on many Windows setups).
 * Brand Kit: productName / icon come from release-staging/_brand-env.json
 * (written by scripts/apply-brand.cjs) or electron-builder appInfo.
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
  const { rcedit } = await import("rcedit");
  await rcedit(exePath, {
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
