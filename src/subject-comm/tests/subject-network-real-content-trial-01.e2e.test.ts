/**
 * SUBJECT-NETWORK-REAL-CONTENT-TRIAL-01
 * 真实公开内容 → 现有 broadcast/relay → 两个隔离 Digital Self 独立判断。
 * 无凭证则 skip，不伪造成功。工程主体不是两个真人。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { networkItemPayloadHash, type NetworkItem } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import {
  appendNetworkContentFeedback,
  createAiJudgmentFeedback,
  type AiContentAction,
} from '../network-content-feedback';
import { chatComplete } from '../../infrastructure/model-http';
import { resolveModelEnvAsync } from '../../infrastructure/env-secrets';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { readDigitalSelf, writeDigitalSelf, digitalSelfFilePath } from '../../subject-core/digital-self/store';

const EVIDENCE_DIR = path.join(process.cwd(), 'build', 'evidence', 'subject-network-real-content-trial-01');

async function exportOfficialV2Credential(): Promise<boolean> {
  if (process.env.DIGITALME_SKIP_APP_MODEL === '1') return false;
  const script = path.join(process.cwd(), 'scripts', 'export-v2-runtime-model-credential.cjs');
  let electronPath: string;
  try {
    electronPath = require('electron') as string;
    if (typeof electronPath !== 'string') return false;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const child = spawn(electronPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      out += String(d);
    });
    child.on('close', (code) => resolve(code === 0 && /"ok"\s*:\s*true/.test(out)));
    child.on('error', () => resolve(false));
  });
}

const CANDIDATE_URLS = [
  'https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95',
  'https://www.webtoons.com/en/action/omniscient-reader/list?title_no=2154',
];

function selfOf(
  subjectId: string,
  lines: Array<{ text: string; facet: DigitalSelf['understandings'][number]['facet'] }>,
): DigitalSelf {
  const now = '2026-09-12T07:00:00.000Z';
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

const SELF_A = selfOf('subj_real_content_a', [
  { facet: 'about_me', text: '我长期追连载漫画、漫剧和动态漫画，尤其喜欢长篇奇幻冒险和塔、迷宫一类世界观。' },
  { facet: 'goals', text: '想持续看到值得跟进的官方连载，而不是随机热门短视频。' },
  { facet: 'preferences', text: '视觉叙事、角色成长和可追更的官方漫画页对我很具体。' },
  { facet: 'boundaries', text: '不希望平台按隐式画像替我决定看什么。' },
]);

const SELF_B = selfOf('subj_real_content_b', [
  { facet: 'about_me', text: '我的业余时间主要在看球赛、球员状态和日常消费安排上。' },
  { facet: 'goals', text: '先把比赛和开销看清楚，不想把晚上交给长篇连载。' },
  { facet: 'preferences', text: '体育赛事和实用消费信息对我很具体；长篇奇幻漫画很少看完。' },
  { facet: 'boundaries', text: '请不要把娱乐连载当成必须跟进的任务。' },
]);

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

async function fetchPublicListing(sourceUrl: string): Promise<{
  sourceUrl: string;
  title: string;
  summary: string;
  publisher: string;
  httpStatus: number;
  fetchedAt: string;
} | null> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; 2digime-subject-network-trial/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    if (!res.ok || html.length < 200) return null;
    const title =
      metaContent(html, 'og:title') ||
      decodeHtml((html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim());
    const summary =
      metaContent(html, 'og:description') ||
      metaContent(html, 'description') ||
      title;
    if (!title) return null;
    return {
      sourceUrl,
      title: title.slice(0, 240),
      summary: summary.slice(0, 800),
      publisher: metaContent(html, 'og:site_name') || 'WEBTOON',
      httpStatus: res.status,
      fetchedAt,
    };
  } catch {
    return null;
  }
}

function itemFromListing(
  listing: NonNullable<Awaited<ReturnType<typeof fetchPublicListing>>>,
): NetworkItem {
  const itemId = `ni_real_${createHash('sha256').update(listing.sourceUrl).digest('hex').slice(0, 12)}`;
  return {
    schemaVersion: 1,
    itemId,
    publisherSubjectId: 'subj_real_content_publisher',
    publisherDisplayName: listing.publisher.slice(0, 80),
    kind: 'content',
    createdAt: listing.fetchedAt,
    visibility: 'public',
    content: {
      title: listing.title,
      text: listing.summary,
      url: listing.sourceUrl,
    },
    provenance: {
      origin: 'publisher',
      actor: 'owner',
      statedAt: listing.fetchedAt,
      excerpt: 'public listing metadata + original url only',
    },
  };
}

function selfHash(self: DigitalSelf): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        self.understandings.map((row) => ({ id: row.id, text: row.text, status: row.status })),
      ),
    )
    .digest('hex');
}

async function listenRelay(): Promise<{ server: Server; relayUrl: string; dataDir: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-real-content-e2e-'));
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
  return { server, relayUrl: `http://127.0.0.1:${addr.port}`, dataDir };
}

test(
  'REAL-CONTENT-TRIAL-01: public listing through relay to two Digital Selves',
  { timeout: 360_000 },
  async (t) => {
    await exportOfficialV2Credential();
    const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
    const runtime = resolved.runtime;
    const apiKey = (
      runtime?.apiKey ||
      process.env.DIGITALME_MODEL_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ''
    ).trim();
    const baseUrl = runtime?.baseUrl || resolved.baseUrl;
    const model = runtime?.model || resolved.model;
    if (!apiKey) {
      t.skip('no model credential; blocked without fabricating success');
      return;
    }

    const listings: Array<NonNullable<Awaited<ReturnType<typeof fetchPublicListing>>>> = [];
    for (const url of CANDIDATE_URLS) {
      const listing = await fetchPublicListing(url);
      if (listing) listings.push(listing);
    }
    if (!listings.length) {
      t.skip('STOP_REAL_CONTENT_REQUIRED: no publicly reachable manhua/webtoon listing');
      return;
    }

    const { server, relayUrl, dataDir } = await listenRelay();
    const evidenceDecisions: Array<Record<string, unknown>> = [];
    try {
      const publisher = new RelayClient(relayUrl);
      const clientA = new RelayClient(relayUrl);
      const clientB = new RelayClient(relayUrl);
      const items = listings.map((listing) => itemFromListing(listing));
      for (const item of items) {
        const published = await publisher.publishNetworkItem(item);
        assert.equal(published.ok, true);
      }

      const query = { kind: 'content', visibility: 'public', limit: 50 } as const;
      const listedA = await clientA.listNetworkItems(query);
      const listedB = await clientB.listNetworkItems(query);
      assert.equal(listedA.items.length, items.length);
      assert.deepEqual(
        listedA.items.map((row) => networkItemPayloadHash(row)),
        listedB.items.map((row) => networkItemPayloadHash(row)),
      );

      const pkgA = path.join(EVIDENCE_DIR, 'subject-a');
      const pkgB = path.join(EVIDENCE_DIR, 'subject-b');
      await fs.mkdir(pkgA, { recursive: true });
      await fs.mkdir(pkgB, { recursive: true });
      await writeDigitalSelf(pkgA, SELF_A);
      await writeDigitalSelf(pkgB, SELF_B);
      const loadedA = await readDigitalSelf(pkgA, SELF_A.subjectId, new Date().toISOString());
      const loadedB = await readDigitalSelf(pkgB, SELF_B.subjectId, new Date().toISOString());
      const hashABefore = selfHash(loadedA);
      const hashBBefore = selfHash(loadedB);
      const rawABefore = await fs.readFile(digitalSelfFilePath(pkgA), 'utf8');
      const rawBBefore = await fs.readFile(digitalSelfFilePath(pkgB), 'utf8');

      const chat = async (options: Parameters<typeof chatComplete>[0]) =>
        chatComplete({
          ...options,
          apiKey,
          baseUrl,
          model,
        });

      let divergent: { itemId: string; a: string; b: string } | null = null;
      for (const item of listedA.items) {
        const selectedA = await selectNetworkItems({
          digitalSelf: loadedA,
          items: [item],
          chatComplete: chat,
          model: { baseUrl, model, apiKey },
        });
        const selectedB = await selectNetworkItems({
          digitalSelf: loadedB,
          items: [item],
          chatComplete: chat,
          model: { baseUrl, model, apiKey },
        });
        assert.equal(selectedA.ok, true, selectedA.ok ? '' : selectedA.detail);
        assert.equal(selectedB.ok, true, selectedB.ok ? '' : selectedB.detail);
        if (!selectedA.ok || !selectedB.ok) return;
        const decisionA = selectedA.decisions[0]!;
        const decisionB = selectedB.decisions[0]!;
        evidenceDecisions.push({
          contentId: item.itemId,
          a: decisionA,
          b: decisionB,
        });
        if (!divergent && decisionA.decision !== decisionB.decision) {
          divergent = {
            itemId: item.itemId,
            a: decisionA.decision,
            b: decisionB.decision,
          };
        }
      }

      const rawAAfter = await fs.readFile(digitalSelfFilePath(pkgA), 'utf8');
      const rawBAfter = await fs.readFile(digitalSelfFilePath(pkgB), 'utf8');
      assert.equal(rawAAfter, rawABefore);
      assert.equal(rawBAfter, rawBBefore);
      assert.equal(selfHash(await readDigitalSelf(pkgA, SELF_A.subjectId, new Date().toISOString())), hashABefore);
      assert.equal(selfHash(await readDigitalSelf(pkgB, SELF_B.subjectId, new Date().toISOString())), hashBBefore);

      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      const primary = listedA.items[0]!;
      const primaryListing = listings.find((row) => row.sourceUrl === primary.content.url)!;
      await fs.writeFile(
        path.join(EVIDENCE_DIR, 'real-content.json'),
        `${JSON.stringify(
          {
            title: primaryListing.title,
            sourceUrl: primaryListing.sourceUrl,
            source: primaryListing.publisher,
            fetchedAt: primaryListing.fetchedAt,
            httpStatus: primaryListing.httpStatus,
            contentId: primary.itemId,
            hostedMedia: false,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const broadcast = {
        relayUrlProtocol: 'http',
        itemIds: listedA.items.map((row) => row.itemId),
        payloadHashes: listedA.items.map((row) => networkItemPayloadHash(row)),
        publishedCount: items.length,
      };
      await fs.writeFile(path.join(EVIDENCE_DIR, 'broadcast.json'), `${JSON.stringify(broadcast, null, 2)}\n`, 'utf8');

      const deliveryLines = listedA.items.map((row, index) =>
        JSON.stringify({
          contentId: row.itemId,
          payloadHashA: networkItemPayloadHash(row),
          payloadHashB: networkItemPayloadHash(listedB.items[index]!),
          toSubjects: [SELF_A.subjectId, SELF_B.subjectId],
        }),
      );
      await fs.writeFile(path.join(EVIDENCE_DIR, 'relay-delivery.jsonl'), `${deliveryLines.join('\n')}\n`, 'utf8');

      const firstPair = evidenceDecisions[0] as {
        contentId: string;
        a: { decision: string; reason: string };
        b: { decision: string; reason: string };
      };
      const actionA: AiContentAction = firstPair.a.decision === 'show' ? 'SHOW' : 'IGNORE';
      const actionB: AiContentAction = firstPair.b.decision === 'show' ? 'SHOW' : 'IGNORE';
      const decisionAFile = {
        subjectId: SELF_A.subjectId,
        contentId: firstPair.contentId,
        digitalSelfHash: hashABefore,
        modelProvider: runtime?.providerId || resolved.providerId,
        modelName: model,
        stub: false,
        decision: actionA,
        reason: firstPair.a.reason,
        timestamp: new Date().toISOString(),
        engineeringSubject: true,
        realHuman: false,
      };
      const decisionBFile = {
        subjectId: SELF_B.subjectId,
        contentId: firstPair.contentId,
        digitalSelfHash: hashBBefore,
        modelProvider: runtime?.providerId || resolved.providerId,
        modelName: model,
        stub: false,
        decision: actionB,
        reason: firstPair.b.reason,
        timestamp: new Date().toISOString(),
        engineeringSubject: true,
        realHuman: false,
      };
      await fs.writeFile(path.join(EVIDENCE_DIR, 'subject-a-decision.json'), `${JSON.stringify(decisionAFile, null, 2)}\n`, 'utf8');
      await fs.writeFile(path.join(EVIDENCE_DIR, 'subject-b-decision.json'), `${JSON.stringify(decisionBFile, null, 2)}\n`, 'utf8');

      const feedbackFile = path.join(EVIDENCE_DIR, 'ai-judgment.jsonl');
      await appendNetworkContentFeedback(
        feedbackFile,
        createAiJudgmentFeedback({
          subjectId: SELF_A.subjectId,
          contentId: firstPair.contentId,
          action: actionA,
        }),
      );
      await appendNetworkContentFeedback(
        feedbackFile,
        createAiJudgmentFeedback({
          subjectId: SELF_B.subjectId,
          contentId: firstPair.contentId,
          action: actionB,
        }),
      );

      const storeNames = await fs.readdir(path.join(dataDir, 'network-items'));
      const storeBlobs: string[] = [];
      for (const name of storeNames) {
        storeBlobs.push(await fs.readFile(path.join(dataDir, 'network-items', name), 'utf8'));
      }
      const storeJoined = storeBlobs.join('\n').toLowerCase();
      const central = {
        digitalSelf: storeJoined.includes('subj_real_content_a') && storeJoined.includes('连载漫画') ? 'FOUND' : 'NONE',
        personalPreferenceVector: storeJoined.includes('preference vector') ? 'FOUND' : 'NONE',
        userProfile: storeJoined.includes('"profile"') ? 'FOUND' : 'NONE',
        personalRankingScore: storeJoined.includes('ranking') || storeJoined.includes('interestscore') ? 'FOUND' : 'NONE',
      };
      assert.equal(central.digitalSelf, 'NONE');
      assert.equal(central.personalPreferenceVector, 'NONE');
      assert.equal(central.personalRankingScore, 'NONE');
      await fs.writeFile(path.join(EVIDENCE_DIR, 'central-no-profile.json'), `${JSON.stringify(central, null, 2)}\n`, 'utf8');

      const report = {
        authority: '7629880f0c995d03135f4186b9c90672483774f1',
        model,
        providerId: runtime?.providerId || resolved.providerId,
        stub: false,
        listings: listings.map((row) => ({ title: row.title, sourceUrl: row.sourceUrl })),
        samePayload: true,
        decisions: evidenceDecisions,
        divergent,
        aiWrotePreference: false,
        realHumanSubjects: 0,
        engineeringSubjects: 2,
        verdict: 'ENGINEERING_READY_REAL_USER_TRIAL_PENDING',
        divergenceVerdict: divergent ? 'DIVERGENT' : 'REAL_CONTENT_DELIVERED_NO_DIVERGENCE',
      };
      await fs.writeFile(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } finally {
      server.close();
    }
  },
);
