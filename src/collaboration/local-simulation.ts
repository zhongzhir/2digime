/**
 * TEST-ONLY 替身：内存模拟 InteractionRequest + AuthorizationGrant。
 * 不得经 CommandBus / collab.interact 到达；仅供 smoke 与单元测试直接 import。
 */
import { newId, nowIso } from '../shared/ids';
import type {
  AuthorizationGrant,
  AuthorizationScope,
  InteractionRequest,
  SubjectIdentifier,
} from './schema';

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
