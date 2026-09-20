import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRelayServer, FileRelayStore, resolveManagedAiGateway } from '../../relay-service/server';
import {
  createFileAiAllowanceStore,
  createTrialAllowance,
  hashInstallTokenToPrincipalId,
} from '../../relay-service/ai-allowance';
import {
  createManagedAiGateway,
  forbiddenAiInferenceKeys,
  parseAiInferenceRequest,
  parseProviderUsage,
} from '../../relay-service/ai-inference-gateway';
import { createManagedAiChatComplete, ManagedAiError } from '../managed-ai-client';
import {
  readOrMigrateAiCapabilityPreference,
  writeAiCapabilityPreference,
} from '../ai-capability-preference';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { nowIso } from '../../shared/ids';

const TOKEN = 'a'.repeat(64);

async function listen(server: { start: () => Promise<{ host: string; port: number }>; server: { close: (cb: () => void) => void } }) {
  const addr = await server.start();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.server.close(() => resolve())),
  };
}

test('MANAGED AI rejects Digital Self payload and keeps messages only', () => {
  assert.deepEqual(forbiddenAiInferenceKeys({ digitalSelf: '{}', messages: [] }), ['digitalSelf']);
  assert.throws(
    () => parseAiInferenceRequest({ messages: [{ role: 'user', content: 'hi' }], facts: [] }, { maxInputChars: 1000, maxOutputTokens: 64 }),
    /payload_rejected/,
  );
  const parsed = parseAiInferenceRequest(
    { messages: [{ role: 'user', content: '你好' }], maxTokens: 128 },
    { maxInputChars: 1000, maxOutputTokens: 2048 },
  );
  assert.equal(parsed.messages[0]?.content, '你好');
  assert.equal(parsed.maxTokens, 128);
});

test('provider usage parses input/output/total from DeepSeek-shaped payload', () => {
  const usage = parseProviderUsage(
    { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    { inputChars: 100, outputChars: 40 },
  );
  assert.equal(usage.inputTokens, 12);
  assert.equal(usage.outputTokens, 8);
  assert.equal(usage.totalTokens, 20);
});

test('trial allowance is configurable, deducted, exhausted, and idempotent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ai-alw-'));
  const store = createFileAiAllowanceStore(root);
  let calls = 0;
  const gateway = createManagedAiGateway({
    store,
    trialTokenLimit: 20,
    globalTokenCeiling: 10_000,
    perPrincipalPerHour: 20,
    maxOutputTokens: 16,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only-not-for-client',
      model: 'deepseek-v4-flash',
    },
    complete: async () => {
      calls += 1;
      return {
        text: '你好，我是兔机米。',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      };
    },
  });

  const first = await gateway.infer({
    body: { messages: [{ role: 'user', content: '你好，介绍一下你能帮我做什么。' }], idempotencyKey: 'req-1' },
    installToken: TOKEN,
    requestId: 'req-1',
  });
  assert.equal(first.body.status, 'AVAILABLE');
  assert.equal(first.body.text?.includes('兔机米'), true);
  assert.equal(first.body.usage?.totalTokens, 20);
  assert.equal(calls, 1);

  const replay = await gateway.infer({
    body: { messages: [{ role: 'user', content: '你好，介绍一下你能帮我做什么。' }], idempotencyKey: 'req-1' },
    installToken: TOKEN,
    requestId: 'req-1',
  });
  assert.equal(replay.body.status, 'AVAILABLE');
  assert.equal(calls, 1);

  const second = await gateway.infer({
    body: { messages: [{ role: 'user', content: '再问一次' }], idempotencyKey: 'req-2' },
    installToken: TOKEN,
    requestId: 'req-2',
  });
  assert.equal(second.body.status, 'ALLOWANCE_EXHAUSTED');
  assert.equal(second.body.ok, false);
  assert.equal(calls, 1);

  const third = await gateway.infer({
    body: { messages: [{ role: 'user', content: '不应再计费' }], idempotencyKey: 'req-3' },
    installToken: TOKEN,
    requestId: 'req-3',
  });
  assert.equal(third.body.status, 'ALLOWANCE_EXHAUSTED');
  assert.equal(calls, 1);

  const snap = await gateway.allowance({ installToken: TOKEN });
  assert.equal(snap.body.ok, true);
  assert.equal(snap.body.source, 'TRIAL');
  assert.equal(snap.body.remainingPercent, 0);
});

