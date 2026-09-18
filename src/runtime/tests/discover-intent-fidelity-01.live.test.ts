import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { validateNetworkItem } from '../../subject-comm/network-item';
import { resolveModelEnvAsync } from '../../infrastructure/env-secrets';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

function selfOf(subjectId: string): DigitalSelf {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我关心公开科学、文化和影像。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

test('live Gemini + DeepSeek: AI video search keeps unrelated/about out of the main feed', { timeout: 180_000 }, async (t) => {
  const env = await resolveModelEnvAsync();
  const gemini = String(process.env.GEMINI_API_KEY || '').trim();
  if (!gemini || !env.configured) {
    t.skip('GEMINI_API_KEY or DeepSeek runtime missing');
    return;
  }
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-intent-live-')), 'pkg');
  const rwa = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_rwa_live',
    publisherSubjectId: 'pub_rwa',
    publisherDisplayName: 'Finance Desk',
    kind: 'content',
    createdAt: nowIsoSafe(),
    visibility: 'public',
    content: {
      title: 'RWA 资产上链改变金融基础设施',
      text: 'Real world assets news.',
      url: 'https://example.org/finance/rwa-live',
      contentType: 'article',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: nowIsoSafe(), via: 'search' },
  });
  if (!rwa.ok) throw new Error(rwa.reason);
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '真实意图', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(rwa.item);
  const sought = await bus.invoke('content', { action: 'seek', text: '找几个AI精品视频看一下' });
  const trace = sought.view.seekTrace;
  const visible = sought.view.cards || [];
  assert.equal(sought.view.feedMode, 'intent');
  assert.equal(visible.some((card) => /RWA|上链|金融/i.test(`${card.title}\n${card.text || ''}`)), false);
  assert.equal(visible.every((card) => card.contentType === 'video'), true);
  if (trace) {
    assert.equal(trace.items.filter((row) => row.visible && row.fidelity === 'UNRELATED').length, 0);
    assert.equal(trace.items.filter((row) => row.visible && row.fidelity === 'ABOUT_CONTENT').length, 0);
  }
  const evidenceDir = path.join(process.cwd(), 'build', 'evidence', 'discover-intent-fidelity-01');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'live-ai-video-seek.json'),
    `${JSON.stringify(
      {
        model: env.model,
        stub: false,
        query: '找几个AI精品视频看一下',
        raw: trace?.rawCandidates ?? null,
        topicMatched: trace?.topicMatched ?? null,
        typeMatched: trace?.typeMatched ?? null,
        primary: trace?.primaryContent ?? null,
        about: trace?.aboutContent ?? null,
        unrelated: trace?.unrelated ?? null,
        visible: visible.length,
        visibleTitles: visible.map((card) => card.title),
        notice: sought.view.notice,
      },
      null,
      2,
    )}\n`,
  );
  await runtime.stop();
});

function nowIsoSafe(): string {
  return '2026-09-18T12:00:00.000Z';
}
