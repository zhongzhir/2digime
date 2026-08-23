# REAL-CAPABILITY-BENCHMARK-01

> 任务：`DIGITALME-REAL-CAPABILITY-BENCHMARK-01A`
> 分支：`build/real-capability-benchmark-01`（base `0ebfca8`，干净 worktree，未 push）
> 冻结日期：2026-08-23
> 状态：**01A 协议层完成，未运行。运行在 01B。**
> 本任务：0 product feature change / 0 prompt optimization / 0 search tuning / 0 benchmark-driven fix。

---

## 0. 基线

- 从 `0ebfca8 feat(search): add grounded Google provider` 创建干净 worktree / branch `build/real-capability-benchmark-01`。
- **未修改、清理或提交 `build/evidence-efficiency-01` 的失败现场**（主 worktree 保持原状，未 touch）。
- 未 push。

---

## 1. 两类 benchmark

### TRACK A — 专业能力基准
回答：*如果用户只需要搜索/研究，当前最强现成能力做到什么水平？*

| 档位 | 对照产品 |
|---|---|
| Quick Search | ChatGPT Search / Claude Web Search / Gemini Search / Perplexity Search / **2digime web_search** |
| Deep Research | ChatGPT Deep Research / Claude Research / Gemini Deep Research / Perplexity Research / **2digime deep_research** |

2digime = comparison arm。**不得用普通 API completion 冒充上述产品能力。**

### TRACK B — 2digime 端到端价值
回答：*用户通过 2digime 做事，最终结果是否优于直接使用专业 AI？*

测试维度：任务理解、relevant personal context、project context、能力选择、专业执行结果、验收/纠偏、最终结果、用户需要额外提供多少上下文。
本轮只准备协议，真正运行在 01B。

---

## 2. 12 题测试集冻结

从原冻结 32 题（`conversation-p95-benchmark-01.json`，未改动题目原文）选择 **12 题**：

- **4 quick/current search**：B-02 世界杯冠军（当前事实+搜索纠偏）、B-04 iPhone 最新款官方价（当前事实+官方事实）、C-02 DeepSeek API 定价（官方事实/精确数字）、D-01 智能手机出货量第一（来源冲突）
- **5 deep research**：F-01 AI Agent 创业融资、F-02 生成式AI医疗、F-03 固态电池、F-04 半导体供应链、F-05 数字主体（2digime 主题）
- **3 DigitalMe context**：G-01 参赛比赛（正例）、G-02 参赛技术栈（正例）、G-05 电影推荐（负例）

覆盖：当前事实 / 官方事实 / 来源冲突 / 复杂行业研究 / 搜索纠偏 / 个性化正例 / 个性化负例。
题目答案未改动；未向任何 arm 注入参考答案。
冻结文件：`scripts/fixtures/real-capability-benchmark-v1.json`。

> 选 12 而非 32 的原因：本轮为人工对照第一轮，12 题信息密度最高且覆盖维度齐全；Deep Research 档 5 题即冻结 32 题中全部 F 类任务。

---

## 3. 真实产品能力审计（实测）

审计方法：env var 存在性（不打印值）＋最小 API 鉴权调用（仅回传状态码）＋已安装 CLI/浏览器/自动化探测＋代码内 provider/credential 路径审计。
**未读取浏览器密码、未导出 cookie/token、未绕过登录、未注册账户、未用 API arm 冒充 product arm。**

### 实测结果

| 项目 | 结果 |
|---|---|
| `GEMINI_API_KEY` | ✅ 有效（v1beta/models 返回 200）。models 含 `gemini-3.5-flash`（2digime connector 默认模型）及官方 `deep-research-preview-04-2026` / `deep-research-pro-preview-12-2025` / `deep-research-max-preview-04-2026` |
| `OPENAI_API_KEY` | ❌ 无效（401 invalid_api_key） |
| `DASHSCOPE_API_KEY` | ❌ 无效（401，与既有审计一致） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | 未设置 |
| `PERPLEXITY_API_KEY` | 未设置 |
| openai / claude / perplexity / gcloud CLI | 未安装 |
| Chrome / Edge | ✅ 已安装（含 Default profile；**未读取其内容**） |
| Playwright | ✅ 已装（node devDep 1.49.1；python 1.58.0），**浏览器二进制未下载**（可 `playwright install`，不涉及登录/注册） |
| node_modules（干净 worktree） | npm ci --ignore-scripts 完成；`npm run build`（tsc）通过 |
| 2digime 决策/综合模型 credential | 存在于 `digitalme-v2/scripts/_mvp-p14-real-capability-evidence/.runtime-model-credential.json`（仅确认存在，未读取内容） |

