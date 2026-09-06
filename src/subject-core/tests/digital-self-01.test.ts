import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DigitalSelfService } from '../digital-self/service';
import { digitalSelfFilePath, emptyDigitalSelf, readDigitalSelf } from '../digital-self/store';
import { liveUnderstandings } from '../digital-self/view';
import { applyTellProposals } from '../digital-self/apply';
import { interpretWithModel, type DigitalSelfChatFn } from '../digital-self/interpret';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-ds-'));
}

function section(prompt: string, name: string): string {
  const token = `===DIGITAL_SELF_${name}===`;
  const start = prompt.indexOf(token);
  if (start < 0) return '';
  const after = start + token.length;
  const next = prompt.indexOf('===DIGITAL_SELF_', after);
  return (next < 0 ? prompt.slice(after) : prompt.slice(after, next)).trim();
}

const scriptedChat: DigitalSelfChatFn = async ({ messages }) => {
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
    if (/我叫李四|姓名[是:：]\s*李四/.test(input)) {
      const zhang = find(/张三/);
      understandings.push({
        text: '姓名是李四',
        facet: 'about_me',
        aboutUser: true,
        origin: 'material',
        isCoreIdentity: true,
        mustAsk: true,
        ...(zhang ? { conflictsWithId: zhang.id } : {}),
      });
    }
    if (/我喜欢早起/.test(input)) {
      understandings.push({
        text: '偏好早起处理事情',
        facet: 'preferences',
        aboutUser: true,
        origin: 'material',
      });
    }
    if (/量子物理|薛定谔/.test(input) && understandings.length === 0) {
      return { text: JSON.stringify({ understandings: [] }) };
    }
    return { text: JSON.stringify({ understandings }) };
  }

  if (input.includes('我叫张三')) {
    const existing = find(/张三/);
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '姓名是张三',
            facet: 'about_me',
            aboutUser: true,
            origin: 'user_statement',
            ...(existing ? { mergeWithId: existing.id } : {}),
          },
        ],
      }),
    };
  }
  if (input.includes('主要在做 A 项目')) {
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '当前主要在做 A 项目',
            facet: 'context',
            aboutUser: true,
            origin: 'user_statement',
          },
        ],
      }),
    };
  }
  if (input.includes('应该是 B')) {
    const old = find(/A 项目/);
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '当前主要在做 B 项目',
            facet: 'context',
            aboutUser: true,
            origin: 'user_statement',
            ...(old ? { replacesId: old.id } : {}),
          },
        ],
      }),
    };
  }
  if (input.includes('可能住在上海')) {
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '可能住在上海',
            facet: 'about_me',
            aboutUser: true,
            origin: 'inference',
            mustAsk: true,
          },
        ],
      }),
    };
  }
  return { text: JSON.stringify({ understandings: [] }) };
};

function createService(rootDir: string, subjectId = 'subj_test') {
  return new DigitalSelfService(() => ({ rootDir, subjectId }), scriptedChat, () =>
    '2026-09-01T12:00:00.000Z',
  );
}

