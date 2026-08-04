/**
 * ControlledRemoteCapabilityAdapter — 正式 remote-subject Adapter 参考实现。
 * 使用真实 HTTP 边界(本地测试 server / 独立进程);可被未来 A2A Adapter 替换。
 * 不是测试专用 Fake;不使用固定成功模板文本冒充成果。
 */
import { createHash, randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type {
  AdapterDescribeResult,
  AvailabilityCheckResult,
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
  RemoteCancelResult,
  RemoteExecutionRef,
  RemoteLifecycleStatus,
  RemoteRecoverResult,
  RemoteStatusView,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import {
  applyAuthorizationProjectionToInput,
  assertProjectionUsable,
  type RemoteAuthorizationProjection,
} from '../remote-authorization';
import { RemoteSecurityGate, type RemoteSecurityBudget } from '../remote-security';
import { nowIso } from '../../shared/ids';

export const CONTROLLED_REMOTE_CAPABILITY_ID = 'cap_controlled_remote_subject';
export const CONTROLLED_REMOTE_ADAPTER_ID = 'controlled-remote-subject';
export const CONTROLLED_REMOTE_ADAPTER_VERSION = 'controlled-remote/1';

export interface ControlledRemoteOptions {
  /** 远端 HTTP 根,如 http://127.0.0.1:9876 */
  endpoint: string;
  /** 白名单;缺省仅允许 endpoint 本身。 */
  allowedEndpoints?: string[];
  displayName?: string;
  timeoutMs?: number;
  maxCallsPerTask?: number;
  maxConcurrent?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxRetries?: 0 | 1;
  killSwitch?: boolean;
  pollIntervalMs?: number;
  /** 占位 Token 预算。 */
  maxTokens?: number;
  security?: Partial<RemoteSecurityBudget>;
}

interface PeerExecution {
  id: string;
  status: RemoteLifecycleStatus;
  goal: string;
  purpose: string;
  materials: Array<{ path: string; digest?: string; excerpt: string }>;
  createdAt: string;
  updatedAt: string;
  artifactText?: string;
  title?: string;
  error?: string;
  cancelRequested?: boolean;
  /** 故障注入 */
  fault?: PeerFault;
  timer?: ReturnType<typeof setTimeout>;
}

export type PeerFault =
  | 'none'
  | 'never_complete'
  | 'fail_after_start'
  | 'malformed_artifact'
  | 'leak_unauthorized'
  | 'request_extra_material'
  | 'ignore_cancel'
  | 'delay_complete';

export interface ControlledRemotePeerOptions {
  host?: string;
  port?: number;
  /** 默认处理延迟,便于测异步 pending→running→completed。 */
  processDelayMs?: number;
  defaultFault?: PeerFault;
  unauthorizedMarker?: string;
}

export interface ControlledRemotePeer {
  baseUrl: string;
  host: string;
  port: number;
  close(): Promise<void>;
  setFault(executionId: string | null, fault: PeerFault): void;
  getExecution(executionId: string): PeerExecution | undefined;
}

export function buildControlledRemoteRegistration(
  options: Pick<ControlledRemoteOptions, 'displayName'> = {},
): CapabilityRegistration {
  return {
    id: CONTROLLED_REMOTE_CAPABILITY_ID,
    kind: 'service',
    displayName: options.displayName ?? '受控远端能力',
    description: '经授权投影与验证门禁的远端主体能力参考实现',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: false,
    },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: '受控预算内' },
    latencyEstimate: '数秒到数十秒',
    location: 'remote',
    availability: 'available',
    adapter: {
      type: 'remote-subject',
      adapterId: CONTROLLED_REMOTE_ADAPTER_ID,
    },
  };
}

/**
 * 启动本地受控对端 HTTP 服务 — 真实进程内 HTTP 边界,供验收与集成测试。
 * 合成结果随 goal/材料变化,非固定成功句。
 */
