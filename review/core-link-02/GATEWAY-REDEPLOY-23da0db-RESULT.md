# 原产品补丁重部署结果（2026-10-06）

状态：部署成功，历史课程判断与隔离 Self 均成功；未触发回滚。线上三个产品文件与 Owner 批准的 23da0db 暂存候选逐一一致。仅修订运维脚本；模型配置仍是原批准方案：无工具 JSON 请求 thinking=disabled，未改变其他模型参数。观察客户端仍为 8d888b09，未打包、push 或发布。

## 就绪与故障验证

部署和回滚共用 gateway-ready.py：单调时钟截止时间 10 秒，约 200ms 间隔，检查服务退出状态、127.0.0.1:8787 TCP 和 /health 的 HTTP 200/ok=true。active 本身不代表就绪；failed/inactive 提前失败。部署失败的 EXIT 处理调用回滚，并使用同一就绪函数。备份按尝试独立保存；旧备份未覆盖，环境权限及属主原样保存。

离线 8 项部署故障测试通过：三个复制点、环境写入、重启、健康检查、基线变化、安全部署与手动回滚；环境字节、0640 及 uid/gid=65534 恢复正确。另四项真实 loopback 就绪测试通过：延迟监听 697ms、进程退出 65ms、健康持续失败 1565ms（测试期限 1500ms）、回滚延迟启动 910ms。四项使用真实临时 TCP/HTTP 服务与隔离 systemctl 状态替身；不冒充生产 systemd 故障。调用模型/搜索为零。

命令（WSL Ubuntu root，仅临时夹具）：
```
python3 scripts/gateway-deploy-fault-test.py
python3 scripts/gateway-readiness-fault-test.py
```

## 线上阶段与耗时

部署前无 node 活跃 TCP 连接；环境与第一次备份逐字节一致。线上旧基线、产品候选及新运维清单均校验成功。

运维日志从脚本初始化到 EXIT 记录共 **248ms**；2026-10-06 12:16:32 CST。各阶段相对初始化：

| 阶段 | 开始/结束 ms |
| --- | --- |
| 基线校验 | 7 / 11 |
| 候选与运维清单校验 | 13 / 20 |
| 备份完成 | 26 |
| 文件及环境更新完成 | 69 |
| 重启命令 | 71 / 97 |
| 端口与健康就绪检查 | 106 / 245 |
| EXIT 完成 | 248 |

就绪函数内部耗时 36ms，1 次检查；外层 139ms 包含 Python 启动和阶段记录。保守中断观察窗口为重启命令开始至健康确认 **174ms**，并非测得的每个用户请求不可用时长。上轮 146.203ms 仅是旧日志中的停止至重新监听，不代表上轮完整中断或完整脚本耗时。

日志：/opt/digitalme-review-gateway-20261006/operations-20261006T041632-796292.jsonl。
本次备份：/opt/digitalme-review-gateway-20261006/backup-20261006T041632-796292。
旧 backup 保留。最终 health ok=true，三个候选哈希再次通过，环境仍 0600 root:root。

## 两项有限真实验证

| 验证 | 客户端耗时 | HTTP / finish_reason | 正文长度 | 应用请求 / 上游尝试 | 供应商 input / output / total |
| --- | --- | --- | --- | --- | --- |
| 两门历史课程判断 | 2554ms | 200 / stop | 950 | 1 / 1 | 2084 / 459 / 2543 |
| 隔离 Self 结构化调用 | 615ms | 200 / stop | 45 | 1 / 1 | 82 / 12 / 94 |

总计 **2 个应用请求、2 次上游尝试、2637 tokens**；均无截断、空正文或解析错误，usageSource=provider。网关日志记录模型配置 deepseek-v4-flash，供应商返回 deepseek-flash；thinking=disabled，reasoningLength=0。课程输出上限 2048，Self 500。日志上游剩余期限分别 89997/89999ms。课程请求 4a9e8f41-3dba-4523-bd25-aabaceda6676，Self 请求 d9039900-0a3d-40de-a166-c2e0eeadbff9；各只有 attempt=1，供应商 HTTP 均 200，延迟分别 2373/500ms。

历史课程复用了已保存的慕课网两门候选；未重新核实课程价格/课时等时效信息，获取时间未保存（retrievedAt=null），不能冒称实时验收。两条均解析成功，但匹配条件仍 unconfirmed；技术微调课与“AI 产品落地”的匹配也仍需用户比较。Self 输出 durationMinutes=30、scope=current_goal；未读取或写入正式本人数据。独立课程计划回读、纠正后重启和完整实时课程链仍未完成。

客户端与网关墙钟约有 12 秒偏差，跨机器时间戳不用于计算端到端耗时；各端使用自身持续时间。两项均未取消，因此本轮没有“供应商已停止”的证据。

搜索调用 0，未开启付费搜索，未使用 Gemini。tokens 不是账单金额，费用以供应商账单为准。

## 回滚命令（仅出现后续故障时）

```
bash /opt/digitalme-review-gateway-20261006/ROLLBACK-AFTER-APPROVAL.sh /opt/digitalme-review-gateway-20261006/backup-20261006T041632-796292
```

回滚包含基线哈希与最多 10 秒端口/health 检查；检查失败会明确报错，不把复制成功当成恢复就绪。本轮成功部署后未额外重启作生产故障注入。
