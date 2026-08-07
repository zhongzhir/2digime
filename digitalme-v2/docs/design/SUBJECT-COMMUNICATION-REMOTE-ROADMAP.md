# Subject Communication Remote Roadmap

## 阶段 1（本任务）

Local + SubjectEnvelope + Signal

- `SubjectTransport` / `SubjectEnvelope`（signal / signal_response / collaboration_sync）
- `LocalSubjectTransport`（`local_trusted`）
- Signal 机会发现 Demo → 复用现有 CollaborationRecord 闭环

## 阶段 2（本任务）

Relay service

- authenticated subject endpoint
- E2EE envelope（本机生成密钥；Relay 只见密文）
- offline store-and-forward
- ACK / retry / idempotency（沿用 envelopeId）
- 本机三进程远程语义验收（隔离 userData，无共享路径）

## 阶段 3（本任务 Owner 验收）

两台真实电脑 A/B + 公网 HTTPS Relay

- remote Signal 往返
- 离线 store-and-forward + 网络 retry
- remote CollaborationRecord 提案同步（`collaboration_sync`）
- Owner 真机验收清单：`REMOTE-TWO-MACHINE-OWNER-CHECKLIST.md`
- Candidate：`REMOTE-COMMUNICATION-CANDIDATE`（`feat(communication): add encrypted relay transport`）

已知缺口（下一任务 `REMOTE-COLLABORATION-DELIVERY-01`）：

- large Artifact 跨公网完整履约
- Grant 远程投影完整关闭

## 阶段 4（以后）

P2P / direct path

- Relay fallback
- discovery / broadcast evolution（另立产品规格）

## 不变量

Relay 不是 SubjectPackage 权威事实源；不承载匹配决策、Collaboration 真相、Task、Artifact、Growth。
