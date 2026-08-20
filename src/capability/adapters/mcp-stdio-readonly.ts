/**
 * MCP-READONLY-ADAPTER-01 — 最小只读外部工具能力（mcp-stdio）。
 *
 * 工具不是 Agent：本能力只提供 list / read / lookup 类只读工具，
 * 不进入 Coding Job / 自主循环。写文件、改仓库、执行命令、网络检索、付款类
 * 必须拒绝并诚实失败。
 *
 * 生命周期遵循 V2 CapabilityAdapter：describe / checkAvailability /
 * prepareAuthorizedInput / execute / getStatus / cancel / recover / collectArtifact。
 * 默认不注册；仅测试、gate、显式 options 才注册。
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import type { CapabilityAdapter, CapabilityInput, CapabilityOutput, ExecutionContext } from '../adapter';
import type { CapabilityRegistration } from '../registration';
import {
  REJECTED_BY_DIGITALME_POLICY,
  assertPathInsideAllowed,
  extractMcpToolText,
  formatActiveProjectAnswer,
  isWriteTool,
  parseListedFileNames,
} from './mcp-readonly-policy';

export {
  MCP_FILESYSTEM_READONLY_CANDIDATES,
  REJECTED_BY_DIGITALME_POLICY,
  buildFilesystemMcpServerCommand,
  isWriteTool,
  looksLikeProvidedMaterialsLookup,
  projectReadonlyTools,
} from './mcp-readonly-policy';

export const MCP_READONLY_CAPABILITY_ID = 'cap_mcp_readonly';
export const MCP_READONLY_ADAPTER_ID = 'mcp-stdio-readonly';

/** 只读允许清单：仅 list / read / lookup 类工具。 */
export const MCP_READONLY_ALLOWED_TOOLS = ['list_notes', 'lookup_note'] as const;
export type McpReadonlyAllowedTool = (typeof MCP_READONLY_ALLOWED_TOOLS)[number];

const READONLY_REGISTRATION: CapabilityRegistration = {
  id: MCP_READONLY_CAPABILITY_ID,
  kind: 'tool',
  displayName: '资料查询能力',
  description: '在已连接的只读资料库中列出条目并按名称读取内容。不会修改任何文件或数据。',
  inputContract: {
    acceptsGoal: true,
    acceptsSnapshot: true,
    acceptsSubjectContext: true,
  },
  outputArtifactTypes: ['document'],
  permissions: ['filesystem_read'],
  cost: { estimate: '本地查询，费用可忽略' },
  latencyEstimate: '数秒',
  location: 'local',
  availability: 'needs_setup',
  adapter: {
    type: 'mcp-stdio',
    adapterId: MCP_READONLY_ADAPTER_ID,
  },
};

/**
 * JSON-RPC stdio 传输。
 * transportHook 供单测注入，避免每测 spawn；缺省用 node 子进程启动 fixture 服务器。
 */
export interface McpTransport {
  listTools(): Promise<Array<{ name: string; description?: string; annotations?: { readOnlyHint?: boolean } }>>;
  callTool(name: string, args: Record<string, unknown>): Promise<{
    result?: unknown;
    error?: { code?: number; message?: string };
  }>;
  close(): Promise<void>;
  getInitializeResult?(): McpInitializeResult | null;
}

export interface McpInitializeResult {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
}

export interface McpReadonlyOptions {
  /** 服务器启动命令（default: node fixture server）。 */
  serverCommand?: string[];
  serverCwd?: string;
  /** 只读工具白名单覆盖（不得加入写工具）。 */
  allowedTools?: readonly string[];
  /** 测试注入：直接提供传输替身。 */
  transportHook?: McpTransport;
  /** 强制可用性（测试用）。 */
  forceAvailability?: 'available' | 'unavailable' | 'needs_setup';
  /**
   * 真实 MCP：initialize → notifications/initialized → tools/list。
   * fixture 默认 false，保持原 JSON-RPC 行为。
   */
  handshake?: boolean;
  /** 真实 filesystem 查询：自然语言目标走 list/read，不把答案写进 prompt。 */
  queryMode?: 'tool-goal' | 'filesystem-lookup';
  /** MCP Server 允许访问的唯一目录（也用于 tools/call 的 path）。 */
  allowedDirectory?: string;
  /** 资料子目录；默认 allowedDirectory。 */
  lookupDirectory?: string;
  /** 协议调用超时（真实 npx 首次拉取需要更长时间）。 */
  responseTimeoutMs?: number;
  /** 审计：记录 method，不向用户面泄漏。 */
  onProtocolEvent?: (event: { method: string; toolName?: string }) => void;
}

