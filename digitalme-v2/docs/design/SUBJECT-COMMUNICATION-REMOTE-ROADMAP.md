# Subject Communication Remote Roadmap

状态（2026-08-07）：阶段 1–2 **已工程固化**为 Candidate `494b755`；阶段 3 = **明日唯一继续点**（Owner 真机，不编码）；阶段 4 以后。

权威指针见 `digitalme_context.md` 文首与决策 #109；双机清单：`REMOTE-TWO-MACHINE-OWNER-CHECKLIST.md`。

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

## 阶段 3（下一步 · Owner 真机 · 不编码）

任务：`DIGITALME-V2-REMOTE-TWO-MACHINE-OWNER-VALIDATION-01`

Owner 先决：公网 Relay **服务器** + **域名/子域名**。

随后：

1. 部署真实 HTTPS Relay（Node 内网端口 + 反代 TLS；Owner 只见 `https://<domain>`）
2. 两台真实电脑使用 Candidate `494b755`
3. pairing
4. A→B Signal
5. B→A response
6. B 离线 store-and-forward
7. 断网恢复 retry
8. Signal → remote collaboration proposal

已知缺口（**仅**双机通过后才启动下一任务 `REMOTE-COLLABORATION-DELIVERY-01`）：

- large Artifact 跨公网完整履约
- Grant 远程投影完整关闭

## 阶段 4（以后）

P2P / direct path

- Relay fallback
- discovery / broadcast evolution（另立产品规格）

## 不变量

- Relay 不是 SubjectPackage 权威事实源；不承载匹配决策、Collaboration 真相、Task、Artifact、Growth
- 多 Transport，不绑定纯 P2P
- 暂不扩：广播市场、支付、信誉、多方协作、P2P/NAT traversal
