/**
 * REMOTE-RELAY-NETWORK-RECOVERY-ROOT-CAUSE-03
 * 同进程、真实网络分层对照（不 mock）。
 *
 * 用法（在 digitalme-v2 目录，先 npm run build）：
 *   node scripts/probe-relay-network-recovery-layers.cjs
 *
 * Owner OS 断网复验（只需断网一次、恢复一次）：
 *   同上命令保持运行 → 断网 → 见 offline 失败行 → 恢复网络 → 见 recovery 成功行 → Ctrl+C
 *
 * 环境变量：
 *   RELAY_PROBE_URL   默认 https://relay.muhub.cn/health
 *   RELAY_PROBE_MS    轮询间隔，默认 3000
 *   RELAY_PROBE_AUTO_DNS=1  同进程注入坏 DNS → 恢复（辅助；不能替代 OS 断网）
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const dns = require('node:dns');
const https = require('node:https');
const { URL } = require('node:url');

const root = path.resolve(__dirname, '..');
const distHttp = path.join(root, 'dist', 'subject-comm', 'relay-http.js');
if (!fs.existsSync(distHttp)) {
  console.error('请先 npm run build');
  process.exit(1);
}
const { defaultRelayHttp } = require(distHttp);

const HEALTH_URL = String(process.env.RELAY_PROBE_URL || 'https://relay.muhub.cn/health').trim();
const INTERVAL_MS = Math.max(1000, Number(process.env.RELAY_PROBE_MS || 3000) || 3000);
const hostname = new URL(HEALTH_URL).hostname;

const evidenceDir = path.join(root, 'scripts', '_relay-network-recovery-03-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const evidencePath = path.join(
  evidenceDir,
  `layers-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
);

function emit(row) {
  const line = JSON.stringify(row);
  console.log(line);
  fs.appendFileSync(evidencePath, `${line}\n`, 'utf8');
}

function dnsLookup() {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        resolve({
          ok: false,
          phase: 'dns_lookup',
          name: err.name || 'Error',
          code: err.code || 'NONE',
          message: String(err.message || err).slice(0, 160),
        });
        return;
      }
      resolve({
        ok: true,
        phase: 'dns_lookup',
        addresses: (addresses || []).map((a) => ({
          address: a.address,
          family: a.family,
        })),
      });
    });
  });
}

function nodeHttpsMinimal() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const url = new URL(HEALTH_URL);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { connection: 'close' },
        timeout: 12_000,
        servername: url.hostname,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve({
            implementation: 'node_https_minimal',
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            phase: 'http_response',
            hostname: url.hostname,
            status: res.statusCode || 0,
            ms: Date.now() - t0,
            bodyHead: Buffer.concat(chunks).toString('utf8').slice(0, 80),
          });
        });
        res.on('error', (err) => {
          resolve({
            implementation: 'node_https_minimal',
            ok: false,
            phase: 'http_response',
            hostname: url.hostname,
            name: err.name || 'Error',
            code: err.code || 'NONE',
            message: String(err.message || err).slice(0, 160),
            ms: Date.now() - t0,
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', (err) => {
      resolve({
        implementation: 'node_https_minimal',
        ok: false,
        phase: 'http_request',
        hostname: url.hostname,
        name: err.name || 'Error',
        code: err.code || 'NONE',
        causeCode: (err.cause && err.cause.code) || 'NONE',
        message: String(err.message || err).slice(0, 160),
        ms: Date.now() - t0,
      });
    });
    req.end();
  });
}

async function relayHttpAdapter() {
  const t0 = Date.now();
  try {
    const res = await defaultRelayHttp({ url: HEALTH_URL, timeoutMs: 12_000 });
    return {
      implementation: 'relay_http_adapter',
      ok: res.status >= 200 && res.status < 300,
      phase: 'http_response',
      hostname,
      status: res.status,
      ms: Date.now() - t0,
      bodyHead: String(res.text || '').slice(0, 80),
    };
  } catch (err) {
    const diag = err && err.diagnostics ? err.diagnostics : null;
    return {
      implementation: 'relay_http_adapter',
      ok: false,
      phase: (diag && diag.phase) || 'relay_request',
      hostname,
      name: (diag && diag.name) || err.name || 'Error',
      code: (diag && diag.code) || err.code || 'NONE',
      causeCode: (diag && diag.causeCode) || 'NONE',
      category: err.category || null,
      message: String((diag && diag.message) || err.message || err).slice(0, 160),
      ms: Date.now() - t0,
    };
  }
}

async function electronNetIfAvailable() {
  let electron;
  try {
    electron = require('electron');
  } catch {
    return {
      implementation: 'electron_net',
      ok: null,
      phase: 'skip',
      hostname,
      message: 'electron_module_unavailable_in_this_process',
    };
  }
  const net = electron && electron.net;
  if (!net || typeof net.fetch !== 'function') {
    return {
      implementation: 'electron_net',
      ok: null,
      phase: 'skip',
      hostname,
      message: 'electron_net_fetch_unavailable',
    };
  }
  const t0 = Date.now();
  try {
    const res = await net.fetch(HEALTH_URL, { method: 'GET' });
    const text = await res.text();
    return {
      implementation: 'electron_net_fetch',
      ok: res.ok,
      phase: 'http_response',
      hostname,
      status: res.status,
      ms: Date.now() - t0,
      bodyHead: String(text || '').slice(0, 80),
    };
  } catch (err) {
    return {
      implementation: 'electron_net_fetch',
      ok: false,
      phase: 'http_request',
      hostname,
      name: err.name || 'Error',
      code: err.code || 'NONE',
      message: String(err.message || err).slice(0, 160),
      ms: Date.now() - t0,
    };
  }
}

async function sample(label) {
  const dnsPart = await dnsLookup();
  const relayPart = await relayHttpAdapter();
  const rawPart = await nodeHttpsMinimal();
  const electronPart = await electronNetIfAvailable();
  const row = {
    timestamp: new Date().toISOString(),
    label,
    hostname,
    dns: dnsPart,
    layers: [relayPart, rawPart, electronPart],
  };
  emit(row);
  return row;
}

function classify(row) {
  const relay = row.layers.find((l) => l.implementation === 'relay_http_adapter');
  const raw = row.layers.find((l) => l.implementation === 'node_https_minimal');
  const ele = row.layers.find((l) => String(l.implementation || '').startsWith('electron_net'));
  return {
    relayOk: !!(relay && relay.ok),
    rawOk: !!(raw && raw.ok),
    electronOk: ele && ele.ok === true ? true : ele && ele.ok === false ? false : null,
    dnsOk: !!(row.dns && row.dns.ok),
  };
}

async function autoDnsAssist() {
  const prev = dns.getServers();
  emit({ timestamp: new Date().toISOString(), phase: 'auto_dns_begin', prevServers: prev });
  await sample('auto_online_before');
  dns.setServers(['203.0.113.1']);
  await sample('auto_bad_dns');
  dns.setServers(prev.length ? prev : ['8.8.8.8']);
  for (const wait of [0, 1000, 3000, 5000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await sample('auto_restore_wait_' + wait + 'ms');
  }
  emit({ timestamp: new Date().toISOString(), phase: 'auto_dns_end' });
}

async function main() {
  emit({
    timestamp: new Date().toISOString(),
    phase: 'probe_start',
    healthUrl: HEALTH_URL,
    intervalMs: INTERVAL_MS,
    evidencePath,
    instruction:
      '保持本进程运行：先确认 online success → 断网 → offline failure → 恢复网络 → online recovery（勿重启进程）',
  });

  if (process.env.RELAY_PROBE_AUTO_DNS === '1') {
    await autoDnsAssist();
  }

  let sawOnline = false;
  let sawOffline = false;
  let sawRecovery = false;

  for (;;) {
    const row = await sample('poll');
    const c = classify(row);
    if (c.relayOk && c.rawOk) {
      if (!sawOnline) {
        sawOnline = true;
        emit({ timestamp: new Date().toISOString(), phase: 'milestone', milestone: 'online_success', ...c });
      } else if (sawOffline && !sawRecovery) {
        sawRecovery = true;
        emit({
          timestamp: new Date().toISOString(),
          phase: 'milestone',
          milestone: 'online_recovery_success',
          ...c,
          verdictHint:
            c.electronOk === true && !c.rawOk
              ? 'A_prefer_electron_net'
              : !c.rawOk
                ? 'D_dns_or_os'
                : 'node_https_recovers_ok',
        });
        emit({
          timestamp: new Date().toISOString(),
          phase: 'probe_complete',
          ok: true,
          sawOnline,
          sawOffline,
          sawRecovery,
        });
        process.exit(0);
      }
    } else if (sawOnline && !c.relayOk) {
      if (!sawOffline) {
        sawOffline = true;
        emit({
          timestamp: new Date().toISOString(),
          phase: 'milestone',
          milestone: 'offline_failure',
          ...c,
          relayCode: (row.layers[0] && row.layers[0].code) || null,
          dnsCode: (row.dns && row.dns.code) || null,
        });
      }
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
