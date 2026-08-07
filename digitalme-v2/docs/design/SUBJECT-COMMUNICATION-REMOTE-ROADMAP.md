# Subject Communication Remote Roadmap

## 阶段 1（本任务）

Local + SubjectEnvelope + Signal

- `SubjectTransport` / `SubjectEnvelope`（signal / signal_response / collaboration_sync）
- `LocalSubjectTransport`（`local_trusted`）
- Signal 机会发现 Demo → 复用现有 CollaborationRecord 闭环

## 阶段 2（约 1 周）

Relay service

- authenticated subject endpoint
- E2EE envelope（本机生成密钥；Relay 只见密文）
- offline store-and-forward
- ACK / retry / idempotency（沿用 envelopeId）

## 阶段 3（约第 2 周）

两台真实电脑 A/B

- remote Signal
- remote CollaborationRecord sync（collaboration_sync）
- remote Artifact delivery
- Owner 真机验收

## 阶段 4（以后）

P2P / direct path

- Relay fallback
- discovery / broadcast evolution（另立产品规格）

## 不变量

Relay 不是 SubjectPackage 权威事实源；不承载匹配决策、Collaboration 真相、Task、Artifact、Growth。
