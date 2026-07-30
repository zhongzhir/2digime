# MVP-RELEASE-GATE-01E 实施报告

- **日期**：2026-07-30
- **任务**：`MVP-RELEASE-GATE-01E`
- **Push**：否

---

## 1. Git 基线校正

| 项 | 值 |
|----|-----|
| 进入 01E 前 tip | `ff17e80`（docs：澄清 01D feature tip vs report tip） |
| 01E 最终 tip | 见文末 commit 链（docs 提交为本报告） |
| 分支 | `codex/mvp-release-gate-01` |

**`3924b05` 与 `8c85f3e` 关系（已校正并单独 commit）：**

| Commit | 角色 |
|--------|------|
| `8c85f3e` | 01D **功能/测试/证据收口** |
| `3924b05` | 01D **报告文档校正**（`8c85f3e` 的直接后代） |
| `ff17e80` | 再次澄清二者关系，消除「最终 HEAD」歧义 |

二者无分叉；`8c85f3e` 是祖先，`3924b05`/`ff17e80` 为文档后继。工作区仅有历史未跟踪审计/设计稿；stash 未动。

---

## 2. 学习来源

| 项 | 说明 |
|----|------|
| 权威 source | 被采用的当前 `DeliverableVersion`（`collectSourceFromVersion`） |
| revisionGuidance | 写入 GenerationAttempt；学习时优先抽取为偏好/修正 |
| 初稿 vs 终稿 | `supersedesVersionId` 基线正文参与有界 diff（标题/篇幅/分点） |
| 一次性内容 | ONE_OFF / 临时活动类跳过长期写入 |
| 接受通知 | 「本人接受了某版本」改为 audit-only，不再作为可复用 episodic |
| 项目/主体 | 修正 → project `current_fact`（可 supersede）；表达偏好 → memory `expression_preference` |
| 模型失败 | Accept 保留；规则抽取仍可提交；不阻断主路径 |

---

## 3. 否定与纠正

| 项 | 说明 |
|----|------|
| reject | `suppressRejectedVersion`：撤销该 version 来源的 memory/claims；禁止再 enqueue learn |
| Resolver | 跳过 `revoked` / `deliverable_version_rejected`；过滤「本人接受了」噪声 |
| chat/doing | 共用 Knowledge Resolver + SCE memory 过滤 |

---

## 4. 跨任务验证（剧本）

| 剧本 | 自动化结果 |
|------|------------|
| A 公众号偏好 | 单元：guidance + diff 产生偏好；跨任务 assemble 可召回偏好文案 |
| B 项目事实纠正 | 单元：修正写入 memory/claim；Resolver 可见「尚未进入正式验证」 |
| C 否定抑制 | 单元：reject 后不可再学；UNIQUE_BAD 不进入 assemble |

完整真实模型 Electron 双任务截图链：本轮未齐（见阻断 2）。

---

## 5. 分发

| 项 | 说明 |
|----|------|
| 工具 | `electron-builder@25.1.8` + wrapper `build-closed-alpha-portable.cjs` |
| 命令 | `npm run dist:portable`（**禁止**用旧目录存在性判断成功） |
| 产出 | `dist-alpha-build-staging/<build-id>/win-unpacked/` + `Digital-Me-Closed-Alpha-<short>.zip` |
| 形态 | **portable_closed_alpha_build（目录型）** |
| 签名 | `unsigned_closed_alpha_build`；SmartScreen 可能提示 |
| 旧目录 | `dist-alpha-build/` 已 `SUPERSEDED`；旧 zip `B105D6…` 非候选 |
| 证据 | `_mvp-release-gate-01e-evidence/build-manifest.json` + §12 |
| 使用说明 | `docs/product/CLOSED_ALPHA_USAGE_AND_LIMITS_20260730.md` |

用户不需 Node/Git/`npm start`：解压/复制 staging 的 `win-unpacked` 后双击 `Digital Me.exe`。

---

## 6. 陌生用户验收

| 项 | 状态 |
|----|------|
| 开发机自动化 | `test:mvp-release-gate-01e` 7 passed |
| Electron 导航烟测 | PASS（主导航：对话 / 做事 / 我的 Digital Me） |
| 干净无 Node VM 全路径 | **未完成留证** |
| 求助/阻断记录 | 待 Owner 抽查环境 |

---

## 7. 回归抽样

| 套件 | 结果 |
|------|------|
| test-mvp-release-gate-01e | 7 passed |
| test-mvp-release-gate-01e-electron | PASS |
| test-dvl2-04-auto-learn | 6 passed（适配 audit-only episodic） |
| test-learn-loop-fix-02 | 8 passed |
| 01D heal/store（既有） | 保留 |

---

## 8. 复杂度

