# 03 — CURRENT PLAN

**状态：** `current_authority / only_execution_plan`
**日期：** 2026-11-24
**性质：** 当前唯一执行计划。旧 roadmap、execution index、context 文首指针、01A baseline 附录中的「下一步」均不得再当 current plan。

开始任何实现前读 AGENTS.md 所列四份文件。本文件只回答：现在做什么、按什么顺序、什么不准做、还有哪些未决冲突。

---

## 0. 当前覆盖指针（2026-11-24）

**任务名：** `PRODUCT-CAPABILITY-AND-PARTNER-CLOSURE-01`

**状态：** `INSTITUTIONAL_SLICES_1A_TO_6_MERGED_LOCAL_MAIN / OWNER_PRODUCT_TRIAL_REVEALED_GAPS / NEXT_PLAN_REVISED / OWNER_DIRECTION_CONFIRMED / SLICE_1_TECHNICAL_GATE_PASS_OWNER_PENDING / SLICE_2A_DEVELOPER_CLOSED_OWNER_PENDING / SLICE_2B_DEVELOPER_GATE_PASS_OWNER_PENDING`

**详细计划：** [`../plans/PRODUCT-CAPABILITY-AND-PARTNER-CLOSURE-01.md`](../plans/PRODUCT-CAPABILITY-AND-PARTNER-CLOSURE-01.md)

**本地主干基线：** `348226a`。`INSTITUTIONAL-SUBJECT-COLLABORATION-01` Slice 1A–6 已从功能分支快进合并到本地 `main`；构建通过，身份/委托 11/11、Slice 6 主链 3/3、A2A 4/4 聚焦回归通过。尚未 push、打包、发布或部署。

### 2026-11-24 Owner 产品裁决

1. Discover 当前首屏新鲜度、连续供给、卡片布局和内容可用性不合格；不以此前技术门替代当前真实体验。
2. 不增加“协作与自动化”一级入口。保留现有导航，在“数字之我”内采用左右双栏：左侧是系统对用户的认知、证据与纠正，右侧是协作、自动化、个人身份认证、机构连接、授权与权限管理入口。两侧同属一个 Digital Self，右侧只投影既有 Goal/Execution/Artifact/Grant/Subject/Identity 事实。
3. Phase A 重新成为当前施工面：以成熟 Office、授权本地文件、Coding Agent 和第三方 Connector/Skill 接入缩小与 Codex/Claude Code 类产品的差距；95% 必须按固定真实任务集对照，不按功能数量宣称。
4. 已有 Institution Distribution、机构身份、委托和 A2A 地基转为伙伴就绪路线：个人客户端展示机构连接与授权，机构侧使用独立沙箱/控制台；不得让机构读取 Digital Self、私人 Talk、文件和记忆。

### 当前唯一动作顺序

1. Slice 1：恢复 Discover 新鲜度、连续 5 页、卡片视觉和文字可用性；不增加搜索供应商或站点特例；
2. Slice 2：集成成熟 DOCX/PPTX/PDF、授权文件工作区、Codex 级 Coding Agent 和三类第三方系统；
3. Slice 3：小批次扩展“数字之我”右侧，先身份与授权摘要，再接真实协作关系，最后接已经成立的自动化管理；不建立新一级入口；
4. Slice 4：机构伙伴沙箱、演示控制台、接口/安全/试点资料；
5. Slice 5：统一产品基准、Electron 自动化修复、干净机安装与 Owner 验收。

实施保持小步快跑：不大拆大建，不迁移已成立的 Talk/Digital Self/Capability/Relay/A2A/Identity/Institution Distribution；每批只做一条可感知主链，优先现有功能优化、欠账落地和必要功能接入，原则上可独立构建、回归和回退。

### Slice 1A 开发检查点（2026-11-24）

已完成首批局部修复：过期超过一天的整屏缓存不再压住更新目录；没有更新内容时仍保留旧页，但明确标为“较早内容”并异步补量；后台个人选择在剩余最后一页时提前并入唯一队列，不再等队列归零；Discover 卡片由不等高瀑布流改为同排等高、动作区贴底。未增加来源、站点特例、关键词规则或新状态源。

TypeScript 构建通过；新鲜度、连续 5 页/60 张唯一卡、低水位接队、失败保留和 renderer 合同聚焦回归 39/39 通过。正式 Electron 界面门启动后发生既有 Playwright/Electron 空转挂起，未进入页面断言，已清理本轮测试进程；因此当前仅为开发检查点，尚未通过正式 Electron、真实来源 30 分钟门、Owner 验收、打包、push 或发布。

### Slice 1B 开发检查点（2026-11-24）

Playwright 已升级到支持 Node 24、修复 Windows shell 参数链的 1.65.1；Electron harness 删除旧临时 bootstrap，直接走正式 `electron/main.cjs`。仅在 Codex 受限 Windows 环境启用 `--no-sandbox --disable-gpu`，普通 Windows 不降低默认沙箱。Discover 正式 Electron 门连续两次通过，覆盖真实卡片渲染、同排等高/动作贴底、较早内容标签、宽窄布局、卡内播放、refresh/seek/cancel 终态和零未捕获异常；首次进入页面的异步刷新竞态已在测试中收口。构建通过，Discover/个人流聚焦回归 35 passed / 1 skipped（已有失效开发模型凭据），正式 AppData 隔离保护通过。

另一条既有聊天滚动 Electron 测试现已进入断言并暴露滚轮未推动聊天列表的独立失败，本轮不跨 Slice 修聊天。

### Slice 1C 开发检查点（2026-11-24）

无模型费用的真实开放来源健康门连续运行 30 分 17 秒并通过：21 个健康来源、21 个域名、文章/图片/音频/视频 4 种表达、72 条候选池，Wikimedia Commons 的图片与音视频游标从首批真实推进到下一批，规范化重复为 0。新增可重复入口门，沿用既有开放来源、候选池与 SSRF 防护，不增加供应商、站点特例或模型调用；当前来源重新形成 251 条目录、72 条候选池、22 个来源，60 个唯一原文入口抽样为 60/60 可打开。304 未冒充失效内容恢复，SSRF 拒绝未放宽。

Slice 1 的开发者技术门已完成，仍待 Owner 界面验收；尚未打包、push 或发布。

### Slice 2A-1 开发检查点（2026-11-24）

现有 Word/PPT 序列化、Talk Execution 与结果卡已经接成普通用户主链：用户可在同一 Talk 直接委托生成 `.docx` 或 `.pptx` 应用成果，不需要外部文件夹授权；文件写入后由现有抽取链真实回读，结果以文件名和“打开”卡片返回；后续 Talk 只恢复该 Thread 实际生成的精确文件读取权，不开放整个成果目录。每个回复仍只投影一个成果，连续要求另一格式时在下一回复生成，不新增多成果状态或第二事实源。

TypeScript 构建通过；Talk/文件围栏/协作回退聚焦回归 14/14，Office 结构、抽取及布局相关 21/21，正式 Electron Talk → DOCX → 回读 → 结果卡 1/1 通过。该检查点只关闭已有能力未接入普通 Talk 的欠账；在该检查点完成时，PDF、成熟 Office 生成/渲染能力、DOCX/PPTX/PDF 各 10 项固定任务、逐页视觉 QA、修改迭代基准和 Owner 验收仍未完成，不得写成 Slice 2A 或 95% 通过。尚未打包、push 或发布。

### Slice 2A-2 开发检查点（2026-11-24）

PDF 已通过成熟 PDFKit `0.20.2` 接入同一 Talk/Execution/结果卡主链，不手写 PDF 二进制，不增加第二运行时。应用成果区和授权外部目录均可生成 `.pdf`；中文只使用可嵌入的单字体 TTF/OTF，缺少字体时明确失败。生成后经既有安全读取与 PDF 抽取链真实回读。TypeScript 构建通过；基础 DOCX/PPTX/PDF 导出与中文 PDF 回读 6/6，正式 Electron 同一 Thread 连续生成 Word、PDF 并分别显示“打开”卡片 1/1 通过；新增依赖后的 npm 生产依赖审计为 0 vulnerabilities。

本检查点只证明 PDF 基础生成与交付成立；复杂表格、图片、页眉页脚、PDF 逐页视觉 QA、DOCX/PPTX 成熟引擎升级、各格式 10 项固定任务及 Owner 验收仍未完成，不得写成专业 Office、Slice 2A 或 95% 通过。尚未打包、push 或发布。

### Slice 2A-3 开发检查点（2026-11-24）

正式 DOCX/PPTX 导出已分别切换到成熟 `docx 9.7.1` 与 PptxGenJS `4.0.1`，旧同步 OOXML builder 仅保留为历史 fixture/结构兼容，不再是 Talk 生产路径；PDF 继续使用 PDFKit。三种格式统一支持表格、已进入成果内容的 data URI 图片、中文字体及页眉页脚/页码，不借图片引用扩大文件授权。

新增可重复 30 项固定门（每格式 10 项）：报告、会议纪要、表格、图片、双语、清单、比较、时间线、机构备忘、长文。每项均真实生成、结构检查、正文回读；DOCX/PPTX 经 LibreOffice 转 PDF，三种格式均经 Poppler 逐页 PNG，形成三张逐格式蒙太奇并完成目视复核。首轮发现长文 PPT 机械拆成 37 张低密度页，已在成熟导出层按长度合并相邻短章节，复验为 7 张，未增加关键词语义路由。固定门 30/30 通过；构建通过；既有 Office/布局/Talk 16/16、授权文件与能力暴露 17/17；正式 Electron 同一 Thread 连续 Word/PDF/PPT 结果卡与真实回读 1/1 通过。

PptxGenJS 首次带入的 `image-size <=2.0.2` 高危 DoS 已通过 npm 官方修复版 `image-size 2.0.4` 精确 override 清除；完整图片任务复验通过，生产依赖审计为 0 vulnerabilities。该门只证明生成、回读和逐页渲染基线，不等于市场 95 分位：既有复杂文件修改、模板保真、复杂图表/公式/批注、领先产品同输入对照评分和 Owner 界面验收仍待后续小批次。Slice 2A 保持 IN PROGRESS；尚未打包、push 或发布。

### Slice 2A-4 开发检查点（2026-11-24）

现有复杂 DOCX 的第一条保真修改主链已接入同一 Talk：用户附上或授权一个 DOCX，并给出可核对的原文和修改内容；模型自主调用 `revise_docx`，系统逐字节复制源文件，使用本机已安装的 LibreOffice 原生文档 API 在副本中精确替换并保存到本轮应用成果区，随后回读正文、记录源/副本 SHA-256 和实际替换次数，并以可打开成果卡返回。源文件不交给 Office 引擎写入；目标已存在、原文不存在、出现次数与预期不符或保存/回读失败时不交付副本。该能力只在本轮存在已授权 DOCX 时提供，不新增一级入口、任务类型路由、永久状态或第二事实源。

实现过程按 Yellow/Red 规则淘汰了在 Word 2007 COM 保存现代复杂 DOCX 时反复 RPC 崩溃的路线，没有把不稳定 fallback 留进产品。LibreOffice 真实文件门、Talk 工具暴露边界和正式 Electron `Talk → 已授权 DOCX → 原格式修改 → 新成果卡 → 回读` 均通过；源/副本页面分别渲染为 PDF/PNG 目视对照，页眉页脚与原有文字样式保留，目标文字按原位置替换，未见重排、截断或重叠。

### Slice 2A 最终收口（2026-11-24）

在不扩大作业边界、不新增任务的前提下，DOCX 修改器完成最后一次可靠性收口：全部替换先在同一原始副本上预检，再执行修改；保存后关闭文档并从磁盘重新打开核对，避免把内存状态当作落盘事实；后一项原文若只是由前一项替换产生，整批拒绝且不留下成果，防止静默级联。LibreOffice 真实正向、预期次数拒绝、级联拒绝 3/3，通过；Talk 暴露边界 2/2、正式 Electron 主链 1/1 再次通过；TypeScript 构建通过。

