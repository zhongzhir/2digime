# Architecture

Digital Me is an **Owner-controlled, AI-native control layer**. The most important idea is the separation between the **Owner** (you), the **orchestrator** (Digital Me, playing an internal "CTO" role over your work), and the **capabilities** it calls (models, coding agents, and read-only tools).

```
        You (Owner)
        ─────────────────────────────────────────────
                 │  directs · confirms · authorizes · adopts
                 ▼
        ┌──────────────────────────────────────────────┐
        │  Digital Me  (the control layer / "CTO")     │
        │  · owns your subject (facts + growth)         │
        │  · plans, selects, authorizes, verifies       │
        │  · feeds verified results back into growth    │
        └───────────────┬──────────────────────────────┘
                        │  calls & verifies (scoped)
        ┌───────────────┴───────────────┬──────────────┐
        ▼                               ▼              ▼
   Agent / Model               read-only tools        (experimental)
   (coding agents,      (MCP-style read-only   Collaboration with
   your connected model)  tool adapter)         another Digital Me
```

## The three layers

### 1. You (Owner)
You are the source of direction and the authority over "who you are". You:
- create and grow your Digital Me;
- authorize which folders/projects it may read and modify;
- confirm facts, approve plans, and adopt or reject results.

Nothing external — no model, no agent, no tool — may write to your identity without your confirmation.

### 2. Digital Me (the control layer / internal "CTO")
Digital Me is the orchestration brain. It does not pretend to be an omnipotent model; instead it **selects, authorizes, calls, and verifies** real capabilities the way a technical lead would:

- turns your intent into a plan and a task;
- chooses the right capability (a coding agent, your connected model, or a read-only tool);
- enforces scope — it validates every path before anything is written;
- runs an **independent verification** of the result (e.g. runs tests);
- feeds a verified, adopted result back into your subject so it grows.

### 3. Capabilities (Agent / Model / MCP)
Digital Me does not re-implement coding agents or research tools. It calls real ones through a single adapter contract:

- **Real external coding agents** (CLI or HTTP) — Digital Me hands them an authorized task package inside a scoped folder and verifies their output independently.
- **Your connected model** — a fallback for small file edits when no dedicated coding tool is installed (explicitly labeled experimental).
- **Read-only tools** (MCP-style adapter) — read-only data/notes access; write tools are rejected.
- **Collaboration (experimental)** — encrypted, authorized messaging and opportunity discovery with another Digital Me.

## Represents you × does things × collaborates

The product is built around three verbs that together make it a *subject*, not a chatbot:

| Verb | What it means | Where it lives |
|---|---|---|
| **代表我** (represents you) | A single authoritative record of confirmed facts, preferences, and boundaries; replies honor it and never fabricate missing facts | `Subject Core` |
| **做事** (does things) | Turns intent into a scoped, planned, verified real action (including code edits), then lets you adopt it | `Work Runtime` + `Capability` |
| **协作** (collaborates) | Subject-to-subject, authorization-based, encrypted collaboration with another Digital Me — experimental | `Collaboration` + `Subject Comm` |

## Module map

```
src/
  shared/           primitives: ids, result, events, clock
  subject-core/     who you are: subject package, growth events, derived views
  work-runtime/     task → snapshot → job → artifact → feedback
  capability/       adapters for agents / models / tools; selection & routing
  collaboration/    collaboration schema + local simulation
  subject-comm/     experimental encrypted remote communication + relay client
  relay-service/    self-hostable encrypted mailbox (not a fact source)
  execution/        external executor contract, scope, verification, bundling
  infrastructure/   JSON store, secret store, model HTTP, file parsing
  runtime/          command bus, persistence ports, runtime assembly
  engineering/      workspace & verification helpers
electron/           thin app shell (main / preload / renderer)
```

## Key design principles

1. **One execution path.** A task flows through one official pipeline; no ad-hoc multi-entry paths.
2. **Capabilities are pluggable.** Adding a capability = adding an adapter, not rewriting the runtime.
3. **UI is a projection.** The renderer shows derived views; it never holds separate facts.
4. **Fail-closed.** Missing capability = honest stop, never fake success. Paths validated before write. Keys stay in a local encrypted store.
5. **Verified, then adopted.** Results are independently verified and only adopted with your confirmation.
6. **Growth is event-based.** New knowledge enters only as growth events derived from your confirmed actions.

