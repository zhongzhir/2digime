# MVP-RELEASE-GATE-01C 实施报告

- **日期**：2026-07-30
- **任务**：`MVP-RELEASE-GATE-01C`
- **性质**：`first_run_main_path_rebuild` / `digital_me_creation_and_import` / `package_state_consolidation` / `model_connection_guidance` / `restart_recovery`
- **Push**：否

---

## 1. Git 信息

| 项 | 值 |
|----|-----|
| 起始分支 | `codex/mvp-release-gate-01` |
| 起始 HEAD | `92a0dd3e382d0ebbb19443876538a398426102e9` |
| 最终分支 | `codex/mvp-release-gate-01` |
| 最终 HEAD | （见 commit 后 `git rev-parse HEAD`） |
| Commit 1 | `feat(onboarding): rebuild first-run Digital Me creation flow` |
| Commit 2 | `feat(package): add safe Digital Me package import and activation` |
| Commit 3 | `test(mvp): validate first-run creation and package import` |
| 工作区 | 既有未跟踪审计/设计稿保留；本轮实现已提交 |
| Push | **未 push** |

---

## 2. 首次启动最终流程

真实界面路径（classic `src/renderer/index.html`）：

```text
干净 userData / 无 packageDir
→ #first-run-overlay 欢迎页
   文案：欢迎使用 Digital Me + 一句话产品说明
   主按钮：创建新的 Digital Me
   次按钮：导入已有 Digital Me
   辅助：稍后设置（本会话可进有限界面；生成仍需主体）
   说明：模型可稍后连接
→ 创建：称呼* + 可选角色描述 → 创建 → 做事 Hub + 提示「你的 Digital Me 已准备好，可以开始一个任务。」
→ 导入：选择文件夹 → 摘要 → 确认为当前 Digital Me → 做事 Hub
```

已有有效 Package 的用户：`needsFirstRunUi=false`，不重复 onboarding。

「添加资料文件」（原 B0）仍表示向已有 Digital Me 添加资料，**不得**称为导入 Digital Me。

---

## 3. 创建 Digital Me

| 项 | 说明 |
|----|------|
| 输入 | 称呼（必填）、一句话角色描述（可选） |
| 统一入口 | `digitalMeLifecycle.createDigitalMePackage` → IPC `digitalMe:createPackage` |
| 权威写入 | `manifest.json`、`identity.json`（含 DID）、`persona.md`、`life/distill-me-identity-facts.json`、`memory/long-term-memory.jsonl`、最小 life/policies/sources |
| Package 路径 | `app.getPath("documents")/Digital Me/<名称>`；不落仓库 / 安装目录 / WPS 历史默认 |
| 任务可读 | distill identity facts + memory 行含名称与角色说明 |
| 模型依赖 | **无**（`modelRequired: false`）；API Key 无效不阻断创建 |

---

## 4. 导入 Digital Me

| 项 | 说明 |
|----|------|
| 选择 | main `dialog.showOpenDialog`（目录）；preload `selectDigitalMePackage` |
| 校验 | `inspectImportCandidate`：manifest 可读、区分 `valid` / `repairable` / `invalid` / `ordinary_folder` |
| 激活 | `digitalMe:activateImportedPackage`：检查 → 可选安全修复 → 写 `packageDir` → 验证 FirstRunState → 失败回滚 |
| 策略 | **引用原位置**（`copied: false`）；不静默复制 |
| 原 Package | 对新建最小 Package，激活+首次 load 后内容哈希不变（create 已对齐 life scaffold，避免 load 再改写） |

用户面错误示例：

- 普通资料夹：这个文件夹不是可识别的 Digital Me。…
- 损坏：暂时无法导入这个 Digital Me。原有 Digital Me 和文件没有被修改。

---

## 5. 状态统一

`FirstRunState` 由 `computeFirstRunState({ packageDir })` **派生**（无新 Store / 无 `first-run.json`）：

| 状态 | 判断依据 |
|------|----------|
| `no_current_package` | 配置无 packageDir |
| `package_invalid` | 路径不存在、无/坏 manifest、阻塞级问题 |
| `package_repairable` | manifest+主体可读，仅缺可再生目录/字段 |
| `package_ready` | manifest + identity 可用，无阻塞问题 |
| `package_initializing` | 保留枚举；本轮不引入第二持久标志，由进程内创建事务覆盖 |

`needsFirstRunUi` = `no_current_package` 或 `package_invalid`。

