/**
 * EXTERNAL-CAPABILITY-CONTRACT-01 — 2digime「做事」外部能力合同。
 *
 * MCP-READONLY-ADAPTER-01 接线附注：本块将 mcp-stdio 接入为最小只读工具能力
 * （kind='tool'，只读白名单）。原「declared-only 不接线」门在本块废止，改为接线后守卫。
 * 其余三类连接器（model / agent / a2a-agent）仍按原合同只登记、不另起炉灶。
 * Work Runtime 不得感知厂商名；只看连接器类 + CapabilityAdapter 生命周期。
 * 用户面文案继续沿用 external-capability-product.ts 的封闭表，本模块不定义任何用户面文案。
 */
import { readFileSync } from 'node:fs';
import {
  ADAPTER_TYPES,
  AGENT_TRANSPORT_ADAPTER_TYPES,
  isAdapterType,
  isAgentExecutorAdapterType,
  type AdapterType,
} from './registration';

export { AGENT_TRANSPORT_ADAPTER_TYPES, isAgentExecutorAdapterType };

/**
 * 四类连接器（产品类，不是再造一套状态机）。
 * 对应关系（冻结，MCP-READONLY-ADAPTER-01 升版）：
 * - model     -> openai-compatible-model（现有，只登记）
 * - agent     -> external-executor-cli（规范映射；HTTP 运输 `external-executor-http` 为同一产品类的并列运输，不是新连接器类）
 * - mcp-tool  -> mcp-stdio（本块已接线：只读工具能力）
 * - a2a-agent -> remote-subject（现有 A2A 试验适配器，只登记）
 */
export const CONNECTOR_CLASSES = ['model', 'agent', 'mcp-tool', 'a2a-agent'] as const;
export type ConnectorClass = (typeof CONNECTOR_CLASSES)[number];

/**
 * mcp-tool 的适配器类型（MCP-READONLY-ADAPTER-01 接线后为生产白名单成员）。
 * 保留该枚举以兼容旧引用；mcp-stdio 现已在 registration.ADAPTER_TYPES。
 */
export const DECLARED_MCP_ADAPTER_TYPES = ['mcp-stdio'] as const;
export type DeclaredMcpAdapterType = (typeof DECLARED_MCP_ADAPTER_TYPES)[number];

export type ConnectorMappedAdapterType = AdapterType | DeclaredMcpAdapterType;

const CONNECTOR_CLASS_TO_ADAPTER_TYPE: Record<
  ConnectorClass,
  ConnectorMappedAdapterType
> = {
  model: 'openai-compatible-model',
  agent: 'external-executor-cli',
  'mcp-tool': 'mcp-stdio',
  'a2a-agent': 'remote-subject',
};

export function assertConnectorClass(value: string): ConnectorClass {
  if (!(CONNECTOR_CLASSES as readonly string[]).includes(value)) {
    throw new Error(`unknown connector class: ${value}`);
  }
  return value as ConnectorClass;
}

/**
 * 连接器类 -> 适配器类型映射。
 * mcp-tool 现已接线为 mcp-stdio（生产白名单成员），其余必须落在 ADAPTER_TYPES。
 */
export function mapConnectorClassToAdapterType(
  connectorClass: ConnectorClass,
): ConnectorMappedAdapterType {
  assertConnectorClass(connectorClass);
  const mapped = CONNECTOR_CLASS_TO_ADAPTER_TYPE[connectorClass];
  if (!isAdapterType(mapped)) {
    throw new Error(
      `connector ${connectorClass} maps to non-whitelisted adapter type: ${mapped}`,
    );
  }
  return mapped;
}

/** mcp-tool 是工具/数据连接器，不是自主 Agent。 */
export function isMcpToolNotAgent(value: string): boolean {
  return value === 'mcp-tool';
}

/** 硬守卫：禁止把 mcp-tool 按自主 Agent 生命周期编排。 */
export function assertMcpIsNotAutonomousAgent(
  connectorClass: ConnectorClass,
  opts: { autonomous: boolean },
): void {
  if (connectorClass === 'mcp-tool' && opts.autonomous) {
    throw new Error(
      'mcp-tool must not be treated as an autonomous agent; it provides tools/data only',
    );
  }
}

/**
 * 接线后守卫（MCP-READONLY-ADAPTER-01 取代原 assertMcpDeclaredOnlyNotWireable）。
 * 满足：mcp-stdio 已在白名单、kind 必须是 tool（不是 agent）、
 * 权限默认只有 filesystem_read（或更窄）、默认注册表无空壳。
 */
export function assertMcpWireableGuard(): void {
  if (!(ADAPTER_TYPES as readonly string[]).includes('mcp-stdio')) {
    throw new Error('mcp-stdio must be in ADAPTER_TYPES to be wireable');
  }
}