## Capability closure (frozen product principles) — CAPABILITY-FALLBACK-CLOSURE-01

These principles govern **how 2digime picks and downgrades capabilities** so that a user who only installs 2digime and connects one ordinary general-purpose model can still close real task loops. Stronger professional agents/search/research/coding are **optional enhancements**, never the default precondition for basic tasks. Capability selection is based on capability contracts, **never on provider name / brand routing** (no `if DeepSeek` / `if Gemini` product logic).

1. **Professional capability may be absent; task closure must not easily be absent.** Absence of a specialist agent is a routing input, not a stop condition.
2. **Best executable plan among what is available.** 2digime answers "how can the goal be best completed *with current capabilities*?", not "is this specific product installed?".
3. **Stronger external capabilities are optional.** Connecting Gemini/Claude/Perplexity/… is an enhancement path, not the default precondition for ordinary users.
4. **Acceptable fallback ⇒ default to executing.** If a fallback exists, 2digime proceeds by default instead of asking the user to configure a new service.
5. **Fallback that visibly affects quality/speed/coverage ⇒ tell the user naturally and briefly.**
6. **No reliable capability ⇒ state the capability boundary honestly.** Never use stale training knowledge or model hallucination to fake a real-time / professional result.
7. **User keeps the choice.** Continue with current capabilities / use-or-connect a stronger capability / defer. "Connect a stronger capability" must never be the *only* path.
8. **When a mature professional Agent exists, prefer integrate / invoke / handoff over re-implementing its core.**

Forbidden flow: *need Deep Research → no Gemini → ask user to configure Gemini → task suspended.* Correct flow: *need Deep Research → no specialist research agent → find baseline capabilities (search / read / connected model / verification) → generate a fallback execution plan → state the honest quality gap → execute.*

### Capability levels (runtime semantics, no numeric scoring)

| Level | Meaning | User experience |
|---|---|---|
| `OPTIMAL` | The most suitable professional capability is available. | Silent by default; do not tell the user which adapter was picked internally. |
| `BASELINE` | No best specialist, but the connected general model + basic tools are enough. | Usually executes directly; only mention the gap briefly when it actually affects the result. |
| `LIMITED` | Part of the goal is achievable, but there are important quality / coverage / freshness limits. | Non-blocking. Something like: "可以继续完成，但当前只能使用基础研究能力，覆盖度可能低于专业深度研究。" Default offers **continue**, optional **use stronger capability**. |
| `UNAVAILABLE` | No reliable capability for the core goal. | Honest, never fake completion. E.g. "当前无法可靠确认最新信息。我可以先基于已有资料分析，或者联网能力恢复后继续查询。" |

User-facing messages never expose: provider id, HTTP status, quota, adapter name, MCP, or the internal capability graph — unless the user explicitly asks for a technical diagnosis.

### Selection flow (task enters the "doing" stage)

```
User Goal
  → Task Capability Needs
  → Available Capabilities
  → Best Execution Plan
  → Fallback Plan (if needed)
  → Execute
  → 2digime Review / Acceptance
  → Result
```

The core abstractions are **runtime-only** (`src/capability/capability-closure.ts`): `TaskCapabilityNeed`, `AvailableCapability`, `ExecutionPlan`, `FallbackOption`, plus the `OPTIMAL / BASELINE / LIMITED / UNAVAILABLE` levels. No permanent schema / store / state machine is added. Capability discovery reuses the existing `CapabilityRegistry`, `CapabilityRegistration` contract, `SearchConnector` + `SearchNeed`/`SearchEvidence` contract, coding routing (`routeCodingAgent`), the model gateway, document capability, and MCP/Agent adapters. The same resolution runs on each invocation, so when a stronger capability (e.g. a professional research agent) becomes available later, the resolver naturally upgrades — no task re-creation, no manual provider switch, task semantics unchanged.