export function createMcpReadonlyAdapter(options: McpReadonlyOptions = {}): CapabilityAdapter {
  const allowedTools = (options.allowedTools ?? MCP_READONLY_ALLOWED_TOOLS).filter((name) => !isWriteTool(name));
  const registration: CapabilityRegistration = {
    ...READONLY_REGISTRATION,
    availability:
      options.forceAvailability === 'available'
        ? 'available'
        : options.forceAvailability === 'unavailable'
          ? 'unavailable'
          : 'needs_setup',
  };

  return asLocalCapabilityAdapter({
    registration,
    adapterContractVersion: 'mcp-stdio-readonly/1',
    describe: () => ({
      adapterId: MCP_READONLY_ADAPTER_ID,
      adapterType: 'mcp-stdio',
      capabilityId: MCP_READONLY_CAPABILITY_ID,
      displayName: registration.displayName,
      location: 'local',
      outputArtifactTypes: ['document'],
      supportsAsyncRemote: false,
      version: 'mcp-stdio-readonly/1',
    }),
    checkAvailability: async () => {
      if (options.forceAvailability === 'available' || options.transportHook) {
        return { available: true, detail: 'ready' };
      }
      if (options.forceAvailability === 'unavailable') {
        return { available: false, reason: 'unreachable', detail: '资料查询能力当前不可用。' };
      }
      if (options.forceAvailability === 'needs_setup') {
        return { available: false, reason: 'needs_setup', detail: '尚未连接可用的资料查询能力。' };
      }
      // 探测：命令不存在 / 握手失败 → 不可用，文案中性
      try {
        const transport = await openTransport(options);
        try {
          await transport.listTools();
          return { available: true, detail: 'ready' };
        } finally {
          await transport.close().catch(() => undefined);
        }
      } catch {
        return { available: false, reason: 'needs_setup', detail: '尚未连接可用的资料查询能力。' };
      }
    },
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (ctx.signal.aborted) throw abortError();
      if (options.queryMode === 'filesystem-lookup' && !looksLikeExplicitToolGoal(input.goal)) {
        return runFilesystemLookup(input, ctx, options, allowedTools);
      }
      const { toolName, args } = parseGoalTool(input);
      if (isWriteTool(toolName)) {
        throw policyReject();
      }
      if (!allowedTools.includes(toolName as McpReadonlyAllowedTool)) {
        throw Object.assign(new Error(`not allowed tool for readonly capability: ${toolName}`), {
          stage: 'capability' as const,
          actionable: '当前只读能力不支持该操作，任务未完成。',
        });
      }
      ctx.reportProgress('正在查询资料');
      const transport = options.transportHook ?? (await openTransport(options));
      try {
        options.onProtocolEvent?.({ method: 'tools/call', toolName });
        const resp = await transport.callTool(toolName, args);
        if (resp.error) {
          throw Object.assign(new Error(resp.error.message || '资料查询失败'), {
            stage: 'capability' as const,
            actionable: '资料查询失败，未完成任务。',
            code: 'mcp_call_failed',
          });
        }
        const text = renderToolResult(toolName, resp.result);
        return {
          artifact: {
            type: 'document',
            title: '资料查询结果',
            payload: { kind: 'text', format: 'markdown', text },
          },
        };
      } finally {
        if (!options.transportHook) {
          await transport.close().catch(() => undefined);
        }
      }
    },
  });
}

