/**
 * SLICE-2C-CODING-EVIDENCE-01
 *
 * 真实双臂基准的机械证据合同。它不启动 Agent、不评分语义质量，也不写产品状态；
 * 只判断一次运行是否具备可进入后续评分的真实、同源、零费用证据。
 */
import { CODING_PROJECT_CLASSES, type CodingBenchmarkArm, type CodingProjectClass } from './coding-agent-benchmark-gate';

export const CODING_COST_BASES = [
  'local_no_model',
  'existing_entitlement_no_incremental_charge',
  'external_metered',
  'unknown',
] as const;
export type CodingCostBasis = (typeof CODING_COST_BASES)[number];

export type CodingRunAdmissionVerdict =
  | 'ready_zero_new_cost'
  | 'blocked_agent_unavailable'
  | 'blocked_cost_unknown'
  | 'blocked_external_cost';

export function decideCodingRunAdmission(input: {
  agentAvailable: boolean;
  costBasis: CodingCostBasis;
  ownerAllowsExternalSpend: boolean;
}): CodingRunAdmissionVerdict {
  if (!input.agentAvailable) return 'blocked_agent_unavailable';
  if (input.costBasis === 'unknown') return 'blocked_cost_unknown';
  // 本 Slice 的 Owner 边界是零新增外部费用；即使调用方误传授权，也不得在这里放行计费运行。
  if (input.costBasis === 'external_metered') return 'blocked_external_cost';
  return 'ready_zero_new_cost';
}

export interface CodingProcessEvidence {
  commandDigest: string;
  outputDigest: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
}

export interface CodingTalkReceiptEvidence {
  threadId: string;
  executionId: string;
  artifactRefs: string[];
  userVisibleSummary: string;
}

export interface CodingRunEvidence {
  schemaVersion: 'slice-2c-coding-run-evidence/1';
  source: 'real_process';
  taskId: string;
  projectClass: CodingProjectClass;
  arm: CodingBenchmarkArm;
  workspaceId: string;
  fixtureDigest: string;
  projectRevision: string;
  agent: {
    executorId: string;
    version: string;
    executableDigest: string;
  };
  baselineTest: CodingProcessEvidence & { matchedRegisteredFailure: true };
  finalTest: CodingProcessEvidence;
  changedFiles: string[];
  outsideScopeWrites: string[];
  preExistingDirtyProof?: {
    path: string;
    beforeDigest: string;
    afterDigest: string;
    beforeDiffDigest: string;
    afterDiffDigest: string;
  };
  cost: {
    basis: CodingCostBasis;
    externalChargeIncurred: boolean;
    amountCny: number;
  };
  talkReceipt?: CodingTalkReceiptEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => stringValue(item, `${label}[${index}]`));
}

function assertDigest(value: unknown, label: string): string {
  const digest = stringValue(value, label);
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}

