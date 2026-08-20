import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTERNAL_CAPABILITY_FAILURE,
  buildAuthorizationConfirmPoints,
  externalCapabilityUserFacingLabel,
  mapExternalCapabilityFailure,
  previewExternalAuthorization,
} from '../external-capability-product';
import type { ExecutionJob } from '../../work-runtime/execution-job';

function job(partial: Partial<ExecutionJob>): ExecutionJob {
  return {
    id: 'job_1',
    taskId: 'task_1',
    capabilityId: 'cap_a2a_research_analysis',
    createdAt: '2026-08-05T00:00:00.000Z',
    status: 'queued',
    ...partial,
  };
}

test('authorization confirm points come from projection defaults', () => {
  const preview = previewExternalAuthorization({
    goal: '形成项目风险摘要',
    allowedMaterialPaths: ['C:/docs/a.md'],
    capabilityDisplayName: '研究分析能力',
  });
  assert.equal(preview.projection.allowRemotePersist, false);
  assert.equal(preview.projection.allowRedelegate, false);
  assert.ok(preview.confirmPoints.some((p) => p.includes('将发送的任务要求')));
  assert.ok(preview.confirmPoints.some((p) => p.includes('a.md')));
  assert.ok(preview.confirmPoints.some((p) => p.includes('不允许保存')));
  assert.ok(preview.confirmPoints.some((p) => p.includes('不允许再委托')));
  assert.ok(preview.confirmPoints.some((p) => p.includes('可随时取消')));
  assert.ok(preview.confirmPoints.every((p) => !/A2A|Agent Card|endpoint|protocol|taskId/i.test(p)));
});

test('buildAuthorizationConfirmPoints does not invent persist/redelegate', () => {
  const points = buildAuthorizationConfirmPoints({
    allowedFields: ['goal'],
    allowedMaterials: [],
    purpose: 'demo',
    maxCalls: 1,
    maxMaterialBytes: 1,
    maxRuntimeMs: 1,
    allowRemotePersist: false,
    allowRedelegate: false,
  });
  assert.ok(points.some((p) => /不允许保存/.test(p)));
  assert.ok(points.some((p) => /不会发送的内容/.test(p)));
});

test('external capability labels derive from local job only', () => {
  assert.equal(externalCapabilityUserFacingLabel(undefined), '准备中');
  assert.equal(externalCapabilityUserFacingLabel(job({ status: 'queued' })), '准备中');
  assert.equal(
    externalCapabilityUserFacingLabel(
      job({ status: 'running', progress: { note: '正在调用能力', updatedAt: 't' } }),
    ),
    '正在交给专业能力',
  );
  assert.equal(
    externalCapabilityUserFacingLabel(
      job({
        status: 'running',
        remoteExecution: { executionId: 'r1', adapterId: 'a2a' },
        progress: { note: '正在处理', updatedAt: 't' },
      }),
    ),
    '正在处理',
  );
  assert.equal(
    externalCapabilityUserFacingLabel(
      job({
        status: 'running',
        remoteExecution: { executionId: 'r1', adapterId: 'a2a' },
        progress: { note: '正在检查成果', updatedAt: 't' },
      }),
    ),
    '正在检查成果',
  );
  assert.equal(
    externalCapabilityUserFacingLabel(job({ status: 'succeeded', artifactId: 'art_1' }), {
      hasArtifact: true,
    }),
    '已返回成果',
  );
  assert.equal(externalCapabilityUserFacingLabel(job({ status: 'cancelled' })), '已取消');
  assert.equal(externalCapabilityUserFacingLabel(job({ status: 'failed' })), '未完成');
});

test('failure mapping covers required owner-facing messages', () => {
  assert.equal(
    mapExternalCapabilityFailure({ actionable: 'missing credential' }).message,
    EXTERNAL_CAPABILITY_FAILURE.credentialMissing,
  );
  assert.equal(
    mapExternalCapabilityFailure({ message: 'timeout exceeded' }).message,
    EXTERNAL_CAPABILITY_FAILURE.timeout,
  );
  assert.equal(
    mapExternalCapabilityFailure({ cancelled: true }).message,
    EXTERNAL_CAPABILITY_FAILURE.cancelled,
  );
  assert.equal(
    mapExternalCapabilityFailure({ actionable: '未通过验证' }).message,
    EXTERNAL_CAPABILITY_FAILURE.verificationFailed,
  );
  assert.equal(
    mapExternalCapabilityFailure({ message: 'material not authorized' }).message,
    EXTERNAL_CAPABILITY_FAILURE.materialAuth,
  );
  assert.equal(
    mapExternalCapabilityFailure({ message: 'agent_card unreachable' }).message,
    EXTERNAL_CAPABILITY_FAILURE.unavailable,
  );
  for (const mapped of [
    mapExternalCapabilityFailure({ message: 'ECONNREFUSED 127.0.0.1' }),
    mapExternalCapabilityFailure({ actionable: 'Authorization Bearer sk-test' }),
  ]) {
    assert.ok(!/sk-|Bearer|ECONN|agent_card|A2A/i.test(mapped.message));
  }
});