Slice 2A 的开发范围据此收口为：同一 Talk 中创建和打开 DOCX/PPTX/PDF，三种格式完成固定任务生成、结构回读和逐页渲染门；已授权既有 DOCX 支持保留原件的少量精确文字修改与另存。任意复杂重排、图表/公式/批注编辑以及既有 PPTX/PDF 原格式修改不纳入本次已关闭边界，不再以“继续完善 Slice 2A”为由扩建。该结果不等于市场领先能力 95%，也不等于 Owner 验收、打包、push、发布或部署。状态改为 `SLICE_2A_DEVELOPER_CLOSED / OWNER_ACCEPTANCE_PENDING`。

### Slice 2B-1 开发检查点（2026-11-24）

授权文件工作区的第一批可感知动作已接入同一 Talk：当本轮存在已授权文件夹时，模型可以在同一授权根内复制普通文件，或移动/重命名普通文件。系统不覆盖已存在目标；移动通过同卷排他硬链接建立并核验新路径后才移除旧路径，不在跨卷失败时退化成“复制后删除”。复制必须同时保留源文件和同哈希目标，移动/重命名必须确认源路径消失且目标哈希不变。授权单文件不会获得目录级复制或移动能力。

路径围栏同时拒绝 `..` 越界、UNC/网络路径、源文件或目标父目录中的符号链接，以及多个授权根下未明确选择根目录的调用。TypeScript 构建通过；复制、移动/重命名、覆盖拒绝、越界拒绝、符号链接逃逸拒绝、多根歧义/跨根拒绝、Talk 工具暴露与既有授权文件回归共 27/27 通过。

本检查点仍是 Slice 2B 的第一批，不宣称整个授权文件工作区完成。在该检查点，目录内搜索、编辑前差异/备份/回滚和经动作时确认的删除尚未实现；20 项授权文件退出门、正式 Electron 界面门和 Owner 验收仍待后续小批次。没有新增文件管理器、一级入口、任务类型路由或第二事实源；尚未打包、push、发布或部署。

### Slice 2B-2 开发检查点（2026-11-24）

授权目录内的有界搜索已接入同一 Talk。模型根据用户本次目标决定原样搜索文字，机械工具只在一个明确授权根或其子目录内递归匹配文件名和可读正文，返回真实相对路径、命中位置、正文片段、大小和修改时间；不做语义猜测、相关性排序或关键词任务路由。普通文本、无扩展名文本以及既有抽取链支持的 DOCX/PPTX/PDF/HTML 等格式均可搜索。

搜索不跟随符号链接，不进入隐藏目录、版本控制、依赖或构建目录；拒绝越界路径和多授权根下未明确目录的调用。单文件授权仍只提供精确文件读取，不获得目录搜索。每次最多检查 1,000 个条目、返回 50 个结果、读取 20 MB 正文，单文件最多 5 MB；触及上限明确返回 `truncated`，不把部分结果冒充完整搜索，Owner 取消会中止而不伪装成普通搜索失败。TypeScript 构建通过；搜索、复制/移动、授权持久化、能力暴露和既有 list/read/write/export 聚焦回归 33/33 通过。

Slice 2B 仍为 IN PROGRESS。下一小批处理编辑前差异、可恢复备份与回滚；删除继续留在动作时确认之后。正式 Electron 界面门、20 项完整任务门和 Owner 验收尚未执行；不打包、不 push、不发布。

### Slice 2B-3 开发检查点（2026-11-24）

授权目录内现有 UTF-8 文本的可恢复精确修改已接入同一 Talk。模型必须先在本轮真实读取目标文件，再调用 `edit_file` 提交 1—20 项区分大小写的原文、修改后文字和预期出现次数；机械层在同一原始正文上预检全部匹配，拒绝次数不符、重叠范围、无实际差异、无效 UTF-8、二进制、超限、越界或符号链接目标，不让后一项替换命中前一项刚生成的文字。

写入前原文保存到应用受控备份区并核对 SHA-256；目标采用同目录临时文件与交换路径完成原子替换，随后重新从磁盘读取正文和哈希。`write_file` 同时收紧为只排他创建新文件，已有目标必须改走“读取 → 精确编辑”，且新增文件路径会拒绝已有父路径中的符号链接。每次成功编辑把真实差异位置、修改前后哈希和可回滚事实返回同一模型，并在既有 Execution `safeDetail` 中只保存路径、哈希和备份引用，不新增永久对象或第二事实源。

主人要求撤销时，`rollback_file` 只选择本对话同一文件最近一次尚未撤销的成功编辑；仅当当前文件仍与那次编辑后的 SHA-256 完全一致、原文备份哈希也一致时恢复。回滚本身先备份当前编辑版并原子替换；文件后来被用户或其他程序改过、备份被改变或同一编辑已撤销时均拒绝，不覆盖新内容。

TypeScript 构建通过；文本编辑/回滚、搜索、复制移动、授权持久化、能力暴露和既有 list/read/write/export 聚焦回归为 40 passed / 1 skipped。跳过项仅是当前 Windows 测试进程无权创建额外文件符号链接；既有授权文件符号链接逃逸负向门仍通过。本批不包含删除、目录操作、Office 原格式编辑、正式 Electron、20 项完整任务门或 Owner 验收；Slice 2B 继续为 IN PROGRESS，不打包、不 push、不发布。

### Slice 2B-4 开发检查点（2026-11-25）

授权目录内普通文件的动作时确认删除已接入同一 Talk。模型必须先调用 `prepare_delete_file`；机械层锁定一个明确授权根内目标的真实路径、大小、修改时间和 SHA-256，只返回一次性确认请求，不在该用户轮次删除。模型须向主人说明具体目标并停止；只有紧接着的下一条主人回复明确确认后，模型才能携带该次准备产生的一次性令牌调用 `delete_file`。同轮调用、跨过其他用户轮次、令牌重放、多个授权根未明确选择、目录、单文件只读授权、越权路径和链接逃逸均机械拒绝。

执行删除时重新解析授权与链接边界并核对当前 SHA-256；文件在确认前后发生任何变化即拒绝。删除前先在应用受控恢复区建立并核对同哈希副本，再通过同目录墓碑名原子移走目标、复核哈希后移除；取消或中途失败不得把未确认内容作为成功删除。成功 Execution 只记录目标、哈希和恢复副本引用，不新增入口、确认弹窗、Store、任务类型路由或第二事实源，也不支持目录删除。

TypeScript 构建通过；删除确认核心门 10/10 通过，其中同内容文件在确认后被替换也会因大小/修改时间身份不符而拒绝。联合授权持久化、能力暴露、搜索、复制移动、文本编辑/回滚和既有 list/read/write/export 聚焦回归为 50 passed / 1 skipped / 0 failed；唯一跳过项仍是当前 Windows 测试进程无权新建额外文件符号链接，目录联接越界负向门已真实通过。经确认的普通文件删除最小闭环据此关闭；目录增删、Office 原格式编辑、20 项完整退出门、正式 Electron 与 Owner 验收仍不在本检查点，Slice 2B 继续为 IN PROGRESS。不打包、不 push、不发布。

### Slice 2B-5 开发检查点（2026-11-26）

固定 20 项授权文件工作区退出门已建立并全部通过，覆盖授权目录列出、文本读取、文件名/正文搜索、Markdown/HTML 创建、DOCX/PPTX/PDF 导出与抽取回读、单处/多处精确编辑、回滚、复制、移动/重命名、两步确认删除及恢复副本，以及相邻未授权读取/写入、移出授权根、多授权根歧义四类负向任务。正向任务均核对真实磁盘或格式抽取结果，负向任务均核对未产生越权效果。

退出门同时发现并关闭一项正式主链缺口：删除准备的一次性令牌此前只保存在 Execution `safeDetail`，下一轮模型上下文无法取得，旧单元测试由测试代码直接传令牌，不能代表产品。现在 runtime 只在紧接的下一条用户回复中，把目标和令牌作为本轮机械事实提供给模型；若用户没有明确确认，模型不得调用，下一轮自动失效；删除工具仍机械复核上一轮、一次性消费、目标身份、授权根和哈希，不新增 Store 或确认状态机。

正式 Electron 使用测试模型替身、正式 renderer/主进程/Thread 与真实临时磁盘，在同一 Talk 连续完成搜索、先读后编辑、复制、重命名、先请求确认再于下一轮删除，1/1 通过；没有模型调用或外部费用。联合授权文件回归为 71 passed / 1 skipped / 0 failed，固定 20 项为 20/20；唯一跳过仍是当前 Windows 测试进程无权新建额外文件符号链接。Slice 2B 开发门据此通过，Owner 产品验收和真实模型 smoke 仍独立 pending；不得写成 Owner 接受、市场 95%、打包、push、发布或部署。

### Slice 2C-1 开发检查点（2026-11-26）

既有成熟 Coding Agent 路线已复核，继续复用 Codex/OpenCode adapter、授权、执行事实与独立验证，不另造 Agent。Web、桌面、后端、既有脏工作区四类固定对照任务及 100 分权重已经冻结；每项必须同时取得领先 Agent 直连与 2digime 编排两条真实记录。评分固定为任务理解、修改正确性、验证、范围安全、失败恢复、同一 Talk 回执六维；假完成、越界写入或丢失既有改动任一发生即硬失败，且必须至少完成一项真实项目端到端修改。

当前只完成可执行协议门和公式自检，TypeScript 构建通过、聚焦测试 5/5；没有运行真实 Agent、没有外部费用，状态为 `SLICE_2C_PROTOCOL_READY / REAL_BENCHMARK_PENDING`，不得宣称相对领先 Agent 95%、Owner 验收、打包、push、发布或部署。下一小批次只建立四类隔离项目材料和零费用机械预检，不扩大到新 Agent、新执行链或第三方系统。

### Slice 2C-2 开发检查点（2026-11-26）

Web、桌面、后端和既有脏工作区四类最小隔离项目材料已建立，每类都有预注册、可复现的基线失败和零依赖测试入口。`benchmark:coding:preflight` 只在临时副本执行，逐项证明任务映射、隔离、基线失败和冻结源材料不变；脏工作区样本还在临时 Git 仓库预置 Owner 未提交改动，并核对预检前后 SHA-256 与 diff 完全一致。

TypeScript 构建通过，2C-1 评分合同与 2C-2 材料门联合测试 6/6 通过；没有调用真实 Agent、没有模型或外部费用。当前状态为 `SLICE_2C_MATERIALS_READY / REAL_BENCHMARK_PENDING`。下一小批次只建设真实双臂证据采集与零费用 fail-closed 门；不新增 Agent、执行链或产品入口，未取得真实双臂结果前不得宣称 95%、Owner 验收、打包、push、发布或部署。

### Slice 2C-3 开发检查点（2026-11-26）

真实双臂证据合同和零费用准入门已经建立。Agent 不可用、费用未知或外部计费一律阻断；真实证据必须包含同一冻结任务/revision、同一 Agent build、独立工作副本、基线失败、最终测试通过、变更文件与零越界写入。2digime 编排臂必须带同一 Talk 的 Thread/Execution/Artifact/用户可见摘要回执，直连臂不得伪装该回执；脏工作区还必须证明既有文件和 diff 摘要前后相同。hook、fixture 和合成结果均不能进入评分。

TypeScript 构建通过，2C-1～2C-3 联合聚焦测试 11/11 通过；没有启动真实 Agent、没有模型或外部费用。当前状态为 `SLICE_2C_EVIDENCE_GATE_READY / REAL_BENCHMARK_PENDING`。下一小批次只做一次性真实运行采集器，并继续限制为本机已连接、可证明无新增收费的成熟 Agent；不手工拼证据，不宣称 95%、Owner 验收、打包、push、发布或部署。

### Slice 2C-4 开发检查点（2026-11-26）

一次性 `prepare → collect → cleanup` 采集器已实现：准备阶段建立隔离 Git 工作副本并记录预注册基线失败和 Agent 可执行文件摘要；真实运行后采集最终测试、Git 增量、既有脏改动保护、sandbox 回执和 Talk 回执。外部计费、费用未确认、重复采集、非专用运行根和无 marker 的清理均拒绝。机械替身证据固定为 `mechanical_fixture / scorable=false`，正式证据门会拒绝，不能冒充真实 Agent。

