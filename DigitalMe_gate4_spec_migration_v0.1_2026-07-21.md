# Digital Me Gate 4：规格冻结与代码迁移 v0.1

日期：2026-07-21  
状态：`draft` — Owner 审核后进入限量实现  
上位依据：[`DigitalMe_product_baseline_reset_v0.2_2026-07-21.md`](DigitalMe_product_baseline_reset_v0.2_2026-07-21.md)

---

## 一、代码迁移清单

### 1.1 保留不动（后台基础设施）

以下模块作为自动编排、结果解释、审计和治理的基础设施完整保留，不做产品流程改动：

| 模块 | 路径 | 保留原因 |
|---|---|---|
| Package 与来源索引 | `package-store/` | 本人资料存储与来源追踪 |
| 上下文装配引擎 | `act-behalf/subject-context-assembly.js` | claim 生成、排序、加权；改为仅后台调用 |
| 上下文选择逻辑 | `act-behalf/select-self-context.js` | 自动选择策略与降级路径 |
| 任务意图解析 | `act-behalf/task-intent.js` | 目标解析与规范化 |
| 任务持久化 | `act-behalf/task-store.js`, `act-behalf/task-save-boundary.js` | 草稿/存档/恢复 |
| 外部研究执行 | `act-behalf/research-run.js` | 只读外部检索 |
| 成果生成 | `act-behalf/result-generation.js` | 初稿/结果生成 |
| 体验提案（学习） | `act-behalf/experience-proposal.js` | 长期学习建议与快慢循环 |
| 解析输出 | `act-behalf/parse-output.js` | 结果格式化 |
| 人生身份资料 | `life/`, `life.js` | life 资料管理与 Package 写入 |
| 构建能力 | `builder/`, `builder.js` | 导入资料、聊天引导构建 |
| 主体编排 L0 | `orchestration/l0.js` | 任务编排与能力路由 |
| 委托运行时 | `orchestration/delegate-runtime.js` | Agent/工具调用委托 |
| 审计与决策 | `decision-audit/`, `orchestration/audit-store.js` | 操作记录与决策审计 |
| 策略引擎 | `policy-engine/`, `policies.js` | 风险分级与授权策略 |
| 主体概览 | `subject-overview/` | "我"的数据聚合 |
| 研究能力 | `research/` | 文献检索、代理搜索、grounded RAG |
| 能力管理 | `capabilities/` | Skill/工具注册与发现 |
| 检索 | `retrieval.js` | 本人资料检索 |
| 会话 | `sessions.js` | 会话持久化 |
| 收件箱 | `inbox.js` | 外部输入收纳 |
| 安全 | `security/` | 沙箱、安全管理 |
| 输出 | `outputs/` | PPTX、文档、库输出 |
| 反馈 | `feedback.js` | 用户反馈学习 |
| MCP SDK 集成 | `skills/`, `tool-broker/` | Skill 市场与工具代理 |
| 主进程壳 | `main.js` | Electron 主进程（IPC 路由需改，见 1.3） |
| 预加载桥 | `preload.js` | contextBridge（IPC 通道需改，见 1.3） |
| R2 渲染器 | `renderer-next/` | React + Vite 渲染器（需删减 UI，见 1.3） |
| 经典渲染器 | `renderer/` | 保留为降级/兼容入口 |

### 1.2 删除或彻底替换

| 路径 | 处置 | 原因 |
|---|---|---|
| `panorama-experience/` | **删除整个目录** | 旧 PAN-01R/01S 全景体验壳，包含"研究与表达"入口、候选确认页路由 |
| `renderer/` 中的候选确认 UI 片段 | **从渲染入口中移除引用** | 旧候选选择/删除/确认界面组件 |
| `renderer-next/src/` 中的候选确认组件 | **识别并移除** | 如有 React 版候选选择 UI |
| "研究与表达"入口定义 | **从工作台入口配置中删除** | 写作/研究入口保留，研究与表达作为组合名删除 |
| 测试中的候选确认路径引用 | **测试用例降级或标记 skip** | 不删测试代码，改为验证"确认逻辑已不再进入默认主路径" |

