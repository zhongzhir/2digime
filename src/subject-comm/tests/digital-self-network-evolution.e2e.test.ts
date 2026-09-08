/**
 * DIGITALME-DIGITAL-SELF-NETWORK-EVOLUTION-01
 * 真模型：Digital Self V1 → 同池选择 → Talk 学习 → V2 → 再选择。
 * 无凭证则 skip，不伪造成功。不直接编辑偏好变化。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { candidatePoolHash, type NetworkItem } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';
import { chatComplete } from '../../infrastructure/model-http';
import {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} from '../../infrastructure/env-secrets';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { digitalSelfFilePath, readDigitalSelf, writeDigitalSelf } from '../../subject-core/digital-self/store';
import { liveUnderstandings } from '../../subject-core/digital-self/view';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

const EVIDENCE_DIR = path.join(process.cwd(), 'build', 'evidence', 'digital-self-network-evolution-01');

const HUMAN_TALK =
  '最近我的关注有些变化。除了原来的方向，我现在开始重点关注 AI 对游戏产业的改变，尤其是 AI NPC、生成式内容、游戏的新交互和商业模式。纯融资新闻以后不用因为「AI」两个字就给我，除非它真的影响产品或产业格局。';

const UNRELATED_IDS = ['ni_04', 'ni_08', 'ni_18', 'ni_25'];
const GAME_AI_IDS = ['ni_33', 'ni_34', 'ni_35'];

function extraItem(n: number, title: string, text: string): NetworkItem {
  return {
    schemaVersion: 1,
    itemId: `ni_${String(n).padStart(2, '0')}`,
    publisherSubjectId: 'subj_seed_publisher',
    publisherDisplayName: '公开候选试验源',
    kind: 'content',
    createdAt: `2026-09-08T04:${String(n).padStart(2, '0')}:00.000Z`,
    visibility: 'public',
    content: { title, text },
    provenance: { origin: 'seed', actor: 'owner', statedAt: '2026-09-08T04:00:00.000Z' },
  };
}

/** 复用上一轮 32 条，并加入与本轮真人表达相关的公开候选。不操纵 selector。 */
const EVOLUTION_POOL: NetworkItem[] = [
  ...FEED_01_SEED_ITEMS,
  extraItem(
    33,
    '工作室用大模型驱动 NPC，任务不再挂在任务板上',
    '几个团队让 NPC 按玩家对话现场编任务。讨论集中在表演权、对话记忆归属，以及这会不会改写开放世界的制作成本，而不是又一轮角色皮肤。',
  ),
  extraItem(
    34,
    '生成式关卡让买断制游戏开始卖当季内容权',
    '制作人说关卡可以按周生成，于是把一次买断改成「本季可玩范围」。这是游戏商业模式变化，也是生成式内容一旦进入玩法后的授权问题。',
  ),
  extraItem(
    35,
    '玩家对话被拿去训练游戏 NPC，工会在谈肖像和表演权',
    '一份行业纪要写：语音和文本进了训练集后，角色会越来越像某个社区。律师关心的是人的数字痕迹，制作组关心的是 NPC 是否更像活人。',
  ),
  extraItem(
    36,
    '某AI芯片公司完成新一轮融资',
    '新闻只公布估值、领投方和交割时间，没有新产品、没有出货变化，也没有说明这会怎样改变下游应用。',
  ),
];

function selfV1(subjectId: string): DigitalSelf {
  const now = '2026-09-08T08:00:00.000Z';
  const lines: Array<{ text: string; facet: DigitalSelf['understandings'][number]['facet'] }> = [
    { facet: 'about_me', text: '我长期关注人工智能如何改变产业组织、产品形态和投资判断。' },
    { facet: 'goals', text: '正在做数字产品和创业，想看清 PE/VC 如何理解新模式，而不是追短期热点。' },
    { facet: 'goals', text: '文化产业与数字内容如果能形成新的主体和授权关系，我会认真看。' },
    { facet: 'preferences', text: '纯娱乐八卦、只为放松的综艺对我价值低，除非能看到产业、权利或产品含义。' },
    { facet: 'boundaries', text: '不希望平台按隐式画像替我决定看什么；选择应留在我自己的数字之我。' },
  ];
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: lines.map((line, index) => ({
      id: `u_${index + 1}`,
      text: line.text,
      facet: line.facet,
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
      updatedAt: now,
    })),
  };
}

function semanticDiff(v1: DigitalSelf, v2: DigitalSelf) {
  const text = (self: DigitalSelf) =>
    liveUnderstandings(self)
      .filter((item) => item.status === 'current')
      .map((item) => item.text)
      .sort();
  const a = new Set(text(v1));
  const b = new Set(text(v2));
  return {
    added: [...b].filter((row) => !a.has(row)),
    removed: [...a].filter((row) => !b.has(row)),
  };
}

