# P1-00 拟纳入 Git 的顶层清单（Owner 已确认）

确认日期：2026-07-16

## Owner 确认结论

1. **不纳入** `digital-me-package/`（主体资产仅以工作区外快照为基线）；
2. **排除** 根目录 `.docx` / `.doc`；
3. 快照位置维持：`C:\Users\46554\DigitalMe-baselines\digital-me-package-v0.1-2026-07-16T02-39-48-124Z`。

## 建议纳入

| 顶层 | 说明 |
|---|---|
| `digitalme-app/` | 应用代码（`node_modules` 已忽略） |
| `scripts/` | 工程与基线脚本 |
| `digitalme_*.md` 等规格/审计/日志文档 | 产品与工程文档 |
| `.gitignore`、`digitalme_version.txt`、`digitalme_capability_status_v0.1.md` | 工程基线 |
| `build/reports/` | 脱敏报告（其余 `build/` 已忽略） |
| `.cursor/rules/` 等 | 可按需纳入 |

## 明确排除

| 路径 | 原因 |
|---|---|
| `digital-me-package/` | 含本人蒸馏主体内容 |
| `source-materials/` | 原始私密素材 |
| `/*.docx`、`/*.doc` | 根目录私密/构想文档 |
| `DigitalMe-baselines/`（工作区外） | Package 安全快照 |
| `node_modules/`、密钥、本地配置、诊断全文 | 安全与体积 |

> 远程仓库可在本地首次提交之后再创建；推送前需有 GitHub 空仓库。
