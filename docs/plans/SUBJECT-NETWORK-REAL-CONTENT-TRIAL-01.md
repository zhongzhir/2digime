# SUBJECT-NETWORK-REAL-CONTENT-TRIAL-01

日期：2026-09-11  
状态：PLANNED  
前置：Institution Distribution v0.1 与 Institution Landing Page 完成

## 1. 目标

不用新建内容推荐系统，直接利用现有数字主体网络，以一条真实公开内容验证：

> 内容进入网络 → broadcast → relay → 多个 Digital Subject 收到 → 各自 2digime 基于自己的 Digital Self 独立 SHOW / IGNORE → 用户看到不同结果 → 用户真实反馈

首个内容建议使用：

- 漫剧
- 或其它适合普通用户真实消费的公开内容

漫剧只是试验载体，不形成新的产品 Core。

## 2. 核心原则

- Relay 只做连接和传输。
- 中央服务不建立集中兴趣画像。
- 中央服务不做 personalized ranking。
- 每个用户自己的 2digime 做最终 SHOW / IGNORE。
- 一个 Subject 的判断不影响另一个 Subject。
- AI 自己的判断不能自动写回为用户 preference。
- 只有真实用户行为或明确表达，才有资格进入 Digital Self 学习候选。

## 3. 禁止新增

除非现有实现确有 blocker，默认禁止：

- ContentRecommendationEngine
- MangaRouter
- VideoRouter
- RecommendationWorkflow
- InterestStateMachine
- 中心化用户画像系统

优先零产品代码完成真实验证。

## 4. 最小内容对象

优先复用现有通用 payload。

必要字段仅包括：

- title
- short description
- public URL
- optional cover URL
- content type
- source
- publishedAt

不得因漫剧新增专用领域模型。

## 5. 真实 Subject

至少两个独立 Subject。

每个 Subject：

- 有独立 Digital Self
- 基于真实人类输入
- 独立进行模型判断
- 不通过关键词 if/else 预设 SHOW / IGNORE

## 6. 用户体验

SHOW：

- 内容自然出现在 feed / network surface
- 可以打开真实链接

IGNORE：

- 默认不打扰

用户可给最小反馈：

- 感兴趣
- 不感兴趣
- 或现有等价动作

用户面不展示：

- subjectId
- relay
- OpportunitySignal
- score
- internal reasoning
- protocol payload

## 7. Provenance

必须区分：

A. AI 推断：
“我认为主人可能对此感兴趣”

B. 用户事实：
“用户明确点击 / 喜欢 / 不喜欢 / 忽略”

A 不得升级成 B。

## 8. 验收证据

- Authority SHA
- 真实内容 URL
- broadcast 证据
- relay 收发证据
- Subject A 决定
- Subject B 决定
- 两个用户侧实际表现
- 真实反馈
- Digital Self 写回审计
- 是否修改产品代码

不记录或暴露模型完整 chain-of-thought，只保留可审计结论和依据摘要。

## 9. Verdict

成功：

`SUBJECT_NETWORK_REAL_CONTENT_ACCEPTED`

失败：

只报告阻断真实闭环的最小 blocker，再决定是否修复。
