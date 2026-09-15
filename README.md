# 2digime（兔机米）

[English](README.md) · [中文](README.zh-CN.md)

**兔机米（2digime）是属于你的数字之我，也是正在成长的超级助手。**

你只需要告诉兔机米想做什么。  
它会利用大模型本身的能力，以及可以获得的 Agent、Skill 和工具帮助你完成任务。  
随着使用，它会逐步理解你、代表你，并最终连接其他数字主体和外部能力。

> **Public Alpha** · early-stage · open source · **Windows x64**  
> Not production-ready. Not a claim of market completeness.

### Download and start (Windows x64)

**Prefer the Windows Installer; ZIP portable is secondary.**

1. From [GitHub Releases](https://github.com/zhongzhir/2digime/releases/tag/v0.1.0-public-alpha.1) download:  
   - **Preferred:** [`tujimi-0.1.0-public-alpha-win-x64-setup.exe`](https://github.com/zhongzhir/2digime/releases/download/v0.1.0-public-alpha.1/tujimi-0.1.0-public-alpha-win-x64-setup.exe) (Installer; validated identity: `兔机米-0.1.0-public-alpha-win-x64-setup.exe`)  
   - **Secondary:** [`tujimi-0.1.0-public-alpha-win-x64.zip`](https://github.com/zhongzhir/2digime/releases/download/v0.1.0-public-alpha.1/tujimi-0.1.0-public-alpha-win-x64.zip) (Portable; validated identity: `兔机米-0.1.0-public-alpha-win-x64.zip`)  
2. Installer: double-click to install, then open **兔机米** from Desktop or Start Menu. ZIP: unzip and run `兔机米.exe`.  
3. You can browse **与兔机米** first; if AI is not connected, sending a message shows a notice with **连接 AI** to open Settings.  
4. Connect a supported AI in **设置**, then tell it what you want done.  
5. For local files, use **添加文件 / 添加文件夹**.

Trial notes for ordinary users: [PUBLIC-ALPHA.md](PUBLIC-ALPHA.md)

**Installer SHA256:** `7cb6c4c6d340c624cf35b4b06dc3fb34bd04c654cd2469b81f5793ebe905a492`  
**Portable ZIP SHA256:** `05cd3c0798e3ec413cd722faa66a3050bfb3e928c369e336bacfbf9ec26d15b7`

The Windows package is **not code-signed**. Windows may show an unknown-publisher warning. Continue only if you obtained the file from this project’s official Releases and you trust that source.

---

## What this Public Alpha verifies

- Natural conversation
- Digital Self basics and persistence
- Multiple conversations
- Files / folders as real work material
- The model completing ordinary tasks directly
- Calling specialist capability when needed
- Windows x64 packaged use
- Minimum content discovery beside Talk (recipient-side selection, not a central feed product)

## Product direction

- **Digital Self**
- **Super Assistant**
- **Digital Subject Network**

Current Public Alpha focuses on Digital Self + Super Assistant usability. It does **not** claim: L5 proactive digital butler, complete automatic capability discovery, full video / comic / digital-human generation, complete Computer Use, or a mass Digital Subject Network product.

---

## Belonging to you · Getting things done · Connecting with the world

These are one subject, not three products.

### Belonging to you

There is one Digital Self: a living record of how 2digime currently understands you. It learns from talk and from real work. Each understanding has a source. You can open **数字之我**, see it, correct it, or delete it. What you state explicitly has the highest authority.

### Getting things done

You do not need to assemble an AI toolchain first. Talk is the everyday entry. Doing happens inside the same conversation — not a second app or a “turn this into a task” workflow.

### Connecting with the world

Long-term, every 2digime can be an intelligent network node that belongs to a real person. Selection should stay with your Digital Self, not a central platform. This Alpha includes a **minimum** content loop (neutral directory → your 2digime decides). The public Web is the default eligible universe; discovery uses mature Search and standard feeds/sitemaps/page metadata. It does **not** ship a full content feed product, follow/subscribe graph, marketplace, or payments.

---

## Content Providers

The public Web is 2digime’s default discoverable content range. Personal selection happens on the recipient's own 2digime rather than through a centralized user-profile ranking system.

If you already publish in the open, you usually do not need a 2digime account, tags, or a proprietary API. RSS / Atom with feed autodiscovery, canonical URLs, sitemap, OpenGraph, and schema.org help machines find you more reliably. This Public Alpha does not offer a self-serve publish API or supplier portal.

See: [Providing Content to 2digime Users](CONTENT-SUPPLIERS.md)

---

## Why 2digime

- **Digital Self** — identity, memory, and corrections stay yours, on your machine.  
- **AI Capability / Super Assistant** — integrate mature models and agents; do not reinvent them.  
- **Digital Subject Network** — candidates can come from the network; personal selection stays local.

---

## Architecture principles

- **AI First** — language understanding and tool choice belong to the model, not a keyword router.  
- **Build-vs-Integrate** — prefer mature agents, tools, and services.  
- **Local-first / user-owned** — keys and Digital Self stay on the user’s computer.  
- **Open source** — [Apache-2.0](LICENSE).

---

## Feedback

The most useful Public Alpha reports are real successes, failures, waiting time, confusion, and moments that still need too much manual work. Please use [GitHub Issues](https://github.com/zhongzhir/2digime/issues).

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