TypeScript 构建通过，2C-1～2C-4 联合聚焦测试 12/12 通过；没有调用真实 Agent、没有模型或外部费用。当前状态为 `SLICE_2C_COLLECTOR_READY / REAL_BENCHMARK_PENDING`。下一小批次只执行一个 Web 任务的领先 Agent 直连真实样本；其零新增费用、workspace-write sandbox 和证据门通过后，才执行同任务的正式 Talk 编排臂。不并行跑四类任务，不宣称 95%、Owner 验收、打包、push、发布或部署。

### Slice 2C-5 开发检查点（2026-11-26）

`2C-WEB-01` 领先 Agent 直连单臂真实通过：本机 Codex CLI `0.171.0-alpha.13.2` 使用既有 ChatGPT 登录，在独立 Git 副本以官方 `workspace-write` / Windows `unelevated` sandbox、approval `never` 和 ephemeral session 完成修复；只修改 `src/price-card.cjs`。基线测试真实失败，采集器在 Agent 退出后独立运行默认注册测试 1/1 通过，零越界写入，`real_process` 证据通过正式校验。

没有 API Key、购买、充值或按量付费，按现有权益记零新增外部收费；订阅额度消耗不可见，不写零配额消耗。第一次启动在 CLI 参数解析阶段停止，未进入模型、未改文件并已清理；修正参数层级后用全新副本完成唯一一次真实运行。当前状态为 `SLICE_2C_WEB_DIRECT_PASS / WEB_ORCHESTRATED_PENDING`，仍不是双臂、四类覆盖、95%、Owner 验收、打包、push、发布或部署。下一小批次只做同一 Web 任务的 2digime 正式 Talk 编排臂。

### Slice 2C-6 开发检查点（2026-11-26）

“用户必须预装并登录本机 Codex CLI”已从产品路径移除。用户只有兔机米时，正式 Talk 会先展示可获取的 OpenCode 1.18.29、来源、固定 SHA-256 和费用边界；只有下一轮明确同意后才下载、校验并执行。兔机米把当前托管模型以仅回环、随机临时 token 的兼容端点交给本次 Runtime，结束即关闭；上一轮目录授权只延续到紧接着的确认回合，执行后失效。

`2C-WEB-01` 零起步真实产品链通过：基线失败，只修改 `src/price-card.cjs`，最终测试通过，同一 Talk 的 Execution/Artifact/用户可见摘要成立；本机 Codex 未参与，没有购买、充值或按量付费。免费额度百分比 89%→89% 不代表零模型消耗。OpenCode V1 配置已拒绝外部目录、内置网页工具和子 Agent，但不是 Windows OS 级 sandbox；同时既有直连样本使用 Codex，本次编排使用 OpenCode，不满足同一 Agent build。当前状态为 `ZERO_START_PRODUCT_CHAIN_PASS / FORMAL_BENCHMARK_INELIGIBLE`，不得据此计算 95%、宣称零越界写入或转入其余三类评分任务。下一小批次只解决 OS 级工作区边界与同一 build 准入。证据见 [`../audits/PRODUCT-CAPABILITY-SLICE-2C-ZERO-START-TALK-01.md`](../audits/PRODUCT-CAPABILITY-SLICE-2C-ZERO-START-TALK-01.md)。

### Slice 2C-7 开发检查点（2026-11-27）

可获取 Coding Runtime 的 Windows OS 写边界和同一 Agent build 双臂准入已关闭。兔机米首选获取 OpenAI 官方固定 Codex Windows Release `0.171.0-alpha.13.2`，执行压缩包 hash、解压和版本三重校验；使用 Responses 回环桥复用兔机米当前托管模型，不要求用户预装、登录或配置 Codex。正式配置为官方 `workspace-write` / Windows `unelevated` restricted-token / approval `never` / 禁网；宿主负向探针证明授权目录内可写、目录外 `Access denied` 且文件不存在。

`2C-WEB-01` 已取得新的正式双臂对：直接臂与兔机米 Talk 编排臂使用同一 fixture digest、确定性 Git tree、Agent executor/version/executable digest 和两个独立工作区；两臂均只修改 `src/price-card.cjs`，预注册测试均由失败变为通过，`outsideScopeWrites=[]`，pair validator 返回 `evidence_ready_for_scoring`。没有购买、充值或外部按量费用；编排臂使用既有托管额度 75%→66%，不得写成零模型消耗。当前状态为 `OS_BOUNDARY_PASS / SAME_BUILD_PAIR_ADMITTED`。这只是 Web 单项准入，不是四类 95% 评分；桌面、后端、脏工作区仍未运行，不是 Owner 验收、打包、push、发布或部署。证据见 [`../audits/PRODUCT-CAPABILITY-SLICE-2C-SAME-BUILD-ADMISSION-01.md`](../audits/PRODUCT-CAPABILITY-SLICE-2C-SAME-BUILD-ADMISSION-01.md)。

### Slice 2C-8 开发检查点（2026-11-27）

`2C-DESKTOP-01` 直接臂已真实通过：同一官方 Codex build 在独立工作区只修改 `src/main.cjs`，预注册桌面测试由失败变为通过，OS 负向探针继续证明无工作区外写入。为运行编排臂，本轮关闭了 Responses custom tool、并行 function call 历史、自定义 provider HTTP-only、插件初始化、Windows 文件写入和失败尾部诊断等实际缺口。

编排臂最后一个干净样本同样只修改 `src/main.cjs` 且注册测试通过，但 Agent 在最终模型收尾请求上达到 10 分钟超时；Talk Execution 失败、Artifact 为空、用户面如实返回未完成，因此不得进入 pair validator。诊断期间托管免费额度从 66% 降至 42%，没有购买、充值或新增外部按量费用；为避免继续消耗，本轮停止真实重跑。当前状态为 `SLICE_2C_DESKTOP_DIRECT_PASS / DESKTOP_ORCHESTRATED_TIMEOUT`。下一小批次仍只解决桌面编排臂的无模型收尾可靠性门，不进入后端或脏工作区，不宣称四类 95%、Owner 验收、打包、push、发布或部署。证据见 [`../audits/PRODUCT-CAPABILITY-SLICE-2C-DESKTOP-PAIR-01.md`](../audits/PRODUCT-CAPABILITY-SLICE-2C-DESKTOP-PAIR-01.md)。

### Slice 2C-9 开发检查点（2026-11-27）

桌面编排臂增加了严格的一次性完成收据：只有 nonce、真实相对变更清单、验证命令和 Codex JSONL 中退出码为零且输出标记一致的命令事件同时成立，才允许把“任务已经做完、仅最终自然语言收尾超时”恢复为成功；收据在核验后自动删除，不能替代真实 Git 增量和最终测试。固定 Runtime 获取链同时修正了版本警告误判，并在 PowerShell 压缩模块不可加载时使用 Windows 自带 `tar.exe` 后备；固定来源、压缩包 hash 和版本门均未放宽。

唯一一次真实编排复验没有进入收尾阶段：获取链和回环模型已工作，但 Windows `workspace-write` 中的统一命令进程因 home 位于授权工作区外而无法启动，未修改文件并被产物门拒绝；托管免费额度 42%→39%，没有购买、充值或新增外部按量费用。实现现已改为在授权工作区创建随机一次性 home，并在执行结束后清理，29 项本次相关测试与四类材料预检 4/4 通过；真实复验按单次调用上限留到下一小批次。当前状态为 `DESKTOP_ORCHESTRATED_HOME_FIXED / REAL_RERUN_PENDING`，仍不进入后端或脏工作区，不宣称桌面双臂通过、四类 95%、Owner 验收、打包、push、发布或部署。证据见 [`../audits/PRODUCT-CAPABILITY-SLICE-2C-DESKTOP-CLOSEOUT-02.md`](../audits/PRODUCT-CAPABILITY-SLICE-2C-DESKTOP-CLOSEOUT-02.md)。

以下 `0A` 及后续历史指针保留为决策和证据记录；与本节冲突时，以本节和新详细计划为准。

---

## 0A. 当前覆盖指针（2026-11-23）

**任务名：** `INSTITUTIONAL-SUBJECT-COLLABORATION-01`

**状态：** `SLICE_0_COMPLETE / SLICE_1A_1B_1C_IMPLEMENTED / SLICE_2A_2B_IMPLEMENTED / SLICE_3A_DELEGATION_CORE_IMPLEMENTED / SLICE_4_A2A_OBJECT_MAPPING_DEVELOPER_VALIDATED / OWNER_CONTROLLED_EXTERNAL_OIDC_DEVELOPER_VALIDATED / FAPI_2C_ENTRY_ASSESSED / OPENID4VC_INTEROP_PENDING / NOT_OWNER_ACCEPTED`

**详细计划：** [`../plans/INSTITUTIONAL-SUBJECT-COLLABORATION-01.md`](../plans/INSTITUTIONAL-SUBJECT-COLLABORATION-01.md)

**版本基线：** `0.3.0-development-baseline`。它表示已将 Owner 接受的发现能力、文字等相对可达内容能力和现有协作/机构分发地基收束到一条可开发主线；它不是公开发布、生产部署或机构级安全认证。

### Owner 最新裁决

1. `DISCOVER-WATCH-ENTRY-01` 以“公开入口能力有限、现有改进接收”的边界关闭，不再继续寻找其他搜索供应商，也不转入 PC 登录态平台逐站搜索。
2. 直接观看能力受内容平台生态、账号、付费、地区和 App 跳转限制影响，等待内容开放生态成熟；当前优先把文字等相对容易到达的内容做到可用、好用。
3. 当前已接受能力进入主干；中间开发成果按“代码与可复现证据入库、运行态和一次性探针封存、凭据永不入库”的规则收束。
4. 下一阶段恢复停留已久的协作能力与做事能力建设，面向银行、电信、大型机构和大用户平台，落实主体身份、认证、安全、授权与 A2A 互操作。
5. 长期产品目标是：用户可用邮箱、电话等简便入口安全找回和管理自己的 2digime；真实身份认证与简便入口分层，前者用于接入银行、电信等高等级服务；未来在合规身份、委托、交易确认和监管接口成熟后再评估数字人民币等金融工具；不同 2digime 既可在关键节点由人参与，也可在明确授权和风险边界内自动协作。

### 新阶段动作顺序

1. 以既有 `INSTITUTION-DISTRIBUTION-V01` 已接受地基为起点，不重造机构控制面，不让机构读取 Owner 的 Digital Self、Talk、文件和记忆。
2. 先完成 Owner、Digital Subject、Runtime Endpoint 三类身份分离及签名 Agent Card，再接真实机构身份联邦。
3. 机构登录沿用 OIDC/OAuth2/SAML；高价值 API 采用 FAPI 2.0 安全剖面，不自研认证协议。
4. Owner 对 Subject 的委托采用 VC 2.0 数据模型，并评估已正式发布的 OpenID4VCI/OpenID4VP；实现最小披露、过期、撤销和密钥轮换。
5. A2A 只作跨主体协议形状：Agent Card、Message、Task、Artifact 与安全方案；A2A Task 不得变成面向用户的新任务状态机。
6. 在同一 Talk 入口验证“本地主体自己做 / 请求另一个主体协作”的真实选择、接受、拒绝、结果和恢复，不新增协作中心或第二套 runtime。

### Personal Agent 参考修订与当前检查点

`docs/reference` 的两类探索只作为外部启发，不覆盖产品宪法：HackerTube 类“个人算法”落实为平台/来源只供候选、同一个 Digital Self 与当前模型完成个人选择；Second 类“长期个人上下文”落实为一个本机可拥有、可纠正、可迁移的 Digital Self，外部 Agent/Tool/Subject 只能按目的取得短期最小投影。明确不吸收全时屏幕/键盘/OS 监控、后台 Agent 群、第二份长期记忆或中心画像。