async function listenRelay(): Promise<{ server: Server; relayUrl: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-evo01-relay-'));
  const { server } = createRelayServer({
    store: new FileRelayStore(dataDir),
    networkItems: new FileNetworkItemStore(dataDir),
    host: '127.0.0.1',
    port: 0,
  });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}` };
}

test(
  'EVOLUTION-01 real model: Talk updates Digital Self, same pool selection changes',
  { timeout: 900_000 },
  async (t) => {
    const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
    const runtimeCred = resolved.runtime;
    const apiKey =
      runtimeCred?.apiKey ||
      process.env.DIGITALME_MODEL_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';
    if (!resolved.configured && !apiKey) {
      t.skip('no model credential; blocked without fabricating success');
      return;
    }
    const baseUrl = runtimeCred?.baseUrl || resolved.baseUrl;
    const model = runtimeCred?.model || resolved.model;
    const providerId = runtimeCred?.providerId || resolved.providerId;

    const pkgRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-evo01-pkg-'));
    const pkgDir = path.join(pkgRoot, 'pkg');
    const dm = createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: {
        baseUrl,
        model,
        providerId,
        displayName: 'evolution-trial',
        timeoutMs: 180_000,
      },
      secrets: createEnvSecretAccessor(process.env, providerId, runtimeCred),
      registerOpenAiStub: false,
      talkProfessionals: [],
    });
    const bus = createCommandBus(dm);
    const { server, relayUrl } = await listenRelay();
    try {
      const created = await bus.invoke('subject.createPackage', {
        displayName: '网络演化主体',
        targetDir: pkgDir,
      });
      const v1 = selfV1(created.subjectId);
      await writeDigitalSelf(pkgDir, v1);
      const selfBeforeSelect = JSON.parse(await fs.readFile(digitalSelfFilePath(pkgDir), 'utf8')) as DigitalSelf;

      const client = new RelayClient(relayUrl);
      for (const item of EVOLUTION_POOL) {
        await client.publishNetworkItem(item);
      }
      const query = { kind: 'content', visibility: 'public', limit: 50 } as const;
      const listed1 = await client.listNetworkItems(query);
      const ids1 = listed1.items.map((item) => item.itemId);
      assert.equal(ids1.length, EVOLUTION_POOL.length);
      const poolHash1 = candidatePoolHash(ids1);

      const chat = async (options: Parameters<typeof chatComplete>[0]) =>
        chatComplete({
          ...options,
          apiKey,
          baseUrl,
          model,
        });

      const selected1 = await selectNetworkItems({
        digitalSelf: await readDigitalSelf(pkgDir, created.subjectId, new Date().toISOString()),
        items: listed1.items,
        chatComplete: chat,
        model: { baseUrl, model, apiKey },
      });
      assert.equal(selected1.ok, true, selected1.ok ? '' : selected1.detail);
      if (!selected1.ok) return;

      const selfAfterSelect = JSON.parse(await fs.readFile(digitalSelfFilePath(pkgDir), 'utf8')) as DigitalSelf;
      assert.deepEqual(selfAfterSelect, selfBeforeSelect, 'Case A: 选择不得改写 self.json');

      await bus.invoke('talk', { text: HUMAN_TALK });

      const v2 = await readDigitalSelf(pkgDir, created.subjectId, new Date().toISOString());
      const diff = semanticDiff(v1, v2);
      assert.notEqual(JSON.stringify(v1.understandings), JSON.stringify(v2.understandings));
      const gameish = liveUnderstandings(v2).filter(
        (item) =>
          item.status === 'current' &&
          /游戏|NPC|生成式|融资/.test(item.text) &&
          item.provenance.origin === 'user_statement',
      );
      assert.ok(gameish.length >= 1, 'V2 应含来自真人陈述、与游戏/融资边界有关的 current 理解');
      assert.equal(
        liveUnderstandings(v2).some(
          (item) => item.provenance.origin === 'user_statement' && /应该喜欢/.test(item.text),
        ),
        false,
      );
      const dsFiles = await fs.readdir(path.join(pkgDir, 'digital-self'));
      assert.equal(dsFiles.includes('self.json'), true);
      assert.equal(dsFiles.includes('network-profile.json'), false);
      assert.equal(dsFiles.includes('feed-preferences.json'), false);

      const listed2 = await client.listNetworkItems(query);
      const ids2 = listed2.items.map((item) => item.itemId);
      assert.deepEqual(ids2, ids1);
      const poolHash2 = candidatePoolHash(ids2);
      assert.equal(poolHash2, poolHash1);

      const selected2 = await selectNetworkItems({
        digitalSelf: v2,
        items: listed2.items,
        chatComplete: chat,
        model: { baseUrl, model, apiKey },
      });
      assert.equal(selected2.ok, true, selected2.ok ? '' : selected2.detail);
      if (!selected2.ok) return;

      const map1 = new Map(selected1.decisions.map((row) => [row.itemId, row]));
      const map2 = new Map(selected2.decisions.map((row) => [row.itemId, row]));
      const flips = selected1.decisions
        .map((row) => {
          const next = map2.get(row.itemId);
          if (!next || next.decision === row.decision) return null;
          return { itemId: row.itemId, from: row.decision, to: next.decision, reasonV1: row.reason, reasonV2: next.reason };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      const itemById = new Map(EVOLUTION_POOL.map((item) => [item.itemId, item]));
      const explained = flips.filter((row) => {
        const item = itemById.get(row.itemId);
        const blob = `${item?.content.title || ''} ${item?.content.text || ''} ${row.reasonV2}`;
        return /游戏|NPC|生成式|融资|商业模式/.test(blob);
      });
      assert.ok(flips.length >= 1, '需要至少一次有意义的 SHOW↔IGNORE');
      assert.ok(
        explained.length >= 1 || flips.some((row) => GAME_AI_IDS.includes(row.itemId) || row.itemId === 'ni_36'),
        '变化应能追溯到游戏产业 / 融资边界，而不是无解释翻转',
      );
      assert.ok(flips.length < ids1.length * 0.8, `选择整体随机重排（翻转 ${flips.length}/${ids1.length}）`);

      const unrelatedFlips = UNRELATED_IDS.filter((id) => {
        const a = map1.get(id)?.decision;
        const b = map2.get(id)?.decision;
        return a && b && a !== b;
      });
      assert.ok(unrelatedFlips.length <= 2, `无关内容翻转过多: ${unrelatedFlips.join(',')}`);

      const counterId =
        flips.find((row) => row.from === 'ignore' && row.to === 'show' && GAME_AI_IDS.includes(row.itemId))?.itemId ||
        flips.find((row) => row.from === 'ignore' && row.to === 'show')?.itemId ||
        flips[0]?.itemId;
      assert.ok(counterId);
      const counterItem = itemById.get(counterId);
      assert.ok(counterItem);
      const counterV1 = await selectNetworkItems({
        digitalSelf: v1,
        items: [counterItem],
        chatComplete: chat,
        model: { baseUrl, model, apiKey },
      });
      const counterV2 = await selectNetworkItems({
        digitalSelf: v2,
        items: [counterItem],
        chatComplete: chat,
        model: { baseUrl, model, apiKey },
      });
      assert.equal(counterV1.ok, true);
      assert.equal(counterV2.ok, true);

      const view = (await bus.invoke('digitalSelf', { action: 'read' })).view;
      const viewBlob = JSON.stringify(view);
      assert.match(viewBlob, /游戏|NPC|生成式|融资/);

      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      await writeDigitalSelf(path.join(EVIDENCE_DIR, 'self-v1'), v1);
      await writeDigitalSelf(path.join(EVIDENCE_DIR, 'self-v2'), v2);
      const report = {
        model,
        providerId,
        talkUtterance: HUMAN_TALK,
        poolCount: ids1.length,
        candidateIds: ids1,
        poolHash: poolHash1,
        samePool: poolHash1 === poolHash2,
        selectionV1: selected1.ok
          ? { shown: selected1.shownItemIds, ignored: selected1.ignoredItemIds, decisions: selected1.decisions }
          : selected1,
        selectionV2: selected2.ok
          ? { shown: selected2.shownItemIds, ignored: selected2.ignoredItemIds, decisions: selected2.decisions }
          : selected2,
        semanticDiff: diff,
        v2Gameish: gameish.map((item) => ({
          text: item.text,
          origin: item.provenance.origin,
          actor: item.provenance.actor,
          excerpt: item.provenance.excerpt || null,
          status: item.status,
        })),
        flips,
        unrelatedFlips,
        counterfactual: {
          itemId: counterId,
          title: counterItem.content.title,
          v1: counterV1.ok ? counterV1.decisions[0] : counterV1,
          v2: counterV2.ok ? counterV2.decisions[0] : counterV2,
        },
        relayKnewPreference: false,
        secondProfile: false,
        selfReinforcementFromSelection: false,
      };
      await fs.writeFile(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } finally {
      await dm.stop();
      server.close();
    }
  },
);