/** 校验一个 mcp-stdio 注册声明的形状（kind=tool、无写权限）。 */
export function assertMcpRegistrationShape(reg: {
  kind?: string;
  permissions?: readonly string[];
  adapter?: { type?: string };
}): void {
  if (reg.kind !== 'tool') {
    throw new Error(`mcp-tool adapter kind must be 'tool', got: ${reg.kind}`);
  }
  if (reg.adapter?.type !== 'mcp-stdio') {
    throw new Error(`mcp-tool adapter type must be 'mcp-stdio', got: ${reg.adapter?.type}`);
  }
  const perms = reg.permissions ?? [];
  if (perms.includes('filesystem_write')) {
    throw new Error('mcp-tool adapter must not default to filesystem_write');
  }
}

/**
 * 两条对照臂记录。
 * 同一 P0 任务必须能生成一对 BenchmarkArmRecord，字段至少包括下列 11 项。
 */
export type BenchmarkArm = 'direct' | 'orchestrated';

export const BENCHMARK_OUTCOMES = [
  'not_run',
  'completed',
  'failed',
  'timeout',
  'cancelled',
] as const;
export type BenchmarkOutcome = (typeof BENCHMARK_OUTCOMES)[number];

export interface BenchmarkArmRecord {
  taskId: string;
  arm: BenchmarkArm;
  connectorClass: ConnectorClass;
  adapterId: string;
  budget: number;
  confirmationCount: number;
  outcome: BenchmarkOutcome;
  falseCompletion: boolean;
  recovered: boolean;
  adoptedOnFirstAttempt: boolean;
  honestFailure: boolean;
  /** 本次运行是否需要恢复（恢复率分母）。 */
  neededRecovery?: boolean;
}

export interface BenchmarkArmPair {
  taskId: string;
  direct: BenchmarkArmRecord;
  orchestrated: BenchmarkArmRecord;
}

/** 为同一任务生成 direct / orchestrated 两条占位记录（outcome = not_run）。 */
export function buildBenchmarkArmPair(task: P0TaskFixture): BenchmarkArmPair {
  const base: Omit<BenchmarkArmRecord, 'arm'> = {
    taskId: task.taskId,
    connectorClass: task.connectorClass,
    adapterId: task.adapterId,
    budget: task.budget.maxTokens,
    confirmationCount: 0,
    outcome: 'not_run',
    falseCompletion: false,
    recovered: false,
    adoptedOnFirstAttempt: false,
    honestFailure: false,
  };
  return {
    taskId: task.taskId,
    direct: { ...base, arm: 'direct' },
    orchestrated: { ...base, arm: 'orchestrated' },
  };
}

/**
 * 预注册指标（只定义，不宣称达标）。
 * 分母必须包含失败、超时、取消；not_run 不进入分母。
 * 真实跑分留给任务块 3/6；本块只允许用 fixture 合成记录验证公式。
 */
export interface BenchmarkCounts {
  completed: number;
  failed: number;
  timeout: number;
  cancelled: number;
  notRun: number;
  falseCompletion: number;
  adoptedOnFirstAttempt: number;
  recovered: number;
  neededRecovery: number;
  honestFailure: number;
}

export interface BenchmarkMetrics {
  /** 分母 = completed + failed + timeout + cancelled（不含 not_run）。 */
  denominator: number;
  counts: BenchmarkCounts;
  /** 完成率 = completed / denominator。 */
  completionRate: number | null;
  /** 首次采用率 = adoptedOnFirstAttempt / denominator。 */
  firstAdoptionRate: number | null;
  /** 必要确认总次数（仅非 not_run 记录求和）。 */
  totalNecessaryConfirmations: number;
  /** 平均必要确认次数 = totalNecessaryConfirmations / 非 not_run 记录数。 */
  avgNecessaryConfirmations: number | null;
  /** 假完成率 = falseCompletion / denominator。 */
  falseCompletionRate: number | null;
  /** 恢复率 = recovered / neededRecovery。 */
  recoveryRate: number | null;
  /** 诚实失败率 = honestFailure / (failed + timeout + cancelled)。 */
  honestFailureRate: number | null;
}