2026-11-23 已完成 Slice 2A 机构身份联邦开发地基：集成成熟 OIDC 客户端，真实走通本机独立开发身份源、浏览器授权码回调、PKCE S256、state、nonce 和 ID Token 校验；以 `issuer + subject` 建立稳定 Owner identity，邮箱/电话只保存脱敏且带验证状态的联系提示；机构登录不会自动获得 Subject 权限，必须另行确认绑定且可撤销。事务材料加密、一次性消费，不保存 token、客户端密钥或原始联系方式。随后最小升级 Express/XML 生产依赖，npm `--omit=dev` 审计为 0；成果物化改为按需挂载既有 work runtime，原始协作失败套件 7/7、受影响 HTTP/XML/Relay/A2A 路径 55/55、A2A adapter 3/3 通过。包含开发和打包工具的完整审计仍有 28 项，未做工具链大版本升级，也不宣称全仓测试或发布安全通过。证据见 [`../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-2A-DEVELOPER-VALIDATION.md`](../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-2A-DEVELOPER-VALIDATION.md)。

同日 Slice 2B 外部公开门通过：复用现有适配器连接 Duende 官方公开 demo，以预配置 `interactive.public` client 真实完成 HTTPS discovery、独立浏览器授权码 + PKCE S256、动态 loopback 回调、跨新服务实例事务恢复、稳定 Owner identity 持久化和显式 Subject 绑定。没有创建账号、接受新条款、使用真实身份、录入付款方式或产生费用；临时身份包已删除。此结果只证明外部协议互通，不是 Owner 控制的 client 注册，不是银行/电信真实租户、实名、KYC 或 FAPI 2.0。当前尚未接产品 UI、Owner 验收、合并、推送、打包、发布或部署。下一小门若需创建外部账号、接受第三方条款或使用组织租户，仍须 Owner 另行明确授权。证据见 [`../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-2B-DEVELOPER-VALIDATION.md`](../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-2B-DEVELOPER-VALIDATION.md)。

Owner 随后明确授权零费用开发租户与独立 client 门，并亲自完成 Auth0 注册、Native client 创建、回调白名单保存及合成账号密码输入。2digime 使用 Owner 控制的 client 再次真实完成 HTTPS discovery、授权码 + PKCE S256、固定 `127.0.0.1` loopback 回调、state/nonce/ID Token/UserInfo 校验、跨新服务实例事务恢复和显式 Subject 绑定；没有读取或保存 client secret、token、密码或真实联系方式，没有录入付款方式或产生费用。至此 Slice 2B 的 Owner 控制外部 client 开发门通过，但它仍是 Auth0 开发租户与合成身份，不是银行/电信真实租户、实名、KYC、FAPI 2.0、产品 UI、Owner 产品验收或生产发布。证据仍收束在同一 Slice 2B 审计文件。

Slice 2B 随后补齐本机负向安全门：加密登录事务绑定 issuer、client、redirect URI、scopes、client authentication 与 security profile 指纹，配置替换会在 token 调用前拒绝；机构身份若携带 organization/tenant 范围，Subject 绑定必须提供完整且相同的目标范围。标准本机 OIDC provider 真实签发授权码后撤销动态 client，token 交换被拒绝且没有新增身份；跨租户绑定拒绝、同租户绑定通过。为避免破坏 Owner 的外部开发环境，本轮没有删除 Auth0 client；因此只证明 2digime 正确服从身份源撤销，不宣称完成 Auth0 管理台 client 删除恢复流程。

Slice 2C 已完成进入条件评估，不等于协议实现。仓库实际安装的 `openid-client 6.9.1` 已提供 PAR、`private_key_jwt` 与 DPoP 能力，并处于 OpenID Foundation 公布的 FAPI 2.0 RP 认证版本范围；因此继续集成成熟库，不自研协议。桌面端第一实现路线定为 `private_key_jwt + PAR + DPoP`，但只有在免费真实 HTTPS 提供方同时支持强客户端认证、DPoP nonce 和受保护资源后才进入 2C-1。完整真实端到端门通过前，`fapi2` 配置继续机械拒绝，不把普通 OIDC 或局部协议演示写成 FAPI 2.0 已实现。进入评估见 [`../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-2C-ENTRY-ASSESSMENT.md`](../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-2C-ENTRY-ASSESSMENT.md)。

Slice 3A 已实现 Owner→Digital Subject 委托核心：既有 `AuthorizationGrant` 继续作为唯一授权事实源；W3C VC 2.0 数据形状只投影最小 issuer/subject/scope/purpose/有效期/撤销引用，使用成熟 `jose` 生成 `application/vc+jwt` 和 challenge/audience 绑定的短时 `application/vp+jwt`。Owner 私钥进入既有加密 SecretStore，Subject 复用现有通信 key 完成 holder proof。Binding 固化当时的 organization/tenant authority scope，同一机构 subject 重新认证但租户范围变化时旧 binding 自动撤销。撤销、过期、Owner identity/绑定停用、Owner key 轮换和 Subject key/endpoint 替换均拒绝；新 key 重新签发通过。OpenID4VCI 1.0 与 OpenID4VP 1.0 已确认 Final，但没有独立 wallet/issuer/verifier 互操作，因此当前不宣称支持 OpenID4VC、选择性披露钱包或机构为 Owner key 背书。证据见 [`../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-3A-DEVELOPER-VALIDATION.md`](../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-3A-DEVELOPER-VALIDATION.md)。

Slice 4 已实现 A2A v1 标准对象映射：复用官方 `@a2a-js/sdk 1.0.1`，用签名 Agent Card 表达 Subject、Endpoint、技能和现有 Relay/E2EE 安全事实，用 Message/Task/Artifact 承载一次真实协作；现有 Relay 同时核验既有签名卡和标准签名 Card，拒绝篡改、过期、撤销 key、错误绑定与 token-only 降级。一个不导入 Digital Me 代码的独立官方 A2A server 进程已完成 Agent Card discovery、Message、Task + Artifact 离线零费用协议门；相关构建和定向回归 37/37 通过。该门不是公网外部组织互操作、第二位 Owner 真实 Subject、机构信任或产品验收；当前也没有公网 A2A endpoint、协作中心、Task Store、第二套 runtime、主干合并、推送、打包、发布或部署。证据见 [`../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-4-DEVELOPER-VALIDATION.md`](../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-4-DEVELOPER-VALIDATION.md)。下一推荐路线是具备真实外部条件后的 Slice 5 两 Owner 机构试验；若条件不足，不以单机回放冒充。

2026-11-24 Slice 6 已完成代码实现与聚焦开发验证：同一 Talk 模型可选择本地 Capability 或外部 Subject，`consult_subject` 进入既有执行事实链；只有非空可消费贡献和 A2A Artifact 引用才算外部完成，接受但无成果、拒绝、超时和失联会回到同一模型，只有后续真实本地成果或外部 Artifact 才能恢复。聚焦主链 3/3、本机双 Subject 3/3、Relay 2/2、两 Owner 非 Electron 2/2、A2A 4/4、文件写入 6/6 通过。正式双 Electron 长测及 Electron preflight 仍挂起，既有多轮 Talk 上下文用例仍有 1 项失败，Owner 产品验收未做；因此不得写成 Electron 门、全 Talk 回归或产品完成。未合并主干、推送、打包、发布或部署。证据见 [`../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-6-DEVELOPER-VALIDATION.md`](../audits/INSTITUTIONAL-SUBJECT-COLLABORATION-01-SLICE-6-DEVELOPER-VALIDATION.md)。下一步先修复 Electron/Playwright 启动与清理挂起，再做正式界面 Owner 验收；Slice 5 的两位真实 Owner/两安装端/真实机构身份源验收仍独立 pending。

### Discover 收束结论

下列“下一阶段产品结果”“当前动作顺序”和“开发检查点”保留为 `DISCOVER-WATCH-ENTRY-01` 历史，不再是当前执行指令。现有通用页面读取、作品/依据分离和入口结构化能力保留；Tavily 免费验证没有形成有效净增，专用 key 已撤销，未产生费用、未写 adapter、未部署 Relay。后续不得继续叠加供应商、站点规则、查询改写或提示词补丁。

**上一阶段：** `DISCOVER-50-STAGE1` 已于 2026-11-22 获得 Owner 限定验收：关联度与无关内容控制已有可感知提升，本轮修改接收；但推荐卡仍不能稳定交付直接观看、试看或明确的平台观看入口。限定验收记录见 [`../audits/DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-08.md`](../audits/DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-08.md)。

### DISCOVER-WATCH-ENTRY-01 历史目标（已关闭）

1. 用户要“看”某类内容时，主推荐卡必须是具体作品对象；新闻、榜单、百科和评论只能作推荐依据或补充材料。
2. 模型应继续自主搜索具体作品及其观看入口，优先交付已核实的直接观看、公开试看/预告或官方平台作品页；登录、付费、地区、App 跳转等限制必须如实标明。
3. 平台限制不是把报道当观看入口的理由。找不到可核实入口时，保留具体作品卡并诚实说明“暂未核实到观看入口”，不得伪造链接或暗示可以播放。
4. 优先复用现有 `web_search`、安全页面读取、开放媒体元数据/oEmbed 与平台公开页面；不自研搜索、爬虫或播放器，不绕过登录、付费、地区限制或验证码。
5. 第一刀先证明公开能力能把“报道候选”推进到“作品 + 可消费入口”；只有公开能力覆盖仍不足时，才单独评估官方平台连接器或经主人授权的登录态 Computer Use。

### DISCOVER-WATCH-ENTRY-01 历史动作顺序（不再执行）

1. 冻结并记录 `DISCOVER-50-STAGE1` 的限定验收边界，不把本轮写成直接观看能力通过。
2. 先做现有能力审计和代表性样本基线，不写平台关键词规则或站点白名单。
3. 复用现有通用页面读取/媒体元数据事实，把“入口核实”暴露给同一推荐主模型；runtime 只校验 URL、读取事实、安全和访问限制。
4. 调整卡片主动作：`直接观看 / 试看或预告 / 打开平台 / 查看推荐依据` 按真实事实投影，报道不再占“想看内容”的主卡位。
5. 通过开发者正式 Electron 门后，再安排一次最小 Owner 体验门；本任务未开始前不继续请 Owner 调试当前包。

### DISCOVER-WATCH-ENTRY-01 2026-11-22 收束检查点

通用候选页面读取、入口结构化交付、对象/依据分离和并行读取已经实现；具名作品入口覆盖达到 86%，但开放推荐只有 52.2%，20 请求整体门与 30 秒终态门未通过。连续三轮同层调整已触发 02 Red，停止继续补提示词或站点特例。

Owner 已授权继续“增强 Relay 成熟搜索供应商”路线，但不授权外部费用。IQS `CNAuto` / `CNLiteBasic` 双引擎不能补足开放推荐；Gemini Search、Brave 与 Google Custom Search 不满足零费用或可持续性边界。Tavily Researcher 免费计划随后完成真实验证：Basic 全量 20 请求仅 5 个自动疑似命中；Advanced 对 8 个缺口样本仅 3 个自动疑似命中，人工复核均为泛频道、盘点文章、同名 AI 二创或既有结果重复，有效净增为 0。共使用 36 个免费 plan credits，未录入付款方式，Pay As You Go 保持关闭，未产生费用。

Owner 已选择接受当前公开能力边界并停止该路线：不写 Tavily adapter、不部署 Relay、不继续叠加免费供应商、站点规则、查询改写或提示词补丁。未安排 Owner 复验；专用 Tavily key 已撤销。实现证据见 [`../audits/DISCOVER-WATCH-ENTRY-01-SESSION-01.md`](../audits/DISCOVER-WATCH-ENTRY-01-SESSION-01.md)，零费用供应商验证与最终处置见 [`../audits/DISCOVER-WATCH-ENTRY-01-CAPABILITY-SESSION-03.md`](../audits/DISCOVER-WATCH-ENTRY-01-CAPABILITY-SESSION-03.md)。

---

## 0B. 上一阶段覆盖记录（2026-11-11～2026-11-22）

**任务名：** `DISCOVER-50-STAGE1`

**状态：** `RELAY_DEPLOYED / RECOMMENDATION_MAINLINE_REFACTORED / OWNER_LIMITED_ACCEPTED / DIRECT_WATCH_ENTRY_PENDING / NOT_RELEASED`

**详细计划：** [`../plans/DISCOVER-50-STAGE1.md`](../plans/DISCOVER-50-STAGE1.md)

