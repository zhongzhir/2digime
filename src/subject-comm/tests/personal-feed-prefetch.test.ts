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

test('prefetched personal ranking joins at low water without replacing queued cards', async () => {
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
  }), 1, 'a ready background page should join before the visible queue runs dry');
  assert.equal(await personalFeedRemainingCount(packageRoot), 3);

  await writeCache(packageRoot, {
    selectionContextKey: 'ctx-current',
    delivered: ['ni_a'],
    ranked: ['ni_a', ...Array.from({ length: 13 }, (_, index) => `ni_wait_${index + 1}`)],
  });
  assert.equal(await commitPersonalFeedPrefetch(packageRoot, {
    selectionContextKey: 'ctx-current',
    rankedIds: ['ni_too_early'],
  }), 0, 'background results must not be spliced into a queue above the low-water mark');
  assert.equal(await personalFeedRemainingCount(packageRoot), 13);
});
