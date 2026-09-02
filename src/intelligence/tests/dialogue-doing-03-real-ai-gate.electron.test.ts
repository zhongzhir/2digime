/**
 * Phase 2 第一薄片最终产品闸门：正式 Electron + 真实模型 + 真实 Professional Agent。
 * 不使用 talk stub / fake document / 直接改 Thread。不改产品语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_dialogue-doing-03-real-ai-gate');
const TALK_TRACE = path.join(EVIDENCE, 'raw-talk');
const SELF_TRACE = path.join(EVIDENCE, 'raw-digital-self');
const RUNS_COPY = path.join(EVIDENCE, 'agent-runs');

const PREFERENCE =
  '我上午习惯先处理最重要的两三件事，备忘只写短句，不要长段落。';

async function openDigitalSelf(page: Page): Promise<void> {
  await page.locator('#nav-subject').waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-subject').dispatchEvent('click');
    const visible = await page.locator('#panel-subject').isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(400);
  }
  await page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 15_000 });
}

async function openTalk(page: Page): Promise<void> {
  await page.locator('#nav-chat').waitFor({ state: 'visible', timeout: 20_000 });
  const sendVisible = await page.locator('#btn-chat-send').isVisible().catch(() => false);
  if (sendVisible) return;
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-chat').dispatchEvent('click');
    const visible = await page.locator('#btn-chat-send').isVisible().catch(() => false);
    if (visible) return;
    await page.waitForTimeout(400);
  }
  await page.locator('#panel-chat').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#btn-chat-send').waitFor({ state: 'visible', timeout: 15_000 });
}

async function tellReal(page: Page, text: string): Promise<void> {
  await openDigitalSelf(page);
  await page.locator('#btn-ds-tell').click();
  await page.locator('#ds-tell-form').waitFor({ state: 'visible' });
  await page.locator('#ds-tell-input').fill(text);
  await page.locator('#btn-ds-tell-submit').click();
  await page.locator('#ds-tell-form').waitFor({ state: 'hidden', timeout: 180_000 });
}

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string): Promise<void> {
  await openTalk(page);
  const before = await talkTurnCount(page);
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + 400_000;
  while (Date.now() < deadline) {
    if ((await talkTurnCount(page)) > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

async function dumpScene(page: Page, id: string, input: string): Promise<{
  uiText: string;
  view: unknown;
}> {
  await openTalk(page);
  const uiText = await page.locator('#panel-chat').innerText();
  const view = await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`);
  await page.screenshot({ path: path.join(EVIDENCE, `${id}.png`), fullPage: true });
  await fs.writeFile(
    path.join(EVIDENCE, `${id}.json`),
    `${JSON.stringify({ id, input, uiText, view }, null, 2)}\n`,
    'utf8',
  );
  return { uiText, view };
}

async function copyPackageEvidence(page: Page, tag: string): Promise<{
  dir: string;
  self: unknown;
  thread: unknown;
}> {
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  const dir = loc.dir;
  const selfPath = path.join(dir, 'digital-self', 'self.json');
  const threadPath = path.join(dir, 'intelligence', 'thread.json');
  let self: unknown = null;
  let thread: unknown = null;
  try {
    self = JSON.parse(await fs.readFile(selfPath, 'utf8'));
  } catch {
    self = { missing: true };
  }
  try {
    thread = JSON.parse(await fs.readFile(threadPath, 'utf8'));
  } catch {
    thread = { missing: true };
  }
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}-self.json`),
    `${JSON.stringify(self, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}-thread.json`),
    `${JSON.stringify(thread, null, 2)}\n`,
    'utf8',
  );
  const runsDir = path.join(dir, 'intelligence', 'runs');
  try {
    const execs = await fs.readdir(runsDir);
    await fs.mkdir(RUNS_COPY, { recursive: true });
    for (const execId of execs) {
      const src = path.join(runsDir, execId, 'result.md');
      try {
        const body = await fs.readFile(src, 'utf8');
        await fs.writeFile(path.join(RUNS_COPY, `${tag}-${execId}.md`), body, 'utf8');
      } catch {
        /* no result file */
      }
    }
  } catch {
    /* no runs yet */
  }
  return { dir, self, thread };
}

