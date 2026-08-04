/**
 * Start/stop helper for the independent research A2A agent process.
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const AGENT_DIR = path.resolve(__dirname, '../reference-agents/research-a2a-agent');
const PID_FILE = path.join(AGENT_DIR, '.agent.pid');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
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
  // also call stop script
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

async function startResearchA2AAgent(env = {}) {
  await stopResearchA2AAgent();
  const host = env.RESEARCH_A2A_HOST || '127.0.0.1';
  const port = Number(env.RESEARCH_A2A_PORT || 43111);
  const controlPort = Number(env.RESEARCH_A2A_CONTROL_PORT || port + 1);
  const child = spawn(process.execPath, [path.join(AGENT_DIR, 'server.cjs')], {
    cwd: AGENT_DIR,
    env: { ...process.env, ...env, RESEARCH_A2A_HOST: host, RESEARCH_A2A_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  const health = await waitHealthy(`http://${host}:${controlPort}/health`).catch((err) => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    throw new Error(`${err.message}; stderr=${stderr.slice(0, 500)}`);
  });
  return {
    ...health,
    child,
    host,
    port,
    controlPort,
    baseUrl: `http://${host}:${port}`,
    agentCardUrl: `http://${host}:${port}/.well-known/agent-card.json`,
    async stop() {
      try {
        await httpJson(`http://${host}:${controlPort}/shutdown`, { method: 'POST' });
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
}

module.exports = {
  startResearchA2AAgent,
  stopResearchA2AAgent,
  AGENT_DIR,
};
