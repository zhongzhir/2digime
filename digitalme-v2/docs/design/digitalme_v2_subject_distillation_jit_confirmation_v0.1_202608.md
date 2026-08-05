# Digital Me V2 — 主体蒸馏与 JIT 确认（v0.1）

日期：2026-08  
任务：`DIGITALME-V2-SUBJECT-DISTILLATION-AND-JIT-CONFIRMATION-01`  
基线：`v2/foundation` @ `3436787`

## 目标

在既有成长循环上补齐：

用户自然行为 / 资料 → **结构化蒸馏（合同或可选真模型）** → **确定性质量门** → 低风险静默沉淀 → 冲突保持待确认 → **即将使用时自然语言确认** → 主任务继续完成。

不新建 Memory / Profile / Preference Store。

## 模块

| 模块 | 职责 |
|------|------|
| `structured-distill.ts` | 产出带完整字段的候选；默认合同蒸馏；可选 `chatComplete` |
| `candidate-quality-gate.ts` | 来源、归因、敏感推断、去重、临时 scope、external_claim 等硬门 |
| `jit-confirmation.ts` | 冲突检测与自然语言选项；跳过时保守注入；高风险暂停外部行动 |
| `SubjectService.prepareJitForTask` | 任务注入前登记提示与排除集 |
| `subject.respondToLearning` | 扩展 `use_a_once` / `prefer_*` / `defer` |

模型只提候选，不得直接 confirm / 覆盖 / 判定用户事实 / 授权高风险行动。

## 用户面

- 「数字之我」：已确认 / 待确认 + 自然语言来源说明；修改 / 撤销 / 删除。
- 做事页：仅相关任务展示自然语言选择（本次 A/B、以后优先 A/B、暂不决定）。
- 禁止展示 GrowthEvent、conflictId、confidence、分类器、内部路径。

## 验收

```bash
npm run accept:subject-distillation-jit-confirmation
```

通过门槛：错误用户归因 = 0；冲突静默覆盖 = 0；无关任务确认 = 0；蒸馏失败不阻断主任务。

## 明确不做

新记忆库、人格画像、全量永久提炼、每次任务弹确认、质量评测平台、第二 Agent、广播/支付/信誉、UI 大改。
