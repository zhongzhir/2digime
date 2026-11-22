# DISCOVER-WATCH-ENTRY-01 — 开发检查点 01

**日期：** 2026-11-22  
**结论：** `IMPLEMENTED_PARTIAL / DEVELOPER_GATE_FAILED / RED_STOP / NOT_RELEASED`

## 1. 本轮实施

- 在非 Responses Discover 主链中增加 `read_candidate(candidateId)`，只能读取本轮搜索返回的候选，不能传任意 URL。
- 复用现有安全公开页面读取；返回最终 URL、正文材料和读取失败事实。
- 同一模型负责搜索、选择读取对象、判断完整观看/试看预告/平台页/推荐依据，并说明登录、会员、付费、地区、App 或验证码限制。
- runtime 只校验候选身份、读取成功、安全边界、次数、超时与结构；未读取的候选不得宣称为完整观看、试看或平台页。
- `resultKind=recommendation` 的具体作品卡与依据 URL 分开；作品卡显示“暂未核实到观看入口”，报道只出现在“看推荐依据”。
- 同一轮多个页面读取并行执行；UI 主动作按入口事实投影。

## 2. 机械验证

- `npm run build`：PASS。
- 相关回归：13/13 PASS，覆盖统一模型搜索选择、页面读取后的试看入口、未读取入口拒绝、候选 ID 防伪、空结果、搜索额度和 Owner 失败恢复。
- 全量 `npm test` 曾运行但未完成：在与本任务无关的 remote execution、subject collaboration、CTO source scan 既有用例出现多项失败，之后测试长时间无输出而中止。不得记为全量通过；本轮相关测试保持单独通过。

## 3. 真实模型与真实搜索门

模型：`deepseek-v4-flash`。搜索：`relay.muhub.cn` 托管 Web Discovery。页面核实：安全公开页面读取。每个最终质量样本使用干净临时安装令牌，避免把单安装每小时额度混入质量覆盖；生产配额未修改。

### 3.1 具名作品（v2 检查点）

| 指标 | 结果 |
|---|---:|
| 请求 | 12 |
| 具体对象主卡 | 21 |
| 已读取入口 | 18 |
| 入口覆盖 | 86% |
| 30 秒内终态 | 9/12 |
| 报道/榜单/百科主卡 | 0 |
| 空结果 | 1 |

可形成真实入口的样本包括《太平年》《沉默的荣耀》《三体》《漫长的季节》《哪吒之魔童闹海》《航拍中国》《但是还有书籍》《人生一串》。短剧《持械入宋》仍不稳定。

原始证据：

- `build/evidence/discover-watch-entry-01-real20-v2-20261122/runs.jsonl`
- `build/evidence/discover-watch-entry-01-real20-v2-20261122/summary.json`

### 3.2 开放推荐（v4 最终检查点）

| 指标 | 要求 | 结果 |
|---|---:|---:|
| 请求 | 8 | 8 |
| 具体对象主卡 | — | 23 |
| 已读取入口 | — | 12 |
| 入口覆盖 | ≥70% | 52.2% FAIL |
| 30 秒内终态 | 8/8 | 2/8 FAIL |
| 报道/榜单/百科主卡 | 0 | 0 PASS |

国产科幻、文化视频节目等样本能达到入口交付；热门短剧、亲子纪录片、悬疑剧等仍会停在具体作品与推荐依据，无法稳定进入平台页。

原始证据：

- `build/evidence/discover-watch-entry-01-open8-v4-20261122/runs.jsonl`
- `build/evidence/discover-watch-entry-01-open8-v4-20261122/summary.json`

## 4. 能力审计

- 直接 Bing HTML 搜索在中文影视查询上返回 YouTube 首页、百科或错拆词结果，不符合成熟能力标准；依据 02 L10，禁止接入为产品 fallback。
- 抖音官方关键词视频搜索需要特殊权限和用户 OAuth，并且只返回最近 1 天内容，不是通用影视目录：https://open.douyin.com/platform/resource/docs/ability/search-management/video/
- B 站开放平台公开能力主要是授权账号、稿件发布/删除/查询和授权后数据，不是无需授权的全站作品目录：https://open.bilibili.com/doc/
- 未核实到腾讯视频、优酷可直接覆盖通用作品搜索的公开官方目录 API。

## 5. 停止与下一步

开放推荐 v3 为 55%，并行读取后的 v4 为 52.2%，没有实质提升；连续三轮同层修改仍未通过开发者门。按 `02-FAILURE-LESSONS.md` Red 规则停止继续补提示词、正则、域名表或平台特例。

下一步不是继续改当前工具环，而是能力路线决策：

1. 推荐增强 Relay 的成熟中文搜索供应商和容量；需要新服务器端凭证、费用与部署授权。
2. 备选经 Owner 明确授权使用登录态 Computer Use 搜索并打开平台入口；不保存密码、不购买、不绕过平台限制。

在路线获授权并完成新能力接入前，不生成试用包，不安排 Owner 重复验收。
