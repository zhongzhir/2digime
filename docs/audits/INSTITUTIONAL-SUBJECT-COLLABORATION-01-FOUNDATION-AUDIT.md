# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — 现状与威胁审计

**日期：** 2026-11-22  
**状态：** `SLICE_0_COMPLETE / SLICE_1A_DEVELOPER_VALIDATED / NOT_OWNER_ACCEPTED`  
**范围：** 只审计与实现主体公开身份的第一机械层；不证明机构认证、Owner 委托、标准 A2A 互操作或生产安全认证。

## 1. 既有可复用事实

| 能力 | 当前事实 | 证据入口 |
|---|---|---|
| Subject 与 Endpoint 分离 | `subjectId`、`endpointId`、`endpointRef` 分字段存在 | `src/subject-comm/endpoint.ts` |
| 通信身份 | Ed25519 签名、X25519 ECDH、AES-256-GCM；私钥进入加密 SecretStore | `src/subject-comm/crypto-identity.ts`、`identity-store.ts` |
| 配对信任根 | Invite 交换 Subject、Endpoint、Relay、公钥和 key id；peer 目录本机保存 | `src/subject-comm/invite.ts`、`identity-store.ts` |
| 远程传输 | Relay 只见密文；收件端按已配对公钥验签再解密 | `src/subject-comm/relay-transport.ts` |
| 最小协作面 | Public card 与 Digital Self 分离；协作请求只带当前目标和披露 | `src/subject-collab/types.ts`、`disclosure.ts` |
| Owner 授权地基 | 现有 Grant 可继续复用，但未与真实机构身份和公开主体卡形成密码学闭环 | `src/collaboration/grant-store.ts` 及协作基础文档 |

## 2. 开工前缺口

1. Public card 是未签名 JSON；虽然外层 Relay Envelope 已签名，卡片离开该 Envelope 后不能独立证明由哪个 Subject/Endpoint/key 声明。
2. Relay 验签使用 peer 公钥，但没有机械要求 wire `keyId` 等于当前 peer `keyId`，也没有持久的对端 key 撤销记录。
3. 当前 invite/peer 表示“配过这个端点”，不证明 Owner 真实身份、机构账户或 Owner 对 Subject 的授权。
4. 尚无原子密钥轮换、旧 key 交接证明、撤销同步或端点迁移恢复。
5. 当前 `PublicSubjectCard` 不是标准 A2A Agent Card；现有 `@a2a-js/sdk` 只用于外部能力适配，不能据此宣称主体协作已经 A2A 互操作。
6. 外部能力尚无统一 Personal Context Contract；若直接给出 `self.json` 会破坏单一 Digital Self 与最小披露原则。

## 3. 威胁与本轮处置

| 威胁 | 本轮机械处置 | 仍待处理 |
|---|---|---|
| 冒名 Subject | 卡片 Subject 必须与配对 peer 和签发者一致；Ed25519 验签 | Owner/机构身份绑定 |
| Endpoint 被替换 | 卡片 endpoint 必须同时匹配签发者和配对记录 | 经认证的端点迁移流程 |
| 声明被篡改 | 对完整规范化卡片、签发者、签发/过期时间签名 | 标准 JWS/JCS/A2A 形状评估 |
| 过期/未来卡片 | 严格解析时间；过期拒绝；未来时间只给有限时钟偏差 | 可信时间源与离线恢复 |
| 旧 key/撤销延迟 | peer key id 强绑定；对端 key 撤销本机持久化并在 Relay/Card 验证中拒绝 | 撤销传播、轮换交接与恢复 |
| 重放 | 卡片短期有效；Relay Envelope 自有 idempotency | 更高价值操作 nonce/授权引用 |
| 跨租户/跨 Subject 泄露 | 卡片不含 Digital Self；Subject/Endpoint 必须匹配当前 peer | 真实租户隔离和机构负向测试 |
| 机构管理员越权 | 本轮不向机构控制面暴露 Digital Self | Slice 2/3 真实策略与审计 |
| 日志泄密 | 签名卡只含公开声明；私钥仍在 SecretStore | token/VC/机构日志专项门 |
| Prompt injection | 身份验签和披露边界为确定性代码，不交给模型决定 | 外部内容语义隔离与任务级策略 |

## 4. 本轮实现

- 新增 `digitalme.public_subject_card.signed.v1`，域分隔签名输入固定为 `dm-public-subject-card-v1`；
- 复用既有 Ed25519 key，不新增密码算法或第三方密码库；
- 签名对象绑定 card、issuer Subject、issuer Endpoint、key id、issuedAt、expiresAt；
- Relay 发布只发送签名卡，接收只缓存验证通过且与 Envelope 来源端点一致的卡；
- peer 目录新增对端 key 撤销记录；Relay wire key id 必须匹配当前 peer key 且未撤销；
- 当前签名卡明确不是 Owner 凭证、不是标准 A2A Agent Card、不是新的 Digital Self。

## 5. 开发者验证

执行：

```text
npm run build
node --test --test-concurrency=1 \
  dist/subject-comm/tests/signed-public-subject-card-01.test.js \
  dist/subject-comm/tests/remote-subject-communication-01.test.js \
  dist/subject-comm/tests/remote-collaboration-minimal-close-01.test.js
```

结果：TypeScript 构建通过；10 项测试全部通过。覆盖正确签名、篡改、过期、撤销 key、错误 Subject、错误 Endpoint、错误 key、错误签发者、签名卡真实 Relay 发布/接收，以及既有 Relay/E2EE/远程协作回归。

这只是开发者验收，不是 Owner 验收、机构认证、第三方互操作、发布或生产部署。

## 6. 下一门

1. Slice 1B：设计并实现原子密钥轮换、旧→新 key 交接证明、撤销同步和端点迁移恢复；
2. Slice 1C：Personal Context Contract，只生成当前目的所需的最小投影，包含接收方、字段清单、digest、有效期和撤销引用；
3. Slice 2：经 Owner 选择一个真实但不产生外部费用的开发/沙箱身份源，验证 OIDC/OAuth 真实登录与 Subject 独立绑定；
4. 未通过上述门前，不称为标准 A2A、机构级身份、安全认证或可生产使用。
