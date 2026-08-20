# 2digime — Digital Me

**Digital Me** is an **Owner-controlled personal digital subject** that represents *you*, does things *for you*, and collaborates *with you* — built on an **AI-native architecture** that orchestrates real external coding agents and read-only tools under your explicit control.

> **Current stage: experimental preview.** This is not an MVP, not production-ready, and not a market 95th-percentile product. It is a working research-grade baseline we are opening for early evaluation and review.

---

## What is 2digime?

2digime is the public project name for **Digital Me** — a desktop application where you build a personal "digital you": a growing record of what you have confirmed about yourself, a place to talk and do real work, and an experimental way to collaborate with another Digital Me on another machine.

It is not another chatbot, and it is not a thin wrapper over one AI model. Digital Me is an **Owner-controlled agent layer** that:

- represents **you** (the Owner), not a generic assistant;
- **does** real tasks (including editing code in an authorized project folder) using real external coding agents or your connected model;
- **learns and grows** from what you confirm, without silently rewriting who you are;
- collaborates, experimentally, with another Digital Me under authorization.

## Why is this not a normal AI Agent?

A normal AI agent is a generic, stateless model that answers whoever asks. Digital Me is different in four ways:

1. **Owner-controlled identity.** There is exactly one authoritative record of *your* subject — facts you confirmed, preferences, boundaries, and growth events. Nothing external writes to "who you are" without your confirmation.
2. **You are the actor; the model is a capability.** Digital Me chooses, authorizes, calls, verifies, and feeds results back. It does not re-implement coding agents or research tools; it orchestrates real ones inside a scope you authorize.
3. **Honest failure.** When a capability is not connected (model, code executor, or collaboration peer), Digital Me stops and tells you — it never pretends it succeeded.
4. **A growth loop.** Completed work, verified facts, and adopted artifacts feed back into your subject so the system gets more useful over time.

## What can it do today?

- **对话 (Talk):** natural conversation; can be turned into a task. Confirmed personal facts are honored; when facts are missing it does not fabricate.
- **做事 (Do):** describe a task, add a project folder, confirm the scope, and Digital Me edits code / produces artifacts using a real external coding agent or your connected model, then verifies the result independently and lets you adopt it.
- **数字之我 (Digital You):** review and build your confirmed personal subject.
- **协作 (Collaborate, experimental):** connect to another Digital Me on another computer, exchange encrypted messages, discover opportunities, and propose collaboration. **This is not yet full remote delivery** — no large-file transfer, no full remote task fulfillment, no multi-party, no payments.

## How to try it (Windows Preview)

Download the **Windows x64 Preview ZIP** from the [Releases](https://github.com/zhongzhir/2digime/releases) page:

1. Unzip anywhere.
2. Double-click `DigitalMeV2.exe`. No installation needed.
3. First open: go to **设置 (Settings)** and connect a model (bring your own API key). Until connected, talk and do will not pretend to work.
4. Uninstall = delete the folder. Your key stays on your machine.

> The Windows ZIP is **unsigned** and **experimental** (not an MVP). Your operating system may warn about an unsigned app; choose "run anyway" only if you trust the source.

## Why is the architecture "AI-native"?

The design is not a chat app bolted onto a model. It is a **control layer** with a single authoritative domain model:

```
Subject Core   — who you are (facts + growth events, authoritative)
Work Runtime   — task → context snapshot → capability → job → artifact → feedback
Capability     — models / coding agents / read-only tools via one adapter contract
Collaboration  — subject-to-subject authorization (experimental)
App Shell      — thin Electron shell; domain is Electron-free and testable
```

Principles that make it AI-native:

- **One execution path.** A task flows through one official pipeline; no ad-hoc multi-entry legacy paths.
- **Capabilities are pluggable.** Adding a capability = adding an adapter, not rewriting the runtime.
- **UI is a projection.** The renderer shows derived views; it never holds separate facts.
- **Fail-closed security.** Paths are validated before any write; keys stay in a local encrypted store; evidence of sensitive operations is kept out of public output.

See [docs/architecture](docs/architecture/) for the details.

## What real stage is it in?

| Aspect | Status |
|---|---|
| Product status | **Experimental preview / research baseline** |
| MVP / production ready | **No** |
| Market 95th-percentile claim | **No** (an internal candidate gate exists; not claimed met) |
| Full autonomous agent | **No** (Owner confirms and authorizes before actions) |
| Mature collaboration network | **No** (collaboration is experimental) |
| Owner runtime acceptance | Main path (talk / do / adopt / growth) accepted by the Owner on the integrated baseline |
| Pre-existing known test failures | A few unit tests fail on this baseline (documented in the repo) |

This repository is opened early — for competition review, for early trial, and for honest evaluation of where an Owner-controlled digital subject can go.

## Repository layout

```
src/             domain layer (TypeScript, Electron-free)
electron/        app shell (main / preload / renderer)
scripts/         build, preflight, and trial smoke tooling
fixtures/        small fixtures used by unit tests
relay-service/   experimental encrypted mailbox (self-hostable)
reference-agents/  reference A2A counterpart for collaboration testing
trial/           Windows trial note bundled into the ZIP
docs/architecture/  architecture explanation
docs/competition/   competition-ready generic materials
docs/windows-preview/  Windows preview usage
```

## Building from source

```bash
npm install
npm run build        # tsc -> dist/
npm run smoke        # domain smoke
npm run test         # unit tests
npm run preflight:electron
npm run dev          # build + preflight + launch UI
npm run build:packaged   # build the Windows x64 ZIP
```

## License

[Apache-2.0](LICENSE). See the license file for full terms.

---

*Digital Me — represents you, does things for you, collaborates with you. Experimental; built under Owner control.*
