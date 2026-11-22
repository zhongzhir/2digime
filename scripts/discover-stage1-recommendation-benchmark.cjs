#!/usr/bin/env node
/* Real-model 50 requests x 3 anonymized Digital Self recommendation gate. */
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./fixtures/discover-stage1-recommendation-benchmark.json');
const { chatComplete } = require('../dist/infrastructure/model-http.js');
const {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} = require('../dist/infrastructure/env-secrets.js');
const { providerCredentialKey } = require('../dist/infrastructure/secret-store.js');
const { validateNetworkItem } = require('../dist/subject-comm/network-item.js');
const { selectNetworkItems } = require('../dist/subject-comm/personal-selection.js');
const { OPEN_SOURCE_CATALOG } = require('../dist/subject-comm/open-source-catalog.js');

const OUTPUT_DIR = path.resolve(
  process.env.DISCOVER_RECOMMENDATION_OUTPUT_DIR ||
    'build/evidence/discover-stage1-recommendation-benchmark-20261111',
);
const RUNS_FILE = path.join(OUTPUT_DIR, 'runs.jsonl');
const SUMMARY_FILE = path.join(OUTPUT_DIR, 'summary.json');
const HEALTH_REPORT = path.resolve(
  process.env.DISCOVER_BENCH_HEALTH_REPORT ||
    'build/evidence/discover-stage1-source-health-20261111/report.json',
);
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.DISCOVER_BENCH_CONCURRENCY || 3)));
const LIMIT = Math.max(0, Number(process.env.DISCOVER_BENCH_LIMIT || 0));
const RETRY_FAILED = process.env.DISCOVER_BENCH_RETRY_FAILED === '1';
const NOW = '2026-11-11T04:00:00.000Z';
const CONTENT_TYPES = ['article', 'image', 'audio', 'video'];
const OBJECT_KINDS = ['primary', 'guide', 'commentary', 'listing'];

function digitalSelf(profile) {
  return {
    schemaVersion: 1,
    subjectId: profile.id,
    updatedAt: NOW,
    understandings: profile.understandings.map(([facet, text], index) => ({
      id: `${profile.id}_u${index + 1}`,
      text,
      facet,
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
      updatedAt: NOW,
    })),
  };
}

function expandTasks() {
  const out = [];
  for (const family of fixture.families) {
    family.variants.forEach((request, index) => {
      out.push({
        id: `${family.id}_${index + 1}`,
        familyId: family.id,
        request,
        profileSensitive: family.profileSensitive === true,
        targetTopics: family.targetTopics || [],
        allowedContentTypes: family.allowedContentTypes || [],
        allowedObjectKinds: family.allowedObjectKinds || [],
      });
    });
  }
  if (out.length !== 50) throw new Error(`benchmark must expand to 50 tasks, got ${out.length}`);
  return out;
}

function sourcePool(health) {
  const healthy = new Set(health.healthySourceIds || []);
  const rows = OPEN_SOURCE_CATALOG.filter((source) => healthy.has(source.id));
  if (rows.length < 20) throw new Error(`health report has only ${rows.length} usable sources`);
  return rows;
}

function topicTitle(topic, index) {
  const rows = fixture.topicSpecs[topic];
  return `${rows[index % rows.length]} · ${index + 1}`;
}

function makeItem({ task, index, topics, contentType, objectKind, quality, source }) {
  const topic = topics[0];
  const title = topicTitle(topic, index);
  const text = [
    title,
    `主题：${topics.join('、')}。`,
    quality === 'high' ? '内容给出具体事实、来源和可操作信息。' : '内容信息稀薄，主要是泛泛标题。',
    objectKind === 'primary'
      ? '这是作品、节目或项目本身。'
      : objectKind === 'guide'
        ? '这是可实践的具体指南。'
        : objectKind === 'commentary'
          ? '这是评论或二手报道。'
          : '这是榜单或盘点。',
  ].join(' ');
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: `ni_bench_${task.id}_${index + 1}`,
    publisherSubjectId: `pub_${source.id}`,
    publisherDisplayName: source.label,
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title,
      text,
      url: `${new URL(source.url).origin}/#dm-benchmark-${task.id}-${index + 1}`,
      contentType,
      ...(contentType === 'image'
        ? { mediaUrl: `https://upload.wikimedia.org/wikipedia/commons/benchmark-${index + 1}.jpg` }
        : {}),
      ...(contentType === 'audio'
        ? { mediaUrl: `https://archive.org/download/benchmark-${index + 1}/track.mp3` }
        : {}),
      ...(contentType === 'video'
        ? { mediaUrl: `https://archive.org/download/benchmark-${index + 1}/clip.mp4` }
        : {}),
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!checked.ok) throw new Error(checked.reason);
  return {
    item: checked.item,
    meta: {
      itemId: checked.item.itemId,
      topics,
      contentType,
      objectKind,
      quality,
      sourceId: source.id,
    },
  };
}

