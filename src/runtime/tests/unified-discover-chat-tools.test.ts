import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { upsertContentPreference } from '../../subject-comm/content-preferences';
import { appendRecentRecommendationEvent } from '../../subject-comm/recent-recommendation-state';
import type { ChatMessage, ChatToolCall } from '../../infrastructure/model-http';

function toolCall(id: string, name: string, args: object): ChatToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function lastToolPayload(messages: ChatMessage[]): Record<string, unknown> {
  const row = [...messages].reverse().find((message) => message.role === 'tool');
  assert.ok(row, 'the model must receive the actual tool result');
  return JSON.parse(row.content) as Record<string, unknown>;
}

test('chat Discover lets one current model search and holistically select source-bound candidates', async () => {
  const pkg = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-chat-')), 'pkg');
  let modelRound = 0;
  let searchCalls = 0;
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async (query) => {
      searchCalls += 1;
      assert.equal(query, 'durable design field guide');
      return [
        {
          title: 'A durable field guide for product teams',
          url: 'https://knowledge.example/guides/durable-design',
          snippet: 'A practical long-form guide with primary examples and exercises.',
        },
        {
          title: 'Unrelated event calendar',
          url: 'https://events.example/calendar/autumn',
          snippet: 'A city event calendar with no product design material.',
        },
      ];
    },
    contentChat: async (request) => {
      modelRound += 1;
      if (modelRound === 1) {
        const prompt = request.messages.map((message) => message.content).join('\n');
        assert.match(prompt, /Prefer practical material with primary examples/);
        assert.match(prompt, /优先原始来源/);
        assert.match(prompt, /Recently opened systems essay/);
        assert.match(prompt, /Find a durable design field guide/);
        assert.deepEqual(
          request.tools?.map((tool) => tool.function.name),
          ['web_search', 'read_candidate', 'present_results'],
        );
        return {
          text: '',
          toolCalls: [toolCall('search-1', 'web_search', { query: 'durable design field guide' })],
        };
      }
      const payload = lastToolPayload(request.messages);
      const candidates = payload.candidates as Array<Record<string, unknown>>;
      assert.equal(candidates.length, 2);
      const chosen = candidates.find((row) => row.title === 'A durable field guide for product teams');
      assert.ok(chosen);
      return {
        text: '',
        toolCalls: [toolCall('present-1', 'present_results', {
          summary: 'Found one directly useful guide.',
          selections: [{
            candidateId: chosen.candidateId,
            why: 'It directly matches the requested practical, source-first guide.',
            placement: 'main',
            contentType: 'article',
            entrancePurpose: 'read',
          }],
        })],
      };
    },
  });
  try {
    const created = await runtime.createPackage({ displayName: 'Unified chat', targetDir: pkg });
    const now = new Date().toISOString();
    await writeDigitalSelf(pkg, {
      schemaVersion: 1,
      subjectId: created.subjectId,
      updatedAt: now,
      understandings: [{
        id: 'u_source_first',
        text: 'Prefer practical material with primary examples',
        facet: 'preferences',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      }],
    });
    await upsertContentPreference(pkg, {
      kind: 'steer',
      targetType: 'directive',
      target: 'source-first',
      text: '优先原始来源',
    });
    await appendRecentRecommendationEvent(pkg, {
      type: 'opened',
      itemId: 'recent-1',
      title: 'Recently opened systems essay',
    });

    const result = await runtime.content({
      action: 'seek',
      text: 'Find a durable design field guide',
      searchGenerationId: 'sg_unified_chat',
    });

    assert.equal(searchCalls, 1);
    assert.equal(modelRound, 2);
    assert.equal(result.view.reasonCode, 'UNIFIED_CHAT_TOOLS');
    assert.deepEqual(result.view.cards.map((card) => card.title), [
      'A durable field guide for product teams',
    ]);
    assert.equal(result.view.cards[0]?.url, 'https://knowledge.example/guides/durable-design');
    assert.doesNotMatch(JSON.stringify(result.view), /Unrelated event calendar/);
    assert.equal(result.view.replenishing, false);
  } finally {
    await runtime.stop();
  }
});

