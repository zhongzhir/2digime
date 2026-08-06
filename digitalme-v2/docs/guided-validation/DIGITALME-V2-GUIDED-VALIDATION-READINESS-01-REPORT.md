# DIGITALME-V2-GUIDED-VALIDATION-READINESS-01 报告

**日期**：2026-08-06  
**基线**：`v2/foundation` @ `f6bb56dd0f24a529cf4e6a43c366997287ca1d38`（未 push）  
**目标状态**：`ready_for_2_to_5_user_guided_validation`  
**结论**：**达到**（仅引导验证就绪；**不宣称** MVP ready / closed alpha / production ready）

## 改动范围

| 区域 | 文件 |
|------|------|
| 外部能力诚实状态 | `electron/bootstrap-remote-capability.cjs`, `electron/main.cjs` |
| 首启模型引导 / 禁止自动读开发凭证 | `electron/renderer/index.html`, `app.js`, `main.cjs`（`DIGITALME_V2_ALLOW_DEV_CREDENTIAL=1` 才允许开发凭证） |
| 协作实验标签与专业能力归设置 | `index.html`, `styles.css`, `app.js` |
| 结果检查不再虚标通过 | `index.html`, `app.js`（`renderExternalCapCheckStatus`） |
| 协作履行中断恢复 | `src/collaboration/record-derive.ts`, `local-collaboration.ts` + 单测 |
| 引导脚本 / 验收 | `docs/guided-validation/DIGITALME-V2-GUIDED-VALIDATION-SCRIPT-01.md`, `scripts/run-guided-validation-readiness-acceptance.cjs`, `scripts/probe-guided-fresh-env-first-boot.cjs` |

既有脏文件未纳入本任务合入范围。

## 新环境首启证据

见 `digitalme-v2/scripts/_guided-validation-readiness-evidence/fresh-env-first-boot.json`：

- Owner 开发机凭证文件存在时，`allowDevRuntimeFile: false` → **不**自动可用，`needsCredentialSetup: true`
- 类打包路径同样要求用户配置
- 欢迎页强制：介绍 → 连接模型（可明确跳过并提示「可以先浏览，但对话和做事需要连接模型」）→ 开始使用

## 协作恢复证据

- 单测：`fulfillment interrupt without job ref recovers to failed; retry succeeds`（`local-collaboration.test.ts`）
- 派生：`delivered` 无 delivery 且失败 note → `failed`，不再卡在 `running`
- `reconcile` 调用 `recoverInFlightFulfillment`：补 Job 对账、失败可重试、成功未物化则补交付；无持续轮询；重复 fulfill/交付幂等

证据输出：`scripts/_guided-validation-readiness-evidence/unit-output.txt`、`summary.json`

## 产品诚实性对照

| 要求 | 结果 |
|------|------|
| 协作保留入口，标实验；仅本机另一 Digital Me；不宣称跨设备/公网 | 已做 |
| 固定研究 Agent 不作为主体协作展示；归设置；无验证不得「可用」 | 已做（状态：未配置 / 已配置，尚未验证 / 可用 / 暂时无法连接） |
| 删除固定「检查状态：已通过」 | 已做（仅真实 selfCheck 才显示） |

## 分发包信息

| 项 | 值 |
|----|-----|
| buildId | `v2-20260806T085853Z-f6bb56dd` |
| staging | `digitalme-v2/release-staging/v2-20260806T085853Z-f6bb56dd` |
| ZIP | `DigitalMeV2-0.1.0-win-x64.zip` sha256 `09be8aac6b5b0e312831e7c5adea785e6fb7ab208f3d89ea06702f402a90c55c` |
| EXE | `win-unpacked/DigitalMeV2.exe` |
| 说明 | Windows x64 可运行交付；**非**正式安装器；不宣称自动更新或跨平台 |

完整性：`scripts/_guided-validation-readiness-evidence/packaged-integrity.json`

## 引导验证脚本

`digitalme-v2/docs/guided-validation/DIGITALME-V2-GUIDED-VALIDATION-SCRIPT-01.md`

## 验收清单（任务 §6）

1. 未配置模型新环境不假可用 — **通过**（首启证据 + 欢迎门控）  
2. 配置成功后主路径可用 — **保留既有主路径**；门控后进入开始使用  
3. 外部能力不虚报已连接 — **通过**  
4. 结果检查不固定通过 — **通过**  
5. 协作中断不永久 running — **通过**（单测）  
6. 可重试或恢复交付 — **通过**（单测幂等交付）  
7. 对话/写作/代码分析/成长无故意回退 — **本轮仅收口，未改这些主链意图**  
8. 新电脑式环境不依赖 Owner 凭证/绝对路径 — **通过**（默认禁止自动导入）  
9. 引导包与流程可供非开发用户 — **脚本 + win-unpacked/ZIP 已备**  
10. 不宣称 MVP/closed alpha/production — **遵守**

## 最终判定

**`ready_for_2_to_5_user_guided_validation` = yes**

暂不 push；是否提交请 Owner 决定。
