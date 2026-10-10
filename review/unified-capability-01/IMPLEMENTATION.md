# DIGITALME-UNIFIED-CAPABILITY-01 — 实施交付

**状态：** IMPLEMENTED / PARTIAL_REAL_UI_VALIDATION / NOT_RELEASE_READY

**隔离分支：** codex/digitalme-unified-capability-01-core

**实施基线：** 5c0584faa4cd5b51a6e758955e77eaabf5330ad4

**公开试用包源码（仅对照）：** 54adc4adcb0c1c55941837625a6a37dd05453ca2

## 已实施边界

- src/capability/adapters/responses-tool-loop.ts：北京业务空间 Responses/SSE 适配器；8192 总输出预算、零重试、store:false，记录阶段、工具、来源、usage、耗时和费用估算。支持同一传输在 Digital Self 解释时关闭 Web 工具。
- src/runtime/digitalme-runtime.ts：Talk、Digital Self 前置解释、显式 Discover 共用同一适配器。Discover 不再回退 RSS、日期追问或候选兜底链；模型自主搜索、读源、补缺和停止。具体文章必须绑定 canonical article URL。
- src/intelligence/loop.ts：当前请求、Thread 历史、长期 Digital Self/偏好、产品默认分区；咨询直接回答，明确委托使用既有应用成果区；外部路径仍按真实需要授权。
- electron/main.cjs、electron/preload.cjs、electron/renderer/talk.js、electron/renderer/content-discover.js：状态由 runtime/provider 事件驱动，删除 8 秒猜测文案；取消与迟到事件按 request id 隔离。
- src/subject-comm/content-discover.ts：展示正文成功、仅摘要、读取失败，不再把工具名称本身当作读取成功。多 URL 抽取只对输出中能对应的 URL 标记已读。
- src/runtime/tests/electron-harness.ts：Windows 含空格路径启动修复、外部依赖初始化、启动失败清理、发送状态竞态修复。

## 保留与退出

保留：Digital Self、Thread/Goal、来源身份、SecretStore、授权、执行事实、应用成果区、供应商可替换配置。

退出显式新闻/网页主链：旧 Discover 意图解释、RSS 优先、固定候选排序、日期追问、不合格候选填充。默认个人内容流未重写。

## 未新增的控制层

未新增关键词路由、任务白名单、查询扩展、相关性评分、固定研究流程或第二套 planner/reviewer。结构化 present_results 只负责 UI 交付；相关性、时效、来源和是否补搜由模型判断。

## 代码规模

当前既有文件 diff 为 11 个文件、约 634 行新增/50 行删除；另新增 Responses 适配器、2 个专项测试、隔离验证脚本与本报告。完整差异以本分支工作树为准。

## 隔离启动入口

工作目录：D:\Projects\Digital Me\.task-worktrees\unified-capability-01。

验证脚本：review/unified-capability-01/run-real-ui-validation.cjs。它只允许隔离 userData，凭据进程内读取并写入该隔离 SecretStore，结束时删除；当前预算准入已接近上限，**不得再次运行付费批次**，除非 Owner 另行批准预算。

## 交付判断

代码已完成限定接入，但真实 UI 闸门只部分通过。建议 Owner 审议本 diff；在另批预算下仅补一次 Talk、等待授权、取消、成果打开的真实 UI 验证。通过前不合并、不打包、不发布。