test('chat Discover reads a source-bound candidate before delivering a truthful preview entry', async () => {
  const pkg = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-chat-watch-')), 'pkg');
  let modelRound = 0;
  let candidateId = '';
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async () => [{
      title: '《山海小队》官方预告',
      url: 'https://video.example/show/shanhai/trailer',
      snippet: '平台搜索摘要称这是官方预告。',
    }],
    publicPageRead: async (url) => ({
      content: '《山海小队》官方预告。可试看 3 分钟；完整剧集需要登录并开通会员。',
      resolvedUrl: url + '?from=official',
    }),
    contentChat: async (request) => {
      modelRound += 1;
      if (modelRound === 1) {
        return { text: '', toolCalls: [toolCall('search', 'web_search', { query: '山海小队 官方观看 预告' })] };
      }
      if (modelRound === 2) {
        const payload = lastToolPayload(request.messages);
        const candidates = payload.candidates as Array<Record<string, unknown>>;
        candidateId = String(candidates[0]?.candidateId || '');
        assert.ok(candidateId);
        return { text: '', toolCalls: [toolCall('read', 'read_candidate', { candidateId })] };
      }
      const read = lastToolPayload(request.messages);
      assert.equal(read.ok, true);
      assert.match(String(read.content || ''), /试看 3 分钟/);
      assert.equal(read.url, 'https://video.example/show/shanhai/trailer?from=official');
      return {
        text: '',
        toolCalls: [toolCall('present', 'present_results', {
          summary: '找到一个已核实的官方预告入口。',
          selections: [{
            candidateId,
            why: '页面明确对应这部剧，并提供公开试看。',
            placement: 'main',
            resultKind: 'candidate',
            summary: '官方预告可试看 3 分钟。',
            contentType: 'video',
            channelUse: 'watch',
            entryKind: 'preview',
            access: '可试看 3 分钟；完整剧集需要登录并开通会员。',
          }],
        })],
      };
    },
  });
  try {
    await runtime.createPackage({ displayName: 'Watch entry', targetDir: pkg });
    const result = await runtime.content({
      action: 'seek',
      text: '我想看《山海小队》',
      searchGenerationId: 'sg_watch_entry',
    });
    assert.equal(modelRound, 3);
    const card = result.view.cards[0];
    assert.equal(card?.url, 'https://video.example/show/shanhai/trailer?from=official');
    assert.equal(card?.textOrigin, 'body');
    assert.equal(card?.channelUse, 'watch');
    assert.equal(card?.excerpt, true);
    assert.match(card?.entrancePurpose || '', /试看|预告/);
    assert.match(card?.access || '', /登录.*会员/);
  } finally {
    await runtime.stop();
  }
});

test('chat Discover rejects an un-read candidate claiming to be a watch entry', async () => {
  const pkg = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-chat-unread-watch-')), 'pkg');
  let modelRound = 0;
  let candidateId = '';
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async () => [{
      title: 'Unverified episode page',
      url: 'https://video.example/show/episode-1',
      snippet: 'Search snippet only.',
    }],
    contentChat: async (request) => {
      modelRound += 1;
      if (modelRound === 1) {
        return { text: '', toolCalls: [toolCall('search', 'web_search', { query: 'episode 1 watch' })] };
      }
      if (modelRound === 2) {
        const payload = lastToolPayload(request.messages);
        candidateId = String((payload.candidates as Array<Record<string, unknown>>)[0]?.candidateId || '');
        return {
          text: '',
          toolCalls: [toolCall('premature', 'present_results', {
            summary: 'claimed too early',
            selections: [{
              candidateId,
              why: 'snippet claim',
              placement: 'main',
              resultKind: 'candidate',
              contentType: 'video',
              entryKind: 'full',
            }],
          })],
        };
      }
      const rejected = lastToolPayload(request.messages);
      assert.equal(rejected.ok, false);
      assert.deepEqual(rejected.unverifiedEntryCandidateIds, [candidateId]);
      assert.match(String(rejected.failureReason || ''), /必须先通过 read_candidate/);
      return {
        text: '',
        toolCalls: [toolCall('honest', 'present_results', {
          summary: 'Only a search snippet was available.',
          emptyConfirmed: true,
          selections: [],
        })],
      };
    },
  });
  try {
    await runtime.createPackage({ displayName: 'Unread watch guard', targetDir: pkg });
    const result = await runtime.content({
      action: 'seek',
      text: 'Watch episode 1',
      searchGenerationId: 'sg_unread_watch',
    });
    assert.equal(modelRound, 3);
    assert.equal(result.view.cards.length, 0);
    assert.match(result.view.notice || '', /Only a search snippet/);
  } finally {
    await runtime.stop();
  }
});

test('chat Discover rejects invented candidate ids and lets the same model correct delivery', async () => {
  const pkg = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-chat-integrity-')), 'pkg');
  let modelRound = 0;
  let realCandidateId = '';
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async () => [{
      title: 'Verified handbook',
      url: 'https://docs.example/handbook/verified',
      snippet: 'The actual source-bound handbook.',
    }],
    contentChat: async (request) => {
      modelRound += 1;
      if (modelRound === 1) {
        return { text: '', toolCalls: [toolCall('s1', 'web_search', { query: 'verified handbook' })] };
      }
      if (modelRound === 2) {
        const payload = lastToolPayload(request.messages);
        realCandidateId = String((payload.candidates as Array<Record<string, unknown>>)[0]?.candidateId || '');
        return {
          text: '',
          toolCalls: [toolCall('p1', 'present_results', {
            summary: 'first delivery',
            selections: [{ candidateId: 'candidate_invented', why: 'invented', placement: 'main' }],
          })],
        };
      }
      const rejected = lastToolPayload(request.messages);
      assert.equal(rejected.ok, false);
      assert.deepEqual(rejected.rejectedCandidateIds, ['candidate_invented']);
      return {
        text: '',
        toolCalls: [toolCall('p2', 'present_results', {
          summary: 'corrected delivery',
          selections: [{ candidateId: realCandidateId, why: 'source-bound', placement: 'main' }],
        })],
      };
    },
  });
  try {
    await runtime.createPackage({ displayName: 'Integrity', targetDir: pkg });
    const result = await runtime.content({
      action: 'seek',
      text: 'Find the verified handbook',
      searchGenerationId: 'sg_integrity',
    });
    assert.equal(modelRound, 3);
    assert.deepEqual(result.view.cards.map((card) => card.title), ['Verified handbook']);
    assert.equal(result.view.cards[0]?.url, 'https://docs.example/handbook/verified');
  } finally {
    await runtime.stop();
  }
});

