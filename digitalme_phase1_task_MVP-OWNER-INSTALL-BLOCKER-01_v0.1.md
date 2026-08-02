# MVP-OWNER-INSTALL-BLOCKER-01

- **状态**：`root_cause_fixed` / `owner_like_repro_validated` / `not_pushed`
- **基线**：`144d0d7`
- **报告**：`MVP_OWNER_INSTALL_BLOCKER_01_REPORT_20260802.md`
- **旧候选**：`20260802-184853-144d0d7` = `rejected_owner_acceptance_failed`

## 根因（摘要）

材料截断后 digest 字段不一致 → 粘滞 `materialsStale` → 「开始做」被通用提示吞掉。

## 修复后

须重建全新 portable；Owner 用新候选再验收（勿再用 `144d0d7` 便携包）。
