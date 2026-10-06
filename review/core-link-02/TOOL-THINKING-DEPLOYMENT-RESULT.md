# d974a9e 授权部署结果（2026-10-06）

部署成功，没有触发回滚。部署前线上三文件基线、候选二文件及运维清单全部一致；日志未结束provider请求0，8787端口已建立连接0。环境文件部署后仍0600/root:root，仅新增MANAGED_AI_TOOL_THINKING=disabled。model-http.js未替换。不开搜索、不push、不发布。

验证失败与中断已纳入DEPLOY-AFTER-APPROVAL.sh同一EXIT/INT/TERM回滚范围，验证成功才返回0。新增故障注入 validation/interruption 均通过，真实服务命令0、模型调用0；之前7项脚本故障和14项网关合同结果保留，不用这些离线结果替代线上验收。

线上实际2个应用请求、2次上游尝试，无重试；小于共用6/18上限。客户端requestId与网关provider_start/provider_result逐条对齐，有效maxTokens=2048；工具请求thinking=disabled；Self沿用既有无工具结构化配置。供应商均HTTP200/finish_reason=stop，returnedModel=deepseek-flash。

| 验证 | 有效结果 | 耗时 | input/output/total |
|---|---|---|---|
| 历史课程比较 | 有效完整对照，保留两个慕课网URL、每天一小时及价格/后续内容未知项，推荐先学AI产品落地指南课 | 回合5169ms，HTTP5160ms | 2394/810/3204 |
| 隔离Self | weekdayMinutes=30，weekendMinutes=60，scope=current_goal | 674ms | 84/19/103 |

总真实usage：2478输入、829输出、3307 tokens，来自供应商而非本地估算。费用待账单确认。历史摘要“中文站”不能证明字幕或当前报名条件，保留为限制。验证通过现有Talk执行器接本机线上/v1/ai/inference及Self结构化入口完成，未读取或写入正式Self；不是Electron完整课程联动验收。

完整部署脚本耗时6182ms；基线检查4ms、候选清单7ms、备份后复制与环境更新40ms、重启37ms、就绪阶段144ms、验证阶段5922ms。restart.begin至readiness.end为185ms，健康助手检查42ms/1次。185ms是该测量区间，不代表已经独立测出对外真实中断时间；6182ms也不代表服务全程不可用。

备份：/opt/digitalme-review-tool-thinking-20261006/backup-20261006T093006-801068。原环境及产品文件保留；后续需要回滚时使用该路径，不猜默认backup。候选线上哈希与已批准清单一致。

客户端集成：codex/core-link-01已包含691bb00、e338606、b9cf67f、cb84ea4、93b6bc5、456c08c等改动；8d888b09是祖先，无需将脏根目录强行merge或覆盖。正式观察安装未替换。本轮离线联动、来源边界、缓存范围与模型失败处理21项通过。Electron启动及空格路径预检通过；打包准备继续，不提前把尚未完成的学习计划纠正链写成已验收。

## 下一真实联动窗口预算（未执行）

沿用已保存的历史课程Goal，不再搜索或比较：
- 授权生成并回读两周计划：最多8个应用请求。
- 必要时单独模型读文件核验：最多2个；开发者独立磁盘回读0模型调用。
- 同目标纠正为工作日30/周末60分钟：最多4个。
- 重启后确认发现采用新条件并生成/回读修订计划：最多10个。
合计最多24个应用请求，沿用服务端每请求最多3次的硬限，最多72次上游尝试；不新增客户端自动重试。输出上限2048，最保守输出容量上限147456 tokens（含最多三次尝试），不是预计实际消耗。实际通常低于此容量；输入usage及账单仍应逐次记录。每回合共享90秒截止；任何截断、空正文、格式/网络错误、取消或预算到顶即停，不重复整链。当前6/18仅授权部署两项验证，即使剩4个请求也不挪作学习计划。

部署成功后，历史联动、新版打包复验和GitHub正式材料仍未完成；本轮只做客户端集成核对与打包准备，待下一真实窗口通过后给出候选hash和已修复/已知限制清单。不push、不发布。

证据：evidence/tool-thinking-deployment-result.json 与 evidence/tool-thinking-validation-rollback-fixtures.json；日志无密钥或本人材料正文。
