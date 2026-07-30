# MVP-RELEASE-GATE-01D — 任务执行可靠性、知识调用统一与数据安全收口

- **状态**：`implemented` / `ready_for_mvp_release_gate_01e` / `not_pushed`
- **分支**：`codex/mvp-release-gate-01`
- **起始 HEAD**：`d9f43f6`
- **功能收口 tip**：`8c85f3e`
- **进入 01E 基线 tip**：`3924b05`（含报告 HEAD 校正）
- **性质**：`execution_reliability` / `generation_interrupt_recovery` / `store_backup_and_recovery` / `artifact_store_reconciliation` / `knowledge_resolution_unification` / `stable_delivery_production_hardening`
- **上位**：`MVP-RELEASE-GATE-01C` + `TASK-DO-WORKSPACE-UX-01` → 本任务 → `01E`

## 目标

确保已成立的用户主路径在失败、强制退出、Store/文件中断、知识冲突下仍可解释、可继续：

```text
任务要求 → 任务材料 → 开始做 → 页内成果 → 继续修改 → 采用 / 打开本地文件
```

即使中途失败或退出：任务与材料不丢；不永久「正在生成」；成果不孤儿化；Store 可从 `.bak` 恢复；chat 与 doing 共用有效知识；`stable_delivery` 为唯一生产模式。

## 完成判据（摘要）

1. Generation / Learning 残留 `running`/`generating` 启动可 heal，且幂等  
2. 核心 JSON Store：原子写 + `.bak` + 损坏恢复；双损坏不返回空 Store  
3. Artifact 与 Store 对账：缺文件 UI 正确；孤儿隔离；同一 resolver  
4. `stable_delivery` 锁定；env 无法开启 advanced  
5. chat 取消全量 memory dump；与 doing 共用 Knowledge Resolver  
6. Electron 中断/重启场景通过；未 push  

## 证据

- 专项：`npm run test:mvp-release-gate-01d`  
- Electron：`npm run test:mvp-release-gate-01d-electron`  
- 目录：`digitalme-app/scripts/_mvp-release-gate-01d-evidence/`  
- 报告：`MVP_RELEASE_GATE_01D_IMPLEMENTATION_REPORT_20260730.md`

## 明确不做（本轮）

做事主界面重构、新成果类型、Capability Fabric、广播协作、正式安装器、首次启动/Package 导入改造、版本历史 UI、富文本、学习抽取质量、用户目标函数、四导航收口、renderer-next、advanced_shadow 启用、第二套任务/成果/知识 Store。
