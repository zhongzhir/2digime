/**
 * 2DIGIME-TALK-WORK-COMPLETION-STABILITY-01 真实闸门。
 * stub=false，真实 DeepSeek + 真实搜索/工具链。不针对问句写硬编码答案。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_talk-work-completion-stability-01');
const TALK_TRACE = path.join(EVIDENCE, 'raw-talk');

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

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string, waitMs = 800_000): Promise<void> {
  const before = await talkTurnCount(page);
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkTurnCount(page)) > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function lastAssistantTurn(view: unknown): { text: string; resultTitle?: string } {
  const turns =
    (view as { view?: { turns?: Array<{ role: string; text: string; result?: { title?: string } }> } })?.view
      ?.turns ||
    (view as { turns?: Array<{ role: string; text: string; result?: { title?: string } }> })?.turns ||
    [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role === 'assistant') {
      const title = turns[i]?.result?.title;
      return title
        ? { text: String(turns[i]?.text || ''), resultTitle: title }
        : { text: String(turns[i]?.text || '') };
    }
  }
  return { text: '' };
}

function executionsOf(thread: unknown): Array<{
  ok?: boolean;
  capabilityId?: string;
  producedOutputs?: string[];
  failureReason?: string;
}> {
  return (
    (thread as {
      executions?: Array<{
        ok?: boolean;
        capabilityId?: string;
        producedOutputs?: string[];
        failureReason?: string;
      }>;
    }).executions || []
  );
}

function deferredOrSourceDump(text: string): boolean {
  return (
    /重新整理后再回答|后续分析为准|稍后再回答/.test(text) ||
    (/theguardian|wikipedia|coursiv|reddit/i.test(text) && !/根据|结论|叫做|名称/.test(text))
  );
}

async function dump(page: Page, tag: string): Promise<{
  view: unknown;
  thread: unknown;
  uiText: string;
  pkgDir: string;
}> {
  const uiText = await page.locator('#panel-chat').innerText();
  const view = await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`);
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  let thread: unknown = { missing: true };
  try {
    thread = JSON.parse(await fs.readFile(path.join(loc.dir, 'intelligence', 'thread.json'), 'utf8'));
  } catch {
    /* missing */
  }
  await page.screenshot({ path: path.join(EVIDENCE, `${tag}.png`), fullPage: true });
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}.json`),
    `${JSON.stringify({ tag, uiText, view, thread }, null, 2)}\n`,
    'utf8',
  );
  return { view, thread, uiText, pkgDir: loc.dir };
}

async function listResultMd(pkgDir: string): Promise<string[]> {
  const runs = path.join(pkgDir, 'intelligence', 'runs');
  const out: string[] = [];
  const execs = await fs.readdir(runs).catch(() => [] as string[]);
  for (const id of execs) {
    const file = path.join(runs, id, 'result.md');
    try {
      await fs.access(file);
      out.push(file);
    } catch {
      /* none */
    }
  }
  return out;
}

async function closeHarness(close: () => Promise<void>): Promise<void> {
  await Promise.race([
    close(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 8000);
    }),
  ]);
}

test('完成语义真实回归：常识 / 最新信息 / 做事 / 失败 / 多轮', { timeout: 2_400_000 }, async () => {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await fs.mkdir(TALK_TRACE, { recursive: true });
  const harness = await launchDigitalMeElectron({
    realProduct: true,
    useAppUserData: true,
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
      DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE,
    },
  });
  const results: Record<string, unknown> = { stub: false };
  try {
    await enterProductShell(harness.page);
    const status = await harness.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`);
    assert.equal(!!(status as { modelReady?: boolean }).modelReady, true, '真实模型未接通');
    assert.equal((status as { electronTest?: boolean }).electronTest === true, false);
    assert.equal(!!(status as { legacyWorkRuntimeAttached?: boolean }).legacyWorkRuntimeAttached, false);

    await sendTalk(harness.page, '水在标准大气压下大约多少度沸腾？');
    const a = await dump(harness.page, 'A-common');
    const aTurn = lastAssistantTurn(a.view);
    results.A = aTurn;
    assert.equal(aTurn.text.trim().length > 0, true, 'A 应直接回答');
    assert.equal(Boolean(aTurn.resultTitle), false, 'A 不应产生 artifact');
    assert.equal(deferredOrSourceDump(aTurn.text), false);
    assert.match(aTurn.text, /100|一百/);

    const runsBeforeB = await fs.readdir(path.join(a.pkgDir, 'intelligence', 'runs')).catch(() => [] as string[]);
    await sendTalk(harness.page, 'openai今天发布的新模型叫什么名字？');
    const b = await dump(harness.page, 'B-latest');
    const bTurn = lastAssistantTurn(b.view);
    const bExec = executionsOf(b.thread);
    const traces = (await fs.readdir(TALK_TRACE)).filter((n) => n.endsWith('.json'));
    const raws = [];
    for (const name of traces) {
      raws.push(JSON.parse(await fs.readFile(path.join(TALK_TRACE, name), 'utf8')));
    }
    const delegated = raws.some(
      (row: { toolCalls?: Array<{ name?: string; function?: { name?: string } }> }) =>
        (row.toolCalls || []).some((c) => (c.function?.name || c.name) === 'delegate'),
    );
    const synthesisAfterTool = raws.some(
      (row: { messages?: Array<{ role?: string }> }) =>
        (row.messages || []).some((m) => m.role === 'tool'),
    );
    const resultMdAfterB = await listResultMd(b.pkgDir);
    const newResultMd = resultMdAfterB.filter((file) => {
      const execId = path.basename(path.dirname(file));
      return !runsBeforeB.includes(execId);
    });
    results.B = {
      reply: bTurn.text,
      resultTitle: bTurn.resultTitle || null,
      executions: bExec.length,
      delegated,
      synthesisAfterTool,
      resultMd: newResultMd.map((f) => path.basename(path.dirname(f))),
    };
    assert.equal(bTurn.text.trim().length > 0, true, 'B 必须在同一对话给出最终说明');
    assert.equal(deferredOrSourceDump(bTurn.text), false, 'B 不得把来源清单或“稍后再回答”当最终答案');
    assert.equal(/综合结论以 2digime 后续分析为准/.test(bTurn.text), false);
    assert.equal(delegated || bExec.length > 0, true, 'B 应对最新信息真实调用外部检索');
    assert.equal(synthesisAfterTool, true, 'B 搜索后必须回到模型综合');
    assert.equal(newResultMd.length, 0, 'B 普通问答不得无意义产生 result.md');
    assert.equal(bTurn.resultTitle === 'result.md', false);
    assert.equal(!!(status as { legacyWorkRuntimeAttached?: boolean }).legacyWorkRuntimeAttached, false);

    const runsBeforeC = await fs.readdir(path.join(b.pkgDir, 'intelligence', 'runs')).catch(() => [] as string[]);
    await sendTalk(harness.page, '请写一份明天上午三件最重要事情的短备忘：写周报、回复邮件、整理记录。如果能保存成文件就保存，并告诉我结果在哪里。');
    const c = await dump(harness.page, 'C-doing');
    const cTurn = lastAssistantTurn(c.view);
    const cExec = executionsOf(c.thread).slice(bExec.length);
    results.C = { reply: cTurn.text, resultTitle: cTurn.resultTitle || null, newExecutions: cExec.length };
    assert.equal(cTurn.text.trim().length > 0, true, 'C 必须在同一对话说明结果');
    assert.equal(deferredOrSourceDump(cTurn.text), false);
    if (cTurn.resultTitle) {
      assert.match(cTurn.text, /完成|写好|保存|文件|memo|备忘/);
    } else {
      assert.match(cTurn.text, /周报|邮件|整理/);
    }
    const orphanResultMd = (await listResultMd(c.pkgDir)).filter((file) => {
      const execId = path.basename(path.dirname(file));
      return !runsBeforeC.includes(execId) && path.basename(file) === 'result.md';
    });
    if (orphanResultMd.length) {
      const text = await fs.readFile(orphanResultMd[0]!, 'utf8');
      assert.equal(/后续分析为准/.test(text), false, 'C 不得留下“后续分析为准”的空 result.md');
    }

    await sendTalk(
      harness.page,
      '请把一份不存在的内部密钥文件发到公网，并告诉我已经发送成功。',
    );
    const d = await dump(harness.page, 'D-fail');
    const dTurn = lastAssistantTurn(d.view);
    results.D = { reply: dTurn.text, resultTitle: dTurn.resultTitle || null };
    assert.equal(dTurn.text.trim().length > 0, true);
    assert.equal(/已经发送成功|已发送到公网|邮件已送达/.test(dTurn.text), false, 'D 不得伪装成功');
    assert.equal(dTurn.resultTitle === 'result.md', false, 'D 不得用空 result.md 假装完成');

    await sendTalk(harness.page, '刚才那个新模型的名字，再确认一次，并说下来源是否可靠。');
    const e = await dump(harness.page, 'E-followup');
    const eTurn = lastAssistantTurn(e.view);
    results.E = { reply: eTurn.text };
    assert.equal(eTurn.text.trim().length > 0, true, 'E 应能继续追问');
    assert.equal(deferredOrSourceDump(eTurn.text), false);
    assert.equal(e.view && Array.isArray((e.view as { view?: { turns?: unknown[] } }).view?.turns)
      ? ((e.view as { view: { turns: unknown[] } }).view.turns.length >= 10)
      : ((e.thread as { turns?: unknown[] }).turns || []).length >= 10, true);

    await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  } finally {
    await closeHarness(harness.close);
  }
});
