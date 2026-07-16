# PackageStore 提交与恢复策略（Windows + WPS 云盘）

## 结论

采用**同卷旁路完整副本 + 持久 journal + 两步目录改名**，不使用「逐文件覆盖当前 Package」冒充原子提交。

## 布局

Package 根目录旁建立店铺（不计入内容根摘要）：

```text
<parent>/
  <packageName>/                 # 当前可读 Package（live）
  .digitalme-pkgstore/
    <packageName>/
      lock.json
      journal.json
      changesets/
      snapshots/v<revision>/
      staging/                   # 完整候选副本
      swap-backup/               # 切换瞬间的旧 live
```

## 提交顺序

1. 获取单写者锁（`open("wx")` + 不可预测 `operationToken`；actor 仅逻辑身份；同 actor 第二进程亦阻断；stale 仅租约过期且 PID 死亡后原子 rename 接管）；
2. 重新计算当前 revision/hash，与 change set 的 base 比对；
3. 生成当前版本不可变快照（写入 `.publishing-vN-<token>`，校验后再 rename 为 `vN`；禁止先删已有 vN）；
4. 写入恢复 journal（含 `expectedRootSha256`、`backupRootSha256`、`revisionBefore/After`）；
5. 在同一卷的 staging 中构建完整候选版本；
6. 校验 JSON/JSONL、schema、受影响路径、symlink/reparse、manifest 和内容摘要（遍历失败一律抛错）；
7. manifest 最后生成（changeset 不得直接写 manifest.json）；
8. 使用可证明的安全切换策略提交；
9. 提交后重新打开并校验；
10. 清理 staging，释放锁（仅匹配 operationToken）；
11. 任一步失败，按 journal 哈希矩阵恢复到唯一明确旧版；无法唯一判定则 `recover_ambiguous` 并保留证据。

## 锁与恢复要点

- **锁所有权文件 `lock.json`**：`open("wx")` 创建后，在整个持锁期内**不得** rename/unlink/replace；heartbeat 只写 `lock-heartbeats/hb-*.json` 旁路记录。
- **过期**：仅当持有者 PID 已死亡才可原子 rename 接管；不会因超过固定 5 分钟而抢走活动进程。
- **journal**：`journals/journal-NNNNNNNNNN.json` 单调 generation；每次 phase 写 publishing 再 rename 发布；崩溃时上一完整 generation 仍可读；recover 会提升完整但未 rename 的 publishing。
- **无 journal**：live+backup 同时存在 → `recover_ambiguous`（不得 noop）；仅唯一且通过摘要/revision 校验的候选可自动恢复。
- **元数据写**（changeset 等）：目标存在时 bak→rename 替换；失败还原 bak；禁止删旧后 copyFile。
- **随机 bak/tmp**：recover/成功清理路径会识别并清理，不得当作 harmless 遗留。


## 为何可证明安全（及边界）

| 能力 | 证明方式 |
|---|---|
| 崩溃不丢旧版 | journal 记录 phase；`recover()` 在 `swapping` 且 backup 存在时改回 live |
| 半写不落 live | 变更只发生在 staging；成功前不改名覆盖 live 内文件 |
| 并发单写者 | lock.json + pid/心跳；第二写者失败 |
| 同卷改名 | staging/backup 与 live 同父目录，避免跨卷 copy 假原子 |

**WPS 云盘边界（如实说明）**：云同步可能在两步 rename 之间观察到短暂「目录缺失」或延迟同步。本实现保证**本机进程崩溃后可恢复到明确版本**；不能证明远端同步副本在切换窗口内永远一致。建议正式主体 Package 放在本地磁盘，云同步在提交完成后进行。若未来无法接受该边界，应改为本地内容寻址版本库 + 导出，而不是退回逐文件覆盖。

## 明确不做

- 不把多文件顺序 `writeFile` 当前 Package 标为原子提交
- 不把版本库、staging、journal 计入内容根摘要
- 不在读取真实 Package 时自动执行 v0.1→v0.2 迁移
