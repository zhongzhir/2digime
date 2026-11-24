import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTalkTurn } from '../loop';
import { emptyThread } from '../store';
import {
  createDigitalMeRuntime,
  isSpecificUnifiedResultUrl,
} from '../../runtime/digitalme-runtime';
import { providerCredentialKey } from '../../infrastructure/secret-store';

async function tempDir(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-' + name + '-'));
}

test('播客能力咨询直接回答，不申请目录权限也不写成果', async () => {
  const root = await tempDir('consult');
  let accessRequests = 0;
  const result = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '如果我给你说清楚数字之我的内容，你能不能起草一个标准的播客制作文件，给专业工具来完成制作。',
    selfContext: '',
    agents: [],
    workRoot: root,
    now: new Date().toISOString(),
    requestFolderAccess: async () => {
      accessRequests += 1;
      return true;
    },
    chat: async ({ tools }) => {
      assert.equal(tools?.some((tool) => tool.function.name === 'write_artifact'), true);
      return { text: '可以。我能先把内容整理成主持人、嘉宾、分段、台词和制作备注完整的制作文件；你明确委托保存时再生成成果。' };
    },
  });
  assert.equal(accessRequests, 0);
  assert.equal(result.thread.executions.length, 0);
  await assert.rejects(() => fs.stat(path.join(root, 'artifacts')));
});

test('明确委托直接写入应用成果区并把真实回读交回模型', async () => {
  const root = await tempDir('artifact');
  let step = 0;
  let accessRequests = 0;
  const content = [
    '# 播客制作文件',
    '',
    '## 角色',
    '- 主持人：提出问题',
    '- 嘉宾：分享数字之我的思考',
    '',
    '## 对话',
    '主持人：数字之我为什么值得长期建设？',
    '嘉宾：因为它要保存连续的理解、授权与成果。',
  ].join('\n');
  const result = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '请根据以下材料，现在生成播客制作文件，保存到应用成果区。材料：数字之我应当长期、安全并由本人授权。',
    selfContext: '',
    agents: [],
    workRoot: root,
    now: new Date().toISOString(),
    requestFolderAccess: async () => {
      accessRequests += 1;
      return true;
    },
    chat: async ({ tools, messages }) => {
      if (step++ === 0) {
        assert.equal(tools?.some((tool) => tool.function.name === 'write_artifact'), true);
        return {
          text: '',
          toolCalls: [{
            id: 'artifact_1',
            name: 'write_artifact',
            arguments: JSON.stringify({
              fileName: '播客制作文件.md',
              content,
            }),
          }],
        };
      }
      const fact = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
      assert.match(fact, /actualSuccess\":true/);
      assert.match(fact, /readback/);
      assert.match(fact, /播客制作文件/);
      return { text: '播客制作文件已保存到应用成果区，并已按实际文件回读确认。' };
    },
  });
  assert.equal(accessRequests, 0);
  const execution = result.thread.executions.find((row) => row.capabilityId === 'write_artifact');
  assert.equal(execution?.ok, true);
  assert.ok(execution?.outputPath);
  assert.equal(await fs.readFile(execution!.outputPath!, 'utf8'), content);
  const answer = result.thread.turns.at(-1);
  assert.equal(answer?.role, 'assistant');
  assert.equal(answer?.result?.path, execution?.outputPath);
  assert.match(answer?.text || '', /已保存.*回读确认/);
});

