/**
 * Personal Context Contract — 从唯一 Digital Self 编译的一次任务最小投影。
 *
 * 模型决定本次需要哪些 understanding；代码只做存在性、授权、接收方、
 * 有效期、撤销引用与实际内容 digest 的机械约束。这里不做相关性分类。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AuthorizationGrant } from '../collaboration/schema';
import { GrantStore } from '../collaboration/grant-store';
import { readDigitalSelf } from '../subject-core/digital-self/store';
import type { DigitalSelf, Understanding } from '../subject-core/digital-self/types';
import { liveUnderstandings } from '../subject-core/digital-self/view';

export const PERSONAL_CONTEXT_CONTRACT_SCHEMA_VERSION = 1 as const;
export const PERSONAL_CONTEXT_CONTRACT_KIND = 'digitalme.personal_context_contract.v1' as const;
export const PERSONAL_CONTEXT_DEFAULT_TTL_MS = 15 * 60 * 1000;
export const PERSONAL_CONTEXT_MAX_TTL_MS = 30 * 60 * 1000;

export interface PersonalContextField {
  ref: string;
  value: string;
  sourceSummary: 'current_task' | 'owner_statement' | 'owner_material' | 'model_inference';
  assurance: 'task_supplied' | 'confirmed' | 'pending';
}

export interface PersonalContextContract {
  schemaVersion: typeof PERSONAL_CONTEXT_CONTRACT_SCHEMA_VERSION;
  kind: typeof PERSONAL_CONTEXT_CONTRACT_KIND;
  id: string;
  taskRef: string;
  issuerSubjectId: string;
  recipient: {
    subjectId: string;
    endpointRef: string;
  };
  purpose: string;
  fields: PersonalContextField[];
  issuedAt: string;
  expiresAt: string;
  grantId: string;
  revocableRef: string;
  contentDigest: string;
}

export class PersonalContextContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonalContextContractError';
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sourceSummary(item: Understanding): PersonalContextField['sourceSummary'] {
  if (item.provenance.origin === 'user_statement') return 'owner_statement';
  if (item.provenance.origin === 'material') return 'owner_material';
  return 'model_inference';
}

function assurance(item: Understanding): PersonalContextField['assurance'] {
  return item.status === 'current' && item.confirmed ? 'confirmed' : 'pending';
}

function canonicalContractContent(
  contract: Omit<PersonalContextContract, 'contentDigest'>,
): string {
  return JSON.stringify({
    schemaVersion: contract.schemaVersion,
    kind: contract.kind,
    id: contract.id,
    taskRef: contract.taskRef,
    issuerSubjectId: contract.issuerSubjectId,
    recipient: {
      subjectId: contract.recipient.subjectId,
      endpointRef: contract.recipient.endpointRef,
    },
    purpose: contract.purpose,
    fields: contract.fields.map((field) => ({
      ref: field.ref,
      value: field.value,
      sourceSummary: field.sourceSummary,
      assurance: field.assurance,
    })),
    issuedAt: contract.issuedAt,
    expiresAt: contract.expiresAt,
    grantId: contract.grantId,
    revocableRef: contract.revocableRef,
  });
}

export function personalContextContentDigest(
  contract: Omit<PersonalContextContract, 'contentDigest'>,
): string {
  return sha256(canonicalContractContent(contract));
}

export function renderPersonalContext(contract: PersonalContextContract): string {
  return contract.fields
    .map((field) => {
      const source =
        field.sourceSummary === 'current_task'
          ? '本次任务'
          : field.sourceSummary === 'owner_statement'
            ? 'Owner 陈述'
            : field.sourceSummary === 'owner_material'
              ? 'Owner 提供的资料'
              : '模型推断';
      const assuranceLabel =
        field.assurance === 'confirmed'
          ? '已确认'
          : field.assurance === 'pending'
            ? '尚待确认'
            : '本次提供';
      return `[${source}；${assuranceLabel}] ${field.value}`;
    })
    .join('\n');
}

/** 只给当前模型稳定引用，不把 provenance 摘录、材料名或路径交给外部。 */
export function formatPersonalContextCandidates(self: DigitalSelf): string {
  const rows = liveUnderstandings(self).map((item) => ({
    ref: `digital-self:understanding:${item.id}`,
    text: item.text,
    sourceSummary: sourceSummary(item),
    assurance: assurance(item),
  }));
  if (!rows.length) return '没有可选的 Digital Self 字段。';
  return JSON.stringify(rows);
}

