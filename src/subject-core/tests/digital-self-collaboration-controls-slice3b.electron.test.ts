import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';

const STUB_ENV = { DIGITALME_V2_DIGITAL_SELF_STUB: '1' };

async function waitForRowCopy(page: import('playwright').Page, goal: string, expected: string) {
  await page.waitForFunction(
    `({ goal, expected }) => Array.from(document.querySelectorAll('.ds-collaboration-item')).some((row) =>
      (row.textContent || '').includes(goal) && (row.textContent || '').includes(expected)
    )`,
    { goal, expected },
  );
}

function actionButton(row: import('playwright').Locator, label: string) {
  return row.locator('button').filter({ hasText: new RegExp(`^${label}$`) });
}

async function invoke(page: Page, name: string, input: Record<string, unknown> = {}) {
  return page.evaluate(`window.digitalMe.invoke(${JSON.stringify(name)}, ${JSON.stringify(input)})`);
}

async function listenRelay(dataDir: string): Promise<{ server: Server; relayUrl: string }> {
  await fs.mkdir(dataDir, { recursive: true });
  const { server } = createRelayServer({
    store: new FileRelayStore(dataDir),
    host: '127.0.0.1',
    port: 0,
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('relay did not expose a port'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${port}` };
}

async function pairSubjects(a: Page, b: Page, relayUrl: string): Promise<string> {
  await invoke(a, 'subject.communicate', { action: 'configureRelay', relayUrl });
  await invoke(b, 'subject.communicate', { action: 'configureRelay', relayUrl });
  const invite = (await invoke(a, 'subject.communicate', { action: 'createInvite' })) as {
    inviteJson?: string;
  };
  const reply = (await invoke(b, 'subject.communicate', {
    action: 'acceptInvite',
    inviteJson: invite.inviteJson,
  })) as { inviteJson?: string };
  await invoke(a, 'subject.communicate', {
    action: 'acceptInvite',
    inviteJson: reply.inviteJson,
  });
  const peers = (await invoke(a, 'subject.communicate', { action: 'listPeers' })) as {
    peers?: Array<{ endpointRef?: string }>;
  };
  const endpointRef = peers.peers?.[0]?.endpointRef;
  assert.ok(endpointRef);
  return endpointRef;
}

async function proposeRemoteCollaboration(input: {
  initiator: Page;
  responder: Page;
  responderEndpointRef: string;
  goal: string;
}): Promise<string> {
  const before = (await invoke(input.responder, 'subject.communicate', {
    action: 'listOpportunities',
  })) as { items?: Array<{ id?: string }> };
  const existingIds = new Set((before.items || []).map((item) => item.id).filter(Boolean));
  const sent = (await invoke(input.initiator, 'subject.communicate', {
    action: 'sendSignal',
    peerEndpointRef: input.responderEndpointRef,
    signal: {
      intent: input.goal,
      seeking: [input.goal],
      offering: ['共同整理并核对结果'],
      disclosureLevel: 'minimal',
    },
  })) as { opportunityId?: string };
  assert.ok(sent.opportunityId);
  const opportunityId = sent.opportunityId;
  const responderListed = (await invoke(input.responder, 'subject.communicate', {
    action: 'listOpportunities',
  })) as { items?: Array<{ id?: string }> };
  const responderOpportunityId = responderListed.items?.find(
    (item) => item.id && !existingIds.has(item.id),
  )?.id;
  assert.ok(responderOpportunityId, JSON.stringify(responderListed));
  await invoke(input.responder, 'subject.communicate', {
    action: 'continueInterest',
    opportunityId: responderOpportunityId,
  });
  await invoke(input.initiator, 'subject.communicate', { action: 'listOpportunities' });
  await invoke(input.initiator, 'subject.communicate', { action: 'continueInterest', opportunityId });
  await invoke(input.responder, 'subject.communicate', { action: 'listOpportunities' });
  await invoke(input.responder, 'subject.communicate', {
    action: 'continueInterest',
    opportunityId: responderOpportunityId,
  });
  await invoke(input.initiator, 'subject.communicate', { action: 'listOpportunities' });
  const started = (await invoke(input.initiator, 'subject.communicate', {
    action: 'startCollaboration',
    opportunityId,
    intent: input.goal,
  })) as { recordId?: string };
  assert.ok(started.recordId);
  await invoke(input.responder, 'subject.communicate', { action: 'pullRemote' });
  return started.recordId;
}

test('Slice 3B：收到请求可接受/拒绝，已建立协作可结束且事实来自原记录', { timeout: 420_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice3b-controls-'));
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const initiatorApp = await launchDigitalMeElectron({
    userData: path.join(root, 'initiator-user-data'),
    extraEnv: STUB_ENV,
  });
  const responderApp = await launchDigitalMeElectron({
    userData: path.join(root, 'responder-user-data'),
    extraEnv: STUB_ENV,
  });
  try {
    await skipWelcomeAndEnterShell(initiatorApp.page);
    const { page } = responderApp;
    await skipWelcomeAndEnterShell(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const captured = (await invoke(page, 'subject.captureInput', {
      text: '我擅长机构 Demo 和 PPT 的验收要点核对，也能共同准备产品 Roadshow Demo 材料并整理核对结果。',
      sourceKind: 'initial_self_description',
      captureKey: 'slice3b-responder-capability',
    })) as { candidateEventIds?: string[]; confirmedEventIds?: string[] };
    const candidateEventIds = captured.candidateEventIds || [];
    if (candidateEventIds.length) {
      await invoke(page, 'subject.confirmExperience', { eventIds: candidateEventIds });
    }
    assert.ok(candidateEventIds.length || (captured.confirmedEventIds || []).length);
    const responderEndpointRef = await pairSubjects(initiatorApp.page, page, relayUrl);

    const acceptedGoal = '共同核对机构 Demo 和 PPT 的验收要点';
    const acceptedRecordId = await proposeRemoteCollaboration({
      initiator: initiatorApp.page,
      responder: page,
      responderEndpointRef,
      goal: acceptedGoal,
    });

    await page.locator('#nav-subject').click();
    await waitForRowCopy(page, acceptedGoal, '待你确认协作');
    const acceptedRow = page.locator('.ds-collaboration-item', { hasText: acceptedGoal });
    await actionButton(acceptedRow, '接受').waitFor({ state: 'visible' });
    assert.equal(await actionButton(acceptedRow, '接受').count(), 1);
    assert.equal(await actionButton(acceptedRow, '拒绝').count(), 1);
    assert.match(await acceptedRow.innerText(), /对方发来/);
    assert.match(await acceptedRow.innerText(), /本次没有文件材料/);

    await page.evaluate(`window.__slice3bConfirmMessages = []; window.confirm = (message) => {
      window.__slice3bConfirmMessages.push(String(message));
      return true;
    }`);
    await actionButton(acceptedRow, '接受').click();
    await page.locator('#ds-capability-notice').filter({ hasText: '已接受' }).waitFor({ state: 'visible' });
    await waitForRowCopy(page, acceptedGoal, '协作已建立');
    const afterAccept = (await page.evaluate(`window.digitalMe.invoke('collab.interact', {
      action: 'status', recordId: ${JSON.stringify(acceptedRecordId)}
    })`)) as { status?: string };
    assert.ok(
      ['agreed', 'authorized'].includes(String(afterAccept.status)),
      JSON.stringify(afterAccept),
    );

    const activeRow = page.locator('.ds-collaboration-item', { hasText: acceptedGoal });
    await actionButton(activeRow, '结束协作').waitFor({ state: 'visible' });
    await actionButton(activeRow, '结束协作').click();
    await page.locator('#ds-capability-notice').filter({ hasText: '已结束' }).waitFor({ state: 'visible' });
    await waitForRowCopy(page, acceptedGoal, '已结束');
    const afterStop = (await page.evaluate(`window.digitalMe.invoke('collab.interact', {
      action: 'status', recordId: ${JSON.stringify(acceptedRecordId)}
    })`)) as { status?: string };
    assert.equal(afterStop.status, 'revoked');
    await invoke(initiatorApp.page, 'subject.communicate', { action: 'pullRemote' });
    const initiatorAfterStop = (await invoke(initiatorApp.page, 'collab.interact', {
      action: 'status',
      recordId: acceptedRecordId,
    })) as { status?: string };
    assert.equal(initiatorAfterStop.status, 'revoked');

    const rejectedGoal = '共同准备下一次产品 Roadshow Demo 材料';
    const rejectedRecordId = await proposeRemoteCollaboration({
      initiator: initiatorApp.page,
      responder: page,
      responderEndpointRef,
      goal: rejectedGoal,
    });
    await page.locator('#nav-chat').click();
    await page.locator('#nav-subject').click();
    await waitForRowCopy(page, rejectedGoal, '待你确认协作');
    const rejectedRow = page.locator('.ds-collaboration-item', { hasText: rejectedGoal });
    await actionButton(rejectedRow, '拒绝').waitFor({ state: 'visible' });
    await actionButton(rejectedRow, '拒绝').click();
    await page.locator('#ds-capability-notice').filter({ hasText: '已拒绝' }).waitFor({ state: 'visible' });
    await waitForRowCopy(page, rejectedGoal, '暂未建立协作');
    const afterReject = (await page.evaluate(`window.digitalMe.invoke('collab.interact', {
      action: 'status', recordId: ${JSON.stringify(rejectedRecordId)}
    })`)) as { status?: string };
    assert.equal(afterReject.status, 'rejected');
    await invoke(initiatorApp.page, 'subject.communicate', { action: 'pullRemote' });
    const initiatorAfterReject = (await invoke(initiatorApp.page, 'collab.interact', {
      action: 'status',
      recordId: rejectedRecordId,
    })) as { status?: string };
    assert.equal(initiatorAfterReject.status, 'rejected');

    const prompts = (await page.evaluate(`window.__slice3bConfirmMessages`)) as string[];
    assert.equal(prompts.length, 3);
    assert.ok(prompts.every((message) => !/record|grant|A2A|exchange/i.test(message)));
    assert.match(prompts[0] || '', /确认接受/);
    assert.match(prompts[1] || '', /确认结束/);
    assert.match(prompts[2] || '', /确认拒绝/);
    assert.equal(await page.locator('#ds-capability-panel').innerText().then((text) => /record|grant|A2A|exchange/i.test(text)), false);

    await page.screenshot({
      path: path.join(os.tmpdir(), 'digital-self-slice3b-collaboration-controls.png'),
      fullPage: true,
    });
  } finally {
    await responderApp.close();
    await initiatorApp.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
