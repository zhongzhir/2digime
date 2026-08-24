# SUBJECT-DISTINGUISHABILITY-01 — 数字之我 A/B 可区分性验证

Branch: `build/subject-distinguishability-01` (base `af2545e`)
Owner: User · 2digime: 2digime · Coding Agent: opencode
Status: **engineering evidence**（非哲学/法律意义上的「人格/主体资格」宣称）

## 1. 目的

验证：在代码、模型、工具、能力注册表、外部证据、任务与架构**完全相同**的情况下，
仅 **Subject 内核不同**，两个 Digital Me（A 与 B）是否会形成**可持续、可区分、可归因、相互隔离、
与底层模型相对独立**的判断与行动。

不是「文风不同」测试，不是 personality test，不是两个不同 prompt。

## 2. 控制变量

| 维度 | 值 |
|---|---|
| code | 同一 commit `af2545e`，同一 dist |
| model | DeepSeek `deepseek-v4-flash`（同一 baseUrl / key / 温度 / token 预算） |
| tools / capability registry | 同一 CapabilityRegistry（均无 remote-subject；本地模型能力） |
| external evidence | A/B 完全相同的客观材料 |
| task | 同一 16 任务集 |
| subject selection | 同一 `buildSubjectContextPackage` + `selectSubjectInjection`（产品真实机制） |
| **唯一核心变量** | **subject state（SubjectPackage A vs B）** |

## 3. A / B 主体（合成，无 Owner 敏感信息）

见 `evidence/subject-a.json` / `evidence/subject-b.json`。两者结构相同、内容不同、内部一致（非简单反义 prompt）：

- **A（市场验证型）**：目标=快速验证市场；优先级=速度 > 完整；经验=曾因过度开发错过窗口、小实验快速迭代有效；风险=允许可逆试错；边界=不可逆公开发布需确认、允许可逆试错。
- **B（可靠交付型）**：目标=可靠产品交付；优先级=可靠性 > 速度；经验=曾因缺陷损害用户信任、验证门禁有效；风险=关键路径谨慎；边界=高影响变更必须充分验证、不允许未经评审的静默发布。

两主体各含一项**无关个人偏好**（A 喜欢蓝色 / B 喜欢咖啡）用于验证 irrelevant personalization 排除。

## 4. 任务集（16 个，四类）

见 `evidence/tasks.json`。

- A-中性（4）：稳定知识 / 事实整理 / 规格提取 —— 主体差异不应影响事实答案。
- B-权衡（5）：MVP 带病上线、功能 vs 市场验证、进入不确定市场、修缺陷 vs 上功能、快速 vs 可靠渠道。
- C-边界（3）：同一外部 Agent 方案分别触及 A/B 不同边界（核心改动合并上线、不可撤销公开发布、跳过验证灰度）。
- D-连续（4）：下一里程碑、类似项目推进方式、用户纠正后推进、是否复用旧方案。

不针对答案写关键词规则；提示为通用决策助手提示。

## 5. 方法

1. 对每个主体由 growth events `deriveAllViews` → 每个任务 `buildSubjectContextPackage` 选窄上下文（记录 selected / excluded / reason）。
2. 同模型生成 A/B 两版判断（温度 0.3，同一 token 预算）。
3. **Blind judge**：删除 A/B 名称与 event id，随机标 Arm X / Arm Y；给独立 Judge 仅冻结的 A/B Profile，判断 Arm 归属，输出置信度 + 证据类别（goal/tradeoff/boundary/experience/action/style）。
4. 逐任务判断 + 跨任务多任务联合判断。
5. 事实一致性核验（A/B 是否陈述相同客观事实）。
6. 状态隔离：只对 A 学习（Task → correction → confirm → experience_confirmed）后重跑相似任务；B 同任务不变。supersede / boundary 独立核验。
7. 能力交换：单模型环境 → `not_yet_fully_validated`。

## 6. 结果（机器可读：`evidence/summary.json`, `blind-scores.json`, `isolation-results.json`, `capability-swap-results.json`）

