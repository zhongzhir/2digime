import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  contentSourcePortfolioPath,
  contentSourceConditionalHeaders,
  dueCatalogFeedSources,
  ensureContentSourcePortfolio,
  inactiveContentSourcePublisherIds,
  listContentSourceViews,
  recordContentSourceAttempts,
  registerContentSource,
  setContentSourceEnabled,
} from '../content-source-portfolio';
import { sourcePublisherId } from '../content-canonical';
import { OPEN_SOURCE_CATALOG } from '../open-source-catalog';

const NOW = '2026-11-10T08:00:00.000Z';

test('source portfolio materializes the built-in catalog with execution fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-portfolio-'));
  const sources = await ensureContentSourcePortfolio(root, NOW);

  assert.equal(sources.length, OPEN_SOURCE_CATALOG.length);
  assert.equal(sources.every((source) => source.origin === 'built_in' && source.enabled), true);
  assert.equal(sources.every((source) => source.consecutiveFailures === 0), true);
  const stored = JSON.parse(await fs.readFile(contentSourcePortfolioPath(root), 'utf8')) as { version: number };
  assert.equal(stored.version, 1);
});

test('source attempts persist yield, back off failures, and recover on success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-attempt-'));
  const [first] = await dueCatalogFeedSources(root, NOW, ['article']);
  assert.ok(first);

  let sources = await recordContentSourceAttempts(root, NOW, [
    { sourceId: first!.id, ok: false, itemCount: 0, errorCode: 'timeout' },
  ]);
  let current = sources.find((source) => source.id === first!.id)!;
  assert.equal(current.consecutiveFailures, 1);
  assert.equal(current.lastErrorCode, 'timeout');
  assert.equal(current.nextRefreshAt, '2026-11-10T08:05:00.000Z');
  assert.equal(
    (await inactiveContentSourcePublisherIds(root, NOW)).has(sourcePublisherId(first!.url)),
    true,
  );

  const beforeRetry = await dueCatalogFeedSources(root, '2026-11-10T08:04:59.000Z', ['article']);
  assert.equal(beforeRetry.some((source) => source.id === first!.id), false);

  sources = await recordContentSourceAttempts(root, '2026-11-10T08:05:00.000Z', [
    { sourceId: first!.id, ok: true, itemCount: 7 },
  ]);
  current = sources.find((source) => source.id === first!.id)!;
  assert.equal(current.consecutiveFailures, 0);
  assert.equal(current.lastErrorCode, undefined);
  assert.equal(current.lastItemCount, 7);
  assert.equal(current.totalItemCount, 7);
  assert.equal(current.nextRefreshAt, '2026-11-10T08:35:00.000Z');
  assert.equal(
    (await inactiveContentSourcePublisherIds(root, '2026-11-10T08:05:00.000Z')).has(
      sourcePublisherId(first!.url),
    ),
    false,
  );

  sources = await recordContentSourceAttempts(root, '2026-11-10T08:35:00.000Z', [
    {
      sourceId: first!.id,
      ok: true,
      itemCount: 0,
      notModified: true,
      cursor: 'internet-archive:page:2',
      etag: '"feed-v7"',
      lastModified: 'Tue, 10 Nov 2026 08:00:00 GMT',
    },
  ]);
  current = sources.find((source) => source.id === first!.id)!;
  assert.equal(current.lastNotModifiedAt, '2026-11-10T08:35:00.000Z');
  assert.equal(current.lastItemCount, 0);
  assert.equal(current.totalItemCount, 7);
  assert.equal(current.cursor, 'internet-archive:page:2');
  assert.deepEqual(contentSourceConditionalHeaders(current), {
    'if-none-match': '"feed-v7"',
    'if-modified-since': 'Tue, 10 Nov 2026 08:00:00 GMT',
  });
  assert.equal(current.nextRefreshAt, '2026-11-10T09:05:00.000Z');

  sources = await recordContentSourceAttempts(root, '2026-11-10T09:05:00.000Z', [
    { sourceId: first!.id, ok: true, itemCount: 0, cursor: null },
  ]);
  current = sources.find((source) => source.id === first!.id)!;
  assert.equal(current.cursor, undefined);
});