test('chat Discover reaches a visible terminal answer when search returns no candidates', async () => {
  const pkg = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-chat-empty-')), 'pkg');
  let modelRound = 0;
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async () => [],
    contentChat: async (request) => {
      modelRound += 1;
      if (modelRound === 1) {
        return { text: '', toolCalls: [toolCall('s1', 'web_search', { query: 'rare primary source' })] };
      }
      assert.deepEqual(lastToolPayload(request.messages).candidates, []);
      return { text: 'I could not verify a usable source. Which author or edition do you mean?' };
    },
  });
  try {
    await runtime.createPackage({ displayName: 'Empty terminal', targetDir: pkg });
    const result = await runtime.content({
      action: 'seek',
      text: 'Find the rare primary source',
      searchGenerationId: 'sg_empty',
    });
    assert.equal(modelRound, 2);
    assert.equal(result.view.cards.length, 0);
    assert.equal(result.view.replenishing, false);
    assert.match(result.view.responseText || '', /could not verify/);
    assert.equal(result.view.searchUsage?.calls, 1);
  } finally {
    await runtime.stop();
  }
});

test('chat Discover can deliver concrete recommendation objects without mislabeling evidence URLs', async () => {
  const pkg = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-chat-basis-')), 'pkg');
  let modelRound = 0;
  let candidates: Array<Record<string, unknown>> = [];
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async () => [
      {
        title: 'Independent weekly culture chart',
        url: 'https://culture.example/reports/weekly-chart',
        snippet: 'The chart identifies Oak Lantern and River Atlas as the two strongest new releases.',
      },
      {
        title: 'Editors compare this week’s releases',
        url: 'https://editors.example/features/new-releases',
        snippet: 'Editors also highlight Oak Lantern and River Atlas with different strengths.',
      },
    ],
    contentChat: async (request) => {
      modelRound += 1;
      if (modelRound === 1) {
        return { text: '', toolCalls: [toolCall('s1', 'web_search', { query: 'current culture releases' })] };
      }
      if (modelRound === 2) {
        const payload = lastToolPayload(request.messages);
        candidates = payload.candidates as Array<Record<string, unknown>>;
        return {
          text: '',
          toolCalls: [toolCall('empty-first', 'present_results', {
            summary: '',
            selections: [],
          })],
        };
      }
      const retry = lastToolPayload(request.messages);
      assert.equal(retry.ok, false);
      assert.match(String(retry.failureReason || ''), /再整体检查一次/);
      return {
        text: '',
        toolCalls: [toolCall('p1', 'present_results', {
          summary: 'Two concrete releases are supported by independent sources.',
          selections: [
            {
              candidateId: candidates[0]?.candidateId,
              resultKind: 'recommendation',
              title: 'Oak Lantern',
              summary: 'A new release highlighted across the current chart and editorial comparison.',
              why: 'It appears in independent current sources.',
              placement: 'main',
            },
            {
              candidateId: candidates[1]?.candidateId,
              resultKind: 'recommendation',
              title: 'River Atlas',
              summary: 'A second current release with a distinct editorial case.',
              why: 'It is separately supported by the comparison source.',
              placement: 'main',
            },
          ],
        })],
      };
    },
  });
  try {
    await runtime.createPackage({ displayName: 'Basis identity', targetDir: pkg });
    const result = await runtime.content({
      action: 'seek',
      text: 'Recommend current culture releases',
      searchGenerationId: 'sg_basis',
    });
    assert.deepEqual(result.view.cards.map((card) => card.title), ['Oak Lantern', 'River Atlas']);
    assert.deepEqual(result.view.cards.map((card) => card.url), [undefined, undefined]);
    assert.deepEqual(result.view.cards.map((card) => card.basisSource?.url), [
      'https://culture.example/reports/weekly-chart',
      'https://editors.example/features/new-releases',
    ]);
    assert.match(result.view.cards[0]?.access || '', /推荐依据/);
    assert.match(result.view.cards[0]?.entrancePurpose || '', /暂未核实到观看入口/);
    assert.equal(result.view.cards[0]?.channelUse, undefined);
  } finally {
    await runtime.stop();
  }
});
