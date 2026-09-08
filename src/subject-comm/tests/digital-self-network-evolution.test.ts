/**
 * DIGITALME-DIGITAL-SELF-NETWORK-EVOLUTION-01
 * 防自我强化 + 现有 Talk learning。不建第二套 profile。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { applyTellProposals } from '../../subject-core/digital-self/apply';
import { digitalSelfFilePath, readDigitalSelf } from '../../subject-core/digital-self/store';
import { liveUnderstandings } from '../../subject-core/digital-self/view';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import type { DigitalSelfChatFn } from '../../subject-core/digital-self/interpret';
import type { TalkChatFn } from '../../intelligence/types';
import { selectNetworkItems } from '../personal-selection';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

function selfOf(subjectId: string, lines: string[]): DigitalSelf {
  const now = '2026-09-08T08:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: lines.map((text, index) => ({
      id: `u_${index + 1}`,
      text,
      facet: index === 0 ? 'about_me' : 'goals',
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
      updatedAt: now,
    })),
  };
}

const echoTalk: TalkChatFn = async () => ({ text: '记下了。' });

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
  const input = section(prompt, 'INPUT');
  if (/最近我确实开始关注 AI 游戏/.test(input)) {
    return {
      text: JSON.stringify({
        understandings: [
          {
            text: '用户开始关注人工智能在游戏中的应用',
            facet: 'preferences',
            aboutUser: true,
            origin: 'user_statement',
            lasting: true,
            excerpt: '最近我确实开始关注 AI 游戏',
          },
        ],
      }),
    };
  }
  return { text: JSON.stringify({ understandings: [] }) };
};

test('Case A: 2digime SHOW/IGNORE 不得改写 Digital Self', async () => {
  const digitalSelf = selfOf('subj_evo', ['我长期关心人工智能如何改变产品和投资判断。']);
  const before = structuredClone(digitalSelf);
  const subset = FEED_01_SEED_ITEMS.slice(0, 3);
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async () => ({
      text: JSON.stringify({
        decisions: subset.map((item, index) => ({
          itemId: item.itemId,
          decision: index === 0 ? 'show' : 'ignore',
          reason: '用户应该喜欢 AI 游戏',
        })),
      }),
    }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(digitalSelf, before);
});

test('Case B: 模型选择理由不得进入 self.json 权威', async () => {
  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
  assert.equal(src.includes('writeDigitalSelf'), false);
  assert.equal(src.includes('applyTellProposals'), false);
  assert.equal(src.includes("action: 'tell'"), false);
  assert.equal(src.includes('network-profile'), false);
  assert.equal(src.includes('feed-preferences'), false);
  assert.equal(src.includes('interestScore'), false);

  const digitalSelf = selfOf('subj_evo', ['我长期关心人工智能如何改变产品和投资判断。']);
  const applied = applyTellProposals(
    structuredClone(digitalSelf),
    [
      {
        text: '用户应该喜欢 AI 游戏',
        facet: 'preferences',
        aboutUser: true,
        origin: 'inference',
        lasting: true,
      },
    ],
    '2026-09-08T08:10:00.000Z',
  );
  const injected = liveUnderstandings(applied.self).find((item) => /应该喜欢 AI 游戏/.test(item.text));
  assert.ok(injected);
  assert.notEqual(injected?.status, 'current');
  assert.equal(injected?.confirmed, false);
  assert.equal(injected?.provenance.origin, 'inference');
  assert.equal(injected?.provenance.actor, 'model');
});

test('Case C: 真人明确说关注变化，经现有 Talk learning 写入 user_statement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-evo-c-'));
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
    const created = await bus.invoke('subject.createPackage', { displayName: '演化主体', targetDir: pkg });
    await bus.invoke('talk', { text: '最近我确实开始关注 AI 游戏。' });
    const stored = await readDigitalSelf(pkg, created.subjectId, new Date().toISOString());
    const hit = liveUnderstandings(stored).find((item) => /游戏/.test(item.text));
    assert.ok(hit, 'Talk 后应出现与游戏关注有关的理解');
    assert.equal(hit?.provenance.origin, 'user_statement');
    assert.equal(hit?.provenance.actor, 'owner');
    assert.equal(hit?.status, 'current');
    const dirents = await fs.readdir(path.join(pkg, 'digital-self'));
    assert.deepEqual(dirents.filter((name) => name !== 'sources'), ['self.json']);
    const raw = await fs.readFile(digitalSelfFilePath(pkg), 'utf8');
    assert.equal(raw.includes('network-profile'), false);
    assert.equal(raw.includes('feed-preferences'), false);
    assert.equal(raw.includes('interestScore'), false);
  } finally {
    await runtime.stop();
  }
});
