"use strict";
/**
 * Embed product name + icon into the Windows exe without winCodeSign
 * (winCodeSign extract needs symlink privilege on many Windows setups).
 */
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(
    context.packager.projectDir,
    "electron",
    "build-resources",
    "icon.ico",
  );
  const { rcedit } = await import("rcedit");
  await rcedit(exePath, {
    icon: iconPath,
    "version-string": {
      FileDescription: "兔机米",
      ProductName: "兔机米",
      CompanyName: "兔机米",
      LegalCopyright: "兔机米",
      OriginalFilename: exeName,
      InternalName: "兔机米",
    },
    "file-version": context.packager.appInfo.version,
    "product-version": context.packager.appInfo.version,
  });
};
