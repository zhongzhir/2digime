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
  await invoke(input.initiator, 'subject.communicate', {
    action: 'continueInterest',
    opportunityId: sent.opportunityId,
  });
  await invoke(input.responder, 'subject.communicate', { action: 'listOpportunities' });
  await invoke(input.responder, 'subject.communicate', {
    action: 'continueInterest',
    opportunityId: responderOpportunityId,
  });
  await invoke(input.initiator, 'subject.communicate', { action: 'listOpportunities' });
  const started = (await invoke(input.initiator, 'subject.communicate', {
    action: 'startCollaboration',
    opportunityId: sent.opportunityId,
    intent: input.goal,
  })) as { recordId?: string };
  assert.ok(started.recordId);
  await invoke(input.responder, 'subject.communicate', { action: 'pullRemote' });
  return started.recordId;
}

async function deliverResult(responder: Page, initiator: Page, recordId: string) {
  const accepted = (await invoke(responder, 'collab.interact', {
    action: 'respond',
    recordId,
    decision: 'accept',
  })) as { status?: string };
  assert.ok(['agreed', 'authorized'].includes(String(accepted.status)), JSON.stringify(accepted));
  const fulfilled = (await invoke(responder, 'collab.interact', {
    action: 'fulfill',
    recordId,
  })) as { status?: string; artifactText?: string };
  assert.equal(fulfilled.status, 'delivered', JSON.stringify(fulfilled));
  assert.ok((fulfilled.artifactText || '').length >= 20, JSON.stringify(fulfilled));
  await invoke(initiator, 'subject.communicate', { action: 'pullRemote' });
}

function actionButton(row: import('playwright').Locator, label: string) {
  return row.locator('button').filter({ hasText: new RegExp(`^${label}$`) });
}

async function waitForRowCopy(page: Page, goal: string, expected: string) {
  await page.waitForFunction(
    `({ goal, expected }) => Array.from(document.querySelectorAll('.ds-collaboration-item')).some((row) =>
      (row.textContent || '').includes(goal) && (row.textContent || '').includes(expected)
    )`,
    { goal, expected },
  );
}

test('Slice 3-2C：协作成果可见，发起方可采用或退回且决定同步双方', { timeout: 420_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice3c-results-'));
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
    const initiator = initiatorApp.page;
    const responder = responderApp.page;
    await skipWelcomeAndEnterShell(initiator);
    await skipWelcomeAndEnterShell(responder);
    await initiator.setViewportSize({ width: 1280, height: 900 });

    const captured = (await invoke(responder, 'subject.captureInput', {
      text: '我擅长机构 Demo 和 PPT 的验收要点核对，也能共同准备产品 Roadshow Demo 材料并整理核对结果。',
      sourceKind: 'initial_self_description',
      captureKey: 'slice3c-responder-capability',
    })) as { candidateEventIds?: string[]; confirmedEventIds?: string[] };
    if ((captured.candidateEventIds || []).length) {
      await invoke(responder, 'subject.confirmExperience', {
        eventIds: captured.candidateEventIds,
      });
    }
    assert.ok((captured.candidateEventIds || []).length || (captured.confirmedEventIds || []).length);
    const responderEndpointRef = await pairSubjects(initiator, responder, relayUrl);

    const adoptedGoal = '共同整理机构 Demo 和 PPT 的验收结论';
    const adoptedRecordId = await proposeRemoteCollaboration({
      initiator,
      responder,
      responderEndpointRef,
      goal: adoptedGoal,
    });
    await deliverResult(responder, initiator, adoptedRecordId);

    await initiator.locator('#nav-subject').click();
    await waitForRowCopy(initiator, adoptedGoal, '需要你确认结果');
    const adoptedRow = initiator.locator('.ds-collaboration-item', { hasText: adoptedGoal });
    await actionButton(adoptedRow, '采用结果').waitFor({ state: 'visible' });
    await actionButton(adoptedRow, '退回结果').waitFor({ state: 'visible' });
    assert.match(await adoptedRow.innerText(), /结果：/);
    assert.equal(await actionButton(adoptedRow, '结束协作').count(), 0);

    await initiator.evaluate(`window.__slice3cConfirmMessages = []; window.confirm = (message) => {
      window.__slice3cConfirmMessages.push(String(message));
      return true;
    }`);
    await actionButton(adoptedRow, '采用结果').click();
    await initiator.locator('#ds-capability-notice').filter({ hasText: '已采用' }).waitFor({ state: 'visible' });
    await waitForRowCopy(initiator, adoptedGoal, '已完成');
    const adoptedStatus = (await invoke(initiator, 'collab.interact', {
      action: 'status',
      recordId: adoptedRecordId,
    })) as { status?: string; ownerDecision?: string };
    assert.equal(adoptedStatus.status, 'completed');
    assert.equal(adoptedStatus.ownerDecision, 'accept');
    await invoke(responder, 'subject.communicate', { action: 'pullRemote' });
    const adoptedPeerStatus = (await invoke(responder, 'collab.interact', {
      action: 'status',
      recordId: adoptedRecordId,
    })) as { status?: string; ownerDecision?: string };
    assert.equal(adoptedPeerStatus.status, 'completed');
    assert.equal(adoptedPeerStatus.ownerDecision, 'accept');

    const returnedGoal = '共同准备下一次产品 Roadshow Demo 复盘';
    const returnedRecordId = await proposeRemoteCollaboration({
      initiator,
      responder,
      responderEndpointRef,
      goal: returnedGoal,
    });
    await deliverResult(responder, initiator, returnedRecordId);
    await initiator.locator('#nav-chat').click();
    await initiator.locator('#nav-subject').click();
    await waitForRowCopy(initiator, returnedGoal, '需要你确认结果');
    const returnedRow = initiator.locator('.ds-collaboration-item', { hasText: returnedGoal });
    await actionButton(returnedRow, '退回结果').click();
    await initiator.locator('#ds-capability-notice').filter({ hasText: '已退回' }).waitFor({ state: 'visible' });
    await waitForRowCopy(initiator, returnedGoal, '结果已退回');
    const returnedStatus = (await invoke(initiator, 'collab.interact', {
      action: 'status',
      recordId: returnedRecordId,
    })) as { status?: string; ownerDecision?: string };
    assert.equal(returnedStatus.status, 'rejected');
    assert.equal(returnedStatus.ownerDecision, 'reject');
    await invoke(responder, 'subject.communicate', { action: 'pullRemote' });
    const returnedPeerStatus = (await invoke(responder, 'collab.interact', {
      action: 'status',
      recordId: returnedRecordId,
    })) as { status?: string; ownerDecision?: string };
    assert.equal(returnedPeerStatus.status, 'rejected');
    assert.equal(returnedPeerStatus.ownerDecision, 'reject');

    const prompts = (await initiator.evaluate(`window.__slice3cConfirmMessages`)) as string[];
    assert.equal(prompts.length, 2);
    assert.match(prompts[0] || '', /确认采用/);
    assert.match(prompts[1] || '', /确认退回/);
    assert.ok(prompts.every((message) => !/record|grant|A2A|exchange/i.test(message)));
    assert.equal(
      await initiator.locator('#ds-capability-panel').innerText().then((text) =>
        /record|grant|A2A|exchange/i.test(text),
      ),
      false,
    );

    await initiator.screenshot({
      path: path.join(os.tmpdir(), 'digital-self-slice3c-collaboration-results.png'),
      fullPage: true,
    });
  } finally {
    await responderApp.close();
    await initiatorApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
