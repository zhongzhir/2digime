# DIGITALME-REAL-TRIAL-OBSERVABILITY-FIX-01

> 修复真实 Electron Trial driver 的观测可靠性。不改 AI-native semantic control 产品行为。  
> 基线：`cfb8a7568c574b34e60a17a46227e1d6dc67c0e4`。不 push。

---

## 误判根因

| 判定 | 旧 driver | 权威产物 |
|------|-----------|----------|
| search used | 读 `subjects/default/jobs`（空）或 UI 材料摘要；`jobs: []` → `search:false` | `runtime/jobs/*.json` 的 `capabilityId` + `materialUse` |
| T4 preference | `subject.getOverview.confirmedExperienceCount`（实践经验条数，不计 preference）+ 扫描 snapshot JSON 外壳（只有 content ref） | `derived/preferences.json` + `growth/events.ndjson`（confirmed `preference_observed`）+ snapshot `subjectContextRef` 指向的 freeze 正文 |
| T5 context | 成文 excerpt 是否出现 NORTHSTAR | Job `materialUse` / snapshot items，以及 task plan `relevantContextIds` 解析到的 artifact 记录 |
| 时序 | UI 编辑器出现正文即判定；未等 Job 落盘 | `waitForTaskJob` 等到 `status=succeeded\|failed` 且有 `capabilityId` |

旧结论把 fallback/overview 字段当成执行结果，出现「磁盘已成功、测试失败」。

---

## 修复方式

- `scripts/lib/trial-authoritative-evidence.cjs`：只读权威落盘。
- `scripts/ai-native-semantic-control-ui-driver.cjs`：UI 只负责真实点击/输入；verdict 只读上述产物。
- `scripts/tests/trial-authoritative-evidence.test.cjs`：用上一轮真实 Job/freeze 形态做回归。

产品代码（planner / capability / subject / context assembly）未改。

---

## 验证

单测：`node --test scripts/tests/trial-authoritative-evidence.test.cjs` — 7/7 通过。

Electron（`node scripts/ai-native-semantic-control-ui-driver.cjs`）：

| 题 | 权威判定 | 对应磁盘 |
|----|----------|----------|
| T2 | `search=true`，`capabilityId=cap_baseline_web_search`，job succeeded | 多轮 ALL 一致 |
| T2B | `search=true`，`cap_baseline_web_search` 成功轮：userData `dmv2-semctl-ud-fk2wY4` | 后续 ALL 若 job failed（503），driver 亦标失败 |
| T4 | `preference_adopted` + freeze `selectedEventIds` 含该 preference | ALL `dmv2-semctl-ud-VE2uWF`；capture:noop 轮与磁盘一致为失败 |
| T5 | `historical_context_used`（materialUse 或 plan `relevantContextIds`→NORTHSTAR artifact） | ALL `dmv2-semctl-ud-pS1O9A` / `VE2uWF` |

完整 ALL 最近一轮 exit 2：T2/T5 过、T4 capture:noop、T2B search 已选但 job failed。这是磁盘真实失败，不是目录/overview 误判。
