import type { AuthorizationGrant } from '../collaboration/schema';
import type { CapabilityInput } from './adapter';
import type { ContextSnapshot, SnapshotItem } from '../work-runtime/context-snapshot';

/**
 * 远端授权投影 — 由本地确定性代码从 Grant / 任务约束投影而来。
 * Adapter 只消费投影,不得自行扩大范围。
 */
export interface RemoteAuthorizationProjection {
  allowedFields: readonly string[];
  allowedMaterials: readonly string[];
  purpose: string;
  expiresAt?: string;
  maxCalls: number;
  maxMaterialBytes: number;
  maxRuntimeMs: number;
  /** 默认 false:禁止远端持久化授权材料。 */
  allowRemotePersist: boolean;
  /** 默认 false:禁止再委托。 */
  allowRedelegate: boolean;
  grantId?: string;
  issuerSubjectId?: string;
  granteeSubjectId?: string;
}

export const DEFAULT_ALLOWED_FIELDS = [
  'goal',
  'confirmedPlan',
  'artifactType',
  'authorizedMaterials',
  'purpose',
] as const;

export interface ProjectAuthorizationInput {
  goal: string;
  grant?: AuthorizationGrant | null;
  allowedMaterialPaths?: string[];
  nowIso?: string;
  defaults?: Partial<RemoteAuthorizationProjection>;
}

/** 将 Grant / 本地约束投影为远端授权边界。 */
export function projectRemoteAuthorization(
  input: ProjectAuthorizationInput,
): RemoteAuthorizationProjection {
  const grant = input.grant ?? null;
  const materials = normalizePaths([
    ...(input.allowedMaterialPaths ?? []),
    ...((grant?.scope.resourceRefs as string[] | undefined) ?? []),
  ]);
  const expiresAt = grant?.expiresAt;
  const purpose =
    grant?.subtaskGoal?.trim() ||
    input.goal.trim() ||
    'authorized_remote_capability';

  const projection: RemoteAuthorizationProjection = {
    allowedFields: [...(input.defaults?.allowedFields ?? DEFAULT_ALLOWED_FIELDS)],
    allowedMaterials: materials,
    purpose,
    maxCalls: input.defaults?.maxCalls ?? 1,
    maxMaterialBytes: input.defaults?.maxMaterialBytes ?? 256_000,
    maxRuntimeMs: input.defaults?.maxRuntimeMs ?? 60_000,
    allowRemotePersist: input.defaults?.allowRemotePersist ?? false,
    allowRedelegate: input.defaults?.allowRedelegate ?? false,
  };
  if (expiresAt) projection.expiresAt = expiresAt;
  if (grant?.id) projection.grantId = grant.id;
  if (grant?.grantorSubjectId) projection.issuerSubjectId = grant.grantorSubjectId;
  if (grant?.grantee.kind === 'remote_subject') {
    projection.granteeSubjectId = grant.grantee.subjectId;
  }
  if (input.defaults?.expiresAt && !projection.expiresAt) {
    projection.expiresAt = input.defaults.expiresAt;
  }
  return projection;
}

export function assertProjectionUsable(
  auth: RemoteAuthorizationProjection,
  nowIso: string,
): void {
  if (auth.expiresAt && Date.parse(auth.expiresAt) <= Date.parse(nowIso)) {
    throw Object.assign(new Error('authorization expired'), {
      stage: 'capability' as const,
      actionable: '授权已过期,请重新授权后再试',
    });
  }
  if (auth.allowRedelegate) {
    // 本轮产品准备仍禁止再委托;即便投影误开也硬拒绝。
    throw Object.assign(new Error('redelegate is not allowed in this readiness slice'), {
      stage: 'capability' as const,
      actionable: '当前不支持再委托',
    });
  }
}

/**
 * 按投影裁剪 CapabilityInput:仅保留允许字段语义与允许材料。
 * 未授权材料从 Snapshot.items 中剔除。
 */
export function applyAuthorizationProjectionToInput(
  input: CapabilityInput,
  auth: RemoteAuthorizationProjection,
): CapabilityInput {
  const allowed = new Set(auth.allowedMaterials.map((p) => normalizePath(p)));
  let clippedItems: SnapshotItem[];
  if (allowed.size > 0) {
    // 白名单：仅保留授权路径材料
    clippedItems = input.snapshot.items.filter((item) =>
      allowed.has(normalizePath(item.sourcePath)),
    );
  } else {
    // 空授权材料表：不向远端发送材料正文
    clippedItems = input.snapshot.items.map((item) => redactSnapshotItem(item));
  }

  const snapshot: ContextSnapshot = {
    ...input.snapshot,
    items: clippedItems,
  };

  const next: CapabilityInput = {
    goal: input.goal,
    snapshot,
    subjectContext: {
      ...input.subjectContext,
      // 远端默认不携带主体经验明细,除非 allowedFields 显式包含。
      entries: auth.allowedFields.includes('subjectContext')
        ? input.subjectContext.entries
        : [],
    },
    artifactType: input.artifactType,
    authorized: {
      purpose: auth.purpose,
      allowedMaterialPaths: [...auth.allowedMaterials],
      ...(auth.grantId ? { grantId: auth.grantId } : {}),
    },
  };
  if (input.revision && auth.allowedFields.includes('revision')) {
    next.revision = input.revision;
  }
  if (input.confirmedPlan && auth.allowedFields.includes('confirmedPlan')) {
    next.confirmedPlan = input.confirmedPlan;
  }
  if (input.executionAuthorization) {
    next.executionAuthorization = input.executionAuthorization;
  }
  return next;
}

function redactSnapshotItem(item: SnapshotItem): SnapshotItem {
  const next: SnapshotItem = {
    ...item,
    status: 'warning',
    warning: 'material_not_authorized_for_remote',
  };
  delete next.extractedTextRef;
  return next;
}

function normalizePaths(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const n = normalizePath(p);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function normalizePath(p: string): string {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}
