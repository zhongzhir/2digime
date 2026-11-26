import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalChatModelBridge } from '../chat-model-http-bridge';
import { mapChatModelToProviderEnv } from '../chat-model-credential-bridge';

test('托管 ChatCompleteFn 可临时投影成仅回环 OpenAI-compatible 端点', async () => {
  let calls = 0;
  const bridge = await startLocalChatModelBridge({
    model: 'managed-ai',
    complete: async (input) => {
      calls += 1;
      assert.equal(input.messages.at(-1)?.content, '修复并测试');
      assert.equal(input.tools?.[0]?.function.name, 'write');
      return {
        text: '',
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'write', arguments: '{"path":"app.js"}' },
        }],
      };
    },
  });
  try {
    assert.match(bridge.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const unauthorized = await fetch(`${bridge.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'managed-ai', messages: [{ role: 'user', content: '修复并测试' }] }),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${bridge.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bridge.apiKey}`,
      },
      body: JSON.stringify({
        model: 'managed-ai',
        messages: [{ role: 'user', content: '修复并测试' }],
        tools: [{
          type: 'function',
          function: { name: 'write', description: 'write', parameters: { type: 'object' } },
        }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      choices: Array<{ finish_reason: string; message: { tool_calls?: Array<{ function: { name: string } }> } }>;
    };
    assert.equal(body.choices[0]?.finish_reason, 'tool_calls');
    assert.equal(body.choices[0]?.message.tool_calls?.[0]?.function.name, 'write');
    assert.equal(calls, 1);
  } finally {
    await bridge.close();
  }
});

test('桥接端点支持成熟 Agent 常用的 SSE 响应', async () => {
  const bridge = await startLocalChatModelBridge({
    model: 'managed-ai',
    complete: async () => ({ text: '检查完成。' }),
  });
  try {
    const response = await fetch(`${bridge.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bridge.apiKey}`,
      },
      body: JSON.stringify({
        model: 'managed-ai',
        stream: true,
        messages: [{ role: 'user', content: '检查' }],
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-type')), /text\/event-stream/);
    assert.match(text, /检查完成/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await bridge.close();
  }
});

test('托管模型连接不需要把安装令牌伪装成第三方 API Key', async () => {
  const complete = async () => ({ text: 'ok' });
  const bridged = await mapChatModelToProviderEnv({
    connection: {
      providerId: 'managed-ai',
      baseUrl: 'https://managed.example.invalid',
      model: 'managed-ai',
      complete,
    },
  });
  assert.ok(bridged);
  assert.equal(bridged.complete, complete);
  assert.deepEqual(bridged.env, {});
  assert.equal(bridged.modelRef, 'openai-compatible/managed-ai');
});
