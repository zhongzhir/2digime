import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GrantStore } from '../../collaboration/grant-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { consultSubject } from '../../subject-collab/consult';
import { listExchanges } from '../../subject-collab/exchange-store';
import { createInMemorySubjectNetwork } from '../../subject-collab/network';
import {
  issuePersonalContextContract,
  verifyPersonalContextContract,
} from '../../subject-collab/personal-context-contract';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

async function tempDir(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-pcc-${name}-`));
}

function selfFixture(subjectId: string, at: string): DigitalSelf {
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: at,
    understandings: [
      {
        id: 'u_goal',
        text: '我正在评估一个低风险工艺改造方案。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: {
          origin: 'user_statement',
          actor: 'owner',
          statedAt: at,
          excerpt: '不得进入外部合同的原始摘录',
        },
        updatedAt: at,
      },
      {
        id: 'u_private',
        text: '我的私人住址是西湖区某某路 88 号。',
        facet: 'about_me',
        status: 'current',
        confirmed: true,
        provenance: {
          origin: 'material',
          actor: 'model',
          statedAt: at,
          materialName: '身份证复印件.pdf',
        },
        updatedAt: at,
      },
      {
        id: 'u_pending',
        text: '我可能偏好先看风险再看收益。',
        facet: 'preferences',
        status: 'candidate',
        confirmed: false,
        provenance: { origin: 'inference', actor: 'model', statedAt: at },
        updatedAt: at,
      },
    ],
  };
}

test('Personal Context Contract 只投影模型选择的真实字段，并绑定目的、接收方、有效期与 Grant', async () => {
  const root = await tempDir('contract');
  const at = '2026-11-22T08:00:00.000Z';
  await writeDigitalSelf(root, selfFixture('subject-a', at));

  const issued = await issuePersonalContextContract({
    packageRoot: root,
    issuerSubjectId: 'subject-a',
    recipientSubjectId: 'subject-b',
    recipientEndpointRef: 'relay:peer-b',
    taskRef: 'ex-1',
    purpose: '请对低风险工艺改造给出安全意见',
    taskContext: '只需判断方案的工艺安全可行性。',
    understandingIds: ['u_goal'],
    issuedAt: at,
  });

  assert.deepEqual(
    issued.contract.fields.map((field) => field.ref),
    ['collaboration:task-context:ex-1', 'digital-self:understanding:u_goal'],
  );
  const serialized = JSON.stringify(issued.contract);
  assert.match(serialized, /低风险工艺改造/);
  assert.equal(serialized.includes('西湖区'), false);
  assert.equal(serialized.includes('身份证复印件'), false);
  assert.equal(serialized.includes('原始摘录'), false);
  assert.equal(serialized.includes('understandings'), false);

  const stored = await (await GrantStore.open(root)).get(issued.grant.id);
  assert.ok(stored);
  assert.equal(stored!.origin.kind, 'personal_context_contract');
  assert.deepEqual(stored!.scope.resourceRefs, issued.contract.fields.map((field) => field.ref));
  assert.equal(issued.contract.revocableRef, `authorization-grant:${issued.grant.id}`);

  const valid = verifyPersonalContextContract({
    contract: issued.contract,
    expectedTaskRef: 'ex-1',
    expectedIssuerSubjectId: 'subject-a',
    expectedRecipientSubjectId: 'subject-b',
    expectedRecipientEndpointRef: 'relay:peer-b',
    expectedPurpose: '请对低风险工艺改造给出安全意见',
    expectedDisclosure: issued.disclosure,
    now: '2026-11-22T08:05:00.000Z',
    grant: stored,
  });
  assert.equal(valid.ok, true);

  const tampered = structuredClone(issued.contract);
  tampered.fields[0]!.value = '被替换的披露内容';
  const badDigest = verifyPersonalContextContract({
    contract: tampered,
    expectedTaskRef: 'ex-1',
    expectedIssuerSubjectId: 'subject-a',
    expectedRecipientSubjectId: 'subject-b',
    expectedRecipientEndpointRef: 'relay:peer-b',
    expectedPurpose: tampered.purpose,
    expectedDisclosure: issued.disclosure,
    now: '2026-11-22T08:05:00.000Z',
    grant: stored,
  });
  assert.equal(badDigest.ok, false);

  const wrongEndpoint = verifyPersonalContextContract({
    contract: issued.contract,
    expectedTaskRef: 'ex-1',
    expectedIssuerSubjectId: 'subject-a',
    expectedRecipientSubjectId: 'subject-b',
    expectedRecipientEndpointRef: 'relay:peer-c',
    expectedPurpose: issued.contract.purpose,
    expectedDisclosure: issued.disclosure,
    now: '2026-11-22T08:05:00.000Z',
    grant: stored,
  });
  assert.equal(wrongEndpoint.ok, false);

  const expired = verifyPersonalContextContract({
    contract: issued.contract,
    expectedTaskRef: 'ex-1',
    expectedIssuerSubjectId: 'subject-a',
    expectedRecipientSubjectId: 'subject-b',
    expectedRecipientEndpointRef: 'relay:peer-b',
    expectedPurpose: issued.contract.purpose,
    expectedDisclosure: issued.disclosure,
    now: '2026-11-22T08:16:00.000Z',
    grant: stored,
  });
  assert.equal(expired.ok, false);

  const revoked = { ...stored!, status: 'revoked' as const, revokedAt: '2026-11-22T08:06:00.000Z' };
  await (await GrantStore.open(root)).put(revoked);
  const revokedResult = verifyPersonalContextContract({
    contract: issued.contract,
    expectedTaskRef: 'ex-1',
    expectedIssuerSubjectId: 'subject-a',
    expectedRecipientSubjectId: 'subject-b',
    expectedRecipientEndpointRef: 'relay:peer-b',
    expectedPurpose: issued.contract.purpose,
    expectedDisclosure: issued.disclosure,
    now: '2026-11-22T08:07:00.000Z',
    grant: revoked,
  });
  assert.equal(revokedResult.ok, false);
});

test('Personal Context Contract 拒绝模型虚构字段和整份 Digital Self', async () => {
  const root = await tempDir('selection');
  const at = '2026-11-22T08:00:00.000Z';
  await writeDigitalSelf(root, selfFixture('subject-a', at));
  const base = {
    packageRoot: root,
    issuerSubjectId: 'subject-a',
    recipientSubjectId: 'subject-b',
    recipientEndpointRef: 'relay:peer-b',
    taskRef: 'ex-2',
    purpose: '最小披露测试',
    taskContext: '当前任务摘要',
    issuedAt: at,
  };
  await assert.rejects(
    () => issuePersonalContextContract({ ...base, understandingIds: ['u_invented'] }),
    /不存在可披露字段/,
  );
  await assert.rejects(
    () => issuePersonalContextContract({
      ...base,
      understandingIds: ['u_goal', 'u_private', 'u_pending'],
    }),
    /完整 Digital Self/,
  );
});

test('真实 deliver receipt 写入实际 digest、字节和接收端点，未选字段不进入披露审计', async () => {
  const root = await tempDir('audit');
  const at = '2026-11-22T08:00:00.000Z';
  await writeDigitalSelf(root, selfFixture('subject-a', at));
  const network = createInMemorySubjectNetwork();
  network.attach({
    subjectId: 'subject-b',
    getCard: async () => ({
      schemaVersion: 1,
      subjectId: 'subject-b',
      displayName: '安全协作者',
      endpointRef: 'memory:subject-b',
      publicSkills: [{ name: '工艺安全', summary: '给出低风险安全判断' }],
      cooperationScope: '低风险知识协作',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    }),
    handle: async (request) => ({
      exchangeId: request.exchangeId,
      fromSubjectId: request.toSubjectId,
      toSubjectId: request.fromSubjectId,
      at: request.at,
      decision: 'accept',
      reply: '可以合作。',
    }),
  });

  const result = await consultSubject({
    network,
    packageRoot: root,
    selfSubjectId: 'subject-a',
    threadId: 'thread-1',
    threadTurns: [{ role: 'user', text: '请找人评估方案。' }],
    selfContext: '当前 Digital Self 仅在本机。',
    now: at,
    subjectId: 'subject-b',
    goal: '评估工艺安全',
    hopedContribution: '给出低风险安全意见',
    disclosure: '只需评估方案，不需要个人地址。',
    contextUnderstandingIds: ['u_goal'],
  });
  assert.equal(result.ok, true);

  const events = await listExchanges(root);
  const sent = events.find((event) => event.kind === 'request_sent');
  assert.ok(sent?.disclosureAudit);
  assert.equal(sent!.disclosureAudit!.recipientEndpointRef, 'memory:subject-b');
  assert.ok(sent!.disclosureAudit!.actualBytes > 0);
  assert.equal(sent!.bodyDigest, sent!.disclosureAudit!.actualBodyDigest);
  assert.deepEqual(sent!.disclosureAudit!.fieldRefs, [
    `collaboration:task-context:${result.exchangeId}`,
    'digital-self:understanding:u_goal',
  ]);
  const auditJson = JSON.stringify(events);
  assert.equal(auditJson.includes('西湖区'), false);
  assert.equal(auditJson.includes('身份证复印件'), false);
  assert.equal(auditJson.includes('原始摘录'), false);
});
