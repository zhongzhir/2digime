'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_FILE = path.join(__dirname, 'supplemental-ui-validation-result.json');
const FIXTURE_FILE = path.join(__dirname, 'offline-blockchain-replay-input.json');
const RESULT_FILE = path.join(__dirname, 'offline-blockchain-replay-result.json');
const EVIDENCE_DIR = path.join(__dirname, 'evidence', 'closeout');
const BASE_URL = 'https://ws-ok2fv132ihswnia7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.8-flash';
const DEPS = process.env.DIGITALME_VALIDATION_DEPS ||
  'D:\\Projects\\Digital Me\\.task-worktrees\\core-link-01\\node_modules';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readNdjson(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function evidenceKey(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function cardSource(card) {
  const line = String((card.source || [])[0] || '');
  const match = /^(.*) · (\d{4}-\d{2}-\d{2})$/.exec(line);
  return match ? { name: match[1], publishedAt: match[2] } : { name: line, publishedAt: '' };
}

function buildReplayInput() {
  const saved = readJson(SOURCE_FILE);
  const task = saved.tasks && saved.tasks['05-blockchain-quality'];
  assert.ok(task && task.diagnostic && task.diagnostic.trace, 'saved blockchain trace missing');
  assert.equal(task.cards.length, 7, 'expected the saved seven-card real response');
  const trace = task.diagnostic.trace;
  const rows = task.cards.map((card) => {
    const source = cardSource(card);
    return {
      title: card.title,
      url: card.url,
      summary: card.excerpt,
      why: '',
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      ...(source.name ? { sourceName: source.name } : {}),
      contentType: 'article',
      readStatus: card.textOrigin === 'body' ? 'read' : 'snippet_only',
    };
  });
  const readRows = rows.filter((row) => row.readStatus === 'read');
  const groups = [readRows.slice(0, 3), readRows.slice(3, 5), readRows.slice(5)];
  const output = [{
    id: 'replay_search_1',
    type: 'web_search_call',
    status: 'completed',
    action: {
      type: 'search',
      sources: trace.sources.map((source) => ({ url: source.url, ...(source.title ? { title: source.title } : {}) })),
    },
  }];
  groups.forEach((group, index) => {
    output.push({
      id: 'replay_extract_' + (index + 1),
      type: 'web_extractor_call',
      status: 'completed',
      urls: group.map((row) => row.url),
      output: group.map((row) => row.url + '\n' + row.summary).join('\n\n'),
    });
  });
  output.push({
    id: 'replay_present_1',
    type: 'function_call',
    status: 'completed',
    call_id: 'replay_present_call_1',
    name: 'present_results',
    arguments: JSON.stringify({
      summary: '已完成区块链最新报道与深度分析检索。',
      results: rows,
    }),
  });
  return {
    provenance: {
      sourceFile: path.relative(ROOT, SOURCE_FILE).replace(/\\/g, '/'),
      sourceResponseId: trace.responseId,
      sourceCompletedAt: saved.completedAt,
      captureKind: 'normalized_saved_real_ui_cards_and_provider_trace',
      limitation: 'The original provider SSE bytes and present_results arguments were not retained; empty why fields and the replay summary are reconstruction metadata, not supplier evidence.',
    },
    terminalResponse: {
      id: 'replay_' + trace.responseId,
      status: 'completed',
      output,
      usage: {
        input_tokens: trace.usage.inputTokens,
        output_tokens: trace.usage.outputTokens,
        output_tokens_details: { reasoning_tokens: trace.usage.reasoningTokens },
        x_tools: {
          web_search: { count: trace.webSearchCalls },
          web_extractor: { count: trace.webExtractorCalls },
        },
      },
    },
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const replay = buildReplayInput();
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(replay, null, 2) + '\n', 'utf8');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-blockchain-replay-'));
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-blockchain-replay-home-'));
  const requestLog = path.join(userData, 'responses-replay-requests.ndjson');
  const bootstrap = path.join(userData, 'electron-replay-bootstrap.cjs');
  const screenshot = path.join(EVIDENCE_DIR, '01-offline-blockchain-replay.png');
  const mainPath = path.join(ROOT, 'electron', 'main.cjs');
  const bootstrapSource = [
    "const fs = require('node:fs');",
    "process.env.NODE_PATH = " + JSON.stringify(DEPS) + " + require('node:path').delimiter + (process.env.NODE_PATH || '');",
    "require('node:module').Module._initPaths();",
    "const fixture = JSON.parse(fs.readFileSync(process.env.DIGITALME_RESPONSES_REPLAY_FIXTURE, 'utf8'));",
    "const endpoint = " + JSON.stringify(BASE_URL + '/responses') + ";",
    "global.fetch = async (url, init = {}) => {",
    "  const target = String(url);",
    "  if (target !== endpoint) throw new Error('OFFLINE_REPLAY_BLOCKED_UNEXPECTED_NETWORK ' + target);",
    "  const body = JSON.parse(String(init.body || '{}'));",
    "  fs.appendFileSync(process.env.DIGITALME_RESPONSES_REPLAY_LOG, JSON.stringify({",
    "    at: new Date().toISOString(), method: String(init.method || 'GET'), url: target, model: body.model,",
    "    maxOutputTokens: body.max_output_tokens, stream: body.stream, store: body.store,",
    "    tools: Array.isArray(body.tools) ? body.tools.map((tool) => tool.type === 'function' ? tool.name : tool.type) : []",
    "  }) + '\\n');",
    "  const terminal = fixture.terminalResponse;",
    "  const events = terminal.output.map((item) => 'data: ' + JSON.stringify({ type: 'response.output_item.added', item }) + '\\n\\n');",
    "  events.push('data: ' + JSON.stringify({ type: 'response.completed', response: terminal }) + '\\n\\n');",
    "  return new Response(events.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });",
    "};",
    "require(" + JSON.stringify(mainPath) + ");",
    "",
  ].join('\n');
  fs.writeFileSync(bootstrap, bootstrapSource, 'utf8');

  const playwright = require(path.join(DEPS, 'playwright'));
  const electronPath = require(path.join(DEPS, 'electron'));
  const report = {
    task: 'DIGITALME-UNIFIED-CAPABILITY-01 offline blockchain replay',
    startedAt: new Date().toISOString(),
    head: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    sourceResponseId: replay.provenance.sourceResponseId,
    isolatedUserData: userData,
    fixture: path.relative(ROOT, FIXTURE_FILE).replace(/\\/g, '/'),
    productNetworkCalls: 0,
    cards: [],
    checks: {},
    failures: [],
  };
  let app;
  try {
    app = await playwright._electron.launch({
      executablePath: electronPath,
      args: ['--disable-gpu', '--disable-dev-shm-usage', bootstrap],
      cwd: ROOT,
      timeout: 60_000,
      env: Object.assign({}, process.env, {
        NODE_PATH: DEPS,
        DIGITALME_V2_ROOT: ROOT,
        DIGITALME_V2_USER_DATA: userData,
        DIGITALME_V2_HOME: isolatedHome,
        DIGITALME_V2_ELECTRON_TEST: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '0',
        DIGITALME_RESPONSES_REPLAY_FIXTURE: FIXTURE_FILE,
        DIGITALME_RESPONSES_REPLAY_LOG: requestLog,
      }),
    });
    const page = await app.firstWindow({ timeout: 45_000 });
    await page.waitForLoadState('domcontentloaded');
    report.configuration = await page.evaluate(async (input) => {
      const saved = await window.digitalMe.saveModelCredential({
        apiKey: 'offline-replay-process-only-credential',
        baseUrl: input.baseUrl,
        model: input.model,
        providerPreset: 'openai-compatible',
      });
      await window.digitalMe.saveAiCapabilitySettings({ path: 'byok' });
      await window.digitalMe.saveWebDiscoverySettings({ enabled: true, path: 'byok' });
      return { modelReady: saved.modelReady, model: input.model, host: new URL(input.baseUrl).host };
    }, { baseUrl: BASE_URL, model: MODEL });
    const shell = page.locator('#view-shell');
    if (!(await shell.isVisible().catch(() => false))) {
      const skip = page.locator('#btn-welcome-skip-model');
      if (await skip.isVisible().catch(() => false)) await skip.click();
    }
    await shell.waitFor({ state: 'visible', timeout: 30_000 });
    const subjectDir = (await page.evaluate(() => window.digitalMe.getDefaultSubjectDir())).dir;
    report.subjectDir = subjectDir;
    await page.locator('#nav-discover').click();
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#content-discover-query').fill('找一些关于区块链的最新报道和深度分析文章。');
    await page.locator('#btn-content-discover-search').click();
    await page.locator('#content-discover[data-replenishing="0"]').waitFor({ state: 'attached', timeout: 30_000 });
    await page.locator('#btn-discover-cancel').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForTimeout(500);
    report.cards = await page.locator('#content-discover-list .content-discover-card').evaluateAll((nodes) => nodes.map((node) => ({
      itemId: node.getAttribute('data-item-id') || '',
      title: (node.querySelector('h3') || {}).textContent || '',
      url: node.getAttribute('data-url') || '',
      publishedDay: node.getAttribute('data-published-day') || '',
      textOrigin: node.getAttribute('data-text-origin') || '',
      sourceLines: Array.from(node.querySelectorAll('.content-discover-source')).map((item) => item.textContent || ''),
      excerpt: (node.querySelector('.content-discover-excerpt') || {}).textContent || '',
    })));
    report.notice = await page.locator('#content-discover-notice').innerText();
    await page.screenshot({ path: screenshot, fullPage: true });

    const diagnostics = readNdjson(path.join(subjectDir, 'content', 'discovery-diagnostics.ndjson'));
    report.diagnostic = diagnostics[diagnostics.length - 1] || null;
    const cache = readJson(path.join(subjectDir, 'content', 'personal-feed-cache.json'));
    report.contentStorage = cache;
    report.adapterRequests = readNdjson(requestLog);
    const traceSources = new Map((report.diagnostic.trace.sources || []).map((source) => [evidenceKey(source.url), source]));
    const { isSpecificUnifiedResultUrl } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime.js'));
    const expectedSpecific = replay.terminalResponse.output.at(-1).arguments;
    const expectedRows = JSON.parse(expectedSpecific).results.filter((row) => isSpecificUnifiedResultUrl(row.url));
    const expectedUrls = expectedRows.map((row) => evidenceKey(row.url)).sort();
    const actualUrls = report.cards.map((card) => evidenceKey(card.url)).sort();
    const storedIds = (cache.lastView && cache.lastView.itemIds) || [];
    const actualIds = report.cards.map((card) => card.itemId);
    report.checks = {
      adapterReceivedOneResponsesRequest: report.adapterRequests.length === 1 &&
        report.adapterRequests[0].method === 'POST' && report.adapterRequests[0].url === BASE_URL + '/responses',
      adapterConfigurationPreserved: report.adapterRequests.length === 1 &&
        report.adapterRequests[0].maxOutputTokens === 8192 &&
        ['web_search', 'web_extractor', 'present_results'].every((name) => report.adapterRequests[0].tools.includes(name)),
      exactlyFiveSpecificArticlesRemain: report.cards.length === 5 && JSON.stringify(actualUrls) === JSON.stringify(expectedUrls),
      bothHomepagesRejected: !actualUrls.includes(evidenceKey('https://www.techflowpost.com/')) &&
        !actualUrls.includes(evidenceKey('https://www.wublock123.com/')),
      contentStorageMatchesVisibleCards: cache.lastView && cache.lastView.mode === 'intent' &&
        cache.lastView.query === '找一些关于区块链的最新报道和深度分析文章。' &&
        JSON.stringify(storedIds) === JSON.stringify(actualIds),
      allSourcesBoundToExactTraceUrl: report.cards.every((card) => traceSources.has(evidenceKey(card.url))),
      allBodyStatesMatchTrace: report.cards.every((card) =>
        card.textOrigin === (traceSources.get(evidenceKey(card.url)).readStatus === 'read' ? 'body' : 'snippet')),
      everyDisplayedDateHasReadSourceEvidence: report.cards.every((card) =>
        !card.publishedDay || traceSources.get(evidenceKey(card.url)).readStatus === 'read'),
      legalArticleQueryParametersSurvive: isSpecificUnifiedResultUrl(
        'https://example.org/articles/blockchain-outlook?q=blockchain&utm_source=newsletter',
      ) && isSpecificUnifiedResultUrl(
        'https://example.org/articles/blockchain-outlook?query=reader&ref=home',
      ),
      structuralSearchPageStillRejected: !isSpecificUnifiedResultUrl('https://example.org/news/search?query=blockchain'),
      noUnexpectedNetwork: report.adapterRequests.length === 1,
    };
    report.passed = Object.values(report.checks).every(Boolean);
    assert.equal(report.passed, true, JSON.stringify(report.checks));
  } catch (error) {
    report.failures.push(String(error && error.stack || error));
    report.passed = false;
  } finally {
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
    if (app) await app.close().catch(() => undefined);
  }
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
