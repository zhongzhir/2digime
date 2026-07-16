"use strict";
const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "src", "renderer", "app.js");
let s = fs.readFileSync(p, "utf8");
const start = s.indexOf("function renderMeOverview()");
const end = s.indexOf("function openLifeEditor(ev)");
if (start < 0 || end < 0) {
  console.error("markers not found", start, end);
  process.exit(1);
}

const neu = `function renderCoverageGaps(el, gaps) {
  if (!el) return;
  if (!gaps || !gaps.length) {
    el.innerHTML = \`<p class="muted coverage-gaps-ok">覆盖较均衡。可继续投材料加深，或在认知页管理推断。</p>\`;
    return;
  }
  el.innerHTML =
    \`<h4 class="cog-sub">建议补强（自我发展）</h4>\` +
    \`<ul class="coverage-gap-list">\` +
    gaps
      .map(
        (g) =>
          \`<li class="coverage-gap-item">\` +
          \`<div><b>\${escapeHtml(g.title)}</b> <span class="muted">\${escapeHtml(g.layer)}</span>\` +
          \`<div class="muted">\${escapeHtml(g.hint)}</div></div>\` +
          \`<button type="button" class="btn-ghost gap-go" data-tab="\${escapeHtml(g.actionTab || "inbox")}">去处理</button>\` +
          \`</li>\`
      )
      .join("") +
    \`</ul>\`;
  el.querySelectorAll(".gap-go").forEach((btn) => {
    btn.addEventListener("click", () => switchMeTab(btn.dataset.tab || "inbox"));
  });
}

function renderMeOverview() {
  const el = $("me-overview-stats");
  const events = (lifeGraphCache && lifeGraphCache.events) || [];
  const roles = (lifeGraphCache && lifeGraphCache.roles && lifeGraphCache.roles.items) || [];
  const inferences = (lifeGraphCache && lifeGraphCache.inferences) || [];
  const outcomes = (lifeGraphCache && lifeGraphCache.outcomes && lifeGraphCache.outcomes.items) || [];
  const people = (lifeGraphCache && lifeGraphCache.people && lifeGraphCache.people.items) || [];
  const peopleConfirmed = people.filter((p) => p.status === "confirmed");
  const bounds = (boundariesCache && boundariesCache.items) || [];
  const enabledBounds = bounds.filter((b) => b.enabled !== false).length;
  const hasPersona = !!(pkg && pkg.persona && String(pkg.persona).trim().length > 80);
  const openInf = Array.isArray(inferences)
    ? inferences.filter((i) => (i.status || "open") === "open").length
    : 0;
  el.innerHTML =
    \`<div class="me-stat"><strong>\${hasPersona ? "已有" : "待补"}</strong><span>观念与表达</span></div>\` +
    \`<div class="me-stat"><strong>\${events.length}</strong><span>人生事件</span></div>\` +
    \`<div class="me-stat"><strong>\${roles.length}</strong><span>角色切片</span></div>\` +
    \`<div class="me-stat"><strong>\${outcomes.length}</strong><span>成就</span></div>\` +
    \`<div class="me-stat"><strong>\${peopleConfirmed.length}</strong><span>已确认关系人</span></div>\` +
    \`<div class="me-stat"><strong>\${openInf}</strong><span>待确认推断</span></div>\` +
    \`<div class="me-stat"><strong>\${enabledBounds}</strong><span>启用中的边界</span></div>\`;
}

function coverageBar(label, filled, totalHint) {
  const pct = filled ? Math.min(100, filled === true ? 70 : Math.min(100, Number(filled) * 12 + 20)) : 8;
  const value = filled === true ? "有" : filled === false ? "无" : String(filled);
  return (
    \`<div class="me-stat cognition-cov">\` +
    \`<strong>\${escapeHtml(value)}</strong><span>\${escapeHtml(label)}</span>\` +
    \`<div class="cov-bar" aria-hidden="true"><i style="width:\${pct}%"></i></div>\` +
    (totalHint ? \`<span class="muted" style="font-size:11px">\${escapeHtml(totalHint)}</span>\` : "") +
    \`</div>\`
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
      coverageBar("待确认推断", c.openInferences) +
      coverageBar("待蒸馏线索", c.mindHooks) +
      coverageBar("能力线索", c.capabilities);

    renderCoverageGaps($("cognition-gaps"), snap.gaps || []);
    renderCoverageGaps($("me-coverage-gaps"), snap.gaps || []);

    const openInf = (snap.inferences && snap.inferences.open) || [];
    const confInf = (snap.inferences && snap.inferences.confirmed) || [];
    const infEl = $("cognition-inferences");
    if (infEl) {
      if (!openInf.length && !confInf.length) {
        infEl.innerHTML =
          \`<p class="muted">暂无开放推断。从「材料」确认人生事实后，系统会生成待你确认的线索。</p>\`;
      } else {
        let html = "";
        if (openInf.length) {
          html += openInf
            .slice(0, 30)
            .map(
              (inf) =>
                \`<div class="cog-manage-row" data-inf-id="\${escapeHtml(inf.id)}">\` +
                \`<div class="cog-manage-main">\` +
                \`<span class="muted">[\${escapeHtml(inf.type || "")}]</span> \${escapeHtml(inf.claim)}\` +
                (inf.basedOn
                  ? \`<div class="muted" style="font-size:12px">依据：\${escapeHtml(inf.basedOn)}</div>\`
                  : "") +
                \`</div>\` +
                \`<div class="cog-manage-actions">\` +
                \`<button type="button" class="btn-ghost inf-confirm" data-id="\${escapeHtml(inf.id)}">确认</button>\` +
                \`<button type="button" class="btn-ghost inf-edit" data-id="\${escapeHtml(inf.id)}">改正</button>\` +
                \`<button type="button" class="btn-ghost inf-reject" data-id="\${escapeHtml(inf.id)}">驳回</button>\` +
                \`</div></div>\`
            )
            .join("");
        }
        if (confInf.length) {
          html += \`<h4 class="cog-sub">已确认（\${confInf.length}）</h4><ul>\`;
          html += confInf
            .slice(0, 12)
            .map((inf) => \`<li>\${escapeHtml(inf.claim)}</li>\`)
            .join("");
          html += \`</ul>\`;
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
        infEl.querySelectorAll(".inf-edit").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const row = openInf.find((x) => x.id === btn.dataset.id);
            const next = window.prompt("改正推断表述后确认：", (row && row.claim) || "");
            if (next == null || !String(next).trim()) return;
            await window.digitalMe.updateInference({
              id: btn.dataset.id,
              claim: String(next).trim(),
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
        \`<p>\${escapeHtml(mind.personaPreview)}\${mind.personaPreview.length >= 400 ? "…" : ""}</p>\`
      );
    mindBits.push(
      \`<p class="muted">判断框架 \${mind.frameworkCount || 0} · 长期记忆 \${mind.memoryCount || 0}</p>\`
    );
    if ((mind.hooks || []).length) {
      mindBits.push(
        "<ul>" +
          mind.hooks
            .slice(0, 8)
            .map(
              (h) =>
                \`<li>\${escapeHtml(h.text)} <span class="muted">\${
                  h.status === "in_review" ? "审阅中" : "待蒸馏"
                }</span></li>\`
            )
            .join("") +
          "</ul>"
      );
    }
    if (!mindBits.length || (!mind.personaPreview && !(mind.hooks || []).length && !mind.frameworkCount)) {
      $("cognition-mind").innerHTML =
        \`<p class="muted">尚无观念切片。可从「材料」投入论述文，或点「蒸馏观念线索」/去「观念与表达」。</p>\`;
    } else {
      $("cognition-mind").innerHTML = mindBits.join("");
    }
    const distillBtn = $("btn-distill-mind-hooks");
    if (distillBtn) distillBtn.disabled = !(mind.hooks && mind.hooks.length);

    const ach = snap.achievements || [];
    if (!ach.length) {
      $("cognition-achievements").innerHTML =
        \`<p class="muted">尚无成就记录。成果类材料确认写入后会出现在此。</p>\`;
    } else {
      $("cognition-achievements").innerHTML =
        \`<div class="cognition-bars">\` +
        ach
          .slice(0, 12)
          .map((o, idx) => {
            const w = Math.max(28, 100 - idx * 6);
            return (
              \`<div class="cog-bar-row"><span>\${escapeHtml(o.title)}\${
                o.when ? \` <span class="muted">\${escapeHtml(o.when)}</span>\` : ""
              }</span><i style="width:\${w}%"></i></div>\`
            );
          })
          .join("") +
        \`</div>\`;
    }

    const social = snap.social || {};
    const people = social.people || [];
    const orgs = social.orgTouchpoints || [];
    let socialHtml = "";
    socialHtml += \`<h4 class="cog-sub">关系人（L4）</h4>\`;
    if (!people.length) {
      socialHtml += \`<p class="muted">尚无关系人。须有具体人名才可登记；下方可手动添加。</p>\`;
    } else {
      socialHtml += people
        .slice(0, 20)
        .map((p) => {
          const st = p.status || "candidate";
          const actions =
            st === "candidate"
              ? \`<button type="button" class="btn-ghost ppl-confirm" data-id="\${escapeHtml(p.id)}">确认</button>\` +
                \`<button type="button" class="btn-ghost ppl-reject" data-id="\${escapeHtml(p.id)}">驳回</button>\`
              : st === "confirmed"
                ? \`<button type="button" class="btn-ghost ppl-reject" data-id="\${escapeHtml(p.id)}">撤销</button>\`
                : "";
          return (
            \`<div class="cog-manage-row">\` +
            \`<div class="cog-manage-main"><b>\${escapeHtml(p.name)}</b> · \${escapeHtml(p.relationType || "")}\` +
            \` <span class="muted">[\${escapeHtml(st)}]</span></div>\` +
            \`<div class="cog-manage-actions">\${actions}</div></div>\`
          );
        })
        .join("");
    }
    socialHtml += \`<h4 class="cog-sub">机构触点</h4>\`;
    if (!orgs.length) {
      socialHtml += \`<p class="muted">尚无机构触点（雇主/主办方/协会等，不等于人际关系）。</p>\`;
    } else {
      socialHtml +=
        \`<div class="cog-chips">\` +
        orgs
          .slice(0, 24)
          .map(
            (o) =>
              \`<span class="cog-chip">\${escapeHtml(o.org)}\${o.kind ? \` · \${escapeHtml(o.kind)}\` : ""}</span>\`
          )
          .join("") +
        \`</div>\`;
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

    const cap = snap.capability || {};
    const signals = cap.signals || [];
    const domains = cap.domains || [];
    const bounds = snap.boundaries || [];
    let capHtml = "";
    if (domains.length) {
      capHtml +=
        \`<div class="cog-chips">\` +
        domains.map((d) => \`<span class="cog-chip">\${escapeHtml(d.title)}</span>\`).join("") +
        \`</div>\`;
    }
    if (signals.length) {
      capHtml +=
        "<ul>" +
        signals
          .slice(0, 12)
          .map(
            (s) =>
              \`<li><span class="muted">[\${escapeHtml(s.polarity)}]</span> \${escapeHtml(s.signal)}</li>\`
          )
          .join("") +
        "</ul>";
    }
    if (bounds.length) {
      capHtml += \`<h4 class="cog-sub">表达禁区（已启用）</h4><ul>\`;
      capHtml += bounds
        .slice(0, 8)
        .map((b) => \`<li>\${escapeHtml(b.text || b.id)}</li>\`)
        .join("");
      capHtml += "</ul>";
    }
    if (!capHtml) {
      capHtml =
        \`<p class="muted">尚无能力边界线索。材料中的「擅长/不负责」表述确认后会显示；禁区见「边界」页。</p>\`;
    }
    $("cognition-capability").innerHTML = capHtml;
    if (msg && !msg.dataset.keep) msg.textContent = "";
  } catch (e) {
    if (msg) msg.textContent = "加载认知面板失败：" + (e.message || e);
  }
}

`;

s = s.slice(0, start) + neu + s.slice(end);
fs.writeFileSync(p, s, "utf8");
console.log("patched", p, "bytes", s.length);
