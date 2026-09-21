/**
 * MANAGED-AI-RATE-LIMIT-SEMANTICS-01
 * ALLOWANCE = token 额度；RATE LIMIT = 短窗口 burst；GLOBAL CEILING = 运营保险丝。
 * 内部 HTTP 次数不得再按日历小时锁死正常多步骤任务。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createManagedAiGateway, DEFAULT_BURST_MAX, DEFAULT_BURST_WINDOW_MS, pruneBurstTimestamps, burstRetryAfterMs } from '../../relay-service/ai-inference-gateway';
import { createFileAiAllowanceStore } from '../../relay-service/ai-allowance';
import { classifyManagedAiFailure, MANAGED_AI_LOCAL_RATE_NOTICE } from '../../capability/managed-ai-client';

const TOKEN = 'c'.repeat(64);

function gatewayOpts(
  root: string,
  extra: Partial<Parameters<typeof createManagedAiGateway>[0]> & {
    complete?: Parameters<typeof createManagedAiGateway>[0]['complete'];
    now?: () => number;
    log?: Parameters<typeof createManagedAiGateway>[0]['log'];
  } = {},
) {
  return {
    store: createFileAiAllowanceStore(root),
    trialTokenLimit: 5_000_000,
    globalTokenCeiling: 50_000_000,
    globalDailyRequests: 2_000,
    maxProviderRetries: 0,
    retryBackoffMs: 0,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    ...extra,
  };
}

test('burst helpers: 15s 滑动窗口不在整点跳变', () => {
  const windowMs = 15_000;
  const aroundHour = Date.parse('2026-09-20T12:59:55.000Z');
  const stamps = [aroundHour, aroundHour + 2_000, aroundHour + 4_000];
  const still = pruneBurstTimestamps(stamps, Date.parse('2026-09-20T13:00:05.000Z'), windowMs);
  assert.equal(still.length, 3);
  assert.equal(burstRetryAfterMs(still, Date.parse('2026-09-20T13:00:05.000Z'), windowMs) > 0, true);
});

test('多步骤 workload >30 次 inference 只要间隔正常就不 LOCAL_RATE_LIMITED', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-burst-multi-'));
  let t = Date.parse('2026-09-20T12:00:00.000Z');
  let calls = 0;
  const gateway = createManagedAiGateway(
    gatewayOpts(root, {
      trialTokenLimit: 10_000,
      now: () => t,
      complete: async () => {
        calls += 1;
        return { text: 'ok', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      },
    }),
  );
  const statuses: string[] = [];
  for (let i = 0; i < 40; i++) {
    const hit = await gateway.infer({
      body: { messages: [{ role: 'user', content: `step-${i}` }] },
      installToken: TOKEN,
    });
    statuses.push(String(hit.body.status));
    t += 2_000;
  }
  assert.equal(statuses.every((s) => s === 'AVAILABLE'), true);
  assert.equal(calls, 40);
  assert.equal(statuses.includes('LOCAL_RATE_LIMITED'), false);
  const snap = await gateway.allowance({ installToken: TOKEN });
  assert.equal(snap.body.status, 'ACTIVE');
  assert.equal((snap.body.remainingPercent || 100) < 100, true);
});

test('极短时间打满滑动窗口 → LOCAL_RATE_LIMITED，且带 retryAfterMs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-burst-abuse-'));
  const t = 1_700_000_000_000;
  let calls = 0;
  const logs: Array<Record<string, string | number | boolean | undefined>> = [];
  const gateway = createManagedAiGateway(
    gatewayOpts(root, {
      burstMax: 8,
      burstWindowMs: 15_000,
      now: () => t,
      log: (_event: string, fields: Record<string, string | number | boolean | undefined>) => {
        logs.push(fields);
      },
      complete: async () => {
        calls += 1;
        return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      },
    }),
  );
  for (let i = 0; i < 8; i++) {
    const hit = await gateway.infer({
      body: { messages: [{ role: 'user', content: `burst-${i}` }] },
      installToken: TOKEN,
    });
    assert.equal(hit.body.status, 'AVAILABLE');
  }
  const blocked = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'blocked' }] },
    installToken: TOKEN,
  });
  assert.equal(blocked.body.status, 'LOCAL_RATE_LIMITED');
  assert.equal(blocked.statusCode, 429);
  assert.equal((blocked.body.retryAfterMs || 0) > 0, true);
  assert.equal(calls, 8);
  const limitedLog = logs.find((row) => row.status === 'LOCAL_RATE_LIMITED');
  assert.equal(limitedLog?.limitType, 'burst');
  assert.equal(typeof limitedLog?.principal, 'string');
  assert.equal(limitedLog?.retryAfterMs, blocked.body.retryAfterMs);
  assert.equal(classifyManagedAiFailure({ httpStatus: 429, bodyError: 'rate_limited' }), 'LOCAL_RATE_LIMITED');
  assert.match(MANAGED_AI_LOCAL_RATE_NOTICE, /这一会儿请求比较多/);
  assert.equal(/模型服务当前比较忙/.test(MANAGED_AI_LOCAL_RATE_NOTICE), false);
});

test('token allowance 仍扣减；耗尽后不再打 provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-burst-alw-'));
  let calls = 0;
  const gateway = createManagedAiGateway(
    gatewayOpts(root, {
      trialTokenLimit: 20,
      complete: async () => {
        calls += 1;
        return { text: 'ok', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    }),
  );
  const first = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'a' }], idempotencyKey: 'alw-1' },
    installToken: TOKEN,
    requestId: 'alw-1',
  });
  assert.equal(first.body.status, 'AVAILABLE');
  const second = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'b' }], idempotencyKey: 'alw-2' },
    installToken: TOKEN,
    requestId: 'alw-2',
  });
  assert.equal(second.body.status, 'ALLOWANCE_EXHAUSTED');
  assert.equal(calls, 1);
});

test('很低的 global ceiling 触发 GLOBAL_CEILING 且停止 provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-burst-ceil-'));
  let calls = 0;
  const gateway = createManagedAiGateway(
    gatewayOpts(root, {
      globalTokenCeiling: 10,
      complete: async () => {
        calls += 1;
        return { text: 'ok', usage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 } };
      },
    }),
  );
  const first = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'a' }] },
    installToken: TOKEN,
  });
  assert.equal(first.body.status, 'AVAILABLE');
  const second = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'b' }] },
    installToken: TOKEN,
  });
  assert.equal(second.body.status, 'GLOBAL_CEILING');
  assert.equal(second.statusCode, 429);
  assert.equal(calls, 1);
});

test('默认 burst 配置覆盖单回合 tool-loop，而不是 30/hour', () => {
  assert.equal(DEFAULT_BURST_WINDOW_MS, 15_000);
  assert.equal(DEFAULT_BURST_MAX, 16);
  assert.equal(DEFAULT_BURST_MAX < 30, true);
});
