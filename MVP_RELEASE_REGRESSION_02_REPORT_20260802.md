# MVP-RELEASE-REGRESSION-02 · 发布主路径回归报告

- **状态**：`release_main_path_validated` / `create_and_import_paths_passed` / `restart_recovery_validated` / `accepted_as_engineered` / `not_pushed`
- **日期**：2026-08-02
- **基线**：`bd6f0316944895ba2b2d3b52cf21c61e347061a9` @ `codex/mvp-release-gate-01`（parent `40cf0bf47238a6df4a85cba84597b0960e4bf660`）
- **范围**：发布主路径回归与必要 harness 修复；**无**新产品能力；**未**重建 portable；**未** push

## 一、基线核对

| 项 | 结果 |
|---|---|
| 分支 | `codex/mvp-release-gate-01` |
| HEAD | `bd6f0316944895ba2b2d3b52cf21c61e347061a9` |
| parent | `40cf0bf47238a6df4a85cba84597b0960e4bf660` |
| 既有未跟踪文件 | 保留，未清理 |

## 二、创建路径 A

| 项 | 结果 |
|---|---|
| 隔离 store | 全新临时 userData（任务/包 Store 隔离；模型走应用 SecretStore） |
| 创建 Digital Me | 通过（`createDigitalMePackage`） |
| 真实任务 | 800–1100 字产品进展说明（文件 + 文件夹材料） |
| 模型 | `deepseek-v4-flash` / `app_secret_store_model_routing` |
| 生成 / 打开成果 | `generationOk`；`open.ok`；约 4252 bytes |
| 采用 | `reviewStatus=accepted` |
| 学习回流 | enqueue 成功；状态 `pending_conflict`（采用态保留） |
| 中断治愈 | 伪造 `generating` attempt → heal 后 `ready`；采用保留 |
| 软重启恢复 | 任务 / 采用 / 包目录 / 成果文件一致 |
| evidence | `path-A-2026-08-02T10-24-51-829Z`（本地，不入库） |

## 三、导入路径 B

| 项 | 结果 |
|---|---|
| 隔离 store | 全新临时 userData |
| 导入 Digital Me | 通过（`inspectImportCandidate` → 引用激活，`copied: false`） |
| 文件夹上下文 | `docs/design` 文件夹材料 + 质量验证报告文件 |
| 真实任务 | 700–1000 字工作备忘（回归核对清单） |
| 模型 | 同上 SecretStore |
| 生成 / 打开成果 | `generationOk`；`open.ok`；约 2434 bytes |
| 采用 | `accepted` |
| 学习回流 | `committed`（`cs_msbo3kd2_34959bde`） |
| 中断治愈 / 重启 | 同 A，通过 |
| evidence | `path-B-2026-08-02T10-34-21-441Z`（本地，不入库） |

## 四、真实任务与模型

- **路径 A 目标**：产品进展说明（背景 / 当前能力 / 工作方式 / 明确边界 / 下一步）
- **路径 B 目标**：发布回归工作备忘（回归目的 / 核对清单 / 风险关注 / 明确边界 / 建议动作）
- **材料**：仓库真实文档与设计目录，非极简写死样例
- **模型调用**：应用内已连接模型（SecretStore）；环境变量 API Key 与假模型开关已剥离

## 五、成果访问 / 采用与学习 / 重启

| 门槛 | A | B |
|---|---|---|
| 成果可打开 | 是 | 是 |
| 页内成果可读（落盘正文） | 是 | 是 |
| 无内部评估提示泄漏 | `residueFree` | `residueFree` |
| 采用成功 | 是 | 是 |
| 学习回流 | enqueue 成功 | committed |
| 重启后状态一致 | 是 | 是 |
| 无永久 generating | heal → ready | heal → ready |

说明：质量环在预算内完成定向修正；本任务验收的是**发布主路径可用性**，不宣称单次文档 `pass` 或优越于普通模型。

## 六、性能与 UI 阻断

- Electron harness 路径：未见阻断性遮挡导致主路径失败
- 按钮迟滞 / 页面抖动：本 harness 为无头主路径，未发现因 Store 锁或重复生成导致的流程阻断
- 无重复生成 / 重复落盘断言通过

## 七、修复内容（本任务）

均为**回归 harness**，无产品 Store / IPC / 知识源增量：

1. SecretStore 解密绑定正式应用 `userData`；任务/包 Store 使用隔离目录（避免错误克隆密钥导致 `secret_decrypt_failed`）
2. 学习回流断言接受合法终态（含 `pending_conflict`），前提是采用态保留且 enqueue 成功
3. 中断治愈种子写入 `generationAttempts.status=generating`（与生产 heal 契约一致），再断言启动恢复

## 八、测试结果

| 套件 | 结果 |
|---|---|
| Path A electron | PASS |
| Path B electron | PASS |
| mvp-release-gate-01c | 14 passed |
| mvp-release-gate-01d | 16 passed |
| mvp-quality-evaluation-01 | 11 passed |
| task-quality-stabilize-01 | 12 passed |
| task-quality-loop-01 | 13 passed |
| task-quality-loop-01-1-grounding | 19 passed |
| mvp-learning-quality-01 | ok |
| mvp-quality-product-validation-01-unit | 8 passed |

## 九、Store / IPC / 知识源增量

**0 / 0 / 0**

## 十、发布建议

| 项 | 建议 |
|---|---|
| 重建 portable | **建议**（本任务验证已通过；重建不在本任务执行） |
| Owner 最终安装验收 | **建议**（安装包主路径手测：创建/导入 → 做事 → 采用 → 重启） |
| push | **否** |
| 宣称 `closed_alpha_ready` / `mvp_ready` | **否** |

## 十一、运行方式

```powershell
Set-Location "D:\Projects\Digital Me\digitalme-app"
# 单路径
$env:DIGITALME_REGRESSION_PATH='A'; npm run test:mvp-release-regression-02-path
$env:DIGITALME_REGRESSION_PATH='B'; npm run test:mvp-release-regression-02-path
# 编排（含 A+B+专项；真实模型，耗时长）
npm run test:mvp-release-regression-02
```
