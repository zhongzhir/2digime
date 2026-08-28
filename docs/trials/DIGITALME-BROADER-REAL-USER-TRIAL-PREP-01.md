# DIGITALME-BROADER-REAL-USER-TRIAL-PREP-01

> 为真实知识工作者准备稳定 Candidate。  
> **product code changes = 0**。未修 P3、未改 UI、未加埋点、未改语义 / 上下文 / 研究 / Subject / Agent。  
> 未使用 Trial harness 作为分发物。未把测试 userData / evidence / 开发密钥打进包。  
> 阶段：Knowledge Worker = **BROADER REAL TRIAL**。不给 EARLY USER READY。

---

## 1. Candidate version

```
broader-01-20260828T081921Z-82c9d8f
```

内部构建号（packaged `build-meta.json`）：`v2-20260828T081921Z-82c9d8f5`  
分发物：Windows x64 ZIP（未签名）。真实用户解压后双击 `DigitalMeV2.exe`。  
默认本机数据目录：`%APPDATA%\DigitalMeV2`（Electron 正常用户路径，不是 Trial temp userData）。

---

## 2. source SHA

| 项 | SHA |
|----|-----|
| 产品基线 | `82c9d8f53144d501832ab967b249c875c9ff1cec` |
| Observation 框架 | `32fb7e464efb54e60577308ed2918c19a8627897` |
| Gate-03 | `2be00638dc618e26179f65bf43f2030b035d0212` |

本 Candidate 在 detached `82c9d8f` 上用现有 `npm run build:packaged` 打出。其后仓库仅有 Trial 文档提交，**产品文件与 82c9d8f 一致**。

---

## 3. build / package

| 项 | 值 |
|----|----|
| 构建时间 | `2026-08-28T08:19:28.406Z` |
| 构建命令 | `npm run build:packaged`（未改脚本） |
| 本地 staging（不入库） | `release-staging/v2-20260828T081921Z-82c9d8f5/` |
| ZIP | `DigitalMeV2-0.1.0-win-x64.zip` |
| ZIP bytes | 115093834 |
| ZIP sha256 | `693f40bf7760a273b18e88afc9bb128a6ccc712efdce7a616b1495dc6b1f1e52` |
| EXE sha256 | `162ebebc159f8ecf9ac8a2066ca4fc91b792402366b305c865625a7539ccab1a` |
| app.asar sha256 | `a49a9cda57f0eec2fac582ecfc94f1bbf0245ee243f5afefee2f7b268e50ca7c` |
| 敏感扫描 | `sensitiveFindings: []`（构建脚本） |
| 启动方式 | 解压 ZIP → 双击 `DigitalMeV2.exe`。无需安装程序。不设 `DIGITALME_*` 环境变量。 |
| 包内说明 | `试用说明.txt`（已有用户说明；本任务另附一页 Guide） |
| 是否含模型/API 配置 | **否。不含密钥。** |
| 是否含 Owner 私人路径 / evidence | **否。** |
| 最低环境 | Windows x64；可访问用户所选模型 API 的网络。编码类工作另需本机已安装可用的编码助手。 |

ZIP 仅本地保留（`release-staging/` 已 gitignore）。交给试用者时离线分发该 ZIP + Guide，不要发仓库、不要发 `build/evidence/`。

---

## 4. clean-user validation

干净 `--user-data-dir`（模拟新用户，不碰 Owner `%APPDATA%`）。未使用 Gate Driver / T1–T8。  
本地证据：`build/evidence/broader-real-user-trial-prep-01/`（不入库）。

| # | 检查 | 结果 |
|---|------|------|
| 1 | 应用可启动 | **pass** |
| 2 | 可正常聊天 | **pass**（连接模型后） |
| 3 | 可创建数字之我基础信息 | **pass**（overview「我的数字之我」；首屏进入对话空状态） |
| 4 | 可完成普通知识任务 | **pass**（「下周工作优先级」三句话成稿，非空模板） |
| 5 | 能找到可用模型/能力 | **pass**（连接后对话可用；未连接时设置里需自行填密钥。本机编码助手为 available；基础搜索 available） |
| 6 | 无测试数据泄漏到 UI | **pass**（界面无苇舟 / 炒蛋 / Trial-05） |
| 7 | 无 Owner 个人数据 | **pass**（包内无 `C:\Users\46554`；Chromium LOG 出现验证机临时路径属误报） |
| 8 | 无 Trial-05 测试材料作为默认内容 | **pass** |
| 9 | 无开发 evidence 暴露 | **pass** |
| 10 | 退出重启后状态正常 | **pass**（主体仍在；任务数 1） |

