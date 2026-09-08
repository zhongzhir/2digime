/**
 * DIGITALME-SUBJECT-NETWORK-FEED-01
 * 真模型 + 同池双 Digital Self。无凭证则 skip，不伪造成功。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { candidatePoolHash } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';
import { chatComplete } from '../../infrastructure/model-http';
import { resolveModelEnvAsync } from '../../infrastructure/env-secrets';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';

const EVIDENCE_DIR = path.join(process.cwd(), 'build', 'evidence', 'subject-network-feed-01');

function selfOf(subjectId: string, lines: Array<{ text: string; facet: DigitalSelf['understandings'][number]['facet'] }>): DigitalSelf {
  const now = '2026-09-08T06:00:00.000Z';
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

const SELF_A = selfOf('subj_feed_a', [
  { facet: 'about_me', text: '我长期关注人工智能如何改变产业组织、产品形态和投资判断。' },
  { facet: 'goals', text: '正在做数字产品和创业，想看清 PE/VC 如何理解新模式，而不是追短期热点。' },
  { facet: 'goals', text: '文化产业与数字内容如果能形成新的主体和授权关系，我会认真看。' },
  { facet: 'preferences', text: '纯娱乐八卦、只为放松的综艺对我价值低，除非能看到产业、权利或产品含义。' },
  { facet: 'boundaries', text: '不希望平台按隐式画像替我决定看什么；选择应留在我自己的数字之我。' },
]);

const SELF_B = selfOf('subj_feed_b', [
  { facet: 'about_me', text: '我的日常大量时间在游戏、赛事和可一起看的内容上。' },
  { facet: 'goals', text: '关心体育比赛、球员状态和观赛体验，也喜欢能跟朋友一起玩的东西。' },
  { facet: 'preferences', text: '消费生活、大众文化娱乐、联名和线下玩乐对我很具体。' },
  { facet: 'preferences', text: '融资条款、基金结构和组织变小这类讨论很难让我看完，除非直接影响玩法或社区。' },
  { facet: 'boundaries', text: '不喜欢把休闲内容变成投资课；我想先被打动，再决定要不要深究。' },
]);

async function listenRelay(): Promise<{ server: Server; relayUrl: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed01-relay-'));
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
  'FEED-01 real model: same Relay pool, different Digital Self selection',
  { timeout: 360_000 },
  async (t) => {
    const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
    const runtime = resolved.runtime;
    if (!runtime || !resolved.configured) {
      t.skip('no model credential; blocked without fabricating success');
      return;
    }

    const { server, relayUrl } = await listenRelay();
    try {
      const clientA = new RelayClient(relayUrl);
      const clientB = new RelayClient(relayUrl);
      for (const item of FEED_01_SEED_ITEMS) {
        await clientA.publishNetworkItem(item);
      }
      const query = { kind: 'content', visibility: 'public', limit: 50 } as const;
      const listedA = await clientA.listNetworkItems(query);
      const listedB = await clientB.listNetworkItems(query);
      const idsA = listedA.items.map((item) => item.itemId);
      const idsB = listedB.items.map((item) => item.itemId);
      assert.deepEqual(idsA, idsB);
      assert.equal(idsA.length, FEED_01_SEED_ITEMS.length);
      const poolHash = candidatePoolHash(idsA);

      const chat = async (options: Parameters<typeof chatComplete>[0]) =>
        chatComplete({
          ...options,
          apiKey: runtime.apiKey,
          baseUrl: runtime.baseUrl,
          model: runtime.model,
        });

      const selectedA = await selectNetworkItems({
        digitalSelf: SELF_A,
        items: listedA.items,
        chatComplete: chat,
        model: { baseUrl: runtime.baseUrl, model: runtime.model, apiKey: runtime.apiKey },
      });
      const selectedB = await selectNetworkItems({
        digitalSelf: SELF_B,
        items: listedB.items,
        chatComplete: chat,
        model: { baseUrl: runtime.baseUrl, model: runtime.model, apiKey: runtime.apiKey },
      });
      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      if (!selectedA.ok || !selectedB.ok) {
        await fs.writeFile(
          path.join(EVIDENCE_DIR, 'report.json'),
          `${JSON.stringify({ poolHash, idsA, selectedA, selectedB, model: runtime.model }, null, 2)}\n`,
          'utf8',
        );
      }
      assert.equal(selectedA.ok, true, selectedA.ok ? '' : selectedA.detail);
      assert.equal(selectedB.ok, true, selectedB.ok ? '' : selectedB.detail);
      if (!selectedA.ok || !selectedB.ok) return;

      const aShow = new Set(selectedA.shownItemIds);
      const bShow = new Set(selectedB.shownItemIds);
      const aOnly = selectedA.shownItemIds.filter((id) => !bShow.has(id));
      const bOnly = selectedB.shownItemIds.filter((id) => !aShow.has(id));
      const both = selectedA.shownItemIds.filter((id) => bShow.has(id));

      const itemById = new Map(FEED_01_SEED_ITEMS.map((item) => [item.itemId, item]));
      const counterId = aOnly[0] || bOnly[0];
      assert.ok(counterId, 'need at least one asymmetric item for counterfactual');
      const counterItem = itemById.get(counterId);
      assert.ok(counterItem);
      const counterA = await selectNetworkItems({
        digitalSelf: SELF_A,
        items: [counterItem],
        chatComplete: chat,
        model: { baseUrl: runtime.baseUrl, model: runtime.model, apiKey: runtime.apiKey },
      });
      const counterB = await selectNetworkItems({
        digitalSelf: SELF_B,
        items: [counterItem],
        chatComplete: chat,
        model: { baseUrl: runtime.baseUrl, model: runtime.model, apiKey: runtime.apiKey },
      });
      assert.equal(counterA.ok, true);
      assert.equal(counterB.ok, true);

      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      const pkgA = path.join(EVIDENCE_DIR, 'subject-a');
      const pkgB = path.join(EVIDENCE_DIR, 'subject-b');
      await writeDigitalSelf(pkgA, SELF_A);
      await writeDigitalSelf(pkgB, SELF_B);
      const report = {
        relayUrlProtocol: 'http',
        model: runtime.model,
        providerId: runtime.providerId,
        poolCount: idsA.length,
        candidateIdsForA: idsA,
        candidateIdsForB: idsB,
        poolHash,
        samePool: idsA.join(',') === idsB.join(','),
        aShown: selectedA.shownItemIds,
        aIgnored: selectedA.ignoredItemIds,
        aDecisions: selectedA.decisions,
        bShown: selectedB.shownItemIds,
        bIgnored: selectedB.ignoredItemIds,
        bDecisions: selectedB.decisions,
        aOnly,
        bOnly,
        both,
        counterfactual: {
          itemId: counterId,
          title: counterItem.content.title,
          a: counterA.ok ? counterA.decisions[0] : counterA,
          b: counterB.ok ? counterB.decisions[0] : counterB,
        },
        keywordFallback: false,
        relayCalledModel: false,
      };
      await fs.writeFile(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

      assert.equal(report.samePool, true);
      assert.ok(aOnly.length >= 1, `expected A-only, got ${aOnly.join(',')}`);
      assert.ok(bOnly.length >= 1, `expected B-only, got ${bOnly.join(',')}`);
      assert.ok(selectedA.decisions.every((row) => row.reason.length > 4));
      assert.ok(selectedB.decisions.every((row) => row.reason.length > 4));
      if (counterA.ok && counterB.ok) {
        const da = counterA.decisions[0]?.decision;
        const db = counterB.decisions[0]?.decision;
        assert.ok(da && db);
        assert.notEqual(da, db, 'counterfactual should differ on the asymmetric item');
      }
    } finally {
      server.close();
    }
  },
);
