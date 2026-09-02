/**
 * 两个正式 Electron + 两套独立 userData / Package。
 * 配对走 invite；B 窗口自己收件，测试不得调用 B.drain。
 */
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
  REPO_ROOT,
} from '../../runtime/tests/electron-harness';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import {
  PUBLIC_CARD_SCHEMA_VERSION,
  listExchanges,
  writePublicCard,
} from '../../subject-collab';
import { talkThreadFilePath } from '../store';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { InboxStore } from '../../subject-comm/inbox-store';
import { isSubjectCollabPayload } from '../../subject-comm/envelope';

const STUB_ENV = {
  DIGITALME_V2_DIGITAL_SELF_STUB: '1',
  DIGITALME_V2_TALK_STUB: '1',
};

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_collab-03-two-owner-trial-evidence');

const SCENARIO =
  '帮我分析这个化工厂局部改造方案。如果需要，可以找更懂工艺安全的人补充判断。';

async function invoke(page: Page, name: string, input: Record<string, unknown> = {}) {
  return page.evaluate(`(async () => {
    return window.digitalMe.invoke(${JSON.stringify(name)}, ${JSON.stringify(input)});
  })()`);
}

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await invoke(page, 'talk', {})) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string, timeoutMs = 90_000): Promise<string> {
  const before = await talkTurnCount(page);
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await talkTurnCount(page)) > before) {
      return page.locator('#chat-turns').innerText();
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`talk 未增加回合：${text}`);
}

