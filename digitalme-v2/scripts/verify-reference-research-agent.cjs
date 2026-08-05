/**
 * 验证本机参考「研究分析能力」是否真实可连接。
 * 用法: npm run verify:reference-research-agent
 * 与产品 save/test/checkAvailability 共用 probeA2AConnection。
 * 不输出凭证。
 */
'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const AGENT_DIR = path.resolve(__dirname, '../reference-agents/research-a2a-agent');
const PID_FILE = path.join(AGENT_DIR, '.agent.pid');

function readPidMeta() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function processRunning(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function portListening(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function main() {
  const probePath = path.join(appRoot, 'dist', 'capability', 'a2a-connection-probe.js');
  if (!fs.existsSync(probePath)) {
    console.error('VERIFY_FAILED: missing dist probe helper; run npm run build first');
    process.exitCode = 1;
    return;
  }
  const { probeA2AConnection, scrubConnectionDiagnostic } = require(probePath);

  const meta = readPidMeta();
  const rawHost = (meta && meta.host) || process.env.RESEARCH_A2A_HOST || '127.0.0.1';
  const host = rawHost === 'localhost' || rawHost === '::1' ? '127.0.0.1' : rawHost;
  const port = Number((meta && meta.port) || process.env.RESEARCH_A2A_PORT || 43111);
  const baseUrl = `http://${host}:${port}`;
  const pid = meta && meta.pid;

  const process_running = processRunning(pid);
  const port_listening = await portListening(host, port);

  let probe = null;
  if (port_listening) {
    probe = await probeA2AConnection({ baseUrl });
  }

  const agent_card_valid = !!(probe && probe.agent_card_valid);
  const a2a_protocol_probe_valid = !!(probe && probe.a2a_protocol_probe_valid);
  const required_skill_available = !!(probe && probe.required_skill_available);
  const connection_contract_match = !!(probe && probe.connection_contract_match);

  const ready_for_connection =
    process_running &&
    port_listening &&
    agent_card_valid &&
    a2a_protocol_probe_valid &&
    required_skill_available &&
    connection_contract_match;

  const diag = probe ? scrubConnectionDiagnostic(probe.diagnostic) : null;
  const report = {
    process_running,
    port_listening,
    agent_card_valid,
    a2a_protocol_probe_valid,
    required_skill_available,
    connection_contract_match,
    ready_for_connection,
    details: {
      pid: pid || null,
      host,
      port,
      baseUrl,
      agentCardUrl: diag && diag.agentCardUrl,
      interfaceUrl: diag && diag.interfaceUrl,
      jsonRpcMethod: diag && diag.jsonRpcMethod,
      httpStatus: diag && diag.httpStatus,
      jsonRpcErrorCode: diag && diag.jsonRpcErrorCode,
      jsonRpcErrorMessage: diag && diag.jsonRpcErrorMessage,
      stage: diag && diag.stage,
      reasons: diag ? diag.reasons : port_listening ? [] : ['port not listening'],
      pidFile: fs.existsSync(PID_FILE),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!ready_for_connection) {
    console.error('VERIFY_FAILED: ready_for_connection=false');
    process.exitCode = 1;
    return;
  }
  console.log('VERIFY_OK: ready_for_connection=true');
}

main().catch((err) => {
  console.error(err.message || err);
  console.error('VERIFY_FAILED');
  process.exitCode = 1;
});
