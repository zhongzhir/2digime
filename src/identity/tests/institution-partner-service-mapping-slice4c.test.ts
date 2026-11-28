import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';

const admin = require(path.resolve(__dirname, '../../../institution/backend/partner-admin.cjs')) as {
  normalizeData: (data: any) => any;
  createOrganization: (data: any, input: any, now: string) => any;
  createService: (data: any, input: any, now: string) => any;
  publicOverview: (data: any) => any;
};

test('Slice 4C：伙伴服务配置引用真实 Digital Subject，不复制主体资料', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice4c-service-subject-'));
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const subjectDir = path.join(root, 'bank-service-subject');
  await runtime.createPackage({
    displayName: '合成银行服务 Subject',
    targetDir: subjectDir,
    initialSelfDescription: '在最小披露和人在环授权下协助核对机构试点边界。',
  });
  try {
    const subject = await runtime.getOverview({});
    let data = admin.createOrganization(
      admin.normalizeData({}),
      { id: 'synthetic-bank', name: '合成银行伙伴' },
      '2026-11-28T08:00:00.000Z',
    );
    data = admin.createService(data, {
      serviceId: 'bank-service',
      organizationId: 'synthetic-bank',
      name: '合成银行服务 Subject',
      subjectId: subject.subjectId,
      scopes: ['service:consult'],
      humanInLoop: true,
    }, '2026-11-28T08:01:00.000Z');
    const overview = admin.publicOverview(data);
    assert.equal(overview.services[0].subjectId, subject.subjectId);
    assert.equal(overview.services[0].authorizationPolicy.humanInLoop, true);
    assert.equal(overview.services[0].authorizationPolicy.maxCostCny, 0);
    const serialized = JSON.stringify(overview.services[0]);
    assert.equal(serialized.includes('initialSelfDescription'), false);
    assert.equal(serialized.includes('Digital Self'), false);
    assert.equal(serialized.includes(subjectDir), false);
  } finally {
    await runtime.stop();
  }
});