function looksLikeExplicitToolGoal(goal: unknown): boolean {
  return /^\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?\s*$/.test(String(goal || ''));
}

function policyReject(): Error {
  return Object.assign(new Error(REJECTED_BY_DIGITALME_POLICY), {
    stage: 'capability' as const,
    code: REJECTED_BY_DIGITALME_POLICY,
    actionable: '当前只读能力不会修改任何文件或数据。',
  });
}

async function runFilesystemLookup(
  input: CapabilityInput,
  ctx: ExecutionContext,
  options: McpReadonlyOptions,
  allowedTools: readonly string[],
): Promise<CapabilityOutput> {
  const allowedDirectory = options.allowedDirectory;
  if (!allowedDirectory) {
    throw Object.assign(new Error('尚未连接可用的资料查询能力。'), {
      stage: 'capability' as const,
      actionable: '尚未连接可用的资料查询能力。',
    });
  }
  const lookupRoot = assertPathInsideAllowed(
    options.lookupDirectory || allowedDirectory,
    allowedDirectory,
  );
  ctx.reportProgress('正在查询资料');
  const transport = options.transportHook ?? (await openTransport(options));
  try {
    options.onProtocolEvent?.({ method: 'tools/list' });
    const listed = await transport.listTools();
    const available = new Set(listed.map((t) => t.name));
    const listName = ['list_directory'].find(
      (n) => allowedTools.includes(n) && available.has(n),
    );
    const readName = ['read_text_file', 'read_file'].find(
      (n) => allowedTools.includes(n) && available.has(n),
    );
    if (!listName || !readName) {
      throw Object.assign(new Error('资料查询失败'), {
        stage: 'capability' as const,
        actionable: '当前只读能力无法列出或读取资料。',
      });
    }
    options.onProtocolEvent?.({ method: 'tools/call', toolName: listName });
    const listResp = await transport.callTool(listName, { path: lookupRoot });
    if (listResp.error) {
      throw Object.assign(new Error(listResp.error.message || '资料查询失败'), {
        stage: 'capability' as const,
        actionable: '资料查询失败，未完成任务。',
      });
    }
    const fileNames = parseListedFileNames(extractMcpToolText(listResp.result)).filter((n) =>
      /\.md$/i.test(n),
    );
    const notes: Array<{ name: string; text: string }> = [];
    for (const name of fileNames) {
      const filePath = assertPathInsideAllowed(path.join(lookupRoot, name), allowedDirectory);
      options.onProtocolEvent?.({ method: 'tools/call', toolName: readName });
      const readResp = await transport.callTool(readName, { path: filePath });
      if (readResp.error) continue;
      notes.push({ name, text: extractMcpToolText(readResp.result) });
    }
    const text = formatActiveProjectAnswer(notes);
    return {
      artifact: {
        type: 'document',
        title: '资料查询结果',
        payload: { kind: 'text', format: 'plain', text },
      },
    };
  } finally {
    if (!options.transportHook) {
      await transport.close().catch(() => undefined);
    }
  }
}

function parseGoalTool(input: CapabilityInput): { toolName: string; args: Record<string, unknown> } {
  const goal = String(input.goal || '').trim();
  const m = goal.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*$/);
  if (!m) {
    throw Object.assign(new Error('资料查询任务需要一个明确的操作'), {
      stage: 'capability' as const,
      actionable: '请说明要查询的资料操作。',
    });
  }
  const toolName = m[1]!;
  const args: Record<string, unknown> = {};
  if (m[2]) {
    for (const pair of m[2].split(/[;,]/)) {
      const [k, v] = pair.split(/[=:]/).map((s) => s.trim());
      if (k && v) args[k] = v;
    }
  }
  return { toolName, args };
}

function renderToolResult(toolName: string, result: unknown): string {
  const text = JSON.stringify(result, null, 2);
  return [`# 资料查询：${toolName}`, '', '```json', text, '```'].join('\n');
}

