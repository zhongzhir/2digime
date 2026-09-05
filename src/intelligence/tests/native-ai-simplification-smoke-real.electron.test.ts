/**
 * Native AI 简化后的 3 个真实 DeepSeek smoke。默认 skip。
 * 打开：DIGITALME_V2_NATIVE_AI_SMOKE=1
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

const ENABLED = process.env.DIGITALME_V2_NATIVE_AI_SMOKE === '1';
const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_native-ai-simplification-smoke');
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

type ExecRec = { capabilityId: string; ok: boolean; turnId?: string };
type Turn = { role: string; text: string; result?: { title?: string; path?: string } };

async function pkgDirOf(page: Page): Promise<string> {
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  return loc.dir;
}

async function readThreadFile(pkgDir: string): Promise<{
  executions: ExecRec[];
  openGoal?: string;
  turns: Turn[];
}> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(pkgDir, 'intelligence', 'thread.json'), 'utf8')) as {
      executions?: ExecRec[];
      openGoal?: string;
      turns?: Turn[];
    };
    return {
      executions: parsed.executions || [],
      ...(parsed.openGoal ? { openGoal: parsed.openGoal } : {}),
      turns: parsed.turns || [],
    };
  } catch {
    return { executions: [], turns: [] };
  }
}

async function talkView(page: Page): Promise<{ turns: Turn[] }> {
  const talked = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: Turn[] } };
  return { turns: talked.view?.turns || [] };
}

async function talkSnapshot(page: Page, pkgDir: string): Promise<{
  view: { turns: Turn[] };
  thread: { executions: ExecRec[]; openGoal?: string; turns: Turn[] };
}> {
  const view = await talkView(page);
  const thread = await readThreadFile(pkgDir);
  return { view, thread };
}

async function sendTalk(page: Page, text: string, waitMs = 400_000): Promise<void> {
  const before = (await talkView(page)).turns.length;
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkView(page)).turns.length > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function lastAssistant(turns: Array<{ role: string; text: string }>): string {
  return [...turns].reverse().find((t) => t.role === 'assistant')?.text || '';
}

async function readTraces(): Promise<
  Array<{ kind?: string; tools?: string[]; toolCalls?: unknown[]; messages?: Array<{ role: string }> }>
> {
  const names = (await fs.readdir(TALK_TRACE).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
  const out = [];
  for (const name of names.sort()) {
    out.push(JSON.parse(await fs.readFile(path.join(TALK_TRACE, name), 'utf8')));
  }
  return out;
}

test(
  '真实 DeepSeek smoke：常识 / 实时搜索 / HTML 小游戏',
  {
    skip: ENABLED ? false : 'set DIGITALME_V2_NATIVE_AI_SMOKE=1',
    timeout: 900_000,
  },
  async () => {
    await fs.mkdir(TALK_TRACE, { recursive: true });
    for (const name of await fs.readdir(TALK_TRACE).catch(() => [] as string[])) {
      if (name.endsWith('.json')) await fs.unlink(path.join(TALK_TRACE, name));
    }

    const harness = await launchDigitalMeElectron({
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
        DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE,
      },
    });
    const report: Record<string, unknown> = {};
    try {
      await enterProductShell(harness.page);
      const status = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.getModelStatus();
      })()`)) as { modelReady?: boolean };
      assert.equal(!!status.modelReady, true, '真实模型未接通');

      const pkgDir = await pkgDirOf(harness.page);

      const beforeA = await talkSnapshot(harness.page, pkgDir);
      const execBeforeA = beforeA.thread.executions.length;
      await sendTalk(harness.page, '水在标准大气压下大约多少度沸腾？');
      const a = await talkSnapshot(harness.page, pkgDir);
      const aText = lastAssistant(a.view.turns);
      const aExec = (a.thread.executions || []).slice(execBeforeA);
      report.A = {
        text: aText,
        executions: aExec.map((e) => e.capabilityId),
        openGoal: a.thread.openGoal || null,
      };
      assert.match(aText, /100|沸腾/);
      assert.equal(aExec.some((e) => /search/i.test(e.capabilityId)), false, 'A 不应搜索');
      assert.equal(a.thread.openGoal, undefined);

      const tracesAfterA = await readTraces();
      const aCalls = tracesAfterA.length;
      report.Atraces = aCalls;
      assert.equal(
        tracesAfterA.some((t) => t.kind === 'talk-review'),
        false,
        'A 不得出现独立验收 reviewer',
      );

      const execBeforeB = a.thread.executions.length;
      await sendTalk(harness.page, '帮我查一下 OpenAI 今天发布了什么模型？');
      const b = await talkSnapshot(harness.page, pkgDir);
      const bText = lastAssistant(b.view.turns);
      const bExec = (b.thread.executions || []).slice(execBeforeB);
      const tracesAfterB = await readTraces();
      const bTraces = tracesAfterB.slice(aCalls);
      const bUsedSearch = bExec.some((e) => /search/i.test(e.capabilityId));
      const bSameModelContinue = bTraces.some((t) =>
        (t.messages || []).some((m) => m.role === 'tool'),
      );
      report.B = {
        text: bText,
        executions: bExec.map((e) => `${e.capabilityId}:${e.ok}`),
        usedSearch: bUsedSearch,
        sameModelSawTool: bSameModelContinue,
      };
      assert.equal(bText.trim().length > 0, true);
      assert.equal(
        tracesAfterB.some((t) => t.kind === 'talk-review'),
        false,
        'B 不得出现独立验收 reviewer',
      );
      assert.equal(/freshnessRequired/.test(JSON.stringify(bTraces)), false);

      const execBeforeC = b.thread.executions.length;
      await sendTalk(
        harness.page,
        '我不会写代码。帮我做一个双击就能玩的、带一点数学知识的简单网页小游戏。不要让我配置开发环境。',
      );
      const c = await talkSnapshot(harness.page, pkgDir);
      const cText = lastAssistant(c.view.turns);
      const cExec = (c.thread.executions || []).slice(execBeforeC);
      const outputsDir = path.join(pkgDir, 'intelligence', 'outputs');
      const htmlFiles: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const ent of ents) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) await walk(p);
          else if (/\.html?$/i.test(ent.name)) htmlFiles.push(p);
        }
      };
      await walk(outputsDir);
      let htmlOk = false;
      for (const file of htmlFiles) {
        const body = await fs.readFile(file, 'utf8');
        if (/<html/i.test(body) && body.trim().length > 40) {
          htmlOk = true;
          report.Cfile = file;
          break;
        }
      }
      const lastC = [...c.view.turns].reverse().find((t) => t.role === 'assistant');
      report.C = {
        text: cText,
        executions: cExec.map((e) => `${e.capabilityId}:${e.ok}`),
        htmlFiles,
        usedWriteFile: cExec.some((e) => e.capabilityId === 'write_file'),
        usedCodex: cExec.some((e) => /codex|external_executor/i.test(e.capabilityId)),
        result: lastC?.result || null,
      };
      assert.equal(htmlOk, true, 'C：授权目录应有可打开的 HTML');
      assert.equal(
        cExec.some((e) => /codex/i.test(e.capabilityId)),
        false,
        'C 不得默认进入 Codex',
      );

      await fs.mkdir(EVIDENCE, { recursive: true });
      await fs.writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (err) {
      report.error = String(err instanceof Error ? err.stack || err.message : err);
      await fs.mkdir(EVIDENCE, { recursive: true });
      await fs.writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      throw err;
    } finally {
      await harness.close();
    }
  },
);