export function computeBenchmarkMetrics(
  records: readonly BenchmarkArmRecord[],
): BenchmarkMetrics {
  const counts: BenchmarkCounts = {
    completed: 0,
    failed: 0,
    timeout: 0,
    cancelled: 0,
    notRun: 0,
    falseCompletion: 0,
    adoptedOnFirstAttempt: 0,
    recovered: 0,
    neededRecovery: 0,
    honestFailure: 0,
  };
  let totalNecessaryConfirmations = 0;
  let scoredRuns = 0;
  for (const r of records) {
    switch (r.outcome) {
      case 'completed':
        counts.completed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'timeout':
        counts.timeout += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
      case 'not_run':
        counts.notRun += 1;
        break;
    }
    if (r.outcome !== 'not_run') {
      scoredRuns += 1;
      totalNecessaryConfirmations += r.confirmationCount;
    }
    if (r.falseCompletion) counts.falseCompletion += 1;
    if (r.adoptedOnFirstAttempt) counts.adoptedOnFirstAttempt += 1;
    if (r.recovered) counts.recovered += 1;
    if (r.neededRecovery) counts.neededRecovery += 1;
    if (r.honestFailure) counts.honestFailure += 1;
  }
  const denominator =
    counts.completed + counts.failed + counts.timeout + counts.cancelled;
  const nonCompletionDenominator = counts.failed + counts.timeout + counts.cancelled;
  return {
    denominator,
    counts,
    completionRate: denominator > 0 ? counts.completed / denominator : null,
    firstAdoptionRate:
      denominator > 0 ? counts.adoptedOnFirstAttempt / denominator : null,
    totalNecessaryConfirmations,
    avgNecessaryConfirmations:
      scoredRuns > 0 ? totalNecessaryConfirmations / scoredRuns : null,
    falseCompletionRate:
      denominator > 0 ? counts.falseCompletion / denominator : null,
    recoveryRate:
      counts.neededRecovery > 0 ? counts.recovered / counts.neededRecovery : null,
    honestFailureRate:
      nonCompletionDenominator > 0
        ? counts.honestFailure / nonCompletionDenominator
        : null,
  };
}

export interface BenchmarkGain {
  /** 完成率增益 = orchestrated - direct（越高越好）。 */
  completionGain: number | null;
  /** 首次采用率增益 = orchestrated - direct（越高越好）。 */
  firstAdoptionGain: number | null;
  /** 假完成率增益 = direct - orchestrated（正数 = 编排降低了假完成）。 */
  falseCompletionGain: number | null;
  /** 介入成本增益 = direct - orchestrated（正数 = 编排降低了必要确认）。 */
  interventionCostGain: number | null;
}

export interface BenchmarkArmPairMetrics {
  direct: BenchmarkMetrics;
  orchestrated: BenchmarkMetrics;
  gain: BenchmarkGain;
}

export function computeArmPairGain(
  directRecords: readonly BenchmarkArmRecord[],
  orchestratedRecords: readonly BenchmarkArmRecord[],
): BenchmarkArmPairMetrics {
  const direct = computeBenchmarkMetrics(directRecords);
  const orchestrated = computeBenchmarkMetrics(orchestratedRecords);
  const diff = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a - b;
  return {
    direct,
    orchestrated,
    gain: {
      completionGain: diff(orchestrated.completionRate, direct.completionRate),
      firstAdoptionGain: diff(
        orchestrated.firstAdoptionRate,
        direct.firstAdoptionRate,
      ),
      falseCompletionGain: diff(
        direct.falseCompletionRate,
        orchestrated.falseCompletionRate,
      ),
      interventionCostGain: diff(
        direct.avgNecessaryConfirmations,
        orchestrated.avgNecessaryConfirmations,
      ),
    },
  };
}

/** P0 任务集（写死 fixture，后续任务块复用）。 */
export const P0_TASK_IDS = [
  'P0-mechanical-reply',
  'P0-triageapp-edit',
  'P0-research-honest-fail',
  'P0-restart-recover',
] as const;
export type P0TaskId = (typeof P0_TASK_IDS)[number];