function candidatesFor(task, sources) {
  const rows = [];
  const sourceAt = (index) => sources[index % sources.length];
  if (task.profileSensitive) {
    let index = 0;
    for (const profile of fixture.profiles) {
      for (let n = 0; n < 6; n += 1) {
        const topic = profile.interestTopics[n % profile.interestTopics.length];
        rows.push(makeItem({
          task,
          index,
          topics: [topic],
          contentType: CONTENT_TYPES[index % CONTENT_TYPES.length],
          objectKind: index % 3 === 0 ? 'guide' : 'primary',
          quality: 'high',
          source: sourceAt(index),
        }));
        index += 1;
      }
    }
    for (let n = 0; n < 3; n += 1) {
      rows.push(makeItem({
        task,
        index,
        topics: ['product', 'culture', 'science', 'open_source'],
        contentType: CONTENT_TYPES[index % CONTENT_TYPES.length],
        objectKind: n % 2 === 0 ? 'primary' : 'guide',
        quality: 'high',
        source: sourceAt(index),
      }));
      index += 1;
    }
    for (let n = 0; n < 3; n += 1) {
      rows.push(makeItem({
        task,
        index,
        topics: ['security'],
        contentType: CONTENT_TYPES[index % CONTENT_TYPES.length],
        objectKind: 'listing',
        quality: 'low',
        source: sourceAt(index),
      }));
      index += 1;
    }
    return rows;
  }

  for (let index = 0; index < 16; index += 1) {
    const relevant = index < 10;
    const topic = relevant
      ? task.targetTopics[index % task.targetTopics.length]
      : Object.keys(fixture.topicSpecs).find((candidate) => !task.targetTopics.includes(candidate));
    const contentType = relevant && task.allowedContentTypes.length
      ? task.allowedContentTypes[index % task.allowedContentTypes.length]
      : !relevant && task.allowedContentTypes.length && index < 14
        ? task.allowedContentTypes[index % task.allowedContentTypes.length]
        : CONTENT_TYPES[index % CONTENT_TYPES.length];
    const objectKind = relevant && task.allowedObjectKinds.length
      ? task.allowedObjectKinds[index % task.allowedObjectKinds.length]
      : !relevant && task.allowedObjectKinds.length && index < 14
        ? task.allowedObjectKinds[index % task.allowedObjectKinds.length]
        : OBJECT_KINDS[index % OBJECT_KINDS.length];
    rows.push(makeItem({
      task,
      index,
      topics: [topic],
      contentType,
      objectKind,
      quality: relevant || index < 13 ? 'high' : 'low',
      source: sourceAt(index),
    }));
  }
  return rows;
}

function visiblePage(selection) {
  const shown = selection.decisions.filter((row) => row.decision === 'show');
  const page = shown.slice(0, fixture.topK);
  for (const row of selection.decisions) {
    if (page.length >= fixture.topK) break;
    if (!page.some((candidate) => candidate.itemId === row.itemId)) page.push(row);
  }
  return page;
}

function metricsFor({ task, profile, page, metaById, healthyIds }) {
  let relevant = 0;
  let compliant = 0;
  let openable = 0;
  for (const row of page) {
    const meta = metaById.get(row.itemId);
    if (!meta) continue;
    const relevantTopics = task.profileSensitive ? profile.interestTopics : task.targetTopics;
    if (meta.quality === 'high' && meta.topics.some((topic) => relevantTopics.includes(topic))) relevant += 1;
    const typeOk = !task.allowedContentTypes.length || task.allowedContentTypes.includes(meta.contentType);
    const objectOk = !task.allowedObjectKinds.length || task.allowedObjectKinds.includes(meta.objectKind);
    if (typeOk && objectOk) compliant += 1;
    if (healthyIds.has(meta.sourceId)) openable += 1;
  }
  const denominator = page.length || 1;
  return {
    pageSize: page.length,
    relevant,
    compliant,
    openable,
    relevantRate: relevant / denominator,
    conditionRate: compliant / denominator,
    openableRate: openable / denominator,
  };
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 1;
  return [...left].filter((id) => right.has(id)).length / union.size;
}