### 1.3 需要修改的文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `main.js` | 重构 IPC 路由 | 移除 `actBehalf:previewContext` / `actBehalf:confirmContext` 作为必经 IPC；降为可选高级控制通道；新增 `actBehalf:autoGenerate`（一键直达初稿） |
| `preload.js` | 暴露新 IPC | 新增 `actBehalfAutoGenerate`、`actBehalfAdjustResult`、`actBehalfViewInfluence`；保留 `actBehalfConfirmContext` 但标记为高级功能 |
| `act-behalf/subject-context-assembly.js` | 新增 `autoSelect()` | 增加自动选择策略：在装配后按目标相关性自动筛出 top-N claim，不暴露给用户选择；风险高时自动标记需确认的敏感条目 |
| `act-behalf/task-intent.js` | 扩展默认值 | `DEFAULT_ROLE` 改为自动推导（任务类型 → 角色）；增加 `autoMode: true` 字段 |
| `renderer-next/src/AppShell.tsx` | 移除候选确认页 | 删除或折叠候选选择组件；生成按钮直接调用 `autoGenerate` IPC |
| `renderer-next/src/r2/` | 保留 types.ts | R2 聊天与会话能力保留；不增加新导入 |
| `package.json` | 新增测试脚本 | 增加 `test:gate4-auto-flow`；保留所有既有 `test:vl1-*`（后台能力测试仍需通过） |
| `digitalme_context.md` | 更新头区 | 指向本 Gate 4 文档；标记旧 sprint plan `superseded` |

### 1.4 测试不可退化的合约

以下既有测试套件必须在所有改动后仍全部通过（后台逻辑不应退化）：

| 测试套件 | 命令 | 覆盖 |
|---|---|---|
| act-behalf contracts | `npm run test:act-behalf` | 上下文装配、选择、生成全链路合约 |
| vl1-block1 上下文装配 | `npm run test:vl1-block1` | subject-context-assembly 正确性 |
| vl1-claim-granularity | `npm run test:vl1-claim-granularity` | 粒度假正 c3f7eb2 回归 |
| vl1-block2 研究调用 | `npm run test:vl1-block2` | research-run 只读外部检索 |
| vl1-block3 成果生成 | `npm run test:vl1-block3` | result-generation 正确性 |
| vl1-block4 体验提案 | `npm run test:vl1-block4` | experience-proposal 快慢学习 |
| p1-02 package store | `npm run test:p1-02` | Package 读写不变 |
| classic-renderer-dom | `npm run test:classic-renderer-dom` | 渲染器 DOM 结构 |
| p1-07 life identity | `npm run test:p1-07` | life 资料不变 |

---

## 二、新第一闭环规格

### 2.1 产品合同

用户从表达目标到看到初稿之间的路径：

```
用户输入目标 → 系统自动（并行）执行:
  ├─ 任务意图解析 (task-intent.js → 已有)
  ├─ 本人上下文检索 (autoSelect → 新增，基于已有 subject-context-assembly)
  ├─ 外部研究（如任务需要）(research-run.js → 已有)
  ├─ 能力路由 (l0.js → 已有)
  └─ 风险判断 (policy-engine/ → 已有)
→ 直接生成初稿 (result-generation.js → 已有)
→ 用户审阅
  ├─ 自然修改（只作用本次任务）
  ├─ 查看"本次如何考虑了我"(结果层可见)
  ├─ 调整个性化（本次不用 / 长期记住）
  └─ 如涉及对外发送 → 进入发送前确认
```

