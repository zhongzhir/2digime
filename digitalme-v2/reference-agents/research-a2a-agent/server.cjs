/**
 * Independent research A2A agent process.
 * Own lifecycle, Agent Card, Task store, and model credentials.
 * Does not import Digital Me runtime, SubjectPackage, or Artifact Store.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
} = require('@a2a-js/sdk');
const {
  InMemoryTaskStore,
  DefaultRequestHandler,
} = require('@a2a-js/sdk/server');
const {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} = require('@a2a-js/sdk/server/express');
const { ResearchAgentExecutor, resolvePeerModelEnv } = require('./agent-executor.cjs');

const HOST = process.env.RESEARCH_A2A_HOST || '127.0.0.1';
const PORT = Number(process.env.RESEARCH_A2A_PORT || 43111);
const CONTROL_PORT = Number(process.env.RESEARCH_A2A_CONTROL_PORT || PORT + 1);
const PID_FILE = path.join(__dirname, '.agent.pid');

function buildAgentCard(baseUrl) {
  return {
    name: 'Research Analysis Agent',
    description: '独立研究分析专业能力：根据明确授权材料生成结构化项目风险摘要。',
    supportedInterfaces: [
      {
        url: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: 'Digital Me Reference Agents',
      url: 'https://example.local/digitalme-reference-agents',
    },
    version: '0.1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text', 'text/plain'],
    defaultOutputModes: ['text', 'text/plain', 'text/markdown'],
    skills: [
      {
        id: 'project_risk_brief',
        name: '项目风险摘要',
        description: '根据授权项目材料形成 500–800 字结构化风险摘要',
        tags: ['research', 'risk', 'document'],
        examples: ['根据授权材料形成项目风险摘要'],
        inputModes: ['text', 'text/plain'],
        outputModes: ['text/markdown', 'text/plain'],
        securityRequirements: [],
      },
    ],
    documentationUrl: '',
    signatures: [],
  };
}

async function main() {
  const baseUrl = `http://${HOST}:${PORT}`;
  const agentCard = buildAgentCard(baseUrl);
  const taskStore = new InMemoryTaskStore();
  const executor = new ResearchAgentExecutor({
    processDelayMs: Number(process.env.RESEARCH_A2A_DELAY_MS || 80),
  });
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor);

  const app = express();
  // Card 声明协议 1.0：缺省版本头时不得回落 SDK 默认 0.3（否则合法 1.0 客户端偶发漏头会 500）。
  app.use((req, _res, next) => {
    const key = Object.keys(req.headers).find((h) => h.toLowerCase() === 'a2a-version');
    if (!key || !String(req.headers[key] || '').trim()) {
      req.headers['a2a-version'] = A2A_PROTOCOL_VERSION || '1.0';
    }
    next();
  });
  // Private comparison API — engineering only, not product UI.
  app.post('/private/v1/analyze', express.json({ limit: '512kb' }), async (req, res) => {
    try {
      const goal = String(req.body?.goal || '形成项目风险摘要');
      const materials = Array.isArray(req.body?.materials) ? req.body.materials : [];
      const text = [
        `目标：${goal}`,
        '',
        '授权材料：',
        ...materials.map((m, i) => `材料[${i + 1}] path=${m.path || ''} digest=${m.digest || ''}\n${m.excerpt || ''}`),
      ].join('\n');
      const synth = await executor.synthesize(text, { allowModel: true });
      res.json({
        title: '项目风险摘要',
        text: synth.text,
        reachedModel: synth.reachedModel,
        protocol: 'private-http',
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, (err) => (err ? reject(err) : resolve()));
  });

  // Control plane on separate port — start/stop/fault without sharing DM stores.
  const control = express();
  control.use(express.json({ limit: '32kb' }));
  control.get('/health', (_req, res) => {
    const model = resolvePeerModelEnv();
    res.json({
      ok: true,
      baseUrl,
      agentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
      modelConfigured: model.configured,
      modelSource: model.source,
      pid: process.pid,
    });
  });
  control.post('/fault', (req, res) => {
    const taskId = String(req.body?.taskId || '');
    const fault = String(req.body?.fault || 'none');
    if (!taskId) {
      res.status(400).json({ error: 'taskId required' });
      return;
    }
    executor.setFault(taskId, fault);
    res.json({ ok: true, taskId, fault });
  });
  control.post('/shutdown', (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => {
      server.close(() => process.exit(0));
      controlServer.close();
    }, 50);
  });
  const controlServer = http.createServer(control);
  await new Promise((resolve, reject) => {
    controlServer.listen(CONTROL_PORT, HOST, (err) => (err ? reject(err) : resolve()));
  });

  fs.writeFileSync(
    PID_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        host: HOST,
        port: PORT,
        controlPort: CONTROL_PORT,
        baseUrl,
        agentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`[research-a2a-agent] listening ${baseUrl}`);
  console.log(`[research-a2a-agent] agent card ${baseUrl}/.well-known/agent-card.json`);
  console.log(`[research-a2a-agent] control http://${HOST}:${CONTROL_PORT}/health`);
  console.log(`[research-a2a-agent] private compare POST ${baseUrl}/private/v1/analyze`);

  const shutdown = () => {
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    controlServer.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
