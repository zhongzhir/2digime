# Digital Me V2 迁移边界

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 4
- 版本:v0.1(2026-08-02)
- 状态:`draft_for_cto_review`
- 配套清单:`digitalme_v2_legacy_reuse_inventory.md`(交付物 7,逐文件可复用/禁止复用)

---

## 1. Legacy 冻结策略

| 项 | 决定 |
|----|------|
| 冻结对象 | `digitalme-app/` 全部代码、当前分支 `codex/mvp-generation-lifecycle-fix-01` 及其历史分支 |
| 冻结含义 | 不再补丁式开发;不修改、不重构、不删除 Legacy 文件;不 push |
| 保留价值 | ① 产品需求来源 ② 数据兼容参考 ③ 失败案例库(各 AUDIT/REPORT 文档)④ 可选代码素材(仅限清单中"可复用"项) |
| 新实现位置 | 独立目录 `digitalme-v2/` + 文档 `docs/v2/`;与 Legacy 零混写 |

## 2. 复制纪律(硬边界)

**禁止直接复制进 V2:**

1. 旧任务状态机——`task-store.js` 的 `status` × `lifecycleStatus` 双字段、`deliverable-plan-store` / `deliverable-package-store` / `deliverable-learn-store` 三 Store 并行机、attempt/version/reviewer 子状态机。
2. 旧生成链——`deliverable-generation.js`、`deliverable-auto-learn.js`、`confirm-and-generate.js`、Channel A/B 双通道、grounded/reviewer 同步质检链。
3. 旧 IPC 集合——`main.js` 约 268 条通道及 `preload.js` 的扁平镜像 API;包括一切 `*:test*` 生产测试钩子。
4. 旧 renderer 结构——`app.js`(约 14000 行)与 `do-workspace.js` 的派生相位当权威的模式。

**允许的复用形态:**仅"无产品状态机的技术原语"(I/O、加密、解析、导出、HTTP),且以**摘取重写**方式进入 V2(复制片段 → 适配 V2 接口 → 落入 `digitalme-v2/src/infrastructure/`),不得 import Legacy 路径,不得连带旧 Store schema。

## 3. 数据迁移:后置

1. 首切片及第一阶段**不做旧数据迁移**;V2 从空白 SubjectPackage 与空任务列表启动。
2. V2 schema **不为旧字段预留兼容位**;不得因兼容旧任务污染新对象模型(如不引入 lifecycleStatus、generationAttempts、plannedMaterialsDigest 等旧概念)。
3. 旧数据的角色是**参考样本**:设计导入器时读旧 JSON 作格式参考,不反向约束 V2。
4. 未来迁移(阶段计划 P3+ 视需求)只允许单向导入器形态:`Legacy JSON → GrowthEvent / Artifact 导入事件`,一次性运行,不建立双向同步。可能的映射:

| Legacy 源 | V2 目标 | 备注 |
|-----------|--------|------|
| 主体包 persona/memory | GrowthEvent(`import` 来源)+ 资料文件拷贝 | 经事件进入,不直接覆盖视图 |
| `deliverable-packages.json` 中成稿 | Artifact(单版本,author: capability)| 仅成品,不迁 attempt 历史 |
| `act-behalf-tasks.json` | 不迁移 | 旧任务状态机语义不可映射,历史只读查阅 |
| `secrets.v1.json` | SecretStore 同格式复用或一次性导入 | 加密原语本身在可复用清单 |

## 4. 运行期隔离

1. V2 使用独立的应用数据目录(如 `<userData>/v2/`),不读写 Legacy 的 `act-behalf-*.json` 等 Store 文件。
2. V2 的 SubjectPackage 目录格式为新 schema;不挂载 Legacy packageDir(参考其 digest/lock 设计,但清单化重写)。
3. Legacy 应用可继续离线查阅历史,与 V2 并存互不感知。

## 5. 需求与失败案例的转化通道

Legacy 的价值经文档而非代码进入 V2:

| Legacy 资产 | 进入 V2 的方式 |
|------------|---------------|
| 各 AUDIT / FORENSIC / ROOT_CAUSE 报告 | 已提炼为 V2 架构反例(见 `digitalme_v2_reverse_audit.md` §3 与 architecture §4 事实源纪律) |
| do-workflow 用户路径 | 首切片交付体验需求(runtime contracts §1、§4)|
| 学习链(auto-learn / claims)教训 | FeedbackEvent 后置旁路设计,不阻塞交付 |
| portable 构建失败史 | "packaged 与开发同一运行链" 架构承诺 + 20 连成功门 |

## 6. 边界违规判定(实现期自查)

出现以下任一情况即判违规,需回退:

- `digitalme-v2/` 内出现 `require/import` 指向 `digitalme-app/`。
- V2 对象出现 Legacy 状态字段名(lifecycleStatus、generationStatus、materialsStale、adopted、reviewStatus 等)。
- V2 命令面出现与 Legacy 通道一一对应的细粒度命令膨胀(超出 contracts §1 上限)。
- 为"演示旧数据"在 V2 内实现旧 Store 读取逻辑(应走一次性导入器)。
