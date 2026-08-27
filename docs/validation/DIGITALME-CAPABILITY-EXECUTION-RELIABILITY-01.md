# DIGITALME-CAPABILITY-EXECUTION-RELIABILITY-01

> 只修 baseline / professional search 的**真实执行可靠性**。不改 semantic planner / intent / SearchNeedDecision / Subject / context assembly。不 push。

基线：`19c6176f2e8f6149012abffad3a19416d260ef5f`。

---

## 诊断（先证据，后修改）

权威落盘：`build/evidence/ai-native-semantic-control-01/`（full Electron `dmv2-semctl-ud-L3l2nR`）+ 更早一轮 `VE2uWF`。

### 1. T2B 失败节点

不是 Bing 空结果，也不是 semantic 选错。

`events.json` 中 `job_mtb0yuow560b81e2a615`：

1. `正在检索外部来源` → `正在读取凭证` → `正在组织材料` → `正在调用模型`  
   → **搜索已返回，文档综合已开始**。
2. `切换可用能力继续`  
   → 综合瞬时失败被当成 **search capability 失败**，触发 provider fallback。
3. 再次 `正在检索外部来源` → `failed` / 「暂时无法可靠获取最新外部信息。」  
   → fallback 打到刚 cooldown 结束的 `cap_gemini_web_search`，搜索失败；`jobFallbackAttempted` 已用尽。

终态：`capabilityId=cap_gemini_web_search`，`material_search_evidence=false`（第二次尝试重建 snapshot，第一次已成功的 search-evidence 被丢掉）。

更早 `VE2uWF`：T2B 走 `cap_baseline_web_search`，snapshot **已有** `external-information://search-evidence`，`failure.stage=model`，用户文案仍是「无法获取最新外部信息」——同一条误分类。

### 2. 失败类型

**可恢复的文档综合 / 模型瞬时失败（503 等）被升级成 Job fatal search failure。**  
不是 Job orchestration 本身坏了；是 fallback 粒度错了。

### 3. T2 与 T2B 是否同一 capability path

不完全相同。

- `selectForNeed` 在 `needsExternalInformation` 时**优先 professional（Gemini search）**，否则 baseline。
- T2：`events` 显示 professional 先失败 → `切换可用能力继续` → baseline 检索 + 综合 **成功**。
- T2B：Gemini 60s cooldown 在 T2B 提交时往往仍生效 → 直接 baseline；综合失败后又把 cooldown 已过的 Gemini 选回来。

同一条「搜索 + 文档综合」链，**首次选中的 search provider 可以不同**。

### 4. 输入 / 超时 / 重试差异

| | T2 | T2B |
|---|---|---|
| 计划能力 | `external_information` + `document_synthesis` | 同 |
| 先选 | Gemini search（随后 fallback） | baseline（cooldown） |
| 搜索 | baseline 成功，有 search-evidence | 第一次 baseline 同样成功 |
| 综合 | 成功 | 瞬时失败 |
| 之后 | 结束 | 误 fallback 到 Gemini search 再失败 |
| 超时 | search attempt 90s；Gemini connector 60s；Bing 默认 15s | 同；综合无独立 retry |

### 5. 偶发 / cooldown / stale

- **有。** `capabilityCooldown` 原 60s：T2 的 Gemini 失败后，T2B 开始时仍排除 Gemini，综合失败时 cooldown 已过，fallback **重新撞** 同一坏 professional。
- `isAbortError` 曾用 `/abort/i` 匹配消息，会把 `Gemini request aborted` 当成用户取消，跳过 fallback（本轮 T2B 不是这条，但仍是可靠性缺陷）。
- 同进程连续 T4/T5/T2 之后，文档模型 503 与 Gemini search 503 会叠加。

### 6. 为什么没走「已有 fallback」

已有 fallback 是 **换 search provider 再检索**，且每 Job 一次。

综合失败时 `job.capabilityId` 仍是 search → 消耗这仅有的一次 fallback → 丢掉已检索证据 → 第二次 search 失败后无法再重试综合。

### 7. 是否可恢复

可恢复：snapshot 已有（或可再有）search-evidence；应对 **文档模型做 bounded retry**，失败应报整理/模型不可用，而不是「无法获取外部信息」。  
runtime 没恢复，是因为把综合失败当成了 search fatal。

---

## 修复（非 case patch）

`src/work-runtime/job-runner.ts`：

1. 搜索成功后，`synthesizeAfterExternalInformation` 对瞬时失败做最多 3 次尝试（含退避）。
2. 综合失败打上 `document_synthesis_failed`：**禁止** search provider fallback、**禁止** 标记 search cooldown、用户文案不再套用 `SEARCH_UNAVAILABLE`。
3. search fallback **只允许**落到另一 search 能力；禁止用普通文档能力顶替（假完成）。
4. search cooldown 60s → 180s，避免连续研究任务立刻再撞刚失败的 professional。
5. `isAbortError` 只认 `name === 'AbortError'`。
6. Bing 默认超时 15s → 30s；`blocked`/`parse` 视为可回退。

未改：planner / intent / execution family / SearchNeedDecision / Subject / context assembly / T2B 关键词路由。

---

## 验证

单测（`tsc` 后）：

- `capability-execution-reliability-01` 3/3
- `search-failure-closure-01` + `research-runtime-reliability-02` + `ai-native-semantic-control-01` 回归全部通过（合计 27/27）

### A. T2B 单独 ×3

| 轮 | userData | capability | search-evidence | job |
|----|----------|------------|-----------------|-----|
| 1 | `dmv2-semctl-ud-DWpqG7` | `cap_gemini_web_search` | true | succeeded |
| 2 | `dmv2-semctl-ud-Y5YGdA` | `cap_baseline_web_search` | true | succeeded |
| 3 | `dmv2-semctl-ud-z0AOlZ` | `cap_baseline_web_search` | true | succeeded |

证据：`build/evidence/caprel-t2b-{1,2,3}/`

### B. T2 + T2B 连续

同一进程 `dmv2-semctl-ud-99wAhM`：两者均为 `cap_baseline_web_search` succeeded，均有 search-evidence。第二次未受第一次 cooldown 污染。

证据：`build/evidence/caprel-t2-t2b/`

### C. 完整 Electron Trial

`SEMCTL_ONLY=ALL`，userData `dmv2-semctl-ud-amw8jI`，driver exit 0，`summary.json` `"ok": true`：

| 题 | 结果 |
|----|------|
| T2 | pass，`cap_baseline_web_search` + search-evidence |
| T2B | pass，`cap_baseline_web_search` + search-evidence |
| T4 | pass，preference adopted + in context |
| T5 | pass，NORTHSTAR historical context |
| driver ↔ 磁盘 | 一致（只读权威 Job） |

证据：`build/evidence/ai-native-semantic-control-01/`
