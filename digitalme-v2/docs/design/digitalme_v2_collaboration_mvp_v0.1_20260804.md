# Digital Me V2 — Collaboration MVP（同机双主体）

- **文档编号**：`DIGITALME-V2-COLLABORATION-MVP-01`
- **版本**：v0.1（2026-08-04）
- **基线**：`v2/foundation` @ `d38fbf6`
- **状态**：`collaboration_mvp_validated` / `ready_for_commit_and_owner_path_review`
- **关联**：`DIGITALME-V2-COLLABORATION-REAL-CAPABILITY-VALIDATION-01`
- **不做**：主体市场、公网/P2P、消息系统、支付、信誉、群组、实时聊天、主导航「协作」入口恢复

---

## 1. 用户场景

同机双 SubjectPackage：

1. A 在做事中创建主任务并添加材料  
2. 选择「交给另一个数字之我」→ 选 B 的包目录 → 填子任务 → 勾选可共享材料  
3. 确认授权（AuthorizationGrant）  
4. 执行：B 仅用授权材料生成子成果  
5. A 查看返回成果 → 采用 / 不采用  
6. A 撤销授权 → B 再执行被领域层拒绝  

主导航不恢复「协作」；成功验收后由下一切片恢复一级入口。

---

## 2. 授权边界

| 允许 | 禁止 |
|------|------|
| 子任务要求 | 完整 GrowthEvent / 全部资料 |
| 明确选中的材料路径 | 对话历史、其他任务、未授权 Artifact |
| `read_authorized_context` / `execute_subtask` / `return_artifact` | `read_full_subject`、改 A 主体/任务、二次转授、部署推送 |
| 最小化、可查看、可撤销、重启恢复 | 共享完整 SubjectPackage、复制凭证/密钥 |

---

## 3. 对象映射

| 对象 | 角色 |
|------|------|
| SubjectPackage A/B | 两个独立包；进程内双 `DigitalMeRuntime` |
| AuthorizationGrant（#8） | 唯一新增持久对象；落盘 `collaboration/grants/` |
| Task / ExecutionJob | B 子任务复用既有五态机 |
| ContextSnapshot.authorization | 记录 grantId 与披露范围 |
| Artifact | 属于 B；返回摘录给 A，不覆盖 A 主成果 |
| GrowthEvent | A：`collab:external_accept/reject`；B：`collab:fulfilled` |
| CommandBus | 升级 `collab.simulateInteraction`（action 分派），仍 20 条 |

不建：Collaboration/Message/Reputation Store、Delegation 状态机、第二套 Task/Job。

---

## 4. 数据流

```text
A.issue(Grant) → 持久化于 A 包
A.execute(grantId) → 校验 Grant → 打开 B Runtime
  → B.submitTask(仅授权材料 + authorization 溯源)
  → Job → Artifact → Grant.disclosure / returnedArtifact
  → B GrowthEvent(collab:fulfilled)
A.acceptReturn → A GrowthEvent + 材料受控副本
A.revoke → Grant.status=revoked → 再 execute 拒绝
```

用户面状态（requested/authorized/running/completed/rejected/revoked/failed）由 Grant + 执行结果**派生**。

---

## 5. Artifact 来源与整合

- B Artifact 含 subjectId / taskId / jobId / version  
- Grant 保存返回摘录与来源  
- A 采用时写入资料副本与独立 GrowthEvent，**不**覆盖主 Artifact  
- A 可继续手工整合进主成果（本轮不强制自动合并正文）

---

## 6. 撤销语义

- 领域层检查 `status !== granted`  
- 已返回 Artifact 保留  
- 新执行与未授权材料读取拒绝  
- 不删除历史 Grant / 事件  

---

## 7. GrowthEvent 分工

| 主体 | 时机 | 标签要点 |
|------|------|----------|
| B | 子任务成功 | `collab:fulfilled` |
| A | 采用返回 | `collab:external_accept` |
| A | 不采用返回 | `collab:external_reject` |

事件 id / 标题 / 详情均不同，不得共用。

---

## 8. 验收

```text
npm run accept:collaboration-mvp   # 领域闭环（可用 Fake）
npm run accept:collaboration-real  # 真实模型单样本（禁止 Fake 冒充）
```

领域覆盖：正常协作、未授权材料隔离、撤销再拒、失败不写 `collab:fulfilled`、采用后主成果引用区。  
真实样本另证：`reachedModel=true`、内容与授权材料相关、不含未授权特有内容。

真实验证通过后，本文状态升为：  
`collaboration_mvp_validated` / `ready_for_commit_and_owner_path_review`

---

## 9. 已知后置项

- 恢复主导航「协作」一级入口（须 Owner 主路径确认）  
- 不采用作为更细负面注入  
- 远程主体 / P2P / 市场  
- 主成果合并协作段落的产品化编辑体验  
