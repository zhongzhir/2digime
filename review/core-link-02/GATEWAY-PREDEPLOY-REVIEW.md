# 部署前补充审查

未重启、未部署、未调用真实模型或搜索。本次材料在本机独立目录暂存；远端未上传，正式服务未改变。待 Owner 确认网关窗口后上传并校验，窗口可能短暂中断活跃请求，模型验证产生少量费用，不开启付费搜索或发布客户端。

## 自动回滚

部署使用 set -Eeuo pipefail 和 EXIT trap，INT/TERM 转为非零退出。全部备份完成才设置 mutation_started=1；之后复制、环境修改、重启、健康检查任何一步失败，执行独立回滚脚本，保留原失败退出码。哈希/备份准备失败尚未修改现网，不触发恢复。回滚失败单独报告 ROLLBACK FAILED，保留备份，不宣称恢复。

环境备份使用 cp -a；原子修改前读取原 stat，临时文件先 chown 原 uid/gid，再 chmod 原 mode，最后 replace。恢复使用 cp -a 到同目录临时文件，再 mv，保留原权限和属主，不强制改为 root/0600。备份目录0700。SIGKILL/断电无法执行 trap；持续磁盘故障或服务故障也可能阻止恢复，必须依靠保留的备份处理。

本机 Ubuntu 的 8 项隔离故障注入通过：copy1/2/3、环境修改、重启、health、baseline mismatch、正常更新再回滚。断言旧文件与环境字节、0640权限、uid/gid65534恢复。systemctl/curl都是临时目录桩，真实服务命令0、网络0。Bash语法检查通过。

## 取消及释放

abortIfClientGone完整函数：
```ts
const abortIfClientGone = () => {
  if (!res.writableEnded) ac.abort();
};
```
req.aborted与res.close共用它；正常完整响应writableEnded=true，不取消。HTTP路由finally移除两个监听。共享截止计时器与caller监听在出队并获得并发槽后才创建；预取消/并发拒绝不创建资源。创建后的global ceiling、allowance早退、store异常、provider异常、成功均经过同一finally清除timer、监听并释放槽。排队计入started+timeoutMs；过期不开始provider。串行队列吞掉前次拒绝仅用于释放锁，后续请求仍能运行。

## 截断与影响范围

网关所有length/truncated返回502/ok=false/error=truncated，缓存命中仍失败且不再次调用provider。该结果不进入供应商重试分支。

同时发现客户端现有Talk通用PROVIDER_ERROR重试和Self兼容格式回退可能扩大截断调用：本地候选保留diagnostic.failure=truncated，Talk、Discover结构化判断、Self语义JSON及结构化蒸馏对该原因终止；截断返回对象也终止Discover下一pass。更新了原先保护“截断后升级预算”的断言，不再保留错误合同。没有增加字段到managed请求白名单、没有加预算/重试。

这些客户端保护不在本次三个网关JS部署范围，未进入观察安装包8d888b09。不能宣称冻结客户端已具备新保护。部署现场使用有界隔离验证工具，不以冻结客户端整个Talk链验收本补丁；完整课程链继续未完成。

MANAGED_AI_STRUCTURED_THINKING=disabled影响所有json_object且无tools的请求，带tools与非JSON请求不发送该覆盖。不是课程特例。Self测试复用SubjectService.completeSemanticJson，使用隔离条件，不读取或写入正式主体。

## 授权后的验证与停止条件

先baseline/candidate/staged manifest校验，任何漂移停止。部署与配置变更作为同一可撤销范围；重启和health失败自动回滚。health通过后最多2个应用请求：历史两门课程判断1次、隔离Self结构化调用1次（课程失败则立即停止并回滚，不再调用Self）。均0搜索，不读取正式主体材料。要求finish_reason非length、非空短JSON、字段可解析且符合两对象/范围合同、日志能关联实际模型/上限/thinking/usageSource/真实usage。

网络/5xx仍受既有网关最多2次重试及90秒共享期限；2个应用请求的最坏上游尝试数为6，不能承诺模型费用只对应2次。截断不重试。任一判断/解析/合同失败立即人工执行独立回滚；不增加预算、堆重试或放宽匹配。仍须区分发出取消与供应商确认停止。

测试证据：gateway-predeploy-tests.tap、gateway-deploy-fault-tests.json。最终文件清单与SHA256见staged-files.sha256。staged-gateway目录不是客户端安装包。
