/**
 * MULTI-AGENT-ROUTE-01 / TRIAL-SURFACE-01B — 代码修改任务的能力路由纯函数。
 *
 * 规则（冻结，不把厂商名写进 Work Runtime；不得按厂商名排序）：
 * - explicit        ：用户显式指定且该能力可用
 * - primary         ：可用的专用执行器（cli/http）中按能力完整度评分最高者
 * - model_api       ：无 ready 专用执行器，但已连接模型兜底运输可用
 * - none            ：都不可用 → 诚实失败，禁止冒充改码
 *
 * 备用是 agent（CLI / HTTP / model-api 运输），不是 mcp-tool，不是写作模型。
 */
import type { CapabilityAdapter } from './adapter';
import {
  EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
  EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
} from '../execution/external-executor-contract';
import {
  UNSUPPORTED_DESKTOP_CODING_CAPABILITY_ID,
} from './adapters/unsupported-desktop-coding';
import { isAgentExecutorAdapterType } from './registration';
import { scoreCodingAdapter } from './coding-adapter-score';

export const EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID = 'cap_external_executor_secondary';
export const EXTERNAL_EXECUTOR_SECONDARY_ADAPTER_ID = 'external-executor-secondary-cli';
export const EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID = 'external-executor-secondary-http';

export type CodingAgentRouteReason =
  | 'explicit'
  | 'primary'
  | 'model_api'
  | 'none';

export interface CodingAgentRouteResult {
  adapter?: CapabilityAdapter;
  reason: CodingAgentRouteReason;
  /** 实际选中的 capabilityId（审计）。 */
  capabilityId?: string;
  /** 用户可行动说明（中性，无厂商名/协议名）。 */
  actionable?: string;
}

/** 专用执行器：CLI / HTTP 运输（非模型兜底）。 */
export function isDedicatedCodingExecutor(adapter: CapabilityAdapter | undefined): boolean {
  if (!adapter) return false;
  const t = adapter.registration.adapter.type;
  return t === 'external-executor-cli' || t === 'external-executor-http';
}

export function isUsableCodingExecutor(adapter: CapabilityAdapter | undefined): boolean {
  if (!adapter) return false;
  const reg = adapter.registration;
  if (reg.availability !== 'available') return false;
  // 仅「检测到但不能自动调用」的 unsupported 桌面工具不得当作可用执行器
  if (
    reg.codingExecution &&
    reg.codingExecution.supportsAutomaticExecution === false
  ) {
    return false;
  }
  if (!isAgentExecutorAdapterType(reg.adapter.type)) return false;
  return true;
}

/**
 * 代码修改路由。adapters 列表中的能力由其自身 isUsableCodingExecutor 判定。
 * explicitCapabilityId：用户显式指定，须可用才用（explicit）；不可用则诚实失败。
 * 专用执行器（cli/http）ready 时按评分取最高，不按厂商名；无专用才选模型兜底。
 */
export function routeCodingAgent(input: {
  adapters: CapabilityAdapter[];
  explicitCapabilityId?: string;
}): CodingAgentRouteResult {
  const explicit = String(input.explicitCapabilityId || '').trim();
  const byId = new Map(input.adapters.map((a) => [a.registration.id, a]));

  if (explicit) {
    const target = byId.get(explicit);
    if (target && isUsableCodingExecutor(target)) {
      return {
        adapter: target,
        reason: 'explicit',
        capabilityId: target.registration.id,
      };
    }
    return {
      reason: 'none',
      capabilityId: explicit,
      actionable:
        '当前无法修改项目文件：指定的代码执行能力不可用。不会改用普通写作冒充代码修改。',
    };
  }

  // 专用执行器（cli/http）ready 时，按能力完整度评分选最高，不按厂商名排序。
  const dedicated = input.adapters
    .filter((a) => isDedicatedCodingExecutor(a) && isUsableCodingExecutor(a))
    .sort((a, b) => scoreCodingAdapter(b) - scoreCodingAdapter(a));
  const best = dedicated[0];
  if (best) {
    return {
      adapter: best,
      reason: 'primary',
      capabilityId: best.registration.id,
    };
  }

  // 无 ready 专用执行器：用已连接模型兜底运输（§2.4 模型低于专用）。
  const modelApi = byId.get(EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
  if (modelApi && isUsableCodingExecutor(modelApi)) {
    return {
      adapter: modelApi,
      reason: 'model_api',
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
    };
  }

  return {
    reason: 'none',
    actionable:
      '当前无法修改项目文件：没有可用的代码执行工具，也未连接模型。请先在设置中连接模型后再试。不会改用普通写作冒充代码修改。',
  };
}

/**
 * 是否为 Coding Job（专用或模型兜底代码执行 Agent）。
 * unsupported 桌面工具 / mcp-tool / 写作模型均不算 Coding Job 执行器。
 */
export function isCodingAgentAdapter(adapter: CapabilityAdapter | undefined): boolean {
  if (!adapter) return false;
  const reg = adapter.registration;
  const isAgent = reg.kind === 'agent';
  const isExecutor = isAgentExecutorAdapterType(reg.adapter.type);
  const isUnsupported = reg.id === UNSUPPORTED_DESKTOP_CODING_CAPABILITY_ID;
  if (isUnsupported) return false;
  return isAgent && isExecutor;
}
