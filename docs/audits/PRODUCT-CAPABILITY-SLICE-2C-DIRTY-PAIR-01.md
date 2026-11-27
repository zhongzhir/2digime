# Slice 2C 脏工作区同 build 双臂准入审计

日期：2026-11-27
状态：`DIRTY_SAME_BUILD_PAIR_ADMITTED / READY_FOR_SCORING / NOT_OWNER_ACCEPTED`

## 结论

`2C-DIRTY-01` 已取得合格同 build 双臂证据。直接臂和兔机米 Talk 编排臂使用相同冻结任务、fixture、项目 revision 及 OpenAI 官方固定 Codex Runtime，在两个独立、均含 Owner 预置未提交改动的工作区完成同一修复；正式 pair validator 返回 `evidence_ready_for_scoring`。

## 双臂共同事实

- 任务：`2C-DIRTY-01`
- 项目类别：dirty_worktree
- fixture digest：`f98d89e9759d5521f0437ab600c4404e288b80c31082c30b152187905ffe54a4`
- project revision：`cf17753dbd070ceb048f5f19ec9f7a6a663bd19e`
- Agent：`openai-codex-public-release` / `0.171.0-alpha.13.2`
- executable SHA-256：`3b0b6d91b32a43b6e708a200445a7dff190b0116009ca29c3bca3623a1bbb69e`
- 两臂基线测试：退出码 1，匹配预注册失败
- 两臂最终测试：退出码 0
- 两臂本次变更：仅 `src/title-normalizer.cjs`
- 两臂工作区外写入：空
- 两臂外部新增费用：0

## Owner 既有改动保护

两臂都保留 `OWNER-NOTES.md` 的同一预置未提交改动。内容 digest 前后均为 `6497f78384b24403e932c92ac768e38117e0038db3aa72a66c37cfe97e6a3f67`，Git diff digest 前后均为 `355d807043ecdca9b75f4e388f1235e57fdc2d30882513ed5657fd45b9783d6e`。该文件被采集器从本次成果中排除，没有被覆盖、回退、重写或冒领。

## 独立性与产品链

直接臂 workspaceId 为 `run-1795772839826-0895c900`；编排臂 workspaceId 为 `run-1795773337212-a0ce28c8`，彼此独立。编排臂另有同一 Talk 的 Thread、Execution、Artifact 和用户可见成功摘要；直接臂不冒充 Talk 回执。

直接臂使用现有 ChatGPT 登录权益，不调用兔机米托管模型。编排臂使用兔机米当前托管模型，免费额度 26%→24%。两边都没有购买、充值或外部按量费用。

## 边界

Web、桌面、后端和脏工作区四类项目现均已有合格同 build pair。本审计尚未执行四类统一评分，因此不能在此宣称相对 95% 阈值、Owner 验收、打包、发布或部署。
