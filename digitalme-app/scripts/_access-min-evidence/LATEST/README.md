# ARTIFACT-ACCESS-MIN-01 开发侧文件菜单验收证据

状态：`developer_runtime_accepted`（本目录为操作证据包）

## 如何复现

```powershell
cd digitalme-app
node scripts/run-artifact-access-min-file-menu-acceptance.cjs
```

正式入口等价于 `electron .`（同 `npm start`），使用 Owner 默认 `userData`；用 **OS SendInput 真实鼠标** 点击原生「文件」菜单项（非 DOM `.click()` / 非直接调 handler）。

## 本包内容（LATEST）

| 文件 | 说明 |
|------|------|
| `summary.json` | 总结果；`ok: true` |
| `01-prepare.json` | 正式页已加载；`openButtonCount: 0`；已同步 task/package |
| `shot-00-top-strip.png` | Digital Me 窗口顶栏与「文件」菜单 |
| `shot-01-file-dropdown.png` | 「文件」下拉含「打开当前成果」「打开成果所在文件夹」 |
| `shot-03-file-dropdown-2.png` | 第二次打开「文件」菜单（打开所在文件夹前） |
| `mouse-summary.json` | 点击坐标与 OS 鼠标记录 |

## 验收结论

1. 正式窗口可见原生「文件」菜单；  
2. OS 鼠标展开后可见「打开当前成果」「打开成果所在文件夹」；  
3. 两项均已点击；重启后再跑同一脚本仍 `ok: true`；  
4. 成果卡无「打开成果」按钮。
