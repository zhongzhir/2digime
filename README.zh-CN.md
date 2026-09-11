# 2digime（兔机米）

[English](README.md) · [中文](README.zh-CN.md)

**兔机米（2digime）是属于你的数字之我，也是正在成长的超级助手。**

你只需要告诉兔机米想做什么。  
它会利用大模型本身的能力，以及可以获得的 Agent、Skill 和工具帮助你完成任务。  
随着使用，它会逐步理解你、代表你，并最终连接其他数字主体和外部能力。

> **Public Alpha** · 早期试用 · 开源 · **Windows x64**  
> 不是生产就绪，也不宣称已经做完所有能力。

### 下载并开始（Windows x64）

**优先下载 Windows Installer；ZIP 便携版为补充。**

1. 从 [GitHub Releases](https://github.com/zhongzhir/2digime/releases/tag/v0.1.0-public-alpha.1) 下载  
   - **优先：** [`tujimi-0.1.0-public-alpha-win-x64-setup.exe`](https://github.com/zhongzhir/2digime/releases/download/v0.1.0-public-alpha.1/tujimi-0.1.0-public-alpha-win-x64-setup.exe)（Installer；已验证包身份：`兔机米-0.1.0-public-alpha-win-x64-setup.exe`）  
   - **补充：** [`tujimi-0.1.0-public-alpha-win-x64.zip`](https://github.com/zhongzhir/2digime/releases/download/v0.1.0-public-alpha.1/tujimi-0.1.0-public-alpha-win-x64.zip)（Portable；已验证包身份：`兔机米-0.1.0-public-alpha-win-x64.zip`）  
2. Installer：双击安装后，从桌面或开始菜单打开「兔机米」。ZIP：解压后运行 `兔机米.exe`。  
3. 进入「与兔机米」可先浏览；未连接 AI 时发送消息会出现提示，并可点「连接 AI」进入设置。  
4. 在「设置」中连接支持的 AI 后，直接告诉它你想做什么。  
5. 需要处理本地资料时，使用「添加文件 / 添加文件夹」。

普通试用说明：[PUBLIC-ALPHA.md](PUBLIC-ALPHA.md)

**Installer SHA256：** `7cb6c4c6d340c624cf35b4b06dc3fb34bd04c654cd2469b81f5793ebe905a492`  
**Portable ZIP SHA256：** `05cd3c0798e3ec413cd722faa66a3050bfb3e928c369e336bacfbf9ec26d15b7`

当前包 **尚未完成代码签名**，Windows 可能显示未知发布者提示。请只在文件来自本项目官方 Releases、且你信任该来源时继续。

---

## 当前 Public Alpha 已验证

- 自然对话
- Digital Self 基础形成和持久化
- 多会话
- 文件 / 文件夹作为工作材料
- 大模型直接完成一般任务
- 根据需要调用专业能力
- Windows x64 打包试用

## 产品方向

- **Digital Self（数字之我）**
- **Super Assistant（超级助手）**
- **Digital Subject Network（数字主体网络）**

当前版本重点验证数字之我 + 超级助手的可用基础。  
**尚未宣称：** L5 主动数字管家、完整自动能力发现、完整视频 / 漫剧 / 数字人生成、完整 Computer Use、完整数字主体网络大众应用。

---

## 属于我 · 能做事 · 连接世界

三者是同一个主体的伸展，不是三个产品。

### 属于我

全系统只有一份数字之我。它会在对话和真实做事中学习；每条认识都有来源。你可以打开「数字之我」查看、纠正或删除。你亲口确认的内容具有最高权威。

### 能做事

你不需要先自己搭建一套 AI 工具链。日常入口只有「与兔机米」。做事发生在同一段对话里，不是另一扇门，也不是「先把这句话转成任务」。

### 连接世界

长期方向是：每个 2digime 都可以成为属于真人的智能网络节点；选择权留在你自己的数字之我。当前 Alpha **没有**开放完整内容 Feed、关注 / 订阅、大规模开放网络、交易或支付。

---

## 为什么是 2digime

- **数字之我** — 身份、记忆和纠正属于你，留在你的电脑上。  
- **AI 能力 / 超级助手** — 接入成熟模型和 Agent，而不是自研去和它们比。  
- **数字主体网络** — 候选可以由网络提供；**个性化选择留在你自己的数字之我。**

---

## 架构原则（极短）

- **AI First**：理解和选用能力交给模型，而不是关键词路由。  
- **能接不造**：优先成熟 Agent / Tool / 服务。  
- **本地优先、用户所有**：密钥和数字之我在本机。  
- **开源**：[Apache-2.0](LICENSE)。

---

## 反馈

最有价值的反馈是：什么事情做成了、什么没做成、哪一步让人困惑、等待多久、是否真的减少了人工操作。请使用 [GitHub Issues](https://github.com/zhongzhir/2digime/issues)。

---

## 仓库（开发者）

```
src/           领域层
electron/      桌面壳
relay-service/ 可选中继（服务，不是推荐权威）
trial/         打进 Windows ZIP 的短说明
docs/refoundation/  产品宪法与当前计划
```

从源码构建（仅开发者；试用发布包不需要）：

```bash
npm install
npm run build
npm run build:packaged   # Windows x64 ZIP
```

---

*2digime / 兔机米 — 属于我 · 能做事 · 连接世界。Public Alpha，不是生产就绪。*
