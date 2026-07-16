# Aivestor 到 Digital Me 的能力抽象清单（讨论稿）

版本：v0.1  
状态：讨论稿  
日期：2026-06-28

## 一、文档定位

本文件不是 Digital Me 系统规划的起点，也不是将 Digital Me 限定为 Aivestor 的扩展功能。

Aivestor 只是 Digital Me 的一个重要参考样本：它已经在投资分析场景中部分实现了“蒸馏个人经验、判断逻辑、表达风格，并允许迁移到其他 AI 工具”的能力。因此，可以从 Aivestor 中抽象出若干通用能力，为 Digital Me 系统设计提供参考。

Digital Me 应从一开始保持整体规划：面向不同人、不同职业、不同场景，形成平台中立、本地优先、可迁移、可授权的个人数字系统。

## 二、Aivestor 已有能力种子

从当前产品功能看，Aivestor 已经具备以下 Digital Me 种子：

| Aivestor 能力 | Digital Me 含义 |
|---|---|
| 我的投资 DNA | 领域型人格与判断蒸馏 |
| 私有知识库 | 个人数据仓与记忆系统 |
| 项目分析报告 | 基于个人判断框架的任务输出 |
| 多轮修改 | 用户反馈学习 |
| SKILL 市场 | 能力包机制 |
| 知识库快照下载 | 个人数据迁移 |
| system prompt 导出 | 跨平台使用 |
| 完整投资档案 Word | 个人知识资产归档 |
| “你的判断，永远属于你” | 用户主权原则 |

## 三、核心抽象关系

| Aivestor 专有概念 | Digital Me 通用概念 |
|---|---|
| 投资人画像 | Persona Card |
| 投资偏好 | Preferences |
| 投资判断逻辑 | Decision Frameworks |
| 投资报告风格 | Style Guide |
| 项目分析历史 | Historical Judgments |
| 项目档案 | Source Archive |
| 知识库条目 | Memory / Source |
| 投资 SKILL | Skill |
| 投资 DNA 导出 | Digital Me Package Export |
| 报告修改反馈 | Feedback Learning |

## 四、可复用的通用能力

### 1. 个人资料收纳

Aivestor 收纳 BP、项目资料、投资笔记、分析报告。Digital Me 可扩展为收纳任何个人有效输出：

1. 文章；
2. 文档；
3. 聊天记录；
4. 项目记录；
5. 照片和视频；
6. 会议纪要；
7. 邮件；
8. 代码；
9. 决策记录；
10. 反馈和修改记录。

### 2. 判断框架蒸馏

Aivestor 从投资分析中学习用户判断逻辑。Digital Me 可抽象为：

1. 用户如何判断好坏；
2. 用户重视哪些信号；
3. 用户反对哪些模式；
4. 用户如何处理不确定性；
5. 用户如何权衡风险与收益；
6. 用户如何形成结论。

### 3. 表达风格蒸馏

Aivestor 可以学习投资报告的表达风格。Digital Me 可扩展为：

1. 口吻；
2. 结构；
3. 篇幅；
4. 常用术语；
5. 禁用表达；
6. 论证方式；
7. 面向不同对象的表达差异。

### 4. 能力包生成

Aivestor 的投资 SKILL 可抽象为通用 Skill：

1. 投资分析 Skill；
2. 创始人表达 Skill；
3. 项目管理 Skill；
4. 写作 Skill；
5. 研究 Skill；
6. 法务初审 Skill；
7. 课程设计 Skill；
8. 社群运营 Skill。

### 5. 反馈学习

Aivestor 中用户对报告的修改，可以成为数字之我学习的重要来源。

Digital Me 中应将反馈分为：

| 反馈类型 | 含义 |
|---|---|
| 内容修正 | 用户认为事实或判断不准确 |
| 风格修正 | 用户认为表达不像自己 |
| 结构修正 | 用户偏好不同组织方式 |
| 结论修正 | 用户不同意 AI 判断 |
| 风险修正 | 用户认为遗漏关键风险 |
| 边界修正 | 用户认为 AI 越权 |

### 6. 可迁移导出

Aivestor 已经有下载和迁移设计。Digital Me 应将其标准化：

```text
persona.md
preferences.json
decision-frameworks.json
style-guide.md
skills/
memory/
source-index.json
policies/
README.md
```

## 五、从 Aivestor 扩展到 Digital Me 的设计启发

### 1. 从“投资 DNA”到“个人 DNA”

投资 DNA 是领域型蒸馏。Digital Me 应支持多个 DNA 模块：

