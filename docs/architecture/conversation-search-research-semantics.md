# Conversation Search & Research — Frozen Semantics (DIGITALME-CONVERSATION-SEARCH-RESEARCH-01)

Branch: `build/conversation-search-research-01` (base `db49203`)
Owner: User · CTO: 2digime · Coding Agent: opencode
Status: **frozen product semantics** — implementation follows this doc. This is not a marketing claim; it is a contract for the code, tests, and evidence.

## 1. What this feature is

Upgrade the 2digime conversation so that, given a natural-language turn, it:

1. decides whether external information is needed (`no_search` / `web_search` / `deep_research`);
2. when needed, runs a real external search/research pipeline;
3. synthesizes the answer by combining the **Digital Me owner context** (subject facts) with **external sources**;
4. returns a natural answer with **verifiable citations**, and never silently pollutes the owner's identity with external facts.

We are **not** building a search engine, **not** stacking search APIs, and **not** doing keyword routing.

## 2. Audit summary (what exists today)

- Conversation handler: `electron/main.cjs` ~L983-1130. Builds `systemContent` via `runtime.buildConversationSystemContent`, assembles subject context via `runtime.buildConversationSubjectContext()` (same selector as the UI "already knows" list), then calls `chatComplete` directly. No search step exists.
- Model gateway: `src/infrastructure/model-http.ts` — `chatComplete` (OpenAI-compatible), `response_format: json_object` supported, no tool-calls field parsing.
- Capability system: `src/capability/adapter.ts` (CapabilityAdapter contract), `registry.ts` (CapabilityRegistry), `registration.ts` (ADAPTER_TYPES whitelist: openai-compatible-model, local-tool, remote-subject, external-executor-cli, external-executor-http, external-executor-model-api, mcp-stdio). `mcp-stdio-readonly.ts` is the read-only MCP pattern.
- Legacy research: `reference-agents/research-a2a-agent` (A2A research agent, independent port 43111/43112) — do **not** resurrect; not part of this pipeline.
- Subject context injection: `src/subject-core/conversation-context.ts` `buildConversationSubjectContext` — the owner-context source for the conversation.

## 3. Frozen product semantics

### 3.1 Three search modes

| Mode | When | Examples (frozen) |
|---|---|---|
| `no_search` | Common sense / reasoning / writing / owner context already sufficient. Model must not search. Also whenever the user explicitly says not to search ("不要搜索", "别查"). | "水在0摄氏度会结冰吗" |
| `web_search` | Latest info, real-world fact-checking, current price/policy/company/product/news, local model knowledge likely outdated. Needs sources. | "OpenAI 今天/最近有什么新闻", "某产品官方价格" |
| `deep_research` | Multi-entity comparison, complex research, investment/industry/tech research, cross-validation across many sources, or the user explicitly asks "深入研究/调研". | "2026年中国AI Agent创业与融资趋势", "对比A和B哪个更好" |

Decision inputs: **model judgment** (LLM classifies) + **explicit task features** (user says "搜索一下/查一下" → `web_search`; "深入研究/调研一下" → `deep_research`; "不要搜索/别查" → `no_search`, hard override). No keyword if/else tree as the decision mechanism.

### 3.2 Capability architecture (must be preserved)

```
Owner/User turn
   → 2digime Conversation/Research Need (decision)
        → External Capability Contract (search_mode + queries, model-independent)
           → Search/Research Connector (adapter layer; provider-specific)
              → Real external capability (Bing HTML in v1; swappable)
```

Rules:
- Provider specifics live only in the connector adapter. Upper layers never hardcode Bing/Google/Tavily/Claude/OpenAI business decisions.
- v1 connector = **real Bing HTML search** (no account, no key, returns sources; verified reachable from this machine). Implemented as a capability adapter or thin connector service, swappable.
- Decision + synthesis use the connected model (`openai-compatible` DeepSeek `deepseek-v4-flash`) through the existing model gateway — no new provider.

### 3.3 `web_search` pipeline (frozen)

1. **Decision**: model emits `{search_mode, queries[]}` via `response_format: json_object`.
2. **Execute**: connector runs each query against real Bing HTML; extract `{title, url, snippet}` per result (Bing `u=` decode: `Buffer.from('a' + u.slice(3),'base64')`). Take top N results per query.
3. **Relevance**: filter junk / non-extractable results; cap total sources.
4. **Synthesis**: single model call with system prompt + owner context + turn history + structured source list. Requirements in the prompt:
   - distinguish **source facts** vs **reasoning** vs **Digital Me known personal info**;
   - key facts carry `[n]` citation markers;
   - ends with a "来源" list (n + title + URL);
   - on source conflict, say "目前公开信息存在差异……", never silently pick one;
   - natural, spoken tone; not a URL dump, not technical logs.

