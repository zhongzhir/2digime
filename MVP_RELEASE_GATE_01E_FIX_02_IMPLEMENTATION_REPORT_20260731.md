# MVP-RELEASE-GATE-01E-FIX-02 实施报告

- **日期**：2026-07-31
- **分支**：`codex/mvp-release-gate-01`
- **进入基线**：`e279e38`（ACCEPT-01 环境阻断文档后）
- **修复 commit**：`3d651f0`
- **Push**：否

---

## 1. Git 基线

| 项 | 值 |
|----|-----|
| 分支 | `codex/mvp-release-gate-01` |
| FIX-02 功能 tip | `3d651f085ef1677de64261c49615f4b44a1a7c3b` |
| 旧候选 | `605be75` → `rejected_acceptance_candidate` |

---

## 2. 空 listener 根因与删除内容

| 项 | 说明 |
|----|------|
| 根因 | `bindExtensions()` 对已删除的 `#btn-capability-new-task` 调用 `addEventListener`，抛出 `Cannot read properties of null` |
| 修复 | 删除该死绑定；其余 extensions 按钮改为可选链安全绑定 |
| 正式浮层 | closed-alpha / packaged 下不再把 bind/boot 调试日志写到遮挡界面的 `#ui-boot-log` / `#ui-init-warning`；仍 `console.error` 保留诊断 |
| 原则 | 先修根因，再收敛正式面错误展示 |

---

## 3. 模型连接最终路径

```text
设置 / 连接模型
→ 选择 DeepSeek（推荐）/ OpenAI / 其他兼容服务
→ 同区输入 API Key（可显示/隐藏）
→ 选择模型（DeepSeek 默认 deepseek-chat）
→ 测试连接（真实 API）
→ 保存并开始使用
→ 关闭设置并回到做事（若从 readiness 进入）
```

- 无 Key 时文案为「尚未连接模型」，**不**把 `gpt-4o-mini` 显示为当前已配置默认。
- 一套模型同时写入 chat / artifact / review 路由。
- 多模型分工收入「高级模型设置」折叠区。

---

## 4. Provider 选择

| Provider | 说明 |
|----------|------|
| DeepSeek | 推荐默认；`https://api.deepseek.com/v1`；`deepseek-chat` |
| OpenAI | 可选；有 Key 后才可成为当前连接 |
| 其他兼容服务 | 需填写服务地址 + 模型名 |

---

## 5. Key 存储边界

- 经既有 `saveModelRouting` → `ConfigSecrets` / `SecretStore`
- 密码输入框；保存后清空；不写入 renderer 持久化 / localStorage
- 证据与截图不得包含 Key

---

## 6. 测试连接

- 先写入 routing + Key，再 `testModelRouting`
- 失败用户文案：`无法连接 {服务}。请检查 API Key 或网络后重试。`
- 不向普通用户暴露 HTTP stack / adapter / secret path

---

## 7. 设置页结构（前后）

**前**：首屏「模型与默认」矩阵（对话/成果/质检 + 备用）+ 高级 JSON + 散落 Key。

**后**：

```text
模型连接
  [尚未连接 | 已连接摘要 + 更改]
  [DeepSeek 推荐] [OpenAI] [其他]
  API Key / 模型 / 测试 / 保存并开始使用
高级模型设置（折叠）
其他设置（资料目录等）
```

---

## 8. 版本来源

- portable 读取 `resources/build-info.json` / asar 内 `closed-alpha-build-info.json`
- UI：`Closed Alpha · <shortHash>`；失败时显示语义版本，**从不**显示 `unknown`

---

## 9. 正式 Electron / 自动化

| 项 | 结果 |
|----|------|
| `test:mvp-release-gate-01e-fix-02` | 7 passed |
| `test:mvp-release-gate-01e` | 7 passed |
| 新 portable smoke 启动 | 进程可启动 |

完整「输入真实 Key → 测试成功」需在干净环境由验收人员完成（不写入 Key 证据）。

---

## 10. 新候选

| 项 | 值 |
|----|-----|
| buildId | `20260731-101441-3d651f0` |
| embedded HEAD | `3d651f085ef1677de64261c49615f4b44a1a7c3b` |
| staging | `digitalme-app/dist-alpha-build-staging/20260731-101441-3d651f0/` |
| zip | `Digital-Me-Closed-Alpha-3d651f0.zip` |
| exe SHA256 | `24974A1FE5A5600BBC715F1D7D662E9D4EC4EE65519B906C1D7DC2D200F890CE` |
| asar SHA256 | `C4C04C956D3D6894597F9A709EB039783947246D51BC29B0E8CE9DCEB8B51172` |
| zip SHA256 | `E5C53F199DE1C849B06EC569C19D31D0AFC6185BF52473F39BEAF0947A782ED9` |

---

## 11. 旧 605be75 状态

```text
rejected_acceptance_candidate
```

标记文件：`dist-alpha-build-staging/20260730-143923-605be75/REJECTED_ACCEPTANCE_CANDIDATE.json`  
不得继续复用该 zip 做验收。

---

## 12. ACCEPT-01 是否已重入

**否。** 本轮完成修复与新构建；下一步用 `3d651f0` 候选在干净无 Node 环境先验证：

```text
启动无错误遮挡 → 创建 → 连接 DeepSeek → 保存 → 做事
```

通过后再续 Task A/B。

---

## 13. Gate 状态

```text
implemented /
renderer_startup_error_removed /
first_model_connection_rebuilt /
deepseek_connection_path_validated /
embedded_version_display_validated /
new_closed_alpha_candidate_built /
ready_to_resume_clean_user_acceptance /
not_pushed
```

说明：`deepseek_connection_path_validated` 指 UI/路由/测试契约与自动化；真实 Key 联通以干净环境复验为准。
