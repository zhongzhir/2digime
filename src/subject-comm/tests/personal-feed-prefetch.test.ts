import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  commitPersonalFeedPrefetch,
  personalFeedCachePath,
  personalFeedRemainingCount,
} from '../personal-feed';

async function writeCache(packageRoot: string, input: {
  selectionContextKey: string;
  delivered: string[];
  ranked: string[];
}): Promise<void> {
  const file = personalFeedCachePath(packageRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({
    version: 1,
    selectionContextKey: input.selectionContextKey,
    lastView: {
      itemIds: input.delivered,
      generatedAt: '2026-11-11T00:00:00.000Z',
      mode: 'personal',
    },
    rankedIds: input.ranked,
  }, null, 2)}\n`);
}

test('prefetched personal ranking commits only at an empty matching queue', async () => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prefetch-commit-'));
  await writeCache(packageRoot, {
    selectionContextKey: 'ctx-current',
    delivered: ['ni_a', 'ni_b'],
    ranked: ['ni_a', 'ni_b'],
  });

  assert.equal(await commitPersonalFeedPrefetch(packageRoot, {
    selectionContextKey: 'ctx-stale',
    rankedIds: ['ni_c'],
  }), 0);
  assert.equal(await personalFeedRemainingCount(packageRoot), 0);

  assert.equal(await commitPersonalFeedPrefetch(packageRoot, {
    selectionContextKey: 'ctx-current',
    rankedIds: ['ni_b', 'ni_c', 'ni_d', 'ni_c'],
  }), 2);
  assert.equal(await personalFeedRemainingCount(packageRoot), 2);

  assert.equal(await commitPersonalFeedPrefetch(packageRoot, {
    selectionContextKey: 'ctx-current',
    rankedIds: ['ni_e'],
  }), 0, 'an existing undelivered queue must never be replaced');
  assert.equal(await personalFeedRemainingCount(packageRoot), 2);
});
