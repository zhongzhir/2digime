import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESPONSES_MAX_OUTPUT_TOKENS,
  runResponsesTurn,
  supportsResponsesToolLoop,
  type UnifiedCapabilityEvent,
} from '../responses-tool-loop';

test('北京业务空间端点才启用统一 Responses 工具循环', () => {
  assert.equal(supportsResponsesToolLoop({
    baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
  }), true);
  assert.equal(supportsResponsesToolLoop({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
  }), false);
  assert.equal(supportsResponsesToolLoop({
    baseUrl: 'http://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
  }), false);
});

test('可用同一 Responses 适配器解释 Digital Self，但不暴露联网工具', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> = {};
  const terminal = {
    id: 'resp_self',
    status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '{"understandings":[]}' }],
    }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, any>;
    return new Response(
      'data: ' + JSON.stringify({ type: 'response.completed', response: terminal }) + '\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };
  try {
    const result = await runResponsesTurn({
      baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      apiKey: 'not-a-real-key',
      model: 'qwen3.8-flash',
      messages: [{ role: 'user', content: '只解释长期信息。' }],
      includeWebTools: false,
    });
    assert.equal('tools' in requestBody, false);
    assert.equal('tool_choice' in requestBody, false);
    assert.equal(result.text, '{"understandings":[]}');
    assert.equal(result.trace.webSearchCalls, 0);
    assert.equal(result.trace.webExtractorCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('多地址正文工具只把输出中能对应的地址标为已读', async () => {
  const originalFetch = globalThis.fetch;
  const terminal = {
    id: 'resp_multi_read',
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [
            { title: '甲', url: 'https://example.com/a' },
            { title: '乙', url: 'https://example.com/b' },
          ],
        },
      },
      {
        type: 'web_extractor_call',
        status: 'completed',
        urls: ['https://example.com/a', 'https://example.com/b'],
        output: 'The useful information in https://example.com/a for user goal is ...',
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '完成' }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  globalThis.fetch = async () => new Response(
    'data: ' + JSON.stringify({ type: 'response.completed', response: terminal }) + '\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  try {
    const result = await runResponsesTurn({
      baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      apiKey: 'not-a-real-key',
      model: 'qwen3.8-flash',
      messages: [{ role: 'user', content: '读两篇。' }],
    });
    assert.equal(result.trace.sources.find((source) => source.url === 'https://example.com/a')?.readStatus, 'read');
    assert.equal(result.trace.sources.find((source) => source.url === 'https://example.com/b')?.readStatus, 'snippet_only');
    assert.match(
      result.trace.sources.find((source) => source.url === 'https://example.com/b')?.readError || '',
      /did not identify/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('统一适配器保留真实工具阶段、来源读取事实和结构化函数结果', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> = {};
  const terminal = {
    id: 'resp_test',
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [
            { title: '来源甲', url: 'https://example.com/a' },
            { title: '来源乙', url: 'https://example.com/b' },
          ],
        },
      },
      {
        type: 'web_extractor_call',
        status: 'completed',
        urls: ['https://example.com/a'],
        output: '正文甲',
      },
      {
        type: 'function_call',
        call_id: 'call_present',
        name: 'present_results',
        arguments: JSON.stringify({
          summary: '已核对',
          results: [{ title: '来源甲', url: 'https://example.com/a' }],
        }),
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 20 },
      x_tools: {
        web_search: { count: 1 },
        web_extractor: { count: 1 },
      },
    },
  };
  const stream = [
    { type: 'response.reasoning_summary_text.delta', delta: 'x' },
    { type: 'response.output_item.added', item: { type: 'web_search_call' } },
    { type: 'response.output_item.added', item: { type: 'web_extractor_call' } },
    { type: 'response.completed', response: terminal },
  ].map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, any>;
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const events: UnifiedCapabilityEvent[] = [];
  try {
    const result = await runResponsesTurn({
      baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      apiKey: 'not-a-real-key',
      model: 'qwen3.8-flash',
      messages: [
        { role: 'system', content: '自主搜索和读源。' },
        { role: 'user', content: '找资料' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'present_results',
          description: '交付结果',
          parameters: { type: 'object' },
        },
      }],
      onEvent: (event) => events.push(event),
    });
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.max_output_tokens, RESPONSES_MAX_OUTPUT_TOKENS);
    assert.deepEqual(requestBody.reasoning, { effort: 'low' });
    assert.equal(requestBody.stream, true);
    assert.deepEqual(
      requestBody.tools.map((tool: { type: string; name?: string }) => tool.name || tool.type),
      ['web_search', 'web_extractor', 'present_results'],
    );
    assert.equal(result.toolCalls?.[0]?.name, 'present_results');
    assert.equal(result.trace.webSearchCalls, 1);
    assert.equal(result.trace.webExtractorCalls, 1);
    assert.equal(result.trace.functionCalls, 1);
    assert.equal(result.trace.sources.find((source) => source.url === 'https://example.com/a')?.readStatus, 'read');
    assert.equal(result.trace.sources.find((source) => source.url === 'https://example.com/b')?.readStatus, 'snippet_only');
    assert.ok(events.some((event) => event.stage === 'searching'));
    assert.ok(events.some((event) => event.stage === 'reading_source'));
    assert.equal(events.at(-1)?.stage, 'completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
