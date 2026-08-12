# ACCEPTANCE_SUMMARY — 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: `2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP`
- branch: `build/software-work-quality-loop-01`
- Draft PR: https://github.com/zhongzhir/2digime/pull/1
- ownerAccepted: **false**
- build_01_not_accepted: **true**
- ownerRuntime: **completed_rejected**（17 与 19 真机均未通过；不宣称 Owner 已验收）

## 实现状态（工程）

| 块 | 状态 | 说明 |
| --- | --- | --- |
| D11-A AI 意图与对话中枢 | 已实现 | `work.converse`；非执行输入零 Job；规划种子 |
| D11-B 规划确认与两步开始 | 已实现 | 右栏规划确认 → 开始开发；低风险执行授权 |
| D11-C AI CTO 证据验收 | 已实现 | 证据门控验收结论；**不是**受控自动修订 |
| D11-D 受控自动修订 | **targeted accepted** | 15A 原子认领 + 15B 严格不可重入 mutex；自动修订在边界内 |
| D11-E 遗留清理 | **cleanup completed** | 中栏三确认卡已删；开发前准备仅右栏；空成果文案已收敛 |
| corrective-18 / 18A | **engineering closed** | HEAD `ce89f7a`；smoke 通过；**非** Owner accepted |

## Owner 真机（17）

- 入口：真实 `electron/main.cjs` + 隔离 userData；真实测试项目；已配置 Coding Agent
- 证据：`scripts/_owner-runtime-acceptance-17-evidence/`
- 工程可走通：规划后可开始、会改文件、自然语言「按你说的改吧」会启动修订、重启后同一 Task/成果仍在、无自动采用、未见旧三确认卡
- Owner 体验未过：看不出规划、不像 CTO 把关、按钮含义不清、结果不可判断、追问「能不能用」时对话降智、重启后反而出现「开始开发」

## Owner 真机复验（19）— **第二次失败**

- 任务：`2DIGIME-BUILD-01-OWNER-RUNTIME-REACCEPTANCE-19`
- 基线 HEAD：`ce89f7a`
- 证据：`scripts/_owner-runtime-acceptance-19-evidence/`
- 结论：`owner_runtime_completed_rejected` / `ownerAccepted=false` / `runtime_path_divergence_suspected`

准确记录：

1. **Owner 第二次真机验收失败。**
2. **首次自然语言输入未形成 Task、规划或建议**（磁盘无 formatLabel Task；右侧无开发规划；中栏未见理解回复）。
3. **「开始处理」绕过规划且未产生有效执行**（走旧 `work.submitTask` 确认门；Task/Job/Artifact 仍为 0；项目文件未改）。
4. **第二次仅生成种子规划并出现「没听懂」**（目标「再试一轮规划」；`intent=other` / `confidence=0`；`CONVERSE_UNPARSEABLE_NOTICE`；plan 为确定性 seed，非模型 CTO 建议）。
5. **Codex 黑窗仍存在**（标题含 `codex-win32-x64\vendor`）。
6. **重启、咨询、修订和采用未测**（主链在规划/对话阶段已阻断）。
7. **ownerAccepted=false。**

收口诊断（只读、未改产品代码）：`RUNTIME_PATH_DIVERGENCE_19A.json` / `.md`（19A）。

## 运行证据分层（16A 仍有效）

| 证据 | 路径 | 性质 |
| --- | --- | --- |
| 界面示意（静态 fixture） | `scripts/_d11-e-legacy-cleanup-16-evidence/visual_mock_only-*.png` | **visual_mock_only** |
| 真实 Electron 工程 smoke | `scripts/_d11-e-runtime-evidence-16a/`、`_corrective-18a-smoke-evidence/` | **runtime_evidence**（含 hooked；非 Owner） |
| Owner 真机主链 17 | `scripts/_owner-runtime-acceptance-17-evidence/` | **owner_runtime**（`ownerAccepted=false`） |
| Owner 真机复验 19 | `scripts/_owner-runtime-acceptance-19-evidence/` | **owner_runtime**（再次拒绝；含 19A 路径分叉诊断） |

## 当前准确结论标签

- `d11_a_to_e_implemented`
- `d11_d_targeted_accepted`
- `d11_e_cleanup_completed`
- `corrective_18a_engineering_closed`
- `owner_runtime_completed_rejected`
- `owner_reacceptance_19_rejected`
- `ownerAccepted=false`
- `build_01_not_accepted`
- `runtime_path_divergence_suspected`

## 全量测试残留（准确清单，不扩大处理）

相对 D11-E / 16A：**fail=4，added=0**（历史残留，非 19A 范围）。

## 说明

工程完成 ≠ Owner accepted。不得宣称 `closed_alpha_ready` / `mvp_ready`。不合并、不改 main、不部署、不碰 MUHUB。19A 仅证据与诊断收口，**不做第三轮产品修正**。
