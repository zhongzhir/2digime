/**
 * OPPORTUNITY-MATCH-SEMANTIC-FIX-01
 * 自然语言意图 + 个人简介上下文；不依赖「提供/可以」模板词。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { SUBJECT_PACKAGE_LAYOUT } from '../../subject-core/subject-package';
import {
  buildLocalMatchContext,
  contextBlob,
  matchSignalLocally,
} from '../opportunity-match';
import { deriveSignalFieldsFromIntent, enrichSignalPayload } from '../signal-derive';
import type { SignalPayload } from '../signal';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-opp-sem-${prefix}-`));
}

const OWNER_INTENT =
  '我正在推进 Aivestor 和 Digital Me 的 Agent 能力升级，希望寻找关注金融投资、AI Agent、产品研发和联合参赛的合作伙伴，一起探索产品升级与赛事合作机会。';

const B_BRIEF =
  '拥有成熟金融应用场景（如 Aivestor），希望获得 Agent / Digital Me 技术能力升级，可联合参赛。';

async function openWithBrief(dir: string, name: string, brief: string) {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: name,
    targetDir: dir,
    initialSelfDescription: brief,
  });
  return runtime;
}

test('deriveSignalFields: 原始自然意图不被关键词模板改写', () => {
  const derived = deriveSignalFieldsFromIntent(OWNER_INTENT);
  assert.deepEqual(derived.offering, []);
  assert.deepEqual(derived.seeking, [OWNER_INTENT]);
  assert.doesNotMatch(OWNER_INTENT, /提供|可以提供/);
});

test('enrichSignalPayload: 纠正空壳 offering「相关能力与经验」', () => {
  const enriched = enrichSignalPayload({
    intent: OWNER_INTENT,
    seeking: ['成熟金融应用场景', 'Agent / Digital Me 技术能力'],
    offering: ['相关能力与经验'],
    disclosureLevel: 'minimal',
  });
  assert.deepEqual(enriched.offering, []);
  assert.deepEqual(enriched.seeking, ['成熟金融应用场景', 'Agent / Digital Me 技术能力']);
});

test('A: Owner 真实自然语言 + B 金融/Agent 简介 → potential_match（heuristic）', async () => {
  const root = await tempDir('a');
  const runtime = await openWithBrief(path.join(root, 'b'), 'MacB', B_BRIEF);
  try {
    const ctx = contextBlob(await buildLocalMatchContext(runtime));
    assert.match(ctx, /Aivestor|金融|Agent|Digital Me|联合参赛/i);
    assert.match(ctx, /个人简介/);

    const signal: SignalPayload = {
      intent: OWNER_INTENT,
      // 模拟旧版脆弱派生：故意给空壳 offering
      seeking: ['成熟金融应用场景', '联合参赛', 'Agent / Digital Me 技术能力'],
      offering: ['相关能力与经验'],
      disclosureLevel: 'minimal',
    };
    const match = await matchSignalLocally(runtime, signal, { forceHeuristic: true });
    assert.equal(match.verdict, 'potential_match');
    assert.ok(!/提供|可以/.test(signal.intent));
  } finally {
    await runtime.stop();
  }
});

test('B: 语义相近但措辞完全不同 → potential_match', async () => {
  const root = await tempDir('b');
  const runtime = await openWithBrief(
    path.join(root, 'b'),
    '伙伴乙',
    '我做投资科技产品，手里有可落地的财富管理场景；想找能一起打比赛的 Agent 协作伙伴。',
  );
  try {
    const signal: SignalPayload = {
      intent:
        '我们在打磨数字分身与智能体协作能力，想找有真实投研/理财产品场景的团队共同冲赛事。',
      seeking: ['无关占位'],
      offering: ['相关能力与经验'],
      disclosureLevel: 'minimal',
    };
    const match = await matchSignalLocally(runtime, signal, { forceHeuristic: true });
    assert.equal(match.verdict, 'potential_match');
    assert.doesNotMatch(signal.intent, /提供|可以/);
  } finally {
    await runtime.stop();
  }
});

test('C: 明显无关 Signal → no_match', async () => {
  const root = await tempDir('c');
  const runtime = await openWithBrief(path.join(root, 'b'), 'MacB', B_BRIEF);
  try {
    const signal: SignalPayload = {
      intent: '寻找量子芯片代工厂合作，讨论晶圆产能与光刻排期。',
      seeking: ['量子芯片代工厂'],
      offering: ['晶圆代工渠道'],
      disclosureLevel: 'minimal',
    };
    const match = await matchSignalLocally(runtime, signal, { forceHeuristic: true });
    assert.equal(match.verdict, 'no_match');
  } finally {
    await runtime.stop();
  }
});

test('个人简介材料确实进入匹配上下文', async () => {
  const root = await tempDir('intro');
  const dir = path.join(root, 'b');
  const runtime = await openWithBrief(dir, '简介主体', B_BRIEF);
  try {
    const materials = await fs.readdir(path.join(dir, 'materials'));
    assert.ok(materials.some((n) => n.startsWith('self_') && n.endsWith('.txt')));
    const built = await buildLocalMatchContext(runtime);
    const ctx = contextBlob(built);
    assert.ok(built.identityDescription.includes('Aivestor'));
    assert.match(ctx, /Aivestor/);
    assert.match(ctx, /个人简介/);
  } finally {
    await runtime.stop();
  }
});

test('旧主体包打开时沿既有 self material 迁移个人简介', async () => {
  const root = await tempDir('legacy-intro');
  const dir = path.join(root, 'b');
  const first = await openWithBrief(dir, '旧版主体', B_BRIEF);
  await first.stop();

  const manifestPath = path.join(dir, SUBJECT_PACKAGE_LAYOUT.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    identity: { displayName: string; description?: string };
  };
  delete manifest.identity.description;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const reopened = createDigitalMeRuntime({ documentCapability: 'fake' });
  try {
    await reopened.openPackage({ dir });
    const context = await buildLocalMatchContext(reopened);
    assert.equal(context.identityDescription, B_BRIEF);
  } finally {
    await reopened.stop();
  }
});

test('模型可用时优先走语义判断（注入 mock）', async () => {
  const root = await tempDir('model');
  const runtime = await openWithBrief(path.join(root, 'b'), 'MacB', B_BRIEF);
  try {
    let called = 0;
    const match = await matchSignalLocally(
      runtime,
      {
        intent: OWNER_INTENT,
        seeking: ['相关占位'],
        offering: ['相关能力与经验'],
        disclosureLevel: 'minimal',
      },
      {
        chatComplete: async (options) => {
          called += 1;
          assert.match(options.messages.map((message) => message.content).join('\n'), /Aivestor/);
          return {
            text: JSON.stringify({
              verdict: 'potential_match',
              matchKind: 'complementary',
            }),
          };
        },
      },
    );
    assert.equal(called, 1);
    assert.equal(match.verdict, 'potential_match');
    assert.match(match.response.whyWorthKnowing || '', /互补/);
  } finally {
    await runtime.stop();
  }
});
