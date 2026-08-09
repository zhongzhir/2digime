# REMOTE-TWO-MACHINE-OWNER-VALIDATION · 20260809 阶段归档

任务：`DIGITALME-TODAY-CLOSE-20260809`  
分支：`v2/foundation`  
归档时 HEAD：`a851b0c95d1d343538eb6599fa2699ba65518759`  
状态：见文末标签；**未 push**

## 验证目标

验证两台独立 Digital Me 能否经公网 HTTPS Relay，在不共享本地文件夹的前提下完成：

发现 → 判断 → 建立联系 → 发起协作意向 → 对方决策入口可见；并确认离线投递与断网恢复在协议层成立。

本阶段目标是验证**协作通路**，不是扩展完整远程协作工作流。

## 最终架构

```
Subject semantics → SubjectTransport → Local | Relay | (future P2P-Hybrid)
```

- Relay = 加密邮局（密文存转），**不是**主体事实源
- 主体数据仍属各自 SubjectPackage
- Remote payload：E2EE（Ed25519 + X25519 + AES-256-GCM）
- 公网入口：`https://relay.muhub.cn` → Nginx TLS → `127.0.0.1:8787` Relay Service

## 真实环境

| 项 | 事实 |
|----|------|
| Relay | Alibaba Cloud ECS；Nginx HTTPS；Let's Encrypt；systemd 常驻；监听 `127.0.0.1:8787` |
| 域名 | `https://relay.muhub.cn`；外部 Windows 真机 `/health` → 200 |
| PC A | Windows；独立 SubjectPackage / 密钥 |
| PC B | Intel Mac / macOS 11.7.11；独立 SubjectPackage / 密钥 |
| 隔离 | 不共享本地文件夹；不复制密钥 |

## 通过项目（Owner 真实双机）

- 双端 Relay 接入与 pairing（双向邀请）
- Windows → Relay → Mac Signal；验签 / 解密 / inbox / ACK
- Opportunity 本地判断；B「继续了解」→ A 快速收到回应
- B 完全离线时 A 发送 → Relay store-and-forward → B 重启后收到
- A 断网发送 → 恢复网络后协议层自动 retry 成功（见下「观测偏差」）
- Remote Collaboration Proposal 同步到双方；A/B 均可打开同一协作详情

## 暴露并解决的主要问题

| 问题 | 处理（最终有效 Git 主链） |
|------|---------------------------|
| `subject.communicate` 未暴露到 preload | `9e39dd4` |
| 远程轮询导致协作页抖动 | `23b13aa` |
| Opportunity 自然语言误判 / 假绿测试 | `502b4c4` → 后续主链有效点 `97b69d1`（信任真实 distill / provider / context） |
| 断网后 retry 僵死 / 诊断不足 | `c81b267` → `8af5130`（最终有效诊断与 HTTP 硬化） |
| 协议已恢复但 A UI 粘滞「暂时无法送达」 | `b94cb0a`；现场曾误判失败，根因含 UI 未收口 + B `no_match` 静默 ACK |
| Proposal 双方都像「等待对方」且接收方无明确入口 | `a851b0c`（**工程完成**；Owner 最终真机复验仍 pending） |

说明：`502b4c4` 相对更早报告点曾有 amend/分叉叙述；**当前主链以 `git log` 为准**（`502b4c4` 后接 `97b69d1`）。

## 状态分级

### A. 已 Owner 真实双机验证

公网 Relay；pairing；Signal；E2EE 收发；inbox/ACK；Opportunity；continue；offline store-forward；**network recovery（协议层）**；Remote Collaboration Proposal；双端打开同一协作详情。

### B. Engineering complete · 尚未 Owner 最终真机复验

`a851b0c` 协作最小收口：发起方/接收方角色区分；接受 / 暂不接受；双方「协作已建立 / 暂未建立协作」；重启保持。**不得写成 Owner accepted。**

## 未继续验证 / 明确延后

- 材料共享、Task/Job 远程履约、Artifact 大文件、成果循环
- Remote Grant 产品化、支付、信誉、多方、P2P/NAT、广播市场
- `REMOTE-COLLABORATION-DELIVERY-01`（协作扩展暂停）
- R3 renderer 迁移仍 `paused`

## 产品判断（同步入 context）

1. **复杂性内收**：能自动发现/配置/选择/恢复的不转嫁用户；用户主要表达目标、必要偏好与关键决策。
2. **Relay**：DNS/HTTPS/运维是运营方门槛，不是普通用户门槛；默认零配置可用 Relay；自建为高级设置；Relay 可替换且非事实源。
3. **协作阶段**：人工手动协作的近期用户价值有限；本阶段通路验证目标已达到；停止扩协作功能面；下一步回到「代表我—做事—协作」整体复盘后再定优先级。

## 当前状态（标签）

`remote_public_relay_deployed` /  
`real_windows_mac_pairing_validated` /  
`remote_signal_e2ee_validated` /  
`opportunity_discovery_real_loop_validated` /  
`offline_store_forward_validated` /  
`network_recovery_protocol_validated` /  
`remote_collaboration_proposal_validated` /  
`minimal_collaboration_close_engineered` /  
`minimal_collaboration_owner_revalidation_pending` /  
`collaboration_expansion_paused` /  
`ready_for_whole_system_stage_review` /  
`not_pushed`

## 下一步决策门

不自行开新功能。Owner/CTO 先做整系统阶段复盘（代表我—做事—协作），再决定优先级。  
双机通路验证任务本身可标完成；**不得**据此宣称 `closed_alpha_ready` / `mvp_ready` / 完整远程协作产品已就绪。
