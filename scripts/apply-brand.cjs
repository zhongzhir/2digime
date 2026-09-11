#!/usr/bin/env node
/**
 * Materialize brand into electron/brand.json + electron-builder.brand.yml for one build.
 * Usage: node scripts/apply-brand.cjs --brand=tujimi|demo-telecom
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function main() {
  const brandId = argValue('brand', process.env.DIGITALME_BRAND || 'tujimi');
  const brandFile = path.join(root, 'brands', brandId, 'brand.json');
  if (!fs.existsSync(brandFile)) {
    console.error(JSON.stringify({ ok: false, error: 'brand_not_found', brandId }));
    process.exit(1);
  }
  const brand = JSON.parse(fs.readFileSync(brandFile, 'utf8'));
  const iconIco = path.resolve(root, brand.iconIco || 'electron/build-resources/icon.ico');
  const iconPng = path.resolve(root, brand.iconPng || 'electron/build-resources/icon.png');
  if (!fs.existsSync(iconIco) && !fs.existsSync(iconPng)) {
    console.error(JSON.stringify({ ok: false, error: 'icon_missing', iconIco, iconPng }));
    process.exit(1);
  }
  const icon = fs.existsSync(iconIco) ? iconIco : iconPng;

  // Runtime brand (packaged via electron/**)
  const runtimeBrand = { ...brand };
  delete runtimeBrand.iconIco;
  delete runtimeBrand.iconPng;
  fs.writeFileSync(
    path.join(root, 'electron', 'brand.json'),
    `${JSON.stringify(runtimeBrand, null, 2)}\n`,
    'utf8',
  );

  // Early renderer brand so white-label UI does not flash official strings before boot IPC.
  const runtimeJs = `window.__digitalMeBrand = ${JSON.stringify(publicView(runtimeBrand))};\n`;
  fs.writeFileSync(path.join(root, 'electron', 'renderer', 'brand.runtime.js'), runtimeJs, 'utf8');

  function publicView(b) {
    return {
      id: b.id,
      productName: b.productName,
      organizationName: b.organizationName,
      supportText: b.supportText || '',
      supportUrl: b.supportUrl || '',
      themeTokens: b.themeTokens || {},
      institutionDefaults: {
        organizationName: (b.institutionDefaults && b.institutionDefaults.organizationName) || '',
        backendBaseUrl: (b.institutionDefaults && b.institutionDefaults.backendBaseUrl) || '',
      },
      strings: b.strings || {},
    };
  }

  const builder = {
    appId: brand.appId,
    productName: brand.productName,
    copyright: brand.copyright || brand.productName,
    directories: {
      output: 'release-staging/_default',
      buildResources: 'electron/build-resources',
    },
    files: [
      'dist/**/*',
      'electron/**/*',
      'package.json',
      'build-meta.json',
      '!**/*.map',
      '!scripts/**',
      '!**/.runtime-model-credential.json',
      '!**/secrets*.json',
    ],
    asar: true,
    extraFiles: [{ from: 'trial/试用说明.txt', to: '试用说明.txt' }],
    extraMetadata: { main: 'electron/main.cjs' },
    win: {
      signAndEditExecutable: false,
      icon,
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'zip', arch: ['x64'] },
      ],
      artifactName: '${productName}-${version}-public-alpha-win-x64.${ext}',
    },
    afterPack: 'scripts/after-pack-win-icon.cjs',
    nsis: {
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: false,
      createDesktopShortcut: 'always',
      createStartMenuShortcut: true,
      shortcutName: brand.productName,
      uninstallDisplayName: brand.productName,
      deleteAppDataOnUninstall: false,
      installerIcon: icon,
      uninstallerIcon: icon,
      installerHeaderIcon: icon,
      include: 'installer.nsh',
      artifactName: '${productName}-${version}-public-alpha-win-x64-setup.${ext}',
    },
    mac: {
      artifactName: '${productName}-${version}-mac-${arch}.zip',
      target: [{ target: 'zip', arch: ['x64'] }],
      category: 'public.app-category.productivity',
      identity: null,
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'electron/build-resources/entitlements.mac.plist',
      entitlementsInherit: 'electron/build-resources/entitlements.mac.plist',
      extendInfo: {
        CFBundleName: brand.productName,
        CFBundleDisplayName: brand.productName,
      },
    },
  };

  const outCfg = path.join(root, 'electron-builder.brand.json');
  fs.writeFileSync(outCfg, `${JSON.stringify(builder, null, 2)}\n`, 'utf8');

  // Env hints for afterPack
  const envFile = path.join(root, 'release-staging', '_brand-env.json');
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(
    envFile,
    `${JSON.stringify(
      {
        brandId: brand.id,
        productName: brand.productName,
        organizationName: brand.organizationName,
        icon,
        userDataDirName: brand.userDataDirName,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        brandId: brand.id,
        productName: brand.productName,
        appId: brand.appId,
        userDataDirName: brand.userDataDirName,
        runtimeBrand: 'electron/brand.json',
        builderConfig: 'electron-builder.brand.json',
        icon,
      },
      null,
      2,
    ),
  );
}

main();
