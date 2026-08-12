# ACCEPTANCE_SUMMARY — 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: `2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP`
- branch: `build/software-work-quality-loop-01`
- Draft PR: https://github.com/zhongzhir/2digime/pull/1
- ownerAccepted: **false**
- ownerRuntime: **completed_rejected**（17 真机主链已走完；体验未过；不宣称 Owner 已验收）

## 实现状态（工程）

| 块 | 状态 | 说明 |
| --- | --- | --- |
| D11-A AI 意图与对话中枢 | 已实现 | `work.converse`；非执行输入零 Job；规划种子 |
| D11-B 规划确认与两步开始 | 已实现 | 右栏规划确认 → 开始开发；低风险执行授权 |
| D11-C AI CTO 证据验收 | 已实现 | 证据门控验收结论；**不是**受控自动修订 |
| D11-D 受控自动修订 | **targeted accepted** | 15A 原子认领 + 15B 严格不可重入 mutex；自动修订在边界内 |
| D11-E 遗留清理 | **cleanup completed** | 中栏三确认卡已删；开发前准备仅右栏；空成果文案已收敛 |

## Owner 真机（17）

- 入口：真实 `electron/main.cjs` + 隔离 userData；真实测试项目；已配置 Coding Agent
- 证据：`scripts/_owner-runtime-acceptance-17-evidence/`
- 工程可走通：规划后可开始、会改文件、自然语言「按你说的改吧」会启动修订、重启后同一 Task/成果仍在、无自动采用、未见旧三确认卡
- Owner 体验未过：看不出规划、不像 CTO 把关、按钮含义不清、结果不可判断、追问「能不能用」时对话降智、重启后反而出现「开始开发」

## 运行证据分层（16A 仍有效）

| 证据 | 路径 | 性质 |
| --- | --- | --- |
| 界面示意（静态 fixture） | `scripts/_d11-e-legacy-cleanup-16-evidence/visual_mock_only-*.png` | **visual_mock_only** |
| 真实 Electron 工程 smoke | `scripts/_d11-e-runtime-evidence-16a/` | **runtime_evidence**（Fake/hooked，非 Owner） |
| Owner 真机主链 | `scripts/_owner-runtime-acceptance-17-evidence/` | **owner_runtime**（真实应用；`ownerAccepted=false`） |

## 当前准确结论标签

- `d11_a_to_e_implemented`
- `d11_d_targeted_accepted`
- `d11_e_cleanup_completed`
- `owner_runtime_completed_rejected`
- `ownerAccepted=false`

## 全量测试残留（准确清单，不扩大处理）

相对 D11-E / 16A：**fail=4，added=0**。

1. `does not register fake or available document capabilities`（`documentCapability=none`）
2. `A: 相关偏好复用 → appliedUnderstanding 出现且 ≤3 条`
3. `完整成长闭环:Task A 编辑确认后 Task B 复用;未确认与不相似隔离`
4. `SUBJECT-MVP: one sentence start → task without archive gate → growth reuse`

## 说明

工程完成 ≠ Owner accepted。不得宣称 `closed_alpha_ready` / `mvp_ready`。不合并、不改 main、不部署、不碰 MUHUB。
