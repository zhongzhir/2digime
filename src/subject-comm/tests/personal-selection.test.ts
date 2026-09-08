import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { PERSONAL_SELECTION_UNAVAILABLE } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

function self(subjectId: string, lines: string[]): DigitalSelf {
  const now = '2026-09-08T05:00:00.000Z';
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

test('Personal selection uses Digital Self and model JSON; model failure is unavailable', async () => {
  const digitalSelf = self('subj_a', ['我长期关心人工智能如何改变产品和投资判断。']);
  const subset = FEED_01_SEED_ITEMS.slice(0, 3);
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /人工智能如何改变产品/);
      assert.equal(blob.includes('interestScore'), false);
      const decisions = subset.map((item, index) => ({
        itemId: item.itemId,
        decision: index === 0 ? 'show' : 'ignore',
        reason: index === 0 ? '与已确认的产业与产品关心相符。' : '与当前数字之我关系弱。',
      }));
      return { text: JSON.stringify({ decisions }) };
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.shownItemIds, ['ni_01']);
    assert.deepEqual(result.ignoredItemIds, ['ni_02', 'ni_03']);
  }

  const failed = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async () => {
      throw new Error('no model');
    },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error, PERSONAL_SELECTION_UNAVAILABLE);
});

test('Personal selection source has no keyword/score fallback', async () => {
  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
  assert.equal(src.includes('opportunity-match'), false);
  assert.equal(src.includes('fallbackMatch'), false);
  assert.equal(src.includes('interestScore'), false);
  assert.equal(src.includes('keywordOverlap'), false);
  assert.equal(src.includes('cosine'), false);
  assert.equal(/\brelevanceScore\b/.test(src), false);
});