export async function startControlledRemotePeer(
  options: ControlledRemotePeerOptions = {},
): Promise<ControlledRemotePeer> {
  const host = options.host ?? '127.0.0.1';
  const processDelayMs = options.processDelayMs ?? 80;
  const executions = new Map<string, PeerExecution>();
  let globalFault: PeerFault = options.defaultFault ?? 'none';
  const unauthorizedMarker = options.unauthorizedMarker ?? 'SECRET_UNAUTHORIZED_PAYLOAD_XYZ';

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`);
      if (req.method === 'POST' && url.pathname === '/v1/executions') {
        const body = await readJson(req);
        // 远端尝试索要额外材料 → 拒绝扩大范围,记录记录并失败
        if (body?.requestExtraMaterials || globalFault === 'request_extra_material') {
          writeJson(res, 403, {
            error: 'extra_material_request_denied',
            message: 'remote may not request materials beyond authorization',
          });
          return;
        }
        const id = `rex_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const fault: PeerFault = body?.fault || globalFault;
        const exec: PeerExecution = {
          id,
          status: 'pending',
          goal: String(body?.goal || ''),
          purpose: String(body?.purpose || ''),
          materials: Array.isArray(body?.materials) ? body.materials : [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
          fault,
        };
        executions.set(id, exec);
        scheduleProgress(exec);
        writeJson(res, 202, { executionId: id, status: exec.status });
        return;
      }

      const execMatch = /^\/v1\/executions\/([^/]+)(?:\/(cancel|artifact))?$/.exec(url.pathname);
      if (!execMatch) {
        writeJson(res, 404, { error: 'not_found' });
        return;
      }
      const executionId = decodeURIComponent(execMatch[1] || '');
      const action = execMatch[2];
      const exec = executions.get(executionId);
      if (!exec) {
        writeJson(res, 404, { error: 'execution_not_found' });
        return;
      }

      if (req.method === 'GET' && !action) {
        writeJson(res, 200, {
          executionId: exec.id,
          status: exec.status,
          ...(exec.error ? { error: exec.error } : {}),
        });
        return;
      }

      if (req.method === 'POST' && action === 'cancel') {
        if (exec.fault === 'ignore_cancel') {
          writeJson(res, 500, { error: 'cancel_failed', message: 'injected cancel failure' });
          return;
        }
        exec.cancelRequested = true;
        if (exec.timer) clearTimeout(exec.timer);
        if (exec.status === 'pending' || exec.status === 'running') {
          exec.status = 'cancelled';
          exec.updatedAt = nowIso();
        }
        writeJson(res, 200, { cancelled: true, status: exec.status });
        return;
      }

      if (req.method === 'GET' && action === 'artifact') {
        if (exec.status === 'cancelled') {
          writeJson(res, 409, { error: 'cancelled', message: 'execution cancelled' });
          return;
        }
        if (exec.status !== 'completed') {
          writeJson(res, 409, { error: 'not_ready', status: exec.status });
          return;
        }
        if (exec.fault === 'malformed_artifact') {
          writeJson(res, 200, { notArtifact: true, garbage: 123 });
          return;
        }
        writeJson(res, 200, {
          artifact: {
            type: 'document',
            title: exec.title,
            payload: { kind: 'text', format: 'markdown', text: exec.artifactText },
          },
          provenance: `controlled-remote:${exec.id}`,
          sourceBinding: exec.id,
          contentDigest: sha256(exec.artifactText || ''),
        });
        return;
      }

      writeJson(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      writeJson(res, 500, { error: (error as Error).message || 'peer_error' });
    }
  });

  function scheduleProgress(exec: PeerExecution): void {
    exec.timer = setTimeout(() => {
      if (exec.cancelRequested || exec.status === 'cancelled') return;
      exec.status = 'running';
      exec.updatedAt = nowIso();
      exec.timer = setTimeout(() => {
        if (exec.cancelRequested || exec.status === 'cancelled') return;
        if (exec.fault === 'never_complete') {
          exec.status = 'running';
          exec.updatedAt = nowIso();
          return;
        }
        if (exec.fault === 'fail_after_start') {
          exec.status = 'failed';
          exec.error = 'injected remote failure';
          exec.updatedAt = nowIso();
          return;
        }
        const synthesized = synthesizeFromInput({
          goal: exec.goal,
          purpose: exec.purpose,
          materials: exec.materials,
          executionId: exec.id,
          ...(exec.fault === 'leak_unauthorized'
            ? { leakUnauthorized: unauthorizedMarker }
            : {}),
        });
        exec.artifactText = synthesized.text;
        exec.title = synthesized.title;
        exec.status = 'completed';
        exec.updatedAt = nowIso();
      }, exec.fault === 'delay_complete' ? processDelayMs * 8 : processDelayMs);
    }, Math.max(10, Math.floor(processDelayMs / 2)));
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('failed to bind controlled remote peer'));
    });
  });

  return {
    baseUrl: `http://${host}:${port}`,
    host,
    port,
    async close() {
      for (const exec of executions.values()) {
        if (exec.timer) clearTimeout(exec.timer);
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    setFault(executionId, fault) {
      if (!executionId) {
        globalFault = fault;
        return;
      }
      const exec = executions.get(executionId);
      if (exec) exec.fault = fault;
    },
    getExecution(executionId) {
      return executions.get(executionId);
    },
  };
}

export function createControlledRemoteCapabilityAdapter(
  options: ControlledRemoteOptions,
): CapabilityAdapter {
  const registration = buildControlledRemoteRegistration(options);
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const gate = new RemoteSecurityGate({
    allowedEndpoints: options.allowedEndpoints ?? [endpoint],
    maxCallsPerTask: options.maxCallsPerTask ?? 1,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxConcurrent: options.maxConcurrent ?? 2,
    maxRetries: options.maxRetries ?? 1,
    maxInputBytes: options.maxInputBytes ?? 256_000,
    maxOutputBytes: options.maxOutputBytes ?? 512_000,
    killSwitch: options.killSwitch ?? false,
    tokenBudget: { maxTokens: options.maxTokens ?? 8_000, maxCostUnits: 0 },
    ...(options.security ?? {}),
  });
  const pollIntervalMs = options.pollIntervalMs ?? 40;
  const localCancelled = new Set<string>();
  const outputs = new Map<string, CapabilityOutput>();
  const taskIdByJob = new Map<string, string>();

  return {
    registration,
    describe(): AdapterDescribeResult {
      return {
        adapterId: CONTROLLED_REMOTE_ADAPTER_ID,
        adapterType: 'remote-subject',
        capabilityId: CONTROLLED_REMOTE_CAPABILITY_ID,
        displayName: registration.displayName,
        location: 'remote',
        outputArtifactTypes: [...registration.outputArtifactTypes],
        supportsAsyncRemote: true,
        version: CONTROLLED_REMOTE_ADAPTER_VERSION,
      };
    },
    async checkAvailability(): Promise<AvailabilityCheckResult> {
      if (gate.current.killSwitch) {
        return { available: false, reason: 'kill_switch', detail: '远端能力已关闭' };
      }
      try {
        gate.assertEndpointAllowed(endpoint);
        return { available: true };
      } catch (error) {
        return {
          available: false,
          reason: 'endpoint',
          detail: (error as Error).message,
        };
      }
    },
    async prepareAuthorizedInput(
      input: CapabilityInput,
      auth: RemoteAuthorizationProjection,
      _ctx: ExecutionContext,
    ): Promise<CapabilityInput> {
      assertProjectionUsable(auth, nowIso());
      if (auth.allowRemotePersist) {
        throw Object.assign(new Error('remote persist is not allowed'), {
          stage: 'capability' as const,
          actionable: '当前禁止远端持久化授权材料',
        });
      }
      return applyAuthorizationProjectionToInput(input, auth);
    },
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      const taskId = input.snapshot.taskId || ctx.jobId;
      taskIdByJob.set(ctx.jobId, taskId);
      gate.assertEndpointAllowed(endpoint);
      gate.beginCall(taskId);
      let retryCount = 0;
      const maxRetries = gate.current.maxRetries;
      try {
        ctx.reportProgress('正在提交远端执行');
        const payload = await buildRemotePayload(input, ctx);
        gate.assertInputSize(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
        gate.assertTokenBudget({ tokens: Math.ceil(payload.goal.length / 4) });

        let executionId: string | undefined;
        let lastError: unknown;
        while (retryCount <= maxRetries) {
          if (ctx.signal.aborted || localCancelled.has(ctx.jobId)) throw abortError();
          try {
            const started = await httpJson<{ executionId: string; status: string }>(
              `${endpoint}/v1/executions`,
              {
                method: 'POST',
                body: payload,
                signal: ctx.signal,
                timeoutMs: gate.current.timeoutMs,
              },
            );
            executionId = started.executionId;
            break;
          } catch (error) {
            lastError = error;
            if (ctx.signal.aborted) throw abortError();
            if (retryCount >= maxRetries || !isRetryableNetworkError(error)) throw error;
            retryCount += 1;
            ctx.reportProgress('远端提交重试中');
          }
        }
        if (!executionId) throw lastError instanceof Error ? lastError : new Error('remote start failed');

        const ref: RemoteExecutionRef = {
          executionId,
          adapterId: CONTROLLED_REMOTE_ADAPTER_ID,
          endpoint,
        };
        ctx.bindRemoteExecution?.({ ...ref, lastRemoteStatus: 'pending' });
        ctx.reportProgress('远端处理中');

        const completed = await pollUntilTerminal(ref, ctx);
        if (completed.status === 'cancelled' || localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
          throw abortError();
        }
        if (completed.status === 'failed') {
          throw Object.assign(new Error(completed.message || 'remote execution failed'), {
            stage: 'capability' as const,
            actionable: '远端执行失败,请重试或更换能力',
          });
        }

        const output = await this.collectArtifact(ref, ctx);
        outputs.set(executionId, output);
        outputs.set(ctx.jobId, output);
        return output;
      } finally {
        gate.endCall();
      }
    },
    async getStatus(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteStatusView> {
      if (localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
        return { status: 'cancelled', remoteAck: true };
      }
      gate.assertEndpointAllowed(ref.endpoint || endpoint);
      const data = await httpJson<{ status: RemoteLifecycleStatus; error?: string }>(
        `${ref.endpoint || endpoint}/v1/executions/${encodeURIComponent(ref.executionId)}`,
        { method: 'GET', signal: ctx.signal, timeoutMs: gate.current.timeoutMs },
      );
      ctx.updateRemoteExecution?.({ lastRemoteStatus: data.status });
      return {
        status: data.status,
        ...(data.error ? { message: data.error } : {}),
        remoteAck: true,
      };
    },
    async cancel(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteCancelResult> {
      localCancelled.add(ctx.jobId);
      try {
        gate.assertEndpointAllowed(ref.endpoint || endpoint);
        // 取消通知必须短超时:本地取消权威已成立,远端 ack 失败不阻塞 Job 终态。
        const cancelTimeoutMs = Math.min(2_000, gate.current.timeoutMs);
        const data = await httpJson<{ cancelled?: boolean; status?: string; error?: string }>(
          `${ref.endpoint || endpoint}/v1/executions/${encodeURIComponent(ref.executionId)}/cancel`,
          { method: 'POST', body: {}, timeoutMs: cancelTimeoutMs },
        );
        ctx.updateRemoteExecution?.({ lastRemoteStatus: 'cancelled' });
        return {
          cancelled: true,
          remoteAck: data.cancelled === true || data.status === 'cancelled',
          ...(data.error ? { message: data.error } : {}),
        };
      } catch (error) {
        // 取消请求失败:本地仍标记取消,禁止后续 collect 写入
        return {
          cancelled: true,
          remoteAck: false,
          message: (error as Error).message || 'cancel request failed',
        };
      }
    },
    async recover(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteRecoverResult> {
      if (localCancelled.has(ctx.jobId)) {
        return { status: 'cancelled', message: 'local cancel recorded' };
      }
      const status = await this.getStatus(ref, ctx);
      if (status.status === 'completed') {
        try {
          const output = await this.collectArtifact(ref, ctx);
          return { status: 'completed', output };
        } catch (error) {
          return {
            status: 'failed',
            message: (error as Error).message || 'collect after recover failed',
          };
        }
      }
      return { status: status.status, ...(status.message ? { message: status.message } : {}) };
    },
    async collectArtifact(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
        throw Object.assign(new Error('late collect rejected after cancel'), {
          stage: 'capability' as const,
          actionable: '任务已取消,不再写入成果',
          code: 'late_collect_rejected',
        });
      }
      const cached = outputs.get(ref.executionId) ?? outputs.get(ctx.jobId);
      if (cached) return cached;

      gate.assertEndpointAllowed(ref.endpoint || endpoint);
      const data = await httpJson<Record<string, unknown>>(
        `${ref.endpoint || endpoint}/v1/executions/${encodeURIComponent(ref.executionId)}/artifact`,
        { method: 'GET', signal: ctx.signal, timeoutMs: gate.current.timeoutMs },
      );

      if (!data.artifact || typeof data.artifact !== 'object') {
        throw Object.assign(new Error('remote returned malformed artifact'), {
          stage: 'capability' as const,
          actionable: '远端返回格式错误',
          code: 'malformed_artifact',
        });
      }
      const art = data.artifact as {
        type?: string;
        title?: string;
        payload?: { kind?: string; format?: string; text?: string };
      };
      if (
        art.type !== 'document' ||
        art.payload?.kind !== 'text' ||
        typeof art.payload.text !== 'string'
      ) {
        throw Object.assign(new Error('remote returned malformed artifact'), {
          stage: 'capability' as const,
          actionable: '远端返回格式错误',
          code: 'malformed_artifact',
        });
      }
      gate.assertOutputSize(Buffer.byteLength(art.payload.text, 'utf8'));

      const output: CapabilityOutput = {
        artifact: {
          type: 'document',
          title: art.title || '远端文档',
          payload: {
            kind: 'text',
            format: art.payload.format === 'plain' ? 'plain' : 'markdown',
            text: art.payload.text,
          },
        },
        candidateMeta: {
          provenance: String(data.provenance || `controlled-remote:${ref.executionId}`),
          sourceBinding: String(data.sourceBinding || ref.executionId),
          contentDigest: String(data.contentDigest || sha256(art.payload.text)),
          producedAt: nowIso(),
        },
      };
      outputs.set(ref.executionId, output);
      outputs.set(ctx.jobId, output);
      return output;
    },
  };

  async function pollUntilTerminal(
    ref: RemoteExecutionRef,
    ctx: ExecutionContext,
  ): Promise<RemoteStatusView> {
    const deadline = Date.now() + gate.current.timeoutMs;
    while (Date.now() < deadline) {
      if (ctx.signal.aborted || localCancelled.has(ctx.jobId)) {
        await thisCancel(ref, ctx);
        return { status: 'cancelled', remoteAck: true };
      }
      const status = await httpJson<{ status: RemoteLifecycleStatus; error?: string }>(
        `${ref.endpoint || endpoint}/v1/executions/${encodeURIComponent(ref.executionId)}`,
        { method: 'GET', signal: ctx.signal, timeoutMs: Math.min(5_000, gate.current.timeoutMs) },
      ).catch((error) => {
        if (ctx.signal.aborted) throw abortError();
        throw error;
      });
      ctx.updateRemoteExecution?.({ lastRemoteStatus: status.status });
      if (
        status.status === 'completed' ||
        status.status === 'failed' ||
        status.status === 'cancelled'
      ) {
        return {
          status: status.status,
          ...(status.error ? { message: status.error } : {}),
          remoteAck: true,
        };
      }
      ctx.reportProgress(status.status === 'pending' ? '远端排队中' : '远端处理中');
      await sleep(pollIntervalMs, ctx.signal);
    }
    throw Object.assign(new Error('remote execution timed out'), {
      stage: 'capability' as const,
      actionable: '远端执行超时,请重试',
      code: 'remote_timeout',
    });
  }

  async function thisCancel(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<void> {
    localCancelled.add(ctx.jobId);
    try {
      await httpJson(
        `${ref.endpoint || endpoint}/v1/executions/${encodeURIComponent(ref.executionId)}/cancel`,
        { method: 'POST', body: {}, timeoutMs: gate.current.timeoutMs },
      );
    } catch {
      /* 取消请求失败仍保持本地取消 */
    }
  }
}

/** 真实输入驱动的非模板合成 — 长度与内容随 goal/材料变化。 */
export function synthesizeFromInput(input: {
  goal: string;
  purpose: string;
  materials: Array<{ path: string; digest?: string; excerpt: string }>;
  executionId: string;
  leakUnauthorized?: string;
}): { title: string; text: string } {
  const materialBlock = input.materials
    .map((m, i) => {
      const excerpt = (m.excerpt || '').slice(0, 400);
      const digest = m.digest ? ` digest=${m.digest.slice(0, 12)}` : '';
      return `${i + 1}. ${m.path}${digest}\n${excerpt}`;
    })
    .join('\n\n');
  const seed = sha256(`${input.goal}|${input.purpose}|${materialBlock}|${input.executionId}`);
  const variation = seed.slice(0, 16);
  const title = `受控远端:${input.goal.trim().slice(0, 48) || '文档'}`;
  const lines = [
    `# ${title}`,
    '',
    `目的：${input.purpose || input.goal}`,
    `输入指纹：${variation}`,
    `材料条数：${input.materials.length}`,
    '',
    '## 目标要点',
    input.goal.trim() || '(空目标)',
    '',
    '## 授权材料摘要',
    materialBlock || '(无授权材料)',
    '',
    '## 综合说明',
    `基于授权材料与目标生成的非模板正文。变体=${variation}。长度随输入增长：goal=${input.goal.length}, materials=${materialBlock.length}。`,
  ];
  if (input.leakUnauthorized) {
    lines.push('', '## 泄漏注入', input.leakUnauthorized);
  }
  // 填充随输入变化的确定性扩展段,避免固定成功句
  const expand = Math.min(40, 8 + (input.goal.length % 17) + input.materials.length * 3);
  lines.push('', '## 扩展观察');
  for (let i = 0; i < expand; i += 1) {
    const h = sha256(`${variation}:${i}`).slice(0, 8);
    lines.push(`- 观察 ${i + 1}: ${h} / goalChar=${input.goal.charCodeAt(i % Math.max(1, input.goal.length)) || 0}`);
  }
  return { title, text: lines.join('\n') };
}

async function buildRemotePayload(input: CapabilityInput, ctx: ExecutionContext) {
  const materials: Array<{ path: string; digest?: string; excerpt: string }> = [];
  for (const item of input.snapshot.items) {
    if (item.status !== 'ok' || !item.extractedTextRef) continue;
    const text = ctx.readExtractedText ? await ctx.readExtractedText(item.extractedTextRef) : '';
    materials.push({
      path: item.sourcePath,
      ...(item.contentDigest ? { digest: item.contentDigest } : {}),
      excerpt: text.slice(0, 800),
    });
  }
  return {
    goal: input.goal,
    purpose: input.authorized?.purpose || input.goal,
    artifactType: input.artifactType,
    materials,
    grantId: input.authorized?.grantId,
    idempotencyKey: ctx.jobId,
  };
}

function isRetryableNetworkError(error: unknown): boolean {
  const msg = (error as Error)?.message || '';
  const code = (error as { code?: string })?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    /timeout|network|ECONN|socket/i.test(msg)
  );
}

async function httpJson<T>(
  url: string,
  opts: {
    method: string;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw Object.assign(new Error('remote returned non-json'), {
        code: 'bad_response',
        status: res.status,
      });
    }
    if (!res.ok) {
      const errMsg =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message?: string }).message)
          : `remote http ${res.status}`;
      throw Object.assign(new Error(errMsg), {
        code: 'remote_http',
        status: res.status,
        data,
      });
    }
    return data as T;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      if (opts.signal?.aborted) throw abortError();
      throw Object.assign(new Error('remote request timed out'), {
        code: 'ETIMEDOUT',
        stage: 'capability' as const,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
  });
  res.end(payload);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