### 逐产品状态

| Arm | 状态 | reason |
|---|---|---|
| 2digime（产品） | **available** | 干净 worktree 从 0ebfca8 构建通过；Gemini grounding provider 有效；模型 credential 已存在 |
| ChatGPT Search / Deep Research | **manual_owner_action_required** | OpenAI key 401；无 CLI；产品 arm 需登录/订阅或 Owner 手工运行 |
| Claude Web Search / Research | **manual_owner_action_required** | 无 key/CLI/登录 |
| Gemini Search / Deep Research（app） | **manual_owner_action_required** | API key 有效但属 API 能力，不冒充产品 arm；app 需 Owner 登录 |
| Gemini API Deep Research | **available（API arm）** | 官方 deep-research-* 模型族可用；**默认只作 API arm，与 API/2digime 同档比**，是否升格 product-grade 由 CTO 决定 |
| Perplexity Search / Research | **manual_owner_action_required** | 无 key/CLI/登录 |
| OpenAI API / DashScope API | **unavailable** | 401 无效 |

---

## 4. 真实结果采集协议

统一保存格式（`real-capability-result-schema-v1.json`，JSONL 一行一条）：

`product / mode / task_id / started_at / finished_at / raw_answer / sources / citations / research_activity_if_visible / attachments / latency / manual_intervention / notes`

- 保存**原始产品输出**（raw_answer 不做清洗）。
- 评分前匿名化为 **Arm A / B / C / D / E**。
- 不因慢而截断；Deep Research 允许完整流程；人工介入（补打字/重试/澄清）一律记 `manual_intervention`。

---

## 5. 公平原则

- **Quick Search 只和 Quick Search 比；Deep Research 只和 Deep Research 比。**
- 禁止：2digime deep research vs Claude 普通 chat；Gemini Deep Research vs 2digime no_search。
- 所有 arm：同一个问题、尽量同一时间窗口、同样附件（本次统一无附件）、同样明确约束。
- API arm 参与时必须在结果中显式标注 arm 类型，不得伪装产品 arm。

---

## 6. DigitalMe context 的公平比较（TRACK B）

- 冻结 `benchmark-context-package`（见 `real-capability-benchmark-v1.json#contextPackage`）：只含该题真正相关、且 2digime 已拥有的用户信息。
- 对直接产品 arm：**允许把同一 context package 作为显式输入**（不故意让竞品「不知道上下文」）。
- 单独记录 **context_setup_burden**：2digime = 0（自动注入）；产品 arm = 需用户粘贴的上下文量＋澄清轮次。
- 分别评分：`result_quality / contextual_relevance / context_setup_burden / irrelevant_personalization`。

---

## 7. 评分维度

**TRACK A 专业能力**：correctness / freshness / source_quality / citation_support / citation_completeness / coverage / contradiction_handling / research_depth / synthesis / latency。

**TRACK B 端到端新增**：task_understanding / capability_selection / context_usefulness / context_setup_burden / result_usability / owner_alignment / irrelevant_personalization。

> 不把「2digime 自己搜索得怎么样」作为最终产品唯一指标。

---

## 8. P95 新定义（正式冻结）

`market_p95` 不表示「2digime 自研组件超过所有竞品组件」，而表示：

> 对于目标真实任务，用户通过 2digime 获得的**端到端结果进入当前市场头部水平**。

专业执行层若存在明显更强成熟能力：优先 **integrate / invoke / handoff**，而不是默认 **rebuild**。

---

## 9. 本任务停止点（01A 交付物）

1. ✅ 12 题测试集冻结 — `scripts/fixtures/real-capability-benchmark-v1.json`
2. ✅ Track A/B 协议 — 本文件 + benchmark JSON
3. ✅ 产品能力/访问审计 — §3 + benchmark JSON `armProbe`
4. ✅ 原始结果导入格式 — `scripts/fixtures/real-capability-result-schema-v1.json`
5. ✅ 匿名 blind judge 格式 — §10 + benchmark JSON `blindReview`
6. ✅ 明确还缺哪些真实 product arm — §11

未运行任何任务（01B 运行）。