**硬约束**：
- [ ] 从输入目标到初稿出现，中间不超过一个可跳过的澄清问题
- [ ] 有 Digital Me 时，初稿明显体现个性化（与通用稿可区分）
- [ ] 零资料用户不受阻，得到完整可用的通用初稿
- [ ] 本人上下文自动选择在后台完成，用户不可见
- [ ] 结果后才提供"查看依据 / 本次如何考虑了我"
- [ ] 学习分快（本次）/ 慢（长期），慢学习须确认
- [ ] 发送/发布/付款等在最终承诺点确认
- [ ] 撤销本次学习可恢复
- [ ] 所有术语使用用户语言，无 claim/Package/Skill/Runtime 字样

### 2.2 状态机

```
INITIAL
  │
  ├─ 用户输入目标 ──→ PROCESSING
  │                    │
  │                    ├─ 意图明确 ──→ AUTO_GENERATING
  │                    │                 │
  │                    │                 ├─ 成功 ──→ RESULT_READY
  │                    │                 │            │
  │                    │                 │            ├─ 用户修改 ──→ EDITING
  │                    │                 │            │                 │
  │                    │                 │            │                 ├─ 保存 ──→ RESULT_READY
  │                    │                 │            │                 └─ 提出学习 ──→ LEARNING_PROPOSAL
  │                    │                 │            │                                   │
  │                    │                 │            │                                   ├─ 接受 ──→ RESULT_READY (长期已更新)
  │                    │                 │            │                                   └─ 拒绝 ──→ RESULT_READY
  │                    │                 │            │
  │                    │                 │            ├─ 查看依据 ──→ EXPLANATION_OPEN ──→ RESULT_READY
  │                    │                 │            │
  │                    │                 │            ├─ 发送/发布 ──→ SEND_CONFIRM
  │                    │                 │            │                 │
  │                    │                 │            │                 ├─ 确认 ──→ SENT
  │                    │                 │            │                 └─ 取消 ──→ RESULT_READY
  │                    │                 │            │
  │                    │                 │            └─ 放弃/超时 ──→ INITIAL
  │                    │                 │
  │                    │                 └─ 失败 ──→ RESULT_ERROR
  │                    │                               │
  │                    │                               └─ 重试 ──→ PROCESSING
  │                    │
  │                    └─ 需要澄清（最多一次）──→ AWAITING_CLARIFICATION
  │                                                 │
  │                                                 ├─ 用户回答 ──→ AUTO_GENERATING
  │                                                 └─ 跳过（用默认）──→ AUTO_GENERATING
  │
  └─ 用户打开"我" ──→ ME_HOME
                        │
                        ├─ 查看目前的我 ──→ SELF_DETAIL
                        ├─ 纠正理解 ──→ CORRECTING → SELF_DETAIL
                        ├─ 撤销学习 ──→ (回滚) → SELF_DETAIL
                        ├─ 让我更懂你 ──→ BUILD_CHOICE
                        │                 ├─ 导入资料 ──→ BUILD_IMPORT
                        │                 └─ 聊天引导 ──→ BUILD_CHAT
                        └─ 出示凭据 ──→ CREDENTIAL_VIEW
                                          ├─ 出示 ──→ CREDENTIAL_PRESENTED
                                          └─ 撤销 ──→ CREDENTIAL_VIEW
```

### 2.3 新 IPC 通道

| 通道 | 方向 | 用途 |
|---|---|---|
| `actBehalf:autoGenerate` | renderer → main | 一键生成：传入目标，返回成果（自动完成上下文选择和研究） |
| `actBehalf:adjustResult` | renderer → main | 修改结果：传入当前结果 + 修改指令，返回重写后结果 |
| `actBehalf:viewInfluence` | renderer → main | 查看本次个性化依据（结果后按需调用） |
| `actBehalf:removeInfluence` | renderer → main | 本次不用某条依据，重写结果 |
| `actBehalf:proposeLearning` | renderer → main | 提交长期学习建议 |
| `actBehalf:confirmLearning` | renderer → main | 确认接受长期学习 |
| `actBehalf:revokeLearning` | renderer → main | 撤销长期学习 |
| `actBehalf:confirmSend` | renderer → main | 确认对外发送/发布（R3 级别确认） |
| `subject:getOverview` | renderer → main | 获取"我"的概览 |
| `subject:correctUnderstanding` | renderer → main | 纠正/更新长期理解 |
| `subject:generateCredential` | renderer → main | 生成对外凭据 |
| `subject:revokeCredential` | renderer → main | 撤销凭据 |

