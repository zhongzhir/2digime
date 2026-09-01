# Phase 1 Digital Self — 脱敏验收摘要

**状态：** `accepted / not_raw_evidence`  
**日期：** 2026-09-01  
**任务：** `2DIGIME-REFOUNDATION-02-DIGITAL-SELF`

本文只记录已接受结论。不含本机路径、SecretStore、API 细节、原始模型响应或用户数据。本地闸门原始输出默认不入库。

---

## 已接受的用户事实

1. 全系统只有一个 Digital Self authority。
2. 「告诉 2digime」可写入当前有效认识（用户直述）。
3. 添加资料只形成候选，不得直接写成已确认身份。
4. 纠正覆盖旧认识，并在页面与 authority 同时生效。
5. 删除后该项不再出现在「现在怎样理解我」。
6. 重启后同一 authority 仍在。
7. 不把旧 GrowthEvent / Profile / material facts 当作「我」。

## 真实模型闸门（结论级）

正式产品入口、非 stub、真实对话模型。五组自然输入均按上列不变量处理：第三人称与混合资料未人格化为「我」；用户直述写入；纠正后只保留纠正后的认识。模型曾把资料来源标成用户直述，由 apply 层强制降为材料、未覆盖已确认身份。

未为此改 prompt、未 case patch、未迁旧对话/做事读取链。

## 权威位置

`SubjectPackage/digital-self/self.json` 中的 `DigitalSelf` 文档；每条 `Understanding` 自带 provenance。
