# 当前交付状态（2026-10-07）

现行候选为 `v2-tujimi-20261007T085929Z-10724f0a`，源码 `10724f0aea093f7eab19491b9b06c75f041fbd22`。完整审查见 [FINAL-REVIEW.md](final-review/FINAL-REVIEW.md)，发布材料见 [GITHUB-CANDIDATE-MATERIALS-DRAFT.md](GITHUB-CANDIDATE-MATERIALS-DRAFT.md)。

纠正落盘、Talk/Discover消费与重启已有真实证据，最终包双对象交接与成果打开已复验；Self作用范围补修已完成真实托管验收：3应用/3供应商尝试、usage10077，Self认识不新增不覆盖，Goal/Talk/发现/重启一致；产品分次计划质量与实时搜索仍未闭合。不push、不发布。

---

以下保留2026-10-06阶段记录，其候选与局部“无长期本人事实”结论不作为最新整体验收结论；随后发现的Self范围问题以最新报告为准。

# 新版候选交付记录

## 结果

历史课程连续联动状态传递通过：生成计划→write_file与read_file→独立磁盘核对→纠正同一Goal→重启恢复→按新条件选择两门已有候选→修订计划与工具回读。未重跑比较，未搜索。临时时长保留在当前session Goal，无新增长期本人事实。测试器在第一次重启后保存检查点并中断，修复测试器后从检查点完成剩余步骤；中断0调用，已通过阶段未重复。不是完全无中断的单进程演示。

实际14应用请求/14供应商尝试，无重试。供应商usage输入58000、输出6146、合计64146；14条供应商结果均HTTP200、finish_reason为stop或tool_calls、reasoningLength=0。阶段5/4/0/1/4。总133153毫秒包含测试器中断恢复，重启0模型调用。诊断与包内检查没有额外模型调用，历史比较未算入本次链。

## 集成与构建

分支codex/core-link-01，观察基线8d888b09为候选祖先，根目录既有工作不覆盖。源码SHA：229d0921eb89113aa2320600014bef0f1d440a1f。一次npm run build:packaged完成编译及NSIS+ZIP。buildId：v2-tujimi-20261006T100113Z-229d0921，版本0.2.0。打包后提交仅补验收脚本与发布材料，候选源码SHA保持上述值。

相关离线回归26/26通过，核心联动既有21/21通过，不宣称全仓全测试通过。真实包内app.isPackaged=true、从app.asar加载；隔离空数据启动、历史Package副本恢复、两个来源/差异化时长、最终文件入口可见通过，0模型/搜索调用。包内六个关键文件与构建源码一致；ZIP解压后的exe/asar与启动版哈希一致。安装器只完成产物、哈希与签名检查，没有在正式用户环境安装NSIS。

## 附件

- 安装包：D:\Projects\Digital Me\.task-worktrees\core-link-01\release-staging\v2-tujimi-20261006T100113Z-229d0921\兔机米-0.2.0-public-alpha-win-x64-setup.exe
- SHA256：6c8fa40124409492dc6ccf2fe9c4f7b7f932d8f0e8dc6f417f641548694711b5
- ZIP：D:\Projects\Digital Me\.task-worktrees\core-link-01\release-staging\v2-tujimi-20261006T100113Z-229d0921\兔机米-0.2.0-public-alpha-win-x64.zip
- SHA256：bf09e4b81c4e8cd02e7d7222ef36b8a4cefd3cc89a8d386d312876f6cfad6a37
- EXE SHA256：ed437abdf17c5e124371a70f3c58812d41f3e285ae1c79d162d69947b12df337
- ASAR SHA256：d9c831c5275208b13fbf35ea0c3ab3faa6d8d35ace312404e0c8173eb74723bc
- 敏感扫描：0发现；Authenticode：NotSigned。

## 剩余缺陷与范围

1. 历史候选回放不代表实时搜索验收；搜索付费关闭。价格、字幕和当前报名未核实。
2. 第1天两节课程历史时长38分32秒超过30分钟，尚未把章节切成实际观看片段。计划字段与作用范围正确，任务安排质量仍需改进；不认定每项均能在当天完成。
3. 部分非写工具回合追加说明，增加等待和成本，尚未优化。
4. 取消按新建/覆盖/Office已有验证范围关闭；本次未重测，已发生效果不宣称回滚，发出取消不代表供应商确认停止。
5. 包未签名；全新Windows安装流程、Owner视觉点击验收及实时完整供给链仍未完成。

当前只交本地候选，不替换观察8d888b09、不新增线上部署、不push、不上传或正式发布。
