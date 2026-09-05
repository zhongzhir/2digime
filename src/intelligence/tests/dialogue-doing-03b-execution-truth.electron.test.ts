/**
 * 03B：真实外部执行闭环。不改 talk/delegate 判断。
 * A = Codex 成功落盘；B = AtomCode 真实失败，runtime 不得被 review 改写成成功。
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

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_dialogue-doing-03b-execution-truth');
const SCENE = '请在这个工作区创建 README.md，写一段简短项目说明。';

async function openTalk(page: Page): Promise<void> {
  await page.locator('#nav-chat').waitFor({ state: 'visible', timeout: 20_000 });
  const sendVisible = await page.locator('#btn-chat-send').isVisible().catch(() => false);
  if (sendVisible) return;
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-chat').dispatchEvent('click');
    if (await page.locator('#btn-chat-send').isVisible().catch(() => false)) return;
    await page.waitForTimeout(400);
  }
  await page.locator('#btn-chat-send').waitFor({ state: 'visible', timeout: 15_000 });
}

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string, waitMs = 800_000): Promise<void> {
  await openTalk(page);
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

async function listFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  let ents;
  try {
    ents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'external-execution') continue;
      out.push(...(await listFiles(p, depth + 1)));
    } else out.push(p);
  }
  return out;
}

function lastAssistant(view: unknown): string {
  const turns =
    (view as { view?: { turns?: Array<{ role: string; text: string }> } })?.view?.turns ||
    (view as { turns?: Array<{ role: string; text: string }> })?.turns ||
    [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role === 'assistant') return String(turns[i]?.text || '');
  }
  return '';
}

function executionsOf(thread: unknown): Array<{
  capabilityId?: string;
  ok?: boolean;
  failureReason?: string;
  producedOutputs?: string[];
}> {
  return (
    (thread as {
      executions?: Array<{
        capabilityId?: string;
        ok?: boolean;
        failureReason?: string;
        producedOutputs?: string[];
      }>;
    }).executions || []
  );
}

async function dumpAndCopy(
  page: Page,
  tag: string,
  talkTrace: string,
): Promise<{ view: unknown; thread: unknown; createdFiles: string[] }> {
  await openTalk(page);
  const uiText = await page.locator('#panel-chat').innerText();
  const view = await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`);
  await page.screenshot({ path: path.join(EVIDENCE, `${tag}.png`), fullPage: true });
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  let thread: unknown = { missing: true };
  try {
    thread = JSON.parse(await fs.readFile(path.join(loc.dir, 'intelligence', 'thread.json'), 'utf8'));
  } catch {
    /* missing */
  }
  const createdFiles: string[] = [];
  const runsDir = path.join(loc.dir, 'intelligence', 'runs');
  try {
    const execs = await fs.readdir(runsDir);
    for (const execId of execs) {
      const srcDir = path.join(runsDir, execId);
      await fs.cp(srcDir, path.join(EVIDENCE, 'agent-runs', `${tag}-${execId}`), { recursive: true });
      createdFiles.push(...(await listFiles(srcDir)));
    }
  } catch {
    /* no runs */
  }
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}.json`),
    `${JSON.stringify({ tag, uiText, view, thread, createdFiles }, null, 2)}\n`,
    'utf8',
  );
  const traces = (await fs.readdir(talkTrace).catch(() => [])).filter((n) => n.endsWith('.json'));
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}-raw-index.json`),
    `${JSON.stringify(traces, null, 2)}\n`,
    'utf8',
  );
  return { view, thread, createdFiles };
}

async function closeHarness(close: () => Promise<void>): Promise<void> {
  await Promise.race([
    close(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 8000);
    }),
  ]);
}

