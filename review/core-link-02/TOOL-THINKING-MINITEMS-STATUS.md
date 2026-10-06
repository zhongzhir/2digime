# 非空数组约束与真实B准备状态

2026-10-06，承接ab9c54c。Owner授权补工具约束并继续真实B，总上限仍为7次、无重试；不改线上配置，不增加2048输出上限，不搜索，不部署/打包/push/发布。

## 已完成

src/intelligence/loop.ts的set_expected_effects.parameters.properties.effects增加minItems:1。执行器parseExpectedEffectsArgs及ok=effects.length>0完全未改，不放宽参数校验。替身故意返回历史原参数{"effects":[]}，仍被拒绝，然后自动回传错误、返回非空参数、成功记录及最终答复。

npm run build通过（仅TypeScript编译，不生成客户端安装包）。更新后的同进程测试器8项回归通过：错误回传/继续/最终答复，真实读文件，授权写入及回读，HTTP失败不重试，共享截止，预算耗尽不调用，写入前取消，已写入后取消如实保留效果。脱敏阶段日志与耗时见[evidence/tool-thinking-minitems-fixture.json](./evidence/tool-thinking-minitems-fixture.json)。这些是替身/机械验证，真实供应商调用0、usage0。

已重新准备包含新约束的23个诊断模块与校验清单，目标仅/tmp/dm-tool-thinking-inprocess-20261006-b7；当前未传入服务器或调用供应商。

## 当前唯一执行阻塞：登录

重新打开本次ECS Workbench成功，但实际页面仍是阿里云登录页，oauth_callback明确指向i-2zedlw82hph3c2lxd3w7、cn-beijing的同一Workbench。此次未发生新的自动审批拒绝，当前阻塞是登录会话尚未恢复，不能继续沿用上一轮“审批拒绝”作为当前状态。

已保留Chrome登录页并请求Owner完成登录，不要求提供密码或供应商密钥。服务器上的现有凭据仍由隔离进程原地读取，不带回本机。登录恢复后按既定授权自动继续：服务器替身验证→真实B课程比较→读取→授权写入/回读→取消。有效比较答复先由开发者核对来源、推荐理由、历史未知及时间条件；不要求Owner逐项确认。达到7次或比较失败立即停止并记录已有效果。

课程比较、真实工具效果、供应商耗时及真实usage尚未新增验证；完整历史课程联动仍未完成。线上最小配置变更与回滚方案仅在真实B通过后准备复审，不沿用此前部署授权。观察客户端8d888b09、线上配置与付费搜索保持不变。
