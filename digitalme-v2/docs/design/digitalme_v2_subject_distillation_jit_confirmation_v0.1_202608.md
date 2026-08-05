# Digital Me V2 — 主体蒸馏与 JIT 确认（v0.1）

日期：2026-08  
任务：`DIGITALME-V2-SUBJECT-DISTILLATION-AND-JIT-CONFIRMATION-01`  
后续接线：`DIGITALME-V2-REAL-DISTILLATION-INTEGRATION-AND-JIT-FIX-01`  
基线：`v2/foundation` @ `51c63b6`

## 目标

唯一正式路径：

`captureInput` → **产品模型运行时蒸馏** → **候选归一** → **确定性质量门** → 静默采纳或待确认 → 相关任务选择性复用 → **即将使用时 JIT**。

不新建 Memory / Profile / Preference / JIT Decision Store；不新建分类体系或第二蒸馏入口。

## 模块

| 模块 | 职责 |
|------|------|
| `distill-model-runtime.ts` | 复用做事路径的 `openaiCompatible` + `SecretAccessor` + `chatComplete` |
| `candidate-normalize.ts` | 模型近义字段 → 正式合同（如 `user_preference` → `preference`） |
| `structured-distill.ts` | 真模型或合同蒸馏；失败合同降级；保留 normalizeTrace |
| `candidate-quality-gate.ts` | 来源、归因、敏感推断、去重、临时 scope、external_claim |
| `jit-confirmation.ts` | 冲突检测与自然语言选项；本次强制纳入 / 排除 |
| `SubjectService.captureInput` | 注入产品蒸馏运行时；记录 `distillMode` |
| `SubjectService.prepareJitForTask` | 任务注入前登记提示与排除/纳入集 |
| `subject.respondToLearning` | `use_a_once` / `prefer_*` / `defer` |

模型只提候选与建议；`needs_confirmation` 不得越过本地确定性规则。

## 降级纪律

- 凭证缺失 / 模型失败 / 超时 → `mode=model_fallback_contract`（或合同）
- 主 Job / Artifact 不因蒸馏失败中断
- 低置信合同候选不得错误静默采纳
- 不无限重试；验证脚本模板不得冒充真模型成功

## 用户面

- 「数字之我」：已确认 / 待确认 + 自然语言来源说明
- 做事页：仅相关任务展示自然语言选择（本次 A/B、以后优先 A/B、暂不决定）
- 禁止展示 GrowthEvent、conflictId、confidence、原始 schema、内部路径

## 验收

```bash
npm run accept:real-distillation-jit-integration
npm run accept:subject-distillation-jit-confirmation
```

真模型复验（A/D）：

```bash
node scripts/run-real-distillation-ad-revalidation.cjs
```

## 明确不做

新记忆库、人格画像、全量永久提炼、每次任务弹确认、质量评测平台、第二 Agent、广播/支付/信誉、UI 大改。
