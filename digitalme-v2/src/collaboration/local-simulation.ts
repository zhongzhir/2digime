import { newId, nowIso } from '../shared/ids';
import type {
  AuthorizationGrant,
  AuthorizationScope,
  InteractionRequest,
  SubjectIdentifier,
} from './schema';

/**
 * 本地模拟(首切片第 9 步):生成一个 InteractionRequest 与对应 AuthorizationGrant。
 * 不执行外网协作;仅验证协作对象与授权链路的接口边界。
 * Grant.origin 内嵌请求快照,请求本体不持久也不产生悬空引用。
 */
export function simulateInteraction(input: {
  grantor: SubjectIdentifier;
  granteeName: string;
  scope: AuthorizationScope;
  goal: string;
}): { request: InteractionRequest; grant: AuthorizationGrant } {
  const at = nowIso();
  const grantee: SubjectIdentifier = {
    subjectId: newId('subject'),
    displayName: input.granteeName,
    scheme: 'local',
  };
  const request: InteractionRequest = {
    id: newId('interactionRequest'),
    fromSubject: grantee,
    toSubject: input.grantor,
    requestedScope: input.scope,
    goal: input.goal,
    createdAt: at,
    mode: 'local_simulation',
  };
  const grant: AuthorizationGrant = {
    id: newId('grant'),
    grantorSubjectId: input.grantor.subjectId,
    grantee: { kind: 'remote_subject', subjectId: grantee.subjectId },
    scope: input.scope,
    origin: {
      kind: 'interaction_request',
      requestId: request.id,
      requestSummary: { fromDisplayName: grantee.displayName, goal: input.goal },
    },
    status: 'granted',
    grantedAt: at,
  };
  return { request, grant };
}

/** 能力授权(同一 Grant 对象的另一形态):Owner 直接授予某能力所需权限。 */
export function grantCapabilityPermissions(input: {
  grantorSubjectId: string;
  capabilityId: string;
  scope: AuthorizationScope;
}): AuthorizationGrant {
  return {
    id: newId('grant'),
    grantorSubjectId: input.grantorSubjectId,
    grantee: { kind: 'capability', capabilityId: input.capabilityId },
    scope: input.scope,
    origin: { kind: 'owner_direct' },
    status: 'granted',
    grantedAt: nowIso(),
  };
}