**覆盖关系：** Owner 2026-11-10 明确要求重新着手把「发现」真正落实；本节覆盖下方 `DIGITALME-UNIFIED-CAPABILITY-01` 与 `PUBLIC-ALPHA-CONTENT-RELEASE-01` 的下一开发任务指针，但不改写它们的历史结论。

### 本轮要解决的产品结果

1. **能发现：** 建立可持续维护的优质来源组合与多路候选供给，不再依赖几个硬编码新闻/漫剧来源。
2. **能推荐：** Digital Self、用户本次要求、用户明确内容控制和短期上下文共同进入本机模型选择；Relay / Search / Source 不得做个人化最终排序。
3. **一直有：** 形成独立的候选蓄水池、已看去重、分页游标、低水位补量与失败保底；“一次 12→24 条”不再算连续供给通过。
4. **技术基线：** 对标抖音、小红书、B站公开可核验的推荐系统共同能力，第一阶段达到能力覆盖约 50%，但不复制点击率、停留时长和成瘾目标。

### 当前工程基线与边界

- 隔离分支/工作树：`codex/discover-50-stage1` / `.task-worktrees/discover-50-stage1`；基线 `147ac09d2933c225c1fb079b4a266157c85a5091`。
- 基线构建通过；相关回归 103 项为 95 通过、8 失败。5 项为 Discover 跨代异步结果污染，1 项为 AI 视频与个人流恢复冲突，2 项为额度提示旧断言。这些是开工前已存在失败，不得算作本轮回归。
- 本轮开工时的关键上限：约 17 个硬编码开放端点、24 条排序窗、8 条一批的串行模型选择、没有来源健康账本或后台补量；10 月“连续加载”只证明 12→24 条。
- 继续复用：开放标准/API 接入、统一 `NetworkItem`、规范 URL 去重、Digital Self、显式内容控制、现有 Responses/Search 接入、来源执行事实。
- 本轮替换/抽离：候选窗口、来源组合、连续分页和补量编排。不得继续用单体 `personal-feed.ts` 中的新条件分支伪装系统升级。
- 禁止中心用户画像、Relay 个性化、CTR/停留时长优化、关键词打分器、站点黑名单、整站抓取器和第二套 Digital Self。
- 本轮先实现可离线验收的供给与蓄水池地基；真实外部来源扩容、模型质量和真实 UI 分别过门，不用 mock 代替。

### 当前检查点（2026-11-22）

- 2026-11-22 Owner 已在新安装的独立试用构建 `v2-tujimi-20261122T064002Z-147ac09d` 上完成体验并明确接收本轮修改：信息关联度和去除无关内容已有提升，可以先验收。
- 本轮未完成边界同样明确：推荐卡仍主要落到新闻、榜单、百科或推荐依据，不能稳定直接观看；平台登录、付费、地区或 App 跳转可能限制实际访问，但系统仍应尽力找到并区分直接观看、试看/预告、官方平台作品页与单纯报道。下一任务为 `DISCOVER-WATCH-ENTRY-01`。

- Owner 正式试用已推翻“可交体验”的结论：明确搜索「持械入宋」及自然语言短剧推荐均未得到资源或有效答复；个人流补量出现 1～2 分钟停顿后批量涌出；另一次输入等待两分钟无终态。见 [`../audits/DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-07.md`](../audits/DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-07.md)。
- 根因已定位为：显式搜索错误地把“当前主模型是否原生支持特定 Responses 工具协议”当成联网发现是否可用，忽略了已经连接的托管 Search；`content.more` 在队列耗尽时同步等待完整模型补量；前端还会在近底部递归连取多页，且第一响应兜底长达 250 秒。
- 当前修复方向：Search 作为独立可替换 Tool 接入，当前模型与 Digital Self 保持唯一理解/选择权；个人流首屏后立即后台预取，`more` 只消费就绪缓存、绝不等待网络；前端每次只追加一页，第一响应 30 秒必须终态。修复完成前不得再次交 Owner 试用。
- 响应与连续供给修复已落实：部署后正式 Electron 查询「持械入宋」18.705 秒交付 6 张主卡和 2 张相关卡；自然语言推荐请求 21 秒内形成终态。连续 8 次 `more` 总计 2.665 秒，前 7 页各 12 张、162～241 ms，第 8 页 4 张、168 ms；没有轮询、等待补量、1～2 分钟停顿或集中涌出。
- `CNAuto` Relay 修复已部署到北京 ECS `i-2zedlw82hph3c2lxd3w7` 的 `digitalme-relay.service`；公网 health 200，服务器本机搜索「持械入宋」301 ms 返回 10 条。回滚备份为 `/opt/digitalme-review-discover-20261111/backup-20261111T105604-964361`。付费开关保持关闭，没有购买、充值或更改 Secret；未发布客户端或安装包。
- 宽泛推荐质量仍失败：同一自然语言短剧请求第一次只有 1 条主推荐并混入弱相关材料；尝试把具体作品详情提升为主卡后，又把 3 个明显不相关的开放作品目录条目带入推荐，该试验已撤回且未部署。响应性通过不等于推荐能力通过。
- Red 审计确认：非 Responses 当前模型仍走旧式“意图解释 → 多路候选 → 每 4 条分批角色判断 → 确定性拼装”，没有让完整 Digital Self 与全候选窗口进入一次整体最终选择。停止继续修改 `classifyCandidateRoles` 或增加主题/站点特例；下一实现改为“成熟 Search/Source 只供候选 → 当前模型以本次要求 + Digital Self + 明确控制 + 短期上下文一次性最终选择 → runtime 只校验机械事实”。备选的“强制改用 Responses 模型”因破坏模型中立暂不采用。完整证据见 Session 07。
- 上述 Red 重构已在隔离工作树落实：非 Responses 显式发现不再调用旧 `runContentSeek`；当前模型在同一工具环自主调用通用 `web_search`，同时看到有界 Source 候选窗口、本次请求、完整 Digital Self、明确内容控制和短期上下文，并用 `present_results` 一次整体交付。runtime 只接受真实 candidate ID，伪造 ID 会返回同模型纠正；Search 请求仍只发送 query，不接触 Digital Self。
- 榜单/报道只作推荐依据的新合同已落实：候选页面本身是对象时直接交付；当多个公开来源明确支持具体对象但没有对象页时，模型可交付无伪造 URL 的推荐对象卡，卡片单列“看推荐依据”。第一次在已有候选时空交付会在同一模型工具环内复核一次，runtime 不替模型选择。
- 工程证据：TypeScript 构建通过；推荐、Source、Portfolio、Reservoir、Personal Feed、搜索额度、代次和来源身份聚焦回归 77/77 通过。全仓测试不是当前绿基线，运行中出现多个与本次路径无关的既有真实协作/MCP/CTO 失败和长轮询，已停止，不能写全仓通过。
- 真实 Electron 最终门已通过：宽泛推荐原句 22.483 秒完成，交付 3 个具体主推荐和 2 条榜单依据；无关开放作品库条目为 0，依据 URL 没有冒充作品 URL。具名「持械入宋」18.430 秒完成，交付 4 张主卡和 2 张相关卡，能够理解对象、说明内容并给出可核实来源。此前小时限额阻塞等待自然恢复后才复验，没有换令牌绕过。
- 开发者验收之后已生成并安装独立 Owner 试用构建，Owner 于 2026-11-22 给出限定接受。该结论只接收本轮关联度、无关内容控制、响应与连续供给改善，不代表直接观看入口、发布或整体市场 50% 能力通过；仍未 push、合并或公开发布。

- 已实现 72 条中立候选 Reservoir、规范去重/来源轮转、持久 Source Portfolio、普通用户来源管理投影、真实摄入后登记和可逆启停。
- 已实现低于 24 条时的后台补量与 Digital Self 个人预排序；结果只在原队列耗尽且上下文一致时接入同一缓存，不替换当前页或建立第二事实源。
- Feed 来源已保存并使用 ETag / Last-Modified，304 作为成功未变化检查；当前默认目录中需要续页的 Internet Archive 与 Wikimedia Commons 均从同一 Source Portfolio 保存并消费协议 cursor，Commons 图片/音频/视频三流互不覆盖。
- 本地已排队 `content.more` 50 样本 P95 96.11 ms（门槛 300 ms）；这不是 Electron 渲染或等待网络补量的时延。
- 严格 30 分钟来源门同时抽样正文可消费性，并只统计当前健康来源：23 个健康来源、22 个域、文章/图片/音频/视频 4 种表达，终局 Reservoir 72 条 / 23 来源；Science News 的正文 403 没有被后续 304 假恢复。
- 30 分钟末轮 19/19 到期 Feed 成功、2 个真实 304；Commons 图片 continuation 从已有 token 前进，音频/视频 `gsroffset` 8→16。Internet Archive 继续被 SSRF 安全门拒绝，没有为做绿报告放宽边界。
- 50 请求 × 3 脱敏 Digital Self 的 150/150 真实模型运行通过：Top-12 可用相关率 80.78%、明确条件遵守率 99.67%、来源可打开率 100%、三主体平均重合率 34.51%。
- 严格来源报告驱动的真实模型连续 5 页通过：5×12、60 条唯一卡、21 个来源、规范重复 0、单源最高 6.67%、5 种表达、60/60 原文可打开。
- 正式 Electron v10 通过：当前代码连续显示 60 张唯一卡和 60 个原文动作；来源列表 28→29，用户加入 BBC 中文公开 Feed 后真实读入 24 条，停用/启用往返通过；两张截图已视觉复核。
- 构建通过；Source / Portfolio / Reservoir / Selection / Personal Feed / generation / SSRF 专项 59/59，通过；调整推荐 / 屏蔽与反转 / 重置 / 来源反馈 33/33 通过；本地 `content.more` 50 样本 P95 96.11 ms（门槛 300 ms）。
- 全仓测试尝试仍混入既有真实协作、真实模型和长轮询失败，本批不写全仓绿色结论，也不扩大任务去修协作系统。查询型 API cursor 继续只属于具体检索会话，不伪装成来源级全局 cursor。
- 本批技术证据：[`../audits/DISCOVER-50-STAGE1-RECOMMENDATION-AND-UI-SESSION-06.md`](../audits/DISCOVER-50-STAGE1-RECOMMENDATION-AND-UI-SESSION-06.md)；严格化前的来源健康史见 [`../audits/DISCOVER-50-STAGE1-SOURCE-HEALTH-SESSION-05.md`](../audits/DISCOVER-50-STAGE1-SOURCE-HEALTH-SESSION-05.md)，API cursor 见 [`../audits/DISCOVER-50-STAGE1-API-CURSOR-SESSION-04.md`](../audits/DISCOVER-50-STAGE1-API-CURSOR-SESSION-04.md)。

### 退出条件（历史；2026-11-22 已满足）

此前技术门保留为历史工程证据，但当时不足以支持“第一阶段技术候选通过”。Session 07 的三类失败随后已在正式 Electron 入口关闭，独立技术门与 2026-11-22 Owner 体验门均已执行；结果为限定接受而非直接观看能力通过。下一缺口转入 `DISCOVER-WATCH-ENTRY-01`。

---

## 0. 当前覆盖指针（2026-10-09）

**任务名：** `DIGITALME-UNIFIED-CAPABILITY-01`
**状态：** `IMPLEMENTED / SUPPLEMENTAL_VALIDATION_COMPLETE / OWNER_REVIEW_REQUIRED`
**覆盖关系：** 本节按 Owner 2026-10-09 明确指令，临时覆盖下文 `PUBLIC-ALPHA-CONTENT-RELEASE-01` 的“下一开发任务”指针；既有发布任务与验收结论不删除、不扩大。

本轮只在隔离分支/工作树实施，不修改已有 `codex/core-link-01` 工作区，不 push、不公开发布。实施基线为 `5c0584faa4cd5b51a6e758955e77eaabf5330ad4`；公开试用包源码仍单独记为 `54adc4adcb0c1c55941837625a6a37dd05453ca2`，不得混称同一对象。

### 2026-10-11 收尾批次边界

