const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime.js');
const { createCommandBus } = require('../dist/runtime/command-bus.js');
const { FileNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const { personalFeedCachePath } = require('../dist/subject-comm/personal-feed.js');

const SAMPLE_COUNT = 50;
const WARMUP_COUNT = 5;
const P95_LIMIT_MS = 300;

function item(index) {
  const id = `ni_latency_${String(index).padStart(3, '0')}`;
  return {
    schemaVersion: 1,
    itemId: id,
    publisherSubjectId: `subj_latency_${index % 12}`,
    publisherDisplayName: `延迟检查来源 ${index % 12}`,
    kind: 'content',
    createdAt: '2026-11-11T00:00:00.000Z',
    visibility: 'public',
    content: {
      title: `本地已排候选 ${index}`,
      text: `用于检查更多操作只读取本地已排队候选，不触发模型或网络。序号 ${index}。`,
      url: `https://latency-${index % 12}.example.org/items/${index}`,
    },
    provenance: {
      origin: 'publisher',
      actor: 'owner',
      statedAt: '2026-11-11T00:00:00.000Z',
    },
  };
}

function percentile(sorted, ratio) {
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-more-latency-'));
  const packageRoot = path.join(tempRoot, 'pkg');
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentOpenMediaFetch: false,
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '更多延迟检查', targetDir: packageRoot });
    const store = new FileNetworkItemStore(path.join(packageRoot, 'content'));
    const items = Array.from({ length: 60 }, (_, index) => item(index + 1));
    for (const row of items) await store.put(row);
    const stored = await store.listAll({ kind: 'content', visibility: 'public' }, new Date().toISOString());
    assert.equal(stored.length, 60, 'benchmark fixture must be present in the local directory');
    const cacheFile = personalFeedCachePath(packageRoot);
    const resetQueue = async () => {
      await fs.writeFile(cacheFile, `${JSON.stringify({
        version: 1,
        selectionContextKey: '',
        lastView: {
          itemIds: [],
          generatedAt: '2026-11-11T00:00:00.000Z',
          mode: 'personal',
        },
        rankedIds: items.map((row) => row.itemId),
      })}\n`);
    };
    const runOnce = async () => {
      await resetQueue();
      const started = performance.now();
      const result = await bus.invoke('content', { action: 'more' });
      const elapsed = performance.now() - started;
      assert.equal(
        result.view.cards.length,
        12,
        JSON.stringify({ reasonCode: result.view.reasonCode, notice: result.view.notice }),
      );
      assert.equal(result.view.append, true);
      return elapsed;
    };

    for (let index = 0; index < WARMUP_COUNT; index += 1) await runOnce();
    const samples = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) samples.push(await runOnce());
    samples.sort((a, b) => a - b);
    const result = {
      samples: SAMPLE_COUNT,
      p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
      p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
      maxMs: Number(samples[samples.length - 1].toFixed(2)),
      limitMs: P95_LIMIT_MS,
      pass: percentile(samples, 0.95) <= P95_LIMIT_MS,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.pass) process.exitCode = 1;
  } finally {
    await runtime.stop();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