test('Digital Self：用户直述进入唯一权威，资料只做候选，纠正与删除可持久', async () => {
  const root = await tempDir();
  const service = createService(root);

  const named = await service.invoke({ action: 'tell', text: '我叫张三' });
  assert.equal(named.view.empty, false);
  assert.equal(named.view.groups.about_me.length, 1);
  const namedItem = named.view.groups.about_me[0];
  assert.ok(namedItem);
  assert.match(namedItem.text, /张三/);
  assert.equal(namedItem.confirmationLabel, '已确认');

  const project = await service.invoke({ action: 'tell', text: '我现在主要在做 A 项目' });
  assert.match(project.view.groups.goals.map((item) => item.text).join('\n'), /A 项目/);

  const mixed = path.join(root, 'mixed.md');
  await fs.writeFile(
    mixed,
    [
      '我喜欢早起处理事情。',
      '',
      '# 量子物理导论',
      '波函数坍缩是量子力学的基础概念。薛定谔方程描述了非相对论量子系统的演化。',
      '氢原子能级与泡利不相容原理属于教材内容，与本人无关。',
    ].join('\n'),
    'utf8',
  );
  const imported = await service.invoke({ action: 'import', filePath: mixed });
  const pageText = JSON.stringify(imported.view);
  assert.equal(pageText.includes('薛定谔'), false);
  assert.equal(pageText.includes('波函数'), false);
  assert.ok(imported.view.groups.learning.some((item) => item.text.includes('早起')));
  assert.equal(
    imported.view.groups.learning.every((item) => item.confirmationLabel !== '已确认'),
    true,
  );

  const inferred = await service.invoke({ action: 'tell', text: '可能住在上海' });
  const shanghai = inferred.view.groups.learning.find((item) => item.text.includes('上海'));
  assert.ok(shanghai);
  assert.equal(shanghai?.confirmationLabel === '已确认', false);

  const corrected = await service.invoke({
    action: 'tell',
    text: '刚才那个不对，应该是 B',
  });
  const goalText = corrected.view.groups.goals.map((item) => item.text).join('\n');
  assert.match(goalText, /B 项目/);
  assert.equal(goalText.includes('A 项目'), false);

  const beforeDup = corrected.view.groups.about_me.filter((item) => item.text.includes('张三')).length;
  const dup = await service.invoke({ action: 'tell', text: '我叫张三' });
  const afterDup = dup.view.groups.about_me.filter((item) => item.text.includes('张三')).length;
  assert.equal(afterDup, beforeDup);

  const conflictFile = path.join(root, 'other.md');
  await fs.writeFile(conflictFile, '我叫李四。其余是无关备注。', 'utf8');
  const conflicted = await service.invoke({ action: 'import', filePath: conflictFile });
  assert.ok(conflicted.view.groups.about_me.some((item) => item.text.includes('张三')));
  assert.equal(
    conflicted.view.groups.about_me.some((item) => item.text.includes('李四')),
    false,
  );
  const li = conflicted.view.groups.learning.find((item) => item.text.includes('李四'));
  assert.ok(li);
  assert.equal(conflicted.view.asked, true);

  const deletedPref = conflicted.view.groups.learning.find((item) => item.text.includes('早起'));
  assert.ok(deletedPref);
  await service.invoke({ action: 'delete', understandingId: deletedPref.id });

  const reloaded = createService(root);
  const again = await reloaded.invoke({ action: 'read' });
  assert.ok(again.view.groups.about_me.some((item) => item.text.includes('张三')));
  assert.ok(again.view.groups.goals.some((item) => item.text.includes('B 项目')));
  assert.equal(again.view.groups.goals.some((item) => item.text.includes('A 项目')), false);
  assert.equal(again.view.groups.learning.some((item) => item.text.includes('早起')), false);
  assert.ok(again.view.groups.learning.some((item) => item.text.includes('李四')));

  const stored = await readDigitalSelf(root, 'subj_test', '2026-09-01T12:00:00.000Z');
  assert.equal(liveUnderstandings(stored).filter((item) => item.text.includes('张三')).length, 1);
  const file = digitalSelfFilePath(root);
  const raw = await fs.readFile(file, 'utf8');
  assert.match(raw, /"schemaVersion": 1/);
  const growth = path.join(root, 'growth', 'events.jsonl');
  const growthExists = await fs.access(growth).then(
    () => true,
    () => false,
  );
  assert.equal(growthExists, false);
});

test('Digital Self 命令面走同一 authority，不经过 GrowthEvent', async () => {
  const root = await tempDir();
  const pkg = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: scriptedChat,
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '数字之我验收',
    targetDir: pkg,
  });
  const told = await bus.invoke('digitalSelf', { action: 'tell', text: '我叫张三' });
  assert.match(told.view.groups.about_me.map((item) => item.text).join('\n'), /张三/);
  const overview = await bus.invoke('subject.getOverview', {});
  const blob = JSON.stringify(overview);
  assert.equal(blob.includes('姓名是张三'), false);
  const selfFile = digitalSelfFilePath(pkg);
  const raw = await fs.readFile(selfFile, 'utf8');
  assert.match(raw, /张三/);
  await runtime.stop();
});

test('interpret 系统提示不做摘要式挑选，也无姓名特判', async () => {
  let sys = '';
  await interpretWithModel({
    chat: async ({ messages }) => {
      sys = String(messages[0]?.content || '');
      return { text: JSON.stringify({ understandings: [] }) };
    },
    mode: 'import',
    self: emptyDigitalSelf('subj_test', '2026-09-06T00:00:00.000Z'),
    text: '一份资料',
    materialName: 'resume.pdf',
  });
  assert.match(sys, /不要做摘要式挑选/);
  assert.match(sys, /已经写明的本人事实/);
  assert.equal(/只输出与用户本人有关、具有稳定主体意义、未来判断或行动用得上/.test(sys), false);
  assert.equal(/可以 lasting=true 的：用户明确的长期偏好/.test(sys), false);
  assert.equal(/姓名特判|姓名字段|第一行规则/.test(sys), false);
});

test('lasting=false 的一次性任务不得写入 current', () => {
  const self = emptyDigitalSelf('subj_test', '2026-09-05T00:00:00.000Z');
  const result = applyTellProposals(
    self,
    [
      {
        text: '用户当前想要一个数学网页小游戏',
        facet: 'goals',
        aboutUser: true,
        origin: 'user_statement',
        lasting: false,
      },
    ],
    '2026-09-05T00:00:00.000Z',
  );
  assert.equal(result.self.understandings.length, 0);
});
