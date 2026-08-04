/**
 * 远端能力合同 / 授权投影 / 候选验证 / 行动收据 单元测试。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRemoteAuthorization, applyAuthorizationProjectionToInput } from '../remote-authorization';
import { verifyCandidateArtifact } from '../candidate-artifact-verify';
import { buildActionReceipt } from '../action-receipt';
import { RemoteSecurityGate } from '../remote-security';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import { ADAPTER_TYPES } from '../registration';
import type { CapabilityInput } from '../adapter';
import type { ContextSnapshot } from '../../work-runtime/context-snapshot';

function sampleInput(paths: string[]): CapabilityInput {
  const snapshot: ContextSnapshot = {
    id: 'snap_1',
    taskId: 'task_1',
    createdAt: new Date().toISOString(),
    items: paths.map((sourcePath) => ({
      sourcePath,
      kind: 'file' as const,
      status: 'ok' as const,
      extractedTextRef: `ref:${sourcePath}`,
      contentDigest: 'abc',
    })),
  };
  return {
    goal: '写一份产品简报',
    snapshot,
    subjectContext: { subjectId: 's1', derivedAt: new Date().toISOString(), entries: [] },
    artifactType: 'document',
  };
}

test('authorization projection defaults deny persist and redelegate', () => {
  const auth = projectRemoteAuthorization({
    goal: '分析材料',
    allowedMaterialPaths: ['C:/a.txt'],
  });
  assert.equal(auth.allowRemotePersist, false);
  assert.equal(auth.allowRedelegate, false);
  assert.equal(auth.maxCalls, 1);
  assert.ok(auth.allowedFields.includes('goal'));
});

test('prepareAuthorizedInput clips unauthorized materials', () => {
  const input = sampleInput(['C:/allowed.txt', 'C:/secret.txt']);
  const auth = projectRemoteAuthorization({
    goal: input.goal,
    allowedMaterialPaths: ['C:/allowed.txt'],
  });
  const clipped = applyAuthorizationProjectionToInput(input, auth);
  assert.equal(clipped.snapshot.items.length, 1);
  assert.match(clipped.snapshot.items[0]!.sourcePath, /allowed/i);
  assert.equal(clipped.subjectContext.entries.length, 0);
});

test('candidate verification rejects leakage and malformed provenance', () => {
  const auth = projectRemoteAuthorization({ goal: '产品简报', allowedMaterialPaths: [] });
  const bad = verifyCandidateArtifact({
    output: {
      artifact: {
        type: 'document',
        title: 'x',
        payload: { kind: 'text', format: 'markdown', text: '无关文本 SECRET_UNAUTHORIZED_PAYLOAD_XYZ' },
      },
    },
    goal: '产品简报',
    expectedArtifactType: 'document',
    auth,
    unauthorizedMarkers: ['SECRET_UNAUTHORIZED_PAYLOAD_XYZ'],
    nowIso: new Date().toISOString(),
  });
  assert.equal(bad.verdict, 'rejected');
  assert.ok(bad.issues.some((i) => i.code === 'authorized_data_leakage'));
  assert.ok(bad.issues.some((i) => i.code === 'provenance_missing'));
});

test('candidate verification passes grounded remote output', () => {
  const auth = projectRemoteAuthorization({ goal: '产品简报', allowedMaterialPaths: ['a'] });
  const text = '# 产品简报\n\n围绕产品简报目标的正文。';
  const ok = verifyCandidateArtifact({
    output: {
      artifact: {
        type: 'document',
        title: '产品简报',
        payload: { kind: 'text', format: 'markdown', text },
      },
      candidateMeta: {
        provenance: 'controlled-remote:rex_1',
        sourceBinding: 'rex_1',
        contentDigest: 'x',
      },
    },
    goal: '产品简报',
    expectedArtifactType: 'document',
    auth,
    expectedSourceBinding: 'rex_1',
    nowIso: new Date().toISOString(),
  });
  assert.equal(ok.verdict, 'passed');
  assert.equal(ok.modelSelfGradeIgnored, false);
});

test('action receipt omits sensitive body', () => {
  const receipt = buildActionReceipt({
    receiptId: 'receipt_1',
    subjectId: 's1',
    taskId: 't1',
    jobId: 'j1',
    capabilityId: 'cap',
    adapterId: 'controlled-remote-subject',
    adapterType: 'remote-subject',
    adapterVersion: 'controlled-remote/1',
    sentFields: ['goal'],
    materialRefs: [{ path: 'a.txt', digest: 'd1' }],
    output: {
      artifact: {
        type: 'document',
        title: 't',
        payload: { kind: 'text', format: 'markdown', text: 'SECRET_BODY_SHOULD_NOT_APPEAR' },
      },
    },
    startedAt: new Date().toISOString(),
  });
  const raw = JSON.stringify(receipt);
  assert.equal(raw.includes('SECRET_BODY_SHOULD_NOT_APPEAR'), false);
  assert.equal(receipt.adoption?.status, 'undecided');
});

test('security gate enforces endpoint whitelist and call budget', () => {
  const gate = new RemoteSecurityGate({
    allowedEndpoints: ['http://127.0.0.1:9'],
    maxCallsPerTask: 1,
  });
  assert.throws(() => gate.assertEndpointAllowed('http://evil.example'), /allowlisted/);
  gate.beginCall('task_a');
  assert.throws(() => gate.beginCall('task_a'), /budget/);
  gate.endCall();
});

test('local adapter helper fills lifecycle contract', async () => {
  const adapter = asLocalCapabilityAdapter({
    registration: {
      id: 'cap_local',
      kind: 'tool',
      displayName: 'local',
      description: 'd',
      inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
      outputArtifactTypes: ['document'],
      permissions: [],
      cost: { estimate: 'free' },
      latencyEstimate: 'instant',
      location: 'local',
      availability: 'available',
      adapter: { type: 'local-tool', adapterId: 'x' },
    },
    async execute() {
      return {
        artifact: {
          type: 'document',
          title: 't',
          payload: { kind: 'text', format: 'markdown', text: '# t' },
        },
      };
    },
  });
  const d = adapter.describe();
  assert.equal(d.supportsAsyncRemote, false);
  const avail = await adapter.checkAvailability();
  assert.equal(avail.available, true);
  assert.ok(ADAPTER_TYPES.includes('remote-subject'));
});
