/**
 * 03A 专业能力边界闸门：正式 Electron + 真实模型 + 真实可执行 Professional Agent。
 * 任务必须是 2digime 聊天文本无法假装完成的外部落盘。不为句式增加路由。
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

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_dialogue-doing-03a-professional-boundary');
const TALK_TRACE = path.join(EVIDENCE, 'raw-talk');
const SELF_TRACE = path.join(EVIDENCE, 'raw-digital-self');
const RUNS_COPY = path.join(EVIDENCE, 'agent-runs');

const SCENE_1 = '请在工作区创建一个 README.md，写一段这个项目的简短说明。';
const SCENE_2 = '把一份闸门试验介绍放到工作区，文件名叫 NOTES.md。';
const SCENE_3_ASK = '再帮我加一个署名文件，把作者名字写进去。';
const SCENE_3_FILL = '作者是闸门试验员。';

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
  thread: unknown;
  createdFiles: string[];
}> {
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  const dir = loc.dir;
  const threadPath = path.join(dir, 'intelligence', 'thread.json');
  let thread: unknown = null;
  try {
    thread = JSON.parse(await fs.readFile(threadPath, 'utf8'));
  } catch {
    thread = { missing: true };
  }
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}-thread.json`),
    `${JSON.stringify(thread, null, 2)}\n`,
    'utf8',
  );
  const createdFiles: string[] = [];
  const runsDir = path.join(dir, 'intelligence', 'runs');
  try {
    const execs = await fs.readdir(runsDir);
    await fs.mkdir(RUNS_COPY, { recursive: true });
    for (const execId of execs) {
      const srcDir = path.join(runsDir, execId);
      const destDir = path.join(RUNS_COPY, `${tag}-${execId}`);
      await fs.cp(srcDir, destDir, { recursive: true });
      createdFiles.push(...(await listFiles(srcDir)));
    }
  } catch {
    /* no runs yet */
  }
  return { dir, thread, createdFiles };
}

async function listFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const out: string[] = [];
  let ents;
  try {
    ents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      out.push(...(await listFiles(p, depth + 1)));
    } else {
      out.push(p);
    }
  }
  return out;
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

function executionsOf(thread: unknown): Array<{ capabilityId?: string; ok?: boolean; outputPath?: string }> {
  return ((thread as { executions?: Array<{ capabilityId?: string; ok?: boolean; outputPath?: string }> })
    ?.executions || []);
}