async function listenRelay(dataDir: string): Promise<{ server: Server; relayUrl: string; dataDir: string }> {
  await fs.mkdir(dataDir, { recursive: true });
  const store = new FileRelayStore(dataDir);
  const { server } = createRelayServer({ store, host: '127.0.0.1', port: 0 });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}`, dataDir };
}

async function seedSelf(
  rootDir: string,
  subjectId: string,
  items: Array<{ text: string; facet?: 'about_me' | 'boundaries' }>,
): Promise<void> {
  const now = new Date().toISOString();
  await writeDigitalSelf(rootDir, {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: items.map((item, index) => ({
      id: `u_${index + 1}`,
      text: item.text,
      facet: item.facet || 'about_me',
      status: 'current' as const,
      confirmed: true,
      provenance: { origin: 'user_statement' as const, actor: 'owner' as const, statedAt: now },
      updatedAt: now,
    })),
  });
}

async function packageInfo(page: Page): Promise<{ subjectId: string; dir: string; displayName: string }> {
  const overview = (await invoke(page, 'subject.getOverview', {})) as {
    subjectId: string;
    displayName: string;
  };
  const loc = (await page.evaluate(`(async () => window.digitalMe.getDefaultSubjectDir())()`)) as {
    dir: string;
  };
  return { subjectId: overview.subjectId, dir: loc.dir, displayName: overview.displayName };
}

function redact(value: unknown): unknown {
  const raw = JSON.stringify(value);
  const stripped = raw
    .replace(/BEGIN [A-Z ]+PRIVATE KEY[\s\S]*?END [A-Z ]+PRIVATE KEY/g, '[redacted-key]')
    .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/[A-Za-z]:\\\\Users\\\\[^"\\]+/g, '[redacted-path]')
    .replace(/\/Users\/[^"/]+/g, '[redacted-path]');
  return JSON.parse(stripped) as unknown;
}

test('两个正式 Electron：B 自主收件、拒绝后恢复、再合作；Owner B 不点接受', { timeout: 240_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-two-owner-el-'));
  const { server, relayUrl, dataDir } = await listenRelay(path.join(root, 'relay'));
  const aUd = path.join(root, 'ud-a');
  const bUd = path.join(root, 'ud-b');
  const aApp = await launchDigitalMeElectron({ userData: aUd, extraEnv: STUB_ENV });
  const bApp = await launchDigitalMeElectron({ userData: bUd, extraEnv: STUB_ENV });
  try {
    await skipWelcomeAndEnterShell(aApp.page);
    await skipWelcomeAndEnterShell(bApp.page);
    assert.equal(await aApp.page.locator('#nav-collab').isVisible().catch(() => false), false);
    assert.equal(await bApp.page.locator('#nav-collab').isVisible().catch(() => false), false);

    const aPkg = await packageInfo(aApp.page);
    const bPkg = await packageInfo(bApp.page);
    assert.notEqual(aPkg.dir, bPkg.dir);
    assert.notEqual(aPkg.subjectId, bPkg.subjectId);

    await seedSelf(aPkg.dir, aPkg.subjectId, [
      { text: '我在做化工厂局部改造，需要可行性判断，自己不是工艺安全专家。' },
    ]);
    await seedSelf(bPkg.dir, bPkg.subjectId, [
      { text: '我写现代诗，不处理工程安全评估。' },
      { text: '不承担工程安全合作。', facet: 'boundaries' },
      { text: '私人住址是西湖区某某路88号，不得外发。', facet: 'boundaries' },
    ]);
    await writePublicCard(bPkg.dir, {
      schemaVersion: PUBLIC_CARD_SCHEMA_VERSION,
      subjectId: bPkg.subjectId,
      displayName: '工艺安全协作者',
      endpointRef: `local:${bPkg.subjectId}`,
      publicSkills: [{ name: '工艺安全审阅', summary: '可做低风险工艺安全可行性判断。' }],
      cooperationScope: '低风险知识与判断合作。',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    });

    await invoke(aApp.page, 'subject.communicate', { action: 'configureRelay', relayUrl });
    await invoke(bApp.page, 'subject.communicate', { action: 'configureRelay', relayUrl });
    const inviteA = (await invoke(aApp.page, 'subject.communicate', { action: 'createInvite' })) as {
      inviteJson?: string;
    };
    const accepted = (await invoke(bApp.page, 'subject.communicate', {
      action: 'acceptInvite',
      inviteJson: inviteA.inviteJson,
    })) as { inviteJson?: string };
    await invoke(aApp.page, 'subject.communicate', {
      action: 'acceptInvite',
      inviteJson: accepted.inviteJson,
    });
    await aApp.page.waitForTimeout(1200);

    const declined = await sendTalk(aApp.page, SCENARIO);
    assert.match(declined, /这次合作没有成立|超出我目前愿意承担|无法合作/);
    assert.equal(/合作已经完成，对方已经接受/.test(declined), false);
    assert.equal(declined.includes('西湖区某某路88号'), false);

    const bTurnsBefore = await talkTurnCount(bApp.page);
    assert.equal(bTurnsBefore, 0);
    assert.equal(await bApp.page.locator('#btn-collab-detail-respond-accept').isVisible().catch(() => false), false);

    await seedSelf(bPkg.dir, bPkg.subjectId, [
      { text: '我长期做化工工艺安全评估，可做低风险技术可行性判断。' },
      { text: '私人住址是西湖区某某路88号，不得外发。', facet: 'boundaries' },
    ]);
    await aApp.page.waitForTimeout(400);

    const acceptedCopy = await sendTalk(aApp.page, SCENARIO);
    assert.match(acceptedCopy, /工艺安全|物料平衡|补充判断/);
    assert.equal(acceptedCopy.includes('西湖区某某路88号'), false);
    assert.equal(await talkTurnCount(bApp.page), 0);

    const aEx = await listExchanges(aPkg.dir);
    const bEx = await listExchanges(bPkg.dir);
    assert.ok(bEx.some((item) => item.kind === 'request_received'));
    assert.ok(bEx.some((item) => item.peerDecision === 'decline'));
    assert.ok(aEx.some((item) => item.kind === 'response_received' && item.peerDecision === 'accept'));
    assert.equal(JSON.stringify([...aEx, ...bEx]).includes('NEGOTIATING'), false);
    assert.equal(JSON.stringify([...aEx, ...bEx]).includes('CollabUserStatus'), false);

    const aThread = JSON.parse(await fs.readFile(talkThreadFilePath(aPkg.dir), 'utf8')) as {
      executions?: unknown[];
      turns?: Array<{ role: string }>;
    };
    assert.equal((aThread.executions || []).length, 0);
    assert.ok((aThread.turns || []).some((turn) => turn.role === 'assistant'));

    const inbox = await InboxStore.open(bPkg.dir);
    const collab = (await inbox.list()).filter((env) => env.kind === 'subject_collab');
    assert.ok(collab.some((env) => isSubjectCollabPayload(env.payload) && env.payload.wire === 'collab_request'));

    const aStatus = (await aApp.page.evaluate(`(async () => window.digitalMe.getModelStatus())()`)) as {
      legacyWorkRuntimeAttached?: boolean;
    };
    const bStatus = (await bApp.page.evaluate(`(async () => window.digitalMe.getModelStatus())()`)) as {
      legacyWorkRuntimeAttached?: boolean;
    };
    assert.equal(!!aStatus.legacyWorkRuntimeAttached, false);
    assert.equal(!!bStatus.legacyWorkRuntimeAttached, false);

    await fs.mkdir(EVIDENCE, { recursive: true });
    const peersA = JSON.parse(
      await fs.readFile(path.join(aPkg.dir, 'collaboration', 'peers.json'), 'utf8'),
    ) as { self?: { subjectId?: string; displayName?: string; endpointId?: string }; peers?: unknown };
    const peersB = JSON.parse(
      await fs.readFile(path.join(bPkg.dir, 'collaboration', 'peers.json'), 'utf8'),
    ) as { self?: { subjectId?: string; displayName?: string; endpointId?: string }; peers?: unknown };
    let relayBlob = '';
    try {
      const names = await fs.readdir(path.join(dataDir, 'envelopes'));
      for (const name of names.filter((item) => item.endsWith('.json')).slice(0, 8)) {
        relayBlob += await fs.readFile(path.join(dataDir, 'envelopes', name), 'utf8');
      }
    } catch {
      relayBlob = '';
    }
    assert.match(relayBlob, /sealed/);
    assert.equal(relayBlob.includes('西湖区某某路88号'), false);
    assert.equal(relayBlob.includes('"understandings"'), false);

    const verdict = {
      task: '2DIGIME-COLLABORATION-03-TWO-OWNER-REAL-TRIAL',
      engineeringPass: true,
      productPass: false,
      productPassBlockedBy: '需要两个真人 Owner 在各自正式实例上完成同一场景；本闸门为双 Electron 工程证明。',
      packageIds: { a: aPkg.subjectId, b: bPkg.subjectId },
      peerIdentity: redact({
        a: { subjectId: peersA.self?.subjectId, displayName: peersA.self?.displayName, endpointId: peersA.self?.endpointId },
        b: { subjectId: peersB.self?.subjectId, displayName: peersB.self?.displayName, endpointId: peersB.self?.endpointId },
      }),
      bAutonomousInbox: true,
      aDidNotDriveBRuntime: true,
      ownerBDidNotClickAccept: true,
      noCollabStateMachine: true,
      noLegacyWorkRuntime: true,
      relaySealed: /sealed/.test(relayBlob),
      aThreadAssistant: acceptedCopy.slice(0, 400),
      declinedPreview: declined.slice(0, 400),
    };
    await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
    await fs.writeFile(
      path.join(EVIDENCE, 'exchanges.json'),
      `${JSON.stringify(redact({ a: aEx, b: bEx }), null, 2)}\n`,
      'utf8',
    );
  } finally {
    await aApp.close();
    await bApp.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