1. 先把 2026-10-10 已保存的真实区块链 UI 卡片与供应商 trace 规范化为离线回放输入，经同一 Responses 适配器、内容存储和真实 Electron UI 验证；该回放只证明确定性链路，不冒充新的供应商效果验证。
2. 来源完整性只做机械身份与执行事实约束：站点首页/搜索结果页不得承载具体文章卡；带非搜索类查询参数的具体文章不得误杀；正文状态必须来自 trace。禁止增加媒体黑名单、关键词路由、相关性评分、自研排序或固定研究流程。
3. 离线完整链路通过后，本补验批次在既有准入占用 `CNY 1.6078902 / 2.00` 之上最多再预留 `CNY 0.30`，只发起一次真实区块链 Discover 请求；不足则停止。完成后以实际 trace 计费，超时/缺 trace 保留预留且不按 0。
4. 最终证据必须同时包含：离线回放 UI/存储/trace、唯一一次真实 UI 结果、咨询与成果 attempt-2 原始记录、取消实际覆盖阶段。通过只允许表述为“限定新闻/网页接入可供 Owner 体验”；视频、P95、真实 Digital Self 与整体产品可用性仍未验收。
5. 允许修正来源身份、日期来源依据与验证脚本；不得扩展产品功能，不合并、不 push、不打包、不发布。完成后本地提交并停止。

### 2026-10-11 收尾结论

1. 真实区块链旧响应经同一 Responses 适配器、runtime、内容缓存与真实 Electron UI 离线回放通过：两个首页退出，五个具体文章保留，缓存 ID、来源 URL、正文状态和展示日期与 trace 一致；带 `q/query` 等查询参数的深层文章不再被误杀，结构化搜索页仍拒绝。
2. 在既有补验占用 `CNY 1.6078902` 上事前预留 `CNY 0.30` 后，只发起一次真实区块链请求。结果 `completed`，2 次搜索、4 次正文、1 次结构化交付，10 张具体文章卡、0 个首页/搜索页冒充；已知费用 `CNY 0.0759397`，本批最终准入占用 `CNY 1.6838299 / 2.00`。
3. 咨询与成果 attempt-2 原始记录保留；取消只证明前置 Digital Self interpret provider 请求可被中止且无迟到成果，尚未证明搜索工具启动后或文件写入中途取消。
4. 结论：**限定新闻/网页接入可供 Owner 体验**。视频、P95、真实 Digital Self、普通用户全环境和整体产品可用性仍未验收；本任务完成后停止，不合并、不 push、不打包、不发布。
5. 完整证据：`review/unified-capability-01/CLOSEOUT.md`。

### 2026-10-10 补验批次边界

1. 继续使用当前隔离工作树、虚构/公开数据和北京 Responses 接入；不得上传真实 Digital Self，不扩展视频、打包、发布、push 或合并。
2. 先以无付费延迟/挂起桩证明验证脚本只在请求真实启动后计时，并等待请求完成或明确取消；瞬时 assistant 占位节点不得作为完成证据，任何遗留在途请求均不得进入下一用例。
3. 真实 UI 只补：咨询、明确制作及成果打开、授权允许/拒绝、运行中取消、对已有新闻结果追问比较、一次区块链来源质量复验；不重复三组已成功的完整搜索。
4. 新增整批目标预算 `CNY 2.00`，在既有准入占用 `CNY 1.8442125` 之外单独记账；总准入边界为 `CNY 3.8442125`。每次请求须事前预留，逐请求记录可计算费用；超时/取消在途费用记未知并保留预留，不按 0 释放；达到边界不再启动新请求，零自动重试。
5. 仅可修复上述真实 UI 闸门直接暴露的等待、取消、授权、成果和来源事实缺陷。每项必须以用户目标完成证据判定，HTTP 200、单测、约束文字和 mock 只作为局部工程证据。

### 2026-10-10 补验结论

1. 真实 UI 已通过：能力咨询不申请目录权限；明确制作写入应用成果区并真实回读；外部目录授权等待与拒绝后不写入；已有两文正文读取、来源绑定比较及上下文不串题；运行中取消落 `CANCELLED`，无迟到 turn 和成果。成果卡的真实文件与“打开”动作已执行；打开回执随后补齐并以无付费 Electron 真文件测试通过。
2. 区块链唯一一次质量复验中，7 张卡片的正文状态均与供应商 trace 一致，但 2 张具体标题仍绑定媒体首页，因此该项真实 UI **失败**。已复用现有 `isGenericHubUrl` 加来源完整性门，首页/搜索页不再作为具体文章展示；离线实测 URL 回归通过，遵守“只补一次”而未再次付费复验，不能宣称该缺陷已通过真实 UI。
3. 补验直接暴露并修复：验证脚本把瞬时节点当完成的风险、取消信号未贯穿前置 Digital Self 请求、fresh Subject 缺少诊断目录导致 trace 丢失、成果打开无成功反馈、首页冒充文章。未新增关键词路由、查询扩展、相关性评分或固定研究流程。
4. 新增预算已知可计算估算 `CNY 0.0578902`，未知在途/缺 trace 保守预留 `CNY 1.55`，新增准入占用 `CNY 1.6078902 / 2.00`；连同既有占用总计 `CNY 3.4521027 / 3.8442125`。未知费用未按 0，未自动重试，未越界。
5. 结论：咨询、成果、授权拒绝、比较、取消可进入 Owner 审查；区块链来源完整性修复仍需未来单独批准的真实 UI 验收后才能标记通过。本任务停止，不合并、不 push、不打包、不发布。

### 唯一路线与边界

1. Talk 与 Discover 的显式新闻/网页请求共用北京 Responses provider adapter；主模型自主决定搜索、正文读取、补缺、纠错与停止。供应商可替换边界、SecretStore、Digital Self、Thread/Goal、来源身份、授权、执行事实和成果链继续保留。
2. Discover 的显式搜索退出旧 `discover-intent`、RSS 优先、固定候选角色/排序、日期追问和不合格候选兜底主链；结构化展示只作为 UI 交付 schema，不替模型做相关性或时效判断。默认个人内容流不在本轮重写。
3. 当前请求、同 Thread 历史、长期 Digital Self/偏好、产品默认分别标区；真实来源、正文读取成功/失败、调用、终止原因、耗时、usage 与费用估算作为执行事实保存。
4. 咨询直接回答；明确委托直接执行。应用成果区属于既有产品范围，不先申请桌面目录；只有实际外部路径、账号、付费、外发或不可逆动作需要对应授权。禁止关键词分类和固定“咨询→确认→执行”流程。
5. UI 状态只来自 runtime/provider 真实事件；删除 Talk 的 8 秒猜测文案。取消必须落真实取消事实，迟到结果不得覆盖当前请求。

### 验收门

- 编译、专项回归与真实 Electron 隔离用户数据三项分别记录；mock 只证明工程合同。
- 真实 UI 覆盖：数字货币最新报道 → 两文观点比较 → 同会话切换区块链；未见过的新闻主题；播客能力咨询 → 明确委托生成应用成果；等待授权、取消、成果打开。
- 沿用 capability-plan-01 的 2 元整批目标预算：既有可计算费用 `CNY 0.1847536`；本轮新增可计算费用 `CNY 0.1594589`；既有超时/误启动及本轮 Talk 在途请求合计保守预留 `CNY 1.50`，当前准入占用 `CNY 1.8442125`。未再发起付费复验，不把未知费用按 0 处理。
- 儿童视频、P95、真实 Digital Self、普通用户整体可用仍为未完成专项，不因本轮新闻/网页通过而宣称成立。

### 本轮实现与审查结论（2026-10-10）

1. 已在隔离分支实现北京 Responses 统一适配器、Talk/Discover 共用、上下文分区、应用成果工具、来源读取事实和真实事件状态；显式 Discover 不再退回旧 RSS/日期追问/候选兜底主链。
2. 真实 UI 已证明数字货币、区块链换题和未见主题可完成搜索、正文调用与展示；三次成功请求合计 6 次搜索、8 次正文工具调用，已保存原始脱敏记录与截图。区块链结果暴露“具体标题绑定媒体首页”质量缺陷，已收紧模型交付合同，但尚未付费复验。
3. Talk 的真实 UI 批次因验证脚本竞态而未形成有效完成证据；同时发现 Digital Self 前置解释仍走旧 Chat Completions，现已改为同一 Responses 适配器且禁用联网工具。咨询/成果链只有本地合同测试通过，等待授权、取消、成果打开仍未通过真实 UI 闸门。
4. TypeScript 全量编译、适配器专项 4/4、Talk/Digital Self/成果专项 3/3、JS 语法与 diff whitespace 检查通过；真实产品模式无凭据隔离启动成功。以上均不得扩大为 Talk、整体产品或发布候选通过。
5. 当前不打包、不发布、不进入 Authority 合并。Owner 审议后，如继续，应另批预算只做一次修正后的 Talk/授权/取消真实 UI 闸门；视频仍另列专项。

### 禁止

- 不新增关键词路由、任务类型白名单、手写查询扩展、自研评分/排序、固定研究流程或第二套 planner/reviewer。
- 不复活旧 conversation-search、Bing/RSS 主链或有限内容池作为统一能力底座。
- 不采购、不充值、不上传真实 Digital Self、不打包（除非内部验收确有必要且只保留一个候选）、不发布。

---

## 2026-10-07 GitHub限定试用已发布

Owner授权已执行：v0.2.0-core-link-trial-win-x64-54adc4a为Pre-release，tag/包内gitHead固定54adc4adcb0c1c55941837625a6a37dd05453ca2。源码/记录推送codex/core-link-01；三附件重新下载哈希和ZIP内gitHead一致。未动main/服务配置/付费搜索。公开限制保留。结果：review/core-link-02/final-review/GITHUB-PUBLISHED-RESULT.md。

## 2026-10-07 Owner发布授权记录

Owner已明确授权push本轮源码与交付记录，发布tag固定产品提交54adc4adcb0c1c55941837625a6a37dd05453ca2；仅发布安装包、ZIP和SHA256清单，重新下载核对。实时搜索/实际观看停点/干净Windows安装未验收、未签名，不宣称整产品或95分位验收。无线上服务配置/付费搜索变更。既有不push、不发布约束由本次明确授权覆盖。

## 2026-10-07 最终候选54adc4a检查点

Owner追加12应用/36尝试与现有余量共用，最新本批10应用/10供应商尝试、无重试、usage83818；共享18/22应用、18/66尝试，usage111939，余4未使用。产品自行分次计划真实读写回读已完成，修复Goal回执被误当文件完成的真实问题；TypeScript编译、相关6项回归、一次最终打包与0模型成果点击通过。体验候选54adc4a，人工稿仅对照；实时搜索、真实观看停点、干净Windows与Owner验收未完成。不部署、不push、不发布。完整报告见review/core-link-02/final-review/FINAL-DELIVERY-20261007.md。

## 2026-10-07 较早10724f0检查点（历史保留）

隔离任务分支 `codex/core-link-01` 已形成源码10724f0的本地Windows候选，不变更以下Authority分支或正式观察版8d888b09。Goal纠正实际保存、Talk与Discover使用及重启已有3次托管调用证据；发现纯目标条件混入Self，作用范围合同补修离线64项通过，并已补3次真实托管调用，Self认识6→6全字段一致，Goal/Talk/发现/重启恢复通过。分页丢失选择已在最终打包程序核对两个实际带入ID及文件打开，0模型。

Owner本次额外授权4应用请求，与原余1合计最多5；真实范围补验用了3，扩展共享账本累计8/10应用、8供应商尝试、无重试，usage28121，余2。日志通过现有阿里云CLI只读核对。当前体验候选10724f0，未变产品代码或重打包；不重跑已通过比较与计划链。下一步独立缺口为产品分次计划生成质量及实时供给，不用人工审校替代。审校分次计划不是产品生成能力验收；实时搜索未验收。未闭合前不push、不发布，不启用付费搜索/Gemini，不部署。具体报告：[最终本地审查](../../review/core-link-02/final-review/FINAL-REVIEW.md)。

---

## Repository Authority

### CURRENT AUTHORITY

```text
CURRENT AUTHORITY BRANCH:
build/tujimi-ui-minimal-integration-01
```