### 3.4 Freshness

- Current date is injected into the decision + synthesis prompts.
- Answer must reflect recency: for time-sensitive questions, do not present old-model knowledge as current reality.
- If the search returns nothing usable, the answer says so honestly and offers existing knowledge instead.

### 3.5 Source quality

Order of preference (bias, not a rule base): official/primary → authoritative media/professional org → secondary → UGC. No big rules database. Conflict handling is prompt-level (see 3.3).

### 3.6 Citation UX

- Citations live next to key facts, are openable (real URLs), and the answer ends with an expandable "来源" list.
- Not a raw URL dump, not a technical log, no fake/made-up URLs. Model must only cite sources actually provided.

### 3.7 `deep_research` minimal loop (frozen)

At least:
1. research goal (from decision),
2. initial plan (1-3 queries),
3. search round 1 (connector),
4. read/scan results,
5. identify gaps / unresolved questions,
6. additional search round(s) (≥2 distinct search iterations total),
7. cross-check/conflict handling,
8. synthesis with source set + evidence coverage + unresolved questions.

Internal research structure is **not shown** by default; only the natural answer + sources are shown.

### 3.8 Digital Me differentiation (owner context)

- `external_search_relevant = true`, `owner_context_relevant = true`, `irrelevant_owner_context = false`.
- Owner context (subject facts, e.g. known project: AI competition entry, digital subject + AI Native positioning) is injected into synthesis so the answer can connect to the owner **when relevant**.
- Must not force owner context into irrelevant topics (e.g. "NVIDIA 今天有什么新闻" must not drag in the competition).
- Known owner context used in tests: user is preparing 2digime for an AI innovation competition; highlight digital subject + AI Native.

### 3.9 External results never become owner facts

- Search results carry `source class = external`.
- They are **not** written to owner facts / preferences / identity / boundaries by default. Existing growth rules only accept Owner confirmation/expression.
- The pipeline must not append search-derived facts into `userVisibleFacts` or growth events.

### 3.10 Failure semantics (frozen, honest)

- Network/provider failure: natural-language honest reply, e.g. "现在没能获取到最新网络信息，我可以先根据已有知识回答。" — never fake real-time for time-sensitive questions.
- Empty results: as above.
- `deep_research` partial failure: answer from verified sources + state gaps explicitly.
- Model decision call failure: fall back to `no_search` (still answer from knowledge + owner context), do not fail the conversation.

## 4. First-round acceptance scenarios (8, real)

1. **Water freezing** → `no_search`, no external call, direct correct answer.
2. **OpenAI news today** → `web_search`, real results, citations present, freshness-aware.
3. **Official price** → `web_search`, prefers official source, citation points to official URL.
4. **Two-source conflict** → answer expresses discrepancy, no silent pick.
5. **2026 China AI Agent startup/funding trends** → `deep_research`, ≥2 search iterations, sources + gaps.
6. **Competition question after goal is set** → `web_search` + owner context reuse (relevant), e.g. "最近有什么适合我项目参加的AI创新比赛" → uses owner project/goal + web.
7. **External results not into owner facts** → after a web_search turn, owner facts unchanged, `source class = external`.
8. **Network unavailable** → honest failure message, no fake answer.

## 5. Benchmark fixture (frozen protocol + samples only)

- Protocol: same real questions run against 2digime vs ChatGPT / Claude / Gemini / Perplexity.
- Dimensions (11): correctness, freshness, source quality, citation correctness, coverage, contradiction handling, research depth, latency, cost, owner-context usefulness, irrelevant-personalization penalty.
- Only the protocol and the sample question set are frozen in this task. We **do not** claim `market_p95_met` or `mvp_ready` now.

## 6. Regression that must keep passing

Growth Closed Loop 03 · Growth Context Consistency · Product Semantics Recovery · normal conversation model capability · Talk/Do/Adopt · real Agent · second Agent · MCP readonly · smoke · model-gate · Electron preflight.

## 7. Success criteria (only mark true when the evidence is real)

`conversation_search_engineered` · `real_web_search_validated` · `automatic_search_decision_validated` · `current_fact_citations_validated` · `source_conflict_handling_validated` · `deep_research_min_loop_validated` · `owner_context_relevant_reuse_validated` · `external_search_not_owner_fact`.
Still `false` until separately proven: `market_p95_met`, `mvp_ready`.
