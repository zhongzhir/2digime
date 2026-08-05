/**
 * Start/stop helper for the independent research A2A agent process.
 * 只有子进程存活、端口监听、Agent Card 可读、执行端点可响应后才视为启动成功。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const AGENT_DIR = path.resolve(__dirname, '../reference-agents/research-a2a-agent');
const PID_FILE = path.join(AGENT_DIR, '.agent.pid');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpText(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function httpJson(url, opts = {}) {
  const { ok, status, text } = await httpText(url, opts);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok, status, json, text };
}

function processAlive(child) {
  return !!(child && child.exitCode === null && !child.killed);
}

function portListening(host, port, timeoutMs = 1500) {
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

async function waitHealthy(controlUrl, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { ok, json } = await httpJson(controlUrl);
      if (ok && json?.ok) return json;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`research-a2a-agent not healthy: ${controlUrl}`);
}

/**
 * 真实就绪：进程存活 + 端口监听 + 统一 A2A 连接探测合同。
 */
async function assertAgentReady(input) {
  const { child, host, port, baseUrl } = input;
  if (!processAlive(child)) {
    throw new Error('子进程已退出，参考研究能力未真正启动');
  }
  if (!(await portListening(host, port))) {
    throw new Error(`端口未监听：${host}:${port}`);
  }
  const appRoot = path.resolve(__dirname, '..');
  const { probeA2AConnection } = require(path.join(
    appRoot,
    'dist',
    'capability',
    'a2a-connection-probe.js',
  ));
  const probe = await probeA2AConnection({ baseUrl });
  if (!probe.ok) {
    throw new Error(
      `A2A 连接探测失败（${probe.diagnostic.stage}）：${(probe.diagnostic.reasons || []).join('; ')}`,
    );
  }
  if (!processAlive(child)) {
    throw new Error('就绪检查后子进程已退出');
  }
  return { card: probe.card, probe };
}

async function stopResearchA2AAgent() {
  try {
    require(path.join(AGENT_DIR, 'stop.cjs'));
  } catch {
    /* ignore */
  }
  if (fs.existsSync(PID_FILE)) {
    try {
      const meta = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
      if (meta.pid) {
        try {
          process.kill(meta.pid);
        } catch {
          /* ignore */
        }
      }
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
  }
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(AGENT_DIR, 'stop.cjs')], {
      cwd: AGENT_DIR,
      stdio: 'ignore',
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
  await sleep(200);
}

async function requestControlShutdown(host, controlPort) {
  try {
    await httpJson(`http://${host}:${controlPort}/shutdown`, { method: 'POST' });
  } catch {
    /* ignore */
  }
}

/**
 * 停止后若端口仍被无 pid 文件的孤儿占用，不得把旧服务当成新启动成功。
 */
async function assertPortFree(host, port, controlPort) {
  await requestControlShutdown(host, controlPort);
  await sleep(250);
  if (await portListening(host, port)) {
    throw new Error(
      `端口仍被占用：${host}:${port}（可能存在无 pid 文件的残留进程）。请先结束该端口进程后再启动。`,
    );
  }
}

async function startResearchA2AAgent(env = {}) {
  await stopResearchA2AAgent();
  const host = env.RESEARCH_A2A_HOST || '127.0.0.1';
  const port = Number(env.RESEARCH_A2A_PORT || 43111);
  const controlPort = Number(env.RESEARCH_A2A_CONTROL_PORT || port + 1);
  await assertPortFree(host, port, controlPort);
  const child = spawn(process.execPath, [path.join(AGENT_DIR, 'server.cjs')], {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      ...env,
      RESEARCH_A2A_HOST: host,
      RESEARCH_A2A_PORT: String(port),
      RESEARCH_A2A_CONTROL_PORT: String(controlPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  child.stdout.on('data', (d) => {
    stdout += String(d);
  });
  const baseUrl = `http://${host}:${port}`;
  const agentCardUrl = `${baseUrl}/.well-known/agent-card.json`;
  try {
    const health = await waitHealthy(`http://${host}:${controlPort}/health`);
    await assertAgentReady({ child, host, port, baseUrl, agentCardUrl });
    if (!fs.existsSync(PID_FILE)) {
      throw new Error('启动后缺少 .agent.pid，不能视为可连接');
    }
    const meta = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (!meta.pid || Number(meta.pid) !== child.pid) {
      throw new Error(`pid 文件与子进程不一致：file=${meta.pid} child=${child.pid}`);
    }
    if (!processAlive(child)) {
      throw new Error('就绪检查后子进程已退出');
    }
    return {
      ...health,
      child,
      host,
      port,
      controlPort,
      baseUrl,
      agentCardUrl,
      async stop() {
        try {
          await requestControlShutdown(host, controlPort);
        } catch {
          /* ignore */
        }
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        await stopResearchA2AAgent();
      },
    };
  } catch (err) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await stopResearchA2AAgent();
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `参考研究能力启动失败：${detail}` +
        (stderr ? `; stderr=${stderr.slice(0, 400)}` : '') +
        (stdout ? `; stdout=${stdout.slice(0, 200)}` : ''),
    );
  }
}

module.exports = {
  startResearchA2AAgent,
  stopResearchA2AAgent,
  assertAgentReady,
  AGENT_DIR,
};
