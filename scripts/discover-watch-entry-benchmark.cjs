#!/usr/bin/env node
/* DISCOVER-WATCH-ENTRY-01: 12 named + 8 open real-runtime requests. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const fixture = require('./fixtures/discover-watch-entry-01.json');
const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime.js');
const {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} = require('../dist/infrastructure/env-secrets.js');
const { readOrCreateInstallCapabilityToken } = require('../dist/capability/install-capability-token.js');

const outputDir = path.resolve(
  process.env.DISCOVER_WATCH_ENTRY_OUTPUT_DIR ||
    `build/evidence/discover-watch-entry-01-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`,
);
const concurrency = Math.max(1, Math.min(3, Number(process.env.DISCOVER_WATCH_ENTRY_CONCURRENCY || 2)));
const limit = Math.max(0, Number(process.env.DISCOVER_WATCH_ENTRY_LIMIT || 0));
const gatewayUrl = String(process.env.DIGITALME_WEB_DISCOVERY_URL || 'https://relay.muhub.cn').replace(/\/+$/, '');
const allRequests = [...fixture.named.map((row) => ({ ...row, kind: 'named' })), ...fixture.open.map((row) => ({ ...row, kind: 'open' }))];
const requestedKind = String(process.env.DISCOVER_WATCH_ENTRY_KIND || '').trim();
const requests = requestedKind === 'named' || requestedKind === 'open'
  ? allRequests.filter((row) => row.kind === requestedKind)
  : allRequests;

function includesExpected(title, terms) {
  if (!terms || !terms.length) return true;
  const normalized = String(title || '').replace(/\s+/g, '').toLocaleLowerCase();
  return terms.some((term) => normalized.includes(String(term).replace(/\s+/g, '').toLocaleLowerCase()));
}

function projectCard(card) {
  return {
    title: card.title || '',
    url: card.url || null,
    contentType: card.contentType || null,
    channelUse: card.channelUse || null,
    entrancePurpose: card.entrancePurpose || null,
    access: card.access || null,
    textOrigin: card.textOrigin || null,
    excerpt: card.excerpt === true,
    basisUrl: card.basisSource?.url || null,
  };
}

function evaluate(request, view, latencyMs) {
  const cards = (view.cards || []).map(projectCard);
  const relatedCards = (view.relatedCards || []).map(projectCard);
  const entryCards = cards.filter((card) =>
    card.url &&
    card.textOrigin === 'body' &&
    card.channelUse === 'watch' &&
    /完整观看|完整入口|试看|预告|片段|平台页/.test(String(card.entrancePurpose || '')),
  );
  const basisMain = cards.filter((card) =>
    card.channelUse === 'discover' ||
    /发现依据|推荐依据|不是观看入口/.test(String(card.entrancePurpose || '')),
  );
  const concreteMain = cards.filter((card) =>
    !basisMain.includes(card) && (card.url || (card.basisUrl && /暂未核实到观看入口/.test(String(card.entrancePurpose || '')))),
  );
  const namedMatched = request.kind !== 'named' || cards.some((card) => includesExpected(card.title, request.expectedTerms));
  const namedEntryOrRestriction = request.kind !== 'named' || entryCards.length > 0 || cards.some((card) =>
    includesExpected(card.title, request.expectedTerms) &&
    /登录|会员|付费|地区|App|验证码|无法|未核实|没有核实|下架|受限/.test(String(card.access || '')),
  );
  return {
    id: request.id,
    kind: request.kind,
    query: request.query,
    latencyMs,
    reasonCode: view.reasonCode || null,
    notice: view.notice || null,
    cards,
    relatedCards,
    metrics: {
      mainCards: cards.length,
      concreteMain: concreteMain.length,
      basisMain: basisMain.length,
      verifiedEntries: entryCards.length,
      namedMatched,
      namedEntryOrRestriction,
      terminalWithin30s: latencyMs <= 30_000,
    },
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
  if (!resolved.configured) throw new Error('no configured model credential');
  const secrets = createEnvSecretAccessor(process.env, resolved.providerId, resolved.runtime);
  const jobs = (limit ? requests.slice(0, limit) : requests).map((request, index) => ({ request, index }));
  let cursor = 0;
  const rows = [];

  async function worker(workerId) {
    while (true) {
      const at = cursor;
      cursor += 1;
      const job = jobs[at];
      if (!job) break;
      // 每个样本模拟一个干净安装，质量门不把“同一安装一小时连续压测”额度混进入口质量。
      // Relay 全局配额与产品内单安装配额均未修改；生产配额另行记录。
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `dm-watch-entry-${workerId}-`));
      const pkg = path.join(root, 'pkg');
      const installToken = await readOrCreateInstallCapabilityToken(path.join(outputDir, `install-${job.request.id}`));
      const runtime = createDigitalMeRuntime({
        documentCapability: 'openai-compatible',
        openaiCompatible: {
          baseUrl: resolved.baseUrl,
          model: resolved.model,
          providerId: resolved.providerId,
          timeoutMs: 60_000,
        },
        secrets,
        registerOpenAiStub: false,
        searchCapability: false,
        webDiscoveryEnabled: true,
        webDiscoveryPath: 'managed',
        webDiscoveryGatewayUrl: gatewayUrl,
        webDiscoveryInstallToken: installToken,
      });
      const started = Date.now();
      let row;
      try {
        await runtime.createPackage({ displayName: `Watch entry benchmark ${job.request.id}`, targetDir: pkg });
        const result = await runtime.content({
          action: 'seek',
          text: job.request.query,
          searchGenerationId: `watch_entry_${job.index + 1}_${Date.now()}`,
        });
        row = evaluate(job.request, result.view, Date.now() - started);
      } catch (error) {
        row = {
          id: job.request.id,
          kind: job.request.kind,
          query: job.request.query,
          latencyMs: Date.now() - started,
          error: String(error?.message || error).slice(0, 300),
          cards: [],
          relatedCards: [],
          metrics: {
            mainCards: 0,
            concreteMain: 0,
            basisMain: 0,
            verifiedEntries: 0,
            namedMatched: false,
            namedEntryOrRestriction: false,
            terminalWithin30s: false,
          },
        };
      } finally {
        await runtime.stop();
      }
      rows.push(row);
      await fs.appendFile(path.join(outputDir, 'runs.jsonl'), `${JSON.stringify(row)}\n`);
      process.stdout.write(`${JSON.stringify({ event: 'run', id: row.id, latencyMs: row.latencyMs, metrics: row.metrics, error: row.error || null })}\n`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, (_, index) => worker(index + 1)));
  rows.sort((left, right) => allRequests.findIndex((row) => row.id === left.id) - allRequests.findIndex((row) => row.id === right.id));
  const totalMain = rows.reduce((sum, row) => sum + row.metrics.mainCards, 0);
  const totalConcrete = rows.reduce((sum, row) => sum + row.metrics.concreteMain, 0);
  const totalEntries = rows.reduce((sum, row) => sum + row.metrics.verifiedEntries, 0);
  const namedRows = rows.filter((row) => row.kind === 'named');
  const gates = {
    complete: { required: jobs.length, actual: rows.length, pass: rows.length === jobs.length },
    mainConcreteRate: { required: 1, actual: totalMain ? totalConcrete / totalMain : 0, pass: totalMain > 0 && totalConcrete === totalMain },
    verifiedEntryRate: { required: 0.7, actual: totalConcrete ? totalEntries / totalConcrete : 0, pass: totalConcrete > 0 && totalEntries / totalConcrete >= 0.7 },
    basisAsMain: { requiredMax: 0, actual: rows.reduce((sum, row) => sum + row.metrics.basisMain, 0), pass: rows.every((row) => row.metrics.basisMain === 0) },
    namedEntryOrRestriction: { required: namedRows.length, actual: namedRows.filter((row) => row.metrics.namedEntryOrRestriction).length, pass: namedRows.every((row) => row.metrics.namedEntryOrRestriction) },
    namedTitleMatch: { required: namedRows.length, actual: namedRows.filter((row) => row.metrics.namedMatched).length, pass: namedRows.every((row) => row.metrics.namedMatched) },
    terminalWithin30s: { required: rows.length, actual: rows.filter((row) => row.metrics.terminalWithin30s).length, pass: rows.every((row) => row.metrics.terminalWithin30s) },
  };
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: resolved.model,
    providerId: resolved.providerId,
    gatewayHost: new URL(gatewayUrl).host,
    requests: rows.length,
    gates,
    result: Object.values(gates).every((gate) => gate.pass) ? 'PASS' : 'FAIL',
  };
  await fs.writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'final', outputDir, summary }, null, 2)}\n`);
  if (summary.result !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