禁止：UI 显示已建立但无 manifest；打开应用静默建 identity（`subject:getIdentity` 改为只读）。

---

## 6. 模型连接

| 项 | 说明 |
|----|------|
| 创建依赖 | 无 |
| 未连接 UI | `#dm-readiness-strip`：「Digital Me 已准备好。连接模型后即可生成成果。」→「连接模型」打开设置 |
| 未建立 | 「先创建或导入你的 Digital Me」→「开始设置」 |
| 密钥 | 仍经现有 ConfigSecrets / SecretStore；不入 renderer 持久化；失败不影响已建 Package |
| 不做 | 多模型路由、Reviewer、advanced pipeline 进入首启 |

---

## 7. 安装或分发

**采用方案 B：`distributable_runtime_ready`**

理由：正式 electron-builder 安装器本轮风险高于收益；当前可重复路径为：

```text
digitalme-app/（含 node_modules + Electron）
→ npm start / electron .
→ classic renderer
→ userData 与 Package（Documents）分离
```

- 不依赖 Git 检出以外的手工仓库路径作为默认 Package  
- 不宣称 `formal_windows_installer_validated`  
- 卸载应用不删除用户 Documents 下 Digital Me Package（Package 不在 app 目录）

验证：隔离临时 userData 的 Electron 专项 + classic DOM 测试。

---

## 8. 测试结果

| 命令 | 结果 |
|------|------|
| `npm run test:mvp-release-gate-01c` | 14 passed |
| `npm run test:mvp-release-gate-01c-electron` | ok；证据目录见下 |
| `test:task-ux-min-01` | pass |
| `test:dvl2-01-planner` | pass |
| `test:dvl2-02-package` | pass |
| `test:dvl2-03-generation` | pass |
| `test:dvl2-03-one-click` | pass |
| `test:crt-mvp-02`（含回归链） | pass（修正 dvl2-05 过时「开始新研究」断言） |
| `test:crt-mvp-02.2` | pass |
| `test:learn-loop-fix-02` / `02.1` | pass |
| `test:idcollab-min-01` | pass |
| `test:global-renderer-responsiveness-01` | pass |
| `test:classic-renderer-dom` | pass |
| `test:task-quality-stabilize-01` | pass |
| `test:artifact-open-acceptance` | pass（原生 File 菜单临时兜底仍可用） |

证据根目录：`digitalme-app/scripts/_mvp-release-gate-01c-evidence/`

代表跑次：`2026-07-30T04-20-45-472Z`（截图 01–08、summary.json、import-hash-compare.json）及 `node-*` 机器可读清单。

---

## 9. 复杂度报告

```text
新增永久字段：0
停止写入字段：无（DEFAULT_PACKAGE_DIR 改为空字符串，停止默认落仓库 Package）
新增 Store：0
删除 Store：0
新增 IPC：digitalMe:getFirstRunState / createPackage / selectImportDirectory / inspectImportCandidate / activateImportedPackage
删除 IPC：0（本轮）
新增 listener / handler：上述 5 个 handle
删除 listener / handler：0
新增 DOM：#first-run-overlay 及创建/导入面板；#dm-readiness-strip；#do-hub-first-run-msg
删除 DOM：无（B0 文案改为「添加资料文件」）
代码行净变化：约 +1100 / −30（含 lifecycle ~500、测试 ~600、main/renderer 增量）
是否新增第二事实源：否
默认 Package 是否脱离仓库：是（Documents\Digital Me\…）
```

---

## 10. 未处理事项

| 归入 | 事项 |
|------|------|
| 01D | 任务/知识统一调用、稳定成果生成、数据安全（interrupt heal、`.bak`、file-before-store 等） |
| 01E | 成果访问用户入口重建、接受回流、最终主路径 UX / 四导航 |
| 后续 Alpha | 正式 Windows 安装器、多 Package 管理、复制到默认目录选项 UI、广播/协作/结算 |

---

## 11. 状态建议

```text
implemented /
first_run_main_path_rebuilt /
digital_me_creation_validated /
digital_me_package_import_validated /
package_state_consolidated /
model_connection_guidance_added /
restart_recovery_validated /
formal_classic_runtime_validated /
distributable_runtime_ready /
ready_for_mvp_release_gate_01d /
not_pushed
```

不得标记：`mvp_ready` / `closed_alpha_ready` / `owner_runtime_accepted` / `full_subject_growth_validated` / `formal_windows_installer_validated`。
