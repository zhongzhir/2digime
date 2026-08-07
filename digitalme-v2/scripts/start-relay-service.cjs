/**
 * 启动最小 Relay Service。
 * 用法: node scripts/start-relay-service.cjs
 * 环境变量: RELAY_HOST RELAY_PORT RELAY_DATA_DIR
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist', 'relay-service', 'server.js');
if (!fs.existsSync(dist)) {
  console.error('请先 npm run build');
  process.exit(1);
}
require(dist);
