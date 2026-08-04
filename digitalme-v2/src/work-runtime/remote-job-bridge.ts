import { newId, nowIso } from '../shared/ids';
import type { CapabilityAdapter, CapabilityInput, CapabilityOutput, ExecutionContext } from '../capability/adapter';
import {
  attachReceiptToOutput,
  buildActionReceipt,
} from '../capability/action-receipt';
import {
  verifyCandidateArtifact,
  type CandidateVerificationResult,
} from '../capability/candidate-artifact-verify';
import {
  DEFAULT_ALLOWED_FIELDS,
  projectRemoteAuthorization,
  type RemoteAuthorizationProjection,
} from '../capability/remote-authorization';
import type { AuthorizationGrant } from '../collaboration/schema';
import type { ExecutionJob } from './execution-job';
import type { Task } from './task';

/**
 * Work Runtime 远端边界辅助 — 保持 Job 五态为唯一用户面权威。
 * 不引入第二 Store / 第二状态机。
 */

export function buildJobAuthorizationProjection(input: {
  task: Task;
  capabilityInput: CapabilityInput;
  grant?: AuthorizationGrant | null;
  isRemote: boolean;
}): RemoteAuthorizationProjection {
  const materialPaths = input.capabilityInput.snapshot.items.map((i) => i.sourcePath);
  if (!input.isRemote) {
    // 本地能力:允许快照内全部材料,并保留主体经验注入字段
    return projectRemoteAuthorization({
      goal: input.task.goal,
      allowedMaterialPaths: materialPaths,
      defaults: {
        allowedFields: [...DEFAULT_ALLOWED_FIELDS, 'subjectContext', 'revision'],
        maxCalls: 32,
        maxMaterialBytes: 2_000_000,
        maxRuntimeMs: 300_000,
        allowRemotePersist: false,
        allowRedelegate: false,
      },
    });
  }
  const allowed =
    input.grant?.scope.resourceRefs?.length
      ? [...input.grant.scope.resourceRefs]
      : materialPaths;
  return projectRemoteAuthorization({
    goal: input.task.goal,
    ...(input.grant ? { grant: input.grant } : {}),
    allowedMaterialPaths: allowed,
    defaults: {
      maxCalls: 1,
      maxMaterialBytes: 256_000,
      maxRuntimeMs: 60_000,
      allowRemotePersist: false,
      allowRedelegate: false,
    },
  });
}

