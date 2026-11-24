#!/usr/bin/env node
/* Bounded, no-model-cost link-openability gate for Slice 1. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MemoryNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const {
  buildDiscoverCandidateReservoir,
  DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
} = require('../dist/subject-comm/discover-candidate-reservoir.js');
const { normalizeCanonicalUrl } = require('../dist/subject-comm/content-canonical.js');
const { safePublicHttpGet } = require('../dist/work-runtime/public-http-safety.js');
const { listStore, runCycle } = require('./discover-stage1-source-health-check.cjs');

const SAMPLE_SIZE = 60;
const REQUIRED_RATE = 0.95;
const HEALTH_REPORT = path.resolve(
  process.env.DISCOVER_LINK_HEALTH_REPORT ||
    'build/evidence/discover-slice1b-health-20261124/report.json',
);
const OUTPUT_DIR = path.resolve(
  process.env.DISCOVER_LINK_OUTPUT_DIR ||
    'build/evidence/discover-slice1c-links-20261124',
);
const REPORT_FILE = path.join(OUTPUT_DIR, 'report.json');

async function mapLimit(rows, concurrency, worker) {
  const output = new Array(rows.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) return;
      output[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => run()));
  return output;
}

async function probeUrl(item) {
  const url = item.content.url;
  try {
    const response = await safePublicHttpGet(
      url,
      { accept: 'text/html,application/xhtml+xml,*/*;q=0.8', range: 'bytes=0-65535' },
      undefined,
      { timeoutMs: 8_000, maxBodyBytes: 256 * 1024 },
    );
    return {
      itemId: item.itemId,
      title: item.content.title,
      url,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl: response.finalUrl,
    };
  } catch (error) {
    const status = Number(error?.status || 0);
    const errorCode = String(error?.code || error?.message || 'open_failed').slice(0, 160);
    if (errorCode === 'too_large' && status >= 200 && status < 400) {
      return {
        itemId: item.itemId,
        title: item.content.title,
        url,
        ok: true,
        status,
        finalUrl: String(error?.finalUrl || url),
        bodyLimited: true,
      };
    }
    return {
      itemId: item.itemId,
      title: item.content.title,
      url,
      ok: false,
      ...(status ? { status } : {}),
      errorCode,
    };
  }
}

async function main() {
  const health = JSON.parse(await fs.readFile(HEALTH_REPORT, 'utf8'));
  if (health.gate?.result !== 'PASS') {
    throw new Error('30-minute source health gate is not PASS');
  }

  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-links-'));
  const store = new MemoryNetworkItemStore();
  const sourceCycle = await runCycle({ packageRoot, store, cycle: 1 });
  const inactivePublishers = new Set(sourceCycle.inactivePublisherSubjectIds || []);
  const now = new Date().toISOString();
  const items = (await listStore(store, now)).filter(
    (item) => !inactivePublishers.has(item.publisherSubjectId),
  );
  const reservoir = buildDiscoverCandidateReservoir({
    items,
    now,
    capacity: DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
  });

  const sample = [];
  const canonicalUrls = new Set();
  for (const item of reservoir.items) {
    const canonical = normalizeCanonicalUrl(item.content.url);
    if (!canonical || canonicalUrls.has(canonical)) continue;
    canonicalUrls.add(canonical);
    sample.push(item);
    if (sample.length === SAMPLE_SIZE) break;
  }

  const probes = await mapLimit(sample, 6, probeUrl);
  const openable = probes.filter((probe) => probe.ok).length;
  const openableRate = probes.length ? openable / probes.length : 0;
  const gates = {
    healthSession: {
      required: 'PASS',
      actual: health.gate.result,
      pass: health.gate.result === 'PASS',
    },
    sampleSize: {
      required: SAMPLE_SIZE,
      actual: probes.length,
      pass: probes.length === SAMPLE_SIZE,
    },
    linkOpenability: {
      required: REQUIRED_RATE,
      actual: openableRate,
      openable,
      sampled: probes.length,
      pass: probes.length === SAMPLE_SIZE && openableRate >= REQUIRED_RATE,
    },
  };
  const pass = Object.values(gates).every((gate) => gate.pass);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    healthReport: HEALTH_REPORT,
    packageRoot,
    sourceCycle,
    reservoir: reservoir.stats,
    gates,
    failedProbes: probes.filter((probe) => !probe.ok),
    probes,
    result: pass ? 'PASS' : 'FAIL',
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    event: 'final',
    reportFile: REPORT_FILE,
    reservoir: reservoir.stats,
    gates,
    failedProbes: report.failedProbes,
    result: report.result,
  }, null, 2)}\n`);
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
