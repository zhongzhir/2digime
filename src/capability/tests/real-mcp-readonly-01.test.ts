/**
 * REAL-MCP-READONLY-01 单测：只读投影、写拒绝、自然语言结果。
 * 不 spawn 真实第三方进程（真实协议在 gate 中验证）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMcpReadonlyAdapter,
  looksLikeProvidedMaterialsLookup,
  projectReadonlyTools,
  REJECTED_BY_DIGITALME_POLICY,
} from '../adapters/mcp-stdio-readonly';
import {
  formatActiveProjectAnswer,
  parseListedFileNames,
} from '../adapters/mcp-readonly-policy';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutionContext } from '../adapter';
import type { McpTransport } from '../adapters/mcp-stdio-readonly';

const SERVER_TOOLS = [
  { name: 'read_file', annotations: { readOnlyHint: true } },
  { name: 'read_text_file', annotations: { readOnlyHint: true } },
  { name: 'write_file', annotations: { readOnlyHint: false } },
  { name: 'edit_file', annotations: { readOnlyHint: false } },
  { name: 'create_directory', annotations: { readOnlyHint: false } },
  { name: 'list_directory', annotations: { readOnlyHint: true } },
  { name: 'move_file', annotations: { readOnlyHint: false } },
  { name: 'search_files', annotations: { readOnlyHint: true } },
  { name: 'get_file_info', annotations: { readOnlyHint: true } },
];

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

function filesystemTransport(calls: string[]): McpTransport {
  const files: Record<string, string> = {
    'project-alpha.md': 'Project Alpha\nOwner: Alice\nStatus: active\nPriority: high\n',
    'project-beta.md': 'Project Beta\nOwner: Bob\nStatus: paused\nPriority: low\n',
  };
  return {
    async listTools() {
      calls.push('tools/list');
      return SERVER_TOOLS;
    },
    async callTool(name, args) {
      calls.push(`tools/call:${name}`);
      if (name === 'list_directory') {
        return {
          result: {
            content: [{ type: 'text', text: '[FILE] project-alpha.md\n[FILE] project-beta.md' }],
          },
        };
      }
      if (name === 'read_text_file' || name === 'read_file') {
        const p = String(args.path || '').replace(/\\/g, '/');
        const base = p.split('/').pop() || '';
        const text = files[base];
        if (!text) return { error: { message: 'not found' } };
        return { result: { content: [{ type: 'text', text }] } };
      }
      return { error: { message: `unexpected ${name}` } };
    },
    async close() {},
  };
}

describe('real-mcp-readonly-01', () => {
  it('projects only readonly tools from a real tools/list shape', () => {
    const visible = projectReadonlyTools(SERVER_TOOLS);
    assert.deepEqual(visible.sort(), [
      'get_file_info',
      'list_directory',
      'read_file',
      'read_text_file',
      'search_files',
    ]);
    assert.equal(visible.includes('write_file'), false);
    assert.equal(visible.includes('edit_file'), false);
    assert.equal(visible.includes('move_file'), false);
    assert.equal(visible.includes('create_directory'), false);
  });

  it('rejects write_file in Digital Me policy before transport.callTool', async () => {
    const calls: string[] = [];
    const adapter = createMcpReadonlyAdapter({
      transportHook: filesystemTransport(calls),
      forceAvailability: 'available',
      allowedTools: projectReadonlyTools(SERVER_TOOLS),
      queryMode: 'filesystem-lookup',
      allowedDirectory: 'D:\\tmp\\notes-root',
    });
    await assert.rejects(
      () => adapter.execute(input('write_file(path=hack.md, content=x)'), ctx()),
      (err: Error & { code?: string }) => {
        assert.match(String(err.message), new RegExp(REJECTED_BY_DIGITALME_POLICY));
        assert.equal(err.code, REJECTED_BY_DIGITALME_POLICY);
        return true;
      },
    );
    assert.equal(calls.some((c) => c.includes('write_file')), false);
  });

  it('NL lookup uses MCP list/read results and has no protocol jargon', async () => {
    const calls: string[] = [];
    const adapter = createMcpReadonlyAdapter({
      transportHook: filesystemTransport(calls),
      forceAvailability: 'available',
      allowedTools: projectReadonlyTools(SERVER_TOOLS),
      queryMode: 'filesystem-lookup',
      allowedDirectory: 'D:\\tmp\\notes-root',
      lookupDirectory: 'D:\\tmp\\notes-root\\notes',
    });
    const out = await adapter.execute(
      input('查看提供的项目资料，告诉我哪个项目处于 active 状态，以及它的优先级。'),
      ctx(),
    );
    const text = String((out.artifact.payload as { kind: 'text'; text: string }).text);
    assert.equal(text, 'Project Alpha 处于 active 状态，优先级为 high。');
    for (const bad of ['MCP', 'JSON-RPC', 'stdio', 'tools/list', 'server-filesystem']) {
      assert.equal(new RegExp(bad, 'i').test(text), false, text);
    }
    assert.ok(calls.includes('tools/list'));
    assert.ok(calls.includes('tools/call:list_directory'));
    assert.ok(calls.includes('tools/call:read_text_file'));
    assert.equal(calls.some((c) => c.includes('write_file')), false);
  });

  it('formats answer from MCP text, not from a baked-in name', () => {
    assert.equal(
      formatActiveProjectAnswer([
        { name: 'a.md', text: 'Nile\nStatus: paused\nPriority: low\n' },
        { name: 'b.md', text: 'Delta\nStatus: active\nPriority: medium\n' },
      ]),
      'Delta 处于 active 状态，优先级为 medium。',
    );
    assert.deepEqual(parseListedFileNames('[FILE] a.md\n[DIR] skip\n[FILE] b.md'), ['a.md', 'b.md']);
  });

  it('2digime selects the readonly tool capability for a lookup goal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dm-real-mcp-ut-'));
    const calls: string[] = [];
    const rt = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      externalExecutorCapability: false,
      mcpReadonlyCapability: {
        transportHook: filesystemTransport(calls),
        forceAvailability: 'available',
        allowedTools: projectReadonlyTools(SERVER_TOOLS),
        queryMode: 'filesystem-lookup',
        allowedDirectory: path.join(dir, 'notes-root'),
        lookupDirectory: path.join(dir, 'notes-root', 'notes'),
      },
    });
    await rt.createPackage({ displayName: 'real-mcp-ut', targetDir: dir });
    const listed = await rt.listCapabilities({});
    assert.ok(listed.capabilities.some((c) => c.id === 'cap_mcp_readonly'));
    const started = await rt.submitTask({
      goal: '查看提供的项目资料，告诉我哪个项目处于 active 状态，以及它的优先级。',
      contextRefs: [],
    });
    assert.ok(started.jobId);
    const job = await waitForJobTerminal(rt.workRuntime, started.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, 'cap_mcp_readonly');
    assert.ok(calls.includes('tools/call:read_text_file'));
    rt.workRuntime.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('lookup goal still selects readonly materials when a writing capability exists', async () => {
    assert.equal(
      looksLikeProvidedMaterialsLookup(
        '查看提供的项目资料，告诉我哪个项目处于 active 状态，以及它的优先级。',
      ),
      true,
    );
    assert.equal(looksLikeProvidedMaterialsLookup('你现在对我的工作有什么了解？'), false);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dm-real-mcp-doc-'));
    const calls: string[] = [];
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      externalExecutorCapability: false,
      mcpReadonlyCapability: {
        transportHook: filesystemTransport(calls),
        forceAvailability: 'available',
        allowedTools: projectReadonlyTools(SERVER_TOOLS),
        queryMode: 'filesystem-lookup',
        allowedDirectory: path.join(dir, 'notes-root'),
        lookupDirectory: path.join(dir, 'notes-root', 'notes'),
      },
    });
    await rt.createPackage({ displayName: 'real-mcp-doc', targetDir: dir });
    const started = await rt.submitTask({
      goal: '查看提供的项目资料，告诉我哪个项目处于 active 状态，以及它的优先级。',
      contextRefs: [],
    });
    assert.ok(started.jobId);
    const job = await waitForJobTerminal(rt.workRuntime, started.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, 'cap_mcp_readonly');
    assert.ok(calls.includes('tools/call:read_text_file'));
    const looked = await rt.tryProvidedMaterialsLookup(
      '查看提供的项目资料，告诉我哪个项目处于 active 状态，以及它的优先级。',
    );
    assert.ok(looked && /Project Alpha/.test(looked.text) && /high/i.test(looked.text));
    rt.workRuntime.stop();
    await rm(dir, { recursive: true, force: true });
  });
});
