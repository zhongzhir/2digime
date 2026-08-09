/**
 * 独立 runtime probe：同进程内模拟 Relay 不可达 → 可达 → defaultRelayHttp 恢复。
 * 用法（在 digitalme-v2 目录）：
 *   node scripts/probe-relay-network-recovery.cjs
 * 可选：
 *   RELAY_PROBE_URL=https://relay.muhub.cn/health node scripts/probe-relay-network-recovery.cjs
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const distHttp = path.join(root, 'dist', 'subject-comm', 'relay-http.js');
if (!fs.existsSync(distHttp)) {
  console.error('请先 npm run build');
  process.exit(1);
}

const { defaultRelayHttp } = require(distHttp);

function listenDummyPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      if (!a || typeof a !== 'object') reject(new Error('no port'));
      else resolve({ server: s, port: a.port });
    });
    s.on('error', reject);
  });
}

function closeNet(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function listenHealth(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, role: 'probe' }));
        return;
      }
      res.writeHead(404);
      res.end('no');
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function main() {
  const publicUrl = String(process.env.RELAY_PROBE_URL || '').trim();
  const report = { steps: [] };

  // —— A. 本地真实 socket：不可达 → 可达 ——
  const held = await listenDummyPort();
  const port = held.port;
  await closeNet(held.server);
  await new Promise((r) => setTimeout(r, 40));

  let failed = false;
  try {
    await defaultRelayHttp({ url: `http://127.0.0.1:${port}/health`, timeoutMs: 700 });
  } catch (err) {
    failed = true;
    report.steps.push({
      step: 'local_unreachable',
      ok: true,
      category: err.category || null,
      detail: String(err.message || err).slice(0, 160),
      diagnostics: err.diagnostics || null,
    });
  }
  if (!failed) {
    console.error('FAIL: expected unreachable');
    process.exit(2);
  }

  const healthServer = await listenHealth(port);
  const recovered = await defaultRelayHttp({
    url: `http://127.0.0.1:${port}/health`,
    timeoutMs: 3000,
  });
  report.steps.push({
    step: 'local_recovered',
    ok: recovered.status === 200 && /"ok"\s*:\s*true/.test(recovered.text),
    status: recovered.status,
    body: recovered.text.slice(0, 80),
  });
  await closeNet(healthServer);

  // —— B. 可选：公网 Relay health（同 defaultRelayHttp）——
  if (publicUrl) {
    const pub = await defaultRelayHttp({ url: publicUrl, timeoutMs: 10000 });
    report.steps.push({
      step: 'public_health',
      ok: pub.status === 200,
      status: pub.status,
      body: pub.text.slice(0, 120),
    });
  }

  const allOk = report.steps.every((s) => s.ok);
  console.log(JSON.stringify({ ok: allOk, report }, null, 2));
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
