# Legacy 可复用 / 禁止复用清单

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 7
- 版本:v0.1(2026-08-02)
- 状态:`draft_for_cto_review`
- 依据:2026-08-02 Legacy 全量勘察(`digitalme-app/`,以 `codex/mvp-generation-lifecycle-fix-01` 分支为准)
- 复用形态:一律"摘取重写"进 `digitalme-v2/src/infrastructure/`,禁止 import Legacy 路径(见 migration_boundary §2)

---

## 1. 可复用(技术原语,无产品状态机)

| Legacy 路径 | 用途 | 复用方式 | V2 落点 |
|-------------|------|---------|---------|
| `src/json-store-persistence.js` | 原子 JSON 写(tmp→bak→rename)+ 损坏恢复 | 摘取重写 | infrastructure/json-store |
| `src/security/secret-store.js` | 加密密钥存储(`model.provider.<id>.apiKey`) | 摘取重写,格式可沿用 | infrastructure/secrets |
| `src/security/electron-safe-storage-adapter.js` | Electron safeStorage 适配 | 摘取重写 | infrastructure/secrets |
| `src/model-routing.js` | 多 provider 路由、fallback、错误规范化 | 摘取重写,置于 model Adapter 内部 | capability/adapters/model |
| `src/main.js` 中 `callModelRaw` / `callModelStreamRaw`(约 4550 行附近) | OpenAI-compatible HTTP 调用 | **抽出片段**重写(Legacy 中耦在 7300 行巨石内) | infrastructure/model-http |
| `src/builder.js` `extractText` 核心(约前 200 行) | docx/pptx/pdf/txt/md 文本抽取 | 摘取重写 | infrastructure/extract |
| `src/outputs/document.js` | Markdown→DOCX(纯 Node OOXML,约 350 行) | 摘取重写 | infrastructure/export-docx |
| `src/outputs/pptx.js` | PPTX 构建 | 后置(首切片不需要) | infrastructure/export-pptx |
| `src/package-store/digest.js` | 内容 digest、路径安全 | 摘取重写 | infrastructure/digest |
| `src/package-store/lock.js` | 包锁与心跳 | 视需要摘取 | infrastructure/lock |
| `src/act-behalf/deliverable-md-html.js` | Markdown→HTML 展示 | 摘取重写 | artifact-workspace 渲染 |
| `src/decision-audit/hash.js` | 审计哈希 | 视需要摘取 | infrastructure/digest |

## 2. 仅作参考(需求与行为对照,不复制代码)

| Legacy 路径 | 参考价值 |
|-------------|---------|
| `src/renderer/do-workspace.js`、`app.js` do 区段 | 首切片用户路径与文案反例 |
| `src/act-behalf/deliverable-context.js`、`deliverable-planner.js` | 材料规范化需求、digest 教训 |
| `src/act-behalf/authority-map.js` | 旧权威地图,用于核对没有遗漏的事实源 |
| 根目录各 AUDIT / REPORT / FORENSIC 文档 | 失败案例库 |
| `src/package-store/`(manifest/journal/变更提交) | SubjectPackage 目录设计参考 |

## 3. 禁止复用(整包搬迁即违规)

| Legacy 路径 | 禁止原因 |
|-------------|---------|
| `src/main.js`(整文件,约 7300 行) | IPC 总线 + 业务胶水巨石;约 268 条通道,正是 V2 要消灭的形态 |
| `src/renderer/app.js`(约 14000 行) | UI/状态巨石;多套投影驱动按钮可用性 |
| `src/preload.js` 全量 API 面 | 268 通道的扁平镜像 |
| `src/act-behalf/task-store.js` | `status` × `lifecycleStatus` 双字段 + 指针域历史债 |
| `src/act-behalf/deliverable-plan-store.js` / `deliverable-package-store.js` / `deliverable-learn-store.js` | 三 Store 并行状态机,一致性靠 reconcile 补丁 |
| `src/act-behalf/deliverable-generation.js` / `deliverable-auto-learn.js` / `result-generation.js` / `experience-proposal.js` | 深耦质检、grounding、Channel B、学习回写;逻辑靠补丁堆叠 |
| `src/renderer/do-workspace.js` 相位枚举 | 派生态当权威 → 双真相 |
| `src/r2/*`、旧 `sessions`、`chat:*` | 三套会话轨并存;R2 paused |
| `src/renderer-next/**` | R3 paused,非主线 |
| `src/panorama-experience/`、`src/collaboration/`(旧版)、`src/identity/` VC 全链、`src/orchestration/`(L0) | 非当前闭环;易偷跑范围。V2 Collaboration Core 按新 schema 重建 |
| `src/editor-extension/`、`src/mcp-server/` | 旁路;默认产品面禁止协议泄漏 |
| 一切 `*:test*` IPC 通道 | 测试钩子混入生产总线 |

## 4. 数据文件定位

| Legacy 数据 | 定位 |
|-------------|------|
| `<userData>/act-behalf-tasks.json`、`deliverable-*.json`、`authorizations.json` | 只读历史;不迁移(任务状态机语义不可映射) |
| Legacy packageDir(persona/memory 等) | 后置一次性导入器的输入(migration_boundary §3) |
| `<userData>/secrets.v1.json` | 格式可沿用或一次性导入 |
| `Documents/DigitalMe/成稿` 等导出成品 | 用户文件,不动 |
