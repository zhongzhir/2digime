# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 1C 开发者验证

**日期：** 2026-11-22

**状态：** `IMPLEMENTED / DEVELOPER_VALIDATED / NOT_OWNER_ACCEPTED`

**范围：** 一次任务 Personal Context Contract、短期 Grant 与实际披露审计

**前置提交：** `281efd1`（Slice 1B）

## 1. 本轮形成的机械闭环

1. 当前模型仍负责判断本次协作是否需要本人信息，以及只选择哪些 Digital Self understanding；runtime 不做关键词相关性分类，也不建立第二份画像。
2. compiler 只接受唯一 `digital-self/self.json` 中仍有效的真实 understanding id；模型虚构 id 被拒绝，多条 Digital Self 被全选时被拒绝。任务摘要与选择的本人字段共同形成一次投影，不复制 provenance 摘录、资料名、路径或完整 `understandings`。
3. 合同绑定 `exchangeId`、签发 Subject、接收 Subject、接收 Endpoint、目的、字段引用、来源摘要、确认状态、签发时间、有效期、Grant 和 revocable reference。默认有效 15 分钟，机械上限 30 分钟。
4. 复用现有 `AuthorizationGrant` / `GrantStore`，scope 只允许 `read_authorized_context` 且必须与合同字段完全相等；Grant 被撤销、过期、主体不符、目的不符或范围扩大时，发送前校验失败。未发送或被披露闸门拒绝的 Grant 当场撤销。
5. 发送方只有在 transport 明确返回 `delivered: true` 后才写 `request_sent`；不可达或发送失败改写为 `delivery_failed`，不再把“准备发送”冒充“已经发送”。
6. 内存 transport 与真实 Relay/E2EE 都返回实际请求体 digest、UTF-8 字节数和接收 Endpoint；接收方从实际收到的 payload 重新计算并记录。真实 Relay 回归中双方 digest、字节、合同 id 和内容 digest 一致。
7. 接收方在调用自己的模型前核验合同任务、签发主体、接收主体、实际 Endpoint、目的、披露文本、有效期和内容 digest；缺失、篡改、过期或错绑合同直接拒绝并留下事实记录。

## 2. 开发者验证结果

### 2.1 通过

- `corepack pnpm build`：通过。
- 定向回归 23/23：
  - Personal Context Contract 新增用例 3/3；
  - 本机双主体接受/拒绝 3/3；
  - 真实 Relay/E2EE 双主体接受/拒绝 2/2；
  - 两 Owner 自主收件接受/拒绝 2/2；
  - Slice 1B 端点/key 轮换 3/3；
  - Slice 1A 签名公开卡 5/5；
  - Relay 断连恢复 3/3；
  - 既有远程最小协作接受/拒绝 2/2。
- 负向证据覆盖：虚构字段、完整 Digital Self 全选、内容篡改、错误 Endpoint、过期合同、已撤销 Grant、无合同、实际端点缺失、不可达/未投递。
- 泄露检查覆盖：未选择的私人住址、资料名、provenance 摘录和完整 `understandings` 均未进入合同或审计。

### 2.2 本轮未运行的门

- 未运行全仓全量测试；上一轮已记录的真实模型、公网媒体和既有发现断言噪声不在本轮修改范围。
- 本轮没有真实机构身份源、标准 A2A 独立实现或外部 Owner，因此自动化通过不能替代 Owner/机构验收。

## 3. 诚实边界

- Personal Context Contract 当前随既有已签名 Relay/E2EE 信封获得传输真实性，合同对象本身没有独立签名，也不是标准 A2A Message、VC、SD-JWT 或 OpenID4VP presentation。
- `AuthorizationGrant` 当前保存在签发方 SubjectPackage；接收方可以验证合同完整性和短期有效期，但不能在收到一次性投影后远程实时查询签发方后续撤销。跨端撤销同步留给后续身份/授权 slice。
- 当前来源摘要只区分本次任务、Owner 陈述、Owner 资料和模型推断；它不是现实身份或资料真实性证明。
- 未做 Owner 真机验收，未合并主干、推送、打包、发布或部署，也未创建外部账号、接受第三方条款或产生费用。

## 4. 下一步

由 Owner 先决定是否在上述边界内接收 Slice 1A–1C。若接收，再单独确认一个无外部费用、无需真实机构数据的开发/沙箱身份源，进入 Slice 2 的真实 OIDC/OAuth2/SAML 联邦；不得用 mock 登录冒充通过。
