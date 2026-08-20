/**
 * MCP-READONLY-ADAPTER-01 单测（hook/进程内传输为主，零网络零真实第三方市场进程）。
 * 覆盖：列出只读工具、lookup 成功、写工具拒绝、服务器缺失诚实失败、
 *       用户面文案无协议名、kind=tool、默认 runtime 列表不含该能力。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpReadonlyAdapter, MCP_READONLY_ADAPTER_ID, MCP_READONLY_CAPABILITY_ID } from '../adapters/mcp-stdio-readonly';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { isAdapterType } from '../registration';
import { assertMcpWireableGuard, assertMcpRegistrationShape, mapConnectorClassToAdapterType } from '../external-connector-contract';
import type { ExecutionContext } from '../adapter';
import type { McpTransport } from '../adapters/mcp-stdio-readonly';

function fakeTransport(overrides: Partial<McpTransport> = {}): McpTransport {
  const notes: Record<string, string> = {
    'note-001.md': '# 使用说明\n\n要点：只读工具不能修改。',
    'note-002.md': '# 第二篇\n\n通用占位。',
  };
  return {
    async listTools() {
      return [
        { name: 'list_notes', description: '列出所有资料' },
        { name: 'lookup_note', description: '按名称读取' },
        { name: 'write_note', description: '写入（应被拒绝）' },
      ];
    },
    async callTool(name, args) {
      if (name === 'list_notes') return { result: { notes: Object.keys(notes) } };
      if (name === 'lookup_note') {
        const content = notes[String(args.note || '')];
        if (!content) return { error: { code: -32002, message: 'note not found' } };
        return { result: { note: args.note, content } };
      }
      if (name === 'write_note') return { error: { code: -32601, message: 'write not allowed' } };
      return { error: { code: -32601, message: `unknown ${name}` } };
    },
    async close() {},
    ...overrides,
  };
}

function ctx(): ExecutionContext {
  return {
    jobId: 'job_1',
    reportProgress: () => undefined,
    signal: new AbortController().signal,
    secrets: { get: async () => null },
    workDir: '',
  };
}

function input(goal: string) {
  return {
    goal,
    snapshot: { id: 's1', taskId: 't1', createdAt: new Date().toISOString(), items: [] },
    subjectContext: { subjectId: 's1', derivedAt: new Date().toISOString(), entries: [] },
    artifactType: 'document',
  };
}

describe('mcp-readonly-adapter-01', () => {
  it('mcp-stdio is in ADAPTER_TYPES and maps from mcp-tool', () => {
    assert.ok(isAdapterType('mcp-stdio'));
    assert.equal(mapConnectorClassToAdapterType('mcp-tool'), 'mcp-stdio');
    assert.doesNotThrow(() => assertMcpWireableGuard());
    assert.doesNotThrow(() =>
      assertMcpRegistrationShape({
        kind: 'tool',
        permissions: ['filesystem_read'],
        adapter: { type: 'mcp-stdio' },
      }),
    );
  });

  it('adapter kind=tool, adapterType=mcp-stdio, readonly permission', () => {
    const adapter = createMcpReadonlyAdapter({ transportHook: fakeTransport(), forceAvailability: 'available' });
    const d = adapter.describe();
    assert.equal(adapter.registration.kind, 'tool');
    assert.equal(adapter.registration.adapter.type, 'mcp-stdio');
    assert.equal(adapter.registration.adapter.adapterId, MCP_READONLY_ADAPTER_ID);
    assert.equal(adapter.registration.id, MCP_READONLY_CAPABILITY_ID);
    assert.ok(!adapter.registration.permissions.includes('filesystem_write'));
    assert.ok(adapter.registration.permissions.includes('filesystem_read'));
    assert.equal(d.adapterType, 'mcp-stdio');
    assert.equal(d.supportsAsyncRemote, false);
  });

  it('lists readonly tools', async () => {
    const adapter = createMcpReadonlyAdapter({ transportHook: fakeTransport(), forceAvailability: 'available' });
    const out = await adapter.execute(input('list_notes()'), ctx());
    const text = String((out.artifact.payload as { kind: 'text'; text: string }).text);
    assert.match(text, /note-001\.md/);
    assert.match(text, /note-002\.md/);
  });

  it('lookup_note succeeds with grounded content', async () => {
    const adapter = createMcpReadonlyAdapter({ transportHook: fakeTransport(), forceAvailability: 'available' });
    const out = await adapter.execute(input('lookup_note(note=note-001.md)'), ctx());
    const text = String((out.artifact.payload as { kind: 'text'; text: string }).text);
    assert.match(text, /note-001\.md/);
    assert.match(text, /使用说明/);
  });

  it('write tool is rejected and honest failure', async () => {
    const adapter = createMcpReadonlyAdapter({ transportHook: fakeTransport(), forceAvailability: 'available' });
    await assert.rejects(
      () => adapter.execute(input('write_note(name=evil.md, content=x)'), ctx()),
      /rejected_by_digitalme_policy|not allowed tool for readonly capability/,
    );
    // 即使白名单被覆盖加入写工具，也必须拒绝，且不得调用传输
    let called = false;
    const transport = fakeTransport({
      async callTool(name, args) {
        called = true;
        return fakeTransport().callTool(name, args);
      },
    });
    const loose = createMcpReadonlyAdapter({
      transportHook: transport,
      forceAvailability: 'available',
      allowedTools: ['list_notes', 'lookup_note', 'write_note'],
    });
    await assert.rejects(
      () => loose.execute(input('write_note(name=evil.md, content=x)'), ctx()),
      /rejected_by_digitalme_policy|write tool is not allowed/,
    );
    assert.equal(called, false);
  });

  it('unavailable server => checkAvailability unavailable, honest failure on execute', async () => {
    const adapter = createMcpReadonlyAdapter({ forceAvailability: 'unavailable' });
    const avail = await adapter.checkAvailability();
    assert.equal(avail.available, false);
    // 默认（无 transportHook）会 spawn 本地 fixture 服务器：存在则可用
    const spawned = createMcpReadonlyAdapter({});
    const avail2 = await spawned.checkAvailability();
    assert.equal(avail2.available, true, 'local fixture server should be reachable by default');
    // 无效服务器命令 → 探测失败 → 不可用，诚实失败
    const broken = createMcpReadonlyAdapter({
      serverCommand: ['node', 'C:/definitely/not/exist/mcp-readonly-server.cjs'],
    });
    const avail3 = await broken.checkAvailability();
    assert.equal(avail3.available, false);
    assert.doesNotMatch(String(avail3.detail || ''), /MCP|stdio|JSON-RPC/i);
  });

  it('user-facing labels / registration copy carry no protocol jargon', () => {
    const adapter = createMcpReadonlyAdapter({ transportHook: fakeTransport(), forceAvailability: 'available' });
    const copy = [
      adapter.registration.displayName,
      adapter.registration.description,
      adapter.describe().displayName,
    ].join(' ');
    for (const bad of ['MCP', 'stdio', 'tool_calls', 'JSON-RPC', 'endpoint']) {
      assert.equal(new RegExp(bad, 'i').test(copy), false, `copy must not contain ${bad}`);
    }
    assert.match(copy, /资料查询能力/);
  });

  it('default runtime does not expose the mcp-readonly capability (no empty shell)', async () => {
    const rt = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
    const listed = await rt.listCapabilities({});
    const caps = listed.capabilities;
    assert.ok(!caps.some((c) => c.id === MCP_READONLY_CAPABILITY_ID), 'mcp-readonly must not be auto-registered');
    // explicit options registers it
    const rt2 = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      mcpReadonlyCapability: { transportHook: fakeTransport(), forceAvailability: 'available' },
    } as never);
    const listed2 = await rt2.listCapabilities({});
    assert.ok(listed2.capabilities.some((c) => c.id === MCP_READONLY_CAPABILITY_ID), 'explicit options must register it');
  });
});