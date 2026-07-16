"use strict";

/**
 * 能力扩展精选目录（产品层「应用商店」）
 * audience: general = 普通用户默认可见；advanced = 需技术配置（API Key / Token / 特殊运行时等）
 */

const CATEGORIES = [
  { id: "start", label: "新手推荐", hint: "点启用即可，无需额外配置" },
  { id: "local", label: "本地文件与记忆", hint: "读写本机、沉淀知识" },
  { id: "web", label: "联网与阅读", hint: "抓取网页内容" },
];

/** 高级分区标签（仅高级商店分组提示，不入默认 Tab） */
const ADVANCED_GROUP_HINTS = {
  office: "办公沟通",
  code: "代码协作",
  data: "数据",
  web: "联网",
};

const CATALOG = [
  {
    id: "filesystem",
    name: "本地文件读写",
    tagline: "读写你指定文件夹里的文档、草稿与素材",
    category: "start",
    alsoIn: ["local"],
    audience: "general",
    recommended: true,
    difficulty: "easy",
    needsKey: false,
    risk: "可读写授权目录，请只开放信任文件夹",
    scenario: "把演讲稿、报告、笔记交给 Digital Me 读取或写出到本地。",
    why: "Digital Me 的「手脚」里最基础的一项：没有它，多数任务只能停在对话文字。",
    howToUse: "点启用即可，系统会自动连接。默认使用「文档/DigitalMe」文件夹。",
    package: "@modelcontextprotocol/server-filesystem",
    argsTemplate: ["-y", "@modelcontextprotocol/server-filesystem", "{{workspaceRoot}}"],
    pathParam: {
      key: "workspaceRoot",
      label: "授权目录",
      defaultHint: "默认：文档/DigitalMe（自动创建）",
    },
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "memory",
    name: "知识图谱记忆",
    tagline: "用实体与关系沉淀长期知识，跨对话可检索",
    category: "start",
    alsoIn: ["local"],
    audience: "general",
    recommended: true,
    difficulty: "easy",
    needsKey: false,
    risk: "数据保存在本机；勿写入高度敏感隐私",
    scenario: "把人物、机构、项目关系记下来，之后提问时可回忆关联。",
    why: "补充 Package 记忆之外的「结构化备忘」；适合研究型用户积累线索。",
    howToUse: "点启用即可，系统会自动连接。",
    package: "@modelcontextprotocol/server-memory",
    argsTemplate: ["-y", "@modelcontextprotocol/server-memory"],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "fetch",
    name: "网页抓取",
    tagline: "按 URL 读取网页正文（不是全网搜索，需要具体链接）",
    category: "web",
    alsoIn: ["start"],
    audience: "general",
    recommended: true,
    difficulty: "easy",
    needsKey: false,
    risk: "会访问你提供的网址；勿抓取未授权内网或敏感系统",
    scenario: "你有一条具体链接时，让 Digital Me 读取页面再分析；研究场景会自动启用，用于读取检索到的网页。",
    why: "研究与写作场景高频：打开链接 → 摘要 → 对照你的判断框架。",
    howToUse: "点启用即可，系统会自动连接并下载所需组件。",
    package: "mcp-fetch-server",
    argsTemplate: ["-y", "mcp-fetch-server"],
    docsUrl: "https://github.com/zcaceres/fetch-mcp",
    runtime: "node",
  },
  {
    id: "sequential-thinking",
    name: "分步思考",
    tagline: "把复杂问题拆成可修订的思考步骤（推理脚手架）",
    category: "start",
    alsoIn: ["local"],
    audience: "general",
    recommended: false,
    difficulty: "easy",
    needsKey: false,
    risk: "低；仅影响推理过程，不访问外网",
    scenario: "重大决策、长论证、多方案比较时，强制分步推演。",
    why: "强化「像你一样想清楚」的过程，适合战略与研究判断。",
    howToUse: "点启用即可，系统会自动连接。",
    package: "@modelcontextprotocol/server-sequential-thinking",
    argsTemplate: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
  // ---------- 高级：需到第三方网站申请密钥 / Token，或特殊技术配置 ----------
  {
    id: "brave-search",
    name: "联网搜索（Brave）",
    tagline: "实时网页搜索，补足模型训练截止后的新信息",
    category: "web",
    alsoIn: ["start"],
    audience: "advanced",
    advancedReason: "需到 Brave 官网注册并申请 Search API Key；未配置时研究仍可用内置搜索",
    recommended: false,
    difficulty: "needs-key",
    needsKey: true,
    risk: "搜索查询会发往 Brave；勿搜索高度敏感关键词",
    scenario: "查最新政策、产业新闻、公开数据，再结合你的立场写判断。",
    why: "没有联网搜索时，研究会用内置搜索兜底；配置本项后检索质量更好。",
    howToUse: "在 Brave Search API 页面申请密钥，到「能力」启用并粘贴。研究页「搜材料并回答」会自动优先使用。",
    package: "@modelcontextprotocol/server-brave-search",
    argsTemplate: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: [
      {
        key: "BRAVE_API_KEY",
        label: "Brave Search API Key",
        helpUrl: "https://brave.com/search/api/",
        placeholder: "BSA...",
      },
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    id: "github",
    name: "GitHub 协作",
    tagline: "读仓库、查 Issue/PR，辅助代码与开源协作",
    category: "code",
    audience: "advanced",
    advancedReason: "需在 GitHub 创建 Personal Access Token",
    recommended: false,
    difficulty: "needs-key",
    needsKey: true,
    risk: "Token 权限决定可读写范围；建议最小权限",
    scenario: "让 Digital Me 查看你的仓库状态、Issue，或协助整理变更说明。",
    why: "开发与开源协作场景；非开发者无需启用。",
    howToUse: "在 GitHub 设置中创建 Token 后粘贴到下方。",
    package: "@modelcontextprotocol/server-github",
    argsTemplate: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub Personal Access Token",
        helpUrl: "https://github.com/settings/tokens",
        placeholder: "ghp_... 或 github_pat_...",
      },
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "sqlite",
    name: "SQLite 数据库",
    tagline: "查询本地 .sqlite / .db 文件中的结构化数据",
    category: "data",
    audience: "advanced",
    advancedReason: "需安装 uv 工具链，并指定数据库文件路径",
    recommended: false,
    difficulty: "advanced",
    needsKey: false,
    risk: "可查询你指定的数据库文件；勿指向含敏感生产数据的库",
    scenario: "分析本地导出的数据表、研究笔记库、小型业务库。",
    why: "当你已有结构化数据时，比纯文本记忆更精确。",
    howToUse: "需本机已安装 uv（uvx），并选择 .db / .sqlite 文件路径。",
    command: "uvx",
    package: "mcp-server-sqlite",
    argsTemplate: ["mcp-server-sqlite", "--db-path", "{{dbPath}}"],
    pathParam: {
      key: "dbPath",
      label: "数据库文件路径",
      defaultHint: "例如 C:\\data\\notes.sqlite",
      required: true,
    },
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    runtime: "uvx",
  },
  {
    id: "google-workspace",
    name: "电子邮件与协作文档",
    tagline: "连接 Google 邮箱等（阅读/草拟，外发须确认）",
    category: "office",
    audience: "advanced",
    advancedReason: "需在 Google Cloud 创建 OAuth 客户端 ID 与密钥",
    recommended: false,
    difficulty: "needs-key",
    needsKey: true,
    risk: "可读写邮箱内容；请勿授权无关账号；外发邮件须本人确认",
    scenario: "整理收件、起草回复、查找往来线索；默认不自动外发。",
    why: "覆盖大多数人的「对外沟通」手脚，属办公沟通原语。",
    howToUse: "在 Google Cloud 创建 OAuth 凭据后，到「能力」粘贴客户端 ID 与密钥并启用。",
    package: "mcp-google",
    argsTemplate: ["-y", "mcp-google"],
    envKeys: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "Google Client ID",
        helpUrl: "https://console.cloud.google.com/apis/credentials",
        placeholder: "….apps.googleusercontent.com",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        label: "Google Client Secret",
        helpUrl: "https://console.cloud.google.com/apis/credentials",
        placeholder: "GOCSPX-…",
      },
    ],
    docsUrl: "https://www.npmjs.com/package/mcp-google",
  },
  {
    id: "google-calendar",
    name: "日历",
    tagline: "查看与安排日程（需授权日历账号）",
    category: "office",
    audience: "advanced",
    advancedReason: "需 Google OAuth 凭据文件路径（日历专用）",
    recommended: false,
    difficulty: "needs-key",
    needsKey: true,
    risk: "可读写日程；变更会议前应确认",
    scenario: "查看近日安排、草拟会议时间、整理待办相关日程。",
    why: "与邮件并列的办公沟通原语，覆盖工作学习中的时间协调。",
    howToUse: "按文档生成 OAuth 凭据 JSON，填写路径后启用。首次连接可能打开浏览器完成授权。",
    package: "@cocal/google-calendar-mcp",
    argsTemplate: ["-y", "@cocal/google-calendar-mcp"],
    envKeys: [
      {
        key: "GOOGLE_OAUTH_CREDENTIALS",
        label: "OAuth 凭据文件路径",
        helpUrl: "https://github.com/nspady/google-calendar-mcp",
        placeholder: "C:\\path\\to\\gcp-oauth.keys.json",
      },
    ],
    docsUrl: "https://www.npmjs.com/package/@cocal/google-calendar-mcp",
  },
];