**Runtime wiring (CAPABILITY-CLOSURE-RUNTIME-02).** The real Do main chain (`WorkRuntime.submitTask` / `retryTask` in `src/work-runtime/job-runner.ts`) derives `TaskCapabilityNeed` from the existing `WorkIntent` and exposes a minimal `capabilityClosure` view (`level` / `notice` / `choices`) on its output — OPTIMAL/BASELINE stay silent; LIMITED shows the natural-language limit with a default continue; UNAVAILABLE never fabricates a result and returns a natural choice set. No second routing pipeline: the view classifies what the single existing selection (`selectForNeed` / `routeCodingAgent`) actually chose. The conversation search path (`electron/main.cjs`) runs through `runClosureSearch`, so deep research / current-news responses carry the same closure level and honest limited handling.

Baseline fallbacks today (already wired): no-key basic web search (`bing-html-search`), URL read/fetch evidence retrieval, the connected general model, and the existing research orchestration (`conversation-search.ts`). The research orchestration is a **baseline fallback**, not the strategic goal of "beating Gemini Deep Research". Future **2digime Managed Capabilities** (managed search / URL extraction / browser / basic research tools) plug into the same `SearchConnector` / capability contract so ordinary users need no third-party accounts; BYOK, MCP, local tools and third-party agents remain supported.

## Subject-grounded work (DIGITALME-SUBJECT-GROUNDED-WORK-01)

The person's Digital Me participates in the real Do chain through a **narrow, runtime-only Subject Context Package** (`src/subject-core/subject-context-package.ts`) built from the existing derived views (subject events / confirmed facts / growth experience / supersede semantics — **no new Store, no second subject truth**). The package is selected **per task** and layered:

| Tier | Meaning | Examples |
|---|---|---|
| `mandatory` (A) | Must follow; always injected, highest priority | explicit boundaries / authorization limits / explicit user constraints |
| `applied` (B) | Apply to the result | relevant confirmed goals / product positioning / principles / preferences / project context |
| `reference` (C) | Reference experience | confirmed experience from similar adopted/corrected tasks |
| excluded (D) | Never enter execution | irrelevant prefs, candidates, superseded/inactive, external claims, knowledge gaps |

Selection is relevance-first, not a keyword-rule library: deterministic keyword/domain affinity scoring is reused, and an optional **semantic-relevance** pass (2digime's own model over a small pre-filtered candidate pool) lifts recall for genuinely-relevant context (e.g. a confirmed "conclusion-first, concise" writing preference applying to an unrelated-sounding intro task). Irrelevant personal info (e.g. favourite colour) never enters a project-intro task. Boundaries stay mandatory and outrank preferences/experience; external search facts never become owner facts; external agents receive only minimum necessary context (coding agents get brief decision lines, remote agents get an empty subject slice unless explicitly authorized). Experience really re-enters the next similar task via the existing growth loop (`experience_confirmed` + `decision:accept`), and `supersedes` / inactive semantics keep corrected or replaced context out. User-facing results naturally reflect the person/project; internal `provenance` (why each entry was or wasn't injected) stays hidden from ordinary users.

## AI-native delegated execution (DIGITALME-COLLAB-DELEGATED-01)

The first real AI-native collaboration loop composes the subject layer, the capability-control layer and remote-subject/A2A: `work.delegateTask` (`src/runtime/digitalme-runtime.ts`) decides via `decideDelegation` (`src/collaboration/delegated-execution.ts`) whether a goal is best executed locally or delegated to a professional external capability — a remote Research Agent (`remote-subject` / A2A / controlled-remote peer) or a professional Coding Agent (`external-executor-cli/http`). It delegates with **minimum necessary context** (goal + authorized materials; subject context is never sent to a remote peer; coding agents get only `priorDecisions` = "title: detail" briefs), runs the existing Do chain, verifies the remote result (`verifyCandidateArtifact` + action receipt with protocol provenance), and the event-driven CTO review performs the **local independent acceptance**. On external failure (`capability`/`model` stage) it automatically falls back to the next candidate (local baseline), never surfacing protocol/HTTP/agent internals to the user. Ownership semantics: the owner's own experience is attributed to the owner's Digital Me via existing growth; external execution facts carry external provenance and never auto-become owner facts; another Digital Me's subject information never enters the owner's subject truth. The owner does not manage collaborators — delegation, acceptance and fallback are 2digime's responsibility. No new Store, no second collaboration truth, no workflow state machine.

## Honest status

This is an **experimental preview**, not an MVP and not production-ready. The architecture is the durable asset: an AI-native control layer that keeps the human in charge of what "you" are and what the system is allowed to do.