export async function prepareAndExecuteCapability(input: {
  adapter: CapabilityAdapter;
  rawInput: CapabilityInput;
  auth: RemoteAuthorizationProjection;
  ctx: ExecutionContext;
  isRemote: boolean;
  unauthorizedMarkers?: string[];
  job: ExecutionJob;
  task: Task;
  subjectId: string;
}): Promise<{
  output: CapabilityOutput;
  verification?: CandidateVerificationResult;
  receiptPath?: string;
}> {
  const prepared = await input.adapter.prepareAuthorizedInput(
    input.rawInput,
    input.auth,
    input.ctx,
  );
  let output = await input.adapter.execute(prepared, input.ctx);

  if (!input.isRemote) {
    return { output };
  }

  const expectedBinding =
    input.job.remoteExecution?.executionId || output.candidateMeta?.sourceBinding;
  const verification = verifyCandidateArtifact({
    output,
    goal: input.task.goal,
    expectedArtifactType: input.task.requestedArtifactType,
    auth: input.auth,
    ...(input.unauthorizedMarkers ? { unauthorizedMarkers: input.unauthorizedMarkers } : {}),
    ...(expectedBinding ? { expectedSourceBinding: expectedBinding } : {}),
    nowIso: nowIso(),
    maxOutputBytes: input.auth.maxMaterialBytes * 2,
  });

  const describe = input.adapter.describe();
  const provenance = output.candidateMeta?.provenance || '';
  const protocolMapping = provenance.startsWith('a2a:')
    ? {
        protocol: 'a2a',
        protocolVersion: provenance.split(':')[1] || '1.0',
        ...(input.job.remoteExecution?.executionId
          ? { remoteTaskId: input.job.remoteExecution.executionId }
          : {}),
        ...(provenance.split(':')[2] ? { endpointId: provenance.split(':')[2] } : {}),
      }
    : provenance.startsWith('controlled-remote:') || describe.adapterId.includes('controlled-remote')
      ? {
          protocol: 'private-http',
          ...(input.job.remoteExecution?.executionId
            ? { remoteTaskId: input.job.remoteExecution.executionId }
            : {}),
        }
      : undefined;
  const receipt = buildActionReceipt({
    receiptId: newId('capability'),
    subjectId: input.subjectId,
    taskId: input.task.id,
    jobId: input.job.id,
    ...(input.auth.grantId ? { grantId: input.auth.grantId } : {}),
    capabilityId: input.adapter.registration.id,
    adapterId: describe.adapterId,
    adapterType: describe.adapterType,
    adapterVersion: describe.version,
    ...(input.job.remoteExecution?.endpoint
      ? { endpoint: input.job.remoteExecution.endpoint }
      : {}),
    ...(input.job.remoteExecution?.executionId
      ? { remoteExecutionId: input.job.remoteExecution.executionId }
      : {}),
    ...(protocolMapping ? { protocolMapping } : {}),
    sentFields: [...input.auth.allowedFields],
    materialRefs: (prepared.authorized?.allowedMaterialPaths ?? []).map((p) => ({ path: p })),
    ...(input.job.remoteExecution?.lastRemoteStatus
      ? { remoteStatus: input.job.remoteExecution.lastRemoteStatus }
      : { remoteStatus: 'completed' as const }),
    cancelled: !!input.job.remoteExecution?.cancelRequested,
    retryCount: input.job.remoteExecution?.retryCount ?? 0,
    verification,
    output,
    auth: input.auth,
    startedAt: input.job.startedAt || input.job.createdAt,
    finishedAt: nowIso(),
    ...(verification.verdict === 'rejected'
      ? {
          failedAt: nowIso(),
          failureMessage: verification.issues.map((i) => i.message).join('; '),
        }
      : {}),
  });

  if (verification.verdict !== 'passed') {
    const err = Object.assign(
      new Error(verification.issues.map((i) => i.message).join('; ') || 'candidate verification failed'),
      {
        stage: 'capability' as const,
        actionable: '远端成果未通过验证,未写入正式成果',
        code: 'candidate_verification_failed',
        verification,
      },
    );
    throw err;
  }

  output = await attachReceiptToOutput(output, input.ctx.workDir, receipt);
  return { output, verification };
}

export async function resumeRemoteIfPossible(input: {
  adapter: CapabilityAdapter;
  job: ExecutionJob;
  ctx: ExecutionContext;
}): Promise<
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }
  | { kind: 'output'; output: CapabilityOutput }
  | { kind: 'still_running' }
> {
  const remote = input.job.remoteExecution;
  if (!remote) return { kind: 'none' };
  if (remote.cancelRequested) return { kind: 'cancelled' };

  const recovered = await input.adapter.recover(
    {
      executionId: remote.executionId,
      adapterId: remote.adapterId,
      ...(remote.endpoint ? { endpoint: remote.endpoint } : {}),
    },
    input.ctx,
  );

  if (recovered.status === 'cancelled') return { kind: 'cancelled' };
  if (recovered.status === 'failed') {
    return { kind: 'failed', message: recovered.message || 'remote recover failed' };
  }
  if (recovered.status === 'completed') {
    if (recovered.output) return { kind: 'output', output: recovered.output };
    const output = await input.adapter.collectArtifact(
      {
        executionId: remote.executionId,
        adapterId: remote.adapterId,
        ...(remote.endpoint ? { endpoint: remote.endpoint } : {}),
      },
      input.ctx,
    );
    return { kind: 'output', output };
  }
  if (recovered.status === 'pending' || recovered.status === 'running') {
    return { kind: 'still_running' };
  }
  return { kind: 'none' };
}
