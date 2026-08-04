import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertEndpointPolicyShape,
  buildResearchEndpointPolicy,
  fingerprintEndpointPolicy,
  validateAgentCardAgainstPolicy,
} from '../remote-endpoint-policy';

test('endpoint policy rejects non-loopback http', () => {
  const policy = buildResearchEndpointPolicy({
    baseUrl: 'http://example.com:8080',
  });
  assert.equal(policy.allowedProtocol, 'https');
  assert.throws(() => assertEndpointPolicyShape(policy), /https/);
});

test('endpoint policy accepts loopback http research agent', () => {
  const policy = buildResearchEndpointPolicy({
    baseUrl: 'http://127.0.0.1:43111',
  });
  assert.equal(policy.allowedProtocol, 'loopback-http');
  assert.doesNotThrow(() => assertEndpointPolicyShape(policy));
  assert.ok(policy.capabilityAllowlist.includes('project_risk_brief'));
  assert.ok(fingerprintEndpointPolicy(policy).length >= 16);
});

test('agent card skill mismatch is rejected', () => {
  const policy = buildResearchEndpointPolicy({
    baseUrl: 'http://127.0.0.1:43111',
  });
  const result = validateAgentCardAgainstPolicy(policy, {
    name: 'Research Analysis Agent',
    supportedInterfaces: [
      {
        url: 'http://127.0.0.1:43111/',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    skills: [{ id: 'other_skill', name: 'Other' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /allowlisted skill/i.test(r)));
});

test('agent card matching skill passes', () => {
  const policy = buildResearchEndpointPolicy({
    baseUrl: 'http://127.0.0.1:43111',
  });
  const result = validateAgentCardAgainstPolicy(policy, {
    name: 'Research Analysis Agent',
    supportedInterfaces: [
      {
        url: 'http://127.0.0.1:43111/',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    skills: [{ id: 'project_risk_brief', name: '项目风险摘要' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.matchedSkillIds, ['project_risk_brief']);
});
