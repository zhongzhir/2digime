/**
 * 已有能力暴露到 Talk：list_directory / read_file / export_file。
 * 不新建第二套 tool loop；不做关键词选文件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { buildDocxFromMarkdown } from '../../infrastructure/export';
import { extractFile } from '../../infrastructure/extract';
import { classifyAuthorizedPaths, runReadFile } from '../mechanical-tools';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-expose-${prefix}-`));
}

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

async function readExec(pkgDir: string): Promise<Array<{ capabilityId: string; ok: boolean }>> {
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions?: Array<{ capabilityId: string; ok: boolean }>;
  };
  return rec.executions || [];
}

test('无附件时不暴露 list_directory / read_file，暴露 export_file', async () => {
  const root = await tempDir('tools');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        const names = (tools || []).map((t) => t.function.name);
        assert.equal(names.includes('write_file'), true);
        assert.equal(names.includes('export_file'), true);
        assert.equal(names.includes('list_directory'), false);
        assert.equal(names.includes('read_file'), false);
        return { text: '请用“+”附上那个文件夹。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '暴露', targetDir: pkgDir });
  await bus.invoke('talk', { text: '看看 E:\\AutoBiz 给我建议' });
  await runtime.stop();
});

test('授权文件夹后模型自己 list 再 read，runtime 不预选文件', async () => {
  const root = await tempDir('folder');
  const folder = path.join(root, 'AutoBiz');
  const pkgDir = path.join(root, 'pkg');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'notes.md'), '# 当前项目\n\n正在做本地优先的数字资产变现。\n', 'utf8');
  await fs.writeFile(path.join(folder, 'noise.txt'), '无关备忘', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        const names = (tools || []).map((t) => t.function.name);
        assert.equal(names.includes('list_directory'), true);
        assert.equal(names.includes('read_file'), true);
        return {
          text: '',
          toolCalls: [{ id: 'l1', name: 'list_directory', arguments: JSON.stringify({ path: '' }) }],
        };
      },
      async ({ messages, tools }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.match(tool, /notes\.md/);
        assert.match(tool, /noise\.txt/);
        assert.equal(tool.includes('score'), false);
        assert.equal(tools?.some((t) => t.function.name === 'list_directory'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'r1',
              name: 'read_file',
              arguments: JSON.stringify({ path: 'notes.md' }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.match(tool, /本地优先的数字资产变现/);
        return { text: '建议把本地优先交付写得更具体，尤其是真实文件闭环。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '暴露', targetDir: pkgDir });
  const talked = await bus.invoke('talk', {
    text: '你看下这个文件夹的内容，就我正在做的这件事来说，有什么改进建议？',
    contextPaths: [folder],
  });
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /本地优先|真实文件/);
  const exec = await readExec(pkgDir);
  assert.deepEqual(
    exec.map((e) => `${e.capabilityId}:${e.ok}`),
    ['list_directory:true', 'read_file:true'],
  );
  await runtime.stop();
});

test('授权单文件 docx 时 read_file 复用 extract.ts 正文', async () => {
  const root = await tempDir('docx');
  const pkgDir = path.join(root, 'pkg');
  const docxPath = path.join(root, 'global_digital_asset_monetization_full_13_paths.docx');
  await fs.writeFile(
    docxPath,
    buildDocxFromMarkdown('# 十三条路径\n\n第一条：把数字资产变成可交付产品。'),
  );
  const extracted = await extractFile(docxPath);
  assert.equal(extracted.status, 'ok');
  assert.match(String(extracted.text || ''), /十三条路径/);
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'read_file'), true);
        assert.equal(tools?.some((t) => t.function.name === 'list_directory'), false);
        return {
          text: '',
          toolCalls: [{ id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: docxPath }) }],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.match(tool, /十三条路径/);
        assert.match(tool, /可交付产品/);
        return { text: '建议把第一条改成可验收的交付物，而不是概念清单。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '暴露', targetDir: pkgDir });
  await bus.invoke('talk', {
    text: '这是其中一份文件，看看有什么意见建议。',
    contextPaths: [docxPath],
  });
  const exec = await readExec(pkgDir);
  assert.deepEqual(
    exec.map((e) => `${e.capabilityId}:${e.ok}`),
    ['read_file:true'],
  );
  await runtime.stop();
});

test('越权路径不得 list / read', async () => {
  const root = await tempDir('fence');
  const folder = path.join(root, 'allowed');
  const secret = path.join(root, 'secret.txt');
  const pkgDir = path.join(root, 'pkg');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'ok.txt'), '可见', 'utf8');
  await fs.writeFile(secret, '秘密', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'r1',
            name: 'read_file',
            arguments: JSON.stringify({ path: secret }),
          },
        ],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":false/);
        assert.equal(tool.includes('秘密'), false);
        return { text: '这次没有读到未授权文件。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '围栏', targetDir: pkgDir });
  await bus.invoke('talk', { text: '读一下旁边的文件', contextPaths: [folder] });
  await runtime.stop();
});

test('export_file 复用 export.ts 写出真实 docx 与 pptx', async () => {
  const root = await tempDir('office');
  const pkgDir = path.join(root, 'pkg');
  const outline = '# 数字资产变现大纲\n\n- 先交付真实文件\n- 再谈规模化';
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'export_file'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'e1',
              name: 'export_file',
              arguments: JSON.stringify({
                format: 'docx',
                relativePath: 'outline.docx',
                content: outline,
              }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.match(tool, /outline\.docx/);
        return { text: 'Word 已经写好。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '导出', targetDir: pkgDir });
  const docxTalk = await bus.invoke('talk', { text: '把刚才的大纲做成 Word。' });
  const docxAbs = path.join(pkgDir, 'intelligence', 'outputs', 'outline.docx');
  const docxBytes = await fs.readFile(docxAbs);
  assert.equal(docxBytes.subarray(0, 2).toString(), 'PK');
  const roundtrip = await extractFile(docxAbs);
  assert.match(String(roundtrip.text || ''), /数字资产变现大纲/);
  assert.equal(docxTalk.view.turns.some((t) => t.result?.path === docxAbs), true);

  const pptRoot = await tempDir('office-ppt');
  const pptPkg = path.join(pptRoot, 'pkg');
  const pptRuntime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'e2',
            name: 'export_file',
            arguments: JSON.stringify({
              format: 'pptx',
              relativePath: 'proposal.pptx',
              content: outline,
            }),
          },
        ],
      }),
      async () => ({ text: '开会提案 PPT 已经写好。' }),
    ]),
    talkProfessionals: [],
  });
  const pptBus = createCommandBus(pptRuntime);
  await pptBus.invoke('subject.createPackage', { displayName: '导出', targetDir: pptPkg });
  await pptBus.invoke('talk', { text: '再做成开会提案用的 PPT。' });
  const pptxAbs = path.join(pptPkg, 'intelligence', 'outputs', 'proposal.pptx');
  const pptxBytes = await fs.readFile(pptxAbs);
  assert.equal(pptxBytes.subarray(0, 2).toString(), 'PK');
  const pptText = await extractFile(pptxAbs);
  assert.match(String(pptText.text || ''), /数字资产变现大纲|先交付真实文件/);
  await runtime.stop();
  await pptRuntime.stop();
});

test('授权仓库内 .js/.json/README 按真实文本读取，不按扩展名拒绝', async () => {
  const root = await tempDir('src-text');
  const folder = path.join(root, 'repo');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'math.js'), 'function add(a, b) { return a + b; }\n', 'utf8');
  await fs.writeFile(path.join(folder, 'package.json'), '{"name":"tiny-add","version":"1.0.0"}\n', 'utf8');
  await fs.writeFile(path.join(folder, 'README.md'), '# tiny-add\n\nFix add and run tests.\n', 'utf8');
  const auth = classifyAuthorizedPaths([folder]);
  const js = JSON.parse(await runReadFile(auth, JSON.stringify({ path: 'math.js' }))) as {
    actualSuccess?: boolean;
    content?: string;
    failureReason?: string;
  };
  const json = JSON.parse(await runReadFile(auth, JSON.stringify({ path: 'package.json' }))) as {
    actualSuccess?: boolean;
    content?: string;
    failureReason?: string;
  };
  const readme = JSON.parse(await runReadFile(auth, JSON.stringify({ path: 'README.md' }))) as {
    actualSuccess?: boolean;
    content?: string;
  };
  assert.equal(js.actualSuccess, true, js.failureReason);
  assert.match(String(js.content || ''), /function add/);
  assert.equal(json.actualSuccess, true, json.failureReason);
  assert.match(String(json.content || ''), /tiny-add/);
  assert.equal(readme.actualSuccess, true);
  assert.match(String(readme.content || ''), /Fix add/);
  assert.equal(String(js.failureReason || '').includes('格式暂不支持'), false);
  assert.equal(String(json.failureReason || '').includes('格式暂不支持'), false);
});
