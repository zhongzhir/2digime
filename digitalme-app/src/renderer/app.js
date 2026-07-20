"use strict";

let pkg = null;
let history = [];
let feedbackCtx = null;
let feedbackPlan = null;
let pendingAttachments = [];
let currentSession = null;
let currentRequestId = null;
let currentArtifact = null;
let linkedLibraryId = null; // chat artifact bound to a library item
let lastEvidence = [];
let unsubChatProgress = null;
/** Active scenario pack for this session: { id, title, systemHint } */
let activeScenario = null;
/** Current do-scene: null | write | research | placeholder id */
let doScene = null;
let writeHistory = [];
let writeRequestId = null;
let writePendingAttachments = [];
/** @type {Record<string, Array<{role:string,content:string}>>} */
let writeHistoryByDoc = {};
/** @type {object|null} */
let activeResearch = null;
let activeResearchArtifactId = null;
let researchList = [];
let researchMessages = [];
let researchRequestId = null;
let researchAgentRequestId = null;
let researchClaimsOpen = false;
/** When next-step filled a guided prompt awaiting send: null | "discover" | "chat" */
let researchPendingGuide = null;
let activeSkillByScene = { write: null, research: null, code: null };
const WRITE_SCENE_HINT =
  "当前在「工作台 · 写作」：按用户要求起草或改写完整可用正文（不要只给片段说明）。用户未指定文种时用通用文章结构即可。较长成稿放入 markdown 代码块以便写入右侧正文。";
const RESEARCH_SCENE_HINT =
  "当前在「工作台 · 研究」。默认帮用户尽快得到可用答复。无参考材料时：可给方向性分析与建议，须在答复开头注明「初步，尚未对照材料」；禁止编造无出处的事实数据。有参考材料时：结论尽量挂材料标题，缺证据写「待核实」。严禁输出工具调用协议或内部函数名。";
const RESEARCH_PROGRESS = [
  { id: "question", label: "问题" },
  { id: "sources", label: "材料" },
  { id: "synthesis", label: "整理" },
  { id: "write", label: "成文" },
];
/** @deprecated use RESEARCH_PROGRESS */
const RESEARCH_STAGES = RESEARCH_PROGRESS;

const DO_SCENES = [
  {
    id: "write",
    title: "写作",
    status: "ready",
    blurb: "空白开写，改稿与导出同一页。",
  },
  {
    id: "research",
    title: "研究",
    status: "ready",
    blurb: "问一句，得答复，同页导出。",
  },
  {
    id: "code",
    title: "编程",
    status: "ready",
    blurb: "像我约束下委派代码协助，授权后办事。",
  },
  {
    id: "office",
    title: "办事台账",
    status: "prep",
    blurb: "筹备中",
    detail: "邮件与日历等先以「能力 → 工具」高级项启用；薄场景稍后点亮。",
  },
  {
    id: "video",
    title: "视频",
    status: "prep",
    blurb: "筹备中",
    detail: "依赖视频相关能力就绪后再开放。",
  },
  {
    id: "audio",
    title: "音频",
    status: "prep",
    blurb: "筹备中",
    detail: "依赖音频相关能力就绪后再开放。",
  },
  {
    id: "schedule",
    title: "定时任务",
    status: "prep",
    blurb: "筹备中",
    detail: "依赖可靠调度与授权确认后再开放。",
  },
  {
    id: "learn",
    title: "学习",
    status: "prep",
    blurb: "筹备中",
    detail: "学习场景将随材料与能力成熟后点亮。",
  },
];

const $ = (id) => document.getElementById(id);

/** Normalize event targets so Text nodes / nested marks still resolve. */
function eventElement(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  return node.parentElement || null;
}

function firstMatchingInPath(e, selector) {
  const path = typeof e.composedPath === "function" ? e.composedPath() : [];
  for (const n of path) {
    if (n && n.nodeType === 1 && n.matches && n.matches(selector)) return n;
  }
  const el = eventElement(e && e.target);
  return el && el.closest ? el.closest(selector) : null;
}

function appendBootLog(line) {
  const text = String(line || "").trim();
  if (!text) return;
  console.error("[Digital Me]", text);
  try {
    const log = document.getElementById("ui-boot-log");
    if (!log) return;
    const stamp = new Date().toLocaleTimeString();
    const prev = log.textContent ? log.textContent + "\n" : "";
    log.textContent = prev + `[${stamp}] ${text}`;
    log.classList.remove("hidden");
  } catch {
    /* ignore */
  }
}

function installBootErrorTraps() {
  if (document.documentElement.dataset.dmBootTraps === "1") return;
  document.documentElement.dataset.dmBootTraps = "1";
  window.addEventListener("error", (ev) => {
    const msg = (ev && ev.message) || "脚本错误";
    const where = ev && ev.filename ? `（${ev.filename}:${ev.lineno || 0}）` : "";
    appendBootLog(`页面脚本错误：${msg}${where}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev && ev.reason;
    const msg = reason && reason.message ? reason.message : String(reason || "未处理的失败");
    appendBootLog(`未处理的异步错误：${msg}`);
  });
}

async function applyRuntimeStamp() {
  if (!window.digitalMe || typeof window.digitalMe.getRuntimeStamp !== "function") {
    appendBootLog("未能读取运行时版本信息（接口不可用）。请完全退出后重新启动应用。");
    return null;
  }
  try {
    const stamp = await window.digitalMe.getRuntimeStamp();
    const shortHead = stamp && stamp.gitHead ? String(stamp.gitHead).slice(0, 7) : "unknown";
    const appHash =
      stamp && stamp.files && stamp.files.rendererApp
        ? stamp.files.rendererApp.sha256Short
        : "?";
    const preloadHash =
      stamp && stamp.files && stamp.files.preload ? stamp.files.preload.sha256Short : "?";
    const mainHash = stamp && stamp.files && stamp.files.main ? stamp.files.main.sha256Short : "?";
    document.documentElement.dataset.dmGitHead = shortHead;
    document.documentElement.dataset.dmAppHash = appHash;
    document.documentElement.dataset.dmPreloadHash = preloadHash;
    document.documentElement.dataset.dmMainHash = mainHash;
    document.documentElement.dataset.dmPostOwnerFixes = stamp && stamp.postOwnerFixes ? "1" : "0";
    const el = document.getElementById("ui-runtime-stamp");
    if (el) {
      el.textContent = `加载版本 ${shortHead} · main ${mainHash} · preload ${preloadHash} · 界面 ${appHash}`;
      el.classList.remove("hidden");
      if (!stamp || !stamp.postOwnerFixes) {
        el.classList.add("ui-runtime-stamp-warn");
        appendBootLog(
          "当前加载的界面/主进程文件缺少必要修复标记。请完全退出 Digital Me（含后台进程）后，从本仓库 digitalme-app 目录重新启动。"
        );
      }
    }
    return stamp;
  } catch (err) {
    appendBootLog("读取运行时版本信息失败：" + ((err && err.message) || err));
    return null;
  }
}

/**
 * Bootstrap file actions + tip bubble must bind before any await / binder that may throw.
 * Later bindEvents may call these again; they are idempotent via dataset flags.
 */
function registerEarlyUiDelegates() {
  try {
    bindBootstrapFileActions();
  } catch (err) {
    reportBindError("bootstrap-files-early", err);
  }
  try {
    bindHelpAndTips();
  } catch (err) {
    reportBindError("help-tips-early", err);
  }
}

async function init() {
  installBootErrorTraps();

  // Must register before any await / bindEvents — stop depends on this surviving init failures.
  try {
    if (window.digitalMe && typeof window.digitalMe.onExternalAgentStarted === "function") {
      window.digitalMe.onExternalAgentStarted(onExternalAgentStarted);
    } else {
      appendBootLog("停止监听未就绪：请完全退出后重新启动，以确保加载最新预加载脚本。");
    }
    if (window.digitalMe && typeof window.digitalMe.onChatProgress === "function") {
      unsubChatProgress = window.digitalMe.onChatProgress(onChatProgress);
    }
    if (window.digitalMe && typeof window.digitalMe.onResearchProgress === "function") {
      window.digitalMe.onResearchProgress(onResearchProgress);
    }
  } catch (err) {
    console.error("[Digital Me] 进度/停止监听注册失败", err);
    appendBootLog("进度/停止监听注册失败：" + ((err && err.message) || err));
  }

  // Before package/model awaits — keep submit buttons and tip marks interactive.
  registerEarlyUiDelegates();

  try {
    await applyRuntimeStamp();
  } catch (err) {
    appendBootLog("版本标记失败：" + ((err && err.message) || err));
  }

  try {
    pkg = await window.digitalMe.loadPackage();
    renderPackageStatus();
  } catch (err) {
    console.error("[Digital Me] 加载资料失败", err);
    reportInitError("加载资料失败", err);
  }

  try {
    await renderModelStatus();
  } catch (err) {
    console.error("[Digital Me] 模型状态失败", err);
    appendBootLog("模型状态失败：" + ((err && err.message) || err));
  }

  try {
    await renderCapabilitiesStatus();
  } catch (err) {
    console.error("[Digital Me] 能力状态失败", err);
    appendBootLog("能力状态失败：" + ((err && err.message) || err));
  }

  bindEvents();

  try {
    await ensureSession();
    await loadScenarioPacks();
    await refreshCapabilitySurface();
  } catch (err) {
    console.error("[Digital Me] 会话/场景初始化失败", err);
    reportInitError("部分初始化未完成", err);
  }
}

function reportInitError(label, err) {
  const msg = `${label}：${(err && err.message) || err || "未知错误"}`;
  console.error("[Digital Me]", msg);
  appendBootLog(msg);
  try {
    let ban = document.getElementById("ui-init-warning");
    if (!ban) {
      ban = document.createElement("div");
      ban.id = "ui-init-warning";
      ban.setAttribute("role", "status");
      ban.style.cssText =
        "margin:8px 12px;padding:8px 10px;border:1px solid #c4a35a;background:#fff8e8;color:#3a2f1a;font-size:12px;border-radius:6px;";
      const host = document.querySelector(".app-main") || document.body;
      host.insertBefore(ban, host.firstChild);
    }
    ban.textContent = msg;
    ban.classList.remove("hidden");
  } catch {
    /* ignore */
  }
}

function reportBindError(name, err) {
  console.error(`[Digital Me] 界面绑定失败（${name}）`, err);
  reportInitError(`界面「${name}」绑定失败，部分按钮可能不可用`, err);
}

function renderPackageStatus() {
  const statusEl = $("pkg-status");
  if (!statusEl) return;
  const subEl = $("persona-sub");
  if (!pkg.exists) {
    statusEl.textContent = "还没有加载数字之我。请在设置里指定资料目录。";
    return;
  }
  const m = pkg.manifest || {};
  const owner = m.ownerDisplayName || "（未命名）";
  const domains = (m.distillationScope && m.distillationScope.coveredDomains) || [];
  statusEl.innerHTML =
    `<b>${owner}</b><br/>版本 ${m.packageVersion || "?"} · ${m.packageType || ""}` +
    (domains.length ? `<br/>擅长：${domains.join("、")}` : "");
  if (subEl) subEl.textContent = domains.length ? "已准备好：" + domains.join("、") : "今天想聊什么？";
}

async function renderModelStatus() {
  const cfg = await window.digitalMe.getConfig();
  const el = $("model-status");
  if (!el) return;
  if (cfg.apiKeyConfigured) {
    el.innerHTML = `智能引擎已连接<br/><span class="hint-line">可在设置中更换</span>`;
  } else {
    el.textContent = "尚未连接（打开设置完成连接）";
  }
}

async function renderCapabilitiesStatus() {
  const el = $("capabilities-status");
  const hint = $("workbench-cap-hint");
  if (!el) return;
  try {
    const enabled = await window.digitalMe.getExtensionsConfig();
    const status = await window.digitalMe.getExtensionsStatus();
    const connected = enabled.filter((e) => {
      const st = status.find((s) => s.id === e.id);
      return st && st.status === "connected";
    });
    if (!connected.length) {
      el.innerHTML =
        '已装载扩展：<span class="muted">暂无</span><br/><span class="hint-line">可在「能力」页添加；全貌页另有「可体验能力」摘要</span>';
      if (hint) hint.classList.add("hidden");
      return;
    }
    const names = connected.map((e) => e.name || e.id).join("、");
    el.innerHTML = `已装载扩展：<b>${names}</b><br/><span class="hint-line">对话中需要时会自动使用</span>`;
    if (hint) {
      const scene = activeScenario ? `当前场景：${activeScenario.title}。` : "";
      hint.textContent = `${scene}已准备好：${names}。`;
      hint.classList.remove("hidden");
    }
  } catch {
    el.textContent = "已装载扩展：—";
  }
}

function formatCapabilitySurfaceHtml(surface) {
  if (!surface) return "暂无数据。";
  const esc = escapeHtml;
  let html = `<p>${esc(surface.summary || "")}</p>`;
  const tools = surface.tools || [];
  if (tools.length) {
    html += `<strong>工具能力</strong><ul>`;
    for (const t of tools) {
      const cls = t.ready ? "cap-ready" : "cap-pending";
      html += `<li class="${cls}">${esc(t.name)} · ${esc(t.state)}</li>`;
    }
    html += `</ul>`;
  }
  const scenarios = surface.scenarios || [];
  if (scenarios.length) {
    html += `<strong>开箱场景</strong><ul>`;
    for (const s of scenarios) {
      html += `<li>${esc(s.title)}${s.active ? "（当前）" : ""} — ${esc(s.blurb || "")}</li>`;
    }
    html += `</ul>`;
  }
  const types = surface.deliverableTypes || [];
  if (types.length) {
    html += `<strong>可写文稿类型</strong><ul>`;
    for (const t of types) {
      html += `<li>${esc(t.title)}</li>`;
    }
    html += `</ul>`;
  }
  return html;
}

async function refreshCapabilitySurface() {
  try {
    const surface = await window.digitalMe.getCapabilitySurface({
      activeScenario: activeScenario
        ? { id: activeScenario.id, title: activeScenario.title }
        : null,
    });
    const wb = $("capability-surface-body");
    if (wb) wb.innerHTML = formatCapabilitySurfaceHtml(surface);
    const me = $("me-capability-surface");
    if (me) me.innerHTML = formatCapabilitySurfaceHtml(surface);
  } catch (e) {
    const msg = "加载失败：" + (e.message || e);
    const wb = $("capability-surface-body");
    if (wb) wb.textContent = msg;
    const me = $("me-capability-surface");
    if (me) me.textContent = msg;
  }
}

async function ensureSession() {
  const listed = await window.digitalMe.listSessions();
  if (listed.activeId) {
    currentSession = await window.digitalMe.getSession(listed.activeId);
  }
  if (!currentSession) {
    currentSession = await window.digitalMe.createSession({ title: "新对话" });
  }
  history = (currentSession.messages || []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  currentArtifact = (currentSession.artifacts && currentSession.artifacts[0]) || null;
  linkedLibraryId = (currentArtifact && currentArtifact.libraryId) || null;
  renderMessagesFromHistory();
  renderArtifact();
  await refreshSessionList();
}

function renderMessagesFromHistory() {
  const box = $("messages");
  box.innerHTML = "";
  if (!history.length) {
    addMessage("system-note", "今天想聊什么？可以附上材料，或点下方快捷方式。正式成稿请用回复下的「送到工作台」。");
    return;
  }
  for (const m of history) {
    if (m.role === "user" || m.role === "assistant") {
      addMessage(m.role, m.content, {
        correctable: m.role === "assistant",
        fullText: m.content,
      });
    }
  }
}

async function refreshSessionList() {
  const listed = await window.digitalMe.listSessions();
  const list = $("session-list");
  list.innerHTML = "";
  for (const s of listed.sessions) {
    const btn = document.createElement("button");
    btn.className = "session-item" + (s.id === listed.activeId ? " active" : "");
    btn.innerHTML = `<span class="s-title">${escapeHtml(s.title || "未命名")}</span>`;
    const actions = document.createElement("div");
    actions.className = "s-actions";
    const ren = document.createElement("button");
    ren.textContent = "改名";
    ren.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const t = prompt("给这段对话起个名字", s.title || "");
      if (t == null) return;
      await window.digitalMe.renameSession({ id: s.id, title: t });
      await refreshSessionList();
    });
    const del = document.createElement("button");
    del.textContent = "删除";
    del.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm("删除这段对话？")) return;
      await window.digitalMe.deleteSession(s.id);
      if (currentSession && currentSession.id === s.id) {
        currentSession = null;
        await ensureSession();
      } else await refreshSessionList();
    });
    actions.appendChild(ren);
    actions.appendChild(del);
    btn.appendChild(actions);
    btn.addEventListener("click", async () => {
      await persistCurrentSession();
      currentSession = await window.digitalMe.setActiveSession(s.id);
      history = (currentSession.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      currentArtifact = (currentSession.artifacts && currentSession.artifacts[0]) || null;
      linkedLibraryId = (currentArtifact && currentArtifact.libraryId) || null;
      pendingAttachments = [];
      renderAttachChips();
      renderMessagesFromHistory();
      renderArtifact();
      await refreshSessionList();
    });
    list.appendChild(btn);
  }
}

async function persistCurrentSession() {
  if (!currentSession) return;
  currentSession.messages = history.map((m) => ({ role: m.role, content: m.content }));
  if (currentArtifact) currentSession.artifacts = [currentArtifact];
  if (history.length && (!currentSession.title || currentSession.title === "新对话")) {
    const first = history.find((m) => m.role === "user");
    if (first) currentSession.title = first.content.replace(/\s+/g, " ").slice(0, 24);
  }
  currentSession = await window.digitalMe.saveSession(currentSession);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Hide DeepSeek DSML / tool protocol if it reaches the UI. */
function stripToolLeakageClient(text) {
  let t = String(text || "");
  t = t.replace(/<｜DSML｜tool_calls>[\s\S]*?<\/｜DSML｜tool_calls>/gi, "");
  t = t.replace(/<｜DSML｜function_calls>[\s\S]*?<\/｜DSML｜function_calls>/gi, "");
  t = t.replace(/<｜DSML｜invoke\b[^>]*>[\s\S]*?<\/｜DSML｜invoke>/gi, "");
  t = t.replace(/<｜DSML｜parameter\b[^>]*>[\s\S]*?<\/｜DSML｜parameter>/gi, "");
  t = t.replace(/<｜DSML｜tool_calls>[\s\S]*$/gi, "");
  t = t.replace(/<\|\s*DSML\s*\|[^>\n]*>[\s\S]*?(?:<\/\|\s*DSML\s*\|[^>\n]*>|$)/gi, "");
  t = t.replace(/<\/?｜DSML｜[^>\n]*>/gi, "");
  t = t.replace(/^\s*invoke\s+name\s*=\s*"[^"]+"\s*$/gim, "");
  t = t.replace(/^\s*parameter\s+\w+\s+is\s+.+$/gim, "");
  t = t.replace(/invoke\s+name\s*=\s*"[^"]+"[\s\S]{0,800}?(?=\n\n|$)/gi, "");
  t = t.replace(/<｜end▁of▁sentence｜>/g, "");
  t = t
    .split(/\n/)
    .filter((line) => !/DSML|tool_calls|<\/?\s*[|｜]/i.test(line))
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function guessTitleFromText(text) {
  const t = String(text || "").trim();
  const m = /^(?:#\s+)?(.{2,40})$/m.exec(t);
  if (m) return m[1].replace(/[#*`]/g, "").trim().slice(0, 40);
  return "对话摘录";
}

async function copyTextToClipboard(text) {
  const s = String(text || "");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

async function sendTextToWorkspace(text, titleHint) {
  const content = String(text || "").trim();
  if (!content) {
    addMessage("system-note", "没有可送入工作台的内容。");
    return;
  }
  try {
    const item = await window.digitalMe.importArtifactToLibrary({
      title: titleHint || guessTitleFromText(content),
      content,
      sourceSessionId: currentSession && currentSession.id,
    });
    addMessage("system-note", `已送到工作台 · 写作：「${item.title}」。`);
    await openDoScene("write", { libraryId: item.id });
  } catch (e) {
    addMessage("system-note", "送到工作台失败：" + (e.message || "请重试"));
  }
}

function attachAssistantActions(wrap, text, opts = {}) {
  if (!wrap || !text) return;
  let actions = wrap.querySelector(".msg-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "msg-actions";
    wrap.appendChild(actions);
  }
  if (!actions.querySelector(".btn-copy")) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy";
    copyBtn.type = "button";
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(text);
      copyBtn.textContent = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        copyBtn.textContent = "复制";
      }, 1600);
    });
    actions.appendChild(copyBtn);
  }
  if (!actions.querySelector(".btn-to-workspace")) {
    const toWb = document.createElement("button");
    toWb.className = "btn-to-workspace";
    toWb.type = "button";
    toWb.textContent = "送到工作台";
    toWb.title = "将本条回复送入工作台 · 写作，继续改成正式文稿";
    toWb.addEventListener("click", () => sendTextToWorkspace(text, opts.titleHint));
    actions.appendChild(toWb);
  }
  if (opts.correctable !== false && !actions.querySelector(".btn-correct")) {
    const btn = document.createElement("button");
    btn.className = "btn-correct";
    btn.type = "button";
    btn.textContent = "修正";
    btn.addEventListener("click", () =>
      openFeedback({
        assistantExcerpt: text,
        userQuestion: opts.userQuestion || "",
      })
    );
    actions.appendChild(btn);
  }
  if (opts.evidence && opts.evidence.length && !actions.querySelector(".btn-evidence")) {
    const ev = document.createElement("button");
    ev.className = "btn-evidence";
    ev.type = "button";
    ev.textContent = "显示依据";
    ev.addEventListener("click", () => {
      let box = wrap.querySelector(".evidence-box");
      if (box) {
        box.remove();
        return;
      }
      box = document.createElement("div");
      box.className = "evidence-box";
      box.textContent =
        "本轮参考了：\n" + opts.evidence.map((x) => "· " + (x.summary || "")).join("\n");
      wrap.appendChild(box);
    });
    actions.appendChild(ev);
  }
}

function addMessage(role, text, opts = {}) {
  if (role === "system-note") {
    const note = document.createElement("div");
    note.className = "msg system-note";
    note.textContent = text;
    $("messages").appendChild(note);
    $("messages").scrollTop = $("messages").scrollHeight;
    return note;
  }

  const wrap = document.createElement("div");
  wrap.className = "msg-wrap " + (role === "user" ? "user-wrap" : "assistant-wrap");
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.textContent = text;
  wrap.appendChild(el);

  if (role === "assistant" && text) {
    attachAssistantActions(wrap, opts.fullText || text, {
      correctable: opts.correctable,
      userQuestion: opts.userQuestion,
      evidence: opts.evidence,
      titleHint: opts.titleHint,
    });
  }

  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
}

function renderAttachChips() {
  const box = $("attach-chips");
  if (!box) return;
  box.innerHTML = "";
  for (const a of pendingAttachments) {
    const chip = document.createElement("span");
    chip.className = "attach-chip" + (a.ok === false ? " attach-chip-err" : "");
    const label = a.note ? `${a.name} · ${a.note}` : a.name;
    chip.innerHTML = `${escapeHtml(label)} <button type="button" aria-label="移除">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((x) => x.id !== a.id);
      renderAttachChips();
    });
    box.appendChild(chip);
  }
}

function setToolTrail(text, show) {
  const el = $("tool-trail");
  if (!el) return;
  if (!show) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = text;
}

function setResearchToolTrail(text, show) {
  const el = $("research-tool-trail");
  if (!el) return;
  if (!show) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = text;
}

function onResearchProgress(data) {
  if (researchAgentRequestId && data?.requestId && data.requestId !== researchAgentRequestId) return;
  if (data?.label) {
    setResearchToolTrail(`<strong>${escapeHtml(data.label)}</strong>`, true);
  }
}

/** requestId → operationId for events that arrive slightly before sendCode sets locals. */
const pendingExternalOperationIds = new Map();

function onExternalAgentStarted(data) {
  if (!data || !data.operationId) return;
  const oid = String(data.operationId);
  const rid = String(data.requestId || "");
  if (rid) pendingExternalOperationIds.set(rid, oid);
  // Only bind while a code workspace run is active; require matching requestId when present.
  if (!codeRequestId) return;
  if (rid && rid !== codeRequestId) return;
  codeOperationId = oid;
}

function adoptPendingCodeOperationId() {
  if (!codeRequestId) return;
  const pending = pendingExternalOperationIds.get(codeRequestId);
  if (pending) codeOperationId = pending;
}

function onChatProgress(data) {
  if (data && codeRequestId && data.requestId === codeRequestId && data.operationId) {
    codeOperationId = String(data.operationId);
  }
  if (!data || data.requestId !== currentRequestId) {
    if (data && researchRequestId && data.requestId === researchRequestId) {
      if (data.phase === "tool") {
        setResearchToolTrail(`<strong>${escapeHtml(data.label || "正在处理")}</strong>`, true);
      } else if (data.phase === "thinking" || data.phase === "writing") {
        setResearchToolTrail(`<strong>${escapeHtml(data.label || "…")}</strong>`, true);
      } else if (data.phase === "done" || data.phase === "stopped" || data.phase === "error") {
        setResearchToolTrail("", false);
      }
    }
    return;
  }
  if (data.phase === "tool") {
    setToolTrail(`<strong>${escapeHtml(data.label || "正在处理")}</strong>`, true);
  } else if (data.phase === "thinking" || data.phase === "writing") {
    setToolTrail(`<strong>${escapeHtml(data.label || "…")}</strong>`, true);
  } else if (data.phase === "delta" && data.full != null) {
    const pending = document.querySelector("#messages .msg.assistant.streaming");
    if (pending) {
      const preview = stripToolLeakageClient(String(data.full));
      // While streaming long docs, keep bubble readable
      pending.textContent =
        preview.length > 1200 ? preview.slice(0, 1200) + "\n\n…（完整内容见上方；可用「送到工作台」继续成稿）" : preview;
    }
    $("messages").scrollTop = $("messages").scrollHeight;
  } else if (data.phase === "done" || data.phase === "stopped" || data.phase === "error") {
    setToolTrail("", false);
  }
}

function syncArtifactFromDom() {
  if (!currentArtifact) return;
  const titleEl = $("artifact-title");
  const contentEl = $("artifact-content");
  if (titleEl) currentArtifact.title = titleEl.textContent.trim() || currentArtifact.title || "成稿草稿";
  if (contentEl) currentArtifact.content = contentEl.innerText || contentEl.textContent || "";
}

function updateArtifactLibraryButtons() {
  const keepBtn = $("btn-keep-as-draft");
  const hint = $("artifact-link-hint");
  const linked = !!linkedLibraryId;
  if (keepBtn) {
    keepBtn.textContent = linked ? "更新到文稿并打开" : "留为文稿";
  }
  if (hint) {
    if (linked) {
      hint.textContent = "已关联文稿。可继续修改后再次「更新到文稿并打开」。";
      hint.classList.remove("hidden");
    } else {
      hint.textContent = "";
      hint.classList.add("hidden");
    }
  }
}

function renderArtifact() {
  const empty = $("artifact-empty");
  const body = $("artifact-body");
  const panel = $("artifact-panel");
  const details = $("artifact-details");
  const summaryHint = $("artifact-summary-hint");
  if (!empty || !body) return;
  if (!currentArtifact) {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    if (panel) panel.classList.remove("has-artifact");
    if (summaryHint) summaryHint.textContent = "有长文时可展开；正式改稿请「留为文稿」";
    updateArtifactLibraryButtons();
    return;
  }
  empty.classList.add("hidden");
  body.classList.remove("hidden");
  if (panel) {
    panel.classList.add("has-artifact");
    panel.classList.remove("hidden");
  }
  if (details) details.open = true;
  if (summaryHint) summaryHint.textContent = currentArtifact.title || "已有长文";
  const titleEl = $("artifact-title");
  const contentEl = $("artifact-content");
  if (titleEl) titleEl.textContent = currentArtifact.title || "成稿草稿";
  if (contentEl) contentEl.textContent = currentArtifact.content || "";
  updateArtifactLibraryButtons();
}

async function saveArtifactToLibrary({ asNew } = {}) {
  if (!currentArtifact) return null;
  syncArtifactFromDom();
  const payload = {
    title: currentArtifact.title,
    content: currentArtifact.content,
    sourceSessionId: currentSession && currentSession.id,
  };
  if (!asNew && linkedLibraryId) payload.id = linkedLibraryId;
  const item = await window.digitalMe.importArtifactToLibrary(payload);
  linkedLibraryId = item.id;
  if (currentArtifact) currentArtifact.libraryId = item.id;
  updateArtifactLibraryButtons();
  await persistCurrentSession();
  return item;
}

async function keepAsDraftAndOpen() {
  if (!currentArtifact) return;
  try {
    const item = await saveArtifactToLibrary({ asNew: !linkedLibraryId });
    addMessage("system-note", `已留为文稿「${item.title}」，正在打开写作工作区。`);
    await openDoScene(doScene === "research" ? "research" : "write", { libraryId: item.id });
  } catch (e) {
    addMessage("system-note", "留为文稿失败：" + (e.message || "请重试"));
  }
}

function openInWriteWorkspace(item, { focusPrompt, scene } = {}) {
  if (!item) return;
  linkedLibraryId = item.id;
  activeLibraryId = item.id;
  currentArtifact = {
    title: item.title || "文稿",
    content: item.content || "",
    libraryId: item.id,
  };
  openDoScene(scene || "write", { libraryId: item.id }).then(() => {
    const input = $("write-input");
    if (input && focusPrompt) {
      input.value = `请基于右侧文稿「${item.title || "文稿"}」继续完善，保持我的表达风格，用 Markdown 输出完整正文。`;
      input.focus();
    }
  });
}

function buildAttachmentContext() {
  if (!pendingAttachments.length) return "";
  return pendingAttachments
    .map((a) => {
      const head = `### 附件：${a.name}${a.note ? "（" + a.note + "）" : ""}`;
      if (a.ok === false || !a.text) {
        return head + "\n（本附件未能读入正文）";
      }
      return head + "\n" + a.text;
    })
    .join("\n\n");
}

async function send() {
  const input = $("input");
  const text = input.value.trim();
  if (!text && !pendingAttachments.length) return;

  const failed = pendingAttachments.filter((a) => a.ok === false);
  if (failed.length && !pendingAttachments.some((a) => a.ok !== false && a.text)) {
    addMessage(
      "system-note",
      "附上的材料还没读进来：" + failed.map((a) => a.name + "（" + (a.note || "") + "）").join("；")
    );
    return;
  }

  const display =
    text +
    (pendingAttachments.length
      ? (text ? "\n" : "") + pendingAttachments.map((a) => "［附件：" + a.name + "］").join(" ")
      : "");

  const attachmentContext = buildAttachmentContext();
  let userContent = text || "请结合我附上的材料给出帮助。";
  if (attachmentContext && pendingAttachments.some((a) => a.ok !== false && a.text)) {
    userContent +=
      "\n\n---\n以下是我附上的材料正文，请务必基于这些内容回答，不要说无法读取附件：\n\n" +
      attachmentContext.slice(0, 80000);
  }

  input.value = "";
  addMessage("user", display);
  history.push({ role: "user", content: userContent });
  pendingAttachments = [];
  renderAttachChips();

  currentRequestId = "req_" + Date.now().toString(36);
  $("btn-send").disabled = true;
  $("btn-stop").classList.remove("hidden");
  setToolTrail("<strong>正在思考…</strong>", true);

  const pending = addMessage("assistant", "", { correctable: false });
  pending.classList.add("streaming");

  try {
    const res = await window.digitalMe.sendChat({
      pkg,
      history,
      requestId: currentRequestId,
      attachmentContext,
      scenarioHint: (activeScenario && activeScenario.systemHint) || "",
    });
    const reply = typeof res === "string" ? res : res.reply || "";
    pending.classList.remove("streaming");
    pending.textContent = reply || "（已停止）";
    lastEvidence = (res.meta && res.meta.evidence) || [];

    const wrap = pending.parentElement;
    if (wrap && wrap.classList.contains("assistant-wrap") && reply) {
      attachAssistantActions(wrap, res.fullReply || reply, {
        correctable: true,
        userQuestion: text || "请结合我附上的材料给出帮助。",
        evidence: lastEvidence,
        titleHint: guessTitleFromText(res.fullReply || reply),
      });
    }

    // Persist full model reply in history for continuity
    if (reply) history.push({ role: "assistant", content: res.fullReply || reply });
    // Optional: keep artifact for "送到工作台" convenience if model returned one
    if (res.artifact) {
      currentArtifact = {
        ...res.artifact,
        libraryId: linkedLibraryId || res.artifact.libraryId || null,
      };
    }
    await persistCurrentSession();
    await refreshSessionList();
  } catch (e) {
    pending.classList.remove("streaming");
    pending.className = "msg system-note";
    pending.textContent = "没办成：" + (e.message || "请稍后再试");
  } finally {
    $("btn-send").disabled = false;
    $("btn-stop").classList.add("hidden");
    setToolTrail("", false);
    currentRequestId = null;
  }
}

function bindEvents() {
  const steps = [
    ["chat-core", bindChatCoreControls],
    ["nav", bindNavControls],
    ["builder", bindBuilder],
    ["feedback", bindFeedback],
    ["output", bindOutput],
    ["do", bindDo],
    ["write", bindWriteWorkspace],
    ["research", bindResearch],
    ["code", bindCodeWorkspace],
    ["extensions", bindExtensions],
    ["me", bindMe],
    ["panorama-experience", bindPanoramaExperience],
    ["bootstrap-files", bindBootstrapFileActions],
    ["help-tips", bindHelpAndTips],
  ];
  for (const [name, fn] of steps) {
    try {
      if (typeof fn === "function") fn();
    } catch (err) {
      reportBindError(name, err);
    }
  }
}

function bindChatCoreControls() {
  $("btn-send")?.addEventListener("click", send);
  $("btn-stop")?.addEventListener("click", async () => {
    if (currentRequestId) await window.digitalMe.stopChat({ requestId: currentRequestId });
  });
  $("btn-attach")?.addEventListener("click", async () => {
    const files = await window.digitalMe.pickAttachments();
    if (!files?.length) return;
    pendingAttachments = pendingAttachments.concat(files);
    renderAttachChips();
  });
  $("input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $("btn-new-session")?.addEventListener("click", async () => {
    await persistCurrentSession();
    currentSession = await window.digitalMe.createSession({ title: "新对话" });
    history = [];
    currentArtifact = null;
    linkedLibraryId = null;
    pendingAttachments = [];
    renderAttachChips();
    renderMessagesFromHistory();
    renderArtifact();
    await refreshSessionList();
  });

  document.querySelectorAll("#intent-chips button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const intent = btn.dataset.intent || "";
      if ($("input")) {
        $("input").value = intent;
        $("input").focus();
      }
    });
  });

  $("btn-export-md")?.addEventListener("click", async () => {
    if (!currentArtifact) return;
    syncArtifactFromDom();
    const r = await window.digitalMe.exportMarkdown({
      title: currentArtifact.title,
      content: currentArtifact.content,
    });
    if (!r.canceled) addMessage("system-note", "已保存 Markdown：" + r.filePath);
  });
  $("btn-export-docx")?.addEventListener("click", async () => {
    if (!currentArtifact) return;
    syncArtifactFromDom();
    const r = await window.digitalMe.exportDocx({
      title: currentArtifact.title,
      content: currentArtifact.content,
    });
    if (!r.canceled) addMessage("system-note", "已保存 Word：" + r.filePath);
  });
  $("btn-open-drafts")?.addEventListener("click", async () => {
    const r = await window.digitalMe.openDraftsFolder();
    if (r?.path) addMessage("system-note", "已打开成稿文件夹：" + r.path);
  });
  const keepBtn = $("btn-keep-as-draft");
  if (keepBtn) {
    keepBtn.addEventListener("click", () => keepAsDraftAndOpen());
  }
  $("btn-artifact-ppt")?.addEventListener("click", async () => {
    if (!currentArtifact) return;
    syncArtifactFromDom();
    await generatePptFromDocument(currentArtifact.title, currentArtifact.content);
  });

  $("btn-settings")?.addEventListener("click", openSettings);
  $("btn-close")?.addEventListener("click", () => $("settings-modal")?.classList.add("hidden"));
  $("btn-save")?.addEventListener("click", saveSettings);
  if ($("btn-clear-apikey")) {
    $("btn-clear-apikey").addEventListener("click", clearApiKeySettings);
  }
  $("btn-create-temp-test-pkg")?.addEventListener("click", () => {
    createTempTestPackageFlow().catch((e) => alert("创建失败：" + (e.message || String(e))));
  });
  $("btn-restore-regular-pkg")?.addEventListener("click", () => {
    restoreRegularPackageFlow().catch((e) => alert("恢复失败：" + (e.message || String(e))));
  });
  $("btn-pkg-rollback-prev")?.addEventListener("click", () => {
    rollbackToPreviousPackageVersion().catch((e) => alert(e.message || String(e)));
  });
  $("btn-pkg-versions-refresh")?.addEventListener("click", () => {
    refreshPackageVersionsPanel().catch((e) => alert(e.message || String(e)));
  });
  $("btn-cli-save")?.addEventListener("click", () => {
    saveCliExecutorSettings().catch((e) => alert(e.message || String(e)));
  });
  $("btn-audit-rotate")?.addEventListener("click", async () => {
    try {
      const prep = await window.digitalMe.decisionAuditRequestRotate?.();
      if (!prep || !prep.rotationToken) throw new Error("未能获取代次确认凭据。");
      if (
        !window.confirm(
          "将开启新的决策记录代次。旧代次仍保留，可在设置中查看。\n\n继续？"
        )
      )
        return;
      if (
        !window.confirm(
          "请再次确认：新代次会从空链开始，旧代次仍保留为历史记录。\n\n确定开启？"
        )
      )
        return;
      await window.digitalMe.decisionAuditRotate?.({
        decisionId: prep.decisionId,
        rotationToken: prep.rotationToken,
      });
      await refreshSettingsAuditList();
      await refreshCodeAuditList();
    } catch (e) {
      alert(e.message || String(e));
    }
  });
  $("settings-audit-generation")?.addEventListener("change", () => {
    refreshSettingsAuditList().catch((e) => alert(e.message || String(e)));
  });
}

function bindNavControls() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view, btn));
  });
}

function switchView(view, btn, opts = {}) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  else {
    const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (nav) nav.classList.add("active");
  }
  $("view-chat").classList.toggle("hidden", view !== "chat");
  $("view-do").classList.toggle("hidden", view !== "do");
  $("view-me").classList.toggle("hidden", view !== "me");
  $("view-extensions").classList.toggle("hidden", view !== "extensions");
  if (view !== "me") {
    clearBuildSessionState();
  }
  if (view === "extensions") refreshExtensionsView();
  if (view === "chat") renderCapabilitiesStatus();
  if (view === "do") {
    if (opts._skipDo) {
      /* openDoScene manages panels */
    } else if (opts.doScene) {
      openDoScene(opts.doScene, opts);
    } else {
      showDoHub();
    }
  }
  if (view === "me") {
    const navGen = ++meNavGeneration;
    refreshMeView().then(() => {
      if (navGen !== meNavGeneration) return;
      if (opts.meLane) {
        switchMeLane(opts.meLane);
        if (opts.meLane === "self" && !opts._skipOverviewTab) {
          switchMeTab(opts.meTab || meActiveTab || "overview");
        }
      } else {
        // PAN-01: sidebar "我" always opens 数字之我 → 全貌; inbox must not hijack.
        switchMeLane("self");
        switchMeTab("overview");
      }
      // PAN-01R: return to top so sovereign CTA is visible
      if (!opts.meLane || opts.meLane === "self") {
        scrollSubjectHomeToTop();
      }
    });
  }
}

let meLane = "self";
let buildDoneTargetTab = "overview";
/** Invalidates in-flight me-view default-entry apply when user navigates within 我. */
let meNavGeneration = 0;
let lastBuildFlow = null;
let buildChoseImport = false;
/** @type {{ summary: string } | null} */
let buildSessionComplete = null;

const SUBJECT_IDENTITY_LINE_UI =
  "这是基于你的经历、判断和边界，持续形成的数字之我。";

function clearBuildSessionState() {
  buildChoseImport = false;
  buildSessionComplete = null;
}

function switchMeLane(lane) {
  const next = lane === "build" ? "build" : "self";
  const changed = meLane !== next;
  if (next === "self" && meLane === "build") {
    clearBuildSessionState();
  }
  meLane = next;
  document.querySelectorAll("#me-lane-tabs .mode-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.meLane === meLane);
  });
  const build = $("me-lane-build");
  const self = $("me-lane-self");
  if (build) build.classList.toggle("hidden", meLane !== "build");
  if (self) self.classList.toggle("hidden", meLane !== "self");
  applyBuildWizard();
  // Only hydrate inbox/overview when entering build. Re-entrant switchMeLane("build")
  // (focusReviewPanel / goBuildView / post-write) must not storm subject:getOverview —
  // that blocks packageStore:listVersions and subsequent inbox IPC on the main process.
  if (meLane === "build") {
    if (changed) {
      refreshInboxPanel();
      renderIntakeForm();
      refreshBuildFlowFromOverview();
    }
  } else {
    refreshCapabilitySurface();
    if (meActiveTab) switchMeTab(meActiveTab);
  }
}

/** Keep build lane visible without re-fetching overview when already there. */
function ensureMeBuildLaneVisible() {
  if (meLane === "build") {
    const build = $("me-lane-build");
    const self = $("me-lane-self");
    if (build) build.classList.remove("hidden");
    if (self) self.classList.add("hidden");
    applyBuildWizard();
    return;
  }
  switchMeLane("build");
}

function goBuildView() {
  meNavGeneration += 1;
  const nav = document.querySelector('.nav-item[data-view="me"]');
  if (!$("view-me").classList.contains("hidden")) {
    switchMeLane("build");
    return;
  }
  switchView("me", nav, { meLane: "build" });
}

function goSelfView(tab) {
  meNavGeneration += 1;
  const nav = document.querySelector('.nav-item[data-view="me"]');
  if (!$("view-me").classList.contains("hidden")) {
    switchMeLane("self");
    if (tab) switchMeTab(tab);
    return;
  }
  switchView("me", nav, { meLane: "self", meTab: tab || "overview" });
  if (tab) setTimeout(() => switchMeTab(tab), 0);
}

async function chooseDefaultMeLane() {
  // Kept for compatibility; PAN-01 default entry is always self → overview.
  switchMeLane("self");
  switchMeTab("overview");
}

const PANORAMA_NAV_WHITELIST = new Set([
  "me-build",
  "me-overview",
  "me-cognition",
  "me-boundaries",
  "capabilities",
  "settings-package-versions",
  "chat",
  "do",
]);

const MINIMAL_SURFACE_ACTION_WHITELIST = new Set([
  "view_problems",
  "continue_build",
  "continue_confirm",
  "continue_refine",
  "view_subject",
  "start_work",
]);

function scrollSubjectHomeToTop() {
  const home = $("subject-home");
  if (home && typeof home.scrollIntoView === "function") {
    home.scrollIntoView({ behavior: "auto", block: "start" });
  }
  const scroller =
    $("me-panel-overview") ||
    $("view-me") ||
    document.querySelector("#view-me .me-scroll") ||
    document.querySelector("#view-me");
  if (scroller) scroller.scrollTop = 0;
}

function navigatePanoramaTarget(target) {
  if (!PANORAMA_NAV_WHITELIST.has(target)) return false;
  if (target === "me-build") {
    goBuildView();
    return true;
  }
  if (target === "me-overview") {
    goSelfView("overview");
    scrollSubjectHomeToTop();
    return true;
  }
  if (target === "me-cognition") {
    goSelfView("cognition");
    return true;
  }
  if (target === "me-boundaries") {
    goSelfView("boundaries");
    return true;
  }
  if (target === "capabilities") {
    const nav = document.querySelector('.nav-item[data-view="extensions"]');
    switchView("extensions", nav);
    return true;
  }
  if (target === "settings-package-versions") {
    openSettingsPackageVersions();
    return true;
  }
  if (target === "chat") {
    const nav = document.querySelector('.nav-item[data-view="chat"]');
    switchView("chat", nav);
    return true;
  }
  if (target === "do") {
    const nav = document.querySelector('.nav-item[data-view="do"]');
    switchView("do", nav);
    return true;
  }
  // panorama-experience intentionally rejected in production
  return false;
}

function renderMinimalSurface(ms) {
  const titleEl = $("subject-home-title");
  const summaryEl = $("subject-minimal-summary");
  const actionsEl = $("subject-minimal-actions");
  const reminderEl = $("subject-minimal-reminder");
  if (!titleEl || !actionsEl) return;

  const surface = ms && typeof ms === "object" ? ms : null;
  setSafeText(titleEl, (surface && surface.subjectName) || "我的 Digital Me");
  if (summaryEl) {
    clearChildren(summaryEl);
    const raw = (surface && surface.summary) || "";
    const parts = String(raw).split("\n");
    const line1 = (parts[0] || "").trim();
    const line2 = parts.slice(1).join("\n").trim();
    if (line1) {
      const s1 = document.createElement("span");
      s1.className = "subject-minimal-line1";
      setSafeText(s1, line1);
      summaryEl.appendChild(s1);
    }
    if (line2) {
      const s2 = document.createElement("span");
      s2.className = "subject-minimal-line2";
      setSafeText(s2, line2);
      summaryEl.appendChild(s2);
    }
  }

  clearChildren(actionsEl);
  const actionOk =
    surface &&
    !surface.failClosed &&
    typeof surface.primaryAction === "string" &&
    MINIMAL_SURFACE_ACTION_WHITELIST.has(surface.primaryAction) &&
    typeof surface.primaryActionLabel === "string" &&
    surface.primaryActionLabel &&
    typeof surface.primaryNavTarget === "string" &&
    PANORAMA_NAV_WHITELIST.has(surface.primaryNavTarget);

  if (actionOk) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.id = "subject-minimal-primary";
    setSafeText(btn, surface.primaryActionLabel);
    btn.addEventListener("click", () => {
      // Renderer never recomputes priority; only executes whitelist nav from main.
      navigatePanoramaTarget(surface.primaryNavTarget);
    });
    actionsEl.appendChild(btn);
  }

  const sec = surface && surface.secondaryAction;
  const secOk =
    actionOk &&
    sec &&
    typeof sec === "object" &&
    typeof sec.action === "string" &&
    MINIMAL_SURFACE_ACTION_WHITELIST.has(sec.action) &&
    typeof sec.label === "string" &&
    sec.label &&
    typeof sec.navTarget === "string" &&
    PANORAMA_NAV_WHITELIST.has(sec.navTarget);
  if (secOk) {
    const secBtn = document.createElement("button");
    secBtn.type = "button";
    secBtn.className = "btn-ghost";
    secBtn.id = "subject-minimal-secondary";
    setSafeText(secBtn, sec.label);
    secBtn.addEventListener("click", () => navigatePanoramaTarget(sec.navTarget));
    actionsEl.appendChild(secBtn);
  }

  if (reminderEl) {
    const rem =
      surface && typeof surface.reminder === "string" && surface.reminder.trim()
        ? surface.reminder.trim()
        : "";
    if (rem) {
      reminderEl.classList.remove("hidden");
      setSafeText(reminderEl, rem);
    } else {
      reminderEl.classList.add("hidden");
      setSafeText(reminderEl, "");
    }
  }
}

function applyBuildWizard() {
  const trusted = (lastBuildFlow && lastBuildFlow.step) || "B0";
  let step = trusted;
  if (buildSessionComplete) step = "B5";
  else if (buildChoseImport && trusted === "B0") step = "B1";

  for (let i = 0; i <= 5; i += 1) {
    const panel = $(`build-step-b${i}`);
    if (panel) panel.classList.toggle("hidden", step !== `B${i}`);
  }

  const countLine = $("build-b2-count-line");
  if (countLine) {
    const n =
      lastBuildFlow && typeof lastBuildFlow.pendingCount === "number"
        ? lastBuildFlow.pendingCount
        : 0;
    setSafeText(
      countLine,
      `本次将处理 ${n} 份资料，并先请你确认相关认识，再写入数字之我。`
    );
  }

  const b5 = $("build-b5-summary");
  if (b5) {
    const sum =
      (buildSessionComplete &&
        typeof buildSessionComplete.summary === "string" &&
        buildSessionComplete.summary.trim()) ||
      "我已经根据本次确认更新了对你的认识";
    setSafeText(b5, sum);
  }

  const tabs = $("me-lane-tabs");
  if (tabs) {
    // Prefer auto-hide on self; show demoted tabs while in build for escape hatch.
    tabs.classList.toggle("hidden", meLane === "self");
  }
  const backbar = $("build-flow-backbar");
  if (backbar) backbar.classList.toggle("hidden", meLane !== "build");

  const bootstrap = $("bootstrap-guide");
  if (bootstrap) {
    bootstrap.classList.add("hidden");
    bootstrap.hidden = true;
  }

  const intake = $("intake-card");
  if (intake) {
    intake.classList.toggle(
      "has-intake-evidence",
      !!(lastBuildFlow && lastBuildFlow.hasIntakeEvidence)
    );
  }
}

async function refreshBuildFlowFromOverview() {
  try {
    if (!window.digitalMe || !window.digitalMe.getSubjectOverview) {
      lastBuildFlow = null;
      applyBuildWizard();
      return;
    }
    const overview = await window.digitalMe.getSubjectOverview();
    lastBuildFlow =
      overview && overview.panorama && overview.panorama.buildFlow
        ? overview.panorama.buildFlow
        : null;
  } catch {
    lastBuildFlow = null;
  }
  applyBuildWizard();
}

/** @deprecated walls removed from default surface; kept name for callers */
function renderPanoramaBlocks(panorama) {
  renderMinimalSurface(panorama && panorama.minimalSurface);
}

// ---------- PAN-01R sovereign collaboration experience UI ----------
const panExpState = {
  brief: null,
  request: null,
  selectedIds: [],
  preview: null,
  run: null,
  step: 1,
};

function showPanoramaExpStep(step) {
  panExpState.step = step;
  for (let i = 1; i <= 5; i += 1) {
    const el = $(`panorama-exp-step${i}`);
    if (el) el.classList.toggle("hidden", i !== step);
  }
}

function closePanoramaExperience() {
  const panel = $("panorama-experience-panel");
  if (panel) {
    panel.classList.add("hidden");
    panel.hidden = true;
  }
  panExpState.brief = null;
  panExpState.request = null;
  panExpState.preview = null;
  panExpState.run = null;
  panExpState.selectedIds = [];
}

async function openPanoramaExperience() {
  // PAN-01S: production has no entry; only main-approved test harness.
  if (!window.digitalMe || window.digitalMe.pan01rTestHarness !== true) return;
  const panel = $("panorama-experience-panel");
  if (!panel || !window.digitalMe.getPanoramaSubjectBrief) return;
  panel.hidden = false;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  showPanoramaExpStep(1);
  const step1 = $("panorama-exp-step1");
  if (step1) setSafeText(step1, "正在加载主体依据…");
  try {
    const brief = await window.digitalMe.getPanoramaSubjectBrief({});
    panExpState.brief = brief;
    renderPanoramaExpStep1(brief);
  } catch (e) {
    if (step1) setSafeText(step1, "加载失败：" + (e.message || e));
  }
}

function renderPanoramaExpStep1(brief) {
  const el = $("panorama-exp-step1");
  if (!el) return;
  clearChildren(el);
  const h = document.createElement("h4");
  setSafeText(h, "步骤 1 · 它如何理解我");
  el.appendChild(h);
  if (brief.warningMessage) {
    const w = document.createElement("p");
    w.className = "muted";
    setSafeText(w, brief.warningMessage);
    el.appendChild(w);
  }
  if (brief.previewMode) {
    const p = document.createElement("p");
    p.className = "muted";
    setSafeText(p, "主体依据不足：当前为通用预览，不能宣称已生成个性化 Digital Me 结果。");
    el.appendChild(p);
  }
  panExpState.selectedIds = (brief.evidence || [])
    .filter((e) => e.selectedByDefault && e.usableInExperience)
    .map((e) => e.id);
  const list = document.createElement("div");
  list.className = "panorama-exp-evidence-list";
  for (const ev of brief.evidence || []) {
    const row = document.createElement("label");
    row.className = "panorama-exp-evidence-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = ev.id;
    cb.checked = panExpState.selectedIds.includes(ev.id);
    cb.disabled = !ev.usableInExperience;
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!panExpState.selectedIds.includes(ev.id)) panExpState.selectedIds.push(ev.id);
      } else {
        panExpState.selectedIds = panExpState.selectedIds.filter((id) => id !== ev.id);
      }
    });
    row.appendChild(cb);
    const text = document.createElement("span");
    const confirmLabel = ev.ownerConfirmed ? "是" : "否";
    setSafeText(
      text,
      `[${ev.kindLabel}] ${ev.shortText} · 来源：${ev.sourceLabel || "本机资料"} · 本人确认：${confirmLabel}`
    );
    row.appendChild(text);
    list.appendChild(row);
  }
  el.appendChild(list);
  if ((brief.boundaries || []).length) {
    const bh = document.createElement("p");
    setSafeText(bh, "本次强制生效的边界（不可作为共享内容取消）：");
    el.appendChild(bh);
    const ul = document.createElement("ul");
    for (const b of brief.boundaries) {
      const li = document.createElement("li");
      setSafeText(li, b.shortText);
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn-primary";
  setSafeText(next, "进入协作请求");
  next.addEventListener("click", () => renderPanoramaExpStep2());
  el.appendChild(next);
}

async function renderPanoramaExpStep2() {
  showPanoramaExpStep(2);
  const el = $("panorama-exp-step2");
  if (!el) return;
  clearChildren(el);
  const h = document.createElement("h4");
  setSafeText(h, "步骤 2 · 收到协作请求");
  el.appendChild(h);
  const label = document.createElement("label");
  setSafeText(label, "研究主题");
  el.appendChild(label);
  const input = document.createElement("input");
  input.type = "text";
  input.id = "panorama-exp-topic";
  input.maxLength = 200;
  input.value = "个人研究方向判断";
  input.style.width = "100%";
  el.appendChild(input);
  const msg = document.createElement("p");
  msg.className = "muted";
  msg.id = "panorama-exp-step2-msg";
  el.appendChild(msg);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary";
  setSafeText(btn, "生成本地模拟请求");
  btn.addEventListener("click", async () => {
    setSafeText(msg, "正在创建…");
    try {
      const req = await window.digitalMe.createPanoramaRequest({
        topic: input.value,
        evidenceIds: panExpState.selectedIds.slice(),
      });
      if (!req || !req.ok) {
        setSafeText(msg, (req && req.message) || "创建失败");
        return;
      }
      panExpState.request = req;
      renderPanoramaExpStep3();
    } catch (e) {
      setSafeText(msg, "创建失败：" + (e.message || e));
    }
  });
  el.appendChild(btn);
}

async function renderPanoramaExpStep3() {
  showPanoramaExpStep(3);
  const el = $("panorama-exp-step3");
  if (!el || !panExpState.request) return;
  clearChildren(el);
  const h = document.createElement("h4");
  setSafeText(h, "步骤 3 · 由我授权");
  el.appendChild(h);
  const msg = document.createElement("p");
  msg.className = "muted";
  setSafeText(msg, "正在生成授权预览…");
  el.appendChild(msg);
  try {
    const preview = await window.digitalMe.buildPanoramaAuthPreview({
      requestId: panExpState.request.requestId,
      selectedEvidenceIds: panExpState.selectedIds.slice(),
    });
    if (!preview || !preview.ok) {
      setSafeText(msg, (preview && preview.message) || "授权预览失败");
      return;
    }
    panExpState.preview = preview;
    clearChildren(el);
    el.appendChild(h);
    const fields = [
      ["请求方", preview.requester && preview.requester.label],
      ["任务", preview.taskSummary],
      [
        "能力",
        (preview.capabilities || []).map((c) => c.label).join("、"),
      ],
      [
        "使用的内容",
        (preview.selectedEvidence || []).map((e) => e.shortText).join("；") || "无",
      ],
      ["授权期限", preview.durationLabel],
      ["结果去向", preview.resultDestination && preview.resultDestination.label],
      [
        "推理环境",
        preview.inferenceEnvironment &&
          `${preview.inferenceEnvironment.providerLabel}${
            preview.inferenceEnvironment.modelLabel
              ? " · " + preview.inferenceEnvironment.modelLabel
              : ""
          }`,
      ],
      [
        "推理数据去向",
        preview.inferenceEnvironment && preview.inferenceEnvironment.dataDestinationDisclosure,
      ],
      [
        "是否发送给协作对象",
        preview.inferenceEnvironment && preview.inferenceEnvironment.sentToSimulationPartner
          ? "会发送"
          : "不会发送给模拟协作伙伴",
      ],
    ];
    for (const [lab, val] of fields) {
      const p = document.createElement("p");
      setSafeText(p, `${lab}：${val || "—"}`);
      el.appendChild(p);
    }
    const shrink = document.createElement("p");
    shrink.className = "muted";
    setSafeText(shrink, "可返回步骤 1 取消部分依据以缩小范围。");
    el.appendChild(shrink);
    const actions = document.createElement("div");
    actions.className = "builder-actions";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn-ghost";
    setSafeText(back, "缩小范围");
    back.addEventListener("click", () => {
      showPanoramaExpStep(1);
      if (panExpState.brief) renderPanoramaExpStep1(panExpState.brief);
    });
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn-ghost";
    setSafeText(reject, "拒绝请求");
    reject.addEventListener("click", async () => {
      const res = await window.digitalMe.rejectPanoramaRequest({
        requestId: panExpState.request.requestId,
      });
      const note = document.createElement("p");
      setSafeText(note, res && res.ok ? "已拒绝，未执行。" : (res && res.message) || "拒绝失败");
      el.appendChild(note);
    });
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn-primary";
    setSafeText(confirm, "确认并执行（仅本次）");
    confirm.addEventListener("click", () => renderPanoramaExpStep4());
    actions.appendChild(back);
    actions.appendChild(reject);
    actions.appendChild(confirm);
    el.appendChild(actions);
  } catch (e) {
    setSafeText(msg, "授权预览失败：" + (e.message || e));
  }
}

async function renderPanoramaExpStep4() {
  showPanoramaExpStep(4);
  const el = $("panorama-exp-step4");
  if (!el || !panExpState.preview || !panExpState.preview.previewId) return;
  clearChildren(el);
  const h = document.createElement("h4");
  setSafeText(h, "步骤 4 · Digital Me 代表我行动");
  el.appendChild(h);
  const status = document.createElement("p");
  status.id = "panorama-exp-run-status";
  setSafeText(status, "正在执行（通用结果与 Digital Me 结果彼此隔离）…");
  el.appendChild(status);
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-ghost";
  cancelBtn.id = "panorama-exp-cancel";
  setSafeText(cancelBtn, "停止");
  el.appendChild(cancelBtn);

  let runId = null;
  let cancelRequested = false;
  let cancelInFlight = false;
  let lastCancelRes = null;
  let unsubProgress = null;

  async function requestCancel() {
    cancelRequested = true;
    if (!runId) {
      setSafeText(status, "正在请求停止…");
      return null;
    }
    if (cancelInFlight) return lastCancelRes;
    cancelInFlight = true;
    try {
      const res = await window.digitalMe.cancelPanoramaRun({ runId });
      lastCancelRes = res;
      if (res && res.ok && (res.status === "cancelled" || res.status === "abandoned")) {
        setSafeText(
          status,
          `已${res.status === "abandoned" ? "放弃" : "停止"}：迟到结果将被丢弃`
        );
        if (res.cancelLabel) setSafeText(cancelBtn, res.cancelLabel);
      } else {
        setSafeText(
          status,
          (res && res.message) ||
            (res && res.status ? `无法停止（当前状态：${res.status}）` : "取消失败")
        );
      }
      return res;
    } finally {
      cancelInFlight = false;
    }
  }

  if (typeof window.digitalMe.onPanoramaRunProgress === "function") {
    unsubProgress = window.digitalMe.onPanoramaRunProgress((info) => {
      if (info && info.runId) {
        runId = info.runId;
        if (cancelRequested) requestCancel();
      }
      if (info && info.stage && !cancelRequested) {
        setSafeText(status, `正在执行（${info.stage}）…`);
      }
    });
  }
  cancelBtn.addEventListener("click", () => {
    requestCancel();
  });

  try {
    const run = await window.digitalMe.confirmPanoramaExecute({
      previewId: panExpState.preview.previewId,
      confirmed: true,
    });
    if (typeof unsubProgress === "function") unsubProgress();
    panExpState.run = run;
    runId = (run && run.runId) || runId;

    if (cancelRequested) {
      let cancelRes = lastCancelRes;
      if (runId && (!cancelRes || cancelRes.status === "completed" || cancelInFlight === false)) {
        cancelRes = (await requestCancel()) || cancelRes;
      }
      if (
        cancelRes &&
        cancelRes.ok &&
        (cancelRes.status === "cancelled" || cancelRes.status === "abandoned")
      ) {
        setSafeText(status, "已取消，结果不可采纳");
        return;
      }
      // Late cancel could not abandon — show real status, never pretend stopped
      if (run && (run.status === "cancelled" || run.status === "abandoned")) {
        setSafeText(status, "已取消，结果不可采纳");
        return;
      }
      setSafeText(
        status,
        (cancelRes && cancelRes.message) ||
          (run && run.message) ||
          "无法放弃本次结果；请查看真实状态"
      );
      return;
    }

    if (run && (run.status === "cancelled" || run.status === "abandoned")) {
      setSafeText(status, "已取消，结果不可采纳");
      return;
    }
    if (!run || run.ok === false || run.status === "failed") {
      setSafeText(status, (run && run.message) || "执行失败");
      if (run && run.settingsTarget === "settings") {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "btn-ghost";
        setSafeText(link, "打开设置");
        link.addEventListener("click", () => {
          if (typeof openSettings === "function") openSettings();
          else if (typeof showSettings === "function") showSettings();
        });
        el.appendChild(link);
      }
      return;
    }
    // Only enter step 5 for explicit completed, adoptable-path results when user did not cancel
    if (run.status === "completed") {
      renderPanoramaExpStep5(run);
      return;
    }
    setSafeText(status, (run && run.message) || `运行结束（${run.status || "未知"}）`);
  } catch (e) {
    if (typeof unsubProgress === "function") unsubProgress();
    if (cancelRequested) {
      setSafeText(status, "已取消，结果不可采纳");
      return;
    }
    setSafeText(status, "执行失败：" + (e.message || e));
  }
}

function renderPanoramaExpStep5(run) {
  showPanoramaExpStep(5);
  const el = $("panorama-exp-step5");
  if (!el) return;
  clearChildren(el);
  const h = document.createElement("h4");
  setSafeText(h, "步骤 5 · 看见差异并处置结果");
  el.appendChild(h);

  const personalized = !!(run && run.personalizedAvailable && !run.previewMode);
  const groundingBad =
    run &&
    (run.groundingCode === "grounding_invalid" ||
      run.groundingCode === "grounding_missing" ||
      run.code === "grounding_invalid" ||
      run.code === "grounding_missing");

  if (run && (run.adoptable === false || groundingBad)) {
    const warn = document.createElement("p");
    warn.className = "muted";
    setSafeText(
      warn,
      (run && run.message) || "本次结果不可采纳（例如记录未完成、依据不足或已取消）。"
    );
    el.appendChild(warn);
  }

  const result = (run && run.result) || {};
  const grid = document.createElement("div");
  grid.className = "panorama-exp-compare";
  const left = document.createElement("div");
  const lh = document.createElement("strong");
  setSafeText(lh, "通用 AI 结果");
  left.appendChild(lh);
  const lt = document.createElement("pre");
  setSafeText(lt, result.genericText || "");
  left.appendChild(lt);
  const right = document.createElement("div");
  const rh = document.createElement("strong");
  setSafeText(
    rh,
    personalized
      ? run.digitalMeResultTitle || "我的 Digital Me 结果"
      : run.digitalMeResultTitle || "主体依据不足，仅提供通用预览"
  );
  right.appendChild(rh);
  const rt = document.createElement("pre");
  setSafeText(rt, result.digitalMeText || "");
  right.appendChild(rt);
  grid.appendChild(left);
  grid.appendChild(right);
  el.appendChild(grid);

  const citeMap = result.citeMap || [];
  if (citeMap.length) {
    const citeTitle = document.createElement("p");
    setSafeText(citeTitle, "依据引用对照：");
    el.appendChild(citeTitle);
    const table = document.createElement("ul");
    for (const c of citeMap) {
      const li = document.createElement("li");
      setSafeText(
        li,
        `${c.citeId} → [${c.kindLabel || ""}] ${c.shortText || ""}${
          c.sourceLabel ? " · " + c.sourceLabel : ""
        }`
      );
      table.appendChild(li);
    }
    el.appendChild(table);
  } else {
    const cite = document.createElement("p");
    setSafeText(
      cite,
      "生成时使用的依据引用：" +
        ((result.citations || []).length ? result.citations.join("、") : "无")
    );
    el.appendChild(cite);
  }

  const boundaries = result.enforcedBoundaries || result.boundaries || [];
  if (boundaries.length) {
    const bh = document.createElement("p");
    setSafeText(bh, "强制生效的边界：");
    el.appendChild(bh);
    const ul = document.createElement("ul");
    for (const b of boundaries) {
      const li = document.createElement("li");
      setSafeText(li, b.shortText || "");
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }

  const unused = result.unusedSummary || [];
  if (unused.length) {
    const uh = document.createElement("p");
    setSafeText(
      uh,
      "未使用的依据摘要：" +
        unused.map((u) => `${u.kindLabel || u.kind}×${u.count}`).join("、")
    );
    el.appendChild(uh);
  }

  const partner = document.createElement("p");
  partner.className = "muted";
  setSafeText(partner, "未发送给模拟协作伙伴");
  el.appendChild(partner);
  if (run.inferenceEnvironment && run.inferenceEnvironment.dataDestinationDisclosure) {
    const disc = document.createElement("p");
    disc.className = "muted";
    setSafeText(disc, run.inferenceEnvironment.dataDestinationDisclosure);
    el.appendChild(disc);
  }

  if (!run.adoptable) {
    const reason = document.createElement("p");
    reason.className = "muted";
    setSafeText(
      reason,
      run.message
        ? `不可采纳原因：${run.message}`
        : personalized
          ? "本次结果暂不可采纳"
          : "主体依据不足，通用预览不可采纳为个性化成果"
    );
    el.appendChild(reason);
  }

  const msg = document.createElement("p");
  msg.id = "panorama-exp-step5-msg";
  el.appendChild(msg);

  const canAdopt = !!run.adoptable && !groundingBad;
  const actions = document.createElement("div");
  actions.className = "builder-actions";
  const adopt = document.createElement("button");
  adopt.type = "button";
  adopt.className = "btn-primary";
  setSafeText(adopt, "采纳为我的本地成果");
  adopt.disabled = !canAdopt;
  adopt.addEventListener("click", async () => {
    const res = await window.digitalMe.adoptPanoramaResult({ runId: run.runId });
    if (res && res.ok) {
      if (res.committed && res.auditWarning) {
        setSafeText(msg, "成果已保存，但过程记录失败");
      } else {
        setSafeText(msg, (res && res.message) || "已保存为你的本地成果");
      }
    } else {
      setSafeText(msg, (res && res.message) || "采纳失败");
    }
  });
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "btn-ghost";
  setSafeText(reject, "拒绝本次结果");
  reject.addEventListener("click", async () => {
    const res = await window.digitalMe.rejectPanoramaResult({
      runId: run.runId,
      reasonCategory: "not_useful",
    });
    if (res && res.ok) {
      setSafeText(msg, (res && res.message) || "已拒绝本次结果，未写入成果库");
    } else {
      setSafeText(msg, (res && res.message) || "拒绝失败");
    }
  });
  const receipt = document.createElement("button");
  receipt.type = "button";
  receipt.className = "btn-ghost";
  setSafeText(receipt, "查看过程记录");
  receipt.addEventListener("click", async () => {
    const res = await window.digitalMe.getPanoramaReceiptSummary({
      runId: run.runId,
      requestId: run.requestId,
    });
    setSafeText(
      msg,
      res && res.ok
        ? `记录：状态 ${res.runStatus || "—"}；依据 ${res.evidenceCount} 条；本地模拟=${res.localSimulation}`
        : (res && res.message) || "无法读取记录"
    );
  });
  actions.appendChild(adopt);
  actions.appendChild(reject);
  actions.appendChild(receipt);
  el.appendChild(actions);
}

function bindPanoramaExperience() {
  // No production CTA. Close only; open requires test harness flag on preload.
  $("panorama-exp-close")?.addEventListener("click", () => closePanoramaExperience());
  // Expose harness-only opener for owner-runtime (not discoverable via production UI).
  if (window.digitalMe && window.digitalMe.pan01rTestHarness === true) {
    window.__digitalMeOpenPanoramaExperienceForTest = () => openPanoramaExperience();
  }
}

// ---------- Builder ----------
let pickedFiles = [];
let factsPickedFiles = [];
let distillResult = null;
let pendingReviewInboxIds = [];
let reviewModeGroups = [];
let reviewModeIndex = 0;
let pkgVersionsRefreshedAt = null;
let currentSourceLabel = null;
let intakeAnswers = {};
let materialKind = "persona";

const MATERIAL_KIND_UI = {
  persona: {
    action: "开始处理",
    reviewTitle: "处理结果（勾选要留下的，再写入）",
    reviewHint: "默认全选。去掉不想写入的条目；至少保留一条才能写入。",
    write: "写入已勾选内容",
  },
  identity: {
    action: "提取并审阅",
    reviewTitle: "人生事实（勾选要记入时间轴的）",
    reviewHint: "优先留下带角色、机构与时间的条目；不必把整份履历表格再抄一遍。",
    write: "写入时间轴",
  },
  custody: {
    action: "收入保管库",
    reviewTitle: "已收入保管库",
    reviewHint: "仅本机登记与摘录，不会写入人格，也不会出现在对话里。",
    write: "完成",
  },
};

function selectedMaterialKind() {
  const el = document.querySelector('input[name="material-kind"]:checked');
  return (el && el.value) || materialKind || "persona";
}

function syncMaterialKindUi() {
  materialKind = selectedMaterialKind();
  const ui = MATERIAL_KIND_UI[materialKind] || MATERIAL_KIND_UI.persona;
  const btn = $("btn-distill");
  if (btn) btn.textContent = ui.action;
}

function renderPickList() {
  const el = $("pick-list");
  if (!el) return;
  const ui = MATERIAL_KIND_UI[selectedMaterialKind()] || MATERIAL_KIND_UI.persona;
  if (!pickedFiles.length) {
    el.textContent = "尚未选择文件。可一次选多个 .docx / .txt / .md / .pptx / .pdf";
    $("btn-distill").disabled = true;
    $("btn-distill").textContent = ui.action;
    return;
  }
  const totalKb = pickedFiles.reduce((s, f) => s + (f.size || 0), 0) / 1024;
  el.innerHTML =
    `<div>已选 <strong>${pickedFiles.length}</strong> 个文件（约 ${totalKb.toFixed(0)} KB）：</div>` +
    pickedFiles
      .map(
        (f, i) =>
          `<div class="pick-item"><span>${escapeHtml(f.name)}（${((f.size || 0) / 1024).toFixed(0)} KB）</span>` +
          `<button type="button" data-i="${i}" class="pick-remove" aria-label="移除">×</button></div>`
      )
      .join("");
  el.querySelectorAll(".pick-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      pickedFiles.splice(Number(btn.dataset.i), 1);
      renderPickList();
    });
  });
  $("btn-distill").disabled = false;
  $("btn-distill").textContent = ui.action;
}

function renderFactsPickList() {
  const el = $("facts-pick-list");
  if (!el) return;
  if (!factsPickedFiles.length) {
    el.textContent = "尚未选择文件。支持 .docx / .txt / .md / .pptx / .pdf";
    $("btn-facts-run").disabled = true;
    return;
  }
  const totalKb = factsPickedFiles.reduce((s, f) => s + (f.size || 0), 0) / 1024;
  el.innerHTML =
    `<div>已选 <strong>${factsPickedFiles.length}</strong> 个文件（约 ${totalKb.toFixed(0)} KB）：</div>` +
    factsPickedFiles
      .map(
        (f, i) =>
          `<div class="pick-item"><span>${escapeHtml(f.name)}（${((f.size || 0) / 1024).toFixed(0)} KB）</span>` +
          `<button type="button" data-i="${i}" class="pick-remove" aria-label="移除">×</button></div>`
      )
      .join("");
  el.querySelectorAll(".pick-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      factsPickedFiles.splice(Number(btn.dataset.i), 1);
      renderFactsPickList();
    });
  });
  $("btn-facts-run").disabled = false;
}

function identityPayloadAll(full) {
  const id = full || {};
  let events = Array.isArray(id.events) ? id.events.slice() : [];
  if (!events.length && Array.isArray(id.claims)) {
    events = id.claims.map((c) => ({
      when: c.when || "",
      what: c.value,
      roleLabels: [],
      org: c.org || "",
      actors: [],
      outcome: "",
      facets: ["roles"],
      confidence: "medium",
    }));
  }
  return {
    events,
    facts: id.facts || [],
    inferences: id.inferences || [],
    outcomes: id.outcomes || [],
    domains: id.domains || [],
    org_touchpoints: id.org_touchpoints || [],
    alter_candidates: id.alter_candidates || [],
    mind_hooks: id.mind_hooks || [],
    capability_signals: id.capability_signals || [],
  };
}

function personaAggAll(agg) {
  return {
    styleObservations: (agg && agg.styleObservations) || [],
    personaNotes: (agg && agg.personaNotes) || [],
    decisionFrameworks: (agg && agg.decisionFrameworks) || [],
    memories: (agg && agg.memories) || [],
  };
}

function countIdentityPayload(identity) {
  return (
    (identity.events || []).length +
    (identity.facts || []).length +
    (identity.inferences || []).length +
    (identity.outcomes || []).length +
    (identity.domains || []).length +
    (identity.org_touchpoints || []).length +
    (identity.alter_candidates || []).length +
    (identity.mind_hooks || []).length +
    (identity.capability_signals || []).length
  );
}

function countPersonaAgg(agg) {
  return (
    (agg.styleObservations || []).length +
    (agg.personaNotes || []).length +
    (agg.decisionFrameworks || []).length +
    (agg.memories || []).length
  );
}

function formatBuilderPreviewSummary(preview) {
  if (!preview) return "";
  const paths = (preview.affectedPaths || []).join("、") || "（无）";
  const kinds = (preview.dataKinds || []).join("、") || "inference";
  const refs = (preview.sourceRefs || []).join("、") || "—";
  if (preview.materialKind === "identity") {
    const fieldLines = [];
    const fk = preview.fieldKinds || {};
    for (const [field, kind] of Object.entries(fk)) {
      if (!kind) continue;
      fieldLines.push(`${field}→${kind}`);
    }
    return [
      "预览（资料尚未改动）",
      `基准版本：${preview.baseRevision ?? "—"}`,
      `数据类别：${kinds}`,
      fieldLines.length ? `字段分类：${fieldLines.join("；")}` : null,
      `来源：${refs}`,
      `将修改：${paths}`,
      `条目：事件 ${preview.events || 0} · 事实短句 ${preview.facts || 0} · 推断 ${preview.inferences || 0} · 成就 ${preview.outcomes || 0}`,
      Array.isArray(preview.factConfirmedFields) && preview.factConfirmedFields.length
        ? `已确认事实字段：${preview.factConfirmedFields.join("、")}`
        : "未确认事实字段：事件/事实短句/成就仅按推断写入，不会形成本人声明。",
      "确认后才会写入并形成新版本；可放弃。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "预览（资料尚未改动）",
    `基准版本：${preview.baseRevision ?? "—"}`,
    `数据类别：${kinds}`,
    `来源：${refs}`,
    `将修改：${paths}`,
    `条目：记忆 ${preview.memories || 0} · 框架 ${preview.frameworks || 0} · 风格 ${preview.styleObservations || 0} · 人格 ${preview.personaNotes || 0}`,
    "确认后才会写入并形成新版本；可放弃。",
  ].join("\n");
}

function formatIdentityCommitSummary(r) {
  if (!r) return "";
  const rev = r.revision != null ? String(r.revision) : "—";
  const roll = r.rollbackVersion != null ? String(r.rollbackVersion) : "—";
  const paths = (r.affectedPaths || []).join("、") || "（无）";
  const kinds = (r.dataKinds || []).join("、") || "—";
  let msg =
    `已写入人生事实（${kinds}）。` +
    `事件 +${r.events || 0}` +
    (r.inferences ? `，推断 +${r.inferences}` : "") +
    (r.outcomes ? `，成就 +${r.outcomes}` : "") +
    (r.people ? `，关系人 +${r.people}` : "") +
    `。\n新版本：${rev}（可恢复到版本 ${roll}）。\n修改范围：${paths}`;
  if (r.archiveWarning) msg += "\n" + r.archiveWarning;
  return msg;
}

function formatBuilderCommitSummary(r) {
  if (!r) return "写入完成。";
  const rev = r.revision != null ? String(r.revision) : "—";
  const roll = r.rollbackVersion != null ? String(r.rollbackVersion) : "—";
  const paths = (r.affectedPaths || []).join("、") || "—";
  return (
    `已确认写入观念：记忆 +${r.memories || 0}，框架 +${r.frameworks || 0}，` +
    `风格 +${r.styleObservations || 0}，人格观察 +${r.personaNotes || 0}。` +
    `\n新版本：${rev}（可恢复到版本 ${roll}）。\n修改范围：${paths}`
  );
}

/** Preview + Owner-confirmed commit for persona distill (PackageStore). */
async function previewAndCommitPersonaWrite(agg, src, options = {}) {
  if (!window.digitalMe.previewDistillWrite || !window.digitalMe.writeDistill) {
    throw new Error("当前版本不支持经资料库确认的写入，请完全退出后重新启动应用。");
  }
  const preview = await window.digitalMe.previewDistillWrite({
    materialKind: "persona",
    agg,
    filePath: src.filePath,
    title: src.title,
  });
  const previewBox = $("builder-write-preview");
  if (previewBox) {
    previewBox.textContent = formatBuilderPreviewSummary(preview);
    previewBox.classList.remove("hidden");
  }
  if (options.onPreview) options.onPreview(preview);

  if (options.requireExplicitConfirm) {
    const ok = window.confirm(
      "预览已生成，资料尚未改动。\n\n" +
        formatBuilderPreviewSummary(preview) +
        "\n\n确认将以上变更写入数字之我资料吗？"
    );
    if (!ok) {
      return { ok: false, cancelled: true, preview };
    }
  }

  const r = await window.digitalMe.writeDistill({
    materialKind: "persona",
    changeSetId: preview.changeSetId,
    confirmed: true,
  });
  return { ok: true, preview, result: r };
}

/** Preview + Owner-confirmed commit for identity distill (PackageStore). */
async function previewAndCommitIdentityWrite(identity, src, options = {}) {
  if (!window.digitalMe.previewDistillWrite || !window.digitalMe.writeDistill) {
    throw new Error("当前版本不支持经资料库确认的写入，请完全退出后重新启动应用。");
  }
  const factConfirmedFields = Array.isArray(options.factConfirmedFields)
    ? options.factConfirmedFields
    : [];
  const preview = await window.digitalMe.previewDistillWrite({
    materialKind: "identity",
    identity,
    filePath: src.filePath,
    title: src.title,
    factConfirmedFields,
  });
  const previewBox = $("builder-write-preview");
  if (previewBox) {
    previewBox.textContent = formatBuilderPreviewSummary(preview);
    previewBox.classList.remove("hidden");
  }
  if (options.onPreview) options.onPreview(preview);

  if (options.requireExplicitConfirm !== false) {
    const ok = window.confirm(
      "预览已生成，资料尚未改动。\n\n" +
        formatBuilderPreviewSummary(preview) +
        "\n\n确认将以上变更写入数字之我资料吗？"
    );
    if (!ok) {
      return { ok: false, cancelled: true, preview };
    }
  }

  const r = await window.digitalMe.writeDistill({
    materialKind: "identity",
    changeSetId: preview.changeSetId,
    confirmed: true,
  });
  return { ok: true, preview, result: r };
}

/** Write distill result without checkbox review (智能构建 / 少决策). */
async function autoWriteDistillResult(result, label) {
  const kind = (result && result.materialKind) || materialKind || "persona";
  const src = label || currentSourceLabel || { filePath: "", title: "素材" };
  const base = { committed: false, cancelled: false, skipped: false, revision: null, kind };
  if (kind === "custody") {
    const pel = progressEl();
    if (pel) pel.textContent += "已收入保管库（未写入人格）。\n";
    $("builder-review").classList.add("hidden");
    distillResult = null;
    return { ...base, committed: true, kind: "custody", meta: result.meta };
  }
  if (kind === "identity") {
    const identity = identityPayloadAll(result.identity || {});
    if (!countIdentityPayload(identity)) {
      const pel = progressEl();
      if (pel) pel.textContent += "未提取到可写入事实，已跳过。\n";
      distillResult = null;
      return { ...base, skipped: true, kind: "identity" };
    }
    const committed = await previewAndCommitIdentityWrite(identity, src, {
      factConfirmedFields: [],
      requireExplicitConfirm: true,
      onPreview: (preview) => {
        const line = formatBuilderPreviewSummary(preview);
        if (progressSinkId === "inbox-progress") {
          updateInboxProgressSummary({
            current: "已生成写入预览（资料未改动）",
            appendDetail: line,
          });
        } else {
          const pel = progressEl();
          if (pel) pel.textContent += line + "\n";
        }
      },
    });
    if (!committed.ok) {
      const msg = "已取消，资料未写入。";
      if (progressSinkId === "inbox-progress") {
        updateInboxProgressSummary({ headline: "已取消", current: msg, appendDetail: msg });
      } else {
        const pel = progressEl();
        if (pel) pel.textContent += msg + "\n";
      }
      return { ...base, cancelled: true, kind: "identity" };
    }
    const r = committed.result;
    if (!isValidPackageRevision(r.revision)) {
      const msg = "写入结果缺少有效版本号，未将材料标记为已写入。";
      if (progressSinkId === "inbox-progress") {
        updateInboxProgressSummary({ headline: "写入未完成", current: msg, appendDetail: msg });
      } else {
        const pel = progressEl();
        if (pel) pel.textContent += msg + "\n";
      }
      return { ...base, kind: "identity" };
    }
    const writeLine = formatIdentityCommitSummary(r);
    if (progressSinkId === "inbox-progress") {
      updateInboxProgressSummary({ current: "已写入人生事实", appendDetail: writeLine });
    } else {
      const pel = progressEl();
      if (pel) pel.textContent += writeLine + "\n";
    }
    $("builder-review").classList.add("hidden");
    distillResult = null;
    try {
      pkg = await window.digitalMe.loadPackage();
      renderPackageStatus();
      await refreshPackageVersionsPanel();
      await refreshMeView();
    } catch {
      /* ignore refresh failures after successful write */
    }
    return {
      ...base,
      committed: true,
      kind: "identity",
      revision: r.revision,
      result: r,
      meta: result.meta,
    };
  }
  const agg = personaAggAll(result.agg);
  if (!countPersonaAgg(agg)) {
    const pel = progressEl();
    if (pel) pel.textContent += "未提取到可写入观念条目，已跳过。\n";
    distillResult = null;
    return { ...base, skipped: true, kind: "persona" };
  }
  const committed = await previewAndCommitPersonaWrite(agg, src, {
    requireExplicitConfirm: true,
    onPreview: (preview) => {
      const line = formatBuilderPreviewSummary(preview);
      if (progressSinkId === "inbox-progress") {
        updateInboxProgressSummary({ current: "已生成写入预览（资料未改动）", appendDetail: line });
      } else {
        const pel = progressEl();
        if (pel) pel.textContent += line + "\n";
      }
    },
  });
  if (!committed.ok) {
    const msg = "已取消，资料未写入。";
    if (progressSinkId === "inbox-progress") {
      updateInboxProgressSummary({ headline: "已取消", current: msg, appendDetail: msg });
    } else {
      const pel = progressEl();
      if (pel) pel.textContent += msg + "\n";
    }
    return { ...base, cancelled: true, kind: "persona" };
  }
  const r = committed.result;
  if (!isValidPackageRevision(r.revision)) {
    const msg = "写入结果缺少有效版本号，未将材料标记为已写入。";
    if (progressSinkId === "inbox-progress") {
      updateInboxProgressSummary({ headline: "写入未完成", current: msg, appendDetail: msg });
    } else {
      const pel = progressEl();
      if (pel) pel.textContent += msg + "\n";
    }
    return { ...base, kind: "persona" };
  }
  if (result.meta && result.meta.hookIds && result.meta.hookIds.length) {
    try {
      await window.digitalMe.markMindHooksDistilled(result.meta.hookIds);
    } catch {
      /* ignore */
    }
  }
  const pel = progressEl();
  const writeLine = formatBuilderCommitSummary(r);
  if (progressSinkId === "inbox-progress") {
    updateInboxProgressSummary({
      current: `已写入，版本 ${r.revision}`,
      appendDetail: writeLine,
    });
  } else if (pel) {
    pel.textContent += writeLine + "\n";
  }
  $("builder-review").classList.add("hidden");
  distillResult = null;
  try {
    pkg = await window.digitalMe.loadPackage();
    renderPackageStatus();
    await refreshPackageVersionsPanel();
  } catch {
    /* ignore */
  }
  return {
    ...base,
    committed: true,
    kind: "persona",
    revision: r.revision,
    result: r,
    meta: result.meta,
  };
}

let progressSinkId = "builder-progress";

function setProgressSink(id) {
  progressSinkId = id || "builder-progress";
}

function progressEl() {
  return $(progressSinkId) || $("builder-progress") || $("inbox-progress");
}

/** Compact progress UI for 构建 · 投递箱（少刷屏）. */
function showInboxProgressCard() {
  const card = $("inbox-progress-card");
  if (card) card.classList.remove("hidden");
}

function hideBuildDoneBanner() {
  const banner = $("build-done-banner");
  if (banner) banner.classList.add("hidden");
  const cta = $("btn-build-goto-self");
  if (cta) cta.textContent = "查看数字之我";
  buildDoneTargetTab = "overview";
}

function updateInboxProgressSummary({ headline, current, countsText, appendDetail, resetDetail }) {
  showInboxProgressCard();
  if (headline != null) {
    const h = $("inbox-progress-headline");
    if (h) h.textContent = headline;
  }
  if (current != null) {
    const c = $("inbox-progress-current");
    if (c) c.textContent = current;
  }
  if (countsText != null) {
    const n = $("inbox-progress-counts");
    if (n) n.textContent = countsText;
  }
  const detail = $("inbox-progress");
  if (detail) {
    if (resetDetail) detail.textContent = "";
    if (appendDetail) {
      detail.textContent += appendDetail.endsWith("\n") ? appendDetail : appendDetail + "\n";
      // keep detail from growing without bound
      const lines = detail.textContent.split("\n");
      if (lines.length > 80) {
        detail.textContent = lines.slice(-60).join("\n");
      }
    }
  }
}

function showBuildDoneBanner({ summary, deferred, undecided }) {
  showInboxProgressCard();
  const banner = $("build-done-banner");
  const sum = $("build-done-summary");
  if (!banner) return;
  const parts = [];
  if (summary) parts.push(summary);
  if (deferred > 0) parts.push(`还剩 ${deferred} 份，可再点「智能构建」`);
  if (undecided > 0) parts.push(`${undecided} 份待定需先指定用途`);
  if (sum) sum.textContent = parts.join(" · ") || "可在「数字之我」查看覆盖度与内容。";
  banner.classList.remove("hidden");
  const completeSummary =
    (summary && String(summary).trim()) ||
    "我已经根据本次确认更新了对你的认识";
  buildSessionComplete = { summary: completeSummary };
  applyBuildWizard();
  try {
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch {
    /* ignore */
  }
  const cta = $("btn-build-goto-self");
  if (cta) {
    cta.focus();
  }
}

async function runMaterialPipeline(kind, files, options = {}) {
  if (!files.length) {
    return { committed: false, cancelled: false, skipped: true, revision: null, kind };
  }
  const autoWrite = !!options.autoWrite;
  const smart = !!options.smart || autoWrite;
  materialKind = kind;
  if (smart) setProgressSink("inbox-progress");
  else setProgressSink("builder-progress");
  $("builder-review").classList.add("hidden");
  const pel = progressEl();
  const prepLabel =
    kind === "custody"
      ? `准备收入保管库（${files.length} 个文件）…`
      : kind === "identity"
        ? `准备从材料提取人生事实（${files.length} 个文件）…`
        : `准备处理 ${files.length} 个文件…`;
  if (smart) {
    updateInboxProgressSummary({
      current: prepLabel,
      appendDetail: prepLabel,
    });
  } else if (pel) {
    pel.textContent = prepLabel + "\n";
  }
  if (kind === "identity" && !autoWrite && !smart) {
    goSelfView("timeline");
  }
  try {
    currentSourceLabel = {
      filePath: files.map((f) => f.filePath).join(";"),
      title: files.length === 1 ? files[0].name : `批量素材（${files.length} 个文件）`,
    };
    const res = await window.digitalMe.distill({
      filePaths: files.map((f) => f.filePath),
      materialKind: kind,
      options: smart
        ? { smart: true, maxChars: 20000, maxChunks: 2 }
        : { maxChars: 28000, maxChunks: 3 },
    });
    distillResult = { ...res, materialKind: res.materialKind || kind };
    if (autoWrite) {
      return await autoWriteDistillResult(distillResult, currentSourceLabel);
    }
    if (kind !== "custody") {
      switchMeLane("build");
    }
    renderReview(distillResult);
    return {
      committed: false,
      cancelled: false,
      skipped: false,
      revision: null,
      extracted: true,
      kind,
      materialKind: distillResult.materialKind || kind,
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const errLine = msg.includes("中断") ? "已中断。" : "处理出错：" + msg;
    if (smart) {
      updateInboxProgressSummary({
        headline: msg.includes("中断") ? "已中断" : "构建失败",
        current: errLine,
        appendDetail: errLine,
      });
    } else if (pel) {
      pel.textContent += errLine + "\n";
    }
    throw e;
  } finally {
    if (!smart) setProgressSink("builder-progress");
  }
}

function buildReviewModeGroups(items) {
  const groups = { identity: [], persona: [], custody: [] };
  for (const it of items || []) {
    const k = it.materialKind || it.suggestedKind;
    if (groups[k]) groups[k].push(it);
  }
  const out = [];
  for (const kind of ["custody", "identity", "persona"]) {
    if (groups[kind].length) out.push({ kind, items: groups[kind] });
  }
  return out;
}

async function loadCurrentReviewGroup() {
  const group = reviewModeGroups[reviewModeIndex];
  if (!group) {
    clearReviewModeState();
    return false;
  }
  setPendingReviewIds(group.items.map((it) => it.id));
  await markInboxItemsStatus(pendingReviewInboxIds, "processing");
  updateInboxProgressSummary({
    headline: "进入审阅模式…",
    current: `处理 ${group.items.length} 份「${inboxKindLabel(group.kind)}」`,
    appendDetail: `审阅分组 ${reviewModeIndex + 1}/${reviewModeGroups.length}：${inboxKindLabel(group.kind)}`,
  });
  await runMaterialPipeline(
    group.kind,
    group.items.map((it) => ({ filePath: it.filePath, name: it.name, size: it.size || 0 })),
    { smart: true }
  );
  await markPendingReviewAwaiting();
  return true;
}

async function startReviewMode(ready) {
  reviewModeGroups = buildReviewModeGroups(ready);
  reviewModeIndex = 0;
  if (!reviewModeGroups.length) return false;
  buildSessionComplete = null;
  hideBuildDoneBanner();
  goBuildView();
  setProgressSink("inbox-progress");
  showInboxProgressCard();
  return loadCurrentReviewGroup();
}

async function completeCurrentReviewCommitted(revision, options = {}) {
  const { requirePackageRevision = true } = options;
  if (requirePackageRevision && !isValidPackageRevision(revision)) {
    reviewModeGroups = [];
    reviewModeIndex = 0;
    distillResult = null;
    $("builder-review")?.classList.add("hidden");
    const msg = "写入结果缺少有效版本号，未将材料标记为已写入。";
    if (progressSinkId === "inbox-progress") {
      updateInboxProgressSummary({
        headline: "写入未完成",
        current: msg,
        appendDetail: msg,
      });
    } else {
      const pel = $("builder-progress");
      if (pel) pel.textContent = msg;
    }
    const ids = [...pendingReviewInboxIds];
    pendingReviewInboxIds = [];
    if (ids.length) await markInboxItemsStatus(ids, "suggested");
    await refreshInboxPanel();
    return { hasNext: false, completed: false, ok: false };
  }

  const currentIds = [...pendingReviewInboxIds];
  const nextIndex = reviewModeIndex + 1;
  const hasNext = nextIndex < reviewModeGroups.length;
  const meta = isValidPackageRevision(revision)
    ? { revision, committedAt: new Date().toISOString() }
    : undefined;

  // Advance the next group to awaiting_review before marking current written, so
  // observers never see a half-advanced queue (written + still suggested).
  if (hasNext) {
    reviewModeIndex = nextIndex;
    pendingReviewInboxIds = [];
    distillResult = null;
    ensureMeBuildLaneVisible();
    await loadCurrentReviewGroup();
    if (currentIds.length) await markInboxItemsStatus(currentIds, "written", meta);
    await refreshInboxPanel();
    return { hasNext: true, completed: false, ok: true };
  }

  const finalizeResult = await finalizePendingReviewAsWritten(revision, { requirePackageRevision });
  if (!finalizeResult.ok) {
    reviewModeGroups = [];
    reviewModeIndex = 0;
    distillResult = null;
    $("builder-review")?.classList.add("hidden");
    const msg = "写入结果缺少有效版本号，未将材料标记为已写入。";
    if (progressSinkId === "inbox-progress") {
      updateInboxProgressSummary({
        headline: "写入未完成",
        current: msg,
        appendDetail: msg,
      });
    } else {
      const pel = $("builder-progress");
      if (pel) pel.textContent = msg;
    }
    await refreshInboxPanel();
    return { hasNext: false, completed: false, ok: false };
  }
  clearReviewModeState();
  $("builder-review")?.classList.add("hidden");
  ensureMeBuildLaneVisible();
  updateInboxProgressSummary({
    headline: "审阅写入完成",
    current: "本批审阅已全部确认写入。",
    appendDetail: "审阅写入完成。",
  });
  return { hasNext: false, completed: true, ok: true };
}

async function abandonCurrentReview() {
  await cancelCurrentReviewWithoutWrite();
}

function focusReviewPanel() {
  // Pending review → show B4 + review panel without overview refresh storm.
  if (!buildSessionComplete) {
    lastBuildFlow = {
      ...(lastBuildFlow && typeof lastBuildFlow === "object" ? lastBuildFlow : {}),
      step: "B4",
    };
  }
  ensureMeBuildLaneVisible();
  const reviewEl = $("builder-review");
  if (reviewEl) reviewEl.classList.remove("hidden");
  const titleEl = $("builder-review-title") || document.querySelector("#builder-review h3");
  if (titleEl) {
    try {
      reviewEl.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      /* ignore */
    }
    try {
      titleEl.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
  const firstCb = $("review-content")?.querySelector('input[type="checkbox"]');
  if (firstCb) {
    try {
      firstCb.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
  const waitingMsg = "等待你审阅，尚未写入";
  if (progressSinkId === "inbox-progress") {
    updateInboxProgressSummary({ headline: "等待你审阅", current: waitingMsg });
  } else {
    const pel = $("builder-progress");
    if (pel) pel.textContent = waitingMsg;
  }
}

function bindBuilder() {
  if (window.digitalMe && typeof window.digitalMe.onBuilderProgress === "function") {
    window.digitalMe.onBuilderProgress(renderProgress);
  }

  document.querySelectorAll('input[name="material-kind"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      materialKind = selectedMaterialKind();
      renderPickList();
    });
  });
  syncMaterialKindUi();

  $("btn-pick")?.addEventListener("click", async () => {
    const files = await window.digitalMe.pickFile();
    const list = Array.isArray(files) ? files : files ? [files] : [];
    if (!list.length) return;
    const seen = new Set(pickedFiles.map((f) => f.filePath));
    for (const f of list) {
      if (f && f.filePath && !seen.has(f.filePath)) {
        pickedFiles.push(f);
        seen.add(f.filePath);
      }
    }
    renderPickList();
  });

  $("btn-distill")?.addEventListener("click", async () => {
    if (!pickedFiles.length) return;
    const kind = selectedMaterialKind();
    $("btn-distill").disabled = true;
    try {
      switchMeLane("build");
      await runMaterialPipeline(kind, pickedFiles);
    } finally {
      $("btn-distill").disabled = !pickedFiles.length;
      syncMaterialKindUi();
    }
  });

  $("btn-facts-pick")?.addEventListener("click", async () => {
    const files = await window.digitalMe.pickFile();
    const list = Array.isArray(files) ? files : files ? [files] : [];
    if (!list.length) return;
    const seen = new Set(factsPickedFiles.map((f) => f.filePath));
    for (const f of list) {
      if (f && f.filePath && !seen.has(f.filePath)) {
        factsPickedFiles.push(f);
        seen.add(f.filePath);
      }
    }
    renderFactsPickList();
  });

  $("btn-facts-run")?.addEventListener("click", async () => {
    if (!factsPickedFiles.length) return;
    $("btn-facts-run").disabled = true;
    try {
      switchMeLane("build");
      await runMaterialPipeline("identity", factsPickedFiles);
    } finally {
      $("btn-facts-run").disabled = !factsPickedFiles.length;
    }
  });

  $("btn-intake-distill")?.addEventListener("click", async () => {
    const gate = intakeMeetsMinimum();
    if (!gate.ok) {
      $("builder-progress").textContent = gate.msg;
      updateIntakeProgressHint();
      const card = $("intake-card");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    $("btn-intake-distill").disabled = true;
    $("builder-review").classList.add("hidden");
    setProgressSink("builder-progress");
    $("builder-progress").textContent = "准备中…";
    try {
      switchMeLane("build");
      currentSourceLabel = { filePath: "", title: "自我评测" };
      materialKind = "persona";
      const res = await window.digitalMe.distillIntake({ answers: intakeAnswers });
      distillResult = { ...res, materialKind: "persona" };
      renderReview(distillResult);
    } catch (e) {
      $("builder-progress").textContent = "处理出错：" + e.message;
    } finally {
      $("btn-intake-distill").disabled = false;
    }
  });

  $("btn-write")?.addEventListener("click", async () => {
    if (!distillResult) return;
    const kind = distillResult.materialKind || materialKind || "persona";

    if (kind === "custody") {
      let queueResult = { hasNext: false, completed: false, ok: true };
      if (reviewModeGroups.length && pendingReviewInboxIds.length) {
        queueResult = await completeCurrentReviewCommitted(null, { requirePackageRevision: false });
        if (!queueResult.hasNext) distillResult = null;
        return;
      }
      if (pendingReviewInboxIds.length) {
        await finalizePendingReviewAsWritten(null, { requirePackageRevision: false });
      }
      $("builder-review").classList.add("hidden");
      distillResult = null;
      $("builder-progress").textContent = "保管完成。材料仅留在本机保管库，未写入人格。";
      return;
    }

    if (kind === "identity") {
      const identity = collectSelectedIdentity(
        distillResult.identity || {
          events: [],
          claims: [],
          facts: [],
          inferences: [],
          outcomes: [],
          domains: [],
          org_touchpoints: [],
          alter_candidates: [],
          mind_hooks: [],
          capability_signals: [],
        }
      );
      const total =
        identity.events.length +
        identity.facts.length +
        identity.inferences.length +
        identity.outcomes.length +
        identity.domains.length +
        identity.org_touchpoints.length +
        identity.alter_candidates.length +
        identity.mind_hooks.length +
        identity.capability_signals.length;
      if (!total) {
        $("builder-progress").textContent = "请至少勾选一条再写入。";
        return;
      }
      // Checking events/facts/outcomes (default unchecked) is the explicit field confirmation.
      const factConfirmedFields = [];
      if (identity.events.length) factConfirmedFields.push("events");
      if (identity.facts.length) factConfirmedFields.push("facts");
      if (identity.outcomes.length) factConfirmedFields.push("outcomes");
      $("btn-write").disabled = true;
      try {
        const label = currentSourceLabel || { filePath: "", title: "社会事实材料" };
        const committed = await previewAndCommitIdentityWrite(identity, label, {
          factConfirmedFields,
          requireExplicitConfirm: true,
        });
        await afterReviewModePackageWrite(committed, {
          formatSummary: formatIdentityCommitSummary,
          clearFactsPick: true,
        });
      } catch (e) {
        $("builder-progress").textContent = "写入出错：" + e.message;
      } finally {
        $("btn-write").disabled = false;
      }
      return;
    }

    const agg = collectSelectedAgg(distillResult.agg);
    const total =
      agg.styleObservations.length +
      agg.personaNotes.length +
      agg.decisionFrameworks.length +
      agg.memories.length;
    if (!total) {
      $("builder-progress").textContent = "请至少勾选一条再写入。";
      return;
    }
    $("btn-write").disabled = true;
    try {
      const label = currentSourceLabel || { filePath: "", title: "素材" };
      const committed = await previewAndCommitPersonaWrite(agg, label, {
        requireExplicitConfirm: true,
      });
      await afterReviewModePackageWrite(committed, {
        formatSummary: formatBuilderCommitSummary,
        afterSuccess: async () => {
          if (distillResult.meta && distillResult.meta.hookIds && distillResult.meta.hookIds.length) {
            try {
              await window.digitalMe.markMindHooksDistilled(distillResult.meta.hookIds);
            } catch {
              /* ignore */
            }
          }
        },
      });
    } catch (e) {
      $("builder-progress").textContent = "写入出错：" + (e.message || String(e));
    } finally {
      $("btn-write").disabled = false;
    }
  });

  $("btn-discard")?.addEventListener("click", async () => {
    if (reviewModeGroups.length || pendingReviewInboxIds.length) {
      await cancelCurrentReviewWithoutWrite();
      return;
    }
    distillResult = null;
    $("builder-review").classList.add("hidden");
    const msg = "已放弃审阅，资料未写入。";
    if (progressSinkId === "inbox-progress") {
      updateInboxProgressSummary({ headline: "已放弃审阅", current: msg, appendDetail: msg });
    } else {
      $("builder-progress").textContent = msg;
    }
  });
}

function renderProgress(p) {
  const el = progressEl();
  if (!el) return;
  const kind = p.materialKind || materialKind || "persona";
  const isSocial = kind === "identity";
  const isCustody = kind === "custody";
  const useSummary = progressSinkId === "inbox-progress";

  let line = "";
  if (p.phase === "file") {
    line = p.label || `处理文件 ${p.index}/${p.total}：${p.name || ""}`;
  } else if (p.phase === "start") {
    const prefix =
      p.fileName && p.fileTotal
        ? `【${p.fileName} ${p.fileIndex}/${p.fileTotal}】`
        : "";
    if (isCustody) {
      line = `${prefix}已读取 ${p.chars || 0} 字，登记保管…`;
    } else if (isSocial) {
      line = `${prefix}材料共 ${p.chars} 字，分为 ${p.chunks} 段，开始提取社会事实…`;
    } else {
      line = `${prefix}素材共 ${p.chars} 字，分为 ${p.chunks} 段，开始蒸馏…`;
    }
  } else if (p.phase === "chunk") {
    line = isSocial
      ? `提取社会事实 第 ${p.index}/${p.total} 段…`
      : `蒸馏第 ${p.index}/${p.total} 段…`;
  } else if (p.phase === "chunk-retry") {
    line = `第 ${p.index} 段重试（第 ${p.attempt} 次）…`;
  } else if (p.phase === "chunk-error") {
    line = `第 ${p.index} 段出错（已跳过）：${p.message}`;
  } else if (p.phase === "done") {
    line = isCustody ? "保管登记完成。" : isSocial ? "社会事实提取完成。" : "蒸馏完成。";
  }

  if (!line) return;

  if (useSummary) {
    let countsText = null;
    if (p.phase === "file" && p.total) {
      countsText = `${p.index || 0}/${p.total}`;
    } else if (p.fileTotal) {
      countsText = `文件 ${p.fileIndex || 0}/${p.fileTotal}`;
    }
    updateInboxProgressSummary({
      headline: p.phase === "done" ? "本步完成" : "正在构建…",
      current: line,
      countsText,
      appendDetail: line,
    });
  } else {
    el.textContent += line + "\n";
  }
}

let intakeBank = null;
async function renderIntakeForm() {
  if (!intakeBank) {
    try {
      intakeBank = await window.digitalMe.getIntakeQuestions();
    } catch (e) {
      $("intake-form").innerHTML = `<div class="muted">加载问卷失败：${e.message}</div>`;
      return;
    }
  }
  const ver = String((intakeBank && intakeBank.version) || "0");
  if ($("intake-form").dataset.rendered === ver) {
    updateIntakeProgressHint();
    return;
  }
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function parseMulti(raw) {
    return String(raw || "")
      .split(/\s*\/\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  let html = "";
  if (intakeBank.completionGuide) {
    html += `<div class="intake-guide"><strong>完成建议</strong>：${esc(
      intakeBank.completionGuide.minimum || ""
    )}</div>`;
  }
  for (const sec of intakeBank.sections || []) {
    html += `<div class="intake-section" data-sec="${esc(sec.id || "")}"><h4>${esc(
      sec.title
    )}</h4><div class="sec-hint">${esc(sec.hint || "")}</div>`;
    for (const q of sec.questions || []) {
      const input = q.input || (sec.type === "scale" ? "scale" : "open");
      html += `<div class="intake-q" data-input="${esc(input)}"><label>${esc(q.text)}</label>`;
      if (input === "scale" || input === "single") {
        html += `<div class="intake-scale" data-qid="${esc(q.id)}" data-mode="single">`;
        html += (q.options || [])
          .map((o) => `<button type="button" data-val="${esc(o)}">${esc(o)}</button>`)
          .join("");
        html += `</div>`;
      } else if (input === "multi") {
        const maxSel = Number(q.maxSelect) > 0 ? Number(q.maxSelect) : 3;
        html += `<div class="intake-scale intake-multi" data-qid="${esc(
          q.id
        )}" data-mode="multi" data-max="${maxSel}">`;
        html += (q.options || [])
          .map((o) => `<button type="button" data-val="${esc(o)}">${esc(o)}</button>`)
          .join("");
        html += `</div><div class="intake-multi-hint muted" data-for="${esc(
          q.id
        )}">可选最多 ${maxSel} 项</div>`;
      } else {
        const rows = Number(q.rows) > 0 ? Number(q.rows) : 2;
        html += `<textarea data-qid="${esc(q.id)}" rows="${rows}"></textarea>`;
      }
      if (q.followupId) {
        html += `<input type="text" class="intake-followup" data-qid="${esc(
          q.followupId
        )}" placeholder="${esc(q.followup || "可选补充")}" />`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  $("intake-form").innerHTML = html;
  $("intake-form").dataset.rendered = ver;

  $("intake-form").querySelectorAll("textarea[data-qid], input.intake-followup[data-qid]").forEach((el) => {
    if (intakeAnswers[el.dataset.qid]) el.value = intakeAnswers[el.dataset.qid];
    el.addEventListener("input", () => {
      intakeAnswers[el.dataset.qid] = el.value;
      updateIntakeProgressHint();
    });
  });

  $("intake-form").querySelectorAll(".intake-scale").forEach((grp) => {
    const mode = grp.dataset.mode || "single";
    const qid = grp.dataset.qid;
    const maxSel = Number(grp.dataset.max) > 0 ? Number(grp.dataset.max) : 3;
    const saved = intakeAnswers[qid];
    if (mode === "multi") {
      const selected = new Set(parseMulti(saved));
      grp.querySelectorAll("button").forEach((btn) => {
        if (selected.has(btn.dataset.val)) btn.classList.add("sel");
        btn.addEventListener("click", () => {
          const cur = new Set(parseMulti(intakeAnswers[qid]));
          if (cur.has(btn.dataset.val)) {
            cur.delete(btn.dataset.val);
            btn.classList.remove("sel");
          } else {
            if (cur.size >= maxSel) return;
            cur.add(btn.dataset.val);
            btn.classList.add("sel");
          }
          intakeAnswers[qid] = Array.from(cur).join(" / ");
          updateIntakeProgressHint();
        });
      });
    } else {
      grp.querySelectorAll("button").forEach((btn) => {
        if (saved && btn.dataset.val === saved) btn.classList.add("sel");
        btn.addEventListener("click", () => {
          grp.querySelectorAll("button").forEach((b) => b.classList.remove("sel"));
          btn.classList.add("sel");
          intakeAnswers[qid] = btn.dataset.val;
          updateIntakeProgressHint();
        });
      });
    }
  });
  updateIntakeProgressHint();
}

function countFilled(ids) {
  return (ids || []).filter((id) => String(intakeAnswers[id] || "").trim()).length;
}

function countMultiItems(id) {
  return String(intakeAnswers[id] || "")
    .split(/\s*\/\s*/)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

function updateIntakeProgressHint() {
  const el = $("intake-progress-hint");
  if (!el || !intakeBank) return;
  const traitIds = ["t_open", "t_consc", "t_extra", "t_agree", "t_stable"];
  const sitIds = ["s_info", "s_principle", "s_person", "s_time", "s_dissent", "s_fair", "s_fail"];
  const lifeIds = ["l_timeline", "l_peak", "l_domain"];
  const traits = countFilled(traitIds);
  const valuesOk = countMultiItems("v_top3") >= 3 && countMultiItems("v_never") >= 1;
  const valuesPart = (countMultiItems("v_top3") >= 3 ? 1 : 0) + (countMultiItems("v_never") >= 1 ? 1 : 0);
  const sit = countFilled(sitIds);
  const life = countFilled(lifeIds);
  const minOk = traits >= 5 && valuesOk && sit >= 3;
  const bits = [
    `性格 ${traits}/5`,
    `价值 ${valuesPart}/2`,
    `情境 ${sit}/7（至少 3）`,
    `经历概要 ${life}/3（无履历时建议填）`,
  ];
  el.textContent = (minOk ? "必答题已齐。 " : "必答题尚未齐。 ") + bits.join(" · ");
  el.classList.toggle("intake-ready", minOk);
}

function intakeMeetsMinimum() {
  const traitIds = ["t_open", "t_consc", "t_extra", "t_agree", "t_stable"];
  const sitAll = ["s_info", "s_principle", "s_person", "s_time", "s_dissent", "s_fair", "s_fail"];
  if (countFilled(traitIds) < 5) return { ok: false, msg: "请先完成性格倾向 5 题。" };
  if (countMultiItems("v_top3") < 3) return { ok: false, msg: "请在价值排序中选出恰好 3 项驱动因素。" };
  if (countMultiItems("v_never") < 1) return { ok: false, msg: "请至少选择 1 项绝不妥协的底线。" };
  if (countFilled(sitAll) < 3) {
    return {
      ok: false,
      msg: "情境判断请至少完成 3 题（建议优先完成标有「优先」的三题）。",
    };
  }
  return { ok: true, msg: "" };
}

function collectSelectedAgg(full) {
  const agg = {
    styleObservations: [],
    personaNotes: [],
    decisionFrameworks: [],
    memories: [],
  };
  const root = $("review-content");
  if (!root || !full) return agg;
  for (const kind of Object.keys(agg)) {
    const list = full[kind] || [];
    root.querySelectorAll(`input[type="checkbox"][data-kind="${kind}"]`).forEach((cb) => {
      if (!cb.checked) return;
      const i = Number(cb.dataset.i);
      if (Number.isInteger(i) && list[i] != null) agg[kind].push(list[i]);
    });
  }
  return agg;
}

function collectSelectedIdentity(full) {
  const out = {
    events: [],
    facts: [],
    inferences: [],
    outcomes: [],
    domains: [],
    org_touchpoints: [],
    alter_candidates: [],
    mind_hooks: [],
    capability_signals: [],
    claims: [],
  };
  const root = $("review-content");
  if (!root || !full) return out;
  const eventSource =
    full.events && full.events.length
      ? full.events
      : (full.claims || []).map((c) => ({
          when: c.when || "",
          what: c.value,
          roleLabels: [],
          org: c.org || "",
          actors: [],
          outcome: "",
          facets: ["roles"],
          confidence: "medium",
        }));
  root.querySelectorAll('input[type="checkbox"][data-kind="events"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && eventSource[i] != null) out.events.push(eventSource[i]);
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="claims"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && eventSource[i] != null && !out.events.includes(eventSource[i])) {
      out.events.push(eventSource[i]);
    }
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="facts"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.facts && full.facts[i] != null) out.facts.push(full.facts[i]);
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="inferences"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.inferences && full.inferences[i] != null) {
      out.inferences.push(full.inferences[i]);
    }
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="outcomes"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.outcomes && full.outcomes[i] != null) out.outcomes.push(full.outcomes[i]);
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="domains"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.domains && full.domains[i] != null) out.domains.push(full.domains[i]);
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="org_touchpoints"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.org_touchpoints && full.org_touchpoints[i] != null) {
      out.org_touchpoints.push(full.org_touchpoints[i]);
    }
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="alter_candidates"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.alter_candidates && full.alter_candidates[i] != null) {
      out.alter_candidates.push(full.alter_candidates[i]);
    }
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="mind_hooks"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.mind_hooks && full.mind_hooks[i] != null) {
      out.mind_hooks.push(full.mind_hooks[i]);
    }
  });
  root.querySelectorAll('input[type="checkbox"][data-kind="capability_signals"]').forEach((cb) => {
    if (!cb.checked) return;
    const i = Number(cb.dataset.i);
    if (Number.isInteger(i) && full.capability_signals && full.capability_signals[i] != null) {
      out.capability_signals.push(full.capability_signals[i]);
    }
  });
  out.claims = out.events.map((e) => ({ type: "role", value: e.what, when: e.when, org: e.org }));
  return out;
}

function updateReviewWriteState() {
  if (!distillResult) return;
  const kind = distillResult.materialKind || "persona";
  const btn = $("btn-write");
  if (!btn) return;

  if (kind === "custody") {
    btn.disabled = false;
    btn.textContent = "完成";
    return;
  }

  if (kind === "identity") {
    const id = collectSelectedIdentity(
      distillResult.identity || {
        events: [],
        facts: [],
        inferences: [],
        outcomes: [],
        domains: [],
        org_touchpoints: [],
        alter_candidates: [],
        mind_hooks: [],
        capability_signals: [],
      }
    );
    const n =
      id.events.length +
      id.facts.length +
      id.inferences.length +
      id.outcomes.length +
      id.domains.length +
      id.org_touchpoints.length +
      id.alter_candidates.length +
      id.mind_hooks.length +
      id.capability_signals.length;
    btn.disabled = n < 1;
    btn.textContent = n < 1 ? "请先勾选内容" : `写入已勾选（${n} 条）`;
    return;
  }

  const agg = collectSelectedAgg(distillResult.agg);
  const n =
    agg.styleObservations.length +
    agg.personaNotes.length +
    agg.decisionFrameworks.length +
    agg.memories.length;
  btn.disabled = n < 1;
  btn.textContent = n < 1 ? "请先勾选内容" : `写入已勾选（${n} 条）`;
}

function renderReview(res) {
  const kind = (res && res.materialKind) || "persona";
  const ui = MATERIAL_KIND_UI[kind] || MATERIAL_KIND_UI.persona;
  const titleEl = document.querySelector("#builder-review h3");
  const hintEl = document.querySelector("#builder-review .review-hint");
  if (titleEl) titleEl.textContent = ui.reviewTitle;
  if (hintEl) hintEl.textContent = ui.reviewHint;

  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  if (kind === "custody") {
    const items = (res.custody && res.custody.items) || [];
    $("review-content").innerHTML =
      `<div class="review-group"><h4>已登记（${items.length}）</h4>` +
      (items.length
        ? `<ul class="review-checklist">` +
          items
            .map(
              (it) =>
                `<li class="review-item"><span>${esc(it.title)}` +
                (it.chars ? ` · ${it.chars} 字摘录` : " · 仅路径登记") +
                `</span></li>`
            )
            .join("") +
          `</ul>`
        : `<div class="empty">（无）</div>`) +
      `</div>`;
    $("btn-discard").classList.add("hidden");
    $("builder-review").classList.remove("hidden");
    updateReviewWriteState();
    focusReviewPanel();
    return;
  }

  $("btn-discard").classList.remove("hidden");

  const group = (title, dataKind, items, labelFn, opts = {}) => {
    const defaultChecked = opts.defaultChecked !== false;
    const factHint = opts.factConfirmHint
      ? `<p class="hint">勾选即表示确认该条目为事实或本人声明；默认不勾选。</p>`
      : "";
    const head =
      `<div class="review-group-head">` +
      `<h4>${esc(title)}（${items.length}）</h4>` +
      (items.length
        ? `<div class="review-group-tools">` +
          `<button type="button" class="btn-ghost review-toggle" data-kind="${dataKind}" data-on="1">全选</button>` +
          `<button type="button" class="btn-ghost review-toggle" data-kind="${dataKind}" data-on="0">全不选</button>` +
          `</div>`
        : "") +
      `</div>`;
    if (!items.length) {
      return `<div class="review-group" data-kind="${dataKind}">${head}<div class="empty">（无）</div></div>`;
    }
    const lis = items
      .map(
        (item, i) =>
          `<li class="review-item">` +
          `<label>` +
          `<input type="checkbox" data-kind="${dataKind}" data-i="${i}"${defaultChecked ? " checked" : ""} />` +
          `<span>${labelFn(item)}</span>` +
          `</label>` +
          `</li>`
      )
      .join("");
    return `<div class="review-group" data-kind="${dataKind}">${head}${factHint}<ul class="review-checklist">${lis}</ul></div>`;
  };

  if (kind === "identity") {
    const identity = res.identity || {
      events: [],
      claims: [],
      facts: [],
      inferences: [],
      outcomes: [],
      domains: [],
      org_touchpoints: [],
      alter_candidates: [],
      mind_hooks: [],
      capability_signals: [],
    };
    const eventList =
      identity.events && identity.events.length
        ? identity.events
        : (identity.claims || []).map((c) => ({
            when: c.when || "",
            what: c.value,
            roleLabels: [],
            org: c.org || "",
            actors: [],
            outcome: "",
          }));
    const formatEvent = (e) => {
      const when = e.when ? `<b>${esc(e.when)}</b> · ` : "";
      const org = e.org ? ` <span class="muted">@ ${esc(e.org)}</span>` : "";
      const roles =
        e.roleLabels && e.roleLabels.length
          ? ` <span class="muted">[${esc(e.roleLabels.join("、"))}]</span>`
          : "";
      return `${when}${esc(e.what)}${roles}${org}`;
    };
    const formatInf = (inf) => {
      const type = inf.type ? `<span class="muted">[${esc(inf.type)}]</span> ` : "";
      const conf = inf.confidence ? ` <span class="muted">${esc(inf.confidence)}</span>` : "";
      const based = inf.basedOn ? ` <span class="muted">· 依据：${esc(inf.basedOn)}</span>` : "";
      return `${type}${esc(inf.claim)}${conf}${based}`;
    };
    $("review-content").innerHTML =
      group("人生事件（角色 / 时间 / 机构）", "events", eventList, formatEvent, {
        defaultChecked: false,
        factConfirmHint: true,
      }) +
      group(
        "成就与结果",
        "outcomes",
        identity.outcomes || [],
        (o) => `${esc(o.title)}${o.when ? ` <span class="muted">（${esc(o.when)}）</span>` : ""}`,
        { defaultChecked: false, factConfirmHint: true }
      ) +
      group("议题 / 专长信号", "domains", identity.domains || [], (d) => esc(d)) +
      group(
        "机构触点（非人际关系）",
        "org_touchpoints",
        identity.org_touchpoints || [],
        (tp) => `${esc(tp.org)}${tp.kind ? ` <span class="muted">· ${esc(tp.kind)}</span>` : ""}`
      ) +
      group(
        "关系人候选（须有人名）",
        "alter_candidates",
        identity.alter_candidates || [],
        (a) => `${esc(a.name)}${a.relationType ? ` · ${esc(a.relationType)}` : ""}`
      ) +
      group(
        "能力边界线索",
        "capability_signals",
        identity.capability_signals || [],
        (c) => `<span class="muted">[${esc(c.polarity || "scope")}]</span> ${esc(c.signal)}`
      ) +
      group("观念线索（待蒸馏）", "mind_hooks", identity.mind_hooks || [], (m) => esc(m)) +
      group("围绕本人的推断（非硬事实）", "inferences", identity.inferences || [], formatInf) +
      group("补充短句", "facts", identity.facts || [], (f) => esc(f), {
        defaultChecked: false,
        factConfirmHint: true,
      });
  } else {
    const agg = res.agg || {
      styleObservations: [],
      personaNotes: [],
      decisionFrameworks: [],
      memories: [],
    };
    $("review-content").innerHTML =
      group("表达风格观察", "styleObservations", agg.styleObservations || [], (x) => esc(x)) +
      group("人格与立场观察", "personaNotes", agg.personaNotes || [], (x) => esc(x)) +
      group(
        "判断框架",
        "decisionFrameworks",
        agg.decisionFrameworks || [],
        (f) => `<b>${esc(f.name)}</b>（${esc(f.domain || "")}）`
      ) +
      group(
        "记忆（观点/判断）",
        "memories",
        agg.memories || [],
        (m) => `[${esc(m.confidence || "")}] ${esc(m.content)}`
      );
  }

  $("review-content").querySelectorAll('input[type="checkbox"][data-kind]').forEach((cb) => {
    cb.addEventListener("change", updateReviewWriteState);
  });
  $("review-content").querySelectorAll(".review-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataKind = btn.dataset.kind;
      const on = btn.dataset.on === "1";
      $("review-content")
        .querySelectorAll(`input[type="checkbox"][data-kind="${dataKind}"]`)
        .forEach((cb) => {
          cb.checked = on;
        });
      updateReviewWriteState();
    });
  });

  $("builder-review").classList.remove("hidden");
  updateReviewWriteState();
  focusReviewPanel();
}

async function openSettings(opts = {}) {
  const cfg = await window.digitalMe.getConfig();
  $("cfg-baseurl").value = cfg.baseURL || "";
  $("cfg-apikey").value = "";
  $("cfg-model").value = cfg.model || "";
  $("cfg-pkgdir").value = cfg.packageDir || pkg.dir || "";
  const statusEl = $("cfg-apikey-status");
  if (statusEl) {
    statusEl.textContent = cfg.apiKeyConfigured
      ? "已安全保存（输入框保持空白；留空保存将保留现有密钥）"
      : "尚未配置密钥";
  }
  const warnEl = $("cfg-secret-warning");
  if (warnEl) {
    warnEl.textContent =
      cfg.secretStoreWarning && cfg.secretStoreWarning.message
        ? cfg.secretStoreWarning.message
        : "";
  }
  try {
    const cli = await window.digitalMe.l0GetCliAgentConfig?.();
    if (cli) {
      if ($("cfg-cli-executable")) {
        $("cfg-cli-executable").value = cli.executable || cli.command || "";
      }
      if ($("cfg-cli-cwd-root")) {
        $("cfg-cli-cwd-root").value = cli.authorizedCwdRoot || cli.cwd || "";
      }
      if ($("cfg-cli-enabled")) $("cfg-cli-enabled").checked = !!cli.enabled;
    }
  } catch {
    /* ignore */
  }
  await refreshSettingsAuditList();
  await refreshPackageVersionsPanel();
  await refreshSandboxPackageUi();
  const settingsModal = $("settings-modal");
  const settingsBody = settingsModal.querySelector(".settings-modal-body");
  settingsModal.classList.remove("hidden");
  if (settingsBody) settingsBody.scrollTop = 0;
  const versionsSection = $("settings-pkg-versions");
  if (versionsSection) {
    versionsSection.classList.remove("settings-section-focused");
    versionsSection.removeAttribute("data-panorama-focus");
  }
  if (opts && opts.focusPackageVersions) {
    focusSettingsPackageVersions();
  }
}

/** Open settings and bring「资料版本」into view with focus. */
async function openSettingsPackageVersions() {
  await openSettings({ focusPackageVersions: true });
}

function focusSettingsPackageVersions() {
  const settingsModal = $("settings-modal");
  const settingsBody = settingsModal && settingsModal.querySelector(".settings-modal-body");
  const section = $("settings-pkg-versions");
  const heading = $("settings-pkg-versions-heading");
  if (!section) return;
  section.classList.add("settings-section-focused");
  section.setAttribute("data-panorama-focus", "1");
  if (!section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
  const scrollTarget = () => {
    if (typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (settingsBody) {
      settingsBody.scrollTop = Math.max(0, section.offsetTop - 12);
    }
    const focusEl = heading || section;
    try {
      focusEl.focus({ preventScroll: true });
    } catch {
      try {
        focusEl.focus();
      } catch {
        /* ignore */
      }
    }
  };
  setTimeout(scrollTarget, 40);
}

/** Prevent duplicate temp/regular package switches. */
let sandboxPackageSwitchBusy = false;

const TEMP_PKG_CONFIRM_TEXT =
  "将创建临时测试资料。\n\n" +
  "• 将切换当前资料目录\n" +
  "• 不会修改常规资料\n" +
  "• 临时资料中的内容不会自动合并回常规资料\n\n" +
  "是否继续？";

const RESTORE_PKG_CONFIRM_TEXT =
  "将恢复到常规资料目录。\n\n" +
  "临时测试资料不会自动合并进常规资料。\n\n" +
  "是否继续？";

async function refreshSandboxPackageUi() {
  const banner = $("settings-temp-pkg-banner");
  const restoreBtn = $("btn-restore-regular-pkg");
  const createBtn = $("btn-create-temp-test-pkg");
  let status = { isUsingTemp: false, canRestoreRegular: false, currentPackageDir: "" };
  try {
    if (window.digitalMe.getSandboxPackageStatus) {
      status = (await window.digitalMe.getSandboxPackageStatus()) || status;
    }
  } catch {
    /* ignore */
  }
  if (banner) {
    banner.classList.toggle("hidden", !status.isUsingTemp);
  }
  if (restoreBtn) {
    restoreBtn.classList.toggle("hidden", !status.canRestoreRegular);
    restoreBtn.disabled = !!sandboxPackageSwitchBusy;
  }
  if (createBtn) {
    createBtn.disabled = !!sandboxPackageSwitchBusy;
  }
  if (status.currentPackageDir && $("cfg-pkgdir")) {
    $("cfg-pkgdir").value = status.currentPackageDir;
  }
  return status;
}

async function refreshAfterPackageDirSwitch() {
  pkg = await window.digitalMe.loadPackage();
  renderPackageStatus();
  await refreshPackageVersionsPanel();
  try {
    await refreshMeView();
  } catch {
    /* ignore overview failures while settings open */
  }
  await refreshSandboxPackageUi();
}

async function createTempTestPackageFlow() {
  if (sandboxPackageSwitchBusy) return;
  if (!window.digitalMe.activateTempDemoPackage) {
    alert("当前版本不支持创建临时测试资料。");
    return;
  }
  if (!window.confirm(TEMP_PKG_CONFIRM_TEXT)) return;

  sandboxPackageSwitchBusy = true;
  await refreshSandboxPackageUi();
  try {
    const r = await window.digitalMe.activateTempDemoPackage({
      confirmed: true,
      migrateToV02: true,
    });
    if ($("cfg-pkgdir")) $("cfg-pkgdir").value = r.packageDir || "";
    await refreshAfterPackageDirSwitch();
    alert(
      "已创建临时测试资料，并已切换当前资料目录。\n路径：" + (r.packageDir || "")
    );
  } finally {
    sandboxPackageSwitchBusy = false;
    await refreshSandboxPackageUi();
  }
}

async function restoreRegularPackageFlow() {
  if (sandboxPackageSwitchBusy) return;
  if (!window.digitalMe.restoreRegularPackageDir) {
    alert("当前版本不支持恢复常规资料目录。");
    return;
  }
  if (!window.confirm(RESTORE_PKG_CONFIRM_TEXT)) return;

  sandboxPackageSwitchBusy = true;
  await refreshSandboxPackageUi();
  try {
    const r = await window.digitalMe.restoreRegularPackageDir({ confirmed: true });
    if ($("cfg-pkgdir")) $("cfg-pkgdir").value = r.packageDir || "";
    await refreshAfterPackageDirSwitch();
    alert("已恢复常规资料目录。\n路径：" + (r.packageDir || ""));
  } finally {
    sandboxPackageSwitchBusy = false;
    await refreshSandboxPackageUi();
  }
}

/** Settings: package version panel (disk-backed; survives app restart). */
let pkgVersionsState = { previousVersionId: null };

async function refreshPackageVersionsPanel() {
  const currentEl = $("pkg-version-current");
  const previousEl = $("pkg-version-previous");
  const hintEl = $("pkg-version-hint");
  const btn = $("btn-pkg-rollback-prev");
  if (!currentEl || !previousEl || !hintEl || !btn) return;

  pkgVersionsState.previousVersionId = null;
  btn.disabled = true;
  currentEl.textContent = "正在读取版本信息…";
  previousEl.textContent = "";
  hintEl.textContent = "";

  if (!window.digitalMe.listPackageVersions) {
    currentEl.textContent = "当前版本不支持资料版本管理。";
    return;
  }

  try {
    const info = await window.digitalMe.listPackageVersions();
    const currentRevision =
      info && typeof info.currentRevision === "number" ? info.currentRevision : null;
    const notRecoverable =
      info &&
      (info.recoveryIssue ||
        info.statusCode === "recover_ambiguous" ||
        info.statusCode === "package_locked" ||
        info.statusCode === "recover_unavailable" ||
        info.statusCode === "unhealthy" ||
        info.statusCode === "schema_unsupported" ||
        info.statusCode === "schema_v01" ||
        info.statusCode === "package_missing");
    if (currentRevision != null) {
      currentEl.textContent = notRecoverable
        ? `当前版本：第 ${currentRevision} 版（暂不可恢复）`
        : `当前版本：第 ${currentRevision} 版`;
    } else {
      currentEl.textContent = "当前版本：未知";
    }

    const canRollback = info && info.statusCode === "ok" && info.recoverable !== false;
    if (canRollback && info.previousVersionId && typeof info.previousRevision === "number") {
      pkgVersionsState.previousVersionId = info.previousVersionId;
      previousEl.textContent = `最近可恢复：第 ${info.previousRevision} 版（${info.previousVersionId}）`;
      btn.disabled = false;
    } else {
      previousEl.textContent = "尚无可恢复版本";
      btn.disabled = true;
    }

    pkgVersionsRefreshedAt = new Date();
    const refreshNote = `已于 ${formatPkgVersionsRefreshTime(pkgVersionsRefreshedAt)} 刷新`;
    const statusMsg = (info && info.statusMessage) || "";
    hintEl.textContent = [statusMsg, refreshNote].filter(Boolean).join(" · ");
  } catch (e) {
    currentEl.textContent = "无法读取资料版本。";
    previousEl.textContent = "";
    hintEl.textContent = e.message || String(e);
    btn.disabled = true;
  }
}

async function rollbackToPreviousPackageVersion() {
  const versionId = pkgVersionsState.previousVersionId;
  if (!versionId) {
    alert("当前没有可恢复的历史版本。");
    await refreshPackageVersionsPanel();
    return;
  }
  if (!/^v\d+$/.test(String(versionId))) {
    alert("版本编号无效，请刷新后重试。");
    await refreshPackageVersionsPanel();
    return;
  }
  const ok = confirm(
    "确认恢复到上一个版本？\n\n恢复会产生一个新的版本号，不会删除历史版本。"
  );
  if (!ok) return;

  const btn = $("btn-pkg-rollback-prev");
  if (btn) btn.disabled = true;
  try {
    const r = await window.digitalMe.rollbackPackageVersion({
      versionId,
      confirmed: true,
    });
    pkg = await window.digitalMe.loadPackage();
    await refreshPackageVersionsPanel();
    const msg =
      r && typeof r.revision === "number"
        ? `已恢复到上一版内容，当前为第 ${r.revision} 版。`
        : "已完成版本恢复。";
    alert(msg);
    addMessage("system-note", msg);
  } catch (e) {
    const code = e && e.code;
    let msg = e.message || String(e);
    if (code === "version_not_found") {
      msg = "该版本已不存在或不可恢复，请刷新版本信息后重试。";
    } else if (code === "version_id_invalid") {
      msg = "只能使用系统提供的版本编号进行恢复。";
    } else if (code === "confirmation_required") {
      msg = "需要确认后才能恢复。";
    }
    alert("恢复失败：" + msg);
    await refreshPackageVersionsPanel();
  }
}

async function saveCliExecutorSettings() {
  const executable = ($("cfg-cli-executable")?.value || "").trim();
  const authorizedCwdRoot = ($("cfg-cli-cwd-root")?.value || "").trim();
  const enabled = !!$("cfg-cli-enabled")?.checked;
  if (!window.digitalMe.l0SaveCliAgent) return;
  try {
    await window.digitalMe.l0SaveCliAgent({ executable, authorizedCwdRoot, enabled });
    await refreshCodeExecutorSelect();
    alert(
      enabled && executable && authorizedCwdRoot
        ? "本地命令工具已保存。"
        : "已保存（未启用或配置不完整时仍只用本机对话）。"
    );
  } catch (e) {
    alert("保存失败：" + (e.message || String(e)));
  }
}

async function saveSettings() {
  const cfg = {
    provider: "openai-compatible",
    baseURL: $("cfg-baseurl").value.trim(),
    apiKey: $("cfg-apikey").value.trim(),
    model: $("cfg-model").value.trim(),
    packageDir: $("cfg-pkgdir").value.trim(),
  };
  try {
    await window.digitalMe.setConfig(cfg);
  } catch (e) {
    alert("保存失败：" + (e.message || String(e)));
    return;
  }
  $("cfg-apikey").value = "";
  $("settings-modal").classList.add("hidden");
  pkg = await window.digitalMe.loadPackage();
  renderPackageStatus();
  await renderModelStatus();
}

async function clearApiKeySettings() {
  if (!window.digitalMe.clearApiKey) return;
  const ok = confirm("确定清除已保存的连接密钥？清除后需要重新填写才能调用智能引擎。");
  if (!ok) return;
  try {
    await window.digitalMe.clearApiKey();
    $("cfg-apikey").value = "";
    const statusEl = $("cfg-apikey-status");
    if (statusEl) statusEl.textContent = "尚未配置密钥";
    await renderModelStatus();
    alert("已清除连接密钥。");
  } catch (e) {
    alert("清除失败：" + (e.message || String(e)));
  }
}

// ---------- Feedback ----------
let lastFeedbackCommit = null;

function openFeedback(ctx) {
  feedbackCtx = ctx;
  feedbackPlan = null;
  lastFeedbackCommit = null;
  $("feedback-excerpt").textContent = (ctx.assistantExcerpt || "").slice(0, 500);
  $("feedback-input").value = "";
  $("feedback-step-form").classList.remove("hidden");
  $("feedback-step-confirm").classList.add("hidden");
  const done = $("feedback-step-done");
  if (done) done.classList.add("hidden");
  const undo = $("btn-feedback-undo");
  if (undo) undo.classList.add("hidden");
  $("feedback-modal").classList.remove("hidden");
}

function closeFeedback() {
  $("feedback-modal").classList.add("hidden");
  feedbackCtx = null;
  feedbackPlan = null;
}

function bindFeedback() {
  $("btn-feedback-cancel").addEventListener("click", closeFeedback);
  $("btn-feedback-back").addEventListener("click", () => {
    $("feedback-step-confirm").classList.add("hidden");
    $("feedback-step-form").classList.remove("hidden");
  });
  const doneClose = $("btn-feedback-done-close");
  if (doneClose) {
    doneClose.addEventListener("click", closeFeedback);
  }
  const undoBtn = $("btn-feedback-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", async () => {
      if (!lastFeedbackCommit || !lastFeedbackCommit.rollbackVersion) return;
      if (!confirm("确认撤销本次写入？\n\n恢复会产生一个新的版本号，不会删除历史版本。")) return;
      undoBtn.disabled = true;
      try {
        const r = await window.digitalMe.rollbackPackageVersion({
          versionId: lastFeedbackCommit.rollbackVersion,
          confirmed: true,
        });
        const msg = `已撤销，当前为第 ${r.revision} 版。`;
        addMessage("system-note", msg);
        if ($("feedback-done-msg")) $("feedback-done-msg").textContent = msg;
        undoBtn.classList.add("hidden");
        lastFeedbackCommit = null;
        pkg = await window.digitalMe.loadPackage();
        if (typeof refreshPackageVersionsPanel === "function") {
          await refreshPackageVersionsPanel();
        }
      } catch (e) {
        alert("撤销失败：" + (e.message || String(e)));
      } finally {
        undoBtn.disabled = false;
      }
    });
  }
  $("btn-feedback-preview").addEventListener("click", async () => {
    const correction = $("feedback-input").value.trim();
    if (!correction) return;
    try {
      const plan = await window.digitalMe.previewFeedback({
        correction,
        userQuestion: feedbackCtx?.userQuestion || "",
        assistantExcerpt: feedbackCtx?.assistantExcerpt || "",
      });
      feedbackPlan = plan;
      $("feedback-category").textContent = plan.categoryLabel || plan.category || "";
      $("feedback-target").textContent = plan.targetFile;
      $("feedback-proposed").textContent = plan.proposedContent;
      const revHint = $("feedback-revision-hint");
      if (revHint) {
        const base =
          plan.baseRevision != null ? `当前版本 ${plan.baseRevision}。` : "";
        revHint.textContent =
          base + "确认后形成新版本，可撤销。写入后下次对话将参考该修正。";
      }
      $("feedback-step-form").classList.add("hidden");
      $("feedback-step-confirm").classList.remove("hidden");
      const done = $("feedback-step-done");
      if (done) done.classList.add("hidden");
    } catch (e) {
      alert("预览失败：" + e.message);
    }
  });
  $("btn-feedback-apply").addEventListener("click", async () => {
    if (!feedbackPlan || !feedbackPlan.changeSetId) return;
    const plan = feedbackPlan;
    $("btn-feedback-apply").disabled = true;
    try {
      const r = await window.digitalMe.applyFeedback({
        changeSetId: plan.changeSetId,
        confirmed: true,
        category: plan.category,
      });
      lastFeedbackCommit = r;
      const paths = (r.affectedPaths && r.affectedPaths.length
        ? r.affectedPaths
        : [r.targetFile || plan.targetFile]
      )
        .filter(Boolean)
        .join("、");
      const msg = `已形成第 ${r.revision} 版，已修改：${paths}。如需撤销，可恢复到 ${r.rollbackVersion}。`;
      addMessage("system-note", msg);
      if ($("feedback-done-msg")) $("feedback-done-msg").textContent = msg;
      $("feedback-step-confirm").classList.add("hidden");
      const done = $("feedback-step-done");
      if (done) done.classList.remove("hidden");
      if ($("btn-feedback-undo") && r.rollbackVersion) {
        $("btn-feedback-undo").classList.remove("hidden");
      }
      pkg = await window.digitalMe.loadPackage();
      if (typeof refreshPackageVersionsPanel === "function") {
        await refreshPackageVersionsPanel();
      }
    } catch (e) {
      alert("写入失败：" + e.message);
    } finally {
      $("btn-feedback-apply").disabled = false;
    }
  });
}

// ---------- Task outputs / library ----------
let pptPlan = null;
let libraryItems = [];
let libraryTemplates = [];
let activeLibraryId = null;

async function loadScenarioPacks() {
  const box = $("scenario-packs");
  if (!box) return;
  try {
    const packs = await window.digitalMe.getScenarioPacks();
    box.innerHTML = "";
    const label = document.createElement("div");
    label.className = "scenario-label";
    label.textContent = "开箱场景";
    box.appendChild(label);
    for (const p of packs || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-chip" + (activeScenario && activeScenario.id === p.id ? " active" : "");
      btn.textContent = p.title;
      btn.title = p.blurb || "";
      btn.addEventListener("click", async () => {
        $("input").value = p.prompt || "";
        $("input").focus();
        const hintEl = $("workbench-cap-hint");
        if (hintEl) {
          hintEl.textContent = "正在为「" + p.title + "」准备推荐能力…";
          hintEl.classList.remove("hidden");
        }
        try {
          const prep = await window.digitalMe.prepareScenario(p.id);
          activeScenario = {
            id: p.id,
            title: p.title,
            systemHint: prep.systemHint || p.systemHint || "",
          };
          if (hintEl) hintEl.textContent = prep.message || "场景已准备。";
          await renderCapabilitiesStatus();
          await refreshCapabilitySurface();
          box.querySelectorAll(".scenario-chip").forEach((c) => c.classList.remove("active"));
          btn.classList.add("active");
        } catch (e) {
          activeScenario = {
            id: p.id,
            title: p.title,
            systemHint: p.systemHint || "",
          };
          if (hintEl) {
            hintEl.textContent =
              "场景提示已启用；能力准备未完成：" + (e.message || e) + "。仍可直接对话。";
          }
          await refreshCapabilitySurface();
        }
      });
      box.appendChild(btn);
    }
  } catch {
    box.innerHTML = "";
  }
}

async function refreshLibraryView() {
  try {
    libraryTemplates = await window.digitalMe.getLibraryTemplates();
    libraryItems = await window.digitalMe.listLibrary();
  } catch (e) {
    libraryTemplates = [];
    libraryItems = [];
  }
  renderLibraryTemplates();
  renderLibraryList();
  if (activeLibraryId) {
    const still = libraryItems.find((x) => x.id === activeLibraryId);
    if (still) await openLibraryItem(activeLibraryId);
    else {
      activeLibraryId = null;
      const detail = $("library-detail");
      if (detail) detail.classList.add("hidden");
      const empty = $("library-detail-empty");
      if (empty) empty.classList.remove("hidden");
    }
  }
}

function typeLabel(t) {
  return (
    {
      general: "通用",
      report: "研究报告",
      request_doc: "请示",
      proposal: "方案",
      memo: "备忘录",
      table: "表格",
      ppt: "演讲 PPT",
    }[t] || t || "文稿"
  );
}

async function generatePptFromDocument(title, content) {
  const text = String(content || "").trim();
  if (!text) {
    alert("没有可用于生成 PPT 的正文。");
    return;
  }
  if (!pkg) pkg = await window.digitalMe.loadPackage();
  const topic = (title || "演讲").replace(/^#\s*/, "").slice(0, 60);
  await openDoScene("write");
  $("ppt-panel").classList.remove("hidden");
  $("ppt-topic").value = topic;
  $("ppt-context").value = text.slice(0, 12000);
  $("ppt-progress").textContent = "正在根据文稿生成幻灯片结构…";
  $("btn-ppt-plan").disabled = true;
  $("btn-ppt-export").disabled = true;
  $("ppt-preview").classList.add("hidden");
  try {
    pptPlan = await window.digitalMe.planPpt({
      pkg,
      brief: {
        topic,
        occasion: "根据既有文稿汇报",
        duration: "",
        audience: "",
        keyPoints: "",
        context: text.slice(0, 12000),
      },
    });
    renderPptPreview(pptPlan);
    $("ppt-progress").textContent = `已根据文稿生成「${pptPlan.title}」，共 ${pptPlan.slides.length} 页。可预览后导出 PPTX。`;
    $("btn-ppt-export").disabled = false;
  } catch (e) {
    $("ppt-progress").textContent = "生成失败：" + e.message;
    pptPlan = null;
  } finally {
    $("btn-ppt-plan").disabled = false;
  }
}

function renderLibraryTemplates() {
  const box = $("library-templates");
  if (!box) return;
  box.innerHTML = "";
  const templates = libraryTemplates || [];
  for (const t of templates) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "template-card";
    card.innerHTML = `<strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.blurb || "")}</span>`;
    card.addEventListener("click", (ev) => {
      ev.preventDefault();
      createFromTemplate(t);
    });
    box.appendChild(card);
  }
}

function applyLibraryItemToEditor(item) {
  if (!item || !item.id) return;
  activeLibraryId = item.id;
  linkedLibraryId = item.id;
  const detail = $("library-detail");
  const empty = $("library-detail-empty");
  if (detail) detail.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");
  const titleInput = $("library-detail-title-input");
  if (titleInput) titleInput.value = item.title || "";
  const meta = $("library-detail-meta");
  if (meta) {
    meta.textContent =
      typeLabel(item.type) +
      " · " +
      (item.status || "draft") +
      " · 更新 " +
      (item.updatedAt || "").slice(0, 19).replace("T", " ");
  }
  const editor = $("library-detail-content");
  if (editor) {
    editor.value = item.content || "";
    editor.removeAttribute("readonly");
    editor.focus();
  }
  const prog = $("library-detail-progress");
  if (prog && !(prog.textContent || "").trim()) prog.textContent = "";
  const hasTable =
    item.type === "table" || /\|\s*[-:]+\s*\|/.test(item.content || "") || (item.formats || []).includes("csv");
  const csvBtn = $("btn-library-export-csv");
  if (csvBtn) csvBtn.classList.toggle("hidden", !hasTable);
  const pptBtn = $("btn-library-to-ppt");
  if (pptBtn) pptBtn.classList.toggle("hidden", item.type === "ppt");
  renderLibraryList();
  writeHistory = writeHistoryByDoc[item.id] ? writeHistoryByDoc[item.id].slice() : [];
  renderWriteMessages();
  const hint = $("write-doc-hint");
  if (hint) {
    hint.textContent = `当前文稿：${item.title || "未命名"}。可直接改右侧正文，或在下方说明要求生成全文。`;
    hint.classList.remove("hidden");
  }
  if (detail) detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function createBlankLibraryItem(opts = {}) {
  const rawTitle = String(opts.title || "").trim();
  const title = (rawTitle || "未命名文稿").slice(0, 48);
  const hint = $("write-doc-hint");
  if (hint) {
    hint.textContent = "正在新建文稿…";
    hint.classList.remove("hidden");
  }
  try {
    const item = await window.digitalMe.createBlankLibrary({
      title,
      content: opts.content != null ? opts.content : "",
      sourceSessionId: currentSession && currentSession.id,
    });
    if (!item || !item.id) throw new Error("未返回文稿，请重试。");
    activeLibraryId = item.id;
    await refreshLibraryView();
    applyLibraryItemToEditor(item);
    const prog = $("library-detail-progress");
    if (prog) prog.textContent = "已新建空白文稿。可直接编辑，或在中间说明要求生成全文。";
    if (hint) {
      hint.textContent = `当前文稿：${item.title || "未命名"}。可直接改右侧正文，或在下方说明要求。`;
    }
    return item;
  } catch (e) {
    const msg = "新建失败：" + (e && e.message ? e.message : e);
    if (hint) hint.textContent = msg;
    throw e;
  }
}

async function createFromTemplate(t) {
  if (t.openPptForm || t.id === "ppt") {
    const panel = $("ppt-panel");
    if (panel) {
      panel.classList.remove("hidden");
      $("ppt-topic")?.focus();
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }
  const topic = (t.title || "新文稿").trim();
  const hint = $("write-doc-hint");
  if (hint) {
    hint.textContent = `正在新建「${topic}」提纲…`;
    hint.classList.remove("hidden");
  }
  try {
    const item = await window.digitalMe.createFromTemplate({
      templateId: t.id,
      title: topic,
      sourceSessionId: currentSession && currentSession.id,
    });
    if (item && item.openPptForm) {
      $("ppt-panel")?.classList.remove("hidden");
      $("ppt-topic")?.focus();
      return;
    }
    if (!item || !item.id) throw new Error("未返回文稿，请重试。");
    if (!String(item.content || "").trim()) {
      throw new Error("模板未生成提纲内容，请检查模板配置。");
    }
    activeLibraryId = item.id;
    await refreshLibraryView();
    // Prefer the create payload (guarantees skeleton content even if list fetch lags)
    applyLibraryItemToEditor(item);
    const input = $("write-input");
    if (input) {
      input.value = `请按右侧「${item.title}」的提纲骨架写成完整可用正文。保留现有结构，把各节占位补成实质内容，不要只回复提纲。`;
      if (typeof autosizeWriteInput === "function") autosizeWriteInput();
    }
    const prog = $("library-detail-progress");
    if (prog) prog.textContent = "已新建提纲骨架。可改标题与正文，或点中间「发送」生成全文。";
    $("library-detail-title-input")?.focus();
  } catch (e) {
    const msg = "新建失败：" + (e && e.message ? e.message : e);
    if (hint) hint.textContent = msg;
    const prog = $("library-detail-progress");
    if (prog) {
      $("library-detail")?.classList.remove("hidden");
      $("library-detail-empty")?.classList.add("hidden");
      prog.textContent = msg;
    }
  }
}

function renderLibraryList() {
  const list = $("library-list");
  const empty = $("library-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  if (!libraryItems.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const it of libraryItems) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "library-row" + (it.id === activeLibraryId ? " active" : "");
    row.innerHTML =
      `<div class="library-row-title">${escapeHtml(it.title)}</div>` +
      `<div class="library-row-meta">${escapeHtml(typeLabel(it.type))} · ${escapeHtml(it.status || "draft")} · ${escapeHtml(
        (it.updatedAt || "").slice(0, 16).replace("T", " ")
      )}</div>`;
    row.addEventListener("click", () => openLibraryItem(it.id));
    list.appendChild(row);
  }
}

async function openLibraryItem(id) {
  const item = await window.digitalMe.getLibraryItem(id);
  if (!item) {
    const hint = $("write-doc-hint");
    if (hint) hint.textContent = "打不开这篇文稿，请刷新后重试。";
    return;
  }
  applyLibraryItemToEditor(item);
}

function showDoHub() {
  doScene = null;
  $("do-hub").classList.remove("hidden");
  $("do-write").classList.add("hidden");
  const dr = $("do-research");
  if (dr) dr.classList.add("hidden");
  const dc = $("do-code");
  if (dc) dc.classList.add("hidden");
  $("do-placeholder").classList.add("hidden");
  renderDoSceneGrid();
}

function renderDoSceneGrid() {
  const grid = $("do-scene-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const s of DO_SCENES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "do-scene-card" + (s.status === "prep" ? " do-scene-prep" : "");
    card.innerHTML =
      `<strong>${escapeHtml(s.title)}</strong>` +
      `<span class="do-scene-blurb">${escapeHtml(s.blurb)}</span>` +
      (s.status === "prep" ? `<span class="do-scene-badge">筹备中</span>` : `<span class="do-scene-badge ready">可用</span>`);
    card.addEventListener("click", () => openDoScene(s.id));
    grid.appendChild(card);
  }
}

async function openDoScene(sceneId, opts = {}) {
  const scene = DO_SCENES.find((s) => s.id === sceneId) || { id: sceneId, status: "prep", title: sceneId };

  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === "do");
  });
  $("view-chat").classList.add("hidden");
  $("view-do").classList.remove("hidden");
  $("view-me").classList.add("hidden");
  $("view-extensions").classList.add("hidden");

  if (scene.status === "prep") {
    doScene = sceneId;
    $("do-hub").classList.add("hidden");
    $("do-write").classList.add("hidden");
    const dr0 = $("do-research");
    if (dr0) dr0.classList.add("hidden");
    const dc0 = $("do-code");
    if (dc0) dc0.classList.add("hidden");
    $("do-placeholder").classList.remove("hidden");
    $("do-ph-title").textContent = scene.title || "筹备中";
    $("do-ph-sub").textContent = "该场景尚未开放";
    $("do-ph-body").textContent = scene.detail || "能力就绪后再点亮，避免空壳体验。";
    return;
  }

  $("do-hub").classList.add("hidden");
  $("do-placeholder").classList.add("hidden");

  if (sceneId === "research") {
    doScene = "research";
    $("do-write").classList.add("hidden");
    const dcR = $("do-code");
    if (dcR) dcR.classList.add("hidden");
    $("do-research").classList.remove("hidden");
    window.digitalMe.prepareResearchScene?.().catch(() => {});
    await refreshSkillBar("research");
    await refreshResearchView({ projectId: opts.projectId });
    return;
  }

  if (sceneId === "code") {
    doScene = "code";
    $("do-write").classList.add("hidden");
    const drC = $("do-research");
    if (drC) drC.classList.add("hidden");
    $("do-code").classList.remove("hidden");
    await openCodeScene();
    return;
  }

  doScene = "write";
  const dr = $("do-research");
  if (dr) dr.classList.add("hidden");
  const dcW = $("do-code");
  if (dcW) dcW.classList.add("hidden");
  $("do-write").classList.remove("hidden");
  $("do-write-title").textContent = "写作";
  $("do-write-sub").textContent = "新建文稿或直接描述要写什么；改稿与导出在同一页。";
  applyWriteIntents();
  await refreshSkillBar("write");
  const sk = activeSkillByScene.write;
  activeScenario = {
    id: "write",
    title: "写作",
    systemHint: (sk && sk.systemHint) || WRITE_SCENE_HINT,
  };
  await refreshLibraryView();
  if (opts.libraryId) await openLibraryItem(opts.libraryId);
}

function applyWriteIntents() {
  const box = $("write-intent-chips");
  if (!box) return;
  const intents = [
    ["请把右侧正文改得更简洁，保留关键结论。", "改简洁"],
    ["请加强论证与结构，输出完整可用正文。", "加强结构"],
    ["请按我的表达风格润色右侧全文，输出完整成稿。", "按我的风格润色"],
    ["请基于右侧正文写一版更短的摘要。", "写摘要"],
  ];
  box.innerHTML = "";
  for (const [intent, label] of intents) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.writeIntent = intent;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      $("write-input").value = intent;
      if (typeof autosizeWriteInput === "function") autosizeWriteInput();
      $("write-input").focus();
    });
    box.appendChild(btn);
  }
}

function renderWriteMessages() {
  const box = $("write-messages");
  if (!box) return;
  box.innerHTML = "";
  if (!writeHistory.length) {
    const note = document.createElement("div");
    note.className = "msg system-note";
    note.textContent = activeLibraryId
      ? "可以说明如何修改右侧正文；满意的回复点「采用为成果」写入右侧，或依赖自动写回。"
      : "直接说明要写什么并发送；没有文稿时会自动新建。也可点左侧「新建文稿」。";
    box.appendChild(note);
    return;
  }
  for (const m of writeHistory) {
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system-note");
    el.textContent = m.content || "";
    box.appendChild(el);
    if (m.role === "assistant" && m.content) attachWriteAssistantActions(el, m.content);
  }
  box.scrollTop = box.scrollHeight;
}

function extractMarkdownBody(text) {
  const raw = String(text || "");
  const m = raw.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (m && m[1].trim()) return m[1].trim();
  return stripToolLeakageClient(raw).trim();
}

function adoptWriteReplyAsBody(text) {
  const body = extractMarkdownBody(text);
  if (!body) return false;
  if (!activeLibraryId) {
    addWriteMessage("system-note", "请先新建或选择一篇文稿。");
    return false;
  }
  const editor = $("library-detail-content");
  if (editor) editor.value = body;
  const titleMatch = body.match(/^#\s+(.+)$/m);
  if (titleMatch && $("library-detail-title-input") && !($("library-detail-title-input").value || "").trim()) {
    $("library-detail-title-input").value = titleMatch[1].trim().slice(0, 80);
  }
  if ($("library-detail-progress")) {
    $("library-detail-progress").textContent = "已采用到正文，请核对后点「保存」。";
  }
  recordL0Audit({
    scene: "write",
    action: "adopt_result",
    auth: "write",
    executor: "user",
    summary: body.slice(0, 80),
    outcome: "adopted",
  });
  return true;
}

function attachWriteAssistantActions(wrap, text) {
  if (!wrap || !text) return;
  let actions = wrap.querySelector(".msg-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "msg-actions";
    wrap.appendChild(actions);
  }
  if (!actions.querySelector(".btn-copy")) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy";
    copyBtn.type = "button";
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(text);
      copyBtn.textContent = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        copyBtn.textContent = "复制";
      }, 1600);
    });
    actions.appendChild(copyBtn);
  }
  if (!actions.querySelector(".btn-adopt-write")) {
    const adoptBtn = document.createElement("button");
    adoptBtn.className = "btn-adopt-write btn-ghost";
    adoptBtn.type = "button";
    adoptBtn.textContent = "采用为成果";
    adoptBtn.title = "把本条回复写入右侧正文";
    adoptBtn.addEventListener("click", () => {
      if (adoptWriteReplyAsBody(text)) {
        adoptBtn.textContent = "已采用";
        setTimeout(() => {
          adoptBtn.textContent = "采用为成果";
        }, 1600);
      }
    });
    actions.appendChild(adoptBtn);
  }
}

function addWriteMessage(role, text) {
  writeHistory.push({ role, content: text });
  if (activeLibraryId) writeHistoryByDoc[activeLibraryId] = writeHistory.slice();
  renderWriteMessages();
}

function renderWriteAttachChips() {
  const box = $("write-attach-chips");
  if (!box) return;
  box.innerHTML = "";
  for (const a of writePendingAttachments) {
    const chip = document.createElement("span");
    chip.className = "attach-chip" + (a.ok === false ? " attach-chip-err" : "");
    const label = a.note ? `${a.name} · ${a.note}` : a.name;
    chip.innerHTML = `${escapeHtml(label)} <button type="button" aria-label="移除">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      writePendingAttachments = writePendingAttachments.filter((x) => x.id !== a.id);
      renderWriteAttachChips();
    });
    box.appendChild(chip);
  }
}

function buildWriteAttachmentContext() {
  if (!writePendingAttachments.length) return "";
  return writePendingAttachments
    .map((a) => {
      const head = `### 附件：${a.name}${a.note ? "（" + a.note + "）" : ""}`;
      if (a.ok === false || !a.text) return head + "\n（本附件未能读入正文）";
      return head + "\n" + a.text;
    })
    .join("\n\n");
}

async function withL0ControlHint(scene, baseHint) {
  let brief = "";
  try {
    const r = await window.digitalMe.l0BuildControlBrief?.({ scene });
    brief = (r && r.brief) || "";
  } catch {
    brief = "";
  }
  const base = baseHint || "";
  if (!brief) return base;
  return brief + (base ? "\n\n" + base : "");
}

async function sendWrite() {
  const input = $("write-input");
  const text = (input && input.value.trim()) || "";
  if (!text && !writePendingAttachments.length) return;

  if (!activeLibraryId) {
    const titleGuess = (text || "未命名文稿").replace(/\s+/g, " ").slice(0, 40);
    try {
      await createBlankLibraryItem({ title: titleGuess || "未命名文稿" });
    } catch (e) {
      addWriteMessage("system-note", "未能新建文稿：" + (e.message || e));
      return;
    }
  }

  const title = ($("library-detail-title-input") && $("library-detail-title-input").value.trim()) || "文稿";
  const docBody = ($("library-detail-content") && $("library-detail-content").value) || "";
  const attachmentContext = buildWriteAttachmentContext();

  let userContent = text || "请结合我附上的材料完善文稿。";
  userContent +=
    `\n\n---\n当前文稿标题：${title}\n当前文稿正文：\n` + (docBody || "（空）").slice(0, 60000);
  if (attachmentContext) {
    userContent += "\n\n---\n附上的材料：\n\n" + attachmentContext.slice(0, 40000);
  }

  if (input) input.value = "";
  addWriteMessage("user", text || "（结合附件改稿）");
  writePendingAttachments = [];
  renderWriteAttachChips();

  writeRequestId = "wreq_" + Date.now().toString(36);
  $("btn-write-send").disabled = true;
  $("btn-write-stop").classList.remove("hidden");
  const trail = $("write-tool-trail");
  if (trail) {
    trail.classList.remove("hidden");
    trail.innerHTML = "<strong>正在改稿…</strong>";
  }

  const pending = document.createElement("div");
  pending.className = "msg assistant streaming";
  pending.textContent = "";
  $("write-messages").appendChild(pending);

  try {
    const baseHint = (activeScenario && activeScenario.systemHint) || WRITE_SCENE_HINT;
    const scenarioHint = await withL0ControlHint("write", baseHint);
    const apiHistory = writeHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1)
      .concat([{ role: "user", content: userContent }]);
    const res = await window.digitalMe.sendChat({
      pkg,
      history: apiHistory,
      requestId: writeRequestId,
      attachmentContext,
      scenarioHint,
    });
    const replyRaw = typeof res === "string" ? res : res.reply || "";
    const fullRaw = (typeof res === "object" && (res.fullReply || replyRaw)) || replyRaw;
    let reply = stripToolLeakageClient(replyRaw);
    let full = stripToolLeakageClient(fullRaw);
    if (!reply && /DSML|tool_calls|invoke\s+name\s*=/i.test(String(fullRaw || replyRaw))) {
      reply = "刚才尝试调用外部能力，但没有整理成可读说明。请再试一次，或稍后再改稿。";
      full = reply;
    }
    const caps =
      (res && res.meta && res.meta.capabilitiesUsed) ||
      (res && res.capabilitiesUsed) ||
      [];
    if (trail) {
      trail.classList.remove("hidden");
      trail.textContent = caps.length
        ? "本次调用：" + caps.join("、") + "。成果请在右侧核对后保存，或点「采用为成果」。"
        : "本次未调用外部手脚。请在右侧核对正文，或点「采用为成果」。";
    }
    pending.classList.remove("streaming");
    pending.textContent = reply || "（已停止）";
    if (reply) {
      writeHistory.push({ role: "assistant", content: full || reply });
      if (activeLibraryId) writeHistoryByDoc[activeLibraryId] = writeHistory.slice();
      attachWriteAssistantActions(pending, full || reply);
    }
    if (res.artifact && res.artifact.content) {
      const body = stripToolLeakageClient(res.artifact.content) || res.artifact.content;
      $("library-detail-content").value = body;
      if (res.artifact.title && $("library-detail-title-input")) {
        $("library-detail-title-input").value = res.artifact.title;
      }
      $("library-detail-progress").textContent = "已写入正文，请核对后点「保存」。也可在回复下点「采用为成果」重新写入。";
    } else if (reply && activeLibraryId && !($("library-detail-content")?.value || "").trim()) {
      // No markdown artifact block — still offer body via 采用为成果; optionally soft-fill empty editor
      adoptWriteReplyAsBody(full || reply);
    }
    await recordL0Audit({
      scene: "write",
      action: "scene_delegate",
      auth: "read",
      executor: "builtin",
      summary: (text || title || "").slice(0, 120),
      capabilities: caps,
      outcome: "ok",
    });
  } catch (e) {
    pending.classList.remove("streaming");
    pending.className = "msg system-note";
    pending.textContent = "没办成：" + (e.message || "请稍后再试");
    if (trail) {
      trail.classList.remove("hidden");
      trail.textContent = "本次未完成。";
    }
    await recordL0Audit({
      scene: "write",
      action: "scene_delegate",
      auth: "read",
      executor: "builtin",
      summary: (text || "").slice(0, 120),
      outcome: String(e.message || e).slice(0, 80),
    });
  } finally {
    $("btn-write-send").disabled = false;
    $("btn-write-stop").classList.add("hidden");
    writeRequestId = null;
    $("write-messages").scrollTop = $("write-messages").scrollHeight;
  }
}

async function refreshSkillBar(scene) {
  const barId =
    scene === "research" ? "research-skill-bar" : scene === "code" ? "code-skill-bar" : "write-skill-bar";
  const bar = $(barId);
  if (!bar) return;
  let skills = [];
  let active = null;
  try {
    skills = await window.digitalMe.listSkills(scene);
    active = await window.digitalMe.getActiveSkill(scene);
  } catch {
    skills = [];
  }
  activeSkillByScene[scene] = active;
  bar.classList.remove("hidden");
  bar.innerHTML = "";
  const label = document.createElement("span");
  label.className = "skill-bar-label muted";
  label.textContent = "Skill";
  bar.appendChild(label);
  const sel = document.createElement("select");
  sel.className = "skill-select";
  sel.title = "从列表选用即引入到本场景；之后回答会按该 Skill 的方式进行";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "未引入（默认）";
  sel.appendChild(opt0);
  for (const s of skills) {
    const opt = document.createElement("option");
    opt.value = s.id;
    const isTopicLegacy = /^研究\s*[·・]/.test(s.title || "");
    opt.textContent = isTopicLegacy ? s.title + "（旧）" : s.title;
    if (active && active.id === s.id) opt.selected = true;
    sel.appendChild(opt);
  }
  const hint = document.createElement("span");
  hint.className = "skill-bar-hint muted";
  const refreshHint = (sk, prepMsg) => {
    if (prepMsg) {
      hint.textContent = prepMsg;
      return;
    }
    hint.textContent = sk
      ? "已引入 · " + (sk.blurb || "后续回答按此方式进行")
      : "下拉选用即可引入；管理请到「能力」";
  };
  refreshHint(active);
  sel.addEventListener("change", async () => {
    try {
      const setRes = await window.digitalMe.setActiveSkill({ scene, skillId: sel.value || null });
      active = sel.value ? await window.digitalMe.getSkill(sel.value) : null;
      activeSkillByScene[scene] = active;
      refreshHint(active, setRes && setRes.message);
      if (scene === "write") {
        activeScenario = {
          id: "write",
          title: "写作",
          systemHint: (active && active.systemHint) || WRITE_SCENE_HINT,
        };
      } else if (scene === "research" && activeResearch) {
        syncResearchScenarioHint();
      } else if (scene === "code") {
        await refreshCodeScenarioHint();
      }
    } catch (e) {
      hint.textContent = "引入失败";
    }
  });
  bar.appendChild(sel);
  bar.appendChild(hint);
}

async function saveCurrentAsSkill(scene) {
  try {
    let payload = { scene };
    if (scene === "research") {
      const name = window.prompt(
        "为 Skill 起名（描述怎么办事，例如「快速简报」，不要用课题标题）",
        "我的调研方式"
      );
      if (name === null) return;
      const title = String(name || "").trim() || "我的调研方式";
      payload = {
        scene: "research",
        title,
        blurb: "研究场景可复用。引入后会影响答复方式，不会更换课题。",
        systemHint:
          RESEARCH_SCENE_HINT +
          " 【Skill】按用户已有材料与习惯推进；结论须标明依据；缺证据标待核实。",
        prompt: "请按本 Skill 推进：先澄清再综合；结论挂材料；输出可用成果稿。",
        sceneTags: ["research"],
        recommendedExtensions: ["fetch", "brave-search"],
        steps: ["澄清问题", "检索材料", "阅读来源", "撰写成果"],
      };
    } else if (scene === "code") {
      const name = window.prompt("为编程 Skill 起名（例如「代码审阅」「小步改码」）", "我的改码方式");
      if (name === null) return;
      const title = String(name || "").trim() || "我的改码方式";
      payload = {
        scene: "code",
        title,
        blurb: "编程场景可复用。引入后会影响委派方式。",
        systemHint: "【Skill · 编程】在授权范围内协助；默认谨慎改动；不擅自外发或 push。",
        prompt: "请按本 Skill 推进代码任务。",
        sceneTags: ["code"],
        recommendedExtensions: ["filesystem"],
        steps: ["确认授权", "阅读相关文件", "给出改动", "说明自测"],
      };
    } else {
      const name = window.prompt("为写作 Skill 起名（例如「公号口吻」「方案提纲」）", "我的写作方式");
      if (name === null) return;
      const title = String(name || "").trim() || "我的写作方式";
      payload = {
        scene: "write",
        title,
        blurb: "写作场景可复用。引入后会影响成稿与改写方式。",
        systemHint: WRITE_SCENE_HINT,
        prompt: "请按本 Skill 的语气与结构协助成稿与改写。",
        sceneTags: ["write"],
      };
    }
    const sk = await window.digitalMe.saveSkillFromContext(payload);
    await refreshSkillZone();
    await refreshSkillBar(scene);
    const prog = $("skill-zone-progress");
    if (prog) {
      prog.textContent = "已新建 Skill：「" + sk.title + "」。可在场景页下拉引入，或点「引入到场景」。";
    }
  } catch (e) {
    alert("保存失败：" + (e.message || e));
  }
}

function wireSkillZoneCreateButtons() {
  const r = $("btn-skill-new-research");
  const w = $("btn-skill-new-write");
  const c = $("btn-skill-new-code");
  if (r && !r.dataset.bound) {
    r.dataset.bound = "1";
    r.addEventListener("click", () => saveCurrentAsSkill("research"));
  }
  if (w && !w.dataset.bound) {
    w.dataset.bound = "1";
    w.addEventListener("click", () => saveCurrentAsSkill("write"));
  }
  if (c && !c.dataset.bound) {
    c.dataset.bound = "1";
    c.addEventListener("click", () => saveCurrentAsSkill("code"));
  }
}

let codeHistory = [];
let codeRequestId = null;
let codeOperationId = null;
let codeStopBusy = false;
let codeDelegationHint = "";
let codeArtifacts = { files: [], links: [], notes: "" };

function parseCodeArtifactsFromText(text) {
  const raw = String(text || "");
  const files = new Set();
  const links = new Set();
  const winPaths = raw.match(/[A-Za-z]:\\[^\s"'`<>|*?\n]+/g) || [];
  for (const p of winPaths) {
    const cleaned = p.replace(/[.,;:)\]]+$/, "");
    if (/\.\w{1,8}$/.test(cleaned) || /[\\/]$/.test(cleaned) === false) files.add(cleaned);
  }
  const unixPaths = raw.match(/\/(?:Users|home|var|tmp|opt)\/[^\s"'`<>|*?\n]+/g) || [];
  for (const p of unixPaths) files.add(p.replace(/[.,;:)\]]+$/, ""));
  const rel = raw.matchAll(
    /(?:^|[\s`'"「（(])((?:[\w.-]+[\\/])*[\w.-]+\.(?:html?|css|js|ts|tsx|jsx|md|json|py|txt|docx?|pdf))(?=[\s`'"」）。,，;]|$)/gi
  );
  for (const m of rel) {
    if (m[1] && !m[1].includes("://")) files.add(m[1]);
  }
  const urls = raw.match(/https?:\/\/[^\s)）\]>"']+/g) || [];
  for (const u of urls) links.add(u.replace(/[.,;:)\]]+$/, ""));
  return {
    files: [...files].slice(0, 20),
    links: [...links].slice(0, 20),
  };
}

function renderCodeArtifactLists() {
  const fileBox = $("code-file-list");
  const linkBox = $("code-link-list");
  if (fileBox) {
    fileBox.innerHTML = "";
    if (!codeArtifacts.files.length) {
      fileBox.innerHTML = `<div class="muted">尚无。采用成果后，这里列出可打开的文件。</div>`;
    } else {
      for (const p of codeArtifacts.files) {
        const row = document.createElement("div");
        row.className = "code-file-row";
        const name = p.split(/[/\\]/).pop() || p;
        row.innerHTML =
          `<div class="path" title="${escapeHtml(p)}">${escapeHtml(name)}</div>` +
          `<div class="muted" style="font-size:11px">${escapeHtml(p)}</div>` +
          `<div class="row-actions"></div>`;
        const actions = row.querySelector(".row-actions");
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn-ghost";
        openBtn.textContent = "打开";
        openBtn.addEventListener("click", () => {
          if (/^https?:\/\//i.test(p)) window.digitalMe.openExternal(p);
          else window.digitalMe.openPath?.(p);
        });
        actions.appendChild(openBtn);
        fileBox.appendChild(row);
      }
    }
  }
  if (linkBox) {
    linkBox.innerHTML = "";
    if (!codeArtifacts.links.length) {
      linkBox.innerHTML = `<div class="muted">尚无。若回复中含网址，会显示在此。</div>`;
    } else {
      for (const u of codeArtifacts.links) {
        const row = document.createElement("div");
        row.className = "code-link-row";
        row.innerHTML =
          `<div class="path">${escapeHtml(u)}</div>` + `<div class="row-actions"></div>`;
        const actions = row.querySelector(".row-actions");
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn-ghost";
        openBtn.textContent = "在浏览器打开";
        openBtn.addEventListener("click", () => window.digitalMe.openExternal(u));
        actions.appendChild(openBtn);
        linkBox.appendChild(row);
      }
    }
  }
}

function adoptCodeReplyAsResult(text) {
  const body = String(text || "").trim();
  if (!body) return false;
  const parsed = parseCodeArtifactsFromText(body);
  const prevFiles = new Set(codeArtifacts.files);
  const prevLinks = new Set(codeArtifacts.links);
  for (const f of parsed.files) prevFiles.add(f);
  for (const l of parsed.links) prevLinks.add(l);
  codeArtifacts.files = [...prevFiles].slice(0, 30);
  codeArtifacts.links = [...prevLinks].slice(0, 30);
  codeArtifacts.notes = body.slice(0, 20000);
  const el = $("code-result");
  if (el) el.value = codeArtifacts.notes;
  const meta = $("code-result-meta");
  if (meta) {
    meta.textContent =
      `文件 ${codeArtifacts.files.length} · 链接 ${codeArtifacts.links.length} · ` +
      new Date().toLocaleString();
  }
  renderCodeArtifactLists();
  recordL0Audit({
    scene: "code",
    action: "adopt_result",
    auth: "write",
    executor: "user",
    summary: body.slice(0, 80),
    outcome: "adopted",
  });
  return true;
}

async function refreshCodeScenarioHint() {
  const writeAuthorized = !!$("code-auth-write")?.checked;
  const workspaceLabel = ($("code-workspace-label")?.value || "").trim();
  try {
    const built = await window.digitalMe.buildCodeDelegationHint({
      writeAuthorized,
      workspaceLabel,
    });
    codeDelegationHint = (built && built.scenarioHint) || "";
    activeScenario = {
      id: "code",
      title: "编程",
      systemHint: codeDelegationHint,
    };
  } catch {
    codeDelegationHint = "请在像我约束下协助编程任务；默认只读。";
    activeScenario = { id: "code", title: "编程", systemHint: codeDelegationHint };
  }
}

async function recordL0Audit(_payload) {
  /* legacy renderer append removed in P1-04; trusted records are main-process only */
}

function formatDecisionAuditRow(r) {
  const when = (r.at || "").replace("T", " ").slice(0, 19);
  const scopes = Array.isArray(r.dataScopes) ? r.dataScopes.join("、") : "";
  const status = (r.outcome && r.outcome.status) || r.event || "";
  const reasons =
    r.outcome && Array.isArray(r.outcome.reasonCodes) && r.outcome.reasonCodes.length
      ? " · " + r.outcome.reasonCodes.join("、")
      : "";
  return (
    `<div class="path">${escapeHtml(when)} · ${escapeHtml(r.event || "")} · ${escapeHtml(status)}</div>` +
    `<div class="muted" style="font-size:11px">${escapeHtml(r.action || "")}${scopes ? " · " + escapeHtml(scopes) : ""}${escapeHtml(reasons)}</div>`
  );
}

function renderAuditGenerationSelect(data) {
  const sel = $("settings-audit-generation");
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = "";
  const gens = (data && data.availableGenerations) || [];
  for (const gen of gens) {
    const opt = document.createElement("option");
    opt.value = String(gen);
    opt.textContent = `第 ${gen} 代`;
    if (String(gen) === String(currentValue || data.currentGeneration || data.generation || "")) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  }
}

function renderAuditIntegrity(data) {
  const el = $("settings-audit-integrity");
  if (!el) return;
  if (!data) {
    el.textContent = "";
    return;
  }
  const currentHealthy = data.healthy === false ? "当前代次异常" : "当前代次正常";
  const globalHealthy = data.globalHealthy === false ? "全局完整性异常" : "全局完整性正常";
  el.textContent = `${currentHealthy}；${globalHealthy}。${data.note || ""}`;
}

async function refreshDecisionAuditList(box, limit, generation) {
  if (!box || !window.digitalMe.decisionAuditList) return;
  try {
    const data = await window.digitalMe.decisionAuditList({
      limit: limit || 30,
      generation,
    });
    box.innerHTML = "";
    renderAuditGenerationSelect(data);
    renderAuditIntegrity(data);
    const rows = (data && data.entries) || [];
    if (!rows.length) {
      box.innerHTML = `<div class="muted">尚无记录。</div>`;
      return;
    }
    if (data && (data.healthy === false || data.globalHealthy === false)) {
      const warn = document.createElement("div");
      warn.className = "muted";
      warn.textContent = "记录完整性校验未通过，请谨慎参考并优先处理异常。";
      box.appendChild(warn);
    }
    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "code-file-row";
      div.innerHTML = formatDecisionAuditRow(r);
      box.appendChild(div);
    }
  } catch (e) {
    box.innerHTML = `<div class="muted">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function buildExternalAgentDataScopes(writeAuthorized) {
  const scopes = ["task_text", "env_inherit"];
  if (writeAuthorized) scopes.push("workspace_files");
  return scopes;
}

function showExternalAgentConfirmModal(summary, expiresAt) {
  return new Promise((resolve) => {
    const modal = $("external-agent-confirm-modal");
    const title = $("ext-agent-confirm-title");
    const headline = $("ext-agent-confirm-headline");
    const details = $("ext-agent-confirm-details");
    const expiry = $("ext-agent-confirm-expiry");
    const btnOk = $("btn-ext-agent-confirm");
    const btnCancel = $("btn-ext-agent-cancel");
    if (!modal || !details || !btnOk || !btnCancel) {
      resolve(false);
      return;
    }
    if (title) title.textContent = "确认外部程序执行";
    if (headline) {
      headline.textContent =
        (summary && summary.headline) || "即将让本机外部程序执行任务";
    }
    details.innerHTML = "";
    const envKeys =
      summary && Array.isArray(summary.envKeyNames) && summary.envKeyNames.length
        ? summary.envKeyNames.join("、")
        : "—";
    const rows = [
      ["说明", summary && summary.notSandboxNotice],
      ["工具", summary && summary.executorName],
      ["工具版本", summary && summary.definitionVersion],
      ["可执行文件", summary && (summary.executableAbsolute || summary.commandLabel)],
      ["工作目录", summary && summary.cwd],
      ["环境变量（仅键名）", envKeys],
      [
        "超时",
        summary && summary.timeoutMs ? Math.round(summary.timeoutMs / 1000) + " 秒" : "—",
      ],
      [
        "输出上限",
        summary && summary.maxOutputBytes
          ? summary.maxOutputBytes + " 字节"
          : "—",
      ],
      ["可能改文件", summary && summary.mayModifyFiles ? "是" : "否"],
      ["数据范围", summary && Array.isArray(summary.dataScopes) ? summary.dataScopes.join("、") : ""],
      ["风险", summary && summary.risk],
      ["任务长度", summary && summary.taskLength != null ? summary.taskLength + " 字" : ""],
    ];
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value || "—";
      details.appendChild(dt);
      details.appendChild(dd);
    }
    if (expiry) {
      const exp = expiresAt ? new Date(expiresAt).toLocaleString() : "";
      expiry.textContent = exp ? `确认凭据有效期至：${exp}` : "";
    }
    modal.classList.remove("hidden");
    const cleanup = (result) => {
      modal.classList.add("hidden");
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup({ confirmed: true });
    const onCancel = () => cleanup({ confirmed: false });
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
  });
}

async function refreshCodeAuditList() {
  await refreshDecisionAuditList($("code-audit-list"), 12);
}

async function refreshSettingsAuditList() {
  const generation = $("settings-audit-generation")?.value || "";
  await refreshDecisionAuditList($("settings-audit-list"), 30, generation || undefined);
}

async function refreshCodeExecutorSelect() {
  const sel = $("code-executor-select");
  if (!sel || !window.digitalMe.l0ListAgents) return;
  try {
    const data = await window.digitalMe.l0ListAgents();
    sel.innerHTML = "";
    for (const a of data.agents || []) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.enabled || a.kind === "builtin" ? a.name : a.name + "（未配置）";
      opt.disabled = a.kind !== "builtin" && !a.enabled;
      if (a.id === data.activeId) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch {
    sel.innerHTML = `<option value="builtin">本机对话与已武装工具</option>`;
  }
}

async function openCodeScene() {
  await refreshSkillBar("code");
  await refreshCodeScenarioHint();
  await refreshCodeExecutorSelect();
  await refreshCodeAuditList();
  renderCodeMessages();
  renderCodeArtifactLists();
  try {
    const prep = await window.digitalMe.prepareCodeScene?.();
    const el = $("code-prep-status");
    if (el && prep) el.textContent = prep.message || "";
  } catch (e) {
    const el = $("code-prep-status");
    if (el) el.textContent = e.message || String(e);
  }
}

function renderCodeMessages() {
  const box = $("code-messages");
  if (!box) return;
  box.innerHTML = "";
  if (!codeHistory.length) {
    const note = document.createElement("div");
    note.className = "msg system-note";
    note.textContent =
      "左侧先确认是否允许改文件，再在下方描述任务。回复可「采用为成果」写入右侧成果台（文件、链接、说明）。本页协助写代码与说明，不是完整开发软件。";
    box.appendChild(note);
    return;
  }
  for (const m of codeHistory) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : m.role === "system-note" ? "system-note" : "assistant");
    div.textContent = m.content || "";
    box.appendChild(div);
    if (m.role === "assistant") attachCodeAssistantActions(div, m.content || "");
  }
  box.scrollTop = box.scrollHeight;
}

function attachCodeAssistantActions(div, text) {
  let actions = div.querySelector(".msg-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "msg-actions";
    div.appendChild(actions);
  }
  if (!actions.querySelector(".btn-adopt-code")) {
    const adoptBtn = document.createElement("button");
    adoptBtn.className = "btn-adopt-code btn-ghost";
    adoptBtn.type = "button";
    adoptBtn.textContent = "采用为成果";
    adoptBtn.addEventListener("click", () => {
      if (adoptCodeReplyAsResult(text)) {
        adoptBtn.textContent = "已采用";
        setTimeout(() => {
          adoptBtn.textContent = "采用为成果";
        }, 1600);
      }
    });
    actions.appendChild(adoptBtn);
  }
}

async function sendCode() {
  const input = $("code-input");
  const text = (input && input.value.trim()) || "";
  if (!text) return;
  await refreshCodeScenarioHint();
  if (input) input.value = "";
  codeHistory.push({ role: "user", content: text });
  renderCodeMessages();

  const writeAuthorized = !!$("code-auth-write")?.checked;
  const executorId = $("code-executor-select")?.value || "builtin";
  codeRequestId = "creq_" + Date.now().toString(36);
  codeOperationId = null;
  codeStopBusy = false;
  adoptPendingCodeOperationId();
  $("btn-code-send").disabled = true;
  const stopBtn = $("btn-code-stop");
  if (stopBtn) {
    stopBtn.classList.remove("hidden");
    stopBtn.disabled = false;
  }
  const trail = $("code-trail");
  if (trail) {
    trail.classList.remove("hidden");
    trail.textContent = "正在执行…";
  }
  const pending = document.createElement("div");
  pending.className = "msg assistant streaming";
  pending.textContent = "";
  $("code-messages").appendChild(pending);

  try {
    let reply = "";
    let caps = [];
    let executorName = "本机对话";

    if (executorId !== "builtin" && window.digitalMe.l0RequestExternalAgent) {
      await window.digitalMe.l0SetActiveAgent?.(executorId);
      const dataScopes = buildExternalAgentDataScopes(writeAuthorized);
      if (writeAuthorized === false) {
        pending.classList.remove("streaming");
        pending.className = "msg system-note";
        pending.textContent =
          "外部执行体可能改文件：请先勾选「允许改动授权目录中的文件」，并确认你信任该命令。";
        codeHistory.push({
          role: "system-note",
          content: pending.textContent,
        });
        return;
      }
      if (trail) trail.textContent = "正在请求安全确认…";
      const prep = await window.digitalMe.l0RequestExternalAgent({
        task: text,
        dataScopes,
        writeIntent: writeAuthorized,
        requestId: codeRequestId,
      });
      if (!prep || prep.status !== "require_confirmation") {
        throw new Error("未能获取确认摘要。");
      }
      const confirmed = await showExternalAgentConfirmModal(prep.summary, prep.expiresAt);
      if (!confirmed || !confirmed.confirmed) {
        try {
          await window.digitalMe.l0CancelExternalAgentConfirmation?.({
            decisionId: prep.decisionId,
            confirmationToken: prep.confirmationToken,
          });
        } catch {
          /* ignore cancel failure; user-facing cancel remains */
        }
        pending.classList.remove("streaming");
        pending.className = "msg system-note";
        pending.textContent = "已取消外部委派。";
        codeHistory.push({ role: "system-note", content: "已取消外部委派。" });
        return;
      }
      if (trail) trail.textContent = "正在调度外部执行体（须你已确认）…";
      const runPayload = {
        task: text,
        dataScopes,
        writeIntent: writeAuthorized,
        decisionId: prep.decisionId,
        confirmationToken: prep.confirmationToken,
        requestId: codeRequestId,
      };
      // Poll for main-minted operationId while invoke is in flight (started event).
      const opPoll = setInterval(() => {
        adoptPendingCodeOperationId();
      }, 40);
      let res;
      try {
        res = await window.digitalMe.l0RunExternalAgent(runPayload);
      } finally {
        clearInterval(opPoll);
      }
      adoptPendingCodeOperationId();
      if (res && res.operationId) codeOperationId = String(res.operationId);
      reply = (res && res.reply) || "";
      caps = (res && res.meta && res.meta.capabilitiesUsed) || [];
      executorName = (res && res.meta && res.meta.executor) || "外部执行体";
      if (res && res.aborted) {
        pending.classList.remove("streaming");
        pending.className = "msg system-note";
        if (res.orphanRisk || (res.meta && res.meta.orphanRisk)) {
          pending.textContent =
            reply || "已尝试停止外部程序，但未能确认进程已结束，可能仍有残留进程。";
        } else {
          pending.textContent = reply || "已停止外部程序。";
        }
        codeHistory.push({ role: "system-note", content: pending.textContent });
        await refreshCodeAuditList();
        return;
      }
      if (res && (res.orphanRisk || (res.meta && res.meta.orphanRisk))) {
        // Do not treat as a clean stop; keep the risk wording from main process.
        pending.classList.remove("streaming");
        pending.className = "msg system-note";
        pending.textContent = reply || "已尝试停止外部程序，但未能确认进程已结束，可能仍有残留进程。";
        codeHistory.push({ role: "system-note", content: pending.textContent });
        await refreshCodeAuditList();
        return;
      }
    } else {
      await window.digitalMe.l0SetActiveAgent?.("builtin");
      const apiHistory = codeHistory
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await window.digitalMe.sendChat({
        pkg,
        history: apiHistory,
        requestId: codeRequestId,
        scenarioHint: codeDelegationHint || (activeScenario && activeScenario.systemHint) || "",
      });
      const replyRaw = typeof res === "string" ? res : res.reply || "";
      reply = stripToolLeakageClient(replyRaw) || replyRaw;
      caps =
        (res && res.meta && res.meta.capabilitiesUsed) ||
        (res && res.capabilitiesUsed) ||
        [];
      await recordL0Audit({
        scene: "code",
        action: "builtin_delegate",
        auth: writeAuthorized ? "write" : "read",
        executor: "builtin",
        summary: text.slice(0, 120),
        capabilities: caps,
        outcome: "ok",
      });
    }

    if (trail) {
      trail.textContent = caps.length
        ? `执行体：${executorName}。本次调用：${caps.join("、")}。`
        : `执行体：${executorName}。本次未调用外部手脚。`;
    }
    pending.classList.remove("streaming");
    pending.textContent = reply || "（无输出）";
    if (reply) {
      codeHistory.push({ role: "assistant", content: reply });
      attachCodeAssistantActions(pending, reply);
    }
    await refreshCodeAuditList();
  } catch (e) {
    pending.classList.remove("streaming");
    pending.className = "msg system-note";
    const msg = String(e.message || e);
    if (/残留进程|未能确认进程/.test(msg)) {
      pending.textContent = msg;
      codeHistory.push({ role: "system-note", content: msg });
    } else if (msg.includes("abort") || msg.includes("取消")) {
      pending.textContent = "已停止。";
      codeHistory.push({ role: "system-note", content: "已停止。" });
    } else {
      pending.textContent = "失败：" + msg;
      codeHistory.push({ role: "system-note", content: "失败：" + msg });
    }
    await recordL0Audit({
      scene: "code",
      action: "delegate_fail",
      auth: writeAuthorized ? "write" : "read",
      executor: executorId,
      summary: text.slice(0, 120),
      outcome: String(e.message || e).slice(0, 80),
    });
    await refreshCodeAuditList();
  } finally {
    codeStopBusy = false;
    $("btn-code-send").disabled = false;
    const stopBtn = $("btn-code-stop");
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.classList.add("hidden");
    }
    codeRequestId = null;
    codeOperationId = null;
    $("code-messages").scrollTop = $("code-messages").scrollHeight;
  }
}

function syncResearchScenarioHint() {
  const sk = activeSkillByScene.research;
  const hasSrc = !!(activeResearch && researchSources().length);
  const grounded =
    RESEARCH_SCENE_HINT +
    (hasSrc
      ? " 请尽量依据已添加的参考材料作答。"
      : " 当前无参考材料：答复须标注「初步，尚未对照材料」，同时可给方向性分析与建议。");
  activeScenario = {
    id: "research",
    title: "研究",
    systemHint: (sk && sk.systemHint) || grounded,
  };
}

function researchSources() {
  if (!activeResearch) return [];
  return activeResearch.sources || activeResearch.materials || [];
}

function buildResearchContextBlock() {
  if (!activeResearch) return "";
  const p = activeResearch;
  const q = p.question || p.proposition || "";
  const sources = researchSources()
    .slice(0, 30)
    .map((m, i) => {
      const loc = m.urlOrPath || m.source || "";
      const excerpt = m.excerpt || m.note || "";
      return `${i + 1}. [${m.id}] ${m.title}${loc ? "（" + loc + "）" : ""}\n${excerpt}`;
    })
    .join("\n\n");
  const arts = (p.artifacts || [])
    .slice(0, 8)
    .map((a) => `### ${a.title} (${a.type})\n${String(a.content || "").slice(0, 4000)}`)
    .join("\n\n");
  const claims = (p.claimNotes || [])
    .slice(0, 20)
    .map((c) => `- [${c.support}] ${c.claim} ← materials ${((c.sourceIds || []).join(",") || "?")}`)
    .join("\n");
  return (
    `研究问题：${q}\n进度：${p.progress || p.stage || ""}\n范围：${p.scope || "（空）"}\n` +
    `【参考材料】\n${sources || "（空 — 仅可做计划与检索线索，禁止编造事实）"}\n` +
    `【结论核对】\n${claims || "（空）"}\n` +
    `【已有整理结果】\n${arts || "（空）"}`
  );
}

function getActiveArtifact() {
  if (!activeResearch) return null;
  const arts = activeResearch.artifacts || [];
  if (!arts.length) return null;
  return arts.find((a) => a.id === activeResearchArtifactId) || arts[0];
}

let researchAdvancedOpen = false;

function extractUrlsFromText(text) {
  const re = /https?:\/\/[^\s<>\]"')]+/gi;
  return [...new Set((String(text || "").match(re) || []).map((u) => u.replace(/[.,;:!?)]+$/, "")))].slice(0, 5);
}

function getCurrentDraftText() {
  const el = $("rp-current-draft");
  return el ? el.value : "";
}

function setCurrentDraftText(text, syncAdvanced) {
  if ($("rp-current-draft")) $("rp-current-draft").value = text || "";
  if (syncAdvanced !== false && $("rp-draft-content")) {
    const cur = getActiveArtifact();
    if (cur || ($("rp-draft-content").value || "").trim() === "") {
      $("rp-draft-content").value = text || "";
    }
  }
}

function toggleResearchAdvanced(open) {
  researchAdvancedOpen = open !== undefined ? !!open : !researchAdvancedOpen;
  const panel = $("research-advanced");
  const backdrop = $("research-advanced-backdrop");
  if (panel) {
    panel.classList.toggle("hidden", !researchAdvancedOpen);
    panel.setAttribute("aria-hidden", researchAdvancedOpen ? "false" : "true");
  }
  if (backdrop) backdrop.classList.toggle("hidden", !researchAdvancedOpen);
  if (researchAdvancedOpen) renderResearchMethodPacks().catch(() => {});
}

function updateResearchStatusBar() {
  const bar = $("research-status-bar");
  if (!bar) return;
  if (!activeResearch) {
    bar.textContent = "点「开始新研究」或直接输入问题；也可从左侧打开既有课题。";
    return;
  }
  const nSrc = researchSources().length;
  const q = activeResearch.question || activeResearch.proposition || "研究";
  const done = (activeResearch.progress || "") === "write";
  bar.textContent = done
    ? `「${q}」· 已完成` + (nSrc ? ` · ${nSrc} 份参考材料` : "")
    : nSrc
      ? `「${q}」· 进行中 · 有依据（${nSrc} 份参考材料）`
      : `「${q}」· 进行中 · 初步（尚未对照材料）`;
}

function researchHasLocalExportContent() {
  if (!activeResearch) return false;
  const draft = getCurrentDraftText().trim();
  if (draft) return true;
  const arts = activeResearch.artifacts || [];
  if (arts.some((a) => String(a.content || "").trim())) return true;
  if ((activeResearch.claimNotes || []).length) return true;
  return false;
}

function getResearchExportState() {
  if (!activeResearch) return { mode: "none", canExport: false };
  const hasContent = researchHasLocalExportContent();
  if (!hasContent) return { mode: "none", canExport: false };
  const hasSrc = researchSources().length > 0;
  return { mode: hasSrc ? "grounded" : "preliminary", canExport: true };
}

function updateResearchExportUi() {
  const btn = $("btn-rp-export-writing");
  const hint = $("research-export-hint");
  const state = getResearchExportState();
  if (btn) {
    btn.disabled = !state.canExport;
    btn.textContent = "到写作改稿";
  }
  if (hint) {
    hint.textContent = state.canExport
      ? "可选：需要报告排版或长文改稿时使用，非必经。"
      : "请先在对话中得到答复，或编辑「成果稿」后再试。";
  }
  updateResearchStatusBar();
  const meta = $("research-draft-meta-simple");
  if (meta) {
    if (!state.canExport) {
      meta.textContent = "";
    } else if (state.mode === "grounded") {
      meta.textContent = "可导出（有依据）";
    } else {
      meta.textContent = "可导出（初步）";
    }
  }
  renderResearchClaimsInline();
  updateMarkDoneButton();
}

async function saveCurrentDraft() {
  if (!activeResearch) return;
  const content = getCurrentDraftText();
  if (!content.trim()) {
    $("research-draft-progress").textContent = "成果稿为空。";
    return;
  }
  const hasSrc = researchSources().length > 0;
  const cur = getActiveArtifact();
  if (cur) {
    cur.content = content;
    activeResearch.artifacts = (activeResearch.artifacts || []).map((a) =>
      a.id === cur.id ? { ...a, content } : a
    );
    activeResearch = await window.digitalMe.saveResearch(activeResearch);
  } else {
    activeResearch = await window.digitalMe.addResearchArtifact({
      id: activeResearch.id,
      artifact: {
        type: hasSrc ? "note" : "plan",
        title: "成果稿 " + new Date().toLocaleString(),
        content,
      },
    });
    activeResearchArtifactId = activeResearch.artifacts[0] && activeResearch.artifacts[0].id;
  }
  $("research-draft-progress").textContent = "成果稿已保存。";
  updateResearchExportUi();
}

async function exportResearchInline(format) {
  if (!activeResearch) return;
  await saveCurrentDraft().catch(() => {});
  try {
    const r = await window.digitalMe.exportResearchDeliverable({
      id: activeResearch.id,
      format,
      draftContent: getCurrentDraftText(),
    });
    if (r.canceled) return;
    $("research-draft-progress").textContent = "已导出：" + r.filePath;
  } catch (e) {
    $("research-draft-progress").textContent = "导出失败：" + (e.message || e);
  }
}

async function exportResearchToWriting() {
  if (!activeResearch) return;
  const state = getResearchExportState();
  if (!state.canExport) {
    $("research-draft-progress").textContent = "还没有可改稿的内容。";
    return;
  }
  if (state.mode === "preliminary") {
    const ok = window.confirm(
      "当前尚无参考材料。\n\n送到写作的是初步稿，不能当作已核实结论。\n\n确定继续吗？"
    );
    if (!ok) return;
  }
  await saveCurrentDraft().catch(() => {});
  await saveResearchProposition().catch(() => {});
  try {
    const send = window.digitalMe.sendResearchToWriting || window.digitalMe.exportResearchFinal;
    const r = await send({
      id: activeResearch.id,
      mode: state.mode === "preliminary" ? "plan" : "final",
      draftContent: getCurrentDraftText(),
    });
    activeResearch = r.project;
    $("research-draft-progress").textContent = "已送到写作：「" + r.deliverable.title + "」。";
    renderResearchWorkspace();
    await openDoScene("write", { libraryId: r.deliverable.id });
  } catch (e) {
    $("research-draft-progress").textContent = "未能送到写作：" + (e.message || e);
  }
}

async function addResearchSourceFromUrl(url, opts = {}) {
  if (!activeResearch || !url) return;
  let excerpt = opts.excerpt || "";
  let title = opts.title || url.replace(/^https?:\/\//, "").slice(0, 60);
  if (opts.fetch) {
    try {
      $("research-draft-progress").textContent = "正在读取网页…";
      const r = await window.digitalMe.fetchResearchSourceExcerpt({ url });
      excerpt = r.excerpt || excerpt;
    } catch (e) {
      $("research-draft-progress").textContent = (e.message || e) + " 已仅添加链接。";
    }
  }
  activeResearch = await window.digitalMe.addResearchSource({
    id: activeResearch.id,
    source: { title, urlOrPath: url, excerpt },
  });
  renderResearchWorkspace();
  syncResearchScenarioHint();
  $("research-draft-progress").textContent = "已添加参考材料：「" + title + "」。";
}

async function ensureResearchProject(firstQuestion) {
  if (activeResearch) return;
  const q = String(firstQuestion || "新研究").trim().slice(0, 120) || "新研究";
  activeResearch = await window.digitalMe.createResearch({ question: q });
  activeResearchArtifactId = null;
  researchList = await window.digitalMe.listResearch();
  if ($("rp-proposition")) $("rp-proposition").value = q;
}

function attachResearchAssistantActions(wrap, text) {
  if (!wrap || !text) return;
  let actions = wrap.querySelector(".msg-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "msg-actions";
    wrap.appendChild(actions);
  }
  if (!actions.querySelector(".btn-copy")) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy";
    copyBtn.type = "button";
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(text);
      copyBtn.textContent = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        copyBtn.textContent = "复制";
      }, 1600);
    });
    actions.appendChild(copyBtn);
  }
  if (!actions.querySelector(".btn-save-artifact")) {
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-save-artifact btn-ghost";
    saveBtn.type = "button";
    saveBtn.textContent = "采用为成果";
    saveBtn.title = "把本条回复汇入下方「成果稿」，用于复制或导出";
    saveBtn.addEventListener("click", async () => {
      if (!activeResearch) return;
      adoptReplyAsDraft(text);
      await saveCurrentDraft();
      recordL0Audit({
        scene: "research",
        action: "adopt_result",
        auth: "write",
        executor: "user",
        summary: String(text || "").slice(0, 80),
        outcome: "adopted",
      });
      saveBtn.textContent = "已采用";
      setTimeout(() => {
        saveBtn.textContent = "采用为成果";
      }, 1600);
    });
    actions.appendChild(saveBtn);
  }
  const urls = extractUrlsFromText(text);
  if (urls.length && !wrap.querySelector(".research-link-actions")) {
    const linkRow = document.createElement("div");
    linkRow.className = "research-link-actions";
    for (const url of urls) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-ghost";
      addBtn.textContent = "添加为材料";
      addBtn.title = url;
      addBtn.addEventListener("click", () => addResearchSourceFromUrl(url, { fetch: false }));
      linkRow.appendChild(addBtn);
      const fetchBtn = document.createElement("button");
      fetchBtn.type = "button";
      fetchBtn.className = "btn-ghost";
      fetchBtn.textContent = "抓取并添加";
      fetchBtn.title = url;
      fetchBtn.addEventListener("click", () => addResearchSourceFromUrl(url, { fetch: true }));
      linkRow.appendChild(fetchBtn);
    }
    wrap.appendChild(linkRow);
    if (urls.length > 1) {
      const batchBtn = document.createElement("button");
      batchBtn.type = "button";
      batchBtn.className = "btn-ghost";
      batchBtn.textContent = "添加全部链接为材料";
      batchBtn.addEventListener("click", async () => {
        for (const url of urls) {
          await addResearchSourceFromUrl(url, { fetch: false });
        }
      });
      linkRow.appendChild(batchBtn);
    }
  }
}

function adoptReplyAsDraft(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const cur = getCurrentDraftText().trim();
  if (!cur) {
    setCurrentDraftText(clean);
    return;
  }
  if (cur.includes(clean)) return;
  setCurrentDraftText(cur + "\n\n---\n\n" + clean);
}

function injectResearchGuide(text, guideKind) {
  const input = $("research-input");
  if (!input) return;
  input.value = text || "";
  researchPendingGuide = guideKind || "chat";
  autosizeResearchInput();
  input.focus();
  const hint = $("research-hint");
  if (hint) {
    hint.textContent = "已填入引导语，可增删后再点「发送」。";
    hint.classList.remove("hidden");
  }
}

function renderResearchNextSteps() {
  const box = $("research-next-steps");
  if (!box) return;
  box.innerHTML = "";
  if (!activeResearch) return;
  const lastAssistant = [...researchMessages].reverse().find((m) => m.role === "assistant" && m.content);
  const hasSrc = researchSources().length > 0;
  const q = activeResearch.question || activeResearch.proposition || "";
  const steps = [];
  if (!lastAssistant) {
    if (!hasSrc) {
      steps.push({
        label: "调研并回答",
        guide: "discover",
        fill:
          "请对以下问题完成一次完整调研（检索并入库公开材料、阅读来源、写出有依据的成果）：\n" +
          (q && q !== "新研究问题" ? q : "（请在此写明研究问题）") +
          "\n\n我特别关心：",
      });
    }
    steps.push({
      label: "帮我理清问题",
      guide: "chat",
      fill: "请帮我把这个研究问题表述得更清楚：划清范围、明确要弄清什么、先不做什么，并指出关键的未知点。",
    });
    steps.push({
      label: "该找哪些材料",
      guide: "chat",
      fill: "为弄清这个问题，我应该收集哪些材料？请按优先级列出材料类型、可能的公开出处，以及每类要重点看什么。",
    });
    steps.push({
      label: "先给初步分析",
      guide: "chat",
      fill: "请先基于常识给出初步分析框架与可能结论方向，并明确标出哪些地方需要材料佐证。",
    });
  } else {
    if (!hasSrc) {
      steps.push({
        label: "调研并回答",
        guide: "discover",
        fill:
          "请对以下问题完成一次完整调研（检索并入库公开材料、阅读来源、写出有依据的成果）：\n" +
          (q || "（请补充问题）") +
          "\n\n我特别关心：",
      });
    }
    steps.push({
      label: "追问细节",
      guide: "chat",
      fill: "请把上面的要点展开，给出更具体的分析、数据口径或例子。",
    });
    steps.push({
      label: "换个角度",
      guide: "chat",
      fill: "请换一个角度再分析一次，指出上面可能忽略的风险、反例或不确定之处。",
    });
    steps.push({ label: "采用为成果", action: "adopt", text: lastAssistant.content });
    steps.push(
      hasSrc
        ? { label: "核对结论与依据", action: "check", kind: "claims" }
        : { label: "加材料让结论更可靠", action: "more" }
    );
    if (!isResearchDone(activeResearch)) {
      steps.push({ label: "标记本题完成", action: "mark_done" });
    } else {
      steps.push({ label: "重开为进行中", action: "reopen" });
    }
  }
  const label = document.createElement("span");
  label.className = "research-next-label";
  label.textContent = "下一步";
  box.appendChild(label);
  for (const s of steps) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "research-next-chip";
    btn.textContent = s.label;
    btn.addEventListener("click", async () => {
      if (s.fill) {
        injectResearchGuide(s.fill, s.guide || "chat");
      } else if (s.action === "adopt") {
        adoptReplyAsDraft(s.text);
        await saveCurrentDraft();
      } else if (s.action === "more") {
        toggleResearchAdvanced(true);
      } else if (s.action === "check") {
        toggleResearchAdvanced(true);
        runResearchCheck(s.kind);
      } else if (s.action === "mark_done") {
        await markResearchDone(true);
      } else if (s.action === "reopen") {
        await markResearchDone(false);
      }
    });
    box.appendChild(btn);
  }
}

function renderResearchMessages() {
  const box = $("research-messages");
  if (!box) return;
  box.innerHTML = "";
  if (!researchMessages.length) {
    const note = document.createElement("div");
    note.className = "msg system-note";
    const hasSrc = !!(activeResearch && researchSources().length);
    note.textContent = activeResearch
      ? hasSrc
        ? "可继续提问。答复下方可「采用为成果」或把链接添加为材料；导出在右侧成果稿。"
        : "直接提问或点「下一步」。离开本页后再回来，对话会保留。"
      : "在左侧点「开始新研究」，或直接输入问题发送。也可打开一项既有课题继续。";
    box.appendChild(note);
    renderResearchNextSteps();
    return;
  }
  for (const m of researchMessages) {
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system-note");
    el.textContent = m.content || "";
    box.appendChild(el);
    if (m.role === "assistant" && m.content) attachResearchAssistantActions(el, m.content);
  }
  box.scrollTop = box.scrollHeight;
  renderResearchNextSteps();
}

function renderResearchStageBar() {
  const bar = $("research-stage-bar");
  if (!bar) return;
  bar.innerHTML = "";
  const cur = (activeResearch && (activeResearch.progress || activeResearch.stage)) || "";
  for (const s of RESEARCH_PROGRESS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "research-stage-btn" + (cur === s.id ? " active" : "");
    btn.textContent = s.label;
    btn.disabled = !activeResearch;
    btn.title = activeResearch ? "进度提示，可随时切换，不阻断操作" : "请先新建或选择一项研究";
    btn.addEventListener("click", async () => {
      if (!activeResearch) return;
      try {
        activeResearch = await window.digitalMe.setResearchProgress({
          id: activeResearch.id,
          progress: s.id,
        });
        renderResearchWorkspace();
      } catch (e) {
        $("research-hint").textContent = "更新进度失败：" + (e.message || e);
      }
    });
    bar.appendChild(btn);
  }
}

function isResearchDone(item) {
  return (item && (item.progress === "write" || item.stage === "write")) || false;
}

async function markResearchDone(done) {
  if (!activeResearch) return;
  const progress = done ? "write" : researchSources().length ? "synthesis" : "question";
  if (done) {
    const hasDraft = !!(getCurrentDraftText().trim() || (activeResearch.artifacts || []).some((a) => String(a.content || "").trim()));
    if (!hasDraft) {
      const ok = window.confirm("成果稿还是空的。仍要标记完成吗？");
      if (!ok) return;
    } else {
      await saveCurrentDraft().catch(() => {});
    }
  }
  try {
    activeResearch = await window.digitalMe.setResearchProgress({
      id: activeResearch.id,
      progress,
    });
    researchList = await window.digitalMe.listResearch();
    renderResearchWorkspace();
    $("research-draft-progress").textContent = done
      ? "已标记完成，可在左侧「已完成」中找到。"
      : "已重开为进行中。";
    updateMarkDoneButton();
  } catch (e) {
    $("research-draft-progress").textContent = "未能更新状态：" + (e.message || e);
  }
}

function updateMarkDoneButton() {
  const btn = $("btn-research-mark-done");
  if (!btn) return;
  if (!activeResearch) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  if (isResearchDone(activeResearch)) {
    btn.textContent = "重开为进行中";
  } else {
    btn.textContent = "标记完成";
  }
}

function showResearchMatFeedback(msg) {
  const el = $("research-mat-feedback");
  if (el) el.textContent = msg || "";
  const hint = $("research-hint");
  if (hint && msg) {
    hint.textContent = msg;
    hint.classList.remove("hidden");
  }
  if ($("research-draft-progress") && msg) $("research-draft-progress").textContent = msg;
}

function researchThreadFromMessages(msgs) {
  return (msgs || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "system-note"))
    .map((m) => ({
      role: m.role,
      content: String(m.content || ""),
      createdAt: m.createdAt || new Date().toISOString(),
    }))
    .slice(-80);
}

function loadResearchMessagesFromProject(item) {
  const threads = (item && item.threads) || [];
  researchMessages = threads
    .filter((m) => m && m.content)
    .map((m) => ({
      role: m.role === "assistant" || m.role === "user" || m.role === "system-note" ? m.role : "system-note",
      content: String(m.content || ""),
      createdAt: m.createdAt,
    }));
}

async function persistResearchMessages() {
  if (!activeResearch || !activeResearch.id) return;
  try {
    activeResearch.threads = researchThreadFromMessages(researchMessages);
    activeResearch = await window.digitalMe.saveResearch(activeResearch);
  } catch {
    // non-blocking
  }
}

function renderResearchProjectList() {
  const activeBox = $("research-list-active");
  const doneBox = $("research-list-done");
  const empty = $("research-project-empty");
  if (!activeBox || !doneBox) return;
  activeBox.innerHTML = "";
  doneBox.innerHTML = "";
  if (!researchList.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");
  const activeItems = researchList.filter((it) => !isResearchDone(it));
  const doneItems = researchList.filter((it) => isResearchDone(it));
  const paint = (box, items) => {
    if (!items.length) {
      box.innerHTML = `<div class="muted" style="font-size:12px;padding:4px 0">暂无</div>`;
      return;
    }
    for (const it of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "library-row" + (activeResearch && activeResearch.id === it.id ? " active" : "");
      const title = it.question || it.proposition || "未命名";
      row.innerHTML =
        `<div class="library-row-title">${escapeHtml(title)}</div>` +
        `<div class="library-row-meta">材料 ${it.sourceCount || it.materialCount || 0} · ${escapeHtml(
          (it.updatedAt || "").slice(0, 16).replace("T", " ")
        )}</div>`;
      row.addEventListener("click", () => openResearchProject(it.id));
      box.appendChild(row);
    }
  };
  paint(activeBox, activeItems);
  paint(doneBox, doneItems);
}

const RESEARCH_FALLBACK_ACTIONS = {
  clarify: {
    id: "clarify",
    title: "理清问题",
    blurb: "把问题、范围和先不做的事写清楚。",
    needsSources: false,
    systemHint:
      "【起步：理清问题】用户可能还没有任何材料。帮助把研究问题、范围、成功标准、本次不做的事写清楚；可建议下一步该找什么材料。禁止编造具体数据。不要输出任何工具调用协议或 DSML。",
    prompt:
      "我目前只有研究问题、还没有材料。请帮我：1）把问题表述得可检验；2）划清范围与本次不做的事；3）列出为回答此问题必须收集的材料类型（按优先级）。不要编造数据，不要输出工具调用标记。",
  },
  find_sources: {
    id: "find_sources",
    title: "该找什么材料",
    blurb: "列出应收集的资料类型与优先顺序。",
    needsSources: false,
    systemHint:
      "【起步：找材料】用户尚无材料。只输出可执行的收集清单；禁止编造事实结论；不要输出工具调用协议或 DSML。",
    prompt:
      "围绕当前研究问题，列出应优先收集的材料清单：材料类型、可能的公开出处或渠道、要提取的关键字段、可信度注意点。不要编造尚未收集到的事实，不要输出工具调用标记。",
  },
  search_keywords: {
    id: "search_keywords",
    title: "检索线索",
    blurb: "给出检索词与可能的公开出处。",
    needsSources: false,
    systemHint:
      "【起步：检索线索】给出检索词与可能公开渠道；标明只是线索；禁止编造检索结果；不要输出工具调用协议或 DSML。",
    prompt:
      "请给出检索线索：关键词组合、可能的公开渠道、建议阅读时关注的字段。明确说明以下不是已核实结论。不要输出工具调用标记。",
  },
};

async function loadResearchActions() {
  try {
    const packs = await window.digitalMe.getResearchMethodPacks();
    if (Array.isArray(packs) && packs.length) return packs;
  } catch {}
  return Object.values(RESEARCH_FALLBACK_ACTIONS);
}

async function renderResearchMethodPacks() {
  const box = $("research-method-packs");
  if (!box) return;
  box.innerHTML = "";
  const hasSrc = researchSources().length > 0;
  if ($("research-actions-title")) $("research-actions-title").textContent = "整理工具";
  if ($("research-actions-hint")) {
    $("research-actions-hint").textContent = hasSrc
      ? "基于已添加材料生成对照表、不一致与缺口。"
      : "理清问题、材料清单与检索线索。";
  }
  const packs = await loadResearchActions();
  const list = packs.filter((p) => (hasSrc ? p.needsSources === true : p.needsSources === false));
  if (!list.length) {
    // Fallback cards when IPC omits needsSources flags
    const fallback = hasSrc
      ? packs.filter((p) => ["compare_table", "contradictions", "gaps"].includes(p.id))
      : packs.filter((p) => ["clarify", "find_sources", "search_keywords"].includes(p.id));
    for (const p of fallback.length ? fallback : Object.values(RESEARCH_FALLBACK_ACTIONS).filter((p) => !hasSrc)) {
      list.push(p);
    }
  }
  if (!list.length) {
    box.innerHTML = `<div class="muted">暂无可用动作。</div>`;
    return;
  }
  for (const p of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "template-card";
    card.innerHTML = `<strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.blurb || "点击后开始")}</span>`;
    card.addEventListener("click", () => runResearchActionById(p.id));
    box.appendChild(card);
  }
}

function fillResearchEditorFromActive() {
  if (!activeResearch) {
    updateResearchStatusBar();
    updateResearchExportUi();
    return;
  }
  const q = activeResearch.question || activeResearch.proposition || "";
  if ($("rp-proposition")) $("rp-proposition").value = q;
  if ($("rp-scope")) $("rp-scope").value = activeResearch.scope || "";
  renderResearchMaterials();
  renderResearchArtifacts();
  renderResearchClaims();
  const cur = getActiveArtifact();
  const draftText = cur?.content || (activeResearch.artifacts || [])[0]?.content || "";
  if (!$("rp-current-draft")?.dataset.userEditing) {
    setCurrentDraftText(draftText, false);
  }
  if ($("research-hint")) $("research-hint").classList.add("hidden");
  updateResearchExportUi();
}

function renderResearchMaterials() {
  const list = $("research-mat-list");
  if (!list) return;
  list.innerHTML = "";
  const mats = researchSources();
  if (!mats.length) {
    list.innerHTML = `<div class="muted">暂无材料。可粘贴标题与出处后添加，或用「调研并回答」自动检索入库。</div>`;
    return;
  }
  for (const m of mats) {
    const row = document.createElement("div");
    row.className = "research-mat-row";
    const loc = m.urlOrPath || m.source || "无出处";
    let excerpt = m.excerpt || m.note || "";
    if (excerpt.length > 280) excerpt = excerpt.slice(0, 280) + "…";
    row.innerHTML =
      `<div class="library-row-title">${escapeHtml(m.title)}</div>` +
      `<div class="library-row-meta">${escapeHtml(loc)}${m.origin === "search" ? " · 检索" : ""}${
        m.origin === "local" ? " · 本地" : ""
      }</div>` +
      (excerpt ? `<div class="muted">${escapeHtml(excerpt)}</div>` : `<div class="muted">（无摘录，仅标题与出处）</div>`) +
      `<button type="button" class="btn-ghost">删除</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      activeResearch = await window.digitalMe.removeResearchSource({
        id: activeResearch.id,
        sourceId: m.id,
      });
      researchList = await window.digitalMe.listResearch();
      renderResearchWorkspace();
      showResearchMatFeedback(`已删除「${m.title}」。还剩 ${researchSources().length} 份。`);
    });
    list.appendChild(row);
  }
}

function researchSupportLabel(support) {
  const map = {
    support: "支持",
    supported: "支持",
    partial: "部分支持",
    none: "不支持",
    no: "不支持",
    pending: "待核实",
  };
  const key = String(support || "pending").toLowerCase();
  return map[key] || "待核实";
}

function researchArtifactTypeLabel(type) {
  const map = {
    compare_table: "对照表",
    contradictions: "不一致",
    gaps: "证据缺口",
    plan: "计划",
    outline: "提纲",
    draft_notes: "草稿",
    note: "笔记",
  };
  return map[type] || "整理";
}

function renderResearchArtifacts() {
  const list = $("research-artifact-list");
  if (!list) return;
  list.innerHTML = "";
  const arts = (activeResearch && activeResearch.artifacts) || [];
  if ($("research-draft-meta")) {
    $("research-draft-meta").textContent = arts.length ? arts.length + " 份" : "无";
  }
  if (!arts.length) {
    list.innerHTML = `<div class="muted">尚无历史整理。对话回复可「采用为成果」。</div>`;
    if ($("rp-draft-content")) $("rp-draft-content").value = "";
    return;
  }
  if (!activeResearchArtifactId || !arts.some((a) => a.id === activeResearchArtifactId)) {
    activeResearchArtifactId = arts[0].id;
  }
  for (const a of arts) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "library-row" + (a.id === activeResearchArtifactId ? " active" : "");
    row.innerHTML =
      `<div class="library-row-title">${escapeHtml(a.title || researchArtifactTypeLabel(a.type))}</div>` +
      `<div class="library-row-meta">${escapeHtml(researchArtifactTypeLabel(a.type))} · ${escapeHtml(
        (a.createdAt || "").slice(0, 16).replace("T", " ")
      )}</div>`;
    row.addEventListener("click", () => {
      activeResearchArtifactId = a.id;
      const c = a.content || "";
      if ($("rp-draft-content")) $("rp-draft-content").value = c;
      setCurrentDraftText(c, false);
      renderResearchArtifacts();
      updateResearchExportUi();
    });
    list.appendChild(row);
  }
  const cur = getActiveArtifact();
  if ($("rp-draft-content") && cur) $("rp-draft-content").value = cur.content || "";
}

function renderResearchClaimRow(c, container) {
  const details = document.createElement("details");
  details.className = "research-claim-item";
  if ((activeResearch?.claimNotes || []).length <= 4) details.open = true;
  const srcs = (c.sourceIds || [])
    .map((sid) => researchSources().find((s) => s.id === sid))
    .filter(Boolean);
  const summary = document.createElement("summary");
  summary.textContent = `[${researchSupportLabel(c.support)}] ${c.claim || ""}`;
  details.appendChild(summary);
  if (c.note) {
    const note = document.createElement("div");
    note.className = "muted research-claim-note";
    note.textContent = c.note;
    details.appendChild(note);
  }
  if (srcs.length) {
    for (const s of srcs) {
      const srcEl = document.createElement("div");
      srcEl.className = "research-claim-source";
      const loc = s.urlOrPath || s.source || "";
      srcEl.innerHTML =
        `<strong>${escapeHtml(s.title)}</strong>` +
        (loc ? `<div class="muted">${escapeHtml(loc)}</div>` : "") +
        (s.excerpt
          ? `<div class="research-claim-excerpt">${escapeHtml(String(s.excerpt).slice(0, 400))}</div>`
          : "");
      details.appendChild(srcEl);
    }
  } else if (researchSources().length) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = "尚未关联到具体材料，请在「更多」中核对。";
    details.appendChild(hint);
  }
  container.appendChild(details);
}

function renderResearchClaimsInline() {
  const panel = $("research-claims-panel");
  const toggle = $("btn-research-claims-toggle");
  const box = $("research-claims-inline");
  if (!panel || !box) return;
  const notes = (activeResearch && activeResearch.claimNotes) || [];
  if (!notes.length) {
    panel.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  panel.classList.remove("hidden");
  if (toggle) toggle.textContent = `结论与依据（${notes.length}）`;
  box.innerHTML = "";
  box.classList.toggle("hidden", !researchClaimsOpen);
  for (const c of notes) renderResearchClaimRow(c, box);
}

function renderResearchClaims() {
  const list = $("research-claim-list");
  if (!list) return;
  list.innerHTML = "";
  const notes = (activeResearch && activeResearch.claimNotes) || [];
  if (!notes.length) {
    list.innerHTML = `<div class="muted">添加材料后，可点「结论与依据」生成核对清单；调研完成后也会自动生成。</div>`;
    return;
  }
  for (const c of notes) renderResearchClaimRow(c, list);
}

function renderResearchWorkspace() {
  if (researchAdvancedOpen) renderResearchStageBar();
  renderResearchProjectList();
  fillResearchEditorFromActive();
  renderResearchMessages();
  syncResearchScenarioHint();
  if (!activeResearch) updateResearchStatusBar();
}

async function refreshResearchView(opts = {}) {
  try {
    researchList = await window.digitalMe.listResearch();
  } catch {
    researchList = [];
  }
  await renderResearchMethodPacks();
  let id = opts.projectId;
  if (!id && activeResearch) id = activeResearch.id;
  if (!id) {
    try {
      const act = await window.digitalMe.getActiveResearch();
      if (act) id = act.id;
    } catch {}
  }
  if (id) await openResearchProject(id);
  else {
    activeResearch = null;
    activeResearchArtifactId = null;
    researchMessages = [];
    renderResearchWorkspace();
  }
}

async function openResearchProject(id) {
  const item = await window.digitalMe.getResearch(id);
  if (!item) return;
  activeResearch = item;
  activeResearchArtifactId = (item.artifacts && item.artifacts[0] && item.artifacts[0].id) || null;
  await window.digitalMe.setActiveResearch(id);
  loadResearchMessagesFromProject(item);
  renderResearchWorkspace();
}

async function createResearchProject() {
  try {
    await window.digitalMe.setActiveResearch(null);
    activeResearch = null;
    activeResearchArtifactId = null;
    researchMessages = [];
    researchList = await window.digitalMe.listResearch();
    renderResearchWorkspace();
    const input = $("research-input");
    if (input) {
      input.value = "";
      input.focus();
      autosizeResearchInput();
    }
    if ($("research-hint")) {
      $("research-hint").textContent = "已进入新研究。直接输入问题发送即可。";
      $("research-hint").classList.remove("hidden");
    }
  } catch (e) {
    if ($("research-hint")) $("research-hint").textContent = "未能开始新研究：" + (e.message || e);
  }
}

async function saveResearchProposition() {
  if (!activeResearch) return;
  const q = ($("rp-proposition") && $("rp-proposition").value.trim()) || activeResearch.question;
  activeResearch.question = q;
  activeResearch.proposition = q;
  activeResearch.scope = ($("rp-scope") && $("rp-scope").value) || "";
  if (activeResearch.progress === "question" || !activeResearch.progress) {
    activeResearch.progress = researchSources().length ? "sources" : "question";
  }
  activeResearch = await window.digitalMe.saveResearch(activeResearch);
  researchList = await window.digitalMe.listResearch();
  renderResearchWorkspace();
  $("research-hint").textContent = "研究问题已保存。";
}

async function saveResearchDraft() {
  if (!activeResearch) return;
  const content = ($("rp-draft-content") && $("rp-draft-content").value) || "";
  const cur = getActiveArtifact();
  if (cur) {
    cur.content = content;
    activeResearch.artifacts = (activeResearch.artifacts || []).map((a) =>
      a.id === cur.id ? { ...a, content } : a
    );
    activeResearch = await window.digitalMe.saveResearch(activeResearch);
    $("research-draft-progress").textContent = "整理已保存。";
    updateResearchExportUi();
  } else if (content.trim()) {
    activeResearch = await window.digitalMe.addResearchArtifact({
      id: activeResearch.id,
      artifact: { type: researchSources().length ? "note" : "plan", title: "整理笔记", content },
    });
    activeResearchArtifactId = activeResearch.artifacts[0] && activeResearch.artifacts[0].id;
    $("research-draft-progress").textContent = "已新建整理结果。";
    renderResearchWorkspace();
  } else {
    $("research-draft-progress").textContent = "无内容可保存。";
  }
}

function autosizeResearchInput() {
  const el = $("research-input");
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(Math.max(el.scrollHeight, 100), 260);
  el.style.height = next + "px";
}

async function maybeSaveReplyAsArtifact(body, suggestedType, suggestedTitle) {
  if (!activeResearch || !body || body.length < 80) return;
  // Auto-prompt only for explicit action runs; otherwise user uses 「存为整理」
  if (!(activeScenario && String(activeScenario.id || "").startsWith("action_"))) return;
  const ok = window.confirm("把这次回复保存到「整理结果」？");
  if (!ok) return;
  const hasSrc = researchSources().length > 0;
  activeResearch = await window.digitalMe.addResearchArtifact({
    id: activeResearch.id,
    artifact: {
      type: suggestedType || (hasSrc ? "note" : "plan"),
      title: suggestedTitle || (hasSrc ? "整理" : "计划") + " " + new Date().toLocaleString(),
      content: body,
    },
  });
  activeResearchArtifactId = activeResearch.artifacts[0] && activeResearch.artifacts[0].id;
  renderResearchWorkspace();
  $("research-draft-progress").textContent = "已存入整理结果。";
}

async function runDiscoverAndAnswer() {
  const input = $("research-input");
  const inputText = (input && input.value.trim()) || "";
  if (!activeResearch) {
    if (!inputText) {
      if ($("research-hint")) $("research-hint").textContent = "请先输入要研究的问题。";
      input?.focus();
      return;
    }
    try {
      await ensureResearchProject(inputText);
    } catch (e) {
      researchMessages.push({ role: "system-note", content: "未能开始：" + (e.message || e) });
      renderResearchMessages();
      return;
    }
  }
  const query =
    inputText || (activeResearch && (activeResearch.question || activeResearch.proposition)) || "";
  if (!query || query === "新研究问题") {
    if ($("research-hint")) $("research-hint").textContent = "请先写明要研究的问题。";
    return;
  }
  researchAgentRequestId = "rag_" + Date.now().toString(36);
  $("btn-research-send").disabled = true;
  $("btn-research-stop").classList.remove("hidden");
  setResearchToolTrail("<strong>正在准备调研能力…</strong>", true);
  if (input) input.value = "";
  autosizeResearchInput();
  researchMessages.push({ role: "user", content: query });
  await persistResearchMessages();
  renderResearchMessages();
  const pending = document.createElement("div");
  pending.className = "msg assistant streaming";
  pending.textContent = "正在执行四步调研（澄清→检索→读源→成果）…";
  $("research-messages").appendChild(pending);
  try {
    await window.digitalMe.prepareResearchScene();
    await refreshSkillBar("research");
    syncResearchScenarioHint();
    const r = await window.digitalMe.runResearchAgentLoop({
      id: activeResearch.id,
      question: query,
      requestId: researchAgentRequestId,
      scenarioHint: (activeScenario && activeScenario.systemHint) || RESEARCH_SCENE_HINT,
    });
    activeResearch = r.project;
    researchList = await window.digitalMe.listResearch();
    const full = stripToolLeakageClient(r.reply || "");
    pending.classList.remove("streaming");
    pending.textContent = full || "（未生成答复）";
    if (full) {
      researchMessages.push({ role: "assistant", content: full });
      attachResearchAssistantActions(pending, full);
      setCurrentDraftText(full);
      await saveCurrentDraft().catch(() => {});
      researchClaimsOpen = !!(r.claimNotes && r.claimNotes.length);
      await persistResearchMessages();
    }
    if (r.grounded && !r.grounded.ok && researchSources().length) {
      researchMessages.push({
        role: "system-note",
        content: "依据核对提示：" + (r.grounded.issues || []).join("；") + "。可在成果稿中补充材料引用后导出。",
      });
      await persistResearchMessages();
    }
    renderResearchWorkspace();
    $("research-draft-progress").textContent =
      r.search && r.search.added
        ? `调研完成，已入库 ${r.search.added} 条材料（共 ${researchSources().length} 份）。`
        : "调研完成。";
    if (researchSources().length) {
      showResearchMatFeedback(`参考材料已更新：共 ${researchSources().length} 份。可在「更多」中查看。`);
    }
  } catch (e) {
    pending.className = "msg system-note";
    pending.textContent = "调研未成功：" + (e.message || e);
    setResearchToolTrail("", false);
  } finally {
    $("btn-research-send").disabled = false;
    $("btn-research-stop").classList.add("hidden");
    researchAgentRequestId = null;
    setResearchToolTrail("", false);
    renderResearchNextSteps();
    updateResearchStatusBar();
  }
}

async function sendResearch() {
  const input = $("research-input");
  const text = (input && input.value.trim()) || "";
  if (!text) return;

  const pendingGuide = researchPendingGuide;
  researchPendingGuide = null;

  if (pendingGuide === "discover") {
    await runDiscoverAndAnswer();
    return;
  }

  if (!activeResearch) {
    try {
      await ensureResearchProject(text);
    } catch (e) {
      researchMessages.push({ role: "system-note", content: "未能开始：" + (e.message || e) });
      renderResearchMessages();
      return;
    }
  }
  if (!activeResearch.question || activeResearch.question === "新研究问题") {
    activeResearch.question = text.slice(0, 120);
    activeResearch.proposition = activeResearch.question;
    activeResearch = await window.digitalMe.saveResearch(activeResearch);
    if ($("rp-proposition")) $("rp-proposition").value = activeResearch.question;
  }
  input.value = "";
  autosizeResearchInput();
  researchMessages.push({ role: "user", content: text });
  await persistResearchMessages();
  renderResearchMessages();
  syncResearchScenarioHint();
  const userContent =
    text + "\n\n---\n当前研究上下文：\n" + buildResearchContextBlock().slice(0, 60000);
  researchRequestId = "rreq_" + Date.now().toString(36);
  $("btn-research-send").disabled = true;
  $("btn-research-stop").classList.remove("hidden");
  setResearchToolTrail("<strong>正在综合材料并撰写答复…</strong>", true);
  const pending = document.createElement("div");
  pending.className = "msg assistant streaming";
  $("research-messages").appendChild(pending);
  const actionHint = activeScenario && String(activeScenario.id || "").startsWith("action_");
  const actionType = actionHint ? String(activeScenario.id).replace(/^action_/, "") : "note";
  try {
    const baseHint = (activeScenario && activeScenario.systemHint) || RESEARCH_SCENE_HINT;
    const scenarioHint = await withL0ControlHint("research", baseHint);
    const apiHistory = researchMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1)
      .concat([{ role: "user", content: userContent }]);
    const res = await window.digitalMe.sendChat({
      pkg,
      history: apiHistory,
      requestId: researchRequestId,
      scenarioHint,
    });
    const reply = typeof res === "string" ? res : res.reply || "";
    pending.classList.remove("streaming");
    let full = stripToolLeakageClient(res.fullReply || reply || "");
    if (!full && /DSML|tool_calls|invoke\s+name\s*=/i.test(String(res.fullReply || reply || ""))) {
      full = "刚才尝试查阅网页，但没有整理成可读说明。请再试一次；或把链接添加到「参考材料」后再问。";
    }
    pending.textContent = full || "（已停止）";
    const caps =
      (res && res.meta && res.meta.capabilitiesUsed) ||
      (res && res.capabilitiesUsed) ||
      [];
    setResearchToolTrail(
      caps.length
        ? `本次调用：${caps.map(escapeHtml).join("、")}。请核对依据后再采用为成果。`
        : "本次未调用外部手脚。请核对答复后再采用为成果。",
      true
    );
    if (full) {
      researchMessages.push({ role: "assistant", content: full });
      await persistResearchMessages();
      attachResearchAssistantActions(pending, full);
      if (researchSources().length && window.digitalMe.validateResearchGrounded) {
        try {
          const v = await window.digitalMe.validateResearchGrounded({
            id: activeResearch.id,
            text: full,
          });
          if (!v.ok && v.issues?.length) {
            researchMessages.push({
              role: "system-note",
              content: "依据核对：" + v.issues.join("；"),
            });
            await persistResearchMessages();
          }
        } catch {
          // non-blocking
        }
      }
      renderResearchNextSteps();
      updateResearchStatusBar();
    }
    const body = stripToolLeakageClient((res.artifact && res.artifact.content) || full);
    if (body && body.length > 120 && actionHint) {
      await maybeSaveReplyAsArtifact(
        body,
        ["compare_table", "contradictions", "gaps", "plan"].includes(actionType) ? actionType : researchSources().length ? "note" : "plan",
        (activeScenario && activeScenario.title) || "整理"
      );
    }
    await recordL0Audit({
      scene: "research",
      action: "scene_delegate",
      auth: "read",
      executor: "builtin",
      summary: text.slice(0, 120),
      capabilities: caps,
      outcome: "ok",
    });
  } catch (e) {
    pending.className = "msg system-note";
    pending.textContent = "没办成：" + (e.message || e);
    setResearchToolTrail("本次未完成。", true);
    await recordL0Audit({
      scene: "research",
      action: "scene_delegate",
      auth: "read",
      executor: "builtin",
      summary: text.slice(0, 120),
      outcome: String(e.message || e).slice(0, 80),
    });
  } finally {
    $("btn-research-send").disabled = false;
    $("btn-research-stop").classList.add("hidden");
    researchRequestId = null;
  }
}

async function generateResearchStageBody() {
  if (!activeResearch) return;
  if (!researchSources().length) {
    $("research-input").value =
      "我目前只有研究问题、还没有材料。请给出：问题澄清、必须收集的材料类型（按优先级）、检索关键词与可能出处。不要编造具体数据或结论。";
  } else {
    $("research-input").value =
      "请基于已添加的参考材料，输出一份整理稿：主题要点、结论与材料对照、不一致与证据缺口、待核实项。禁止无出处结论。";
  }
  autosizeResearchInput();
  await sendResearch();
}

async function runResearchActionById(actionId) {
  if (!activeResearch) {
    if ($("research-hint")) $("research-hint").textContent = "请先新建或选择一项研究。";
    return;
  }
  try {
    if ($("research-hint")) $("research-hint").textContent = "正在准备…";
    const packs = await loadResearchActions();
    const p =
      (packs || []).find((x) => x.id === actionId) || RESEARCH_FALLBACK_ACTIONS[actionId] || null;
    if (!p) {
      $("research-hint").textContent = "未找到该动作，请改用「生成整理稿」。";
      return;
    }
    if (p.needsSources && !researchSources().length) {
      $("research-hint").textContent = "请先添加参考材料。";
      return;
    }
    let systemHint = p.systemHint || RESEARCH_SCENE_HINT;
    try {
      const prep = await window.digitalMe.prepareResearchMethod(p.id);
      if (prep && prep.systemHint) systemHint = prep.systemHint;
    } catch {
      // Discovery actions may not need capability prep; continue with local prompt.
    }
    activeScenario = {
      id: "action_" + p.id,
      title: p.title,
      systemHint,
    };
    $("research-input").value = p.prompt || "";
    autosizeResearchInput();
    $("research-hint").textContent = "正在生成：「" + p.title + "」…";
    await sendResearch();
  } catch (e) {
    $("research-hint").textContent = "未能开始：" + (e.message || e);
  }
}

async function runResearchCheck(kind) {
  if (!activeResearch) return;
  const kindLabel =
    { claims: "结论与依据", gaps: "证据缺口", contradictions: "不一致", sources: "出处", open: "待核实" }[kind] ||
    "核对";
  try {
    const r = await window.digitalMe.runResearchCheck({ id: activeResearch.id, kind });
    activeResearch = r.project;
    const panel = $("research-check-panel");
    if (panel) {
      panel.classList.remove("hidden");
      panel.innerHTML =
        `<strong>${escapeHtml(kindLabel)}</strong><p>${escapeHtml(r.check.summary)}</p><ul>` +
        (r.check.details || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("") +
        `</ul>`;
    }
    researchMessages.push({ role: "system-note", content: kindLabel + "：" + r.check.summary });
    await persistResearchMessages();
    renderResearchMessages();
    renderResearchClaims();
  } catch (e) {
    $("research-hint").textContent = "核对失败：" + (e.message || e);
  }
}

function bindResearchDraftSplit() {
  const split = $("research-split");
  const expandBtn = $("btn-research-draft-expand");
  if (!split) return;
  expandBtn?.addEventListener("click", () => {
    const expanded = split.classList.toggle("research-draft-expanded");
    expandBtn.textContent = expanded ? "收起对话" : "展开编辑";
  });
}

function bindResearch() {
  bindResearchDraftSplit();
  const back = $("btn-research-back");
  if (back) back.addEventListener("click", showDoHub);
  $("btn-research-more")?.addEventListener("click", () => toggleResearchAdvanced(true));
  $("btn-research-advanced-close")?.addEventListener("click", () => toggleResearchAdvanced(false));
  $("research-advanced-backdrop")?.addEventListener("click", () => toggleResearchAdvanced(false));
  $("btn-research-save-current")?.addEventListener("click", saveCurrentDraft);
  $("btn-research-copy-draft")?.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(getCurrentDraftText());
    $("research-draft-progress").textContent = ok ? "已复制成果稿。" : "复制失败。";
  });
  $("btn-research-export-md")?.addEventListener("click", () => exportResearchInline("md"));
  $("btn-research-export-docx")?.addEventListener("click", () => exportResearchInline("docx"));
  $("rp-current-draft")?.addEventListener("input", () => {
    if ($("rp-current-draft")) $("rp-current-draft").dataset.userEditing = "1";
    updateResearchExportUi();
  });
  $("rp-current-draft")?.addEventListener("blur", () => {
    if ($("rp-current-draft")) delete $("rp-current-draft").dataset.userEditing;
  });
  $("btn-research-new")?.addEventListener("click", async () => {
    if ($("rp-proposition")) $("rp-proposition").value = "";
    await createResearchProject();
  });
  $("btn-rp-save-prop")?.addEventListener("click", saveResearchProposition);
  $("btn-rp-add-mat")?.addEventListener("click", async () => {
    if (!activeResearch) {
      showResearchMatFeedback("请先在左侧打开或开始一项研究。");
      return;
    }
    const title = $("rp-mat-title").value.trim();
    if (!title) {
      showResearchMatFeedback("请填写材料标题。");
      return;
    }
    try {
      activeResearch = await window.digitalMe.addResearchSource({
        id: activeResearch.id,
        source: {
          title,
          urlOrPath: $("rp-mat-source").value.trim(),
          excerpt: $("rp-mat-note").value.trim(),
        },
      });
      $("rp-mat-title").value = "";
      $("rp-mat-source").value = "";
      $("rp-mat-note").value = "";
      researchList = await window.digitalMe.listResearch();
      renderResearchWorkspace();
      syncResearchScenarioHint();
      showResearchMatFeedback(
        `已添加「${title}」。当前共 ${researchSources().length} 份参考材料。`
      );
    } catch (e) {
      showResearchMatFeedback("添加失败：" + (e.message || e));
    }
  });
  $("btn-rp-add-local")?.addEventListener("click", async () => {
    if (!activeResearch) {
      showResearchMatFeedback("请先在左侧打开或开始一项研究。");
      return;
    }
    try {
      const r = await window.digitalMe.addResearchLocalSource({ id: activeResearch.id });
      if (r.canceled) return;
      activeResearch = r.project;
      researchList = await window.digitalMe.listResearch();
      renderResearchWorkspace();
      syncResearchScenarioHint();
      showResearchMatFeedback(`已添加本地文件「${r.title}」。当前共 ${researchSources().length} 份。`);
    } catch (e) {
      showResearchMatFeedback(e.message || String(e));
    }
  });
  $("btn-research-mark-done")?.addEventListener("click", async () => {
    if (!activeResearch) return;
    await markResearchDone(!isResearchDone(activeResearch));
  });
  $("btn-research-claims-toggle")?.addEventListener("click", () => {
    researchClaimsOpen = !researchClaimsOpen;
    renderResearchClaimsInline();
  });
  $("btn-rp-save-draft")?.addEventListener("click", saveResearchDraft);
  $("btn-rp-export-writing")?.addEventListener("click", exportResearchToWriting);
  $("rp-draft-content")?.addEventListener("input", updateResearchExportUi);
  $("rp-current-draft")?.addEventListener("input", updateResearchExportUi);
  $("btn-research-send")?.addEventListener("click", sendResearch);
  $("btn-research-stop")?.addEventListener("click", async () => {
    if (researchRequestId) await window.digitalMe.stopChat({ requestId: researchRequestId });
  });
  $("btn-research-gen-draft")?.addEventListener("click", generateResearchStageBody);
  $("research-input")?.addEventListener("input", autosizeResearchInput);
  $("research-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendResearch();
    }
  });
  document.querySelectorAll("[data-research-check]").forEach((btn) => {
    btn.addEventListener("click", () => runResearchCheck(btn.dataset.researchCheck));
  });
  document.querySelectorAll("[data-research-prompt]").forEach((btn) => {
    btn.addEventListener("click", () => runResearchActionById(btn.dataset.researchPrompt));
  });
  autosizeResearchInput();
}

function bindDo() {
  renderDoSceneGrid();
  const back = $("btn-do-back");
  if (back) back.addEventListener("click", showDoHub);
  const backPh = $("btn-do-back-ph");
  if (backPh) backPh.addEventListener("click", showDoHub);
  const backCode = $("btn-do-back-code");
  if (backCode) backCode.addEventListener("click", showDoHub);
}

function bindCodeWorkspace() {
  const sendBtn = $("btn-code-send");
  if (!sendBtn) return;
  sendBtn.addEventListener("click", sendCode);
  $("btn-code-stop")?.addEventListener("click", async () => {
    if (codeStopBusy) return;
    if (!codeRequestId && !codeOperationId) return;
    codeStopBusy = true;
    const send = $("btn-code-send");
    const stop = $("btn-code-stop");
    if (send) send.disabled = true;
    if (stop) stop.disabled = true;
    const trail = $("code-trail");
    if (trail) {
      trail.classList.remove("hidden");
      trail.textContent = "正在停止…";
    }
    try {
      let oid = codeOperationId;
      if (!oid) {
        const deadline = Date.now() + 5000;
        while (!oid && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
          oid = codeOperationId;
        }
      }
      if (!oid) {
        if (trail) trail.textContent = "尚未取得停止凭据，无法停止外部执行。";
        return;
      }
      const result = await window.digitalMe.l0StopExternalAgent?.({ operationId: oid });
      if (!result || !result.ok) {
        const reason = result && result.reason;
        if (trail) {
          if (reason === "sender_mismatch") {
            trail.textContent = "停止失败：请求来源不匹配。";
          } else if (reason === "unknown_operation") {
            trail.textContent = "停止失败：任务已结束或不存在。";
          } else if (reason === "missing_operation_id") {
            trail.textContent = "停止失败：缺少主进程签发的操作编号。";
          } else {
            trail.textContent = "停止失败：未能发出停止请求。";
          }
        }
        return;
      }
      if (trail) trail.textContent = "已发出停止请求，正在等待回收结果…";
    } catch (e) {
      if (trail) trail.textContent = "停止失败：" + String((e && e.message) || e);
    }
  });
  $("btn-code-prepare")?.addEventListener("click", async () => {
    try {
      const prep = await window.digitalMe.prepareCodeScene?.();
      const el = $("code-prep-status");
      if (el) el.textContent = (prep && prep.message) || "已尝试准备。";
      await refreshCodeScenarioHint();
    } catch (e) {
      const el = $("code-prep-status");
      if (el) el.textContent = e.message || String(e);
    }
  });
  $("code-auth-write")?.addEventListener("change", () => refreshCodeScenarioHint());
  $("code-workspace-label")?.addEventListener("change", () => refreshCodeScenarioHint());
  $("code-executor-select")?.addEventListener("change", async () => {
    const id = $("code-executor-select")?.value || "builtin";
    try {
      await window.digitalMe.l0SetActiveAgent?.(id);
      await refreshCodeScenarioHint();
    } catch (e) {
      alert(e.message || String(e));
      await refreshCodeExecutorSelect();
    }
  });
  $("btn-code-audit-refresh")?.addEventListener("click", () => refreshCodeAuditList());
  const codeInput = $("code-input");
  codeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCode();
    }
  });
  $("btn-code-copy")?.addEventListener("click", async () => {
    const t = $("code-result")?.value || "";
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      const meta = $("code-result-meta");
      if (meta) meta.textContent = "已复制";
    } catch {
      /* ignore */
    }
  });
  $("btn-code-clear")?.addEventListener("click", () => {
    codeArtifacts = { files: [], links: [], notes: "" };
    if ($("code-result")) $("code-result").value = "";
    renderCodeArtifactLists();
    const meta = $("code-result-meta");
    if (meta) meta.textContent = "已清空";
  });
}

function autosizeWriteInput() {
  const el = $("write-input");
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(Math.max(el.scrollHeight, 120), 280);
  el.style.height = next + "px";
}

function bindWriteWorkspace() {
  const sendBtn = $("btn-write-send");
  if (!sendBtn) return;
  sendBtn.addEventListener("click", sendWrite);
  $("btn-write-stop").addEventListener("click", async () => {
    if (writeRequestId) await window.digitalMe.stopChat({ requestId: writeRequestId });
  });
  $("btn-write-attach").addEventListener("click", async () => {
    const files = await window.digitalMe.pickAttachments();
    if (!files?.length) return;
    writePendingAttachments = writePendingAttachments.concat(files);
    renderWriteAttachChips();
  });
  const writeInput = $("write-input");
  writeInput.addEventListener("input", autosizeWriteInput);
  writeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendWrite();
    }
  });
  autosizeWriteInput();
  document.querySelectorAll("#write-intent-chips button").forEach((btn) => {
    btn.addEventListener("click", () => {
      writeInput.value = btn.dataset.writeIntent || "";
      autosizeWriteInput();
      writeInput.focus();
    });
  });
}

function bindOutput() {
  $("btn-library-refresh")?.addEventListener("click", refreshLibraryView);
  $("btn-library-new-blank")?.addEventListener("click", async () => {
    try {
      await createBlankLibraryItem({ title: "未命名文稿" });
      $("library-detail-title-input")?.focus();
    } catch {
      // hint already set
    }
  });

  $("btn-library-save").addEventListener("click", async () => {
    if (!activeLibraryId) return;
    const prev = await window.digitalMe.getLibraryItem(activeLibraryId);
    if (!prev) return;
    const titleInput = $("library-detail-title-input");
    const title = (titleInput && titleInput.value.trim()) || prev.title;
    try {
      await window.digitalMe.saveLibraryItem({
        ...prev,
        title,
        content: $("library-detail-content").value,
        status: "ready",
      });
      $("library-detail-progress").textContent = "已保存。";
      if (linkedLibraryId === activeLibraryId) {
        currentArtifact = { title, content: $("library-detail-content").value, libraryId: activeLibraryId };
      }
      await refreshLibraryView();
    } catch (e) {
      $("library-detail-progress").textContent = "保存失败：" + e.message;
    }
  });

  $("btn-library-export-md").addEventListener("click", async () => {
    if (!activeLibraryId) return;
    const r = await window.digitalMe.exportLibraryItem({ id: activeLibraryId, format: "md" });
    if (!r.canceled) $("library-detail-progress").textContent = "已导出：" + r.filePath;
  });

  $("btn-library-export-docx").addEventListener("click", async () => {
    if (!activeLibraryId) return;
    try {
      const r = await window.digitalMe.exportLibraryItem({ id: activeLibraryId, format: "docx" });
      if (!r.canceled) $("library-detail-progress").textContent = "已导出：" + r.filePath;
    } catch (e) {
      $("library-detail-progress").textContent = "导出失败：" + e.message;
    }
  });

  $("btn-library-export-csv").addEventListener("click", async () => {
    if (!activeLibraryId) return;
    try {
      const r = await window.digitalMe.exportLibraryItem({ id: activeLibraryId, format: "csv" });
      if (!r.canceled) $("library-detail-progress").textContent = "已导出 CSV：" + r.filePath;
    } catch (e) {
      $("library-detail-progress").textContent = "导出 CSV 失败：" + e.message;
    }
  });

  $("btn-library-more-export")?.addEventListener("click", () => {
    const box = $("library-more-export");
    if (box) box.classList.toggle("hidden");
  });

  $("btn-library-to-ppt").addEventListener("click", async () => {
    const titleInput = $("library-detail-title-input");
    const title = (titleInput && titleInput.value) || "演讲";
    const content = $("library-detail-content").value;
    await generatePptFromDocument(title, content);
  });

  $("btn-library-delete").addEventListener("click", async () => {
    if (!activeLibraryId) return;
    if (!window.confirm("确定删除这篇文稿？")) return;
    const deletedId = activeLibraryId;
    await window.digitalMe.deleteLibraryItem(deletedId);
    if (linkedLibraryId === deletedId) linkedLibraryId = null;
    activeLibraryId = null;
    delete writeHistoryByDoc[deletedId];
    writeHistory = [];
    $("library-detail").classList.add("hidden");
    const empty = $("library-detail-empty");
    if (empty) empty.classList.remove("hidden");
    await refreshLibraryView();
    renderWriteMessages();
    updateArtifactLibraryButtons();
  });

  $("btn-ppt-hide").addEventListener("click", () => $("ppt-panel").classList.add("hidden"));

  $("btn-ppt-plan").addEventListener("click", async () => {
    const topic = $("ppt-topic").value.trim();
    if (!topic) {
      $("ppt-progress").textContent = "请填写演讲主题。";
      return;
    }
    const brief = {
      topic,
      occasion: $("ppt-occasion").value.trim(),
      duration: $("ppt-duration").value.trim(),
      audience: $("ppt-audience").value.trim(),
      keyPoints: $("ppt-keypoints").value.trim(),
      context: $("ppt-context").value.trim(),
    };
    $("btn-ppt-plan").disabled = true;
    $("btn-ppt-export").disabled = true;
    $("ppt-progress").textContent = "正在按你的 Digital Me 规划幻灯片结构…";
    $("ppt-preview").classList.add("hidden");
    try {
      pptPlan = await window.digitalMe.planPpt({ pkg, brief });
      renderPptPreview(pptPlan);
      $("ppt-progress").textContent = `已生成「${pptPlan.title}」，共 ${pptPlan.slides.length} 页内容。可预览后导出 PPTX。`;
      $("btn-ppt-export").disabled = false;
    } catch (e) {
      $("ppt-progress").textContent = "生成失败：" + e.message;
      pptPlan = null;
    } finally {
      $("btn-ppt-plan").disabled = false;
    }
  });

  $("btn-ppt-export").addEventListener("click", async () => {
    if (!pptPlan) return;
    $("btn-ppt-export").disabled = true;
    try {
      const r = await window.digitalMe.savePpt(pptPlan);
      if (r.canceled) {
        $("ppt-progress").textContent = "已取消保存。";
      } else {
        $("ppt-progress").textContent = `已保存：${r.filePath}（${r.slideCount} 页内容 + 封面/结束页）`;
      }
    } catch (e) {
      $("ppt-progress").textContent = "导出失败：" + e.message;
    } finally {
      $("btn-ppt-export").disabled = !pptPlan;
    }
  });

  $("btn-ppt-import-chat").addEventListener("click", () => {
    const parts = [];
    for (let i = history.length - 1; i >= 0 && parts.length < 2; i--) {
      const m = history[i];
      if (m.role === "assistant" && m.content && m.content.length > 80) {
        parts.unshift(m.content.slice(0, 3000));
      }
    }
    if (!parts.length) {
      $("ppt-progress").textContent = "对话中暂无可用内容，请先生成提纲或正文。";
      return;
    }
    $("ppt-context").value = parts.join("\n\n---\n\n");
    $("ppt-progress").textContent = "已从最近对话导入背景，可补充主题后点击「生成幻灯片结构」。";
  });
}

function renderPptPreview(plan) {
  const esc = (s) => String(s).replace(/</g, "&lt;");
  let html = `<div class="ppt-meta"><b>${esc(plan.title)}</b>`;
  if (plan.subtitle) html += `<br/><span class="muted">${esc(plan.subtitle)}</span>`;
  if (plan.meta) html += `<br/><span class="muted">${esc(plan.meta)}</span>`;
  html += `</div>`;
  for (let i = 0; i < plan.slides.length; i++) {
    const sl = plan.slides[i];
    html += `<div class="ppt-slide"><div class="ppt-slide-no">${i + 1}</div>`;
    html += `<h4>${esc(sl.title)}</h4><ul>`;
    for (const b of sl.bullets || []) html += `<li>${esc(b)}</li>`;
    html += `</ul>`;
    if (sl.notes) html += `<div class="ppt-notes">备注：${esc(sl.notes)}</div>`;
    html += `</div>`;
  }
  $("ppt-slide-count").textContent = String(plan.slides.length);
  $("ppt-preview-content").innerHTML = html;
  $("ppt-preview").classList.remove("hidden");
}

// ---------- Capability extensions ----------
let extensionsConfig = [];
let extensionsStatus = [];
let extensionsCatalog = null;
let activeExtensionId = null;
let activeCategory = "start";
let pendingEnableItem = null;

function bindExtensions() {
  $("btn-ext-refresh").addEventListener("click", refreshExtensionsView);
  $("btn-ext-save").addEventListener("click", saveExtensionsConfig);
  $("btn-ext-add").addEventListener("click", addExtensionFromForm);
  $("btn-ext-call").addEventListener("click", tryCallExtensionTool);
  $("btn-ext-enable-cancel").addEventListener("click", closeEnableModal);
  $("btn-ext-enable-confirm").addEventListener("click", confirmEnableExtension);
}

async function refreshExtensionsView() {
  try {
    extensionsCatalog = await window.digitalMe.getExtensionsCatalog();
    extensionsConfig = await window.digitalMe.getExtensionsConfig();
    extensionsStatus = await window.digitalMe.getExtensionsStatus();
    renderGuide();
    renderCategoryTabs();
    renderStore();
    renderAdvancedStore();
    renderExtensionsList();
    await refreshSkillZone();
  } catch (e) {
    $("ext-progress").textContent = "加载失败：" + e.message;
  }
}

async function refreshSkillZone() {
  wireSkillZoneCreateButtons();
  const boxes = {
    research: $("skill-zone-research"),
    write: $("skill-zone-write"),
    code: $("skill-zone-code"),
    other: $("skill-zone-other"),
  };
  if (!boxes.research || !boxes.write || !boxes.other) return;
  let all = [];
  try {
    all = await window.digitalMe.listSkills();
  } catch (e) {
    const prog = $("skill-zone-progress");
    if (prog) prog.textContent = "加载 Skill 失败：" + (e.message || e);
    return;
  }
  const buckets = { research: [], write: [], code: [], other: [] };
  for (const s of all) {
    const tags = s.sceneTags || [];
    if (tags.includes("code") && !tags.includes("write") && !tags.includes("research")) {
      buckets.code.push(s);
    } else if (tags.includes("research") && !tags.includes("write")) buckets.research.push(s);
    else if (tags.includes("write") && !tags.includes("research")) buckets.write.push(s);
    else if (tags.includes("research") && tags.includes("write")) {
      buckets.research.push(s);
      buckets.write.push(s);
    } else if (tags.includes("all") || !tags.length) buckets.other.push(s);
    else buckets.other.push(s);
  }
  const sceneLabel = (scene) =>
    scene === "research" ? "研究" : scene === "write" ? "写作" : scene === "code" ? "编程" : "";
  const paint = (box, items, scene) => {
    if (!box) return;
    box.innerHTML = "";
    if (!items.length) {
      box.innerHTML = `<div class="muted">暂无。可用上方「新建」，或等待系统预置。</div>`;
      return;
    }
    for (const s of items) {
      const row = document.createElement("div");
      row.className = "research-mat-row";
      const preset = s.preset ? " · 预置" : " · 自建";
      row.innerHTML =
        `<div class="library-row-title">${escapeHtml(s.title || "未命名")}</div>` +
        `<div class="library-row-meta">${escapeHtml((s.blurb || "").slice(0, 80))}${preset}</div>` +
        `<div class="skill-zone-row-actions"></div>`;
      const actions = row.querySelector(".skill-zone-row-actions");
      if (scene === "research" || scene === "write" || scene === "code") {
        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.className = "btn-ghost";
        useBtn.textContent = "引入到场景";
        useBtn.title = "写入该场景当前 Skill；场景页下拉会同步，并尝试准备推荐工具";
        useBtn.addEventListener("click", async () => {
          try {
            const setRes = await window.digitalMe.setActiveSkill({ scene, skillId: s.id });
            await refreshSkillBar(scene);
            const prog = $("skill-zone-progress");
            if (prog) {
              prog.textContent =
                `已引入到「${sceneLabel(scene)}」：「${s.title}」。` +
                (setRes && setRes.message ? " " + setRes.message : " 场景页下拉已同步。");
            }
          } catch (e) {
            const prog = $("skill-zone-progress");
            if (prog) prog.textContent = e.message || String(e);
          }
        });
        actions.appendChild(useBtn);
      }
      if (!s.preset) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-ghost";
        delBtn.textContent = "删除";
        delBtn.addEventListener("click", async () => {
          if (!window.confirm("删除 Skill「" + s.title + "」？")) return;
          try {
            await window.digitalMe.deleteSkill(s.id);
            await refreshSkillZone();
            await refreshSkillBar("research");
            await refreshSkillBar("write");
            await refreshSkillBar("code");
          } catch (e) {
            alert(e.message || e);
          }
        });
        actions.appendChild(delBtn);
      }
      box.appendChild(row);
    }
  };
  paint(boxes.research, buckets.research, "research");
  paint(boxes.write, buckets.write, "write");
  paint(boxes.code, buckets.code, "code");
  paint(boxes.other, buckets.other, null);
  const prog = $("skill-zone-progress");
  if (prog && !(prog.textContent || "").includes("启用") && !(prog.textContent || "").includes("引入")) {
    prog.textContent = `共 ${all.length} 个 Skill（按场景分类显示）。`;
  }
}

function renderGuide() {
  if (!extensionsCatalog?.guide) return;
  const g = extensionsCatalog.guide;
  $("ext-guide-title").textContent = g.title;
  $("ext-guide-steps").innerHTML = (g.steps || []).map((s) => `<li>${escHtml(s)}</li>`).join("");
  $("ext-guide-tips").innerHTML = (g.tips || []).map((s) => `<li>${escHtml(s)}</li>`).join("");
  $("ext-discover").innerHTML =
    `<div class="ext-discover-label">发现更多</div>` +
    (g.discover || [])
      .map(
        (d) =>
          `<a class="ext-discover-link" href="${escHtml(d.url)}" data-url="${escHtml(d.url)}">${escHtml(d.name)}</a>`
      )
      .join("");
  $("ext-discover").querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      // Electron: open externally via shell if available; fallback copy
      const url = a.dataset.url;
      if (url) window.digitalMe.openExternal(url);
    });
  });
}

function renderCategoryTabs() {
  if (!extensionsCatalog?.categories) return;
  $("ext-category-tabs").innerHTML = extensionsCatalog.categories
    .map(
      (c) =>
        `<button class="mode-tab${c.id === activeCategory ? " active" : ""}" data-cat="${escHtml(c.id)}" title="${escHtml(c.hint || "")}">${escHtml(c.label)}</button>`
    )
    .join("");
  $("ext-category-tabs").querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderCategoryTabs();
      renderStore();
    });
  });
}

function catalogItemsForCategory() {
  const items = extensionsCatalog?.generalItems || [];
  if (activeCategory === "start") {
    return items.filter((x) => x.category === "start" || x.recommended);
  }
  return items.filter((x) => x.category === activeCategory || (x.alsoIn || []).includes(activeCategory));
}

function findCatalogItem(id) {
  return (
    (extensionsCatalog?.items || []).find((x) => x.id === id) ||
    (extensionsCatalog?.generalItems || []).find((x) => x.id === id) ||
    (extensionsCatalog?.advancedItems || []).find((x) => x.id === id)
  );
}

function renderStoreCardHtml(item) {
  const advancedNote = item.advancedReason
    ? `<div class="ext-advanced-reason muted">需先准备：${escHtml(item.advancedReason)}</div>`
    : "";
  // Compact: name + one-line tagline + single enable action (enabled items are filtered out)
  return `<div class="ext-store-card ext-store-card-compact" data-id="${escHtml(item.id)}">
    <div class="ext-card-head">
      <div><b>${escHtml(item.name)}</b></div>
      <button class="btn-ext-enable" data-id="${escHtml(item.id)}">启用</button>
    </div>
    <div class="ext-tagline">${escHtml(item.tagline || "")}</div>
    ${advancedNote}
  </div>`;
}

function bindStoreCardActions(container) {
  if (!container) return;
  container.querySelectorAll(".btn-ext-enable").forEach((btn) => {
    btn.addEventListener("click", () => openEnableModal(btn.dataset.id));
  });
  container.querySelectorAll(".btn-ext-disable").forEach((btn) => {
    btn.addEventListener("click", () => disableExtension(btn.dataset.id));
  });
  container.querySelectorAll(".btn-ext-connect").forEach((btn) => {
    btn.addEventListener("click", () => connectExtension(btn.dataset.id));
  });
  container.querySelectorAll(".btn-ext-disconnect").forEach((btn) => {
    btn.addEventListener("click", () => disconnectExtension(btn.dataset.id));
  });
  container.querySelectorAll(".btn-ext-tools").forEach((btn) => {
    btn.addEventListener("click", () => showExtensionTools(btn.dataset.id));
  });
}

function renderStore() {
  // Only show not-yet-enabled items — avoid duplicating 「已武装」
  const items = catalogItemsForCategory().filter((it) => !it.enabled);
  if (!items.length) {
    $("ext-store").innerHTML = `<div class="muted">这一类都已启用。可到下方「已武装」管理连接，或换个分类看看。</div>`;
    return;
  }
  $("ext-store").innerHTML = items.map(renderStoreCardHtml).join("");
  bindStoreCardActions($("ext-store"));
}

function renderAdvancedStore() {
  const items = (extensionsCatalog?.advancedItems || []).filter((it) => !it.enabled);
  const el = $("ext-advanced-store");
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="muted">高级扩展均已启用，或暂无更多项。</div>`;
    return;
  }
  el.innerHTML = items.map(renderStoreCardHtml).join("");
  bindStoreCardActions(el);
}

function statusForId(id) {
  return extensionsStatus.find((s) => s.id === id) || { status: "disconnected", toolCount: 0 };
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderExtensionsList() {
  if (!extensionsConfig.length) {
    $("ext-list").innerHTML = `<div class="muted">还没有启用任何能力。从上方「可添加」点启用即可。</div>`;
    return;
  }
  $("ext-list").innerHTML = extensionsConfig
    .map((ext) => {
      const st = statusForId(ext.id);
      const cat = findCatalogItem(ext.catalogId || ext.id);
      const badge =
        st.status === "connected"
          ? `<span class="ext-badge ok">已连接</span>`
          : st.status === "error"
            ? `<span class="ext-badge err">连接失败</span>`
            : `<span class="ext-badge">未连接</span>`;
      const oneLiner = (cat && cat.tagline) || ext.note || "已启用，连接后可在对话中使用。";
      return `<div class="ext-card ext-card-compact" data-id="${escHtml(ext.id)}">
        <div class="ext-card-head">
          <div><b>${escHtml(ext.name || ext.id)}</b> ${badge}</div>
          <div class="ext-card-actions">
            ${
              st.status === "connected"
                ? `<button class="btn-ext-disconnect btn-ghost" data-id="${escHtml(ext.id)}">断开</button>`
                : `<button class="btn-ext-connect" data-id="${escHtml(ext.id)}">连接</button>`
            }
            <button class="btn-ext-tools btn-ghost" data-id="${escHtml(ext.id)}">工具</button>
            <button class="btn-ext-disable btn-ghost" data-id="${escHtml(ext.id)}">停用</button>
          </div>
        </div>
        <div class="ext-tagline muted">${escHtml(oneLiner)}</div>
      </div>`;
    })
    .join("");

  $("ext-list").querySelectorAll(".btn-ext-connect").forEach((btn) => {
    btn.addEventListener("click", () => connectExtension(btn.dataset.id));
  });
  $("ext-list").querySelectorAll(".btn-ext-disconnect").forEach((btn) => {
    btn.addEventListener("click", () => disconnectExtension(btn.dataset.id));
  });
  $("ext-list").querySelectorAll(".btn-ext-tools").forEach((btn) => {
    btn.addEventListener("click", () => showExtensionTools(btn.dataset.id));
  });
  $("ext-list").querySelectorAll(".btn-ext-disable").forEach((btn) => {
    btn.addEventListener("click", () => disableExtension(btn.dataset.id));
  });
}

function difficultyLabel(d) {
  if (d === "needs-key") return "需密钥";
  if (d === "advanced") return "进阶";
  return "易上手";
}

function openEnableModal(catalogId) {
  const item = findCatalogItem(catalogId);
  if (!item) return;
  pendingEnableItem = item;
  $("ext-enable-title").textContent = (item.audience === "advanced" ? "高级 · " : "启用 · ") + item.name;
  let desc = item.howToUse || item.tagline;
  if (item.audience === "advanced") {
    desc =
      "此扩展需要技术配置（如到第三方网站申请 API Key）。普通用户可跳过，使用上方推荐扩展。\n\n" +
      desc;
  }
  $("ext-enable-desc").textContent = desc;
  $("ext-enable-risk").textContent = item.risk ? "注意：" + item.risk : "";

  let fields = "";
  if (item.pathParam) {
    const def = item.defaultWorkspaceRoot || "";
    fields += `<label>${escHtml(item.pathParam.label || "路径")}
      <div class="ext-path-row">
        <input id="ext-enable-path" type="text" value="${escHtml(def)}" placeholder="${escHtml(item.pathParam.defaultHint || "")}" />
        <button type="button" id="btn-ext-pick-path" class="btn-ghost">浏览…</button>
      </div>
    </label>`;
  }
  for (const ek of item.envKeys || []) {
    fields += `<label>${escHtml(ek.label || ek.key)}
      <input id="ext-env-${escHtml(ek.key)}" type="password" placeholder="${escHtml(ek.placeholder || "")}" />
      ${ek.helpUrl ? `<a class="ext-key-help" href="${escHtml(ek.helpUrl)}" data-url="${escHtml(ek.helpUrl)}">如何获取 →</a>` : ""}
    </label>`;
  }
  if (!fields) {
    fields = `<p class="muted">无需额外配置，确认后即可启用。</p>`;
  }
  $("ext-enable-fields").innerHTML = fields;

  const pickBtn = $("btn-ext-pick-path");
  if (pickBtn) {
    pickBtn.addEventListener("click", async () => {
      const isDb = item.pathParam?.key === "dbPath";
      const p = isDb
        ? await window.digitalMe.pickExtensionFile()
        : await window.digitalMe.pickExtensionDirectory();
      if (p) $("ext-enable-path").value = p;
    });
  }
  $("ext-enable-fields").querySelectorAll("a.ext-key-help").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (a.dataset.url) window.digitalMe.openExternal(a.dataset.url);
    });
  });

  $("ext-enable-modal").classList.remove("hidden");
}

function closeEnableModal() {
  $("ext-enable-modal").classList.add("hidden");
  pendingEnableItem = null;
}

async function confirmEnableExtension() {
  if (!pendingEnableItem) return;
  const item = pendingEnableItem;
  const params = {};
  const env = {};
  if (item.pathParam) {
    const pathVal = ($("ext-enable-path")?.value || "").trim();
    params[item.pathParam.key] = pathVal;
  }
  for (const ek of item.envKeys || []) {
    const el = $("ext-env-" + ek.key);
    if (el) env[ek.key] = el.value.trim();
  }
  $("btn-ext-enable-confirm").disabled = true;
  try {
    await window.digitalMe.enableExtension({ catalogId: item.id, params, env });
    closeEnableModal();
    $("ext-progress").textContent = `已启用「${item.name}」，正在自动连接…（首次可能需下载，请稍候）`;
    await refreshExtensionsView();
    try {
      const r = await window.digitalMe.connectExtension(item.id);
      $("ext-progress").textContent = `「${item.name}」已就绪，共 ${(r.tools || []).length} 个工具。可点「查看工具」试用。`;
      await refreshExtensionsView();
      await renderCapabilitiesStatus();
    } catch (ce) {
      $("ext-progress").textContent =
        `「${item.name}」已启用，但自动连接未成功：${ce.message}\n可稍后点「连接」重试。`;
      await refreshExtensionsView();
    }
  } catch (e) {
    $("ext-progress").textContent = "启用失败：" + e.message;
    alert("启用失败：" + e.message);
  } finally {
    $("btn-ext-enable-confirm").disabled = false;
  }
}

async function disableExtension(id) {
  try {
    await window.digitalMe.disableExtension(id);
    if (activeExtensionId === id) {
      activeExtensionId = null;
      $("ext-tools-panel").classList.add("hidden");
    }
    $("ext-progress").textContent = `已停用「${id}」。`;
    await refreshExtensionsView();
  } catch (e) {
    $("ext-progress").textContent = "停用失败：" + e.message;
  }
}

async function saveExtensionsConfig() {
  $("btn-ext-save").disabled = true;
  try {
    extensionsConfig = await window.digitalMe.saveExtensionsConfig(extensionsConfig);
    $("ext-progress").textContent = "配置已保存到本机。";
    await refreshExtensionsView();
  } catch (e) {
    $("ext-progress").textContent = "保存失败：" + e.message;
  } finally {
    $("btn-ext-save").disabled = false;
  }
}

function addExtensionFromForm() {
  const id = $("ext-new-id").value.trim();
  if (!id) {
    $("ext-progress").textContent = "请填写扩展 id。";
    return;
  }
  if (extensionsConfig.some((e) => e.id === id)) {
    $("ext-progress").textContent = "该 id 已存在。";
    return;
  }
  const args = $("ext-new-args").value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  extensionsConfig.push({
    id,
    name: $("ext-new-name").value.trim() || id,
    command: $("ext-new-command").value.trim() || "npx",
    args,
    note: $("ext-new-note").value.trim() || undefined,
  });
  $("ext-new-id").value = "";
  $("ext-new-name").value = "";
  $("ext-new-args").value = "";
  $("ext-new-note").value = "";
  renderExtensionsList();
  $("ext-progress").textContent = `已添加「${id}」，请点「保存配置」写入本机。`;
}

async function connectExtension(id) {
  $("ext-progress").textContent = `正在连接「${id}」…（首次可能需下载扩展包，请稍候）`;
  try {
    const r = await window.digitalMe.connectExtension(id);
    $("ext-progress").textContent = `「${id}」已连接，共 ${(r.tools || []).length} 个工具。`;
    await refreshExtensionsView();
    await renderCapabilitiesStatus();
  } catch (e) {
    $("ext-progress").textContent = `连接失败：${e.message}`;
    await refreshExtensionsView();
  }
}

async function disconnectExtension(id) {
  try {
    await window.digitalMe.disconnectExtension(id);
    if (activeExtensionId === id) {
      activeExtensionId = null;
      $("ext-tools-panel").classList.add("hidden");
    }
    $("ext-progress").textContent = `「${id}」已断开。`;
    await refreshExtensionsView();
    await renderCapabilitiesStatus();
  } catch (e) {
    $("ext-progress").textContent = `断开失败：${e.message}`;
  }
}

async function showExtensionTools(id) {
  const st = statusForId(id);
  if (st.status !== "connected") {
    $("ext-progress").textContent = `请先连接「${id}」。`;
    return;
  }
  try {
    const tools = await window.digitalMe.listExtensionTools(id);
    activeExtensionId = id;
    const ext = extensionsConfig.find((e) => e.id === id);
    $("ext-tools-title").textContent = ext?.name || id;
    $("ext-tools-list").innerHTML = tools.length
      ? `<ul>${tools.map((t) => `<li><b>${escHtml(t.name)}</b>${t.description ? ` — ${escHtml(t.description)}` : ""}</li>`).join("")}</ul>`
      : `<div class="muted">（无工具）</div>`;
    const sel = $("ext-tool-select");
    sel.innerHTML = tools.map((t) => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join("");
    $("ext-tool-args").value = "{}";
    $("ext-call-result").textContent = "";
    $("ext-tools-panel").classList.remove("hidden");
  } catch (e) {
    $("ext-progress").textContent = `获取工具列表失败：${e.message}`;
  }
}

async function tryCallExtensionTool() {
  if (!activeExtensionId) return;
  const name = $("ext-tool-select").value;
  let args = {};
  const raw = $("ext-tool-args").value.trim() || "{}";
  try {
    args = JSON.parse(raw);
  } catch {
    $("ext-call-result").textContent = "参数 JSON 格式无效。";
    return;
  }
  $("btn-ext-call").disabled = true;
  $("ext-call-result").textContent = "调用中…";
  try {
    const result = await window.digitalMe.callExtensionTool({
      id: activeExtensionId,
      name,
      args,
    });
    $("ext-call-result").textContent = JSON.stringify(result, null, 2);
  } catch (e) {
    $("ext-call-result").textContent = "调用失败：" + e.message;
  } finally {
    $("btn-ext-call").disabled = false;
  }
}

// ---------- Me column / timeline / boundaries ----------
let lifeGraphCache = null;
let meActiveTab = "overview";
let boundariesCache = null;

const BOUNDARY_SCOPE_LABELS = {
  never_speak_for_me: "不代你表态",
  never_inject: "不注入对话",
  never_export: "不随导出",
};

function switchMeTab(tab) {
  meActiveTab = tab;
  if (meLane !== "self") switchMeLane("self");
  document.querySelectorAll("#me-tabs .mode-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.meTab === tab);
  });
  ["overview", "cognition", "timeline", "roles", "mind", "boundaries"].forEach((name) => {
    const el = $("me-panel-" + name);
    if (el) el.classList.toggle("hidden", name !== tab);
  });
  if (tab === "cognition") refreshCognitionPanel();
  if (tab === "mind") renderMindPersonaPreview();
}

function renderMindPersonaPreview() {
  const el = $("mind-persona-preview");
  if (!el) return;
  const text = (pkg && pkg.persona && String(pkg.persona).trim()) || "";
  if (!text) {
    el.innerHTML = `<p class="muted">尚无观念正文。请到「构建」投材料、填问卷或智能构建。</p>`;
    return;
  }
  const preview = text.length > 1200 ? text.slice(0, 1200) + "…" : text;
  el.innerHTML = `<pre class="mind-preview-pre">${escapeHtml(preview)}</pre>`;
}

function renderCoverageGaps(el, gaps) {
  if (!el) return;
  if (!gaps || !gaps.length) {
    el.innerHTML = `<p class="muted coverage-gaps-ok">覆盖较均衡。继续到「构建」投材料并智能构建即可加深。</p>`;
    return;
  }
  el.innerHTML =
    `<h4 class="cog-sub">下一步（少选择）</h4>` +
    `<ul class="coverage-gap-list">` +
    gaps
      .map((g) => {
        const goLabel =
          g.actionTab === "build" || g.actionTab === "inbox"
            ? "去构建"
            : g.id === "gap_hooks"
              ? "去写入"
              : "查看";
        return (
          `<li class="coverage-gap-item">` +
          `<div><b>${escapeHtml(g.title)}</b> <span class="muted">${escapeHtml(g.layer)}</span>` +
          `<div class="muted">${escapeHtml(g.hint)}</div></div>` +
          `<button type="button" class="btn-ghost gap-go" data-tab="${escapeHtml(
            g.actionTab || "build"
          )}">${goLabel}</button>` +
          `</li>`
        );
      })
      .join("") +
    `</ul>`;
  el.querySelectorAll(".gap-go").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab || "build";
      if (tab === "build" || tab === "inbox") goBuildView();
      else goSelfView(tab);
    });
  });
}

const CAPABILITY_STATUS_LABEL = {
  available: "可用",
  limited: "受限",
  experimental: "实验中",
  unavailable: "不可用",
  unknown: "未知",
};

/** Prefer main-process userStatusLabel; never invent maturity from legacy labels. */
function capabilityMaturityLabel(cap) {
  if (cap && typeof cap.userStatusLabel === "string" && cap.userStatusLabel) {
    return cap.userStatusLabel;
  }
  return "尚未开放";
}

const HEALTH_STATUS_LABEL = {
  healthy: "正常",
  unhealthy: "需关注",
  missing: "缺失",
  limited: "部分可用",
  unversioned: "未版本化",
};

function setSafeText(el, text) {
  if (!el) return;
  el.textContent = text == null ? "" : String(text);
}

function clearChildren(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Layer count labeling invariant (known →「N 条」, partial →「至少 N 条」).
 * PAN-01S moved home stats walls off the default 「我」 entry; this helper
 * remains for any detail/future layer rendering that still surfaces counts.
 */
function formatLayerCountLabel(layer) {
  if (!layer || typeof layer !== "object") return "尚无法确认";
  if (layer.countStatus === "known" && typeof layer.count === "number") {
    return `${layer.count} 条`;
  }
  if (layer.countStatus === "partial" && typeof layer.count === "number") {
    return `至少 ${layer.count} 条`;
  }
  return "尚无法确认";
}

/** Render subject layer cards when a layers container is present (detail/future). */
function renderSubjectLayerCards(layersEl, layers) {
  if (!layersEl) return;
  clearChildren(layersEl);
  for (const layer of layers || []) {
    const card = document.createElement("div");
    card.className = `subject-layer-card ${layer.visualClass || ""}`;
    const head = document.createElement("div");
    head.className = "subject-layer-head";
    const title = document.createElement("strong");
    setSafeText(title, layer.userLabel || layer.kind);
    const count = document.createElement("span");
    count.className = "subject-layer-count";
    setSafeText(count, formatLayerCountLabel(layer));
    head.appendChild(title);
    head.appendChild(count);
    const expl = document.createElement("p");
    expl.className = "muted subject-layer-expl";
    setSafeText(expl, layer.explanation || "");
    card.appendChild(head);
    card.appendChild(expl);
    layersEl.appendChild(card);
  }
}

function appendMetaRow(container, label, value) {
  if (!container) return;
  const row = document.createElement("div");
  row.className = "subject-meta-row";
  const lab = document.createElement("span");
  lab.className = "subject-meta-label";
  setSafeText(lab, label);
  const val = document.createElement("strong");
  setSafeText(val, value);
  row.appendChild(lab);
  row.appendChild(val);
  container.appendChild(row);
}

async function refreshSubjectHome() {
  const titleEl = $("subject-home-title");
  if (!titleEl || !window.digitalMe.getSubjectOverview) return;
  setSafeText(titleEl, "我的 Digital Me");
  const summaryEl = $("subject-minimal-summary");
  if (summaryEl) {
    clearChildren(summaryEl);
    const s1 = document.createElement("span");
    s1.className = "subject-minimal-line1";
    setSafeText(s1, SUBJECT_IDENTITY_LINE_UI);
    summaryEl.appendChild(s1);
    const s2 = document.createElement("span");
    s2.className = "subject-minimal-line2";
    setSafeText(s2, "正在了解当前状态…");
    summaryEl.appendChild(s2);
  }
  const actionsEl = $("subject-minimal-actions");
  if (actionsEl) clearChildren(actionsEl);
  try {
    const overview = await window.digitalMe.getSubjectOverview();
    const panorama = overview.panorama || null;
    // Only render main-process minimalSurface; never recompute P0-P4 in renderer.
    renderMinimalSurface(panorama && panorama.minimalSurface);
    if (panorama && panorama.buildFlow) lastBuildFlow = panorama.buildFlow;
    // Home walls are gone; wire count labeling only if a layers container still exists.
    renderSubjectLayerCards($("subject-home-layers"), overview.layers);
  } catch (e) {
    renderMinimalSurface({
      subjectName: "我的 Digital Me",
      summary: `${SUBJECT_IDENTITY_LINE_UI}\n当前状态无法确认。`,
      primaryAction: null,
      primaryActionLabel: null,
      primaryNavTarget: null,
      secondaryAction: null,
      reminder: null,
      priority: null,
      failClosed: true,
    });
  }
}

function renderMeOverview() {
  refreshSubjectHome();
}

function coverageBar(label, filled, totalHint) {
  const pct = filled ? Math.min(100, filled === true ? 70 : Math.min(100, Number(filled) * 12 + 20)) : 8;
  const value = filled === true ? "有" : filled === false ? "无" : String(filled);
  return (
    `<div class="me-stat cognition-cov">` +
    `<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>` +
    `<div class="cov-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>` +
    (totalHint ? `<span class="muted" style="font-size:11px">${escapeHtml(totalHint)}</span>` : "") +
    `</div>`
  );
}

async function refreshCognitionPanel() {
  const msg = $("cognition-msg");
  try {
    const snap = await window.digitalMe.getCognition();
    const c = snap.coverage || {};
    $("cognition-coverage").innerHTML =
      coverageBar("观念层", c.mind, c.mind ? "人格/框架/记忆" : "待丰富") +
      coverageBar("人生事件", c.events) +
      coverageBar("成就", c.outcomes) +
      coverageBar("机构触点", c.orgTouchpoints) +
      coverageBar("已确认关系人", c.people) +
      coverageBar("低把握推断", c.openInferences) +
      coverageBar("待写入观念线索", c.mindHooks) +
      coverageBar("能力线索", c.capabilities);

    renderCoverageGaps($("cognition-gaps"), snap.gaps || []);
    renderCoverageGaps($("me-coverage-gaps"), snap.gaps || []);

    const recent = snap.recentAuto || {};
    const recentCard = $("cognition-recent-card");
    const recentEl = $("cognition-recent");
    const recentInf = recent.inferences || [];
    const recentPpl = recent.people || [];
    const recentOut = recent.outcomes || [];
    if (recentCard && recentEl) {
      if (!recentInf.length && !recentPpl.length && !recentOut.length) {
        recentCard.classList.add("hidden");
        recentEl.innerHTML = "";
      } else {
        recentCard.classList.remove("hidden");
        let html = "";
        if (recentInf.length) {
          html += `<h4 class="cog-sub">自动确认的推断</h4>`;
          html += recentInf
            .map(
              (inf) =>
                `<div class="cog-manage-row">` +
                `<div class="cog-manage-main"><span class="muted">[${escapeHtml(
                  inf.type || ""
                )}]</span> ${escapeHtml(inf.claim)}</div>` +
                `<div class="cog-manage-actions">` +
                `<button type="button" class="btn-ghost recent-inf-reject" data-id="${escapeHtml(
                  inf.id
                )}">撤销</button>` +
                `</div></div>`
            )
            .join("");
        }
        if (recentPpl.length) {
          html += `<h4 class="cog-sub">自动确认的关系人</h4>`;
          html += recentPpl
            .map(
              (p) =>
                `<div class="cog-manage-row">` +
                `<div class="cog-manage-main"><b>${escapeHtml(p.name)}</b> · ${escapeHtml(
                  p.relationType || ""
                )}</div>` +
                `<div class="cog-manage-actions">` +
                `<button type="button" class="btn-ghost recent-ppl-reject" data-id="${escapeHtml(
                  p.id
                )}">撤销</button>` +
                `</div></div>`
            )
            .join("");
        }
        if (recentOut.length) {
          html += `<h4 class="cog-sub">最近成就</h4>`;
          html +=
            "<ul>" +
            recentOut
              .map(
                (o) =>
                  `<li>${escapeHtml(o.title || "")}${
                    o.when ? ` <span class="muted">${escapeHtml(o.when)}</span>` : ""
                  }</li>`
              )
              .join("") +
            "</ul>";
        }
        recentEl.innerHTML = html;
        recentEl.querySelectorAll(".recent-inf-reject").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await window.digitalMe.updateInference({ id: btn.dataset.id, status: "rejected" });
            await refreshCognitionPanel();
          });
        });
        recentEl.querySelectorAll(".recent-ppl-reject").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await window.digitalMe.updatePersonStatus({ id: btn.dataset.id, status: "rejected" });
            await refreshCognitionPanel();
          });
        });
      }
    }

    const openInfList = (snap.inferences && snap.inferences.open) || [];
    const confInf = (snap.inferences && snap.inferences.confirmed) || [];
    const infEl = $("cognition-inferences");
    if (infEl) {
      if (!openInfList.length && !confInf.length) {
        infEl.innerHTML =
          `<p class="muted">暂无低把握推断。中高把握会在「智能构建」时自动采纳。</p>`;
      } else {
        let html = "";
        if (openInfList.length) {
          html += openInfList
            .slice(0, 30)
            .map(
              (inf) =>
                `<div class="cog-manage-row inf-edit-row" data-inf-id="${escapeHtml(inf.id)}">` +
                `<div class="cog-manage-main">` +
                `<span class="muted">[${escapeHtml(inf.type || "")}]</span>` +
                `<input type="text" class="inf-claim-input" data-id="${escapeHtml(
                  inf.id
                )}" value="${escapeHtml(inf.claim)}" />` +
                (inf.basedOn
                  ? `<div class="muted" style="font-size:12px">依据：${escapeHtml(inf.basedOn)}</div>`
                  : "") +
                `</div>` +
                `<div class="cog-manage-actions">` +
                `<button type="button" class="btn-ghost inf-confirm" data-id="${escapeHtml(inf.id)}">确认</button>` +
                `<button type="button" class="btn-ghost inf-save" data-id="${escapeHtml(inf.id)}">改正并确认</button>` +
                `<button type="button" class="btn-ghost inf-reject" data-id="${escapeHtml(inf.id)}">驳回</button>` +
                `</div></div>`
            )
            .join("");
        }
        if (confInf.length) {
          html += `<h4 class="cog-sub">已确认（${confInf.length}）</h4><ul>`;
          html += confInf
            .slice(0, 12)
            .map((inf) => `<li>${escapeHtml(inf.claim)}</li>`)
            .join("");
          html += `</ul>`;
        }
        infEl.innerHTML = html;
        infEl.querySelectorAll(".inf-confirm").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await window.digitalMe.updateInference({ id: btn.dataset.id, status: "confirmed" });
            await refreshCognitionPanel();
          });
        });
        infEl.querySelectorAll(".inf-reject").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await window.digitalMe.updateInference({ id: btn.dataset.id, status: "rejected" });
            await refreshCognitionPanel();
          });
        });
        infEl.querySelectorAll(".inf-save").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const input = infEl.querySelector(`.inf-claim-input[data-id="${btn.dataset.id}"]`);
            const next = input ? String(input.value || "").trim() : "";
            if (!next) return;
            await window.digitalMe.updateInference({
              id: btn.dataset.id,
              claim: next,
              status: "confirmed",
            });
            await refreshCognitionPanel();
          });
        });
      }
    }

    const mind = snap.mind || {};
    const mindBits = [];
    if (mind.personaPreview)
      mindBits.push(
        `<p>${escapeHtml(mind.personaPreview)}${mind.personaPreview.length >= 400 ? "…" : ""}</p>`
      );
    mindBits.push(
      `<p class="muted">判断框架 ${mind.frameworkCount || 0} · 长期记忆 ${mind.memoryCount || 0}</p>`
    );
    if ((mind.hooks || []).length) {
      mindBits.push(
        "<ul>" +
          mind.hooks
            .slice(0, 8)
            .map(
              (h) =>
                `<li>${escapeHtml(h.text)} <span class="muted">${
                  h.status === "in_review" ? "审阅中" : "待蒸馏"
                }</span></li>`
            )
            .join("") +
          "</ul>"
      );
    }
    if (!mindBits.length || (!mind.personaPreview && !(mind.hooks || []).length && !mind.frameworkCount)) {
      $("cognition-mind").innerHTML =
        `<p class="muted">尚无观念切片。投材料后用「智能构建」，或点「一键写入观念线索」。</p>`;
    } else {
      $("cognition-mind").innerHTML = mindBits.join("");
    }
    const hasHooks = !!(mind.hooks && mind.hooks.length);
    const distillBtn = $("btn-distill-mind-hooks");
    const reviewBtn = $("btn-distill-mind-hooks-review");
    if (distillBtn) distillBtn.disabled = !hasHooks;
    if (reviewBtn) reviewBtn.disabled = !hasHooks;

    const ach = snap.achievements || [];
    if (!ach.length) {
      $("cognition-achievements").innerHTML =
        `<p class="muted">尚无成就记录。投成果类材料后用「智能构建」即可写入。</p>`;
    } else {
      $("cognition-achievements").innerHTML =
        `<div class="cognition-bars">` +
        ach
          .slice(0, 12)
          .map((o, idx) => {
            const w = Math.max(28, 100 - idx * 6);
            return (
              `<div class="cog-bar-row"><span>${escapeHtml(o.title || "")}${
                o.when ? ` <span class="muted">${escapeHtml(o.when)}</span>` : ""
              }</span><i style="width:${w}%"></i></div>`
            );
          })
          .join("") +
        `</div>` +
        `<div class="builder-actions" style="margin-top:10px">` +
        `<button type="button" class="btn-ghost" id="btn-achievements-to-timeline">在时间线校对</button>` +
        `</div>`;
      const toTl = $("btn-achievements-to-timeline");
      if (toTl) toTl.addEventListener("click", () => switchMeTab("timeline"));
    }

    const social = snap.social || {};
    const people = social.people || [];
    const orgs = social.orgTouchpoints || [];
    let socialHtml = "";
    const candidates = people.filter((p) => (p.status || "candidate") === "candidate");
    const confirmedPpl = people.filter((p) => p.status === "confirmed");
    socialHtml += `<h4 class="cog-sub">关系人候选（优先校对）</h4>`;
    if (!candidates.length) {
      socialHtml += `<p class="muted">暂无候选。下方可手动添加。</p>`;
    } else {
      socialHtml += candidates
        .slice(0, 20)
        .map((p) => {
          return (
            `<div class="cog-manage-row">` +
            `<div class="cog-manage-main"><b>${escapeHtml(p.name)}</b> · ${escapeHtml(p.relationType || "")}` +
            ` <span class="muted">[候选]</span></div>` +
            `<div class="cog-manage-actions">` +
            `<button type="button" class="btn-ghost ppl-confirm" data-id="${escapeHtml(p.id)}">确认</button>` +
            `<button type="button" class="btn-ghost ppl-reject" data-id="${escapeHtml(p.id)}">驳回</button>` +
            `</div></div>`
          );
        })
        .join("");
    }
    if (confirmedPpl.length) {
      socialHtml += `<h4 class="cog-sub">已确认关系人（${confirmedPpl.length}）</h4>`;
      socialHtml += confirmedPpl
        .slice(0, 12)
        .map(
          (p) =>
            `<div class="cog-manage-row">` +
            `<div class="cog-manage-main"><b>${escapeHtml(p.name)}</b> · ${escapeHtml(p.relationType || "")}</div>` +
            `<div class="cog-manage-actions">` +
            `<button type="button" class="btn-ghost ppl-reject" data-id="${escapeHtml(p.id)}">撤销</button>` +
            `</div></div>`
        )
        .join("");
    }
    socialHtml += `<h4 class="cog-sub">机构触点</h4>`;
    if (!orgs.length) {
      socialHtml += `<p class="muted">尚无机构触点（雇主/主办方/协会等，不等于人际关系）。</p>`;
    } else {
      socialHtml +=
        `<div class="cog-chips">` +
        orgs
          .slice(0, 24)
          .map(
            (o) =>
              `<span class="cog-chip">${escapeHtml(o.org)}${o.kind ? ` · ${escapeHtml(o.kind)}` : ""}</span>`
          )
          .join("") +
        `</div>` +
        `<div class="builder-actions" style="margin-top:8px">` +
        `<button type="button" class="btn-ghost" id="btn-orgs-to-timeline">在时间线查看关联事件</button>` +
        `</div>`;
    }
    $("cognition-social").innerHTML = socialHtml;
    $("cognition-social").querySelectorAll(".ppl-confirm").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await window.digitalMe.updatePersonStatus({ id: btn.dataset.id, status: "confirmed" });
        await refreshCognitionPanel();
      });
    });
    $("cognition-social").querySelectorAll(".ppl-reject").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await window.digitalMe.updatePersonStatus({ id: btn.dataset.id, status: "rejected" });
        await refreshCognitionPanel();
      });
    });
    const orgTl = $("btn-orgs-to-timeline");
    if (orgTl) orgTl.addEventListener("click", () => switchMeTab("timeline"));

    const cap = snap.capability || {};
    const signals = cap.signals || [];
    const domains = cap.domains || [];
    const bounds = snap.boundaries || [];
    let capHtml = "";
    if (domains.length) {
      capHtml +=
        `<div class="cog-chips">` +
        domains.map((d) => `<span class="cog-chip">${escapeHtml(d.title)}</span>`).join("") +
        `</div>`;
    }
    if (signals.length) {
      capHtml +=
        "<ul>" +
        signals
          .slice(0, 12)
          .map(
            (s) =>
              `<li><span class="muted">[${escapeHtml(s.polarity)}]</span> ${escapeHtml(s.signal)}</li>`
          )
          .join("") +
        "</ul>";
    }
    if (bounds.length) {
      capHtml += `<h4 class="cog-sub">表达禁区（已启用）</h4><ul>`;
      capHtml += bounds
        .slice(0, 8)
        .map((b) => `<li>${escapeHtml(b.text || b.id)}</li>`)
        .join("");
      capHtml += "</ul>";
    }
    if (!capHtml) {
      capHtml =
        `<p class="muted">尚无能力边界线索。材料中的「擅长/不负责」表述确认后会显示；禁区见「边界」页。</p>`;
    }
    $("cognition-capability").innerHTML = capHtml;
    if (msg && !msg.dataset.keep) msg.textContent = "";
  } catch (e) {
    if (msg) msg.textContent = "加载认知面板失败：" + (e.message || e);
  }
}


function openLifeEditor(ev) {
  $("life-event-editor").classList.remove("hidden");
  $("life-editor-title").textContent = ev && ev.id ? "编辑事件" : "在轴上添加";
  $("life-edit-id").value = (ev && ev.id) || "";
  $("life-edit-when").value = (ev && ev.when) || "";
  $("life-edit-what").value = (ev && ev.what) || "";
  $("life-edit-roles").value = ((ev && ev.roleLabels) || []).join("，");
  $("life-edit-org").value = (ev && ev.org) || "";
  $("life-edit-outcome").value = (ev && ev.outcome) || "";
  $("life-editor-msg").textContent = "";
  $("btn-life-delete").classList.toggle("hidden", !(ev && ev.id));
}

function renderLifeTimeline(events) {
  const list = $("life-timeline-list");
  const empty = $("life-timeline-empty");
  list.innerHTML = "";
  if (!events || !events.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const ev of events) {
    const row = document.createElement("div");
    row.className = "life-axis-item";
    const when = ev.when || "时间未注明";
    const roles = (ev.roleLabels || []).join(" · ");
    const org = ev.org ? ` · ${ev.org}` : "";
    row.innerHTML =
      `<div class="life-axis-dot" aria-hidden="true"></div>` +
      `<div class="life-axis-card">` +
      `<div class="life-event-when">${escapeHtml(when)}</div>` +
      `<div class="life-event-what">${escapeHtml(ev.what || "")}</div>` +
      (roles || org ? `<div class="life-event-meta">${escapeHtml(roles + org)}</div>` : "") +
      `<button type="button" class="btn-ghost life-edit-btn">编辑</button>` +
      `</div>`;
    row.querySelector(".life-edit-btn").addEventListener("click", () => openLifeEditor(ev));
    row.querySelector(".life-axis-card").addEventListener("click", (e) => {
      if (e.target.closest(".life-edit-btn")) return;
      openLifeEditor(ev);
    });
    list.appendChild(row);
  }
}

function renderRolesFacet(graph) {
  const el = $("life-facet-roles");
  el.innerHTML = "";
  const items = (graph.roles && graph.roles.items) || [];
  if (!items.length) {
    el.innerHTML =
      '<div class="artifact-empty">暂无角色。在时间轴添加事件，或从时间线上方导入事实材料。</div>';
    return;
  }
  for (const it of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "library-row";
    const title = (it.title || "") + (it.org ? ` @ ${it.org}` : "");
    const meta = [it.when, it.status === "active" ? "在任/进行中" : "", it.summary]
      .filter(Boolean)
      .join(" · ");
    row.innerHTML =
      `<div class="library-row-title">${escapeHtml(title)}</div>` +
      (meta ? `<div class="library-row-meta">${escapeHtml(meta)}</div>` : "");
    row.addEventListener("click", () => {
      const evId = (it.eventIds || [])[0];
      const ev =
        ((lifeGraphCache && lifeGraphCache.events) || []).find((e) => e.id === evId) ||
        {
          when: it.when,
          what: it.summary || it.title,
          roleLabels: it.title ? [it.title] : [],
          org: it.org || "",
        };
      switchMeTab("timeline");
      openLifeEditor(ev.id ? ev : { ...ev, id: "" });
    });
    el.appendChild(row);
  }
}

async function renderBoundaries() {
  boundariesCache = await window.digitalMe.getBoundaries();
  const items = boundariesCache.items || [];
  const list = $("life-boundaries-list");
  list.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "library-row life-boundary-row";
    const scope = BOUNDARY_SCOPE_LABELS[it.scope] || it.scope;
    const src = it.source === "system" ? "系统默认" : "个人";
    const on = it.enabled !== false;
    row.innerHTML =
      `<div class="life-boundary-main">` +
      `<div class="library-row-title">${escapeHtml(it.text)}</div>` +
      `<div class="library-row-meta">${escapeHtml(src)} · ${escapeHtml(scope)}${on ? "" : " · 已关闭"}</div>` +
      `</div>`;
    const actions = document.createElement("div");
    actions.className = "life-boundary-actions";
    if (it.source === "system") {
      const tog = document.createElement("button");
      tog.type = "button";
      tog.className = "btn-ghost";
      tog.textContent = on ? "关闭" : "启用";
      tog.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (on) {
          const ok = window.confirm(
            "关闭系统默认边界后，对话可能触及相关敏感内容。确定关闭？"
          );
          if (!ok) return;
          const res = await window.digitalMe.removeBoundary({ id: it.id, confirmed: true });
          if (!res.ok) {
            $("boundary-msg").textContent = res.error || "操作失败";
            return;
          }
        } else {
          const res = await window.digitalMe.updateBoundary({
            id: it.id,
            enabled: true,
            confirmed: true,
          });
          if (!res.ok) {
            $("boundary-msg").textContent = res.error || "操作失败";
            return;
          }
        }
        pkg = await window.digitalMe.loadPackage();
        await renderBoundaries();
        renderMeOverview();
        $("boundary-msg").textContent = on ? "已关闭该默认项" : "已重新启用";
      });
      actions.appendChild(tog);
    } else {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-ghost";
      del.textContent = "删除";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await window.digitalMe.removeBoundary({ id: it.id });
        if (!res.ok) {
          $("boundary-msg").textContent = res.error || "删除失败";
          return;
        }
        pkg = await window.digitalMe.loadPackage();
        await renderBoundaries();
        renderMeOverview();
        $("boundary-msg").textContent = "已删除";
      });
      actions.appendChild(del);
    }
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function refreshMeView() {
  try {
    if (!pkg) pkg = await window.digitalMe.loadPackage();
    lifeGraphCache = await window.digitalMe.getLifeGraph({ eventLimit: 500 });
    renderLifeTimeline(lifeGraphCache.events || []);
    renderRolesFacet(lifeGraphCache);
    await renderBoundaries();
    await refreshInboxPanel();
    await refreshSubjectHome();
    try {
      const snap = await window.digitalMe.getCognition();
      renderCoverageGaps($("cognition-gaps"), snap.gaps || []);
    } catch {
      /* optional */
    }
    switchMeTab(meActiveTab);
  } catch (e) {
    $("life-timeline-empty").classList.remove("hidden");
    $("life-timeline-empty").textContent = "加载失败：" + (e.message || e);
  }
}

const INBOX_KIND_OPTIONS = [
  { id: "persona", label: "想法与表达" },
  { id: "identity", label: "履历与经历" },
  { id: "custody", label: "只存不写入" },
  { id: "undecided", label: "待指定" },
];

const INBOX_STATUS_LABEL = {
  queued: "待整理",
  suggested: "有建议",
  processing: "处理中",
  awaiting_review: "待审阅",
  written: "已写入",
  skipped: "已跳过",
  failed: "处理失败",
};

function isInboxActiveStatus(status) {
  return status !== "written";
}

function isInboxReadyForBuild(it) {
  return (
    isInboxActiveStatus(it.status) &&
    it.status !== "processing" &&
    it.status !== "awaiting_review" &&
    it.suggestedKind &&
    it.suggestedKind !== "undecided"
  );
}

function setPendingReviewIds(ids) {
  pendingReviewInboxIds = Array.isArray(ids) ? [...ids] : [];
}

function clearReviewModeState() {
  pendingReviewInboxIds = [];
  reviewModeGroups = [];
  reviewModeIndex = 0;
}

async function markInboxItemsStatus(ids, status, processMeta) {
  for (const id of ids || []) {
    const patch = { id, status };
    if (processMeta && typeof processMeta === "object") patch.processMeta = processMeta;
    await window.digitalMe.markInboxStatus(patch);
  }
}

async function markPendingReviewAwaiting() {
  if (!pendingReviewInboxIds.length) return;
  await markInboxItemsStatus(pendingReviewInboxIds, "awaiting_review");
  // Surface B4 immediately; do not wait on overview IPC for the wizard step.
  lastBuildFlow = {
    ...(lastBuildFlow && typeof lastBuildFlow === "object" ? lastBuildFlow : {}),
    step: "B4",
    awaitingCount: Math.max(
      (lastBuildFlow && lastBuildFlow.awaitingCount) || 0,
      pendingReviewInboxIds.length
    ),
  };
  applyBuildWizard();
  await refreshInboxPanel();
}

async function finalizePendingReviewAsWritten(revision, options = {}) {
  const { requirePackageRevision = false } = options;
  if (!pendingReviewInboxIds.length) return { ok: false, reason: "no_pending" };
  if (requirePackageRevision && !isValidPackageRevision(revision)) {
    const ids = [...pendingReviewInboxIds];
    pendingReviewInboxIds = [];
    if (ids.length) await markInboxItemsStatus(ids, "suggested");
    await refreshInboxPanel();
    return { ok: false, reason: "invalid_revision" };
  }
  const meta = isValidPackageRevision(revision)
    ? { revision, committedAt: new Date().toISOString() }
    : undefined;
  await markInboxItemsStatus(pendingReviewInboxIds, "written", meta);
  pendingReviewInboxIds = [];
  await refreshInboxPanel();
  return { ok: true };
}

async function resetPendingReviewToSuggested() {
  if (!pendingReviewInboxIds.length) return;
  await markInboxItemsStatus(pendingReviewInboxIds, "suggested");
  pendingReviewInboxIds = [];
  await refreshInboxPanel();
}

function isValidPackageRevision(value) {
  return Number.isInteger(value) && value >= 0;
}

function packageCommitSucceeded(result) {
  if (!result || result.committed !== true) return false;
  if (result.kind === "custody") return true;
  return isValidPackageRevision(result.revision);
}

async function cancelCurrentReviewWithoutWrite() {
  const ids = [...pendingReviewInboxIds];
  clearReviewModeState();
  distillResult = null;
  $("builder-review")?.classList.add("hidden");
  hideBuildDoneBanner();
  if (ids.length) await markInboxItemsStatus(ids, "suggested");
  const msg = "已取消，资料未写入。可重新进入审阅。";
  if (progressSinkId === "inbox-progress") {
    updateInboxProgressSummary({
      headline: "已取消",
      current: msg,
      appendDetail: msg,
    });
  } else {
    const pel = $("builder-progress");
    if (pel) pel.textContent = msg;
  }
  await refreshInboxPanel();
}

async function handleInvalidRevisionWrite() {
  const ids = [...pendingReviewInboxIds];
  clearReviewModeState();
  distillResult = null;
  $("builder-review")?.classList.add("hidden");
  hideBuildDoneBanner();
  if (ids.length) await markInboxItemsStatus(ids, "suggested");
  const msg = "写入结果缺少有效版本号，未将材料标记为已写入。";
  if (progressSinkId === "inbox-progress") {
    updateInboxProgressSummary({
      headline: "写入未完成",
      current: msg,
      appendDetail: msg,
    });
  } else {
    const pel = $("builder-progress");
    if (pel) pel.textContent = msg;
  }
  await refreshInboxPanel();
}

async function afterReviewModePackageWrite(committed, options = {}) {
  const { formatSummary, afterSuccess = null, clearFactsPick = false } = options;
  if (!committed.ok) {
    if (committed.cancelled) {
      await cancelCurrentReviewWithoutWrite();
    } else {
      $("builder-progress").textContent = "已放弃写入。资料未改动。";
    }
    return false;
  }
  const r = committed.result;
  if (!isValidPackageRevision(r.revision)) {
    await handleInvalidRevisionWrite();
    return false;
  }
  if (afterSuccess) await afterSuccess(r);
  const progressText =
    typeof formatSummary === "function" ? formatSummary(r) : "写入完成。";
  $("builder-progress").textContent = progressText;
  const wasInboxReview = reviewModeGroups.length > 0 || pendingReviewInboxIds.length > 0;
  let queueHasNext = false;
  if (wasInboxReview) {
    if (reviewModeGroups.length) {
      const queueResult = await completeCurrentReviewCommitted(r.revision, {
        requirePackageRevision: true,
      });
      if (!queueResult.ok) return false;
      queueHasNext = !!queueResult.hasNext;
    } else {
      const fin = await finalizePendingReviewAsWritten(r.revision, { requirePackageRevision: true });
      if (!fin.ok) {
        await handleInvalidRevisionWrite();
        return false;
      }
    }
  } else {
    $("builder-review").classList.add("hidden");
    distillResult = null;
  }
  if (clearFactsPick) {
    factsPickedFiles = [];
    renderFactsPickList();
  }
  pkg = await window.digitalMe.loadPackage();
  lifeGraphCache = null;
  renderPackageStatus();
  // Refresh versions before any lane/overview work so the panel cannot stay stuck
  // on「正在读取版本信息…」behind a subject:getOverview storm.
  await refreshPackageVersionsPanel();
  if (queueHasNext) {
    // More review groups remain — stay on B4, do not flip to B5.
    return true;
  }
  const bits = [];
  if (r && typeof r.events === "number" && r.events > 0) bits.push(`经历 ${r.events} 项`);
  if (r && typeof r.memories === "number" && r.memories > 0) bits.push(`记忆 ${r.memories} 项`);
  if (r && typeof r.frameworks === "number" && r.frameworks > 0) bits.push(`框架 ${r.frameworks} 项`);
  if (r && typeof r.personaNotes === "number" && r.personaNotes > 0) {
    bits.push(`表达观察 ${r.personaNotes} 项`);
  }
  buildSessionComplete = {
    summary: bits.length
      ? `我新增或更新了：${bits.join("、")}。`
      : "我已经根据本次确认更新了对你的认识",
  };
  // Stay on build so user sees B5; avoid re-entrant overview fetch.
  ensureMeBuildLaneVisible();
  return true;
}

function formatPkgVersionsRefreshTime(d) {
  if (!d || !(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
  try {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return d.toISOString();
  }
}

function inboxKindLabel(kind) {
  const hit = INBOX_KIND_OPTIONS.find((k) => k.id === kind);
  return hit ? hit.label : "待指定";
}

function inboxConfidenceLabel(c) {
  if (c === "high") return "较有把握";
  if (c === "medium") return "一般";
  if (c === "low") return "把握较低";
  return "";
}

function buildInboxRow(it) {
  const row = document.createElement("div");
  row.className = "library-row inbox-row";
  const status = INBOX_STATUS_LABEL[it.status] || it.status;
  const conf = inboxConfidenceLabel(it.confidence);
  const conflict =
    it.kindConflict && it.ruleKind && it.modelKind && it.ruleKind !== it.modelKind
      ? `用途建议不一致，请确认`
      : "";
  const pm = it.processMeta || null;
  let processNote = "";
  if (pm) {
    const bits = [];
    if (pm.truncated || pm.truncateMode) {
      bits.push(
        pm.truncateMode === "head_tail"
          ? `已取开头与结尾（原约 ${pm.originalChars || "?"} 字）`
          : pm.truncateMode === "chunk_cap"
            ? `仅处理前 ${pm.chunksUsed || "?"} 段`
            : pm.skipped
              ? "正文已跳过"
              : "正文已缩短"
      );
    }
    if (pm.likenessDropped > 0) bits.push(`已跳过 ${pm.likenessDropped} 条不够像你的推断`);
    if (bits.length) processNote = bits.join(" · ");
  }
  const metaParts = [status, inboxKindLabel(it.suggestedKind)];
  if (conf) metaParts.push(conf);
  if (conflict) metaParts.push(conflict);
  if (processNote) metaParts.push(processNote);
  if (it.reason) metaParts.push(it.reason);

  row.innerHTML =
    `<div class="inbox-row-main">` +
    `<div class="library-row-title">${escapeHtml(it.name)}${
      it.kindConflict ? ` <span class="inbox-badge-conflict">请确认用途</span>` : ""
    }</div>` +
    `<div class="library-row-meta">${escapeHtml(metaParts.join(" · "))}</div>` +
    `</div>`;

  const actions = document.createElement("div");
  actions.className = "inbox-actions";
  const sel = document.createElement("select");
  sel.className = "inbox-kind-select";
  sel.title = "指定用途";
  for (const opt of INBOX_KIND_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.id;
    o.textContent = opt.label;
    if ((it.suggestedKind || "undecided") === opt.id) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", async () => {
    await window.digitalMe.setInboxKind({ id: it.id, kind: sel.value });
    await refreshInboxPanel();
  });
  actions.appendChild(sel);
  if (it.status !== "written" && it.suggestedKind && it.suggestedKind !== "undecided") {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn-ghost";
    go.textContent = "单独处理";
    go.addEventListener("click", () => processInboxItem(it));
    actions.appendChild(go);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn-ghost";
  del.textContent = "移除";
  del.addEventListener("click", async () => {
    await window.digitalMe.removeInboxItem(it.id);
    await refreshInboxPanel();
  });
  actions.appendChild(del);
  row.appendChild(actions);
  return row;
}

async function refreshInboxPanel() {
  const queue = await window.digitalMe.listInbox();
  const scopes = await window.digitalMe.listAccessScopes();
  const items = queue.items || [];
  const list = $("inbox-list");
  const empty = $("inbox-empty");
  list.innerHTML = "";

  const pending = items.filter((it) => it.status !== "written").length;
  const written = items.filter((it) => it.status === "written").length;
  const undecided = items.filter(
    (it) =>
      it.status !== "written" &&
      (!it.suggestedKind || it.suggestedKind === "undecided")
  ).length;
  const conflictCount = items.filter(
    (it) => it.status !== "written" && it.kindConflict && it.suggestedKind === "undecided"
  ).length;
  const ready = items.filter(
    (it) =>
      it.status !== "written" &&
      it.status !== "processing" &&
      it.suggestedKind &&
      it.suggestedKind !== "undecided"
  ).length;
  const statusEl = $("inbox-queue-status");
  if (statusEl) {
    if (!items.length) {
      statusEl.textContent = "";
    } else {
      const bits = [`共 ${items.length} 份`];
      if (pending) bits.push(`待处理 ${pending}`);
      if (ready) bits.push(`可构建 ${ready}`);
      if (undecided) bits.push(`待指定 ${undecided}`);
      if (conflictCount) bits.push(`需确认 ${conflictCount}`);
      if (written) bits.push(`已写入 ${written}`);
      statusEl.textContent = bits.join(" · ");
    }
  }

  if (!items.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    const active = items.filter((it) => it.status !== "written");
    const done = items.filter((it) => it.status === "written");
    const activeWrap = document.createElement("div");
    activeWrap.className = "inbox-active-list";
    for (const it of active) activeWrap.appendChild(buildInboxRow(it));
    list.appendChild(activeWrap);
    if (done.length) {
      const fold = document.createElement("details");
      fold.className = "inbox-written-fold";
      fold.innerHTML = `<summary>已写入 ${done.length} 份（点击展开）</summary>`;
      const doneWrap = document.createElement("div");
      doneWrap.className = "inbox-written-list";
      for (const it of done) doneWrap.appendChild(buildInboxRow(it));
      fold.appendChild(doneWrap);
      list.appendChild(fold);
    }
  }

  const accessList = $("access-list");
  const accessEmpty = $("access-empty");
  accessList.innerHTML = "";
  const sc = scopes.scopes || [];
  if (!sc.length) {
    accessEmpty.classList.remove("hidden");
  } else {
    accessEmpty.classList.add("hidden");
    for (const s of sc) {
      const row = document.createElement("div");
      row.className = "library-row access-row";
      const shortPath = String(s.dirPath || "");
      row.innerHTML =
        `<div class="inbox-row-main">` +
        `<div class="library-row-title" title="${escapeHtml(shortPath)}">${escapeHtml(shortPath)}</div>` +
        `<div class="library-row-meta">${s.recursive === false ? "仅本层" : "含下级文件夹"} · 已授权可读</div>` +
        `</div>`;
      const actions = document.createElement("div");
      actions.className = "inbox-actions";
      const scanOne = document.createElement("button");
      scanOne.type = "button";
      scanOne.className = "btn-ghost";
      scanOne.textContent = "扫描";
      scanOne.addEventListener("click", async () => {
        updateInboxProgressSummary({
          headline: "正在扫描…",
          current: "正在扫描该文件夹…",
          resetDetail: true,
          appendDetail: "正在扫描该文件夹…",
        });
        const r = await window.digitalMe.scanAccessScopes(s.id);
        updateInboxProgressSummary({
          headline: "扫描完成",
          current: `已加入 ${r.added.length} 个新文件`,
          countsText: `+${r.added.length}`,
          appendDetail: `已加入 ${r.added.length} 个新文件`,
        });
        await refreshInboxPanel();
      });
      const rem = document.createElement("button");
      rem.type = "button";
      rem.className = "btn-ghost";
      rem.textContent = "取消授权";
      rem.addEventListener("click", async () => {
        if (!window.confirm("取消后将不再扫描此文件夹（已加入的材料仍保留）。确定？")) return;
        await window.digitalMe.removeAccessScope(s.id);
        await refreshInboxPanel();
      });
      actions.appendChild(scanOne);
      actions.appendChild(rem);
      row.appendChild(actions);
      accessList.appendChild(row);
    }
  }
  await refreshBuildFlowFromOverview();
}

async function processInboxItem(it) {
  const kind = it.materialKind || it.suggestedKind;
  if (!kind || kind === "undecided") {
    updateInboxProgressSummary({
      headline: "请先指定用途",
      current: "请先选择归类（不能是待定）",
      appendDetail: "请先选择归类（不能是待定）",
    });
    return;
  }
  clearReviewModeState();
  setPendingReviewIds([it.id]);
  goBuildView();
  setProgressSink("inbox-progress");
  showInboxProgressCard();
  await markInboxItemsStatus(pendingReviewInboxIds, "processing");
  updateInboxProgressSummary({
    headline: "单独处理中…",
    current: `正在处理：${it.name}…`,
    resetDetail: true,
    appendDetail: `正在处理：${it.name}…`,
  });
  try {
    await runMaterialPipeline(kind, [
      { filePath: it.filePath, name: it.name, size: it.size || 0 },
    ], { smart: true });
    await markPendingReviewAwaiting();
    updateInboxProgressSummary({
      headline: "等待你审阅",
      current: "等待你审阅，尚未写入",
      appendDetail: `「${it.name}」已提取，请勾选后确认写入。`,
    });
    await refreshInboxPanel();
  } catch (e) {
    await resetPendingReviewToSuggested();
    updateInboxProgressSummary({
      headline: "处理失败",
      current: String(e.message || e),
      appendDetail: "处理失败：" + (e.message || e),
    });
    await refreshInboxPanel();
  }
}

function bindHelpAndTips() {
  const helpPack = window.DigitalMeHelp || { topics: {}, tips: {} };
  let activeTopic = "me";
  let activeTabId = "";

  function openHelp(topicId, preferredTabId) {
    const topic = helpPack.topics[topicId] || helpPack.topics.me;
    if (!topic) return;
    activeTopic = topicId;
    const title = $("help-modal-title");
    if (title) title.textContent = topic.title || "说明";
    const tabsEl = $("help-tabs");
    const bodyEl = $("help-body");
    if (!tabsEl || !bodyEl) return;
    const tabs = topic.tabs || [];
    activeTabId = preferredTabId && tabs.some((t) => t.id === preferredTabId)
      ? preferredTabId
      : (tabs[0] && tabs[0].id) || "";
    tabsEl.innerHTML = tabs
      .map(
        (t) =>
          `<button type="button" class="mode-tab${t.id === activeTabId ? " active" : ""}" data-help-tab="${escapeHtml(
            t.id
          )}">${escapeHtml(t.label)}</button>`
      )
      .join("");
    const cur = tabs.find((t) => t.id === activeTabId) || tabs[0];
    bodyEl.innerHTML = cur ? cur.html : "";
    tabsEl.querySelectorAll("[data-help-tab]").forEach((btn) => {
      btn.addEventListener("click", () => openHelp(activeTopic, btn.dataset.helpTab));
    });
    $("help-modal")?.classList.remove("hidden");
  }

  function closeHelp() {
    $("help-modal")?.classList.add("hidden");
  }

  document.querySelectorAll("[data-help-topic]").forEach((btn) => {
    btn.addEventListener("click", () => openHelp(btn.dataset.helpTopic));
  });
  const closeBtn = $("btn-help-close");
  if (closeBtn) closeBtn.addEventListener("click", closeHelp);
  const helpModal = $("help-modal");
  if (helpModal) {
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) closeHelp();
    });
  }

  const bubble = $("tip-bubble");
  let tipHideTimer = null;

  function tipTextFor(el) {
    if (!el) return "";
    const id = el.getAttribute("data-tip-id");
    if (id && helpPack.tips && helpPack.tips[id]) return helpPack.tips[id];
    return el.getAttribute("data-tip") || "";
  }

  function showTip(el) {
    if (!bubble || !el) return;
    const text = tipTextFor(el) || "暂无说明";
    if (tipHideTimer) {
      clearTimeout(tipHideTimer);
      tipHideTimer = null;
    }
    bubble.textContent = text;
    bubble.classList.remove("hidden");
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = rect.left;
    let top = rect.bottom + pad;
    bubble.style.left = "0px";
    bubble.style.top = "0px";
    const bw = bubble.offsetWidth || 240;
    const bh = bubble.offsetHeight || 60;
    if (left + bw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - bw - 12);
    if (top + bh > window.innerHeight - 12) top = Math.max(12, rect.top - bh - pad);
    bubble.style.left = Math.max(12, left) + "px";
    bubble.style.top = top + "px";
  }

  function hideTipSoon() {
    tipHideTimer = setTimeout(() => {
      if (bubble) bubble.classList.add("hidden");
    }, 120);
  }

  function tipTargetFromEvent(e) {
    return firstMatchingInPath(e, ".tip-mark, [data-tip-id]");
  }

  function tipMarkFromEvent(e) {
    return firstMatchingInPath(e, ".tip-mark");
  }

  function tipTargetFromNode(node) {
    const el = eventElement(node);
    return el && el.closest ? el.closest(".tip-mark, [data-tip-id]") : null;
  }

  // Document delegation: survives missed per-node binds and late-rendered tips.
  if (!document.documentElement.dataset.dmTipDelegate) {
    document.documentElement.dataset.dmTipDelegate = "1";
    document.addEventListener(
      "pointerover",
      (e) => {
        const el = tipTargetFromEvent(e);
        if (el) showTip(el);
      },
      true
    );
    document.addEventListener(
      "pointerout",
      (e) => {
        const el = tipTargetFromEvent(e);
        if (!el) return;
        const relatedEl = tipTargetFromNode(e.relatedTarget);
        if (relatedEl === el) return;
        hideTipSoon();
      },
      true
    );
    document.addEventListener(
      "focusin",
      (e) => {
        const el = tipTargetFromEvent(e);
        if (el) showTip(el);
      },
      true
    );
    document.addEventListener(
      "focusout",
      (e) => {
        const el = tipTargetFromEvent(e);
        if (el) hideTipSoon();
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        const mark = tipMarkFromEvent(e);
        if (!mark) return;
        e.preventDefault();
        e.stopPropagation();
        showTip(mark);
      },
      true
    );
  }

  window.digitalMeShowHelp = openHelp;
  window.digitalMeShowTip = showTip;
}

/**
 * Top-level inbox file pick — used by inbox + bootstrap actions.
 * Must not live inside bindMe (that binder used to throw before reaching nested handlers).
 */
async function pickIntoInbox(doneHint) {
  updateInboxProgressSummary({
    headline: "正在打开文件选择…",
    current: "请在系统对话框中选择文件。",
    resetDetail: true,
    appendDetail: "正在打开文件选择…",
  });
  let files;
  try {
    files = await window.digitalMe.pickFile();
  } catch (e) {
    const msg = String((e && e.message) || e || "未知错误");
    updateInboxProgressSummary({
      headline: "无法打开文件选择",
      current: msg,
      appendDetail: "无法打开文件选择：" + msg,
    });
    return;
  }
  const list = Array.isArray(files) ? files : files ? [files] : [];
  if (!list.length) {
    updateInboxProgressSummary({
      headline: "未选择文件",
      current: "未选择文件。可再次点击提交。",
      appendDetail: "未选择文件。",
    });
    return;
  }
  const names = list
    .map((f) => {
      if (!f) return "";
      if (f.name) return String(f.name);
      const fp = String(f.filePath || f.path || "");
      const parts = fp.split(/[/\\]/);
      return parts[parts.length - 1] || fp;
    })
    .filter(Boolean);
  const namePreview =
    names.slice(0, 5).join("、") + (names.length > 5 ? ` 等 ${names.length} 个` : "");
  updateInboxProgressSummary({
    headline: `已选择 ${list.length} 个文件`,
    current: namePreview || `共 ${list.length} 个文件`,
    countsText: String(list.length),
    appendDetail: `已选择 ${list.length} 个文件：${namePreview || "（无文件名）"}`,
  });
  let r;
  try {
    r = await window.digitalMe.enqueueInbox(list);
  } catch (e) {
    const msg = String((e && e.message) || e || "未知错误");
    updateInboxProgressSummary({
      headline: "材料入库失败",
      current: msg,
      appendDetail: "材料入库失败：" + msg,
    });
    return;
  }
  const addedLen = r && Array.isArray(r.added) ? r.added.length : list.length;
  hideBuildDoneBanner();
  updateInboxProgressSummary({
    headline: "已投入材料",
    current: doneHint || `已投入 ${addedLen} 个文件。下一步：点「智能构建」。`,
    countsText: `+${addedLen}`,
    resetDetail: true,
    appendDetail: `已投入 ${addedLen} 个文件。可直接点「智能构建」。`,
  });
  await refreshInboxPanel();
}

/** Document-level bootstrap file actions — independent of bindMe success. */
function bindBootstrapFileActions() {
  const resume = $("btn-bootstrap-resume");
  if (resume) {
    if (!resume.getAttribute("title")) {
      resume.setAttribute("title", "选择履历或经历类文件并加入待处理材料");
    }
    if (!resume.getAttribute("aria-label")) {
      resume.setAttribute("aria-label", "提交履历类文件");
    }
  }
  const assess = $("btn-bootstrap-assessment-file");
  if (assess) {
    if (!assess.getAttribute("title")) {
      assess.setAttribute("title", "选择判断或评测类文件并加入待处理材料");
    }
    if (!assess.getAttribute("aria-label")) {
      assess.setAttribute("aria-label", "提交判断类文件");
    }
  }

  if (document.documentElement.dataset.dmBootstrapDelegate === "1") return;
  document.documentElement.dataset.dmBootstrapDelegate = "1";
  document.addEventListener(
    "click",
    (e) => {
      const resume = firstMatchingInPath(e, "#btn-bootstrap-resume");
      const assess = firstMatchingInPath(e, "#btn-bootstrap-assessment-file");
      const btn = resume || assess;
      if (!btn || !btn.id) return;
      if (btn.id === "btn-bootstrap-resume") {
        e.preventDefault();
        pickIntoInbox(
          "已提交履历类材料。建议再完成自我评测或提交判断类文件，然后点击「开始构建」。"
        );
        return;
      }
      if (btn.id === "btn-bootstrap-assessment-file") {
        e.preventDefault();
        pickIntoInbox(
          "已提交判断类材料。若尚无履历，请提交简历或填写「经历概要」，然后点击「开始构建」。"
        );
      }
    },
    false
  );
}

function bindMe() {
  document.querySelectorAll("#me-lane-tabs .mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchMeLane(btn.dataset.meLane));
  });
  document.querySelectorAll("#me-tabs .mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchMeTab(btn.dataset.meTab));
  });
  $("btn-me-goto-inbox")?.addEventListener("click", () => goBuildView());
  // PAN-01S: version/refresh walls removed from default 「我」 surface
  $("btn-subject-goto-versions")?.addEventListener("click", () => {
    openSettingsPackageVersions();
  });
  $("btn-subject-refresh")?.addEventListener("click", () => refreshSubjectHome());
  const refreshSurface = $("btn-me-refresh-surface");
  if (refreshSurface) {
    refreshSurface.addEventListener("click", () => refreshCapabilitySurface());
  }
  const gotoSelf = $("btn-build-goto-self");
  if (gotoSelf) {
    gotoSelf.addEventListener("click", () => {
      buildSessionComplete = null;
      goSelfView(buildDoneTargetTab || "overview");
      buildDoneTargetTab = "overview";
      gotoSelf.textContent = "查看数字之我";
    });
  }
  $("btn-build-back-to-me")?.addEventListener("click", () => {
    buildSessionComplete = null;
    goSelfView("overview");
  });
  $("btn-build-b0-import")?.addEventListener("click", () => {
    buildChoseImport = true;
    applyBuildWizard();
    $("btn-inbox-pick")?.click();
  });
  $("btn-build-b0-later")?.addEventListener("click", () => {
    buildSessionComplete = null;
    goSelfView("overview");
  });
  $("btn-build-b1-pick")?.addEventListener("click", () => {
    $("btn-inbox-pick")?.click();
  });
  $("btn-build-b2-start")?.addEventListener("click", () => {
    $("btn-inbox-smart")?.click();
  });
  $("btn-build-b3-back")?.addEventListener("click", () => {
    buildSessionComplete = null;
    goSelfView("overview");
  });
  $("btn-build-b4-confirm")?.addEventListener("click", () => {
    $("btn-inbox-review")?.click();
  });
  $("btn-build-b4-later")?.addEventListener("click", () => {
    buildSessionComplete = null;
    goSelfView("overview");
  });
  $("btn-build-b5-see")?.addEventListener("click", () => {
    buildSessionComplete = null;
    goSelfView("cognition");
  });
  $("btn-build-b5-more")?.addEventListener("click", () => {
    buildSessionComplete = null;
    buildChoseImport = true;
    applyBuildWizard();
  });
  const mindBuild = $("btn-mind-goto-build");
  if (mindBuild) mindBuild.addEventListener("click", () => goBuildView());
  $("btn-me-goto-cognition")?.addEventListener("click", () => switchMeTab("cognition"));
  $("btn-me-goto-timeline")?.addEventListener("click", () => switchMeTab("timeline"));
  $("btn-me-goto-mind")?.addEventListener("click", () => switchMeTab("mind"));
  $("btn-me-goto-boundaries")?.addEventListener("click", () => switchMeTab("boundaries"));
  $("btn-cognition-refresh")?.addEventListener("click", () => refreshCognitionPanel());
  $("btn-distill-mind-hooks")?.addEventListener("click", async () => {
    const msg = $("cognition-msg");
    if (!msg) return;
    msg.textContent = "正在一键写入观念线索…";
    msg.dataset.keep = "1";
    const distillBtn = $("btn-distill-mind-hooks");
    if (distillBtn) distillBtn.disabled = true;
    const reviewBtn = $("btn-distill-mind-hooks-review");
    if (reviewBtn) reviewBtn.disabled = true;
    try {
      const res = await window.digitalMe.applyMindHooks();
      if (!res || !res.ok) {
        msg.textContent = (res && res.error) || "没有待写入的观念线索";
        return;
      }
      pkg = await window.digitalMe.loadPackage();
      lifeGraphCache = null;
      await refreshCognitionPanel();
      await refreshMeView();
      msg.textContent = `已写入 ${res.hookCount || 0} 条观念线索，无需再勾选。`;
    } catch (e) {
      msg.textContent = "写入失败：" + (e.message || e);
    } finally {
      delete msg.dataset.keep;
      if (distillBtn) distillBtn.disabled = false;
      if (reviewBtn) reviewBtn.disabled = false;
      await refreshCognitionPanel();
    }
  });
  const reviewMindBtn = $("btn-distill-mind-hooks-review");
  if (reviewMindBtn) {
    reviewMindBtn.addEventListener("click", async () => {
      const msg = $("cognition-msg");
      msg.textContent = "正在蒸馏观念线索（审阅模式）…";
      msg.dataset.keep = "1";
      reviewMindBtn.disabled = true;
      try {
        goBuildView();
        setProgressSink("builder-progress");
        $("builder-progress").textContent = "正在蒸馏观念线索…\n";
        const res = await window.digitalMe.distillMindHooks();
        distillResult = { ...res, materialKind: "persona" };
        currentSourceLabel = { filePath: "", title: "观念线索合集" };
        materialKind = "persona";
        renderReview(distillResult);
        $("builder-progress").textContent += "蒸馏完成，请审阅勾选后写入。\n";
        msg.textContent = "已打开构建页审阅：请勾选后写入。";
      } catch (e) {
        msg.textContent = "蒸馏失败：" + (e.message || e);
        $("builder-progress").textContent = "蒸馏失败：" + (e.message || e);
      } finally {
        delete msg.dataset.keep;
        reviewMindBtn.disabled = false;
      }
    });
  }
  $("btn-cognition-report")?.addEventListener("click", async () => {
    const msg = $("cognition-msg");
    if (!msg) return;
    msg.textContent = "正在生成自我认知简报…";
    msg.dataset.keep = "1";
    const reportBtn = $("btn-cognition-report");
    if (reportBtn) reportBtn.disabled = true;
    try {
      const r = await window.digitalMe.generateCognitionReport();
      msg.textContent = `已生成「${r.item.title}」，可在「工作台 · 写作」中打开与导出。`;
    } catch (e) {
      msg.textContent = "生成失败：" + (e.message || e);
    } finally {
      delete msg.dataset.keep;
      if (reportBtn) reportBtn.disabled = false;
    }
  });
  $("btn-cognition-add-person")?.addEventListener("click", async () => {
    const name = ($("cognition-person-name")?.value || "").trim();
    const relationType = ($("cognition-person-type")?.value || "").trim() || "其他";
    if (!name) {
      if ($("cognition-msg")) $("cognition-msg").textContent = "请填写关系人姓名";
      return;
    }
    const r = await window.digitalMe.upsertLifePerson({ name, relationType, context: "手动添加", confidence: "medium" });
    if (!r.ok) {
      if ($("cognition-msg")) $("cognition-msg").textContent = "添加失败（可能已存在）";
      return;
    }
    if ($("cognition-person-name")) $("cognition-person-name").value = "";
    if ($("cognition-person-type")) $("cognition-person-type").value = "";
    if ($("cognition-msg")) $("cognition-msg").textContent = `已添加关系人「${name}」`;
    lifeGraphCache = null;
    await refreshCognitionPanel();
  });
  $("btn-life-refresh")?.addEventListener("click", refreshMeView);
  $("btn-life-add")?.addEventListener("click", () => openLifeEditor(null));
  $("btn-life-editor-close")?.addEventListener("click", () => {
    $("life-event-editor")?.classList.add("hidden");
  });
  $("btn-life-save")?.addEventListener("click", async () => {
    const payload = {
      id: $("life-edit-id")?.value || undefined,
      when: ($("life-edit-when")?.value || "").trim(),
      what: ($("life-edit-what")?.value || "").trim(),
      roleLabels: ($("life-edit-roles")?.value || "")
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean),
      org: ($("life-edit-org")?.value || "").trim(),
      outcome: ($("life-edit-outcome")?.value || "").trim(),
      facets: ["roles"],
    };
    if ($("life-editor-msg")) $("life-editor-msg").textContent = "保存中…";
    const res = await window.digitalMe.upsertLifeEvent(payload);
    if (!res.ok) {
      if ($("life-editor-msg")) $("life-editor-msg").textContent = res.error || "保存失败";
      return;
    }
    pkg = await window.digitalMe.loadPackage();
    await refreshMeView();
    $("life-event-editor")?.classList.add("hidden");
    if ($("life-editor-msg")) $("life-editor-msg").textContent = "";
  });
  $("btn-life-delete")?.addEventListener("click", async () => {
    const id = $("life-edit-id")?.value;
    if (!id) return;
    if (!window.confirm("确定从时间轴删除此事件？")) return;
    const res = await window.digitalMe.deleteLifeEvent(id);
    if (!res.ok) {
      if ($("life-editor-msg")) $("life-editor-msg").textContent = res.error || "删除失败";
      return;
    }
    pkg = await window.digitalMe.loadPackage();
    await refreshMeView();
    $("life-event-editor")?.classList.add("hidden");
  });
  $("btn-boundary-add")?.addEventListener("click", async () => {
    const text = ($("boundary-text")?.value || "").trim();
    const scope = $("boundary-scope")?.value;
    if ($("boundary-msg")) $("boundary-msg").textContent = "保存中…";
    const res = await window.digitalMe.addBoundary({ text, scope });
    if (!res.ok) {
      if ($("boundary-msg")) $("boundary-msg").textContent = res.error || "添加失败";
      return;
    }
    if ($("boundary-text")) $("boundary-text").value = "";
    pkg = await window.digitalMe.loadPackage();
    await renderBoundaries();
    renderMeOverview();
    $("boundary-msg").textContent = "已添加，对话将遵守";
  });
  $("btn-boundary-restore")?.addEventListener("click", async () => {
    const ok = window.confirm("将重新启用全部系统默认边界（保留你追加的个人条目）。确定？");
    if (!ok) return;
    const res = await window.digitalMe.restoreBoundaryDefaults({ confirmed: true });
    if (!res.ok) {
      $("boundary-msg").textContent = res.error || "恢复失败";
      return;
    }
    pkg = await window.digitalMe.loadPackage();
    await renderBoundaries();
    renderMeOverview();
    $("boundary-msg").textContent = "已恢复系统默认";
  });

  window.digitalMe.onInboxProgress((p) => {
    if (p.phase === "start") {
      updateInboxProgressSummary({
        headline: "正在整理材料…",
        current: `开始整理 ${p.total} 份材料`,
        countsText: `0/${p.total}`,
        resetDetail: true,
        appendDetail: `开始整理 ${p.total} 份材料…`,
      });
      hideBuildDoneBanner();
    } else if (p.phase === "item") {
      updateInboxProgressSummary({
        headline: "正在整理材料…",
        current: `阅读：${p.name || ""}`,
        countsText: `${p.index}/${p.total}`,
        appendDetail: `阅读 ${p.index}/${p.total}：${p.name}`,
      });
    } else if (p.phase === "done") {
      updateInboxProgressSummary({
        headline: "整理完成",
        current: "可点「智能构建」自动写入。",
        countsText: p.total ? `${p.total}/${p.total}` : "",
        appendDetail: "整理完成。点「智能构建」即可自动写入。",
      });
    }
  });

  $("btn-inbox-pick")?.addEventListener("click", () => pickIntoInbox());

  const scrollIntake = $("btn-bootstrap-scroll-intake");
  if (scrollIntake) {
    scrollIntake.addEventListener("click", () => {
      const card = $("intake-card");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      renderIntakeForm();
    });
  }
  // Bootstrap resume/assessment buttons: document delegation in bindBootstrapFileActions.

  $("btn-inbox-organize")?.addEventListener("click", async () => {
    $("btn-inbox-organize").disabled = true;
    hideBuildDoneBanner();
    updateInboxProgressSummary({
      headline: "正在整理…",
      current: "只归类、不写入。",
      resetDetail: true,
      appendDetail: "整理中…",
    });
    try {
      await window.digitalMe.organizeInbox();
      await refreshInboxPanel();
      updateInboxProgressSummary({
        headline: "整理完成",
        current: "建议点「开始构建」自动写入；或点「审阅后写入」逐条确认。",
        appendDetail: "整理完成。建议点「智能构建」自动写入。",
      });
    } catch (e) {
      updateInboxProgressSummary({
        headline: "整理失败",
        current: String(e.message || e),
        appendDetail: "整理失败：" + (e.message || e),
      });
    } finally {
      $("btn-inbox-organize").disabled = false;
    }
  });

  function setBuildBusy(busy) {
    const cancelBtn = $("btn-inbox-cancel");
    if (cancelBtn) cancelBtn.classList.toggle("hidden", !busy);
    const smartBtn = $("btn-inbox-smart");
    if (smartBtn) smartBtn.disabled = !!busy;
    const pickBtn = $("btn-inbox-pick");
    if (pickBtn) pickBtn.disabled = !!busy;
    const organizeBtn = $("btn-inbox-organize");
    if (organizeBtn) organizeBtn.disabled = !!busy;
    const confirmBtn = $("btn-inbox-review");
    if (confirmBtn) confirmBtn.disabled = !!busy;
  }

  const cancelBtn = $("btn-inbox-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      try {
        await window.digitalMe.cancelDistill();
      } catch {
        /* ignore */
      }
      updateInboxProgressSummary({
        current: "正在请求中断…",
        appendDetail: "正在请求中断…",
      });
    });
  }

  $("btn-inbox-smart")?.addEventListener("click", async () => {
    const SMART_BATCH = 20;
    goBuildView();
    setProgressSink("inbox-progress");
    setBuildBusy(true);
    hideBuildDoneBanner();
    updateInboxProgressSummary({
      headline: "智能构建中…",
      current: "先整理材料…",
      countsText: "",
      resetDetail: true,
      appendDetail: "智能构建：整理中…",
    });
    try {
      await window.digitalMe.organizeInbox();
      await refreshInboxPanel();
      const queue = await window.digitalMe.listInbox();
      const items = queue.items || [];
      const readyAll = items.filter((it) => isInboxReadyForBuild(it));
      const undecided = items.filter(
        (it) =>
          isInboxActiveStatus(it.status) &&
          (!it.suggestedKind || it.suggestedKind === "undecided")
      );
      if (!readyAll.length) {
        updateInboxProgressSummary({
          headline: "暂无写入",
          current: undecided.length
            ? `${undecided.length} 份仍待定。请在列表里指定用途后再点「智能构建」。`
            : "没有待处理材料。请先投入文件。",
          appendDetail: undecided.length
            ? `暂无可自动处理项（${undecided.length} 份仍待定）。`
            : "没有待处理材料。请先投入文件。",
        });
        return;
      }
      const ready = readyAll.slice(0, SMART_BATCH);
      const deferred = readyAll.length - ready.length;
      updateInboxProgressSummary({
        headline: "智能构建中…",
        current:
          `本批自动处理 ${ready.length} 份` +
          (deferred > 0 ? `（另有 ${deferred} 份下一批）` : ""),
        countsText: `0/${ready.length}`,
        appendDetail:
          `本批自动处理 ${ready.length} 份` +
          (deferred > 0 ? `（另有 ${deferred} 份下一批再点「智能构建」）` : "") +
          "；超长正文会截断，异常超大/乱码会跳过。",
      });
      const groups = { identity: [], persona: [], custody: [] };
      for (const it of ready) {
        const k = it.materialKind || it.suggestedKind;
        if (groups[k]) groups[k].push(it);
      }
      for (const it of ready) {
        await window.digitalMe.markInboxStatus({ id: it.id, status: "processing" });
      }
      let processed = 0;
      let committedCount = 0;
      let cancelledCount = 0;
      let likenessTotal = 0;
      let truncatedFiles = 0;
      for (const kind of ["custody", "identity", "persona"]) {
        const batch = groups[kind];
        if (!batch.length) continue;
        updateInboxProgressSummary({
          current: `处理 ${batch.length} 份「${inboxKindLabel(kind)}」…`,
          countsText: `${processed}/${ready.length}`,
          appendDetail: `处理 ${batch.length} 份「${inboxKindLabel(kind)}」…`,
        });
        for (const it of batch) {
          await window.digitalMe.markInboxStatus({ id: it.id, status: "processing" });
        }
        const autoRes = await runMaterialPipeline(
          kind,
          batch.map((it) => ({ filePath: it.filePath, name: it.name, size: it.size || 0 })),
          { autoWrite: true, smart: true }
        );
        const notes = (autoRes && autoRes.meta && autoRes.meta.fileNotes) || [];
        const noteByPath = new Map(notes.map((n) => [n.filePath, n]));
        for (const it of batch) {
          const note = noteByPath.get(it.filePath) || null;
          if (note) {
            if (note.truncated || note.skipped) truncatedFiles++;
            likenessTotal += note.likenessDropped || 0;
          }
          if (packageCommitSucceeded(autoRes)) {
            await window.digitalMe.markInboxStatus({
              id: it.id,
              status: "written",
              processMeta: {
                revision: autoRes.revision,
                truncated: note ? !!note.truncated : false,
                truncateMode: note ? note.truncateMode || "" : "",
                originalChars: note ? note.originalChars || 0 : 0,
                chunksUsed: note ? note.chunksUsed || 0 : 0,
                chunksAvailable: note ? note.chunksAvailable || 0 : 0,
                likenessDropped: note ? note.likenessDropped || 0 : 0,
                skipped: note ? !!note.skipped : false,
              },
            });
            committedCount += 1;
          } else if (autoRes && autoRes.cancelled) {
            await window.digitalMe.markInboxStatus({ id: it.id, status: "suggested" });
            cancelledCount += 1;
          } else if (autoRes && autoRes.skipped) {
            await window.digitalMe.markInboxStatus({ id: it.id, status: "suggested" });
          } else {
            await window.digitalMe.markInboxStatus({ id: it.id, status: "failed" });
          }
        }
        processed += batch.length;
        updateInboxProgressSummary({
          countsText: `${processed}/${ready.length}`,
        });
      }
      pkg = await window.digitalMe.loadPackage();
      lifeGraphCache = null;
      renderPackageStatus();
      if (committedCount > 0) {
        await refreshPackageVersionsPanel();
      }
      await refreshInboxPanel();
      const qualityBits = [];
      if (truncatedFiles) qualityBits.push(`${truncatedFiles} 份已截断/取头尾`);
      if (likenessTotal) qualityBits.push(`像我校验跳过 ${likenessTotal} 条`);
      if (committedCount > 0) {
        const summary = `已写入 ${committedCount} 份` + (qualityBits.length ? ` · ${qualityBits.join(" · ")}` : "");
        updateInboxProgressSummary({
          headline: "本批构建完成",
          current: "结果已写入「数字之我」。可到认知页校对自动采纳项。",
          countsText: `${ready.length}/${ready.length}`,
          appendDetail: "本批构建完成。结果已写入「数字之我」。",
        });
        if (deferred > 0) {
          updateInboxProgressSummary({
            appendDetail: `还剩 ${deferred} 份待处理，再点「智能构建」继续。`,
          });
        }
        if (undecided.length) {
          updateInboxProgressSummary({
            appendDetail: `另有 ${undecided.length} 份待定未处理（需指定用途）。`,
          });
        }
        showBuildDoneBanner({ summary, deferred, undecided: undecided.length });
        buildDoneTargetTab = "cognition";
        const cta = $("btn-build-goto-self");
        if (cta) cta.textContent = "查看数字之我 · 认知校对";
      } else if (cancelledCount > 0) {
        updateInboxProgressSummary({
          headline: "已取消",
          current: "已取消，资料未写入。可重新进入审阅。",
          countsText: `${processed}/${ready.length}`,
          appendDetail: "已取消，资料未写入。可重新进入审阅。",
        });
        hideBuildDoneBanner();
      } else {
        updateInboxProgressSummary({
          headline: "未写入",
          current: "本批没有成功写入。请检查材料或改用审阅后写入。",
          countsText: `${processed}/${ready.length}`,
          appendDetail: "本批没有成功写入。",
        });
        hideBuildDoneBanner();
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const interrupted = msg.includes("中断");
      updateInboxProgressSummary({
        headline: interrupted ? "已中断" : "智能构建失败",
        current: interrupted ? "已中断本批构建。" : msg,
        appendDetail: interrupted ? "已中断本批构建。" : "智能构建失败：" + msg,
      });
      try {
        const queue = await window.digitalMe.listInbox();
        for (const it of queue.items || []) {
          if (it.status === "processing") {
            await window.digitalMe.markInboxStatus({ id: it.id, status: "suggested" });
          }
        }
      } catch {
        /* ignore */
      }
      await refreshInboxPanel();
    } finally {
      setBuildBusy(false);
      setProgressSink("builder-progress");
    }
  });

  $("btn-inbox-review")?.addEventListener("click", async () => {
    const queue = await window.digitalMe.listInbox();
    const ready = (queue.items || []).filter((it) => isInboxReadyForBuild(it));
    if (!ready.length) {
      updateInboxProgressSummary({
        headline: "暂无可审阅项",
        current: "请先整理，或对「待定」项指定用途；日常请优先用「开始构建」。",
        resetDetail: true,
        appendDetail: "没有可处理的项。",
      });
      return;
    }
    $("btn-inbox-review").disabled = true;
    setBuildBusy(true);
    try {
      await startReviewMode(ready);
    } catch (e) {
      await abandonCurrentReview();
      updateInboxProgressSummary({
        headline: "批量处理失败",
        current: String(e.message || e),
        appendDetail: "批量处理失败：" + (e.message || e),
      });
    } finally {
      $("btn-inbox-review").disabled = false;
      setBuildBusy(false);
      await refreshInboxPanel();
    }
  });

  $("btn-access-add")?.addEventListener("click", async () => {
    const r = await window.digitalMe.addAccessScope();
    if (r.canceled) return;
    if (!r.ok) {
      updateInboxProgressSummary({
        headline: "添加失败",
        current: r.error || "添加失败",
        resetDetail: true,
        appendDetail: r.error || "添加失败",
      });
      return;
    }
    updateInboxProgressSummary({
      headline: "已添加可读文件夹",
      current: "可点「扫描新文件」入队。",
      resetDetail: true,
      appendDetail: "已添加可读文件夹。可点「扫描新文件」入队。",
    });
    await refreshInboxPanel();
  });

  $("btn-access-scan")?.addEventListener("click", async () => {
    updateInboxProgressSummary({
      headline: "正在扫描…",
      current: "扫描所有可读文件夹",
      resetDetail: true,
      appendDetail: "正在扫描所有可读文件夹…",
    });
    const r = await window.digitalMe.scanAccessScopes(null);
    updateInboxProgressSummary({
      headline: "扫描完成",
      current: `新入队 ${r.added.length} 个文件`,
      countsText: `+${r.added.length}`,
      appendDetail: `扫描完成，新入队 ${r.added.length} 个文件`,
    });
    await refreshInboxPanel();
  });
}

init().catch((err) => {
  console.error("[Digital Me] init failed", err);
  try {
    reportInitError("应用初始化失败", err);
  } catch {
    /* ignore */
  }
});
