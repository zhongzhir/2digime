/**
 * DIGITALME-DOING-AI-FIRST-REDUCTION-01 三个真实 smoke。
 * 打开：DIGITALME_V2_DOING_AI_FIRST_SMOKE=1
 * 不走 Electron harness。Digital Self interpret 用空理解双，避免本轮再测 15s 阻塞。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { providerCredentialKey } from '../../infrastructure/secret-store';

const ENABLED = process.env.DIGITALME_V2_DOING_AI_FIRST_SMOKE === '1';
const CREDENTIAL_FILE = path.resolve(
  __dirname,
  '../../../scripts/_mvp-p14-real-capability-evidence/.runtime-model-credential.json',
);
const EVIDENCE = path.resolve(__dirname, '../../../scripts/_doing-ai-first-reduction-01');

async function loadCredential(): Promise<{
  openaiCompatible: { providerId: string; baseUrl: string; model: string; timeoutMs: number };
  secrets: { get: (k: string) => Promise<string | null> };
} | null> {
  if (!existsSync(CREDENTIAL_FILE)) return null;
  try {
    const raw = JSON.parse(await fs.readFile(CREDENTIAL_FILE, 'utf8')) as {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      providerId?: string;
    };
    const apiKey = String(raw.apiKey || '').trim();
    const baseUrl = String(raw.baseUrl || '').trim();
    const model = String(raw.model || '').trim();
    if (!apiKey || !baseUrl || !model) return null;
    const providerId = String(raw.providerId || 'openai-compatible').trim() || 'openai-compatible';
    return {
      openaiCompatible: { providerId, baseUrl, model, timeoutMs: 600_000 },
      secrets: { get: async (k) => (k === providerCredentialKey(providerId) ? apiKey : null) },
    };
  } catch {
    return null;
  }
}

function emptySelfChat() {
  return async () => ({ text: JSON.stringify({ understandings: [] }) });
}

test(
  '真实 SMOKE A/B/C：聊天 / 授权写文件 / 自主 delegate',
  {
    skip: ENABLED ? false : 'set DIGITALME_V2_DOING_AI_FIRST_SMOKE=1',
    timeout: 900_000,
  },
  async () => {
    const cred = await loadCredential();
    assert.ok(cred, '需要开发模型凭证');
    await fs.mkdir(EVIDENCE, { recursive: true });
    const report: Record<string, unknown> = {};

    const runtimeA = createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: cred.openaiCompatible,
      secrets: cred.secrets,
      registerOpenAiStub: false,
      searchCapability: false,
      externalExecutorCapability: false,
      digitalSelfChat: emptySelfChat(),
    });
    const busA = createCommandBus(runtimeA);
    const pkgA = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-aifirst-real-a-'));
    await busA.invoke('subject.createPackage', { displayName: 'A', targetDir: pkgA });
    const talkedA = await busA.invoke('talk', { text: '你好，你能帮我做什么？' });
    const recA = JSON.parse(await fs.readFile(talkThreadFilePath(pkgA), 'utf8')) as {
      executions?: Array<{ capabilityId: string }>;
    };
    const lastA = [...talkedA.view.turns].reverse().find((t) => t.role === 'assistant');
    const aUsedCoding = (recA.executions || []).some((e) =>
      /codex|acquired_coding|external_executor/i.test(e.capabilityId),
    );
    report.A = {
      text: String(lastA?.text || '').slice(0, 500),
      executions: (recA.executions || []).map((e) => e.capabilityId),
      usedCodingAgent: aUsedCoding,
    };
    assert.equal(String(lastA?.text || '').trim().length > 0, true);
    assert.equal(aUsedCoding, false, 'SMOKE A 不得调用 Coding Agent');
    await runtimeA.stop();

    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-aifirst-trial-'));
    await fs.writeFile(
      path.join(project, 'index.html'),
      '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>试用页</title></head><body><h1>试用页</h1><p>简单网页</p></body></html>\n',
      'utf8',
    );
    const pkgB = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-aifirst-real-b-'));
    const runtimeB = createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: cred.openaiCompatible,
      secrets: cred.secrets,
      registerOpenAiStub: false,
      searchCapability: false,
      externalExecutorCapability: false,
      digitalSelfChat: emptySelfChat(),
    });
    const busB = createCommandBus(runtimeB);
    await busB.invoke('subject.createPackage', { displayName: 'B', targetDir: pkgB });
    const talkedB = await busB.invoke('talk', {
      text: '给这个网页增加明暗主题切换，并补 README。',
      contextPaths: [project],
    });
    const recB = JSON.parse(await fs.readFile(talkThreadFilePath(pkgB), 'utf8')) as {
      executions?: Array<{ capabilityId: string; ok?: boolean }>;
    };
    const namesB = await fs.readdir(project);
    const htmlAfter = await fs.readFile(path.join(project, 'index.html'), 'utf8');
    const readmeAfter = namesB.includes('README.md')
      ? await fs.readFile(path.join(project, 'README.md'), 'utf8')
      : '';
    const lastB = [...talkedB.view.turns].reverse().find((t) => t.role === 'assistant');
    const bUsedWrite = (recB.executions || []).some((e) => e.capabilityId === 'write_file' && e.ok);
    const bUsedCoding = (recB.executions || []).some((e) =>
      /codex|acquired_coding|external_executor/i.test(e.capabilityId),
    );
    const diskChanged =
      /dark|theme|明暗|classList|prefers-color-scheme/i.test(htmlAfter) && readmeAfter.trim().length > 0;
    report.B = {
      text: String(lastB?.text || '').slice(0, 500),
      executions: (recB.executions || []).map((e) => `${e.capabilityId}:${e.ok}`),
      files: namesB,
      usedWriteFile: bUsedWrite,
      usedOpenCode: bUsedCoding,
      diskChanged,
    };
    assert.equal(diskChanged, true, 'SMOKE B 授权目录应有主题切换和 README');
    assert.equal(bUsedCoding, false, 'SMOKE B 不要求 OpenCode');
    await runtimeB.stop();

    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-aifirst-math-'));
    await fs.writeFile(
      path.join(repo, 'add.js'),
      'function add(a, b) { return a - b; }\nmodule.exports = { add };\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repo, 'add.test.js'),
      "const { add } = require('./add');\nif (add(2, 3) !== 5) throw new Error('add broken');\nconsole.log('ok');\n",
      'utf8',
    );
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"tiny-math","version":"1.0.0"}\n', 'utf8');
    const pkgC = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-aifirst-real-c-'));
    let cPrompt = '';
    let cCwd = '';
    const runtimeC = createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: cred.openaiCompatible,
      secrets: cred.secrets,
      registerOpenAiStub: false,
      searchCapability: false,
      externalExecutorCapability: false,
      digitalSelfChat: emptySelfChat(),
      acquiredCodingCapability: {
        runtimeRoot: path.join(pkgC, 'runtimes'),
        executeHook: async ({ workingDirectory, prompt }) => {
          cPrompt = prompt;
          cCwd = workingDirectory;
          assert.equal(/executor-task-package|外部代码执行器|验收条件/.test(prompt), false);
          await fs.writeFile(
            path.join(workingDirectory, 'add.js'),
            'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
            'utf8',
          );
          return { exitCode: 0, summary: 'fixed add.js', claimedChangedFiles: ['add.js'] };
        },
      },
    });
    const busC = createCommandBus(runtimeC);
    await busC.invoke('subject.createPackage', { displayName: 'C', targetDir: pkgC });
    const talkedC = await busC.invoke('talk', {
      text: '这个小仓库的加法实现和测试对不上。请分析 add.js 与 add.test.js 的跨文件问题，修好实现并跑测试。',
      contextPaths: [repo],
    });
    const recC = JSON.parse(await fs.readFile(talkThreadFilePath(pkgC), 'utf8')) as {
      executions?: Array<{ capabilityId: string; ok?: boolean }>;
    };
    const lastC = [...talkedC.view.turns].reverse().find((t) => t.role === 'assistant');
    const addAfter = await fs.readFile(path.join(repo, 'add.js'), 'utf8');
    const cDelegated = (recC.executions || []).some(
      (e) => e.capabilityId === 'cap_acquired_coding_runtime',
    );
    const cWrote = (recC.executions || []).some((e) => e.capabilityId === 'write_file' && e.ok);
    const cDisk = /a \+ b/.test(addAfter);
    report.C = {
      text: String(lastC?.text || '').slice(0, 500),
      executions: (recC.executions || []).map((e) => `${e.capabilityId}:${e.ok}`),
      delegated: cDelegated,
      usedWriteFile: cWrote,
      diskFixed: cDisk,
      cwd: cCwd,
      promptPreview: cPrompt.slice(0, 600),
      promptHasTaskPackage: /executor-task-package|外部代码执行器|验收条件/.test(cPrompt),
    };
    assert.equal(cDisk, true, 'SMOKE C 磁盘应修好加法');
    if (cDelegated) {
      assert.equal(/executor-task-package|外部代码执行器|验收条件/.test(cPrompt), false);
      assert.match(cPrompt, /工作目录/);
      assert.match(cPrompt, /机械边界/);
    }
    await runtimeC.stop();

    await fs.writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  },
);