function hasNamedFile(files: string[], name: string): boolean {
  const lower = name.toLowerCase();
  return files.some((f) => path.basename(f).toLowerCase() === lower);
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

async function readTalkTraces(): Promise<Array<{
  file: string;
  kind: string | null;
  toolCallNames: Array<string | null>;
  stub: boolean;
}>> {
  const names = (await fs.readdir(TALK_TRACE)).filter((n) => n.endsWith('.json')).sort();
  const out = [];
  for (const name of names) {
    const parsed = JSON.parse(await fs.readFile(path.join(TALK_TRACE, name), 'utf8')) as {
      stub?: boolean;
      kind?: string;
      toolCalls?: Array<{ function?: { name?: string }; name?: string }>;
    };
    out.push({
      file: name,
      kind: parsed.kind || null,
      stub: parsed.stub === true,
      toolCallNames: (parsed.toolCalls || []).map((c) => c.function?.name || c.name || null),
    });
  }
  return out;
}

test('Electron 03A：真实专业能力可见后自主 delegate 并产生外部文件', { timeout: 2_400_000 }, async () => {
  await fs.mkdir(TALK_TRACE, { recursive: true });
  await fs.mkdir(SELF_TRACE, { recursive: true });
  await fs.mkdir(RUNS_COPY, { recursive: true });

  const harness = await launchDigitalMeElectron({
    realProduct: true,
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
    usedAppUserData: false,
    isolatedUserDataFailedFirstWindow: false,
    yellow: false,
    openGoalWritten: false,
    note: '测试使用隔离 userData，不得写入正式 AppData default Thread。',
  };

  try {
    await enterProductShell(harness.page);
    const status = await harness.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`);
    const caps = await harness.page.evaluate(`(async () => {
      return window.digitalMe.invoke('capability.list', { includeAvailability: true });
    })()`);
    const capabilities = ((caps as { capabilities?: Array<{
      id: string;
      displayName: string;
      kind?: string;
      availability?: string;
      adapterType?: string;
    }> }).capabilities || []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      kind: c.kind || null,
      availability: c.availability,
      adapterType: c.adapterType || null,
    }));
    results.model = status;
    results.capabilities = capabilities;
    await fs.writeFile(
      path.join(EVIDENCE, 'model-status.json'),
      `${JSON.stringify({ status, capabilities }, null, 2)}\n`,
      'utf8',
    );

    const modelReady = !!(status as { modelReady?: boolean }).modelReady;
    const electronTest = (status as { electronTest?: boolean }).electronTest === true;
    const fakeCap = capabilities.some((c) => c.id === 'cap_fake_document');
    assert.equal(modelReady, true, '真实模型未接通');
    assert.equal(electronTest, false, '不应走 Electron test harness');
    assert.equal(fakeCap, false, '产品闸门不得注册 fake document');

    const codingAvailable = capabilities.some(
      (c) => c.id === 'cap_external_executor_codex' && c.availability === 'available',
    );
    results.codingAvailable = codingAvailable;
    assert.equal(codingAvailable, true, '本轮闸门需要真实可用的代码执行能力');

    await sendTalk(harness.page, SCENE_1);
    const a = await dumpScene(harness.page, '01-readme', SCENE_1);
    const afterA = await copyPackageEvidence(harness.page, '01');
    const execA = executionsOf(afterA.thread);
    const usedModelAsAgent = execA.some((e) => e.capabilityId === 'cap_model_openai_compatible');
    const delegated = execA.length > 0;
    const createdReadme = hasNamedFile(afterA.createdFiles, 'README.md');
    results.A = {
      input: SCENE_1,
      reply: lastAssistant(a.view),
      executions: execA,
      delegated,
      createdReadme,
      usedModelAsAgent,
      createdFiles: afterA.createdFiles.map((f) => path.basename(f)),
    };
    if (!delegated || usedModelAsAgent) {
      results.yellow = true;
      await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
      assert.equal(delegated, true, 'YELLOW：能力合同明确且真实专业能力可见后，模型仍拒绝 delegate');
      assert.equal(usedModelAsAgent, false, 'YELLOW：不得把通用文本模型当作专业 Agent 证明');
    }

    await sendTalk(harness.page, SCENE_2);
    const b = await dumpScene(harness.page, '02-notes', SCENE_2);
    const afterB = await copyPackageEvidence(harness.page, '02');
    const execB = executionsOf(afterB.thread);
    const createdNotes = hasNamedFile(afterB.createdFiles, 'NOTES.md');
    results.B = {
      input: SCENE_2,
      reply: lastAssistant(b.view),
      executions: execB,
      delegatedAgain: execB.length > execA.length,
      createdNotes,
    };

    await sendTalk(harness.page, SCENE_3_ASK);
    const c1 = await dumpScene(harness.page, '03a-missing-info', SCENE_3_ASK);
    const afterC1 = await copyPackageEvidence(harness.page, '03a');
    const execC1 = executionsOf(afterC1.thread);
    const asked = /作者|名字|叫什么|署名/.test(lastAssistant(c1.view));
    results.C1 = {
      input: SCENE_3_ASK,
      reply: lastAssistant(c1.view),
      executions: execC1,
      asked,
      openGoal: (afterC1.thread as { openGoal?: string })?.openGoal || null,
    };
    results.openGoalWritten = Boolean((afterC1.thread as { openGoal?: string })?.openGoal);

    await sendTalk(harness.page, SCENE_3_FILL);
    const c2 = await dumpScene(harness.page, '03b-continue', SCENE_3_FILL);
    const afterC2 = await copyPackageEvidence(harness.page, '03b');
    const execC2 = executionsOf(afterC2.thread);
    const turns = ((afterC2.thread as { turns?: Array<{ role: string; text: string }> })?.turns || []);
    const historyHasAsk = turns.some((t) => t.role === 'user' && t.text.includes('署名'));
    const historyHasFill = turns.some((t) => t.role === 'user' && t.text.includes('闸门试验员'));
    results.C2 = {
      input: SCENE_3_FILL,
      reply: lastAssistant(c2.view),
      executions: execC2,
      sameThread: (afterC2.thread as { threadId?: string })?.threadId === 'default',
      historyHasAsk,
      historyHasFill,
      delegatedAfterFill: execC2.length > execC1.length,
      openGoal: (afterC2.thread as { openGoal?: string })?.openGoal || null,
    };

    const traces = await readTalkTraces();
    results.rawTalk = traces;
    results.anyStub = traces.some((t) => t.stub);
    results.semanticReview = traces.some((t) => t.kind === 'talk-review');
    results.autonomousDelegate = traces.some(
      (t) => t.kind === 'talk-decide' && t.toolCallNames.includes('delegate'),
    );
    await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');

    assert.equal(results.anyStub, false, '检测到测试双参与');
    assert.equal(results.autonomousDelegate, true, '真实模型未自主调用 delegate');
    assert.equal(results.semanticReview, true, '未发生 semantic review');
    assert.equal(historyHasAsk && historyHasFill, true, 'Thread 未自然保留缺信息场景');
    assert.equal(
      (results.C2 as { delegatedAfterFill?: boolean }).delegatedAfterFill,
      true,
      '补全信息后未继续委托专业能力',
    );
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
            results,
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