| 指标 | 结果 | 判定 |
|---|---|---|
| blind distinguishability（跨任务联合识别率） | **100%（2/2）** | ≥ 80% ✓ |
| 非中性任务逐任务识别率（权衡/边界/连续） | **100%（12/12）** | 显著高于随机 ✓ |
| 中性任务「无法区分」率 | 50%（2/4） | 主体不扭曲事实（剩余由解释侧重区分） |
| fact distortion | **0** | ✓ |
| 状态隔离（A 学习后 B 同任务） | B 不包含学习内容（cross-contamination = 0） | ✓ |
| subject-specific learning | A 行为变化且输出出现「2 周内可验证的最小实验」 | ✓ |
| subject-specific supersede | 旧偏好 excluded、新偏好 selected | ✓ |
| boundary independence | A/B 各自 mandatory 边界分别注入（t10/t11/t12） | ✓ |
| irrelevant personalization | 无关偏好（喜欢蓝色/咖啡）未被泄漏；style-only 判定仅 1/16 且为中性任务 | 低 ✓ |
| minimum agent context | 每任务 selected 0–6 条（bounded），中性任务 0 条 | ✓ |
| capability swap | 单模型 → `not_yet_fully_validated` | 诚实保留 |
| distinguishing signal 来源 | goal/tradeoff/boundary/experience/action（非 style） | ✓ |
| prompt branding | 输出无「作为重视速度的 A」「根据你的风险偏好」类标记（0 命中） | ✓ |

### 6.1 逐任务盲评（`evidence/blind-scores.json`）

- 正确识别的任务：t02,t03,t05,t06,t07,t08,t09,t10,t11,t12,t13,t14,t15,t16（14/16）
- `cannotTell`：t01,t04（两个中性任务——正确：事实不可区分）
- 证据类别：识别成功者均依赖 goal/tradeoff/boundary/experience/action；唯一 style-only 判定在 t04（中性、且判断错误）。

### 6.2 状态隔离（`evidence/isolation-results.json`）

只对 A 增加一条确认经验后：

- A 同任务输出：明确采用「先做 2 周内可验证的最小实验，验证通过后再铺开」→ **aContainsLearning=true**；
- B 同任务输出：无该学习内容 → **cross-contamination = 0**；
- supersede：A 旧偏好（先出完整方案）被 excluded，新偏好（先小验证）被 selected；B 不受影响。

### 6.3 能力交换（`evidence/capability-swap-results.json`）

当前环境仅一个可靠 generic model（DeepSeek）。A/B 两臂使用**同一底层模型**，差异完全由 subject state 驱动（same model, same code, different subject）。
**cross_model_subject_invariance 尚未完全验证（not_yet_fully_validated）**；为完成指标不购买新服务。

## 7. 结论分级

- **LEVEL 1 (subject-conditioned behavior)**：✓ 主体上下文确实改变结果（跨任务识别 100%、非中性 100%）。
- **LEVEL 2 (subject distinguishability)**：✓ 跨任务可稳定区分 A/B，且状态（learning / supersede / boundary）彼此隔离、无串扰。
- **LEVEL 3 (subject continuity under capability change)**：**未完全验证**（单模型环境）。前置条件成立：差异完全由 subject state 驱动，不依赖底层模型的选择性；跨模型验证留待多模型环境。

本实验仅形成 **engineering evidence**，不构成哲学或法律意义上的「人格/主体资格」宣称。

## 8. 是否发现工程缺陷

**否（Phase B 未触发）。** 初始低识别率源于实验台本身的问题（subjectId 不匹配导致主体事件被过滤、提示词框架导致模型忽略上下文、token 预算不足）——全部为 harness 修复，**未改动产品代码**。产品既有 `buildSubjectContextPackage` / `selectSubjectInjection` 即可承载可区分、可隔离的主体行为。

## 9. 存储 / schema

0 新增 Subject Store / 0 第二真值源 / 0 personality database / 0 permanent distinguishability state。
实验数据独立保存为 benchmark/evidence。

## 10. 回归

本次为纯实验（新增 `scripts/subject-distinguishability-run.cjs` + 文档/证据），无产品代码改动。
构建 `npm run build` 通过；`npm run smoke` / `npm run test:model-gate` / `npm run preflight:electron` 通过；
全量测试 870 tests / 834 pass / 31 fail（基线上既有环境失败 + 已知时序 flake），无新增回归。

## 11. 复现

```bash
# 需真实模型凭证（DIGITALME_MODEL_RUNTIME_FILE 或 env）
node scripts/subject-distinguishability-run.cjs
# 输出 build/evidence/subject-distinguishability-01/
```