当前 Authority 为本文件所在的最新已提交 HEAD；每次 accepted 产品开发或治理提交后，该 HEAD 线性前进。不把某个 SHA 永久硬编码为本文件的 Authority HEAD。

### ACTIVE DEVELOPMENT RULE

默认：

```text
所有当前产品开发在唯一 Authority 线上线性推进。
```

不得再默认：

```text
one task = one branch = one permanent worktree
```

只有确实需要高风险隔离、长时间并行、明确实验，或 Owner / CTO 要求时，才创建临时 task branch/worktree。

### NEW TASK GATE

所有后续开发任务在开始前必须确认：

```text
1. AUTHORITY_HEAD
2. CURRENT_ACTIVE_BRANCH
3. ACTIVE_WORKTREE_STATUS
4. Build-vs-Integrate Gate
```

若任务指令中的旧 SHA 与当前 Authority 不一致：以当前已提交 Authority 为准，不得机械从旧 SHA 新开开发线。

### DIRTY WORKTREE RULE

历史 DIRTY worktree：

```text
FROZEN / NOT AUTHORITY
```

不得：作为新任务基线；从其中未提交 CURRENT-PLAN 判断当前权威状态；stash / reset / clean / checkout 覆盖；未经单独审计直接合入 Authority。

### TASK BRANCH LIFECYCLE

临时 task branch：

```text
建立
→ 开发
→ 验证
→ Owner / CTO ACCEPTED
→ integration 回唯一 Authority
→ 移除 task worktree
→ branch 归档或安全删除
```

禁止 accepted 后长期漂浮形成第二主线。

### MAIN RULE

当前：

```text
origin/main ≠ development authority
```

它仍是公开历史线。后续是否 reconcile / 升格，必须单独决策。

---

## 1. 后续唯一战略顺序（2026-09-08）

Refoundation Phase 1–3 已作为地基接受（见 §3）。**后续产品建设**按下列顺序，不得把四段同时当施工面，也不得在 Phase A 无限停留。

```text
Phase A  基础能力达到约 95 分位     CURRENT（Integrate-first；Coding 路线已证明）
Phase B  做实数字之我                 NEXT（增强，不限制模型）
Phase C  连接与自主选择               LATER
Phase D  Digital Subject Network      THIN SLICE ACCEPTED（Distributed Personal Selection；不做完整 Feed 产品）
```

核心定位（00）：**Digital Self / AI Capability / Digital Subject Network**。对外：**属于我 · 能做事 · 连接世界**。协作是 Subject Network 的一种应用，不是第三核心总称。

### Phase A — 基础能力达到 95 分位

**原则：** Integrate-first。能接不造。

重点接入（不自研替代成熟能力）：Coding Agent、Web、Computer Use、Office、Excel、图片、音频、视频、MCP / Skills。

当某项成熟外部能力已经能满足约 95 分位：停止继续自研该基础能力。研发转向数字之我、安全、授权与真实执行事实。

**2026-09-06 已部分闭环（Integrate-first，未自研替代）：** Talk / reasoning；Web search；authorized local files；Word/PPT 基础文件输出；Coding Agent（Codex + Windows 官方 `windows.sandbox=unelevated`）。

**2026-09-08 已证明 AI Capability 路线：** Zero-start Coding Talk Gate `ZERO_START_CODING_TALK_ACCEPTED`（Authority `24e1ce9`）。用户无现成 Coding Agent 时，2digime 可 acquire 成熟 runtime、复用聊天凭证、真实改项目、真实跑测试、把本次 delta 如实交给模型与用户。不自研 Coding Agent。

**尚未达到完整 95 分位：** Computer Use；专业 Office / PPT；Excel；图像；音频；视频；更丰富成熟 Agent / Tool 接入。这些仍须先过 Build-vs-Integrate Gate，**不要因为列表存在就自建**。Computer Use **今天仍 NOT STARTED**。

### Phase B — 做实数字之我

重点：输入资料、对话、成果、纠正、工作经验、协作经验、网络选择 → 模型理解 → Digital Self 持续成长 → 应用于下一次真实任务与网络选择。

Digital Self 不限制模型，只增加主体上下文。禁止用 Digital Self 削弱、隐藏或锁死。Digital Self 是这个人的个人选择算法，不得另建统一中心推荐代替它。

**2026-09-08：** `DIGITAL_SELF_NETWORK_EVOLUTION_ACCEPTED`（04 §15）。真人经 Talk 明确表达后，现有 Digital Self Core 写入唯一 `self.json`（V1→V2）；同一 Relay 候选池上的本地 Personal Selection 发生可解释变化。2digime 自己的 SHOW/IGNORE 与模型理由不得反写为用户事实。未建第二套 profile / 推荐记忆。

### Phase C — 连接与自主选择

兔机米根据目标、数字之我、真实能力与授权，由大模型自主选择：模型、Agent、Tool、本地软件、网络能力、其他 Digital Self。系统不写 router / score / workflow 代替这些判断。

### Phase D — Digital Subject Network / 新模式

**2026-09-08：** Digital Subject Network substrate 审计已完成（04 §13）。`DIGITALME-SUBJECT-NETWORK-FEED-01` 已证明：**同一 Relay 返回完全相同候选池，不同 Digital Self 的 2digime 自主选出不同内容；Relay 不参与个性化。** 裁定 `DISTRIBUTED_PERSONAL_SELECTION_ACCEPTED`（04 §14）。同日 `DIGITALME-DIGITAL-SELF-NETWORK-EVOLUTION-01` 证明：**同一主体 Digital Self 经 Talk 演化后，面对未变候选池，选择发生合理变化**（04 §15）。禁止另起 `subject-network-v2` / `feed-runtime` / `new-relay`。不把 Opportunity 冒充内容分发。不开始 Computer Use。不恢复 `#nav-collab`。

**2026-09-14：** `CONTENT-DISTRIBUTION-MINIMUM-CLOSED-LOOP-01` 整体闭环验收 `CONTENT_DISTRIBUTION_MINIMUM_CLOSED_LOOP_ACCEPTED`（审计 `docs/audits/CONTENT-DISTRIBUTION-FINAL-CLOSURE-01.md`）。允许保留 Talk 旁路 Discover 与包内显式内容偏好。**仍禁止**独立 Feed 产品、中心推荐、社交网络和恢复协作中心。移动端仍 deferred，命令边界已留在 `src/` + `content`。

**2026-10-04（Discover，不是新 Phase）：** 限定试用接受仍是 `230cfc6`。质量工程线停在 `8d888b0` / 试用包 `8d888b09`。暂停扩来源和连续打包，转入使用反馈观察（`docs/reviews/使用反馈-5.md`）。配额与 CASE R3 继续跟踪。未 push、未发布。不另开独立 Feed 产品。

前三项能力仍须对真人成立；不把 Phase 3 协作试验扩成广播市场；不恢复 `#nav-collab`。中间服务（Relay / Index / Search 等）是服务商，不是网络主人。

### 与已接受 Refoundation 的关系

Phase 1 Digital Self、Phase 2 Talk 主链、Phase 3 协作地基仍然有效，不推倒重来。Phase 3 对象视为 Subject Network 的已有 substrate。两 Owner 真人试验（见 §3）可继续，但不扩建协作产品面，也不用新 runtime 替换已有 relay / discovery。

---

## 2. 下一开发任务

**任务名：** PUBLIC-ALPHA-CONTENT-RELEASE-01
**状态：** `IN_PROGRESS`（2026-09-14；Authority `origin/main` = `dc50eda0924f7def8b144a0f238532329378d07b`）
**目标：** 为已验收的内容分发最小闭环形成新的 Windows Public Alpha 可下载安装版本；公开 `CONTENT-SUPPLIERS.md`；README 增加供应商入口；验收后更新 GitHub `main`、tag 与 Release。
**禁止：** 继续开发新的内容功能；虚构公网 API / 供应商 portal / 结算 / 移动端；force / merge / rebase / cherry-pick；把 PLANNED 写成当前能力。
**工作区：** `D:\Projects\dm-public-alpha-content-release-01` / `release/public-alpha-content-01`，从 `origin/main` `dc50eda` 建立。
**版本意图：** 当前公开 Windows Alpha 仍为 `0.1.x` / `v0.1.0-public-alpha.1`；本轮含已验收新产品能力，取 next minor `0.2.0`，tag 遵循既有 `v0.2.0-public-alpha.1`。

**已接受（同线，不再当下一步）：** `CONTENT_DISTRIBUTION_MINIMUM_CLOSED_LOOP_ACCEPTED`。

**任务名：** CONTENT-DISTRIBUTION-MINIMUM-CLOSED-LOOP-01
**状态：** `ACCEPTED`（`CONTENT_DISTRIBUTION_MINIMUM_CLOSED_LOOP_ACCEPTED`，2026-09-14 整体闭环验收；前序 SUBJECT-NETWORK-REAL-CONTENT-TRIAL 两人闸门仍冻结 `REAL_USER_GATE=1/2`，独立）
**目标：** 用真实内容打通最小闭环：供给 → 中立目录 → 既有 NetworkItem/broadcast/relay → 接收侧 Digital Self 选择 → Discover 消费 → 显式偏好 → 下一轮选择；以及自然语言主动获取。不是中心推荐、不是 CMS、不是社交网络、不做原生移动端。
**禁止：** 自研爬虫/搜索引擎/推荐模型/中心用户画像；把 AI SHOW/IGNORE 写回偏好；Relay 个性化；把 trial HTML scrape 升成产品子系统；恢复 `#nav-collab`；push / merge / rebase（另令除外）。
**工作区：** `D:\Projects\dm-content-distribution-01` / `build/content-distribution-minimum-closed-loop-01`，线性基于 `7d10e865c9c655693a0047c832ec69217a87a43d`。
**计划 / 审计：** `docs/plans/CONTENT-DISTRIBUTION-MINIMUM-CLOSED-LOOP-01.md`；`docs/audits/CONTENT-DISTRIBUTION-CAPABILITY-AUDIT-01.md`；`docs/audits/CONTENT-DISTRIBUTION-FINAL-CLOSURE-01.md`。

**已接受（同线，不再当下一步）：** `SUPER_ASSISTANT_L1_ACCEPTED`；`RESULT_DELIVERY_FINAL_FALLBACK_ACCEPTED`；`PUBLIC_ALPHA_UX_RECOVERY_ACCEPTED`。

**任务名：** DIGITALME-SUPER-ASSISTANT-L1-01（人的超级助手 L1）
**状态：** `ACCEPTED`（`SUPER_ASSISTANT_L1_ACCEPTED`）
**目标：** 把「数字之我 + 超级助手」写入现行产品定义；Talk 主链落实 MODEL DIRECT / SPECIALIST / MULTI-CAPABILITY；通用 capability 合同与可复用 acquisition；修复 final result 交付 P0。当前只做 L1 + L2 最小基础。
**禁止：** 新 Agent/workflow 框架；视频/图片/数字人专项；UI 改版；能力商店；keyword router；第二套状态机；push / package / release（另令除外）。

**已接受（同线）：** `RESULT_DELIVERY_FINAL_FALLBACK_ACCEPTED`；`PUBLIC_ALPHA_UX_RECOVERY_ACCEPTED`（恢复多对话侧栏接线 + Enter/IME + 附件文案；不新建 task framework）。

**并行保留（未取消）：** 干净 Windows 机复验已固化 ZIP

**任务名：** 干净 Windows 机复验已固化 ZIP（同一 SHA256）
**状态：** `NOT STARTED`（下一执行指针）
**阶段：** `PUBLIC_ALPHA_WINDOWS_CANDIDATE_LIMITED`。包已打出，**尚未**干净机 zero-start。Public Alpha **尚未发布**。
**禁止：** 重打包装却沿用旧 hash；把本机构建机预验收当成 ACCEPTED；做 P1 / Computer Use / Feed。

**已固化 Candidate（不得当新包混用）：**

```text
SOURCE_SHA  e3307519f4de4bcbee87e4278e86c697ee1806f5
FILE        兔机米-0.1.0-win-x64.zip
SHA256      5dedd6bc3882ec664ec8b78a2fecb123e9e6b93fa60bac653661191a3eef858d
```

**本轮指针：**

