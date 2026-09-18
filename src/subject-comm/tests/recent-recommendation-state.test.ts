import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendRecentRecommendationEvent,
  formatRecentRecommendationContext,
  listRecentRecommendationEvents,
  openedItemIds,
  recentRecommendationPath,
  resetRecentRecommendationState,
} from '../recent-recommendation-state';

test('recent recommendation state decays, resets, and is not labeled as like', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-recent-rec-'));
  await appendRecentRecommendationEvent(root, {
    type: 'opened',
    itemId: 'ni_old',
    title: '旧文章',
    at: '2020-01-01T00:00:00.000Z',
  });
  await appendRecentRecommendationEvent(root, {
    type: 'opened',
    itemId: 'ni_new',
    title: '新文章',
    at: '2026-09-18T00:00:00.000Z',
  });
  await appendRecentRecommendationEvent(root, {
    type: 'seek_topic',
    topic: 'fusion energy',
    at: '2026-09-18T00:01:00.000Z',
  });
  const listed = await listRecentRecommendationEvents(root, '2026-09-18T00:02:00.000Z');
  assert.equal(listed.some((row) => row.itemId === 'ni_old'), false);
  assert.deepEqual(openedItemIds(listed), ['ni_new']);
  const context = formatRecentRecommendationContext(listed);
  assert.match(context, /不是长期偏好/);
  assert.match(context, /不要写成「用户喜欢」/);
  await resetRecentRecommendationState(root);
  const after = await listRecentRecommendationEvents(root, '2026-09-18T00:03:00.000Z');
  assert.equal(after.length, 0);
  const raw = JSON.parse(await fs.readFile(recentRecommendationPath(root), 'utf8')) as { events: unknown[] };
  assert.deepEqual(raw.events, []);
});
