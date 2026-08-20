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

## Honest status

This is an **experimental preview**, not an MVP and not production-ready. The architecture is the durable asset: an AI-native control layer that keeps the human in charge of what "you" are and what the system is allowed to do.