1. ~~公开 README / 试用说明~~ DONE。  
2. ~~`npm run build:packaged`~~ DONE（上述 ZIP）。  
3. **NEXT：** 全新 Windows VM / 另一台无 Coding Agent 的机器：只传 ZIP + SHA256 → 解压双击 → 连接 AI → Talk → 数字之我 → 无 USER_EXISTING 的 HTML 主题任务。  
4. 通过后才 `NEW_PUBLIC_BASELINE` 与 `DIGITALME-PUBLIC-ALPHA-PUBLISH-01`。  

已接受：Public Alpha Readiness 审计（06）；`PUBLIC_ALPHA_SURFACE_ACCEPTED`（05 P0，7 项）；`DIGITAL_SELF_NETWORK_EVOLUTION_ACCEPTED`（04 §15）；UI Recovery Audit（05）；`DISTRIBUTED_PERSONAL_SELECTION_ACCEPTED`；substrate 审计（04 §13）；`ZERO_START_CODING_TALK_ACCEPTED`（`24e1ce9`）；`STRATEGIC_ALIGNMENT_ACCEPTED` / `EXECUTION_TRUTH_RESTORED` / `CODING_CAPABILITY_REAL_AND_INTEGRATED`。

05 §9 的 P1（会话列表、Talk 内网络结果、成果轻预览、CSS 合层）、Computer Use、Feed、协作中心：**发布之后**，不是现在。

不要做完整 Feed 产品、不要做订阅/关注、不要恢复协作中心。历史已接受任务（Talk ↔ Digital Self Learning、Zero-start Coding 等）见 §3，不再当作「下一步」。

一台机器时必须两套完全独立的 Electron `userData`（`DIGITALME_V2_USER_DATA`），不得共享 Package、Thread、SecretStore。

---

## 3. 已接受的 Refoundation 地基

下列 Phase 1–3 条目仍是已接受地基，不是当前「下一步」。不得用旧模块轮动代替 §1 的 A–D。

### Phase 1 Digital Self（已接受）

**状态：** `ACCEPTED`

已成立：全系统一个 Digital Self authority；用户直述可写入；资料只形成候选；纠正有效；删除有效；重启保持；不读取旧 Growth / Profile / material facts 作为「我」。

唯一权威文件：SubjectPackage 内 `digital-self/self.json`。

脱敏验收摘要：[`02-DIGITAL-SELF-ACCEPTANCE.md`](./02-DIGITAL-SELF-ACCEPTANCE.md)。原始本地闸门证据不入库。

### Phase 2 Core Interaction Loop（已接受）

**状态：** `ACCEPTED`

已成立：对话是统一入口，做事是同一入口里的行为与结果。自然语言 → 当前 Digital Self → 模型 native `delegate` → External Capability 真实执行 → execution truth → 2digime semantic review → 同一 Thread。无 intent classifier、无关键词路由、无任务类型枚举。确定性 runtime 已知失败时，review 不得改写成成功。Talk 中具有持续意义的本人表达回流到同一 `self.json`，一次性事务不沉淀。

不迁旧 work / conversation runtime，不把 Job 当用户任务。

### Phase 2 Talk ↔ Digital Self Learning（已接受）

**状态：** `ACCEPTED`

已成立：用户只在「与 2digime」说话即可更新唯一 Digital Self。沿用 Phase 1 tell 的确认 / candidate / conflict 规则。纠正覆盖旧 current。默认不弹「是否保存到数字之我」。打开「数字之我」可见刚通过 Talk 形成的当前理解。正式 Electron + DeepSeek 已验证真人原句写入、纠正替换、一次性日程不沉淀。stub 不是产品路径。

### Phase 2 Product Surface（已接受）

**状态：** `ACCEPTED`

已成立：一级导航为「与 2digime / 数字之我 / 设置」；默认进入「与 2digime」；旧对话/做事/协作标签退出普通用户主路径。结果卡是文件名 + **打开**为主动作。附件路径只进入该次 talk 上下文。

Public Alpha P0 已落地：`PUBLIC_ALPHA_SURFACE_ACCEPTED`。KEEP / ADAPT / RETIRE / MISSING、Figma 裁决与 P1 清单见 [`05-UI-RECOVERY-AUDIT.md`](./05-UI-RECOVERY-AUDIT.md)。不得用旧四主栏 Figma 反写产品结构。

正式默认启动不再 attach 旧 Work Runtime / Job runner，也不再创建旧 Task/Job/work state。历史 `work.*` / `artifact.*` 仍可按需挂载，供开发与旧测试使用；这不是新产品 compatibility layer，talk / Digital Self / capability 不得经过该路径。

### Phase 2 / 3 仍不做

- **不迁旧 work runtime**
- **不修旧做事页**
- **不接旧 conversation runtime**
- 不把旧 `job-runner` 当新骨架
- 不继续 capabilityLoop / GENERAL-TASK-CLOSURE
- 不沿 DIGITAL-SELF-CORE-01 的 P1–P5 迁旧主链
- 不为绕开旧依赖增加 compatibility layer
- 不先做协作中心 UI，不恢复 `#nav-collab` 普通入口
- 不把另一 Subject 当 Tool / worker，不打开对方 Package 去 `submitTask`
- 不 push、不打包，除非 Owner 另令

### Phase 3 Collaboration Foundation（已接受）

**状态：** `ACCEPTED`

协作不是第三入口。用户仍只与自己的 2digime 交流；对端是独立 Subject，不是 Tool / Sub-Agent / 本方 worker。

外部标准判断与最小对象、第一版双 Subject 实验、禁止事项见 04。传输 KEEP Relay / E2EE。旧 `local-collaboration` 13 态与打开对方包 `submitTask`：**不接线**。

### Phase 3 Dual-Subject Loop（已接受 architecture/engineering pass）

**状态：** `ACCEPTED`（architecture/engineering pass）

正式入口「与 2digime」上，两个独立 Subject Package 完成一次合作闭环（内存 discovery 证明对象模型）。不做协作 UI、广域发现、真钱、信誉市场、多方。

### Phase 3 Real Peer Relay Gate（工程已接受）

**状态：** `ACCEPTED`（engineering）

discovery / transport 已接到 invite/peers + Relay/E2EE。不重写 AI collaboration logic。不新协作 UI、状态机、session、Task。

### Phase 3 Two-Owner Real Trial（进行中）

**状态：** `IN PROGRESS`

两个正式 Electron 实例之间的真实 Subject↔Subject。B 作为在线主体自主收件、判断、组织能力、回复。Owner A 只在原 Thread 看结果。必须另验一条 B 自主拒绝、A 自然恢复。本轮仍不扩功能。

---

## 4. 现场保护（仍有效）

- **干净 Phase 1 基线：** 分支 `checkpoint/2digime-refoundation-02`（worktree `dm-2digime-refoundation-02-checkpoint`）。只含已接受的 authority 文档 + 新 Digital Self。
- **Phase 2 核心闭环基线：** 分支 `build/2digime-refoundation-03-dialogue-doing`（本工作区）。含 talk 主链、External Capabilities 暴露、execution truth、semantic review。
- **冻结 legacy 工作区：** 分支 `build/subject-learning-availability-01` 仍停在 `1f4a7cf` 之上的未提交做事 UI / 能力闭环 / Digital Self Core：**保持原样**，不清理、不提交、不混入本基线。
- `digitalme-v2/`：未跟踪，不纳入。

---

## 5. 权威文件与降级清单

**现行唯一层级**

```text
AGENTS.md
  → 00-PRODUCT-CONSTITUTION.md
  → 01-DEVELOPMENT-CONSTITUTION.md
  → 02-FAILURE-LESSONS.md
  → 03-CURRENT-PLAN.md   ← 本文（排期）
  → 04-COLLABORATION-FOUNDATION.md   Phase 3 架构；不与 00/01/02 并列产品宪法
  → 05-UI-RECOVERY-AUDIT.md          Public Alpha UI 审计；不是宪法、不是 Current Plan
  → 06-PUBLIC-ALPHA-READINESS.md     发布前只读审计；不是宪法、不是 Current Plan
```

**降级（不删除）**

| 文件 | 新状态 |
|---|---|
| `AGENTS.md` | 仅入口（新写） |
| `docs/refoundation/2DIGIME-REFOUNDATION-BASELINE-01.md` | 01A 审计报告，不与四份 authority 并列 |
| `digitalme_context.md` | historical strategic context，不再承担 current plan |
| `digitalme_log.md` | append-only history |
| `digitalme_rules.md` | historical；吸收进 01/02（从 `433c3a8` 恢复到本工作区供对照） |
| personal-context / `project_sources/*` | 本 git 未找到；角色吸收进 01；全文待 Owner 补档 |
| DIGITAL-SELF-CORE-01 / ADR / 依赖图 | `frozen / absorbed_into_refoundation` |
| GENERAL-TASK-CLOSURE-01 | 不再作为当前执行计划 |
| 一切旧「当前执行指针 / 当前最高原则 / frozen_for_implementation 主线」 | historical / superseded |

---

## 6. 原则冲突（不自行猜）

已裁定（后续 Owner 指令优先）：

| 冲突 | 裁定 |
|---|---|
| 01A「下一步 = 最短 Goal 闭环」vs 01C「Phase 1 = Digital Self」 | **01C**：先 Digital Self |
| rules §14 模块轮动 vs 本文旧 Phase 1→2→3 | **已被 §1 战略 Phase A–D 覆盖**；1–3 为已接受地基 |
| 广播作为核心创新假设 vs 协作扩建暂停 | **不实现广播市场与协作中心 UI**；假设留在 00。Distributed Personal Selection 已用公开候选池证明，不恢复 `#nav-collab`，不另起 network runtime |
| 自研基础能力 vs Integrate-first | **2026-09-06：能接不造**；95 分位靠接入，不自研替代 Codex / 搜索 / Computer Use |
| 「后台可保留复杂状态机」vs 禁止用状态机替代 AI | **禁止替代 AI**；运行态 ≠ 永久状态机 |
| DIGITAL-SELF P1–P5 迁旧主链 vs 新核重建 | **不沿旧链 P1–P5** |
| 单一说话入口 vs 对话/做事双标签 | **对话是统一入口**；做事是行为/结果。产品表面仍可 refinement，不得双运行时 |

仍未决（用保守交集，不替 Owner 选产品形态）：

1. **本人事实写入门槛**（01A 决策 1）：低风险自动成候选并页上可纠正，还是凡事先问再写。在 Owner 回答前：**不得把模型或材料检测写成已确认身份**；候选允许存在。

**ChatGPT Personal Context** 与仓库 `digitalme_context.md` 不是同一对象。前者全文不在本 git。重叠的 Owner/CTO 纪律已从 `digitalme_rules.md` 与 context §5.4 吸收进 01。若 Owner 随后提供 `personal-context.md` / `05-personal-context-1-.md` / `project_sources/01-digitalme_context.md`，只做增量对照，不自动升为第五份权威。

---

## 7. PHASE 3 协作试验约束

Foundation（04）与 Dual-Subject Loop architecture/engineering pass 已接受。Relay 工程接线已接受。Two-Owner Real Trial 仍可继续，**但不扩建协作产品面，也不用新 runtime 替代已有 substrate。协作是 Digital Subject Network 的一种应用（00 §4）。**

约束仍是：

1. 实现者已读 00/01/02/03 与 04；
2. Owner 已接受 04，并已下达 Dual-Subject、Relay Gate 与 `2DIGIME-COLLABORATION-03-TWO-OWNER-REAL-TRIAL`；
3. 不迁旧 work / conversation runtime，不把旧 Job 当协作骨架，不打开对方 Package 当 worker；
4. 不先做协作页面，不恢复 13 态，不自研替代 A2A/VC/payment；A 不得驱动 B runtime / drain；
5. 出现 Yellow/Red 立即停（04 §11）。

Phase 1 与 Phase 2（核心闭环 + 产品表面）已 ACCEPTED。Zero-start Coding Talk 已 ACCEPTED。Distributed Personal Selection 第一刀已 ACCEPTED（04 §14）。未完成 checkpoint 验证前不得把旧冻结做事代码并入本基线。当前不要自建 Computer Use，也不要新写 network runtime。
