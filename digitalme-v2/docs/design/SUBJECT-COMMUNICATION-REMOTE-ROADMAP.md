# Subject Communication Remote Roadmap

状态（2026-08-09）：阶段 1–2 已固化；阶段 3 **Owner 真机公网双机验证已完成并归档**；协作扩展暂停；阶段 4 以后。

权威指针见 `digitalme_context.md` 文首与决策 #110；归档：`../audit/REMOTE-TWO-MACHINE-OWNER-VALIDATION-20260809.md`；双机清单：`REMOTE-TWO-MACHINE-OWNER-CHECKLIST.md`。

## 阶段 1（已完成 · Local + Signal）

Local + SubjectEnvelope + Signal

- `SubjectTransport` / `SubjectEnvelope`（signal / signal_response / collaboration_sync）
- `LocalSubjectTransport`（`local_trusted`）
- Signal 机会发现 Demo → 复用现有 CollaborationRecord 闭环
- Git：`eb0f22a`

## 阶段 2（已完成 · Relay foundation）

Relay service

- authenticated subject endpoint（`dmep:`）
- E2EE envelope（Ed25519 + X25519 + AES-256-GCM；本机密钥；Relay 只见密文）
- offline store-and-forward
- ACK / retry / idempotency（envelopeId；ACK ≠ 业务接受）
- 本机三进程远程语义验收（隔离 userData，无共享路径）
- Git Candidate：`494b755`（REMOTE-COMMUNICATION-CANDIDATE）

## 阶段 3（已完成 · Owner 真机公网双机 · 2026-08-09 归档）

任务：`DIGITALME-V2-REMOTE-TWO-MACHINE-OWNER-VALIDATION-01` → **通路验证完成**。

已完成：公网 HTTPS Relay（`https://relay.muhub.cn`）；Windows ↔ Mac pairing；Signal E2EE；Opportunity；offline store-forward；协议层 network recovery；Remote Collaboration Proposal。

后续工程（非本阶段 Owner accepted）：`a851b0c` 最小 accept/reject 收口。

**协作扩展暂停**。`REMOTE-COLLABORATION-DELIVERY-01` **不得**自动启动；须整系统复盘后再定。

明确延后：

- large Artifact 跨公网完整履约
- Grant 远程投影完整关闭 / 材料·Task·支付·多方·P2P

## 阶段 4（以后）

P2P / direct path

- Relay fallback
- discovery / broadcast evolution（另立产品规格）

## 不变量

- Relay 不是 SubjectPackage 权威事实源；不承载匹配决策、Collaboration 真相、Task、Artifact、Growth
- 多 Transport，不绑定纯 P2P
- 暂不扩：广播市场、支付、信誉、多方协作、P2P/NAT traversal