test('concurrent requests cannot skip exhaustion; institution fixture reuses gateway', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ai-inst-'));
  const store = createFileAiAllowanceStore(root);
  const principalId = hashInstallTokenToPrincipalId(TOKEN);
  const now = nowIso();
  await store.put({
    ...createTrialAllowance({
      principalId,
      tokenLimit: 100,
      provider: 'managed-ai',
      model: 'managed-ai',
      nowIso: now,
    }),
    source: 'INSTITUTION',
    issuerId: 'inst_test',
    poolId: 'pool_test',
    tokenLimit: 20,
  });
  let calls = 0;
  const gateway = createManagedAiGateway({
    store,
    trialTokenLimit: 5_000_000,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    complete: async () => {
      calls += 1;
      return { text: '机构额度回复', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
    },
  });
  const results = await Promise.all([
    gateway.infer({
      body: { messages: [{ role: 'user', content: 'a' }], idempotencyKey: 'c1' },
      installToken: TOKEN,
      requestId: 'c1',
    }),
    gateway.infer({
      body: { messages: [{ role: 'user', content: 'b' }], idempotencyKey: 'c2' },
      installToken: TOKEN,
      requestId: 'c2',
    }),
    gateway.infer({
      body: { messages: [{ role: 'user', content: 'c' }], idempotencyKey: 'c3' },
      installToken: TOKEN,
      requestId: 'c3',
    }),
  ]);
  const available = results.filter((row) => row.body.status === 'AVAILABLE');
  const exhausted = results.filter((row) => row.body.status === 'ALLOWANCE_EXHAUSTED');
  assert.equal(available.length, 1);
  assert.equal(exhausted.length, 2);
  assert.equal(calls, 1);
  const summary = await store.summarizeInstitution('inst_test', 'pool_test');
  assert.equal(summary.principalCount, 1);
  assert.equal(summary.tokensUsed, 20);
  assert.equal(summary.requestCount, 1);
  const ledgerRaw = await fs.readFile(path.join(store.dir, `${principalId}.json`), 'utf8');
  assert.equal(/你好|机构额度回复|digitalSelf/.test(ledgerRaw), false);
});