test('a user can register an open feed without changing source code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-register-'));
  const source = await registerContentSource({
    packageRoot: root,
    url: 'https://example.org/feed.xml?utm_source=setup',
    label: 'My Feed',
    kind: 'media_rss',
    contentTypes: ['article'],
    origin: 'user',
    now: NOW,
  });

  assert.equal(source.origin, 'user');
  assert.equal(source.enabled, true);
  assert.equal(source.url, 'https://example.org/feed.xml');
  const sources = await ensureContentSourcePortfolio(root, NOW);
  assert.equal(sources.some((row) => row.id === source.id), true);
  const due = await dueCatalogFeedSources(root, NOW, ['article']);
  assert.equal(due.some((row) => row.id === source.id), true);
  const disabled = await setContentSourceEnabled(root, source.id, false, NOW);
  assert.equal(disabled?.enabled, false);
  const afterDisable = await dueCatalogFeedSources(root, NOW, ['article']);
  assert.equal(afterDisable.some((row) => row.id === source.id), false);
});

test('304 does not make an unchanged source healthy after its content links failed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-304-content-health-'));
  const [source] = await dueCatalogFeedSources(root, NOW, ['article']);
  assert.ok(source);

  await recordContentSourceAttempts(root, NOW, [
    {
      sourceId: source!.id,
      ok: false,
      itemCount: 8,
      errorCode: 'content_unreachable',
      etag: '"unchanged-v1"',
    },
  ]);
  const retryAt = '2026-11-10T08:05:00.000Z';
  const sources = await recordContentSourceAttempts(root, retryAt, [
    {
      sourceId: source!.id,
      ok: true,
      itemCount: 0,
      notModified: true,
      etag: '"unchanged-v1"',
    },
  ]);
  const current = sources.find((row) => row.id === source!.id)!;

  assert.equal(current.lastNotModifiedAt, retryAt);
  assert.equal(current.lastSuccessAt, undefined);
  assert.equal(current.lastFailureAt, retryAt);
  assert.equal(current.lastErrorCode, 'content_unreachable');
  assert.equal(current.consecutiveFailures, 2);
  assert.equal(current.nextRefreshAt, '2026-11-10T08:15:00.000Z');
  assert.equal(
    (await inactiveContentSourcePublisherIds(root, retryAt)).has(sourcePublisherId(source!.url)),
    true,
  );
});

test('source management view is a projection of portfolio execution facts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-view-'));
  const [source] = await ensureContentSourcePortfolio(root, NOW);
  assert.ok(source);
  let row = (await listContentSourceViews(root, NOW)).find((item) => item.id === source!.id)!;
  assert.equal(row.availability, 'not_checked');

  await recordContentSourceAttempts(root, NOW, [{ sourceId: source!.id, ok: true, itemCount: 5 }]);
  row = (await listContentSourceViews(root, NOW)).find((item) => item.id === source!.id)!;
  assert.equal(row.availability, 'available');
  assert.equal(row.lastItemCount, 5);

  await recordContentSourceAttempts(root, '2026-11-10T08:30:00.000Z', [
    { sourceId: source!.id, ok: false, itemCount: 0 },
  ]);
  row = (await listContentSourceViews(root, NOW)).find((item) => item.id === source!.id)!;
  assert.equal(row.availability, 'failing');

  await setContentSourceEnabled(root, source!.id, false, '2026-11-10T08:31:00.000Z');
  row = (await listContentSourceViews(root, NOW)).find((item) => item.id === source!.id)!;
  assert.equal(row.availability, 'disabled');
  assert.equal(row.lastSuccessAt, NOW);
  assert.equal(row.lastFailureAt, '2026-11-10T08:30:00.000Z');
});

