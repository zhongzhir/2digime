# PRODUCT-CAPABILITY-AND-PARTNER-CLOSURE-01 — Slice 5 开发退出审计

**日期：** 2026-11-28  
**结论：** `SLICE_5_DEVELOPER_EXIT_GATE_PASS / OWNER_CONTINUOUS_ACCEPTANCE_PENDING`  
**产品候选提交：** `c37450ea7585b978e1f3cfd1684a565a45cdd545`

## 1. 统一能力门

统一机械基准按能力族顺序运行并通过：

| 能力族 | 发布标签 | 开发门 |
|---|---|---|
| 发现 | Beta | 连续供给确定性门通过；60 个开放原文入口 60/60 可打开 |
| Word、PPT、PDF | Beta | 30 个固定任务的生成、结构、回读和逐页渲染通过 |
| 授权本地文件 | 可用 | 20 项路径围栏、读写回读、撤销与动作时确认通过 |
| Coding | Beta | 同一构建的固定基准合同与证据门通过；不外推所有工程场景 |
| 第三方系统 | 有限预览 | Connector 合同、真实只读工具和机构 OIDC 地基 24/24 通过 |
| 协作 | Beta | 真实 Relay/E2EE、接受/拒绝/撤销、A2A 对象与 Artifact 通过 |
| 自动化 | 有限预览 | 人在环与低风险本机成果链各连续 10 次通过 |
| 机构伙伴沙箱 | 伙伴沙箱 | 控制面、电信权益与银行服务两条合成旅程通过 |

机械基准结果为 `SLICE_5_MECHANICAL_BENCHMARK_PASS_WITH_DECLARED_LIMITS`。报告保存在忽略目录 `build/evidence/slice5-unified-release/mechanical-report.json`，不是新的产品事实源。

## 2. Electron 正式入口与清理

- 正式 `electron/main.cjs` 生命周期预检通过：首窗握手 2.134 秒、正常关闭 155 毫秒、隔离 userData 已删除；
- Discover 正式 Electron 门 1/1；
- Talk 连续生成 Word/PDF/PPT 并显示打开卡片 1/1；
- 授权文件搜索、编辑、复制、重命名和确认删除 1/1；
- 协作接受/拒绝/结束的“数字之我”控制投影 1/1；
- 自动化待确认、暂停、恢复、撤销及低风险自动运行 2/2；
- 机构连接、权益、最小计量边界和撤销投影 1/1。

Electron 门均作为顶层命令独立运行，不再嵌套在长驻统一 runner 中。旧 `dist` 中没有对应源码的临时电信 Electron 文件不作为现行门；机构两条旅程只认计划既定的 `institution:partner:journeys` 联合入口。

## 3. 正式 Windows 候选

候选：`v2-tujimi-20261128T091240Z-c37450ea`

| 文件 | SHA-256 | 大小 |
|---|---|---:|
| `兔机米-0.3.0-public-alpha-win-x64-setup.exe` | `cafafdddf5afbffa29580e3d62a6e9b8b5ab9daa96526772ca9ab0c594732891` | 88,647,735 bytes |
| `兔机米-0.3.0-public-alpha-win-x64.zip` | `efc7a9960f5ae684fa127e887ba935fe106d5e608108b24ac41098b362870054` | 122,633,864 bytes |
| 已安装 `兔机米.exe` | `a74050ed26e6d43a002020f5d381b771ac0b2b86ee5b86c4d0a961d48ccd71e0` | 186,300,416 bytes |

- 包内 `gitHead` 与产品候选提交一致；
- 敏感文件扫描 0 项；
- ZIP 正式可执行文件首窗、关闭和隔离 userData 清理通过；
- setup.exe 与已安装 exe 的外层系统检查均为 `NotSigned`，没有自签名或伪造发布者；
- 签名仍需单独的正式证书、费用和发布授权。

## 4. Windows 安装生命周期

同一候选在本机完成：既有安装原地升级 → 同身份再次升级/修复 → 静默卸载 → 数据保留核对 → 最终干净安装 → 已安装程序隔离启动。

- `%APPDATA%\digitalme-v2` 的 1,856 个保留文件、71,707,617 bytes 在升级、卸载、最终安装和隔离启动前后摘要一致；
- 卸载没有删除 Owner 数据；
- 最终安装的 exe 与候选 SHA-256 一致；
- 桌面和开始菜单快捷方式均存在；
- 安装后正式程序使用隔离 userData 启动并正常关闭；
- 最终状态为候选已安装，等待一次 Owner 连续体验。

证据保存在忽略目录 `build/evidence/slice5-windows-lifecycle/report.json`。

## 5. Yellow 信号与处置

1. Electron 预检独立通过，但嵌入统一长驻 runner 后两次超时。停止第三轮嵌套修补，改为机械统一门与顶层 Electron 门分别执行、同一审计汇总。
2. 第三方测试在 Job 终态后偶发临时目录 `ENOTEMPTY`。根因是测试只停止内部 WorkRuntime，遗漏顶层 DigitalMeRuntime 的订阅和后台收尾；改为既有 `rt.stop()`，组合门连续两次 24/24 后完整统一门通过。没有增加删除重试。
3. 旧 packaged smoke 只传 Chromium `--user-data-dir`，而产品权威入口为 `DIGITALME_V2_USER_DATA`。改为 Playwright 启动 ZIP 内正式 exe、观察首窗、有界关闭和专用临时目录清理。
4. Node 内嵌 PowerShell 的 Authenticode 状态采集连续失败。停止嵌套补丁，将签名检查从生命周期脚本分离，由外层 Windows 系统命令只读确认。

以上均未增加产品状态、第二 runtime、语义路由或兼容事实源。

## 6. 尚未完成与授权边界

- Owner 尚未在本次正式安装包上完成一次连续体验验收；
- 独立外部机构伙伴尚未按资料包人工启动并计时；
- 未达到 95% 的能力族已在 [`../releases/PRODUCT-CAPABILITY-MATRIX-0.3.0.md`](../releases/PRODUCT-CAPABILITY-MATRIX-0.3.0.md) 明确标为 Beta、有限预览或伙伴沙箱；
- 未购买或配置代码签名证书；
- 没有 push、公开 Release、生产部署、真实银行/电信试点、真实 KYC、FAPI 2.0 生产互操作或数字人民币能力。

开发退出门已通过。Slice 5 的剩余动作只有一次 Owner 连续体验；不再安排 Owner 参与工程调试。