test('Talk 可直接生成 Word/PPT 应用成果并在下一轮继续读取', async () => {
  const root = await tempDir('office-artifact');
  const now = new Date().toISOString();
  const content = [
    '# 项目周报',
    '',
    '## 本周进展',
    '- 完成统一 Talk 主链',
    '- 保留真实执行回读',
    '',
    '## 下一步',
    '- 继续完善常用文档能力',
  ].join('\n');
  let wordStep = 0;
  const wordTurn = await runTalkTurn({
    thread: emptyThread(now),
    userText: '请把这份周报制作成 Word，保存到应用成果区。',
    selfContext: '',
    agents: [],
    workRoot: root,
    now,
    chat: async ({ tools, messages }) => {
      if (wordStep++ === 0) {
        const artifactTool = tools?.find((tool) => tool.function.name === 'write_artifact');
        assert.ok(artifactTool);
        assert.match(artifactTool!.function.description, /Word\/PPT/);
        return {
          text: '',
          toolCalls: [{
            id: 'word_1',
            name: 'write_artifact',
            arguments: JSON.stringify({ fileName: '项目周报.docx', content }),
          }],
        };
      }
      const fact = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
      assert.match(fact, /actualSuccess":true/);
      assert.match(fact, /项目周报/);
      return { text: 'Word 已生成并回读确认。' };
    },
  });

  const word = wordTurn.thread.executions.find((row) => row.outputPath?.endsWith('.docx'))?.outputPath;
  assert.ok(word);
  assert.ok((await fs.stat(word!)).size > 1000);
  assert.equal(wordTurn.thread.turns.at(-1)?.result?.path, word);

  let pptStep = 0;
  const pptTurn = await runTalkTurn({
    thread: wordTurn.thread,
    userText: '再把同一份周报制作成 PPT。',
    selfContext: '',
    agents: [],
    workRoot: root,
    now: new Date(Date.now() + 1000).toISOString(),
    chat: async ({ tools, messages }) => {
      if (pptStep++ === 0) {
        assert.equal(tools?.some((tool) => tool.function.name === 'write_artifact'), true);
        return {
          text: '',
          toolCalls: [{
            id: 'ppt_1',
            name: 'write_artifact',
            arguments: JSON.stringify({ fileName: '项目周报.pptx', content }),
          }],
        };
      }
      const fact = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
      assert.match(fact, /actualSuccess":true/);
      assert.match(fact, /项目周报/);
      return { text: 'PPT 已生成并回读确认。' };
    },
  });
  const ppt = pptTurn.thread.executions.find((row) => row.outputPath?.endsWith('.pptx'))?.outputPath;
  assert.ok(ppt);
  assert.ok((await fs.stat(ppt!)).size > 1000);
  assert.equal(pptTurn.thread.turns.at(-1)?.result?.path, ppt);

  let followStep = 0;
  const readTurn = await runTalkTurn({
    thread: pptTurn.thread,
    userText: '继续修改刚才的 Word，先读一下其中的内容。',
    selfContext: '',
    agents: [],
    workRoot: root,
    now: new Date(Date.now() + 2000).toISOString(),
    chat: async ({ tools, messages }) => {
      if (followStep++ === 0) {
        assert.equal(tools?.some((tool) => tool.function.name === 'read_file'), true);
        return {
          text: '',
          toolCalls: [{
            id: 'read_word_1',
            name: 'read_file',
            arguments: JSON.stringify({ path: word }),
          }],
        };
      }
      const fact = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
      assert.match(fact, /actualSuccess":true/);
      assert.match(fact, /项目周报/);
      assert.match(fact, /本周进展/);
      return { text: '已经读取，可以继续修改。' };
    },
  });
  assert.equal(readTurn.thread.executions.at(-1)?.capabilityId, 'read_file');
  assert.equal(readTurn.thread.executions.at(-1)?.ok, true);
});

test('Digital Self 前置解释复用北京 Responses 且不暴露 Web 工具', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody: Record<string, any> = {};
  const providerId = 'openai-compatible';
  const terminal = {
    id: 'resp_self_runtime',
    status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '{"understandings":[]}' }],
    }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, any>;
    return new Response(
      'data: ' + JSON.stringify({ type: 'response.completed', response: terminal }) + '\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };
  try {
    const runtime = createDigitalMeRuntime({
      registerOpenAiStub: false,
      searchCapability: false,
      openaiCompatible: {
        providerId,
        baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.8-flash',
      },
      secrets: {
        get: async (key) => key === providerCredentialKey(providerId) ? 'not-a-real-key' : null,
      },
    });
    const chat = (runtime as unknown as {
      resolveDigitalSelfChat(): ((input: { messages: Array<{ role: 'user'; content: string }> }) => Promise<{ text: string }>) | null;
    }).resolveDigitalSelfChat();
    assert.ok(chat);
    const response = await chat!({ messages: [{ role: 'user', content: '解释这一句。' }] });
    assert.match(requestUrl, /\/responses$/);
    assert.equal('tools' in requestBody, false);
    assert.equal('tool_choice' in requestBody, false);
    assert.equal(response.text, '{"understandings":[]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('统一结果来源完整性门拒绝实测首页并保留具体文章 URL', () => {
  assert.equal(isSpecificUnifiedResultUrl('https://www.techflowpost.com/'), false);
  assert.equal(isSpecificUnifiedResultUrl('https://www.wublock123.com/'), false);
  assert.equal(isSpecificUnifiedResultUrl('https://example.org/search?q=blockchain'), false);
  assert.equal(isSpecificUnifiedResultUrl('https://example.org/news/search?query=blockchain'), false);
  assert.equal(
    isSpecificUnifiedResultUrl('https://example.org/articles/blockchain-outlook?q=blockchain&utm_source=newsletter'),
    true,
  );
  assert.equal(
    isSpecificUnifiedResultUrl('https://example.org/articles/blockchain-outlook?query=reader&ref=home'),
    true,
  );
  assert.equal(
    isSpecificUnifiedResultUrl('https://m.cnyes.com/news/id/6624795'),
    true,
  );
  assert.equal(
    isSpecificUnifiedResultUrl('https://panteracapital.com/blockchain-letter/navigating-crypto-in-2026/'),
    true,
  );
});