function openTransport(options: McpReadonlyOptions): Promise<McpTransport> {
  const serverCommand = options.serverCommand ?? defaultServerCommand();
  const serverCwd = options.serverCwd ?? defaultServerCwd();
  return Promise.resolve(
    createChildTransport(serverCommand, serverCwd, {
      handshake: options.handshake === true,
      ...(options.responseTimeoutMs != null ? { timeoutMs: options.responseTimeoutMs } : {}),
      ...(options.onProtocolEvent ? { onProtocolEvent: options.onProtocolEvent } : {}),
    }),
  );
}

function defaultServerCommand(): string[] {
  return [process.execPath, path.resolve(__dirname, '../../../scripts/fixtures/mcp-readonly/mcp-readonly-server.cjs')];
}

function defaultServerCwd(): string {
  return path.resolve(__dirname, '../../../scripts/fixtures/mcp-readonly');
}

/** 通过子进程启动 JSON-RPC stdio 服务器。handshake=true 时发送真实 MCP initialize。 */
export function createChildTransport(
  command: string[],
  cwd: string,
  extras: {
    handshake?: boolean;
    timeoutMs?: number;
    onProtocolEvent?: McpReadonlyOptions['onProtocolEvent'];
  } = {},
): McpTransport {
  const executable = command[0];
  if (!executable) {
    throw new Error('mcp server command is empty');
  }
  const child = spawn(executable, command.slice(1), {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    env: process.env,
  }) as import('node:child_process').ChildProcessByStdio<
    import('node:stream').Writable,
    import('node:stream').Readable,
    import('node:stream').Readable
  >;
  let buffer = '';
  let nextId = 1;
  let closed = false;
  let spawnFailed = false;
  let initializeResult: McpInitializeResult | null = null;
  let handshakeDone = extras.handshake !== true;
  const timeoutMs = extras.timeoutMs ?? (extras.handshake ? 90_000 : 8_000);

  const rawResolvers = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  child.on('error', (err: Error) => {
    spawnFailed = true;
    for (const resolver of rawResolvers.values()) resolver.reject(err);
    rawResolvers.clear();
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id == null) continue;
      const resolver = rawResolvers.get(Number(msg.id));
      if (!resolver) continue;
      rawResolvers.delete(Number(msg.id));
      resolver.resolve(msg);
    }
  });

  function send(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        rawResolvers.delete(id);
        reject(new Error('资料查询超时'));
      }, timeoutMs);
      rawResolvers.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      if (spawnFailed || child.stdin?.destroyed) {
        rawResolvers.delete(id);
        clearTimeout(timer);
        reject(new Error('mcp server process failed to start'));
        return;
      }
      extras.onProtocolEvent?.({ method });
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async function ensureHandshake(): Promise<void> {
    if (handshakeDone) return;
    extras.onProtocolEvent?.({ method: 'initialize' });
    const res = (await send('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'digitalme', version: '0.1.0' },
    })) as { result?: McpInitializeResult; error?: { message?: string } };
    if (res.error) {
      throw new Error(res.error.message || 'initialize failed');
    }
    initializeResult = res.result || {};
    extras.onProtocolEvent?.({ method: 'notifications/initialized' });
    child.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
    );
    handshakeDone = true;
  }

  void child.stderr?.on('data', () => undefined);

  return {
    getInitializeResult() {
      return initializeResult;
    },
    async listTools() {
      await ensureHandshake();
      const res = (await send('tools/list', {})) as {
        result?: { tools?: Array<{ name: string; description?: string; annotations?: { readOnlyHint?: boolean } }> };
      };
      return res?.result?.tools ?? [];
    },
    async callTool(name, args) {
      await ensureHandshake();
      if (isWriteTool(name)) {
        throw policyReject();
      }
      const res = (await send('tools/call', { name, arguments: args })) as {
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      return { ...(res.result !== undefined ? { result: res.result } : {}), ...(res.error ? { error: res.error } : {}) };
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        child.stdin?.end();
      } catch {
        /* ignore */
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          resolve();
        }, 500);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('error', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
