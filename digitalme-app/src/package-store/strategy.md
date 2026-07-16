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

1. 获取单写者锁（含 stale 判定）
2. 重算 live 的 revision / 内容根摘要，与 change set 的 base 比对
3. 将 live 完整复制为不可变快照 `snapshots/vN`
4. 写入 journal：`phase=staging`
5. 在同卷 `staging/` 构建完整候选（复制 live → 应用 ops → 写 manifest）
6. 校验 JSON/JSONL、路径、manifest、摘要
7. journal：`phase=swapping`（记录 live / staging / backup 路径）
8. `rename(live → swap-backup)`，再 `rename(staging → live)`
9. 重新打开 live 并校验；journal：`phase=committed`
10. 清理 staging 残留、释放锁

任一步失败：按 journal 恢复到**唯一明确**的旧版本（优先 `swap-backup`，否则快照），不静默挑选不明版本。

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