---

## 10. Blind Judge 设计

- 匿名化：每 arm × 任务结果打乱 → **Arm A/B/C/D/E**；映射存 blind-key（不进盲评输入）。
- Judge 模型：`deepseek-v4-pro`（独立于 2digime 决策/综合所用模型的实例；参赛方不评分）。
- Rubric：每维 0-5 整数（0=完全失败 … 5=优秀）；hard fail = 重大事实错误/引用编造 → correctness=0。
- 同一题目 ≥2 名独立 judge，取平均。
- TRACK A 跨档不比（Quick Search 组内部比；Deep Research 组内部比）。

---

## 11. 尚缺的真实 product arm

| 产品 arm | 缺口 | 补齐方式 |
|---|---|---|
| ChatGPT Search / Deep Research | 有效登录 + 付费订阅 | Owner 登录（一次性 Playwright 持久 profile）或手工运行 |
| Claude Web Search / Research | 有效登录 + 付费订阅 | 同上 |
| Gemini Search / Deep Research（app） | 有效登录 + Gemini Advanced | 同上（或 CTO 决定把 API deep-research 模型族升格为 product-grade arm） |
| Perplexity Search / Research | 有效登录 + Pro 订阅 | 同上 |

---

## 12. 最小 Owner 操作

1. 为 4 个产品 arm 选路径：**A) 一次性登录到 Playwright 持久 profile（推荐，4 次登录后 01B 自动采集）**；B) Owner 手工逐题运行并回填（约 48 次运行，不推荐）。
2. 拷入 2digime 模型 credential（`.runtime-model-credential.json`）或设置 `DIGITALME_CONVERSATION_SEARCH_*` 环境变量（`GEMINI_API_KEY` 已有效，无需操作）。
3. 确认各产品订阅覆盖 Deep Research（ChatGPT Pro/Plus、Claude Pro、Gemini Advanced、Perplexity Pro）。
4. 01B 启动前关闭 Chrome/Edge 实例（解锁持久 profile）。

---

## 13. 回传 CTO 摘要

- **A. 12 题组成**：quick/current search 4（B-02/B-04/C-02/D-01）＋ deep research 5（F-01..F-05）＋ DigitalMe context 3（G-01/G-02 正例、G-05 负例）。
- **B. TRACK A**：Quick Search 组与 Deep Research 组各 5 臂（4 产品 + 2digime），只同档比。
- **C. TRACK B**：2digime 自动注入冻结 context package vs 产品 arm 显式获得同一 package，计量 context_setup_burden。
- **D. ChatGPT product arm**：manual_owner_action_required（key 401、无 CLI/登录）。
- **E. Claude**：manual_owner_action_required（无 key/CLI/登录）。
- **F. Gemini**：app arm manual_owner_action_required；API 侧 deep-research 模型族可用（available，默认 API arm，升格待定）。
- **G. Perplexity**：manual_owner_action_required（无 key/CLI/登录）。
- **H. 2digime arm**：available（构建通过、Gemini grounding 有效、credential 存在）。
- **I. 能否自动采集**：2digime 全自动；Gemini API Deep Research 全自动；4 个产品 arm 需 Owner 一次性登录后可自动，否则手工。
- **J. 最小 Owner 操作**：4 次一次性登录（或手工回填）＋ 拷贝 credential ＋ 确认订阅 ＋ 关闭浏览器。
- **K. blind judge**：Arm A–E 匿名；deepseek-v4-pro 独立判分；每题 ≥2 judge；Track A 跨档不比；hard fail 规则冻结。
- **L. P95**：端到端结果进入当前市场头部水平；专业执行层优先 integrate/invoke/handoff，非默认 rebuild。
- **M. HEAD/status**：见下。

---

## 附录：HEAD / status

- 分支：`build/real-capability-benchmark-01`（base `0ebfca8`，未 push）
- 工作树：`D:/Projects/dm-real-capability-benchmark-01`（干净，已 `npm ci --ignore-scripts && npm run build` 通过）
- 主 worktree（`build/evidence-efficiency-01`）：失败现场原样保留，未修改/未清理/未提交。
- 新增文件：
  - `scripts/fixtures/real-capability-benchmark-v1.json`
  - `scripts/fixtures/real-capability-result-schema-v1.json`
  - `docs/benchmark/REAL-CAPABILITY-BENCHMARK-01.md`