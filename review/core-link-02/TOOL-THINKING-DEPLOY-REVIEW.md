# 工具推理配置：部署复审与整批收尾门（2026-10-06）

当前完成：仅两个服务端源码修改已编译通过；gateway-deadline-review-01 的14项回归通过，真实供应商调用0。新增验证工具首轮、无tools但含tool消息的续答、Self JSON、普通无工具请求，以及截断失败不重试/不缓存成功。其余既有14项中的相关检查因共享网关改动作必要回归，没有重复真实比较或文件测试。

配置：只新增MANAGED_AI_TOOL_THINKING=disabled，不改模型、2048上限、重试数量、Self配置或搜索付费。影响所有工具交换，普通Talk默认附带工具也受影响。role=tool是执行合同证据，不按课程关键词路由。独立B证据不等于线上验收。

候选文件见 tool-thinking-deploy/candidate.sha256，编译文件已暂存在该目录：
- server.js: 60c388dd132efda41ff0d9b8c0c1d4448609687752108a8694d995c7505548fb
- ai-inference-gateway.js: 96926134e97553f831c29f1987deb673258a5dd418171f38424545c16a778599

部署目录为/opt/digitalme-review-tool-thinking-20261006。不得复用旧暂存目录或旧备份。批准前不上传执行、不重启。部署时重新核对deployed-before.sha256的三项线上基线及candidate/operations清单；不一致停止。就绪与回滚复用已验证的10秒端口+/health机制，备份完整环境权限属主，失败自动回滚。此次只替换2文件，model-http.js仅备份核对不替换。脚本差异是目录、工具开关和删除第三文件替换；改后脚本Linux故障回归7项全部通过，证据见evidence/tool-thinking-deploy-fixtures.json；使用模拟systemctl与health，不触碰真实服务。原就绪助手未改，延迟监听、退出、持续健康失败与回滚延迟启动沿用0645093已验证范围，不重复执行。仍须Owner复审才能启动部署。

复审拟授权范围：完成脚本故障回归后空闲窗口执行如下命令，模型验证任一失败立即停止并运行本次备份回滚，不能把HTTP200当成功：
```bash
cd /opt/digitalme-review-tool-thinking-20261006
sha256sum --check candidate.sha256
sha256sum --check operations-files.sha256
bash DEPLOY-AFTER-APPROVAL.sh
# BACKUP由部署日志输出；回滚使用此完整路径，不能猜默认备份。
bash ROLLBACK-AFTER-APPROVAL.sh "$BACKUP"
```

空闲确认使用现有网关日志配对关联ID的provider_start与terminal记录，并结合当前连接；仅systemctl active或没有TCP连接不足以证明没有在排队的请求。尚未执行线上空闲确认。

线上验证建议先一次隔离历史两门课程比较，成功再一次隔离Self结构化输入“工作日半小时、周末一小时”，检查两种时长均保留。最多6个应用调用、18次上游尝试（当前服务端单请求最多3次），2048输出上限；到顶即停止。数量是拟预算，尚未授权，人民币需供应商实际价格/账单核对，不虚构金额。取消日志只报告发出取消，不冒充供应商确认停止。

之后按原顺序继续同一历史目标：明确委托计划、文件独立回读、纠正时长、重启后生成采用新条件的计划；禁用搜索、Gemini及开发凭证。先给该后续链明确调用上限，不能沿用已花完的7次或本轮取消窗口。临时条件存thread/Goal，持续本人信息仍由Self模型判断，不追加画像。

最后才合并已审客户端提交，保留根目录未提交工作；新版隔离打包、核对build-meta与文件哈希、正式入口复验，准备GitHub release正文和附件清单。此文不是新版安装包或GitHub发布完成证据，不push、不发布。真实搜索缺失应写进候选限制，历史内容不得标实时结果。需要Owner决定的是本次具体网关部署窗口与真实验证预算，后续常规代码/离线测试/打包不逐项请示。
