# 上轮正式 AppData 写入清单（只读，不删除、不回滚）

**轮次：** DIGITALME-DOMESTIC-BASELINE-STABILIZATION-01  
**诊断基线：** `55b1d2889cc72e9eb7d18fe379fc88e2fde499ec`  
**本轮约束：** 不得再操作 Owner 正式 AppData；本文件只记录已发生写入。

## 正式目录位置

`C:\Users\46554\AppData\Roaming\digitalme-v2`

本轮只做根目录确认与桌面产物确认，不再深入改写或清理。

## 已确认仍在的上轮产物

| 路径 | 最后写入 | 说明 |
|---|---|---|
| `C:\Users\46554\AppData\Roaming\digitalme-v2\` | 目录仍在 | 正式 userData；`subjects\default` 于 2026-10-03 09:11 有更新 |
| `C:\Users\46554\Desktop\2digime稿件-叙事认同的让渡.txt` | 2026-10-03 09:11:54 | 上轮官方窗口材料委托的错误交付；保留 |
| `C:\Users\46554\Desktop\2digime稿件-叙事认同的让渡.docx` | 2026-09-30 17:07:00 | 既有桌面文稿，不是本轮新建 |
| `C:\Users\46554\Desktop\2digime稿件-作者权的让渡.docx` | 2026-09-30 16:47:41 | 既有桌面文稿，不是本轮新建 |
| `C:\Users\46554\Desktop\叙事认同的让渡-修订说明.md` | 2026-09-30 17:06:32 | 既有桌面文稿，不是本轮新建 |

## 上轮 PARITY-12 已记录、本轮不再打开核验的主体内文件

这些路径来自上轮证据，不是本轮新写入。本轮不再进入正式主体目录核对或改动：

- `subjects/default/materials/999e2e5b6fdd8591_parity-12-material.txt`
- `subjects/default/material-index.json`
- `subjects/default/intelligence/threads/conv_munuzu6512aeca29.json`（会话 id 以上轮记录为准）
- `subjects/default/content/network-items` 及相关内容缓存
- `subjects/default/content/later-items.json`
- `subjects/default/derived/*.json`
- `subjects/default` 个人 Feed 缓存

## 处理

- 全部保留。
- 不删除、不回滚、不覆盖。
- 本轮验收只使用干净隔离的 `DIGITALME_V2_USER_DATA` + `HOME`。
