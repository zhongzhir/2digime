# 2digime（兔机米）

[English](README.md) · [中文](README.zh-CN.md)

**Your digital self.**

Tell 兔机米 what you want to do. It understands your goal, and when needed finds and organizes the right AI capabilities to complete the work. Through ongoing conversation, real doing, choices, and connecting with the world, it keeps getting to know you, accepts your corrections, and grows into a digital self that is closer to you.

> **Public Alpha** · early-stage · open source · **Windows x64 first**  
> Not production-ready. Not a claim of market completeness.

---

## Belonging to you · Getting things done · Connecting with the world

These are one subject, not three products.

### Belonging to you

There is one Digital Self: a living record of how 2digime currently understands you. It learns from talk and from real work. Each understanding has a source. You can open **数字之我**, see it, correct it, or delete it. What you state explicitly has the highest authority.

The long-term aim is to keep approaching the real you — not to freeze a static profile, and not to claim a perfect copy or that it already knows everything.

### Getting things done

You do not need to assemble an AI toolchain first.

1. Tell 兔机米 the goal, in the same conversation.  
2. It judges what capability is needed.  
3. It calls — or obtains — a mature AI, agent, or tool.  
4. It executes in the scope you authorized.  
5. It checks the result.  
6. The outcome returns to the same conversation.

Talk is the only everyday entry. Doing is not a second app or a “turn this into a task” workflow.

Verified example: on programming work, 2digime can obtain professional coding ability without a pre-installed coding agent, then make real edits and run checks.

### Connecting with the world

Every 2digime can be an intelligent network node that belongs to a real person.

What has been verified: a Relay can offer the **same** candidate pool and transport; it does **not** own your profile and does **not** make the final personalized ranking. Each Digital Self judges locally. Different selves can make different, explainable choices. You can change your Digital Self and thereby change how selection works.

**The final say over “what I should see” moves from a central platform algorithm back to your own digital subject.**

Relays, search, storage, and models still matter — as **network service providers**, not as the default owners of your selection and distribution.

This Alpha does **not** ship a full content feed, follow/subscribe graph, open social network, marketplace, or payments. Those are not current UI. Computer Use is not part of this Alpha.

---

## Public Alpha status

| | |
|---|---|
| Current Public Alpha target | **Windows x64** |
| macOS | Not yet verified for Public Alpha. Do not treat this project as macOS-ready. |
| Linux | Not claimed |
| Stage | Early trial |

When a Public Alpha package is published, download the latest **Windows x64** build from [GitHub Releases](https://github.com/zhongzhir/2digime/releases). This repository page does not currently point at a specific installer file.

Everyday use: unzip, double-click `兔机米.exe`, connect an AI in **设置**, then talk in **与兔机米**. No Node, Git, or developer tools required for that path.

The Windows package is **not code-signed**. Windows may show an unknown-publisher warning. Only continue if you obtained the file from this project’s official Releases and you trust that source.

Full trial notes (for ordinary users, in Chinese): [docs/windows-preview/README.md](docs/windows-preview/README.md).

---

## Why 2digime

Most AI products are a generic model plus a platform that ranks what you see. 2digime is different in three durable ways:

- **Digital Self** — identity, memory, and corrections stay yours, on your machine.  
- **AI Capability** — the product integrates mature models and agents instead of competing with them by reinventing coding, search, or computer use.  
- **Digital Subject Network** — candidates can come from the network; **personal selection stays with your Digital Self**.

---

## Architecture principles

- **AI First** — language understanding and tool choice belong to the model, not a keyword router.  
- **Build-vs-Integrate** — prefer mature agents, tools, and services; do not rebuild them here.  
- **Local-first / user-owned** — keys and Digital Self stay on the user’s computer.  
- **Platform-neutral** — capability providers are replaceable.  
- **Relay is a service, not a recommendation authority.**  
- **Open source** — [Apache-2.0](LICENSE).

---

## Feedback

The most useful Public Alpha reports are real failures, misunderstandings, and moments that feel unnatural. Please use [GitHub Issues](https://github.com/zhongzhir/2digime/issues).

---

## Repository (developers)

```
src/           domain
electron/      desktop shell
relay-service/ optional relay (service, not a ranking authority)
trial/         short note bundled into the Windows ZIP
docs/refoundation/  product constitution and current plan
```

Build from source (developers only — not required to try a release ZIP):

```bash
npm install
npm run build
npm run build:packaged   # Windows x64 ZIP
```

---

*2digime / 兔机米 — belonging to you · getting things done · connecting with the world. Public Alpha; not production-ready.*
