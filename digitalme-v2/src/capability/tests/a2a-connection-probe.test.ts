import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {
  A2A_PROTOCOL_PROBE_METHOD,
  A2A_VERSION_HEADER,
  probeA2AConnection,
} from '../a2a-connection-probe';

function listen(handler: http.RequestListener): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

function researchCard(baseUrl: string, skillId = 'project_risk_brief') {
  return {
    name: 'Research Analysis Agent',
    supportedInterfaces: [
      {
        url: `${baseUrl}/`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    skills: [{ id: skillId, name: '项目风险摘要' }],
  };
}

async function withMockAgent(
  rpcHandler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
  skillId = 'project_risk_brief',
) {
  const holder = { baseUrl: '' };
  const server = await listen((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(researchCard(holder.baseUrl, skillId)));
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => rpcHandler(req, body, res));
  });
  holder.baseUrl = server.baseUrl;
  try {
    await fn(server.baseUrl);
  } finally {
    await server.close();
  }
}

test('probe rejects HTTP 500 even if body looks like jsonrpc', async () => {
  await withMockAgent((_req, _body, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32009, message: "version '0.3' not supported" },
      }),
    );
  }, async (baseUrl) => {
    const probe = await probeA2AConnection({ baseUrl });
    assert.equal(probe.ok, false);
    assert.equal(probe.a2a_protocol_probe_valid, false);
    assert.equal(probe.diagnostic.stage, 'protocol_probe');
    assert.equal(probe.diagnostic.httpStatus, 500);
  });
});

test('probe rejects invalid method JSON-RPC error as not connectable', async () => {
  await withMockAgent((_req, _body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Invalid method.' },
      }),
    );
  }, async (baseUrl) => {
    const probe = await probeA2AConnection({ baseUrl });
    assert.equal(probe.ok, false);
    assert.equal(probe.a2a_protocol_probe_valid, false);
    assert.equal(probe.diagnostic.jsonRpcErrorCode, -32601);
  });
});

test('probe rejects missing skill', async () => {
  await withMockAgent(
    (_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    },
    async (baseUrl) => {
      const probe = await probeA2AConnection({ baseUrl });
      assert.equal(probe.ok, false);
      assert.equal(probe.diagnostic.stage, 'skill');
      assert.equal(probe.required_skill_available, false);
    },
    'other_skill',
  );
});

test('probe accepts Task-not-found as protocol-valid GetTask response', async () => {
  let sawVersion = false;
  let sawMethod = '';
  await withMockAgent((req, body, res) => {
    sawVersion = String(req.headers[A2A_VERSION_HEADER.toLowerCase()] || '') === '1.0';
    try {
      sawMethod = JSON.parse(body).method;
    } catch {
      sawMethod = '';
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Task not found: x' },
      }),
    );
  }, async (baseUrl) => {
    const probe = await probeA2AConnection({ baseUrl });
    assert.equal(probe.ok, true);
    assert.equal(probe.agent_card_valid, true);
    assert.equal(probe.a2a_protocol_probe_valid, true);
    assert.equal(probe.required_skill_available, true);
    assert.equal(probe.connection_contract_match, true);
    assert.equal(sawVersion, true);
    assert.equal(sawMethod, A2A_PROTOCOL_PROBE_METHOD);
  });
});