export async function issuePersonalContextContract(input: {
  packageRoot: string;
  issuerSubjectId: string;
  recipientSubjectId: string;
  recipientEndpointRef: string;
  taskRef: string;
  purpose: string;
  taskContext: string;
  understandingIds: string[];
  issuedAt: string;
  ttlMs?: number;
}): Promise<{ contract: PersonalContextContract; grant: AuthorizationGrant; disclosure: string }> {
  const purpose = String(input.purpose || '').trim();
  const taskContext = String(input.taskContext || '').trim();
  const recipientSubjectId = String(input.recipientSubjectId || '').trim();
  const recipientEndpointRef = String(input.recipientEndpointRef || '').trim();
  const taskRef = String(input.taskRef || '').trim();
  const issuedAtMs = Date.parse(input.issuedAt);
  if (!purpose) throw new PersonalContextContractError('缺少本次披露目的');
  if (!recipientSubjectId || !recipientEndpointRef) {
    throw new PersonalContextContractError('缺少明确接收方或接收端点');
  }
  if (!taskRef || !Number.isFinite(issuedAtMs)) {
    throw new PersonalContextContractError('缺少有效任务引用或签发时间');
  }

  const ids = [...new Set(input.understandingIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const self = await readDigitalSelf(input.packageRoot, input.issuerSubjectId, input.issuedAt);
  const live = liveUnderstandings(self);
  const byId = new Map(live.map((item) => [item.id, item]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new PersonalContextContractError(`Digital Self 中不存在可披露字段：${missing.join(', ')}`);
  }
  if (live.length > 1 && ids.length === live.length) {
    throw new PersonalContextContractError('不得把完整 Digital Self 编译为一次外部披露');
  }

  const fields: PersonalContextField[] = [];
  if (taskContext) {
    fields.push({
      ref: `collaboration:task-context:${taskRef}`,
      value: taskContext,
      sourceSummary: 'current_task',
      assurance: 'task_supplied',
    });
  }
  for (const id of ids) {
    const item = byId.get(id)!;
    fields.push({
      ref: `digital-self:understanding:${item.id}`,
      value: item.text,
      sourceSummary: sourceSummary(item),
      assurance: assurance(item),
    });
  }
  if (!fields.length) throw new PersonalContextContractError('没有可发送的合作上下文');

  const requestedTtl = Number.isFinite(input.ttlMs)
    ? input.ttlMs!
    : PERSONAL_CONTEXT_DEFAULT_TTL_MS;
  const ttlMs = Math.max(1_000, Math.min(requestedTtl, PERSONAL_CONTEXT_MAX_TTL_MS));
  const expiresAt = new Date(issuedAtMs + ttlMs).toISOString();
  const contractId = `pcc_${randomUUID()}`;
  const grantId = `grant_ctx_${randomUUID()}`;
  const grant: AuthorizationGrant = {
    id: grantId,
    grantorSubjectId: input.issuerSubjectId,
    grantee: { kind: 'remote_subject', subjectId: recipientSubjectId },
    scope: {
      actions: ['read_authorized_context'],
      resourceRefs: fields.map((field) => field.ref),
    },
    origin: {
      kind: 'personal_context_contract',
      contractId,
      exchangeId: taskRef,
      purposeDigest: sha256(purpose),
    },
    status: 'granted',
    grantedAt: input.issuedAt,
    expiresAt,
  };
  await (await GrantStore.open(input.packageRoot)).put(grant);

  const unsigned: Omit<PersonalContextContract, 'contentDigest'> = {
    schemaVersion: PERSONAL_CONTEXT_CONTRACT_SCHEMA_VERSION,
    kind: PERSONAL_CONTEXT_CONTRACT_KIND,
    id: contractId,
    taskRef,
    issuerSubjectId: input.issuerSubjectId,
    recipient: {
      subjectId: recipientSubjectId,
      endpointRef: recipientEndpointRef,
    },
    purpose,
    fields,
    issuedAt: input.issuedAt,
    expiresAt,
    grantId,
    revocableRef: `authorization-grant:${grantId}`,
  };
  const contract: PersonalContextContract = {
    ...unsigned,
    contentDigest: personalContextContentDigest(unsigned),
  };
  return { contract, grant, disclosure: renderPersonalContext(contract) };
}

export async function revokePersonalContextGrant(input: {
  packageRoot: string;
  grant: AuthorizationGrant;
  revokedAt: string;
}): Promise<AuthorizationGrant> {
  const revoked: AuthorizationGrant = {
    ...input.grant,
    status: 'revoked',
    revokedAt: input.revokedAt,
  };
  await (await GrantStore.open(input.packageRoot)).put(revoked);
  return revoked;
}

export function isPersonalContextContract(value: unknown): value is PersonalContextContract {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PersonalContextContract>;
  return (
    row.schemaVersion === PERSONAL_CONTEXT_CONTRACT_SCHEMA_VERSION &&
    row.kind === PERSONAL_CONTEXT_CONTRACT_KIND &&
    typeof row.id === 'string' && !!row.id.trim() &&
    typeof row.taskRef === 'string' && !!row.taskRef.trim() &&
    typeof row.issuerSubjectId === 'string' && !!row.issuerSubjectId.trim() &&
    !!row.recipient &&
    typeof row.recipient.subjectId === 'string' && !!row.recipient.subjectId.trim() &&
    typeof row.recipient.endpointRef === 'string' && !!row.recipient.endpointRef.trim() &&
    typeof row.purpose === 'string' && !!row.purpose.trim() &&
    Array.isArray(row.fields) &&
    row.fields.length > 0 &&
    row.fields.length <= 25 &&
    row.fields.every((field) => {
      if (!field || typeof field !== 'object') return false;
      const value = field as Partial<PersonalContextField>;
      return (
        typeof value.ref === 'string' && !!value.ref.trim() &&
        typeof value.value === 'string' && !!value.value.trim() &&
        (value.sourceSummary === 'current_task' ||
          value.sourceSummary === 'owner_statement' ||
          value.sourceSummary === 'owner_material' ||
          value.sourceSummary === 'model_inference') &&
        (value.assurance === 'task_supplied' ||
          value.assurance === 'confirmed' ||
          value.assurance === 'pending')
      );
    }) &&
    typeof row.issuedAt === 'string' &&
    typeof row.expiresAt === 'string' &&
    typeof row.grantId === 'string' && !!row.grantId.trim() &&
    typeof row.revocableRef === 'string' && !!row.revocableRef.trim() &&
    typeof row.contentDigest === 'string' && /^[a-f0-9]{64}$/.test(row.contentDigest)
  );
}

export function verifyPersonalContextContract(input: {
  contract: PersonalContextContract;
  expectedTaskRef: string;
  expectedIssuerSubjectId: string;
  expectedRecipientSubjectId: string;
  expectedRecipientEndpointRef: string;
  expectedPurpose: string;
  expectedDisclosure: string;
  now: string;
  grant?: AuthorizationGrant | null;
}): { ok: true } | { ok: false; reason: string } {
  const contract = input.contract;
  if (!isPersonalContextContract(contract)) return { ok: false, reason: '个人上下文合同格式无效' };
  if (contract.taskRef !== input.expectedTaskRef) return { ok: false, reason: '个人上下文合同任务不匹配' };
  if (contract.issuerSubjectId !== input.expectedIssuerSubjectId) return { ok: false, reason: '个人上下文合同签发主体不匹配' };
  if (contract.recipient.subjectId !== input.expectedRecipientSubjectId) return { ok: false, reason: '个人上下文合同接收主体不匹配' };
  if (contract.recipient.endpointRef !== input.expectedRecipientEndpointRef) return { ok: false, reason: '个人上下文合同接收端点不匹配' };
  if (contract.purpose !== input.expectedPurpose) return { ok: false, reason: '个人上下文合同目的不匹配' };
  if (new Set(contract.fields.map((field) => field.ref)).size !== contract.fields.length) {
    return { ok: false, reason: '个人上下文合同字段引用重复' };
  }
  if (renderPersonalContext(contract) !== input.expectedDisclosure) return { ok: false, reason: '实际披露内容与合同不匹配' };
  const nowMs = Date.parse(input.now);
  const issuedAtMs = Date.parse(contract.issuedAt);
  const expiresAtMs = Date.parse(contract.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
    return { ok: false, reason: '个人上下文合同时间无效' };
  }
  if (issuedAtMs > nowMs + 5 * 60 * 1000) return { ok: false, reason: '个人上下文合同尚未生效' };
  if (expiresAtMs <= nowMs) return { ok: false, reason: '个人上下文合同已过期' };
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > PERSONAL_CONTEXT_MAX_TTL_MS) {
    return { ok: false, reason: '个人上下文合同有效期超出允许范围' };
  }
  const { contentDigest, ...unsigned } = contract;
  if (personalContextContentDigest(unsigned) !== contentDigest) {
    return { ok: false, reason: '个人上下文合同内容 digest 不匹配' };
  }

  if (input.grant) {
    const grant = input.grant;
    if (grant.id !== contract.grantId || contract.revocableRef !== `authorization-grant:${grant.id}`) {
      return { ok: false, reason: '个人上下文合同撤销引用不匹配' };
    }
    if (grant.status !== 'granted') return { ok: false, reason: '个人上下文授权已撤销或失效' };
    if (grant.grantorSubjectId !== contract.issuerSubjectId) return { ok: false, reason: '个人上下文授权签发主体不匹配' };
    if (grant.grantee.kind !== 'remote_subject' || grant.grantee.subjectId !== contract.recipient.subjectId) {
      return { ok: false, reason: '个人上下文授权接收主体不匹配' };
    }
    if (!grant.scope.actions.includes('read_authorized_context')) {
      return { ok: false, reason: '个人上下文授权不允许读取上下文' };
    }
    const resources = new Set(grant.scope.resourceRefs || []);
    if (contract.fields.some((field) => !resources.has(field.ref))) {
      return { ok: false, reason: '个人上下文字段超出授权范围' };
    }
    if (resources.size !== contract.fields.length) {
      return { ok: false, reason: '个人上下文授权范围大于本次合同字段' };
    }
    if (
      grant.origin.kind !== 'personal_context_contract' ||
      grant.origin.contractId !== contract.id ||
      grant.origin.exchangeId !== contract.taskRef ||
      grant.origin.purposeDigest !== sha256(contract.purpose)
    ) {
      return { ok: false, reason: '个人上下文授权来源不匹配' };
    }
    const grantExpiresAt = grant.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN;
    if (!Number.isFinite(grantExpiresAt) || grantExpiresAt < expiresAtMs) {
      return { ok: false, reason: '个人上下文授权早于合同失效' };
    }
  }
  return { ok: true };
}
