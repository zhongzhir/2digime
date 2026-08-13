# 记录员协议（不对 Owner 宣读）

- HEAD 锁定 `0dd41e1`；验收期间不提交修复、不切换 head。
- 不代替点击采用；不引导查看 Job / Artifact / JSON / 版本号等内部对象。
- 失败或 Owner 困惑：立即停止，原样记录，不现场掩盖、不绕过。
- 重点观察：Owner 若自行展开「技术证据」，其中是否混有首次轮次文字（例如仍写 start-processing / 无需修改），并是否因此困惑。未展开则不强行打开。
- 重启：同一 userData 再开 `electron/main.cjs`，不新建会话。
- 未得到明确接受前：`ownerAccepted=false`。