async function runScene(input: {
  tag: 'A-codex' | 'B-atomcode-fail';
  cliKind: 'codex' | 'atomcode';
}): Promise<{
  reply: string;
  executions: ReturnType<typeof executionsOf>;
  createdReadme: boolean;
  delegated: boolean;
  reviewHappened: boolean;
  claimedSuccess: boolean;
}> {
  const talkTrace = path.join(EVIDENCE, `raw-talk-${input.tag}`);
  await fs.mkdir(talkTrace, { recursive: true });
  const harness = await launchDigitalMeElectron({
    realProduct: true,
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
      DIGITALME_V2_TALK_TRACE_DIR: talkTrace,
      DIGITALME_EXECUTOR_CLI_KIND: input.cliKind,
    },
  });
  try {
    await enterProductShell(harness.page);
    const status = await harness.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`);
    assert.equal(!!(status as { modelReady?: boolean }).modelReady, true, '真实模型未接通');
    if (input.tag === 'A-codex') {
      await sendTalk(harness.page, '你现在了解我什么？');
      const chat = await dumpAndCopy(harness.page, 'A-chat', talkTrace);
      const chatReply = lastAssistant(chat.view);
      assert.equal(chatReply.trim().length > 0, true, '普通对话应有回复');
      assert.equal(/Job|capability id|cap_/.test(chatReply), false, '普通对话不得泄漏内部对象');
    }
    const loc0 = (await harness.page.evaluate(`(async () => {
      return window.digitalMe.getDefaultSubjectDir();
    })()`)) as { dir: string };
    const runsDir = path.join(loc0.dir, 'intelligence', 'runs');
    const runsBefore = await fs.readdir(runsDir).catch(() => [] as string[]);
    await sendTalk(harness.page, SCENE);
    const dumped = await dumpAndCopy(harness.page, input.tag, talkTrace);
    const newRunFiles: string[] = [];
    const runsAfter = await fs.readdir(runsDir).catch(() => [] as string[]);
    for (const execId of runsAfter.filter((id) => !runsBefore.includes(id))) {
      newRunFiles.push(...(await listFiles(path.join(runsDir, execId))));
    }
    const reply = lastAssistant(dumped.view);
    const allExec = executionsOf(dumped.thread);
    const newCount = Math.max(runsAfter.length - runsBefore.length, 0);
    const executions = newCount ? allExec.slice(-newCount) : allExec.slice(-2);
    const createdReadme = newRunFiles.some((f) => path.basename(f).toLowerCase() === 'readme.md');
    const traces = (await fs.readdir(talkTrace)).filter((n) => n.endsWith('.json'));
    let reviewHappened = false;
    let delegated = false;
    for (const name of traces) {
      const parsed = JSON.parse(await fs.readFile(path.join(talkTrace, name), 'utf8')) as {
        kind?: string;
        toolCalls?: Array<{ function?: { name?: string }; name?: string }>;
      };
      if (parsed.kind === 'talk-review') reviewHappened = true;
      if ((parsed.toolCalls || []).some((c) => (c.function?.name || c.name) === 'delegate')) {
        delegated = true;
      }
    }
    return {
      reply,
      executions,
      createdReadme,
      delegated: delegated || executions.length > 0,
      reviewHappened,
      claimedSuccess: /已经完成|已完成|已创建|已经创建|已在工作区创建|成功写入|已经写好/.test(reply),
    };
  } finally {
    await closeHarness(harness.close);
  }
}

test('03B 真实闭环：Codex 成功 / AtomCode 失败不得改写成成功', { timeout: 2_400_000 }, async () => {
  await fs.mkdir(path.join(EVIDENCE, 'agent-runs'), { recursive: true });
  const results: Record<string, unknown> = {
    scene: SCENE,
    talkJudgmentUnchanged: true,
    noNewEnumOrKeywordRouting: true,
  };

  const a = await runScene({ tag: 'A-codex', cliKind: 'codex' });
  results.A = a;
  await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  assert.equal(a.delegated, true, 'A：真实模型未自主 delegate');
  assert.equal(a.createdReadme, true, 'A：Codex 未在授权目录产生 README.md');
  assert.equal(a.reviewHappened, true, 'A：未发生 semantic review');

  const b = await runScene({ tag: 'B-atomcode-fail', cliKind: 'atomcode' });
  results.B = b;
  await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  assert.equal(b.delegated, true, 'B：应发生真实外部执行');
  const failed = b.executions.some((e) => e.ok === false) || !b.createdReadme;
  assert.equal(failed, true, 'B：应留下失败的 execution truth');
  assert.equal(b.claimedSuccess, false, 'B：失败仍被 review/回复改写成成功');
  assert.equal(b.reviewHappened, true, 'B：未发生 semantic review');
});