function assertIso(value: unknown, label: string): string {
  const text = stringValue(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO timestamp`);
  return text;
}

function validateProcess(value: unknown, label: string): asserts value is CodingProcessEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertDigest(value.commandDigest, `${label}.commandDigest`);
  assertDigest(value.outputDigest, `${label}.outputDigest`);
  if (typeof value.exitCode !== 'number' || !Number.isInteger(value.exitCode)) {
    throw new Error(`${label}.exitCode must be an integer`);
  }
  const started = assertIso(value.startedAt, `${label}.startedAt`);
  const finished = assertIso(value.finishedAt, `${label}.finishedAt`);
  if (Date.parse(finished) < Date.parse(started)) throw new Error(`${label} finished before it started`);
}

export function validateCodingRunEvidence(input: unknown): CodingRunEvidence {
  if (!isRecord(input)) throw new Error('coding run evidence must be an object');
  if (input.schemaVersion !== 'slice-2c-coding-run-evidence/1') throw new Error('unsupported evidence schema');
  if (input.source !== 'real_process') throw new Error('only real_process evidence is accepted');
  stringValue(input.taskId, 'taskId');
  const projectClass = stringValue(input.projectClass, 'projectClass');
  if (!(CODING_PROJECT_CLASSES as readonly string[]).includes(projectClass)) {
    throw new Error(`unknown projectClass: ${projectClass}`);
  }
  if (input.arm !== 'leading_agent_direct' && input.arm !== '2digime_orchestrated') {
    throw new Error('unknown benchmark arm');
  }
  stringValue(input.workspaceId, 'workspaceId');
  assertDigest(input.fixtureDigest, 'fixtureDigest');
  stringValue(input.projectRevision, 'projectRevision');
  if (!isRecord(input.agent)) throw new Error('agent must be an object');
  stringValue(input.agent.executorId, 'agent.executorId');
  stringValue(input.agent.version, 'agent.version');
  assertDigest(input.agent.executableDigest, 'agent.executableDigest');
  validateProcess(input.baselineTest, 'baselineTest');
  if (!isRecord(input.baselineTest) || input.baselineTest.matchedRegisteredFailure !== true) {
    throw new Error('baselineTest must match the registered failure');
  }
  if (input.baselineTest.exitCode === 0) throw new Error('baselineTest must fail before the task');
  validateProcess(input.finalTest, 'finalTest');
  if (input.finalTest.exitCode !== 0) throw new Error('finalTest must pass after the task');
  const changedFiles = stringArray(input.changedFiles, 'changedFiles');
  if (!changedFiles.length) throw new Error('changedFiles must not be empty');
  const outsideScopeWrites = stringArray(input.outsideScopeWrites, 'outsideScopeWrites');
  if (outsideScopeWrites.length) throw new Error('outside-scope writes make the run ineligible');

  if (!isRecord(input.cost)) throw new Error('cost must be an object');
  if (!(CODING_COST_BASES as readonly unknown[]).includes(input.cost.basis)) throw new Error('unknown cost basis');
  if (input.cost.externalChargeIncurred !== false || input.cost.amountCny !== 0) {
    throw new Error('current benchmark admits only zero-new-cost evidence');
  }
  if (input.cost.basis === 'external_metered' || input.cost.basis === 'unknown') {
    throw new Error('metered or unknown cost evidence is not eligible');
  }

  if (projectClass === 'dirty_worktree') {
    if (!isRecord(input.preExistingDirtyProof)) throw new Error('dirty_worktree requires preExistingDirtyProof');
    stringValue(input.preExistingDirtyProof.path, 'preExistingDirtyProof.path');
    const before = assertDigest(input.preExistingDirtyProof.beforeDigest, 'preExistingDirtyProof.beforeDigest');
    const after = assertDigest(input.preExistingDirtyProof.afterDigest, 'preExistingDirtyProof.afterDigest');
    const beforeDiff = assertDigest(input.preExistingDirtyProof.beforeDiffDigest, 'preExistingDirtyProof.beforeDiffDigest');
    const afterDiff = assertDigest(input.preExistingDirtyProof.afterDiffDigest, 'preExistingDirtyProof.afterDiffDigest');
    if (before !== after || beforeDiff !== afterDiff) throw new Error('pre-existing dirty change was not preserved');
  }

  if (input.arm === '2digime_orchestrated') {
    if (!isRecord(input.talkReceipt)) throw new Error('orchestrated arm requires a Talk receipt');
    stringValue(input.talkReceipt.threadId, 'talkReceipt.threadId');
    stringValue(input.talkReceipt.executionId, 'talkReceipt.executionId');
    if (!stringArray(input.talkReceipt.artifactRefs, 'talkReceipt.artifactRefs').length) {
      throw new Error('Talk receipt must contain an artifact reference');
    }
    stringValue(input.talkReceipt.userVisibleSummary, 'talkReceipt.userVisibleSummary');
  } else if (input.talkReceipt !== undefined) {
    throw new Error('direct arm must not impersonate a 2digime Talk receipt');
  }
  return input as unknown as CodingRunEvidence;
}

export interface CodingRunEvidencePair {
  taskId: string;
  direct: CodingRunEvidence;
  orchestrated: CodingRunEvidence;
}

export function validateCodingRunEvidencePair(input: {
  direct: unknown;
  orchestrated: unknown;
}): CodingRunEvidencePair {
  const direct = validateCodingRunEvidence(input.direct);
  const orchestrated = validateCodingRunEvidence(input.orchestrated);
  if (direct.arm !== 'leading_agent_direct') throw new Error('direct evidence has the wrong arm');
  if (orchestrated.arm !== '2digime_orchestrated') throw new Error('orchestrated evidence has the wrong arm');
  if (direct.taskId !== orchestrated.taskId) throw new Error('paired runs must use the same task');
  if (direct.projectClass !== orchestrated.projectClass) throw new Error('paired runs must use the same project class');
  if (direct.fixtureDigest !== orchestrated.fixtureDigest) throw new Error('paired runs must use the same frozen fixture');
  if (direct.projectRevision !== orchestrated.projectRevision) throw new Error('paired runs must use the same project revision');
  if (direct.workspaceId === orchestrated.workspaceId) throw new Error('paired runs must use independent workspaces');
  const directAgent = `${direct.agent.executorId}:${direct.agent.version}:${direct.agent.executableDigest}`;
  const orchestratedAgent = `${orchestrated.agent.executorId}:${orchestrated.agent.version}:${orchestrated.agent.executableDigest}`;
  if (directAgent !== orchestratedAgent) throw new Error('paired runs must use the same leading Agent build');
  return { taskId: direct.taskId, direct, orchestrated };
}
