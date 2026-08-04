/**
 * SUBJECT-PERCEPTIBLE-UX-01 验收入口（已由产品壳重排承接）。
 * 现委托 accept:product-shell，避免与「做事纯净工作区」文案约束冲突。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
console.log('NOTE: accept:subject-ux delegates to accept:product-shell after PRODUCT-SHELL-REALIGNMENT-01');
const result = spawnSync(process.execPath, [path.join(__dirname, 'run-product-shell-acceptance.cjs')], {
  stdio: 'inherit',
  cwd: appRoot,
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