function lastAssistant(view: unknown): string {
  const turns = (view as { view?: { turns?: Array<{ role: string; text: string }> } })?.view?.turns
    || (view as { turns?: Array<{ role: string; text: string }> })?.turns
    || [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role === 'assistant') return String(turns[i]?.text || '');
  }
  return '';
}

function looksLikeDump(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const bulletish = lines.filter((l) => /^[-*·]/.test(l) || /^[0-9]+[.)]/.test(l));
  return bulletish.length >= 4 && bulletish.length >= lines.length * 0.6;
}

async function enterProductShell(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const shell = await page.locator('#view-shell').isVisible().catch(() => false);
    const input = await page.locator('#chat-input').isVisible().catch(() => false);
    if (shell && input) return;
    for (const id of ['btn-welcome-skip-model', 'btn-welcome-skip-model-2', 'btn-create-skip']) {
      const btn = page.locator(`#${id}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(600);
      }
    }
    await page.waitForTimeout(400);
  }
  await skipWelcomeAndEnterShell(page);
}

test('Electron 真实模型闸门：交流 / 做事 / 换说法 / 缺信息 / 无能力', { timeout: 1_800_000 }, async () => {
  await fs.mkdir(TALK_TRACE, { recursive: true });
  await fs.mkdir(SELF_TRACE, { recursive: true });
  await fs.mkdir(RUNS_COPY, { recursive: true });

  const harness = await launchDigitalMeElectron({
    realProduct: true,
    useAppUserData: true,
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
      DIGITALME_V2_DIGITAL_SELF_TRACE_DIR: SELF_TRACE,
      DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE,
    },
  });

  const results: Record<string, unknown> = {
    stubForcedOff: true,
    usedAppUserData: true,
  };

  try {
    await enterProductShell(harness.page);
    const status = await harness.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`);
    const caps = await harness.page.evaluate(`(async () => {
      return window.digitalMe.invoke('capability.list', { includeAvailability: true });
    })()`);
    results.model = status;
    results.capabilities = (caps as { capabilities?: Array<{ id: string; displayName: string; availability?: string }> })
      .capabilities
      ?.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        availability: c.availability,
      }));
    await fs.writeFile(
      path.join(EVIDENCE, 'model-status.json'),
      `${JSON.stringify({ status, capabilities: results.capabilities }, null, 2)}\n`,
      'utf8',
    );

    const modelReady = !!(status as { modelReady?: boolean }).modelReady;
    const electronTest = (status as { electronTest?: boolean }).electronTest === true;
    const fakeCap = ((results.capabilities as Array<{ id: string }>) || []).some(
      (c) => c.id === 'cap_fake_document',
    );
    assert.equal(modelReady, true, '真实模型未接通');
    assert.equal(electronTest, false, '不应走 Electron test harness');
    assert.equal(fakeCap, false, '产品闸门不得注册 fake document');

    await tellReal(harness.page, PREFERENCE);
    await openDigitalSelf(harness.page);
    await harness.page.screenshot({
      path: path.join(EVIDENCE, '00-digital-self.png'),
      fullPage: true,
    });
    const selfDump = await harness.page.evaluate(`(async () => {
      return window.digitalMe.invoke('digitalSelf', { action: 'read' });
    })()`);
    await fs.writeFile(
      path.join(EVIDENCE, '00-digital-self.json'),
      `${JSON.stringify(selfDump, null, 2)}\n`,
      'utf8',
    );

    await sendTalk(harness.page, '你现在了解我什么？');
    const a = await dumpScene(harness.page, 'A-chat', '你现在了解我什么？');
    const aText = lastAssistant(a.view);
    results.A = {
      input: '你现在了解我什么？',
      reply: aText,
      mentionsPreference: /上午|短句|两三件|重要/.test(aText),
      mechanicalDump: looksLikeDump(aText),
      leakedJob: /Job|capability|adapter|cap_/.test(aText),
    };
    await copyPackageEvidence(harness.page, 'A');

    await sendTalk(harness.page, '帮我写一份明天上午三件最重要事情的简短备忘。');
    const b = await dumpScene(
      harness.page,
      'B-doing',
      '帮我写一份明天上午三件最重要事情的简短备忘。',
    );
    const bText = lastAssistant(b.view);
    results.B = {
      input: '帮我写一份明天上午三件最重要事情的简短备忘。',
      reply: bText,
      leakedJob: /Job|cap_fake_document|capability id/.test(bText),
    };
    const afterB = await copyPackageEvidence(harness.page, 'B');
    results.B = {
      ...(results.B as object),
      executions: (afterB.thread as { executions?: unknown[] })?.executions || [],
    };

    await sendTalk(harness.page, '请整理一份明早要盯的三件要事，写成短备忘就行。');
    const c = await dumpScene(
      harness.page,
      'C-paraphrase',
      '请整理一份明早要盯的三件要事，写成短备忘就行。',
    );
    results.C = {
      input: '请整理一份明早要盯的三件要事，写成短备忘就行。',
      reply: lastAssistant(c.view),
    };
    await copyPackageEvidence(harness.page, 'C');

    await sendTalk(harness.page, '帮我写一封给李明的项目会邀请邮件。');
    const d1 = await dumpScene(
      harness.page,
      'D1-missing-info',
      '帮我写一封给李明的项目会邀请邮件。',
    );
    const afterD1 = await copyPackageEvidence(harness.page, 'D1');
    results.D1 = {
      input: '帮我写一封给李明的项目会邀请邮件。',
      reply: lastAssistant(d1.view),
      openGoal: (afterD1.thread as { openGoal?: string })?.openGoal || null,
      askedTime: /时间|几点|何时|什么时候/.test(lastAssistant(d1.view)),
    };

    await sendTalk(harness.page, '明天下午三点。');
    const d2 = await dumpScene(harness.page, 'D2-continue', '明天下午三点。');
    const afterD2 = await copyPackageEvidence(harness.page, 'D2');
    results.D2 = {
      input: '明天下午三点。',
      reply: lastAssistant(d2.view),
      openGoal: (afterD2.thread as { openGoal?: string })?.openGoal || null,
      sameThread: (afterD2.thread as { threadId?: string })?.threadId === 'default',
      executions: (afterD2.thread as { executions?: unknown[] })?.executions || [],
    };

    await sendTalk(harness.page, '把这封邮件直接发给李明。');
    const e = await dumpScene(harness.page, 'E-no-capability', '把这封邮件直接发给李明。');
    const afterE = await copyPackageEvidence(harness.page, 'E');
    const eText = lastAssistant(e.view);
    results.E = {
      input: '把这封邮件直接发给李明。',
      reply: eText,
      pretendedSend: /已经发给|已发送|发送成功|已经把邮件发出/.test(eText),
      executionsAfter: (afterE.thread as { executions?: unknown[] })?.executions || [],
    };

    const talkRaws = (await fs.readdir(TALK_TRACE)).filter((n) => n.endsWith('.json'));
    const selfRaws = (await fs.readdir(SELF_TRACE)).filter((n) => n.endsWith('.json'));
    const talkMeta = [];
    let anyStub = false;
    for (const name of talkRaws) {
      const parsed = JSON.parse(await fs.readFile(path.join(TALK_TRACE, name), 'utf8')) as {
        stub?: boolean;
        kind?: string;
        model?: string;
        providerHost?: string;
        toolCalls?: Array<{ function?: { name?: string }; name?: string }>;
        text?: string;
      };
      if (parsed.stub === true) anyStub = true;
      talkMeta.push({
        file: name,
        stub: parsed.stub === true,
        kind: parsed.kind || null,
        model: parsed.model || null,
        providerHost: parsed.providerHost || null,
        toolCallNames: (parsed.toolCalls || []).map((c) => c.function?.name || c.name || null),
        textChars: String(parsed.text || '').length,
      });
    }
    results.rawTalk = talkMeta;
    results.rawDigitalSelfCount = selfRaws.length;
    results.anyStub = anyStub;
    await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');

    assert.equal(anyStub, false, '检测到测试双参与');
    assert.equal(talkRaws.length > 0, true, '没有 talk 真实模型原始返回');
    assert.equal(selfRaws.length > 0, true, '没有 Digital Self 真实模型原始返回');
  } catch (err) {
    try {
      const body = await harness.page.locator('body').innerText().catch(() => '');
      await fs.writeFile(
        path.join(EVIDENCE, 'error.json'),
        `${JSON.stringify(
          {
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : null,
            body: body.slice(0, 8000),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await Promise.race([
      harness.close(),
      new Promise((resolve) => {
        setTimeout(resolve, 8000);
      }),
    ]);
  }
});
