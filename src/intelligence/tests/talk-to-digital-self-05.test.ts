/**
 * Talk → 唯一 Digital Self authority。不新开 memory / profile / 学习状态机。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { digitalSelfFilePath, readDigitalSelf } from '../../subject-core/digital-self/store';
import { liveUnderstandings } from '../../subject-core/digital-self/view';
import type { DigitalSelfChatFn } from '../../subject-core/digital-self/interpret';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-talk-self-${prefix}-`));
}

function section(prompt: string, name: string): string {
  const token = `===DIGITAL_SELF_${name}===`;
  const start = prompt.indexOf(token);
  if (start < 0) return '';
  const after = start + token.length;
  const next = prompt.indexOf('===DIGITAL_SELF_', after);
  return (next < 0 ? prompt.slice(after) : prompt.slice(after, next)).trim();
}

const learnChat: DigitalSelfChatFn = async ({ messages }) => {
  const user = messages.filter((m) => m.role === 'user').pop();
  const prompt = user?.content || '';
  const mode = section(prompt, 'MODE');
  const input = section(prompt, 'INPUT');
  const current = JSON.parse(section(prompt, 'CURRENT') || '[]') as Array<{
    id: string;
    text: string;
    status: string;
  }>;
  const live = current.filter(
    (item) => item.status === 'current' || item.status === 'candidate' || item.status === 'needs_ask',
  );
  const find = (re: RegExp) => live.find((item) => re.test(item.text));

  if (mode === 'import') {
    const understandings: unknown[] = [];
    if (/工程安全类外部合作我不参与/.test(input) || /不参与任何工程/.test(input)) {
      const oral = find(/低风险|可以提供/);
      understandings.push({
        text: '资料称用户不参与任何工程合作',
        facet: 'boundaries',
        aboutUser: true,
        origin: 'material',
        mustAsk: true,
        ...(oral ? { conflictsWithId: oral.id } : {}),
      });
    }
    return { text: JSON.stringify({ understandings }) };
  }

  if (/今天下午三点开会/.test(input)) {
    return { text: JSON.stringify({ understandings: [] }) };
  }
  if (/上午/.test(input) && /复杂工作/.test(input)) {
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '用户更喜欢上午处理复杂工作',
            facet: 'preferences',
            aboutUser: true,
            origin: 'user_statement',
          },
        ],
      }),
    };
  }
  if (/工程安全类外部合作我不参与/.test(input)) {
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '用户不参与工程安全类外部合作',
            facet: 'boundaries',
            aboutUser: true,
            origin: 'user_statement',
          },
        ],
      }),
    };
  }
  if (/低风险非最终责任意见可以提供/.test(input) || /愿意参与低风险工艺安全/.test(input)) {
    const old = find(/不参与工程安全|工程安全类外部合作/);
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '用户可以提供低风险、非最终责任的工艺安全意见，高风险工程决策仍需先问本人',
            facet: 'boundaries',
            aboutUser: true,
            origin: 'user_statement',
            ...(old ? { replacesId: old.id } : {}),
          },
        ],
      }),
    };
  }
  return { text: JSON.stringify({ understandings: [] }) };
};

const echoTalk: TalkChatFn = async ({ messages }) => {
  const sys = String(messages[0]?.content || '');
  const user = [...messages].reverse().find((m) => m.role === 'user');
  if (/需要用户亲自确认/.test(sys)) {
    return { text: '这件事和我现在对你的理解不太一样，我想先跟你确认一下再记下。' };
  }
  if (/了解我|你知道我/.test(String(user?.content || ''))) {
    const start = sys.indexOf('当前对用户的必要理解');
    const slice = start >= 0 ? sys.slice(start) : sys;
    return { text: `我现在这样理解你：\n${slice}` };
  }
  return { text: '好，我记下了，我们继续。' };
};

function leak(copy: string): boolean {
  return /是否保存到数字之我|GrowthEvent|learning store|conversation memory/i.test(copy);
}

test('A：Talk 中的持续偏好写入 Digital Self', async () => {
  const root = await tempDir('a');
  const pkg = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: learnChat,
    talkChat: echoTalk,
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '学习主体', targetDir: pkg });
    const talked = await bus.invoke('talk', { text: '我以后更喜欢上午处理复杂工作。' });
    const blob = talked.view.turns.map((t) => t.text).join('\n');
    assert.equal(leak(blob), false);
    const view = (await bus.invoke('digitalSelf', { action: 'read' })).view;
    assert.ok(view.groups.preferences.some((item) => /上午/.test(item.text) && /复杂/.test(item.text)));
    const stored = await readDigitalSelf(pkg, (await bus.invoke('subject.getOverview', {})).subjectId, new Date().toISOString());
    assert.ok(
      liveUnderstandings(stored).some(
        (item) => item.status === 'current' && /上午/.test(item.text) && item.provenance.origin === 'user_statement',
      ),
    );
  } finally {
    await runtime.stop();
  }
});

test('B：一次性日程不沉淀为长期 Digital Self', async () => {
  const root = await tempDir('b');
  const pkg = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: learnChat,
    talkChat: echoTalk,
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '学习主体', targetDir: pkg });
    await bus.invoke('talk', { text: '今天下午三点开会。' });
    const view = (await bus.invoke('digitalSelf', { action: 'read' })).view;
    const all = JSON.stringify(view);
    assert.equal(/三点|开会/.test(all), false);
  } finally {
    await runtime.stop();
  }
});

test('C：Talk 纠正后当前边界更新，不并存冲突', async () => {
  const root = await tempDir('c');
  const pkg = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: learnChat,
    talkChat: echoTalk,
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '学习主体', targetDir: pkg });
    await bus.invoke('talk', { text: '工程安全类外部合作我不参与。' });
    await bus.invoke('talk', { text: '低风险非最终责任意见可以提供。' });
    const view = (await bus.invoke('digitalSelf', { action: 'read' })).view;
    const current = view.groups.boundaries.map((item) => item.text).join('\n');
    assert.match(current, /低风险/);
    assert.equal(view.groups.boundaries.some((item) => item.text.includes('不参与工程安全类外部合作')), false);
    const overviewId = (await bus.invoke('subject.getOverview', {})).subjectId;
    const stored = await readDigitalSelf(pkg, overviewId, new Date().toISOString());
    const live = liveUnderstandings(stored).filter((item) => item.facet === 'boundaries' && item.status === 'current');
    assert.equal(live.length, 1);
    assert.match(live[0]?.text || '', /低风险/);
  } finally {
    await runtime.stop();
  }
});

test('D：资料候选不得覆盖 Talk 亲口当前表达', async () => {
  const root = await tempDir('d');
  const pkg = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: learnChat,
    talkChat: echoTalk,
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '学习主体', targetDir: pkg });
    await bus.invoke('talk', { text: '低风险非最终责任意见可以提供。' });
    const material = path.join(root, 'conflict.md');
    await fs.writeFile(material, '工程安全类外部合作我不参与。其余是无关备注。\n', 'utf8');
    const imported = await bus.invoke('digitalSelf', { action: 'import', filePath: material });
    assert.ok(imported.view.groups.boundaries.some((item) => /低风险/.test(item.text)));
    assert.equal(
      imported.view.groups.boundaries.some((item) => item.text.includes('不参与任何工程')),
      false,
    );
    assert.ok(imported.view.groups.learning.some((item) => /不参与/.test(item.text)));
  } finally {
    await runtime.stop();
  }
});

test('E：Talk 写入后重启仍保持', async () => {
  const root = await tempDir('e');
  const pkg = path.join(root, 'pkg');
  const first = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: learnChat,
    talkChat: echoTalk,
    talkProfessionals: [],
  });
  const firstBus = createCommandBus(first);
  let subjectId = '';
  try {
    const created = await firstBus.invoke('subject.createPackage', { displayName: '学习主体', targetDir: pkg });
    subjectId = created.subjectId;
    await firstBus.invoke('talk', { text: '我以后更喜欢上午处理复杂工作。' });
  } finally {
    await first.stop();
  }
  const second = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: learnChat,
    talkChat: echoTalk,
    talkProfessionals: [],
  });
  const secondBus = createCommandBus(second);
  try {
    await secondBus.invoke('subject.openPackage', { dir: pkg });
    const view = (await secondBus.invoke('digitalSelf', { action: 'read' })).view;
    assert.ok(view.groups.preferences.some((item) => /上午/.test(item.text)));
    const raw = await fs.readFile(digitalSelfFilePath(pkg), 'utf8');
    assert.match(raw, /上午处理复杂工作/);
    assert.equal(raw.includes('GrowthEvent'), false);
    assert.equal(subjectId.length > 0, true);
  } finally {
    await second.stop();
  }
});