test('Relay inference does not persist prompt/response and health reports managedAi', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ai-relay-'));
  const store = new FileRelayStore(root);
  const gateway = createManagedAiGateway({
    store: createFileAiAllowanceStore(root),
    trialTokenLimit: 5000,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    complete: async (opts) => {
      assert.equal(/self\.json/.test(JSON.stringify(opts.messages)), false);
      return { text: 'ok', usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } };
    },
  });
  const relay = createRelayServer({ store, aiInference: gateway, host: '127.0.0.1', port: 0 });
  const live = await listen(relay);
  try {
    const health = await (await fetch(`${live.url}/health`)).json() as { managedAi?: boolean };
    assert.equal(health.managedAi, true);
    const res = await fetch(`${live.url}/v1/ai/inference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-install-capability-token': TOKEN },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'secret-prompt-should-not-persist' }] }),
    });
    const body = await res.json() as { status?: string; text?: string };
    assert.equal(body.status, 'AVAILABLE');
    const names = await fs.readdir(root);
    const dumped = await Promise.all(
      names.filter((name) => name.endsWith('.json') || !name.includes('.')).map(async (name) => {
        const full = path.join(root, name);
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          const inner = await fs.readdir(full);
          const texts = await Promise.all(inner.map((row) => fs.readFile(path.join(full, row), 'utf8').catch(() => '')));
          return texts.join('\n');
        }
        return fs.readFile(full, 'utf8');
      }),
    );
    assert.equal(dumped.join('\n').includes('secret-prompt-should-not-persist'), false);
  } finally {
    await live.close();
  }
});

test('preference migration keeps existing BYOK users; new installs default managed', async () => {
  const byokRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ai-byok-'));
  const freshRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ai-new-'));
  const migrated = await readOrMigrateAiCapabilityPreference(byokRoot, { hasByokKey: true });
  assert.equal(migrated.path, 'byok');
  const again = await readOrMigrateAiCapabilityPreference(byokRoot, { hasByokKey: false });
  assert.equal(again.path, 'byok');
  const fresh = await readOrMigrateAiCapabilityPreference(freshRoot, { hasByokKey: false });
  assert.equal(fresh.path, 'managed');
  const switched = await writeAiCapabilityPreference(freshRoot, { path: 'byok' });
  assert.equal(switched.path, 'byok');
});

test('no-key Talk/Digital Self runtime uses managed complete and does not mention API Key', async () => {
  const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ai-talk-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: 'http://127.0.0.1',
      model: 'managed-ai',
      providerId: 'managed-ai',
      complete: async ({ messages }) => {
        const blob = JSON.stringify(messages);
        assert.equal(/self\.json/.test(blob), false);
        if (/DIGITAL_SELF_MODE|DIGITAL_SELF_CURRENT|DIGITAL_SELF_INPUT/.test(blob)) {
          const last = messages[messages.length - 1]?.content || '';
          const hit = /简洁/.test(last);
          return {
            text: JSON.stringify({
              understandings: hit
                ? [
                    {
                      text: '希望回答尽量简洁',
                      facet: 'preferences',
                      aboutUser: true,
                      origin: 'user_statement',
                      lasting: true,
                    },
                  ]
                : [],
            }),
          };
        }
        return { text: '你好。我可以聊天、记住关于你的事，也可以联网查找公开信息。', usage: { totalTokens: 16 } };
      },
    },
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'managed-ai', targetDir: pkg });
    const hello = await bus.invoke('talk', { text: '你好，介绍一下你能帮我做什么。' });
    assert.match(String(hello.view.turns.at(-1)?.text || ''), /聊天|记住|联网/);
    assert.equal(/请配置 DeepSeek|API Key/.test(JSON.stringify(hello)), false);
    const learned = await bus.invoke('talk', { text: '以后回答我时尽量简洁。' });
    assert.equal(/请配置/.test(JSON.stringify(learned)), false);
    const self = await bus.invoke('digitalSelf', { action: 'read' });
    const texts = JSON.stringify(self);
    assert.match(texts, /简洁/);
  } finally {
    await runtime.stop();
  }
});

test('managed client maps exhaustion to human notice, never 402', async () => {
  const complete = createManagedAiChatComplete({
    gatewayUrl: 'http://gateway.example',
    installToken: TOKEN,
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false, status: 'ALLOWANCE_EXHAUSTED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  await assert.rejects(
    () => complete({ baseUrl: 'x', model: 'managed-ai', messages: [{ role: 'user', content: 'hi' }] }),
    (err: unknown) => {
      assert.equal(err instanceof ManagedAiError, true);
      assert.equal(String((err as Error).message), '兔机米提供的免费 AI 额度已经用完。');
      assert.equal(/402|quota_exhausted|token_limit/.test(String((err as Error).message)), false);
      return true;
    },
  );
});

test('app package sources do not embed managed AI provider secrets', async () => {
  const root = process.cwd();
  const files = [
    'electron/renderer/app.js',
    'electron/renderer/index.html',
    'electron/preload.cjs',
    'electron/brand.cjs',
    'electron/main.cjs',
    'src/capability/managed-ai-client.ts',
    'src/runtime/digitalme-runtime.ts',
    'src/relay-service/server.ts',
    'src/relay-service/ai-inference-gateway.ts',
    'relay-service/.env.relay.example',
  ];
  const secret =
    /sk-[a-zA-Z0-9]{16,}|MANAGED_AI_PROVIDER_API_KEY\s*[:=]\s*['"][^'"]+|deepseekApiKey\s*[:=]\s*['"][^'"]+/;
  for (const rel of files) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    assert.equal(secret.test(text), false, rel);
    assert.equal(/MANAGED_AI_PROVIDER_API_KEY=sk-/.test(text), false, rel);
  }
});

test('resolveManagedAiGateway without secret stays unready and does not throw', () => {
  const gateway = resolveManagedAiGateway({ MANAGED_AI_PROVIDER_API_KEY: '' }, os.tmpdir());
  assert.equal(gateway.ready, false);
});
