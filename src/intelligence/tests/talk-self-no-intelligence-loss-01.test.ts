/**
 * Digital Self compiler 把 live 认识交给模型，status 只表示确定程度。
 * 不按姓名特判，不做 relevance selector。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { formatSelfContext, selectSelfContext } from '../self-context';
import { applyImportProposals, applyTellProposals } from '../../subject-core/digital-self/apply';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import type { TalkChatFn } from '../types';
import { buildFixtureResumeDocx, FIXTURE_NAME } from '../../infrastructure/tests/feedback-loop-02-fixtures';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-self-nofilter-${prefix}-`));
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

function emptySelf(): DigitalSelf {
  return {
    schemaVersion: 1,
    subjectId: 's',
    updatedAt: '2026-09-06T00:00:00.000Z',
    understandings: [],
  };
}

test('compiler 同时给出已确认与尚待确认，不把 needs_ask 升级为 current', () => {
  let self = emptySelf();
  self = applyTellProposals(
    self,
    [
      {
        text: '技术问题希望用大白话',
        facet: 'preferences',
        aboutUser: true,
        origin: 'user_statement',
        lasting: true,
      },
    ],
    '2026-09-06T00:00:00.000Z',
  ).self;
  self = applyImportProposals(
    self,
    [
      {
        text: `用户的姓名为${FIXTURE_NAME}`,
        facet: 'about_me',
        aboutUser: true,
        origin: 'material',
        isCoreIdentity: true,
        lasting: true,
      },
      {
        text: '资料称用户不参与高风险工程合作',
        facet: 'boundaries',
        aboutUser: true,
        origin: 'material',
        isBoundary: true,
        lasting: true,
      },
    ],
    '2026-09-06T00:00:00.000Z',
    'resume.docx',
  ).self;
  const items = selectSelfContext(self, '随便问一句');
  assert.ok(items.some((item) => item.status === 'current' && /大白话/.test(item.text)));
  assert.ok(items.some((item) => item.status === 'needs_ask' && item.text.includes(FIXTURE_NAME)));
  assert.ok(items.some((item) => item.status === 'needs_ask' && /工程合作/.test(item.text)));
  const text = formatSelfContext(items);
  assert.match(text, /已确认：/);
  assert.match(text, /技术问题希望用大白话/);
  assert.match(text, /尚待确认：/);
  assert.match(text, new RegExp(FIXTURE_NAME));
  assert.match(text, /资料称用户不参与高风险工程合作/);
  assert.match(text, /resume\.docx/);
  assert.equal(self.understandings.find((item) => item.text.includes(FIXTURE_NAME))?.status, 'needs_ask');
});

test('A 简历 needs_ask 进入 Talk；模型看得到姓名且看到尚未确认', async () => {
  const root = await tempDir('a');
  const pkgDir = path.join(root, 'pkg');
  const resumePath = path.join(root, 'resume.docx');
  await fs.writeFile(resumePath, buildFixtureResumeDocx());
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: async ({ messages }) => {
      const prompt = String(messages.filter((m) => m.role === 'user').pop()?.content || '');
      const modeLine = prompt.split('===DIGITAL_SELF_MODE===')[1]?.trim().split(/\n/)[0] || '';
      if (modeLine === 'import') {
        return {
          text: JSON.stringify({
            understandings: [
              {
                text: `用户的姓名为${FIXTURE_NAME}`,
                facet: 'about_me',
                aboutUser: true,
                origin: 'material',
                isCoreIdentity: true,
                lasting: true,
              },
            ],
          }),
        };
      }
      return { text: JSON.stringify({ understandings: [] }) };
    },
    talkChat: scriptedChat([
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        const selfBlock = sys.slice(sys.indexOf('当前对用户的必要理解'));
        assert.match(selfBlock, new RegExp(FIXTURE_NAME));
        assert.match(selfBlock, /尚待确认/);
        assert.match(selfBlock, /resume\.docx|来自资料/);
        const pending = selfBlock.slice(selfBlock.indexOf('尚待确认：'));
        const confirmed = selfBlock.slice(0, Math.max(0, selfBlock.indexOf('尚待确认：')));
        assert.match(pending, new RegExp(FIXTURE_NAME));
        assert.equal(confirmed.includes(FIXTURE_NAME), false);
        return { text: `简历里写的是${FIXTURE_NAME}，但这是资料里的，还没请你确认。` };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '主体', targetDir: pkgDir });
  await bus.invoke('digitalSelf', { action: 'import', filePath: resumePath });
  const talked = await bus.invoke('talk', { text: '你知道我的名字吗？' });
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), new RegExp(FIXTURE_NAME));
  assert.match(String(last?.text || ''), /资料|还没|尚未|确认/);
  await runtime.stop();
});

test('B 用户亲口确认后，姓名成为已确认事实', async () => {
  const root = await tempDir('b');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: async ({ messages }) => {
      const prompt = String(messages.filter((m) => m.role === 'user').pop()?.content || '');
      const modeStart = prompt.indexOf('===DIGITAL_SELF_MODE===');
      const inputStart = prompt.indexOf('===DIGITAL_SELF_INPUT===');
      const mode = modeStart >= 0 ? prompt.slice(modeStart + '===DIGITAL_SELF_MODE==='.length).trim().split(/\n/)[0] : '';
      const input = inputStart >= 0 ? prompt.slice(inputStart + '===DIGITAL_SELF_INPUT==='.length).trim() : '';
      if (mode === 'tell' && /张元林/.test(input)) {
        return {
          text: JSON.stringify({
            understandings: [
              {
                text: '用户姓名为张元林，可称为元林',
                facet: 'about_me',
                aboutUser: true,
                origin: 'user_statement',
                lasting: true,
              },
            ],
          }),
        };
      }
      return { text: JSON.stringify({ understandings: [] }) };
    },
    talkChat: scriptedChat([
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /已确认/);
        assert.match(sys, /张元林|元林/);
        return { text: '好，我按张元林来理解，也可以叫你元林。' };
      },
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /已确认：[\s\S]*张元林|已确认：[\s\S]*元林/);
        return { text: '你叫张元林，也可以叫你元林。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '主体', targetDir: pkgDir });
  await bus.invoke('talk', { text: '对，我叫张元林，你可以叫我元林。' });
  const asked = await bus.invoke('talk', { text: '我叫什么？' });
  const last = [...asked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /张元林|元林/);
  await runtime.stop();
});

test('C 普通 needs_ask 同样进入上下文，不是姓名特判', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
  const material = path.join(root, 'boundary.md');
  await fs.writeFile(material, '高风险工程合作我不参与。\n', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: async () => ({
      text: JSON.stringify({
        understandings: [
          {
            text: '资料称用户不参与高风险工程合作',
            facet: 'boundaries',
            aboutUser: true,
            origin: 'material',
            isBoundary: true,
            lasting: true,
          },
        ],
      }),
    }),
    talkChat: scriptedChat([
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /不参与高风险工程合作/);
        assert.match(sys, /尚待确认/);
        return { text: '资料里写过你不参与高风险工程合作，这还没作为已确认边界。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '主体', targetDir: pkgDir });
  await bus.invoke('digitalSelf', { action: 'import', filePath: material });
  const talked = await bus.invoke('talk', { text: '如果有人找我做高风险工程合作，我该怎么看？' });
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /高风险工程合作/);
  assert.match(String(last?.text || ''), /资料|还没|尚未|确认/);
  await runtime.stop();
});

test('D 无关问题不因 candidate 存在而被系统改路由', async () => {
  const root = await tempDir('d');
  const pkgDir = path.join(root, 'pkg');
  const resumePath = path.join(root, 'resume.docx');
  await fs.writeFile(resumePath, buildFixtureResumeDocx());
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: async () => ({
      text: JSON.stringify({
        understandings: [
          {
            text: `用户的姓名为${FIXTURE_NAME}`,
            facet: 'about_me',
            aboutUser: true,
            origin: 'material',
            isCoreIdentity: true,
            lasting: true,
          },
        ],
      }),
    }),
    talkChat: scriptedChat([
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        const user = String(messages.filter((m) => m.role === 'user').pop()?.content || '');
        assert.match(sys, new RegExp(FIXTURE_NAME));
        assert.match(user, /1\+1/);
        return { text: '1+1 等于 2。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '主体', targetDir: pkgDir });
  await bus.invoke('digitalSelf', { action: 'import', filePath: resumePath });
  const talked = await bus.invoke('talk', { text: '1+1 等于几？' });
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.equal(String(last?.text || ''), '1+1 等于 2。');
  await runtime.stop();
});