async function readExisting() {
  try {
    const text = await fs.readFile(RUNS_FILE, 'utf8');
    return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function latestRuns(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(`${row.taskId}:${row.profileId}`, row);
  return [...latest.values()];
}

async function main() {
  const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
  if (!resolved.configured) throw new Error('no configured model credential');
  const secret = createEnvSecretAccessor(process.env, resolved.providerId, resolved.runtime);
  const apiKey = await secret.get(providerCredentialKey(resolved.providerId));
  if (!apiKey) throw new Error('configured model credential could not be read');
  const health = JSON.parse(await fs.readFile(HEALTH_REPORT, 'utf8'));
  if (health.gate?.result !== 'PASS') throw new Error('source health report is not PASS');
  const healthyIds = new Set(health.healthySourceIds || []);
  const sources = sourcePool(health);
  const tasks = expandTasks();
  const existing = await readExisting();
  const latestExisting = latestRuns(existing);
  const done = new Set(
    latestExisting
      .filter((row) => row.ok || !RETRY_FAILED)
      .map((row) => `${row.taskId}:${row.profileId}`),
  );
  let jobs = tasks.flatMap((task) => fixture.profiles.map((profile) => ({ task, profile })));
  jobs = jobs.filter(({ task, profile }) => !done.has(`${task.id}:${profile.id}`));
  if (LIMIT) jobs = jobs.slice(0, LIMIT);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  let writeChain = Promise.resolve();
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      if (!job) return;
      const { task, profile } = job;
      const candidates = candidatesFor(task, sources);
      const metaById = new Map(candidates.map((candidate) => [candidate.meta.itemId, candidate.meta]));
      const startedAt = Date.now();
      const usage = [];
      const selection = await selectNetworkItems({
        digitalSelf: digitalSelf(profile),
        items: candidates.map((candidate) => candidate.item),
        targetCount: fixture.topK,
        preferenceDirectives: `- [temporary_request] ${task.request}`,
        selectionNotes: `用户本次明确要求（仅本轮）：${task.request}`,
        model: { baseUrl: resolved.baseUrl, model: resolved.model, apiKey },
        chatComplete: async (options) => {
          const result = await chatComplete({ ...options, apiKey, baseUrl: resolved.baseUrl, model: resolved.model });
          if (result.usage) usage.push(result.usage);
          return result;
        },
      });
      const page = selection.ok ? visiblePage(selection) : [];
      const row = {
        taskId: task.id,
        familyId: task.familyId,
        request: task.request,
        profileId: profile.id,
        profileSensitive: task.profileSensitive,
        ok: selection.ok,
        detail: selection.ok ? undefined : selection.detail,
        latencyMs: Date.now() - startedAt,
        page: page.map((decision) => ({
          ...decision,
          ...metaById.get(decision.itemId),
        })),
        metrics: selection.ok
          ? metricsFor({ task, profile, page, metaById, healthyIds })
          : { pageSize: 0, relevant: 0, compliant: 0, openable: 0, relevantRate: 0, conditionRate: 0, openableRate: 0 },
        usage,
      };
      writeChain = writeChain.then(() => fs.appendFile(RUNS_FILE, `${JSON.stringify(row)}\n`));
      await writeChain;
      process.stdout.write(`${JSON.stringify({ event: 'run', taskId: task.id, profileId: profile.id, ok: row.ok, metrics: row.metrics, latencyMs: row.latencyMs })}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const attempts = await readExisting();
  const runs = latestRuns(attempts);
  const complete = runs.length === tasks.length * fixture.profiles.length;
  const successful = runs.filter((row) => row.ok);
  const totalCards = successful.reduce((sum, row) => sum + row.metrics.pageSize, 0) || 1;
  const relevant = successful.reduce((sum, row) => sum + row.metrics.relevant, 0) / totalCards;
  const constrained = successful.filter((row) => {
    const task = tasks.find((candidate) => candidate.id === row.taskId);
    return task && (task.allowedContentTypes.length || task.allowedObjectKinds.length);
  });
  const constrainedCards = constrained.reduce((sum, row) => sum + row.metrics.pageSize, 0) || 1;
  const condition = constrained.reduce((sum, row) => sum + row.metrics.compliant, 0) / constrainedCards;
  const openable = successful.reduce((sum, row) => sum + row.metrics.openable, 0) / totalCards;
  const overlaps = [];
  for (const task of tasks.filter((row) => row.profileSensitive)) {
    const rows = runs.filter((run) => run.taskId === task.id && run.ok);
    for (let left = 0; left < rows.length; left += 1) {
      for (let right = left + 1; right < rows.length; right += 1) {
        overlaps.push(jaccard(rows[left].page.map((row) => row.itemId), rows[right].page.map((row) => row.itemId)));
      }
    }
  }
  const overlap = overlaps.length ? overlaps.reduce((sum, value) => sum + value, 0) / overlaps.length : 1;
  const gates = {
    complete: { required: 150, actual: runs.length, pass: complete },
    selectionSuccess: { required: 1, actual: successful.length / (runs.length || 1), pass: successful.length === runs.length && complete },
    relevantRate: { required: 0.7, actual: relevant, pass: relevant >= 0.7 },
    explicitConditionRate: { required: 0.85, actual: condition, pass: condition >= 0.85 },
    sourceOpenableRate: { required: 0.95, actual: openable, pass: openable >= 0.95 },
    profileSensitiveOverlap: { requiredMax: 0.7, actual: overlap, pass: overlap <= 0.7 },
  };
  const pass = Object.values(gates).every((gate) => gate.pass);
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: resolved.model,
    providerId: resolved.providerId,
    fixtureTasks: tasks.length,
    profiles: fixture.profiles.map((profile) => profile.id),
    attempts: attempts.length,
    runs: runs.length,
    gates,
    result: pass ? 'PASS' : complete ? 'FAIL' : 'INCOMPLETE',
  };
  await fs.writeFile(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'final', summary }, null, 2)}\n`);
  if (complete && !pass) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
