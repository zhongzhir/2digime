import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

const admin = require(path.resolve(__dirname, '../../../institution/backend/partner-admin.cjs')) as {
  normalizeData: (data: any) => any;
  publicOverview: (data: any) => any;
  createOrganization: (data: any, input: any, now: string) => any;
  createUser: (data: any, input: any, now: string) => any;
  createService: (data: any, input: any, now: string) => any;
  disableResource: (data: any, input: any, now: string) => any;
};

const NOW = '2026-11-28T08:00:00.000Z';

test('partner admin manages one institution, two users and a service without exposing credentials', () => {
  let data = admin.normalizeData({ version: 1, organizations: {}, users: {} });
  data = admin.createOrganization(data, { id: 'partner-bank', name: '合成银行' }, NOW);
  data = admin.createUser(data, {
    institutionUserId: 'bank-user-1', organizationId: 'partner-bank', entitlementLabel: '基础权益', quotaAmount: 100,
  }, NOW);
  data = admin.createUser(data, {
    institutionUserId: 'bank-user-2', organizationId: 'partner-bank', entitlementLabel: '增强权益', quotaAmount: 200,
  }, NOW);
  data.users['bank-user-1'].virtualKey = 'sk-private-sandbox-key';
  data = admin.createService(data, {
    serviceId: 'bank-consult',
    organizationId: 'partner-bank',
    name: '银行服务协作',
    subjectId: 'subject-bank-consult',
    a2aEndpoint: 'https://sandbox.example/a2a',
    agentCardUrl: 'https://sandbox.example/.well-known/agent-card.json',
    scopes: ['service:consult'],
    humanInLoop: true,
  }, NOW);

  const overview = admin.publicOverview(data);
  assert.equal(overview.organizations.length, 1);
  assert.equal(overview.users.length, 2);
  assert.equal(overview.services.length, 1);
  assert.equal(overview.services[0].authorizationPolicy.maxCostCny, 0);
  assert.equal(overview.services[0].authorizationPolicy.humanInLoop, true);
  assert.equal(JSON.stringify(overview).includes('sk-private-sandbox-key'), false);
  assert.deepEqual(overview.privacyBoundary.forbidden, [
    'prompt', 'response', 'Digital Self', '私人文件', '长期记忆', 'provider master key',
  ]);
  assert.equal(overview.auditEvents.length, 4);
});

test('disabling an organization cascades only account and service availability', () => {
  let data = admin.createOrganization(admin.normalizeData({}), { id: 'partner-telco', name: '合成电信' }, NOW);
  data = admin.createUser(data, {
    institutionUserId: 'telco-user', organizationId: 'partner-telco', entitlementLabel: '试看权益', quotaAmount: 10,
  }, NOW);
  data = admin.createService(data, {
    serviceId: 'telco-service', organizationId: 'partner-telco', name: '电信服务', subjectId: 'subject-telco',
  }, NOW);
  data = admin.disableResource(data, { resourceType: 'organization', resourceId: 'partner-telco' }, NOW);
  assert.equal(data.organizations['partner-telco'].status, 'disabled');
  assert.equal(data.users['telco-user'].status, 'disabled');
  assert.equal(data.services['telco-service'].status, 'disabled');
  assert.equal(data.auditEvents.at(-1).action, 'organization.disabled');
});

test('partner admin rejects invalid identifiers and non-http endpoints', () => {
  const data = admin.createOrganization(admin.normalizeData({}), { id: 'valid-org', name: '合成机构' }, NOW);
  assert.throws(() => admin.createUser(data, {
    institutionUserId: '../escape', organizationId: 'valid-org', entitlementLabel: '权益',
  }, NOW), /institution_user_id_invalid/);
  assert.throws(() => admin.createService(data, {
    serviceId: 'service', organizationId: 'valid-org', name: '服务', subjectId: 'subject-service', a2aEndpoint: 'file:///tmp/a',
  }, NOW), /a2a_endpoint_invalid/);
});

