/**
 * CAPABILITY-TRUTH 短真实验证。默认 skip。
 * 打开：DIGITALME_V2_CAPABILITY_TRUTH_SMOKE=1
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
  hasTestModelCredential,
  DEV_MODEL_CREDENTIAL_FILE,
} from '../../runtime/tests/electron-harness';
import { createGeminiSearchConnector } from '../../capability/adapters/gemini-search';
import { hasUsableWebEvidence } from '../../capability/search-contract';

const ENABLED = process.env.DIGITALME_V2_CAPABILITY_TRUTH_SMOKE === '1';
const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_capability-truth');
const TALK_TRACE_A = path.join(EVIDENCE, 'raw-talk-a');
const TALK_TRACE_B = path.join(EVIDENCE, 'raw-talk-b');

async function enterProductShell(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const shell = await page.locator('#view-shell').isVisible().catch(() => false);
    const input = await page.locator('#chat-input').isVisible().catch(() => false);
    if (shell && input) return;
    for (const id of ['btn-welcome-skip-model', 'btn-welcome-skip-model-2', 'btn-create-skip']) {
      const btn = page.locator(`#${id}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(600);
      }
    }
    await page.waitForTimeout(400);
  }
  await skipWelcomeAndEnterShell(page);
}

async function talkView(page: Page): Promise<{ turns: Array<{ role: string; text: string }> }> {
  const talked = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: Array<{ role: string; text: string }> } };
  return { turns: talked.view?.turns || [] };
}

async function sendTalk(
  page: Page,
  text: string,
  waitMs = 240_000,
  extra?: { contextPaths?: string[] },
): Promise<void> {
  const before = (await talkView(page)).turns.length;
  const payload = extra?.contextPaths?.length
    ? { text, contextPaths: extra.contextPaths }
    : text;
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(typeof payload === 'string' ? payload : payload.text, typeof payload === 'string' ? undefined : payload);
  })(${JSON.stringify(payload)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkView(page)).turns.length > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function lastAssistant(turns: Array<{ role?: string; text?: string }>): string {
  return [...turns].reverse().find((t) => t.role === 'assistant')?.text || '';
}

function readThread(pkgDir: string): { executions?: Array<{ capabilityId?: string; ok?: boolean; failureReason?: string }> } {
  try {
    return JSON.parse(
      require('node:fs').readFileSync(path.join(pkgDir, 'intelligence', 'thread.json'), 'utf8'),
    ) as { executions?: Array<{ capabilityId?: string; ok?: boolean; failureReason?: string }> };
  } catch {
    return {};
  }
}

async function emptyTraceDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function systemBlobFromTraces(dir: string): string {
  if (!existsSync(dir)) return '';
  const names = require('node:fs')
    .readdirSync(dir)
    .filter((n: string) => n.endsWith('.json')) as string[];
  return names
    .map((name) => {
      const raw = JSON.parse(require('node:fs').readFileSync(path.join(dir, name), 'utf8')) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      return String(raw.messages?.[0]?.content || '');
    })
    .join('\n');
}

async function pkgDirOf(page: Page): Promise<string> {
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  return loc.dir;
}

test(
  'A/E 无 Gemini：Talk 看不到 Bing/Gemini，无授权仓库时不暴露 Codex',
  {
    skip: !ENABLED
      ? 'set DIGITALME_V2_CAPABILITY_TRUTH_SMOKE=1'
      : hasTestModelCredential()
        ? false
        : 'no test model credential',
    timeout: 600_000,
  },
  async () => {
    await emptyTraceDir(TALK_TRACE_A);
    const harness = await launchDigitalMeElectron({
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
        DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE_A,
        GEMINI_API_KEY: '',
        GEMINI_SEARCH_MODEL: '',
        GEMINI_MODEL: '',
      },
    });
    try {
      await enterProductShell(harness.page);
      const status = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.getModelStatus();
      })()`)) as { modelReady?: boolean };
      assert.equal(!!status.modelReady, true);
      await sendTalk(harness.page, 'OpenAI 今天有什么新发布？');
      const sys = systemBlobFromTraces(TALK_TRACE_A);
      assert.equal(/cap_baseline_web_search/.test(sys), false);
      assert.equal(/cap_gemini_web_search/.test(sys), false);
      assert.match(sys, /当前没有已连接的外部能力|只能交流/);
      const reply = lastAssistant((await talkView(harness.page)).turns);
      assert.equal(/cap_baseline_web_search|基础搜索/.test(reply), false);

      const pkgDir = await pkgDirOf(harness.page);
      const before = readThread(pkgDir).executions?.length || 0;
      await sendTalk(harness.page, '修改这个项目并跑测试。');
      const after = (readThread(pkgDir).executions || []).slice(before);
      assert.equal(
        after.some((e) => /codex|model_api/i.test(String(e.capabilityId || ''))),
        false,
      );
    } finally {
      await harness.close();
    }
  },
);

test(
  'B adapter + Talk Gemini；C write_file；D 授权 git repo 的 Codex cwd',
  {
    skip: !ENABLED
      ? 'set DIGITALME_V2_CAPABILITY_TRUTH_SMOKE=1'
      : hasTestModelCredential() && String(process.env.GEMINI_API_KEY || '').trim()
        ? false
        : 'need model credential and GEMINI_API_KEY',
    timeout: 900_000,
  },
  async () => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    const gemKey = String(process.env.GEMINI_API_KEY || '').trim();
    const started = Date.now();
    const connector = createGeminiSearchConnector({ apiKey: gemKey, model: 'gemini-3.6-flash' });
    const sources = await connector.search('OpenAI 今天有什么新发布？');
    const adapterMs = Date.now() - started;
    const usable = hasUsableWebEvidence(sources);
    await fs.writeFile(
      path.join(EVIDENCE, 'gemini-adapter-b.json'),
      JSON.stringify(
        {
          latencyMs: adapterMs,
          actualSuccess: usable,
          exceeded25s: adapterMs > 25_000,
          sourceCount: sources.length,
          evidence: sources.slice(0, 6).map((s) => ({ title: s.title, url: s.url })),
        },
        null,
        2,
      ),
      'utf8',
    );
    assert.equal(usable, true, 'Gemini adapter 应返回可用来源');

    const importFile = path.join(os.tmpdir(), `dm-cap-truth-import-${Date.now()}.json`);
    const modelCred = JSON.parse(await fs.readFile(DEV_MODEL_CREDENTIAL_FILE, 'utf8')) as Record<string, string>;
    await fs.writeFile(
      importFile,
      JSON.stringify({ ...modelCred, geminiApiKey: gemKey }, null, 2),
      'utf8',
    );

    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-codex-repo-'));
    await fs.writeFile(path.join(repo, 'note.txt'), 'hello\n', 'utf8');
    await fs.writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'dm-codex-truth', scripts: { test: 'node test.cjs' } }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repo, 'test.cjs'),
      "const fs=require('fs'); const t=fs.readFileSync('note.txt','utf8'); if(!t.includes('hello-codex')) process.exit(1);\n",
      'utf8',
    );
    spawnSync('git', ['init'], { cwd: repo, windowsHide: true });
    spawnSync('git', ['add', '.'], { cwd: repo, windowsHide: true });
    spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-m', 't'], {
      cwd: repo,
      windowsHide: true,
    });

    await emptyTraceDir(TALK_TRACE_B);
    const harness = await launchDigitalMeElectron({
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
        DIGITALME_V2_CREDENTIAL_IMPORT: importFile,
        DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE_B,
        DIGITALME_V2_TALK_TURN_DEADLINE_MS: '600000',
        DIGITALME_V2_TALK_UI_DEADLINE_MS: '620000',
        GEMINI_API_KEY: '',
      },
    });
    try {
      await enterProductShell(harness.page);
      const pkgDir = await pkgDirOf(harness.page);
      await sendTalk(harness.page, 'OpenAI 今天有什么新发布？', 240_000);
      const sys = systemBlobFromTraces(TALK_TRACE_B);
      assert.match(sys, /cap_gemini_web_search/);
      assert.equal(/cap_baseline_web_search/.test(sys), false);
      const execB = readThread(pkgDir).executions || [];
      assert.equal(
        execB.some((e) => e.capabilityId === 'cap_gemini_web_search'),
        true,
        'Talk 应自行调用 Gemini',
      );
      assert.equal(
        execB.some((e) => e.capabilityId === 'cap_baseline_web_search'),
        false,
      );

      await sendTalk(
        harness.page,
        '帮我写一个 hello.html，内容是 <html><body>hi</body></html>。',
        180_000,
      );
      const htmlPath = path.join(pkgDir, 'intelligence', 'outputs', 'hello.html');
      assert.equal(existsSync(htmlPath), true);
      assert.match(await fs.readFile(htmlPath, 'utf8'), /hi/);

      const execBeforeD = readThread(pkgDir).executions?.length || 0;
      await sendTalk(
        harness.page,
        '把 note.txt 改成包含 hello-codex，并跑 npm test。',
        620_000,
        { contextPaths: [repo] },
      );
      const execD = (readThread(pkgDir).executions || []).slice(execBeforeD);
      assert.equal(
        execD.some((e) => e.capabilityId === 'cap_external_executor_codex'),
        true,
        '有授权 repo 时应调用 Codex',
      );
      const runs = path.join(pkgDir, 'intelligence', 'runs');
      let cwd = '';
      if (existsSync(runs)) {
        for (const name of await fs.readdir(runs)) {
          const pkgFile = path.join(runs, name, 'external-execution', 'task-package.json');
          if (!existsSync(pkgFile)) continue;
          const parsed = JSON.parse(await fs.readFile(pkgFile, 'utf8')) as { workingDirectory?: string };
          if (parsed.workingDirectory) cwd = parsed.workingDirectory;
        }
      }
      assert.equal(path.resolve(cwd), path.resolve(repo), `Codex cwd 应为授权 repo，实际 ${cwd}`);
      assert.equal(/intelligence[\\/]+runs/.test(cwd), false);
    } finally {
      await harness.close();
      await fs.unlink(importFile).catch(() => undefined);
    }
  },
);
