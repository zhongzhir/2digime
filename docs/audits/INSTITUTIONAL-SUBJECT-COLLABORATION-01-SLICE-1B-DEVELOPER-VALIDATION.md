# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 1B 开发者验证

**日期：** 2026-11-22

**状态：** `IMPLEMENTED / DEVELOPER_VALIDATED / NOT_OWNER_ACCEPTED`

**范围：** 同一 Relay 内、单方发起的 Runtime Endpoint + 通信 key 轮换

**前置提交：** `2cf996d6c1c7cbbcd7995f8bd37f62a9d07dec90`（Slice 1A）

## 1. 本轮形成的机械闭环

1. 新 Ed25519/X25519 私钥先作为一个完整加密 bundle 写入既有 `FileSecretStore`，随后才允许活动 `profile` 切换；新 bundle 缺失时激活被拒绝。
2. 旧、新 Ed25519 key 对同一份域分隔交接声明分别签名；声明绑定同一 `subjectId`、旧/新 endpoint、旧/新 key、公钥、Relay、签发时间和有效期。
3. Relay/E2EE 上复用既有 `SubjectEnvelope` 与 `RelayTransport`，只新增身份层控制载荷：`prepare → ready → commit → committed`；它不表示 Owner 授权或协作业务状态。
4. 对端在 `prepare` 后短暂保存新旧两个 endpoint；只有来自新 endpoint/key 的有效 `commit` 才会原子删除旧 endpoint 并把旧 key 写入持久化撤销表。
5. 本机在所有已配对 endpoint 返回 `ready` 前保持旧 profile；激活后等待 `committed`，完成后删除旧私钥 bundle并记录本机旧 key 已退役。
6. 准备阶段或激活阶段中断后，应用可从 `peers.json` 的恢复记录继续发送尚未完成的一步；活动 `subjectId` 始终不变。
7. 轮换期间禁止修改 Relay；当前没有把同一 Relay 的端点迁移伪装成跨 Relay 迁移。

## 2. 开发者验证结果

### 2.1 通过

- `npm run build`：通过。
- 定向回归 13/13：
  - 新增端点/key 轮换 3/3；
  - Slice 1A 签名公开卡 5/5；
  - Relay 断连恢复 3/3；
  - 既有远程最小协作接受/拒绝 2/2。
- 新增真实 Relay 负向证据：交接提交后，使用被撤销旧私钥构造的、密码学上仍有效的旧 endpoint wire 被 `RelayTransport` 拒绝，结果为 `fetched: 0 / rejected: 1`。这不是向验签函数传入测试撤销参数。
- 重启证据：分别覆盖 `prepare` 后、活动 profile 切换前重启，以及新 endpoint 激活、收到最终确认前重启；两次都从持久化记录继续完成。
- 私钥边界：`peers.json` 不含 PEM、`signPrivatePem` 或 `encPrivatePem`；私钥仍只进入加密 SecretStore。

### 2.2 全量通讯套件的非本轮失败

尝试执行全部 `dist/subject-comm/tests/*.test.js`。轮换、Relay、签名卡和远程协作相关用例均通过，但全套不能作为绿色门：

- 真实模型用例因现有外部模型凭据无效而跳过或失败；
- PeerTube/开放媒体真实网络用例出现环境性失败；
- 两个既有本地断言仍失败：`humanNetworkNotice` 期望旧文案“搜索额度已经用完”，当前实现返回更准确的“额度或频率限制”；`truncated or empty judgment` 期望两次调用，当前实现一次结束；
- 全套进程在已输出多数结果后仍未自行退出，最终人工终止。

上述失败文件均不在本轮改动范围；本轮没有为使全套变绿而修改发现能力、真实模型或公网测试。

## 3. 尚未证明与禁止外推

- 未验证跨 Relay 迁移、双方同时轮换、多个对端同时参与一次轮换、设备丢失后通过 Owner 身份恢复、硬件密钥或机构托管。
- 当前双签交接的信任根仍是邀请配对时保存的对端通信 key；它不是 Owner 身份证明、VC 委托凭证、标准 A2A Agent Card 或银行级认证。
- 未做 Owner 真机验收，未合并主干、推送、打包、发布或部署，也未产生外部费用。

## 4. 下一步

按当前唯一计划进入 Slice 1C：定义一次任务使用的 Personal Context Contract，机械限制目的、接收方、最小字段、来源摘要、内容 digest、有效期、撤销引用和实际披露审计；不得形成第二份 Digital Self。