### 2.4 风险矩阵

与基线 v0.2 §9 完全对齐，编码到 policy-engine 中：

| 等级 | 典型行为 | 默认策略 | IPC 要求 |
|---|---|---|---|
| R0 认知生成 | 问答、分析、写初稿、代码生成、图像 | 自动完成；无阻塞 | `autoGenerate` 直接返回 |
| R1 可逆本地 | 新建草稿、保存文件、整理 | 自动或一次授权 | `autoGenerate` + 可选确认 |
| R2 敏感出域 | 高敏资料发外部能力 | 按数据类别即时授权 | `confirmSend`（标注敏感项） |
| R3 外部承诺 | 发邮件、发布、邀请、删除 | 预览+后果+确认 | `confirmSend`（预览完整内容） |
| R4 高后果 | 付款、签约、法律/医疗 | 本人必须在场 | 仅辅助，不自动执行 |

### 2.5 能力覆盖矩阵

| 门类 | 第一闭环覆盖 | 实现方式 | 95 分位状态 |
|---|---|---|---|
| 写作与内容 | 覆盖 | `result-generation.js` + `autoGenerate` IPC | 核心验证门类 |
| 研究与分析 | 覆盖 | `research-run.js` + `research/` agent-loop | 覆盖 |
| 代码与工程 | 覆盖 | `autoGenerate` 可路由到编程，但第一闭环重点不在此门类 | 门类可达，后端能力就绪；第一闭环暂不设为此门类的主验证场景 |
| 演示与汇报 | 覆盖 | `outputs/pptx.js` | 后端能力就绪 |
| 多媒体创作 | 覆盖 | 通过 `autoGenerate` 路由 | 后端能力就绪 |
| 文件与数据 | 覆盖 | `outputs/document.js`, materials | 后端能力就绪 |
| 沟通与邮件 | 覆盖 | `autoGenerate` + `confirmSend` | 第一闭环验证门类（路径 5） |

### 2.6 验收清单

第一闭环 accepted 须同时满足（同基线 v0.2 §12，此处为可执行版本）：

1. [ ] 启动 `npm start`，零资料用户输入写作目标，点击生成 → 直接得到初稿（无候选选择页）
2. [ ] 有资料用户的初稿在选题、论证、表达上与通用稿可区分
3. [ ] 结果页有"本次如何考虑了我"按钮，点击后展示 ≤ 5 条关键影响项
4. [ ] 移除一条影响项后重写，结果改变但不改 Package 原文
5. [ ] 用户说"更短一点"，结果重写（仅本次生效）
6. [ ] 用户选择"以后也这样"→ 长期学习面板弹出 → 确认后记忆生效
7. [ ] 在"我"中可查看、纠正、撤销长期学习
8. [ ] 起草邮件"准备发送"→ 展示预览 → 确认 → 成功发送
9. [ ] 无重复入口（写作/研究都不再出现"研究与表达"）
10. [ ] 界面无 claim/Package/Skill/Runtime/MCP 等术语
11. [ ] 重启后任务、草稿、上下文快照可恢复
12. [ ] `npm run test:act-behalf`、`test:vl1-*`、`test:p1-02`、`test:p1-07`、`test:classic-renderer-dom` 全部通过
13. [ ] 新 `test:gate4-auto-flow` 覆盖 autoGenerate 完整链路
14. [ ] 键盘可操作所有核心路径