| DNA 模块 | 内容 |
|---|---|
| 投资 DNA | 投资偏好、项目判断、风险框架 |
| 创始人 DNA | 产品判断、商业判断、组织方式 |
| 写作 DNA | 表达风格、选题偏好、论证习惯 |
| 研究 DNA | 信息筛选、证据标准、分析框架 |
| 工作 DNA | 任务偏好、协作方式、执行习惯 |
| 关系 DNA | 沟通偏好、重要关系、互动边界 |

### 2. 从“项目分析”到“任务执行”

Aivestor 主要完成投资项目分析。Digital Me 应扩展到：

1. 写作；
2. 研究；
3. 项目管理；
4. 日程与邮件；
5. 知识整理；
6. 决策辅助；
7. 低风险自动执行；
8. 高风险草案生成与审批。

### 3. 从“知识库快照”到“个人记忆系统”

Aivestor 的知识库快照是静态导出。Digital Me 应进一步支持：

1. 长期记忆；
2. 项目记忆；
3. 关系记忆；
4. 版本记忆；
5. 被用户否定的记忆；
6. 过期或低可信记忆。

### 4. 从“导出 prompt”到“Package + Runtime”

system prompt 适合轻量迁移，但不足以承载完整 Digital Me。

Digital Me 应形成：

1. 可读 prompt；
2. 结构化 package；
3. 本地 runtime；
4. 模型网关；
5. 授权策略；
6. 审计日志。

## 六、Aivestor 可作为首个垂直验证场景

建议将 Aivestor 作为 Digital Me 的第一个垂直验证场景，但不将 Digital Me 限制在其中。

可先验证：

1. 个人判断能否被结构化表达；
2. 用户是否愿意下载和迁移自己的判断资产；
3. AI 是否能在新任务中调用个人判断；
4. 用户反馈能否持续改善“像我”的程度；
5. 不同 AI 平台是否能读取同一个 Digital Me Package。

## 七、Aivestor 下一步可做的小步升级

如果后续在 Aivestor 内先做试验，可优先做：

1. 将“我的投资 DNA”升级为“Investor Digital Me”；
2. 将单一 system prompt 导出升级为 zip package；
3. 增加 `investment-dna.json`；
4. 增加 `style-guide.md`；
5. 增加 `decision-framework.md`；
6. 增加 `source-index.json`；
7. 增加 `usage-guide.md`；
8. 增加用户修改反馈记录；
9. 增加“哪些内容属于本人”的说明；
10. 增加“可迁移到任意 AI 工具”的使用说明。

## 八、边界提醒

Aivestor 的经验有价值，但 Digital Me 不应被投资场景限制。

需要避免：

1. 把 Digital Me 做成投资分析附属功能；
2. 只围绕 system prompt 做迁移；
3. 只关注“像不像我”，忽视所有权和授权；
4. 只做云端 SaaS，忽视本地优先；
5. 只做工具，忽视人的主体性战略。

## 九、总结

Aivestor 的价值在于提供了一个已经发生的真实样本：人的判断、风格和经验可以被 AI 蒸馏，并以可迁移形式带到其他工具中。

Digital Me 应在此基础上进一步抽象为面向所有人的个人数字系统：

> 从领域经验蒸馏开始，走向个人记忆、判断、能力、授权和主体性的系统化表达。

## 十、协作与交易能力规划（从样本到系统）

基于 Aivestor 经验，Digital Me 在系统层面可按“协作能力 > 交易能力 > 网络能力”三层推进：

### 1. 协作能力（先做）

1. 跨 Agent 的受限调用（指定 skill / 指定 memory）；
2. 多方任务编排（Owner Agent + External Agent）；
3. 人机协同审批（高风险动作回流给本人）；
4. 协作结果审计（谁输入、谁判断、谁修改、谁确认）。

### 2. 交易能力（次阶段）

1. 按次调用计费；
2. 按时间租用能力；
3. 按成果分成；
4. 长期许可（license）；
5. 撤销授权后的即时停用与结算截断。

### 3. 网络能力（后阶段）

1. 个人 Digital Me 之间的双向授权；
2. 团队级 Digital Me 协作空间；
3. 企业-个人 Digital Me 合同化协作；
4. 可验证信誉与履约记录（不暴露隐私内容）。

### 4. 对应 MVP 功能清单

建议将 MVP 拆成 3 组可落地功能：

1. `Authorization Console`：授权配置、时效、撤销、查看调用方；
2. `Interaction Gateway`：请求校验、策略执行、输出脱敏、日志写入；
3. `Usage & Settlement Ledger`：调用计量、价格规则、账单与分账记录。
