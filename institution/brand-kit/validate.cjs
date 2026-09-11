#!/usr/bin/env node
/**
 * Brand Kit validation — schema + isolation + no-secrets.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const BRANDS = path.join(ROOT, 'brands');

const REQUIRED = [
  'id',
  'productName',
  'organizationName',
  'appId',
  'userDataDirName',
  'iconIco',
  'iconPng',
  'strings',
];

const STRING_KEYS = [
  'windowTitle',
  'navTalk',
  'talkTitle',
  'assistantRole',
  'openSourceNote',
];

const FORBIDDEN_IN_BRAND = [
  /sk-[A-Za-z0-9_\-]{8,}/i,
  /LITELLM_MASTER/i,
  /DEEPSEEK_API_KEY\s*[:=]/i,
  /BEGIN\s+PRIVATE\s+KEY/i,
  /password\s*[:=]\s*["'][^"']{4,}/i,
];

function loadBrand(id) {
  const file = path.join(BRANDS, id, 'brand.json');
  if (!fs.existsSync(file)) throw new Error(`missing brand: ${id}`);
  return { file, brand: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function validateOne(id) {
  const { file, brand } = loadBrand(id);
  for (const key of REQUIRED) {
    assert(brand[key] != null && brand[key] !== '', `${id}: missing ${key}`);
  }
  for (const key of STRING_KEYS) {
    assert(brand.strings && brand.strings[key], `${id}: missing strings.${key}`);
  }
  assert(/2digime/i.test(brand.strings.openSourceNote), `${id}: openSourceNote must retain 2digime`);
  const raw = fs.readFileSync(file, 'utf8');
  for (const re of FORBIDDEN_IN_BRAND) {
    assert(!re.test(raw), `${id}: forbidden secret-like content (${re})`);
  }
  const ico = path.resolve(ROOT, brand.iconIco);
  const png = path.resolve(ROOT, brand.iconPng);
  assert(fs.existsSync(ico) || fs.existsSync(png), `${id}: icon missing`);
  // Brand Kit must not carry Talk / Digital Self / provider / entitlement schemas
  const bannedTop = ['talkWorkflow', 'digitalSelfSchema', 'providerLogic', 'entitlements', 'users'];
  for (const k of bannedTop) {
    assert(!(k in brand), `${id}: must not contain ${k}`);
  }
  return brand;
}

function main() {
  const tujimi = validateOne('tujimi');
  const telecom = validateOne('demo-telecom');
  assert(tujimi.userDataDirName === 'digitalme-v2', 'official userDataDirName must stay digitalme-v2');
  assert(tujimi.appId === 'local.digitalme.v2', 'official appId must stay local.digitalme.v2');
  assert(telecom.userDataDirName !== tujimi.userDataDirName, 'white-label must not share userDataDirName');
  assert(telecom.appId !== tujimi.appId, 'white-label must not share appId');
  assert(telecom.productName !== tujimi.productName, 'white-label productName must differ');
  assert(!/中国电信|招商银行/i.test(JSON.stringify(telecom)), 'must not use real carrier/bank trademarks');

  // apply-brand dry materialize for both
  const { spawnSync } = require('node:child_process');
  for (const id of ['tujimi', 'demo-telecom']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'apply-brand.cjs'), `--brand=${id}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`apply-brand ${id} failed: ${r.stderr || r.stdout}`);
    const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'brand.json'), 'utf8'));
    assert(runtime.id === id, `runtime brand id mismatch for ${id}`);
    assert(!('iconIco' in runtime), 'runtime brand must not ship icon paths as required secrets surface');
  }

  // restore official default brand file for local dev
  spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'apply-brand.cjs'), '--brand=tujimi'], {
    cwd: ROOT,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        brands: ['tujimi', 'demo-telecom'],
        isolation: {
          appId: { tujimi: tujimi.appId, demoTelecom: telecom.appId },
          userDataDirName: {
            tujimi: tujimi.userDataDirName,
            demoTelecom: telecom.userDataDirName,
          },
        },
        forkCore: false,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }, null, 2));
  process.exit(1);
}