```text
新增永久字段：0（revisionGuidance 落在既有 GenerationAttempt；未新增 Store）
新增 Store：0
新增 IPC：0
新增学习事实源：0（复用 memory + project claims）
新增打包依赖：electron-builder
代码行净变化：学习抽取/抑制 + 导航 + 打包配置 + 01E 测试
是否产生第二知识源：否
是否启用 advanced：否
```

---

## 9. 已知限制

1. 未签名构建；SmartScreen 可能拦截  
2. 单文件安装器本轮未产出  
3. 学习仍以规则抽取为主（模型增强可选且失败可退化）  
4. 导航「身份与协作 / 能力」收入「我的 Digital Me」入口，未删除底层页  
5. 完整干净机器双任务 E2E 与 Owner 抽查未完成  

---

## 10. Gate 决策

**有条件通过：**

```text
implemented /
release_gate_conditionally_passed /
closed_alpha_blockers_remaining /
not_ready_for_owner_spotcheck /
not_pushed
```

剩余阻断（恰好 2）：

1. 干净用户环境完整双任务 E2E 证据未齐  
2. Owner 最终抽查未执行  

> 分发「旧产物误报成功 / EBUSY 覆盖失败」阻断已由 **01E-FIX-01** 关闭（见 §12）。单文件 NSIS 仍非本轮目标；目录型 portable 为正式候选形态。

不得标记：`release_gate_passed` / `mvp_ready` / `closed_alpha_ready`（无条件） / `owner_runtime_accepted`

---

## 11. Commit 链（01E）

```text
0c13286 fix(learning): learn from accepted revisions and suppress rejected outputs
ebfe9b5 test(learning): validate cross-task reuse and project fact correction
b9a5d60 build(desktop): add closed alpha Windows distribution
b231f66 test(release): validate clean-user MVP release gate
e12c462 docs(release): record closed alpha readiness decision
(+ docs tip 校正)
(+ 01E-FIX-01 build integrity)
```

| 项 | 值 |
|----|-----|
| 01E 功能/测试 tip | `b231f66` |
| 文档 tip | 以 `git rev-parse HEAD` 为准（**未 push**） |

避免在报告正文内嵌「自身 commit hash」造成与 tip 再次冲突（与 01D `8c85f3e` / `3924b05` 教训一致）。

---

## 12. Build Integrity Correction（MVP-RELEASE-GATE-01E-FIX-01）

### 原误报根因

1. `electron-builder` 因 `Digital Me.exe` / `app.asar` **EBUSY** 失败后，脚本仍用 `Test-Path` 旧目录判定成功。  
2. 失败后继续读旧 zip SHA256（`B105D6…`）并暗示可用。  
3. 构建输出固定覆盖 `dist-alpha-build/`，与占用锁冲突。

### 修复方式

- `npm run dist:portable` → `scripts/build-closed-alpha-portable.cjs`  
- 每次写入独立 `dist-alpha-build-staging/<yyyyMMdd-HHmmss>-<gitShort>/`  
- 嵌入 `resources/build-info.json` + asar 内 `closed-alpha-build-info.json`（`gitHead` / `buildTime` / `productSurface=classic` / `releaseChannel=closed-alpha`）  
- 仅当 builder=0、zip=0、文件 mtime≥构建开始、embedded HEAD 匹配、zip 含 exe、manifest 写出后才打印 `BUILD_OK`；否则 `BUILD_FAILED` 且非零退出  
- `test:closed-alpha-build-integrity`（10 passed）覆盖旧产物误报路径  
- 旧 `dist-alpha-build` 标记 `SUPERSEDED.json`（`superseded=true`）；旧 zip 移入 `_superseded/`

### 当前候选产物（构建时 HEAD = FIX-01 commit tip）

| 项 | 值 |
|----|-----|
| 构建时 Git HEAD | `605be754664a30076ed041e7e4d1d956a70d45f8` |
| buildId | `20260730-143923-605be75` |
| staging | `digitalme-app/dist-alpha-build-staging/20260730-143923-605be75/` |
| exe SHA256 | `AAC46E8F0E517C02E7244EB82AC5E21D1C1D60B7DBD8C5A756248CB8927720A1` |
| asar SHA256 | `B23B2BF2BF24605E0D92EA548343041D765D5FEE84863A4600BB7FF7B5DD8038` |
| zip SHA256 | `E335300C489F18B2A2983FDB9536D95459784BC3132AECA73904AB5E2D414EDF` |
| zip 名 | `Digital-Me-Closed-Alpha-605be75.zip` |
| 旧产物 | `dist-alpha-build/SUPERSEDED.json`；旧 `B105D6…` **不是**候选 |
| 独立启动 | 已 smoke：进程可启动；embeddedGitHead === `605be75…` |
| EBUSY | 本轮 staging 构建成功，无 EBUSY |
| Push | **否** |
| FIX-01 commit | `605be75` |