---

## 三、实现任务拆分（下发给 Cursor 的顺序）

以下按依赖顺序排列，每块须在有 Owner 验收通过后才能继续下一块。

### Task G4-01：重构 IPC 通道与 main.js（不涉及 UI）

**输入**：本文档 §1.3 main.js 改动  
**范围**：
- 新增 `actBehalf:autoGenerate` IPC handler：组合 task-intent → autoSelect context → research-run（如需要）→ result-generation → 返回成果
- `autoSelect()` 实现：在 subject-context-assembly.js 新增函数，自动按目标相关性选择 top-N claim；风险高时标记需确认的敏感条目
- 保留原有 `actBehalf:previewContext` / `actBehalf:confirmContext` handler 不变（不删除，仅降为高级接口）
- 新增 `actBehalf:adjustResult`、`actBehalf:viewInfluence` 等 IPC
- preload.js 同步增加对应 bridge 方法
**不涉及**：UI、页面结构、入口变更
**停止条件**：`npm run test:act-behalf` + `test:vl1-block1` + `test:vl1-block3` 通过
**输出**：commit + patch + 测试日志

### Task G4-02：移除旧研究与表达入口 + 精简 UI

**输入**：基线 §11.3、本文档 §1.2  
**范围**：
- 删除 `panorama-experience/` 目录
- 从 `main.js` 删除 panorama-experience 导入和 IPC 路由
- 从工作台入口配置中删除"研究与表达"
- `renderer-next/src/AppShell.tsx` 中移除候选确认页引用
- 保留"写作"和"研究"快捷入口（如有）
**不涉及**：act-behalf 后台逻辑、测试
**停止条件**：Electron 启动后无"研究与表达"入口；写作任务可正常触发
**输出**：commit + patch + 截图

### Task G4-03：实现自动生成主路径 UI

**输入**：G4-01、G4-02  
**范围**：
- 统一任务输入框（对话入口）：输入目标，点击生成
- 结果展示区：初稿主体 + "继续修改" / "本次如何考虑了我" / "保存到做事"
- 依据面板（按需展开）：展示 ≤5 条关键影响项，每条支持"本次不用" + 重写
- 学习面板：修改后"以后也这样"按钮 → 确认弹窗
- 发送确认（邮件等）：准备发送 → 预览+确认 → 已发送
**停止条件**：原型 7 条路径在数字之我 Electron 中均可完整走通
**输出**：commit + patch + 7 条路径的 owner 走查记录

### Task G4-04：新自动化测试

**输入**：G4-01、G4-03  
**范围**：
- 新增 `scripts/test-gate4-auto-flow.cjs`：完整覆盖 autoGenerate 链路（意图解析 → 上下文自动选择 → 研究调用 → 结果生成）
- 验证：零资料可生成、有资料有个性化、依据面板正确显示、学习提案可生成
**停止条件**：新增测试通过 + 全部既有回归通过
**输出**：commit + test log

### Task G4-05：凭据生成与出示（§5.4 最小实现）

**输入**：G4-01  
**范围**：
- 在 `subject-overview/` 中新增 `credentials.js`
- IPC: `subject:generateCredential`、`subject:revokeCredential`
- 凭据由已有资料聚合生成（不需新数据格式）
- UI：在"我" > "我的身份凭据"中展示凭据生成/出示/撤销
**停止条件**：凭据生成/出示/撤销链路可用
**输出**：commit + patch

---

## 四、不纳入第一闭环的内容

以下在基线中有定义但明确不进入本轮实现：

- 多 Agent 协作网络（Digital Org）
- 能力市场 / 插件市场
- 凭据的零知识证明（仅做精简凭据）
- 多平台凭据互认机制
- 外部 Agent 雇佣/匹配/结算
- 高级分析仪表面板
- R3 渲染器迁移完成（`renderer-next/` 现有能力足够）