const GUIDE = {
  title: "如何武装你的 Digital Me",
  steps: [
    "在下方「推荐扩展」里点「启用」——无需懂技术，系统会自动连接。",
    "建议先启用：本地文件读写、网页抓取、知识记忆（均可一键完成）。",
    "连接成功后可「查看工具」试一下；下一步会让对话自动调用这些能力。",
  ],
  tips: [
    "上方只展示「点一下就能用」的扩展；需要去网站申请 API Key 的，请展开底部「高级扩展」。",
    "你不需要自己找 MCP 或填命令行；技术配置一律藏在高级里。",
    "只授权必要目录；高风险动作仍应人工确认。",
  ],
  discover: [
    { name: "官方 MCP Servers 仓库", url: "https://github.com/modelcontextprotocol/servers" },
    { name: "MCP 目录（社区）", url: "https://mcp.so" },
    { name: "Smithery 扩展目录", url: "https://smithery.ai" },
  ],
};

function isAdvancedItem(item) {
  return item?.audience === "advanced";
}

function isGeneralItem(item) {
  return item?.audience === "general";
}

function listByCategory(categoryId, { audience = "general" } = {}) {
  const pool =
    audience === "advanced"
      ? CATALOG.filter(isAdvancedItem)
      : CATALOG.filter(isGeneralItem);
  if (categoryId === "start") {
    return pool.filter((x) => x.category === "start" || x.recommended);
  }
  return pool.filter((x) => x.category === categoryId || (x.alsoIn || []).includes(categoryId));
}

module.exports = {
  CATEGORIES,
  CATALOG,
  GUIDE,
  ADVANCED_GROUP_HINTS,
  isAdvancedItem,
  isGeneralItem,
  listByCategory,
  getById(id) {
    return CATALOG.find((x) => x.id === id) || null;
  },
};