聊天摘录（验证用，非试用题）：用户问能帮做什么，回复为个人助手、可随互动了解偏好。  
知识任务产物为三条可执行的优先级安排，非空模板。

---

## 5. model / Agent prerequisites

**本任务不要求 Consumer zero-config。** 真实门槛：

1. **必须**在「设置」连接用户自己的对话模型（DeepSeek 或自定义 OpenAI 兼容接口）。密钥只存在该用户这台电脑。未连接时对话和做事不会假装完成。  
2. **本验证**使用 Gemini OpenAI 兼容接口（`gemini-3.6-flash`），仅用于干净环境连通性，**未打进 Candidate**。  
3. **改代码**：应用会自行发现本机编码助手。本机构建机上为可用。试用者若未安装，编码类工作可能无法开工——这是当前合理门槛，不是本轮修复项。  
4. **联网检索**：基础搜索无需额外账号；更强检索取决于用户连接的模型是否带检索。  
5. 包未签名；Windows / 杀毒可能拦截。仅在信任来源时继续。  
6. 协作仍是实验能力。

---

## 6. known limitations

| 级 | 项 | 是否打断试用 |
|----|----|----------------|
| P3 | asar 内含领域测试夹具字符串「番茄炒蛋」（`dist/work-runtime/tests/*`，因 `dist/**` 打进包）。用户默认数据与 UI **看不到**。 | 否。不改打包规则（属 P3，不修）。 |
| P3 | T4 成果摘要「部分满足验收要求」vs 磁盘测试 exit 0 | 否 |
| P3 | `researchEvidence.decided` observability | 否 |
| P3 | 完成后 UI 可能仍显示「尚未决定」 | 否 |
| — | 未签名 ZIP | 告知用户即可 |
| — | 非 zero-config：必须自备模型密钥 | 告知用户即可 |
| — | 编码依赖本机编码助手 | 告知用户即可 |

未发现 P0/P1：fake completion、主体错误、任务串线、系统性无法开工。

---

## 7. trial guide

面向试用者：`docs/trials/DIGITALME-BROADER-REAL-USER-TRIAL-GUIDE-01.md`  
一页。只讲目标怎么说、可附资料、可继续上次、可说习惯、有代码需求时直接说。  
**不**讲内部机制，**不**教如何“正确触发系统”，**不**发 T1–T8。

观察者口头建议只保留一句：

> 用它做你本来今天就要做的真实工作。

观察者只记：原始目标、是否完成、是否省事、是否需要重复解释、是否出现不自然步骤、是否愿意下次继续用、用户主动抱怨/表扬。详细内部 evidence 事后查，不打扰用户。

---

## 8. recommended first cohort

不追求人数。首批 **3–5** 名真人，优先异质而不是同职大量重复：

- 创业 / 项目负责人  
- 投资 / 研究  
- 内容 / 运营  
- 产品 / 商务  
- 有代码需求的知识工作者  

样本记入 `docs/trials/DIGITALME-BROADER-REAL-USER-OBSERVATION-01.md`。不要为填文档制造任务。

反馈分级同 Observation：P0/P1 可暂停观察修复；P2 先累计；P3 不打断。

---

## 9. readiness verdict

```
READY FOR REAL KNOWLEDGE-WORKER TRIAL
Candidate 可交付真人（非 zero-config）
不得给 EARLY USER READY
```

同一产品基线 `82c9d8f` 已通过 Gate-03（T1–T8 = 8/8，C1/C2 = 2/2，Hard Fail = 0）。  
本 Candidate 干净新用户可启动、可建立数字之我、连接模型后可聊天、可完成普通知识任务、重启保持状态。  
包内无 Owner 数据、无 Trial 默认材料、无开发密钥。

**下一步：** 把 ZIP + Guide 交给首批 3–5 人，按 Observation 记账，停止围绕固定 Gate 改产品。
