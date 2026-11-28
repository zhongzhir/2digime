import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

const serverModule = require(path.resolve(__dirname, '../../../institution/backend/server.cjs')) as {
  clientOverview: (data: Record<string, unknown>, userId: string) => any;
};
const storeModule = require(path.resolve(__dirname, '../../../institution/backend/store.cjs')) as {
  assertNoForbiddenPayload: (value: unknown) => void;
};

test('institution client overview derives only account, entitlement, service and privacy-boundary facts', () => {
  const overview = serverModule.clientOverview({
    organizations: {
      org: { id: 'org', name: '合成机构', status: 'active', createdAt: '2026-11-28T00:00:00.000Z' },
    },
    users: {
      user: {
        institutionUserId: 'user',
        organizationId: 'org',
        status: 'active',
        entitlementGroup: 'high',
        provisionedAt: '2026-11-28T00:00:00.000Z',
      },
    },
  }, 'user');

  assert.equal(overview.organization.name, '合成机构');
  assert.equal(overview.account.verificationLevel, 'sandbox_account');
  assert.equal(overview.entitlement.status, 'active');
  assert.deepEqual(overview.authorization.scopes, ['ai:talk']);
  assert.equal(overview.services[0].entry, 'talk');
  assert.deepEqual(overview.metering.neverShared, ['Digital Self', '私人 Talk 正文', '本地文件', '长期记忆']);
  assert.equal(JSON.stringify(overview).includes('virtualKey'), false);
});

test('institution store rejects private subject payloads', () => {
  for (const field of ['prompt', 'response', 'digitalSelf', 'memory', 'conversation', 'artifactContent']) {
    assert.throws(() => storeModule.assertNoForbiddenPayload({ audit: { [field]: 'private' } }), /forbids persisting/);
  }
});