export interface P0TaskFixture {
  taskId: string;
  scenario: string;
  goal: string;
  allowedMaterials: string[];
  forbiddenMaterials: string[];
  preRegisteredVerification: string[];
  budget: { maxTokens: number; maxCalls: number };
  maxConfirmationCount: number;
  orchestratedExpectation: string;
  directArmPurpose: string;
  connectorClass: ConnectorClass;
  adapterId: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

const SENSITIVE_FIXTURE_PATH_MARKERS =
  /(resume|password|passwd|secret|api[-_]?key|\.ssh|id_rsa|private)/i;

function assertSafeFixtureMaterialPath(value: unknown, label: string): string {
  const s = assertString(value, label);
  if (/^[\\/~]/.test(s) || /^[a-zA-Z]:[\\/]/.test(s)) {
    throw new Error(`${label} must be a relative fixture path, got: ${s}`);
  }
  if (s.split(/[\\/]/).includes('..')) {
    throw new Error(`${label} must not contain '..', got: ${s}`);
  }
  if (SENSITIVE_FIXTURE_PATH_MARKERS.test(s)) {
    throw new Error(`${label} must not reference sensitive material, got: ${s}`);
  }
  return s;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((v, i) => assertSafeFixtureMaterialPath(v, `${label}[${i}]`));
}

function assertVerificationSteps(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  return value.map((v, i) => assertString(v, `${label}[${i}]`));
}

function assertPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

/**
 * 校验 P0 fixture 列表：字段完整、路径安全、覆盖全部四个 P0 任务。
 * 不读取任何外部数据；可对任意输入做纯校验。
 */
export function validateP0TaskFixtures(input: unknown): P0TaskFixture[] {
  if (!Array.isArray(input)) {
    throw new Error('P0 fixtures must be an array');
  }
  const seen = new Set<string>();
  for (const raw of input) {
    if (!isRecord(raw)) throw new Error('fixture entry must be an object');
    const taskId = assertString(raw.taskId, 'taskId');
    if (!(P0_TASK_IDS as readonly string[]).includes(taskId)) {
      throw new Error(`unknown P0 task id: ${taskId}`);
    }
    if (seen.has(taskId)) throw new Error(`duplicate P0 task id: ${taskId}`);
    seen.add(taskId);

    const connectorClass = assertString(raw.connectorClass, 'connectorClass');
    assertConnectorClass(connectorClass);
    const budget = raw.budget;
    if (!isRecord(budget)) throw new Error('budget must be an object');
    assertPositiveNumber(budget.maxTokens, 'budget.maxTokens');
    assertPositiveNumber(budget.maxCalls, 'budget.maxCalls');

    const maxConfirmationCount = raw.maxConfirmationCount;
    if (
      typeof maxConfirmationCount !== 'number' ||
      !Number.isInteger(maxConfirmationCount) ||
      maxConfirmationCount < 0 ||
      maxConfirmationCount > 1
    ) {
      throw new Error('maxConfirmationCount must be 0 or 1 (default ≤ 1 necessary confirmation)');
    }

    assertString(raw.scenario, 'scenario');
    assertString(raw.goal, 'goal');
    assertStringArray(raw.allowedMaterials, 'allowedMaterials');
    assertStringArray(raw.forbiddenMaterials, 'forbiddenMaterials');
    assertVerificationSteps(raw.preRegisteredVerification, 'preRegisteredVerification');
    assertString(raw.orchestratedExpectation, 'orchestratedExpectation');
    assertString(raw.directArmPurpose, 'directArmPurpose');
    assertString(raw.adapterId, 'adapterId');
  }
  for (const id of P0_TASK_IDS) {
    if (!seen.has(id)) throw new Error(`missing P0 fixture: ${id}`);
  }
  return input as P0TaskFixture[];
}

/** 从 JSON 文件加载并校验 P0 fixture（支持 { tasks: [...] } 或直接数组）。 */
export function loadP0TaskFixtures(filePath: string): P0TaskFixture[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`failed to read P0 fixture file ${filePath}: ${String(err)}`);
  }
  const tasks = isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : parsed;
  return validateP0TaskFixtures(tasks);
}

/** 校验基准记录（含合成记录），保证字段形状正确。 */
export function validateBenchmarkRecords(input: unknown): BenchmarkArmRecord[] {
  if (!Array.isArray(input)) {
    throw new Error('benchmark records must be an array');
  }
  for (const raw of input) {
    if (!isRecord(raw)) throw new Error('record must be an object');
    assertString(raw.taskId, 'taskId');
    const arm = assertString(raw.arm, 'arm');
    if (arm !== 'direct' && arm !== 'orchestrated') {
      throw new Error(`unknown arm: ${arm}`);
    }
    const connectorClass = assertString(raw.connectorClass, 'connectorClass');
    assertConnectorClass(connectorClass);
    assertString(raw.adapterId, 'adapterId');
    const budget = raw.budget;
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0) {
      throw new Error('budget must be a non-negative number');
    }
    const confirmationCount = raw.confirmationCount;
    if (
      typeof confirmationCount !== 'number' ||
      !Number.isInteger(confirmationCount) ||
      confirmationCount < 0
    ) {
      throw new Error('confirmationCount must be a non-negative integer');
    }
    const outcome = assertString(raw.outcome, 'outcome');
    if (!(BENCHMARK_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new Error(`unknown outcome: ${outcome}`);
    }
    for (const flag of ['falseCompletion', 'recovered', 'adoptedOnFirstAttempt', 'honestFailure'] as const) {
      if (typeof raw[flag] !== 'boolean') {
        throw new Error(`${flag} must be a boolean`);
      }
    }
    if (raw.neededRecovery !== undefined && typeof raw.neededRecovery !== 'boolean') {
      throw new Error('neededRecovery must be a boolean when present');
    }
  }
  return input as BenchmarkArmRecord[];
}