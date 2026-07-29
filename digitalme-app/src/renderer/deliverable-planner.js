"use strict";

/**
 * DVL2-01 thin UI adapter for legacy 做事 page.
 * Display + input + events only; authority stays in main.
 */
(function (global) {
  function $(id) {
    return document.getElementById(id);
  }

  function kindLabel(kind) {
    const map = {
      document: "文档",
      presentation: "演示文稿",
      webpage: "网页",
      image: "图片",
      audio: "音频",
      video: "视频",
      dataset: "数据集",
      code: "代码",
      dashboard: "看板",
      archive: "归档包",
      other: "其他",
    };
    return map[kind] || kind || "其他";
  }

  function priorityLabel(p) {
    if (p === "required") return "必要";
    if (p === "optional") return "可选";
    return "建议";
  }

  function fieldValue(field) {
    if (field == null) return "—";
    if (typeof field === "object" && "value" in field) {
      const v = field.value;
      if (v == null || v === "") return "—";
      if (Array.isArray(v)) return v.length ? v.join("；") : "—";
      return String(v);
    }
    if (Array.isArray(field)) return field.length ? field.join("；") : "—";
    return String(field);
  }

  function collectItemsFromDom() {
    const root = $("act-plan-items");
    if (!root) return [];
    const rows = Array.from(root.querySelectorAll("[data-plan-item-id]"));
    return rows.map((row, index) => {
      const id = row.getAttribute("data-plan-item-id");
      const removed = row.getAttribute("data-plan-disposition") === "removed";
      const kindVisible = row.querySelector("[data-field=kind-visible]");
      const kindHidden = row.querySelector("[data-field=kind]");
      const kind =
        (kindVisible && kindVisible.value) ||
        (kindHidden && kindHidden.value) ||
        "document";
      if (kindHidden) kindHidden.value = kind;
      return {
        id,
        planDisposition: removed ? "removed" : "included",
        kind,
        title: (row.querySelector("[data-field=title]") || {}).value || "",
        purpose: (row.querySelector("[data-field=purpose]") || {}).value || "",
        format: (row.querySelector("[data-field=format]") || {}).value || "",
        priority: (row.querySelector("[data-field=priority]") || {}).value || "recommended",
        order: index,
        dependencies: String((row.querySelector("[data-field=dependencies]") || {}).value || "")
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        riskFlags: String((row.querySelector("[data-field=riskFlags]") || {}).value || "")
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        contractSupport: row.getAttribute("data-contract-support") || undefined,
        runtimeAvailability: row.getAttribute("data-runtime-availability") || undefined,
      };
    });
  }

  function collectUnderstandingFromDom(fallbackGoal) {
    const goal = ($("act-plan-u-goal") && $("act-plan-u-goal").value) || fallbackGoal || "";
    return {
      goal: { value: goal, provenance: "user_provided" },
      audience: { value: ($("act-plan-u-audience") && $("act-plan-u-audience").value) || null, provenance: "user_provided" },
      usage: { value: ($("act-plan-u-usage") && $("act-plan-u-usage").value) || null, provenance: "user_provided" },
      constraints: {
        value: String(($("act-plan-u-constraints") && $("act-plan-u-constraints").value) || "")
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        provenance: "user_provided",
      },
      assumptions: String(($("act-plan-u-assumptions") && $("act-plan-u-assumptions").value) || "")
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      unresolvedQuestions: String(($("act-plan-u-questions") && $("act-plan-u-questions").value) || "")
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  function renderUnderstanding(u, opts) {
    const dl = $("act-plan-understanding-dl");
    if (!dl) return;
    const understanding = u || {};
    const goalVal = fieldValue(understanding.goal) === "—" ? "" : fieldValue(understanding.goal);
    const audienceVal =
      fieldValue(understanding.audience) === "—" ? "" : fieldValue(understanding.audience);
    const usageVal = fieldValue(understanding.usage) === "—" ? "" : fieldValue(understanding.usage);
    const constraintsVal =
      fieldValue(understanding.constraints) === "—" ? "" : fieldValue(understanding.constraints);
    const assumptions = (understanding.assumptions || []).join("\n");
    const questions = (understanding.unresolvedQuestions || []).join("\n");
    const primaryGoal = String((opts && opts.primaryGoal) || ($("act-request") && $("act-request").value) || "")
      .trim();
    // 01.2: hide goal field when it only restates the primary task title/goal.
    const goalIsDuplicate =
      !goalVal ||
      goalVal === primaryGoal ||
      (primaryGoal && (primaryGoal.includes(goalVal) || goalVal.includes(primaryGoal)));
    const summaryVal = fieldValue(understanding.summary) === "—" ? "" : fieldValue(understanding.summary);
    const summaryAddsValue =
      summaryVal &&
      summaryVal !== primaryGoal &&
      summaryVal !== goalVal &&
      !(primaryGoal && primaryGoal.includes(summaryVal));

    const moreParts = [];
    if (audienceVal) {
      moreParts.push(
        '<label class="library-title-label">受众<input id="act-plan-u-audience" type="text" data-testid="act-plan-u-audience" /></label>'
      );
    }
    if (usageVal) {
      moreParts.push(
        '<label class="library-title-label">用途<input id="act-plan-u-usage" type="text" data-testid="act-plan-u-usage" /></label>'
      );
    }
    if (constraintsVal) {
      moreParts.push(
        '<label class="library-title-label">约束<textarea id="act-plan-u-constraints" rows="2" data-testid="act-plan-u-constraints"></textarea></label>'
      );
    }
    if (assumptions) {
      moreParts.push(
        '<label class="library-title-label">假设<textarea id="act-plan-u-assumptions" rows="2" data-testid="act-plan-u-assumptions"></textarea></label>'
      );
    }
    if (questions) {
      moreParts.push(
        '<label class="library-title-label">待确认<textarea id="act-plan-u-questions" rows="2" data-testid="act-plan-u-questions"></textarea></label>'
      );
    }
    const headParts = [];
    if (summaryAddsValue) {
      headParts.push(
        '<p class="muted act-plan-understanding-summary" data-testid="act-plan-understanding-summary">' +
          escapeAttr(summaryVal.slice(0, 160)) +
          "</p>"
      );
    }
    if (!goalIsDuplicate) {
      headParts.push(
        '<label class="library-title-label">目标补充<textarea id="act-plan-u-goal" rows="2" data-testid="act-plan-u-goal"></textarea></label>'
      );
    } else {
      // Keep a hidden field so collectUnderstandingFromDom still works.
      headParts.push(
        '<textarea id="act-plan-u-goal" class="hidden" hidden data-testid="act-plan-u-goal"></textarea>'
      );
    }
    const understandingBlock = $("act-plan-understanding");
    const hasVisibleContent = summaryAddsValue || !goalIsDuplicate || moreParts.length > 0;
    if (understandingBlock) {
      understandingBlock.classList.toggle("hidden", !hasVisibleContent);
    }
    dl.innerHTML =
      headParts.join("") +
      (moreParts.length
        ? '<details class="act-plan-more-settings" data-testid="act-plan-more-settings"><summary class="muted">更多设置</summary><div class="act-plan-more-body">' +
          moreParts.join("") +
          "</div></details>"
        : "");
    if ($("act-plan-u-goal")) $("act-plan-u-goal").value = goalVal;
    if ($("act-plan-u-audience")) $("act-plan-u-audience").value = audienceVal;
    if ($("act-plan-u-usage")) $("act-plan-u-usage").value = usageVal;
    if ($("act-plan-u-constraints")) $("act-plan-u-constraints").value = constraintsVal;
    if ($("act-plan-u-assumptions")) $("act-plan-u-assumptions").value = assumptions;
    if ($("act-plan-u-questions")) $("act-plan-u-questions").value = questions;
  }

  function renderItemRow(item, index) {
    const removed = item.planDisposition === "removed";
    const kind = kindLabel(item.kind);
    const title = item.title || kind;
    return (
      '<article class="act-plan-item' +
      (removed ? " is-removed" : "") +
      '" data-plan-item-id="' +
      item.id +
      '" data-plan-disposition="' +
      (removed ? "removed" : "included") +
      '" data-contract-support="' +
      (item.contractSupport || "") +
      '" data-runtime-availability="' +
      (item.runtimeAvailability || "") +
      '" data-testid="act-plan-item">' +
      '<input type="hidden" data-field="kind" value="' +
      escapeAttr(item.kind || "document") +
      '" />' +
      '<div class="act-plan-item-head"><strong>' +
      escapeAttr(title) +
      "</strong></div>" +
      '<label class="library-title-label">标题<input data-field="title" type="text" value="" /></label>' +
      '<label class="library-title-label">用途或要求<textarea data-field="purpose" rows="2"></textarea></label>' +
      '<details class="act-plan-item-more" data-testid="act-plan-item-more">' +
      '<summary class="muted">更多设置</summary>' +
      '<div class="act-plan-item-more-body">' +
      '<label class="library-title-label">类型<select data-field="kind-visible">' +
      ["document", "presentation", "webpage", "image", "audio", "video"]
        .map(
          (k) =>
            '<option value="' +
            k +
            '"' +
            (item.kind === k ? " selected" : "") +
            ">" +
            kindLabel(k) +
            "</option>"
        )
        .join("") +
      "</select></label>" +
      '<label class="library-title-label">格式<input data-field="format" type="text" /></label>' +
      '<label class="library-title-label">优先级<select data-field="priority">' +
      ["required", "recommended", "optional"]
        .map(
          (p) =>
            '<option value="' +
            p +
            '"' +
            (item.priority === p ? " selected" : "") +
            ">" +
            priorityLabel(p) +
            "</option>"
        )
        .join("") +
      "</select></label>" +
      '<label class="library-title-label">依赖项<input data-field="dependencies" type="text" placeholder="留空即可" /></label>' +
      '<label class="library-title-label">备注<input data-field="riskFlags" type="text" placeholder="留空即可" /></label>' +
      "</div></details>" +
      '<div class="builder-actions">' +
      '<button type="button" class="btn-ghost" data-action="move-up">上移</button>' +
      '<button type="button" class="btn-ghost" data-action="move-down">下移</button>' +
      '<button type="button" class="btn-ghost" data-action="toggle-remove">' +
      (removed ? "恢复" : "删除") +
      "</button>" +
      "</div>" +
      "</article>"
    );
  }

  /** Confirmed / generating: compact titles only — no persistent edit form. */
  function renderItemRowSummary(item) {
    const removed = item.planDisposition === "removed";
    if (removed) return "";
    const kind = kindLabel(item.kind);
    const title = item.title || kind;
    return (
      '<article class="act-plan-item act-plan-item-summary" data-plan-item-id="' +
      escapeAttr(item.id) +
      '" data-plan-disposition="included" data-testid="act-plan-item-summary">' +
      '<input type="hidden" data-field="kind" value="' +
      escapeAttr(item.kind || "document") +
      '" />' +
      '<input type="hidden" data-field="title" value="' +
      escapeAttr(item.title || "") +
      '" />' +
      '<input type="hidden" data-field="purpose" value="' +
      escapeAttr(item.purpose || "") +
      '" />' +
      '<input type="hidden" data-field="format" value="' +
      escapeAttr(item.format || "") +
      '" />' +
      '<input type="hidden" data-field="priority" value="' +
      escapeAttr(item.priority || "recommended") +
      '" />' +
      '<input type="hidden" data-field="dependencies" value="' +
      escapeAttr((item.dependencies || []).join(", ")) +
      '" />' +
      '<input type="hidden" data-field="riskFlags" value="' +
      escapeAttr((item.riskFlags || []).join("，")) +
      '" />' +
      '<div class="act-plan-item-head"><strong>' +
      escapeAttr(title) +
      '</strong><span class="muted"> · ' +
      escapeAttr(kind) +
      "</span></div>" +
      "</article>"
    );
  }

  function bindItemControls(root) {
    if (!root) return;
    root.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest("[data-plan-item-id]");
        if (!row) return;
        const action = btn.getAttribute("data-action");
        if (action === "toggle-remove") {
          const removed = row.getAttribute("data-plan-disposition") === "removed";
          row.setAttribute("data-plan-disposition", removed ? "included" : "removed");
          row.classList.toggle("is-removed", !removed);
          btn.textContent = removed ? "删除" : "恢复";
          return;
        }
        if (action === "move-up" && row.previousElementSibling) {
          root.insertBefore(row, row.previousElementSibling);
        }
        if (action === "move-down" && row.nextElementSibling) {
          root.insertBefore(row.nextElementSibling, row);
        }
      });
    });
  }

  function fillItemFields(root, items) {
    const rows = Array.from(root.querySelectorAll("[data-plan-item-id]"));
    rows.forEach((row, i) => {
      const item = items[i];
      if (!item) return;
      const set = (field, value) => {
        const el = row.querySelector("[data-field=" + field + "]");
        if (el) el.value = value == null ? "" : String(value);
      };
      set("title", item.title);
      set("purpose", item.purpose);
      set("format", item.format);
      set("kind", item.kind);
      set("kind-visible", item.kind);
      set("priority", item.priority);
      set("dependencies", (item.dependencies || []).join(", "));
      set("riskFlags", (item.riskFlags || []).join("，"));
    });
  }

  function renderPlanView(view, opts) {
    const panel = $("act-deliverable-plan-panel");
    if (!panel) return;
    if (!view || !view.version) {
      panel.classList.add("hidden");
      updatePrimaryGenerateButton({ mode: "generate", disabled: true });
      return;
    }
    panel.classList.remove("hidden");
    const materialsStale = !!(view.materialsStale || (view.statusBanner && /参考材料已变化/.test(String(view.statusBanner))));
    const planUiMode = (opts && opts.planUiMode) || view.planUiMode || "editing";
    const editing = planUiMode === "editing";
    const primaryGoal = String(($("act-request") && $("act-request").value) || "").trim();

    if ($("act-plan-status")) {
      // Do not repeat the full user goal under「预计交付」when deliverable titles exist.
      let one = "";
      if (materialsStale) {
        one = view.statusBanner || "参考材料已变化，请重新形成预计交付后再生成。";
      } else if (view.statusBanner && !/参考材料已变化/.test(String(view.statusBanner))) {
        const banner = String(view.statusBanner);
        if (banner !== primaryGoal && !(primaryGoal && (primaryGoal.includes(banner) || banner.includes(primaryGoal)))) {
          one = banner;
        }
      }
      $("act-plan-status").textContent = one;
      $("act-plan-status").classList.toggle("is-materials-stale", materialsStale);
    }
    if ($("act-plan-readiness")) {
      $("act-plan-readiness").textContent = "";
    }
    renderUnderstanding(view.version.understanding, {
      primaryGoal,
    });
    const itemsRoot = $("act-plan-items");
    const addBtn = $("btn-act-plan-add-item");
    const saveDraftBtn = $("btn-act-plan-save-draft");
    const cancelDraftBtn = $("btn-act-plan-cancel-draft");
    if (itemsRoot) {
      const items = view.version.items || [];
      if (editing) {
        itemsRoot.innerHTML = items.map((it, i) => renderItemRow(it, i)).join("");
        fillItemFields(itemsRoot, items);
        bindItemControls(itemsRoot);
      } else {
        itemsRoot.innerHTML =
          items.map((it) => renderItemRowSummary(it)).join("") +
          (planUiMode === "confirmed" || planUiMode === "failed"
            ? '<div class="builder-actions"><button type="button" class="btn-ghost" data-action="edit-plan" data-testid="btn-act-edit-plan">修改计划</button></div>'
            : "");
        const editBtn = itemsRoot.querySelector("[data-action=edit-plan]");
        if (editBtn) {
          editBtn.addEventListener("click", () => {
            renderPlanView(view, { planUiMode: "editing" });
          });
        }
      }
    }
    if (addBtn) addBtn.classList.toggle("hidden", !editing);
    if (saveDraftBtn) saveDraftBtn.classList.toggle("hidden", !editing);
    if (cancelDraftBtn) cancelDraftBtn.classList.toggle("hidden", !editing);

    updatePrimaryGenerateButton({
      mode: "generate",
      disabled:
        materialsStale ||
        !!(view.authorizationStatus && view.authorizationStatus.canGenerate === false) ||
        planUiMode === "generating",
      busy: planUiMode === "generating",
      authRevoked: !!(view.authorizationStatus && view.authorizationStatus.status === "revoked"),
    });
    if (typeof global.__digitalMeRefreshDeliverableResults === "function") {
      global.__digitalMeRefreshDeliverableResults(view);
    }
  }

  function updatePrimaryGenerateButton(state) {
    const btn = $("btn-act-generate-from-plan");
    if (!btn) return;
    const mode = (state && state.mode) || "generate";
    const busy = !!(state && state.busy);
    const authRevoked = !!(state && state.authRevoked);
    const disabled = !!(state && state.disabled) || busy || authRevoked;
    let label = "生成成果";
    if (authRevoked) label = "授权已撤销";
    else if (busy) label = "正在生成…";
    else if (mode === "regenerate") label = "重新生成成果";
    else if (mode === "new_version") label = "生成新版本";
    btn.textContent = label;
    btn.disabled = disabled;
    btn.setAttribute("data-mode", mode);
    btn.setAttribute("data-auth-revoked", authRevoked ? "1" : "0");
  }

  function kindLabelZh(kind) {
    const map = {
      document: "文档",
      presentation: "演示文稿",
      webpage: "网页",
      image: "图片",
    };
    return map[kind] || kind || "成果";
  }

  function latestAttemptForDeliverable(d, view) {
    const attempts = (view && view.generationAttempts) || {};
    const id = d && d.latestGenerationAttemptId;
    if (id && attempts[id]) return attempts[id];
    return null;
  }

  function userGenStatus(d, view) {
    const s = d && d.generationStatus;
    const attempt = latestAttemptForDeliverable(d, view);
    if (attempt && (attempt.status === "repairing" || attempt.outcome === "repair_initiated")) {
      return "正在完善成果";
    }
    if (s === "ready" || (d && d.currentVersionId && s !== "failed" && s !== "generating" && s !== "blocked")) {
      return "成果已完成";
    }
    if (s === "failed") {
      return "成果未能生成";
    }
    if (s === "generating") return "正在生成成果";
    if (s === "blocked" || s === "skipped_dependency") return "成果未能生成";
    return "等待生成";
  }

  function isEnhancing(d, view) {
    const attempt = latestAttemptForDeliverable(d, view);
    return !!(attempt && attempt.phase === "quality_enhancement" && d && d.currentVersionId);
  }

  function enhancementAuditLine(d, view) {
    const attempt = latestAttemptForDeliverable(d, view);
    if (attempt && attempt.enhancement && attempt.enhancement.ok === false) {
      return "质量增强未完成，已保留基础版本。";
    }
    return "";
  }

  function failureHintForDeliverable(d, view) {
    return "";
  }

  function failureDetailForDeliverable(d, view) {
    if (!d || d.generationStatus !== "failed") return "";
    const attempt = latestAttemptForDeliverable(d, view);
    if (d.lastGenerationIssueSummary) return String(d.lastGenerationIssueSummary);
    if (attempt && attempt.userIssueSummary) return String(attempt.userIssueSummary);
    if (attempt && attempt.errorSummary) return String(attempt.errorSummary);
    return "系统已在一次发起内完成自动修复尝试，仍未能可靠生成成果。";
  }

  function auditIssueLines(d, view) {
    const attempt = latestAttemptForDeliverable(d, view);
    const issues =
      (attempt && attempt.reviewIssues) ||
      (attempt && attempt.placeholderIssues) ||
      (attempt && attempt.failureEvidence && attempt.failureEvidence.placeholderIssues) ||
      [];
    if (!issues.length) return "";
    return issues
      .slice(0, 6)
      .map(
        (i) =>
          `<div>${i.message ? escapeAttr(i.message) : `第 ${escapeAttr(i.lineNumber)} 行 · ${escapeAttr(i.ruleId || "issue")} · ${escapeAttr(i.contextSnippet || i.matchedText || "")}`}</div>`
      )
      .join("");
  }

  function pickPrimaryArtifact(kind, arts, preferredRef) {
    if (preferredRef && preferredRef.id && arts && arts.some((a) => a && a.id === preferredRef.id)) {
      return preferredRef;
    }
    if (!arts || !arts.length) return null;
    // Prefer the content file users can open in an editor/office app.
    // HTML remains available under「更多…」to avoid silent browser-behind-window opens.
    const prefer = {
      webpage: ["html"],
      presentation: ["pptx", "docx", "html"],
      document: ["md", "docx", "html"],
      image: ["png", "jpg", "jpeg", "webp"],
    };
    const order = prefer[kind] || [];
    for (const fmt of order) {
      const hit = arts.find((a) => String(a.format || "").toLowerCase() === fmt);
      if (hit) return hit;
    }
    return arts[0];
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString();
    } catch {
      return String(iso);
    }
  }

  function renderGenerationPanel(view) {
    const panel = $("act-generation-panel");
    const status = $("act-generation-status");
    const itemsRoot = $("act-generation-items");
    if (!panel || !itemsRoot) return;
    if (!view || !view.deliverables || !view.deliverables.length) {
      panel.classList.add("hidden");
      if (status) status.textContent = "";
      return;
    }
    panel.classList.remove("hidden");
    const included = view.deliverables.filter((d) => d.planDisposition === "included");
    const versions = view.versions || {};
    const auth = view.authorizationStatus || {};
    const authRevoked = auth.status === "revoked";
    const canGenerate = auth.canGenerate !== false && !authRevoked;
    const anyRepairing = included.some((d) => {
      const att = latestAttemptForDeliverable(d, view);
      return att && (att.status === "repairing" || att.outcome === "repair_initiated");
    });
    const anyEnhancing = included.some((d) => isEnhancing(d, view));
    const anyGenerating = included.some((d) => d.generationStatus === "generating") || anyRepairing;
    const anyReady = included.some((d) => d.generationStatus === "ready" || d.currentVersionId);
    const anyFailed = included.some((d) => d.generationStatus === "failed");
    // Single status outlet: only the main result area (items), not a duplicate top line.
    if (status) {
      status.textContent = "";
      status.classList.remove("is-auth-revoked");
    }

    const pkg = view.package || {};
    const identitySnap = pkg.identityContextSnapshot || null;
    const roleLabel =
      (identitySnap && identitySnap.actingRoleRef && identitySnap.actingRoleRef.displayName) || "";
    const executorLabel =
      identitySnap &&
      identitySnap.executorRefs &&
      identitySnap.executorRefs[0] &&
      (identitySnap.executorRefs[0].modelRef || identitySnap.executorRefs[0].executorType);
    const summaryBlock = authRevoked
      ? `<div class="act-auth-revoked-banner" data-testid="act-auth-revoked-banner">${
          auth.message || "本次授权已撤销。已有成果会保留，但不能继续生成新版本。"
        }</div>`
      : "";

    const auditExtras = included
      .map((d) => enhancementAuditLine(d, view))
      .filter(Boolean)
      .slice(0, 1);
    const detailsBlock =
      `<details class="act-gen-details" data-testid="act-gen-details">` +
      `<summary class="muted">详情</summary>` +
      `<div class="act-gen-details-body">` +
      `<div class="muted">由你的 Digital Me 生成，成果归你所有</div>` +
      `<div class="muted">本次权限：${escapeAttr(auth.statusLabel || (authRevoked ? "已撤销" : "已授权"))}</div>` +
      (executorLabel ? `<div class="muted">使用的能力：${escapeAttr(executorLabel)}</div>` : "") +
      (roleLabel ? `<div class="muted">当前角色：${escapeAttr(roleLabel)}</div>` : "") +
      `<details class="act-gen-audit" data-testid="act-gen-audit">` +
      `<summary class="muted">高级审计</summary>` +
      `<div class="act-gen-audit-body muted">` +
      `<div>发起者：你</div>` +
      `<div>成果归属：你</div>` +
      `<div>行动方：你的 Digital Me</div>` +
      (auth.authorizationId ? `<div>授权记录：${escapeAttr(auth.authorizationId)}</div>` : "") +
      (identitySnap && identitySnap.identityContextSource === "legacy_default_inference"
        ? `<div>来源：兼容推断记录</div>`
        : `<div>来源：正式快照</div>`) +
      (auditExtras.length
        ? auditExtras.map((line) => `<div>${escapeAttr(line)}</div>`).join("")
        : "") +
      `</div>` +
      (auth.canRevoke
        ? `<div class="builder-actions"><button type="button" class="btn-ghost" data-action="revoke-auth" data-task-id="${escapeAttr(
            pkg.taskId || ""
          )}">撤销本次授权</button></div>`
        : authRevoked
          ? `<div class="muted">本次授权已撤销</div>`
          : "") +
      `</details></div></details>`;

    let globalStatusBlock = "";
    if (authRevoked) {
      // banner already in summaryBlock
    } else if (anyRepairing && !anyReady) {
      globalStatusBlock = `<div class="act-gen-status-block" data-testid="act-gen-status-block"><strong>正在完善成果</strong></div>`;
    } else if (anyGenerating && !anyReady) {
      globalStatusBlock = `<div class="act-gen-status-block" data-testid="act-gen-status-block"><strong>正在生成成果</strong></div>`;
    } else if (anyFailed && !anyReady) {
      globalStatusBlock = `<div class="act-gen-status-block" data-testid="act-gen-status-block"><strong>成果未能生成</strong></div>`;
    } else if (anyReady && !anyFailed) {
      globalStatusBlock =
        `<div class="act-gen-status-block" data-testid="act-gen-status-block"><strong>成果已完成</strong>` +
        (anyEnhancing
          ? `<div class="muted" data-testid="act-gen-enhancing-hint">正在进一步完善</div>`
          : "") +
        `</div>`;
    } else if (anyFailed && anyReady) {
      globalStatusBlock = `<div class="act-gen-status-block" data-testid="act-gen-status-block"><strong>部分成果已完成</strong></div>`;
    }

    itemsRoot.innerHTML =
      summaryBlock +
      globalStatusBlock +
      detailsBlock +
      included
        .map((d) => {
          const ver = d.currentVersionId ? versions[d.currentVersionId] : null;
          const label = kindLabelZh(d.kind);
          const st = userGenStatus(d, view);
          const failDetail = failureDetailForDeliverable(d, view);
          const auditLines = auditIssueLines(d, view);
          const arts = (ver && (ver.artifactRefs || []).length
            ? ver.artifactRefs
            : ver && ver.artifactRef
              ? [ver.artifactRef]
              : []
          ).concat(ver && ver.previewRef ? [ver.previewRef] : []);
          const seen = new Set();
          const uniqueArts = arts.filter((a) => {
            if (!a || !a.id || seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
          });
          const primary = pickPrimaryArtifact(d.kind, uniqueArts, ver && ver.artifactRef);
          const secondaryArts = uniqueArts.filter((a) => !primary || a.id !== primary.id);
          const hasPersistedArtifact = !!(ver && primary && d.currentVersionId);

          // Failed / not persisted: status already shown once above — only optional reason.
          if (st === "成果未能生成" || (!hasPersistedArtifact && d.generationStatus === "failed")) {
            let actions = "";
            if (failDetail || auditLines) {
              actions +=
                `<details class="act-gen-issue-details" data-testid="act-gen-issue-details"><summary class="muted">查看原因</summary>` +
                `<div class="muted act-gen-issue-body">` +
                (failDetail ? `<p>${escapeAttr(failDetail)}</p>` : "") +
                (auditLines
                  ? `<details class="act-gen-audit"><summary class="muted">技术依据</summary><div class="act-gen-audit-body">${auditLines}</div></details>`
                  : "") +
                `</div></details>`;
            }
            return (
              `<div class="act-gen-item act-gen-item-pending" data-deliverable-id="${d.id}" data-testid="act-gen-pending">` +
              (actions ? `<div class="builder-actions">${actions}</div>` : "") +
              `</div>`
            );
          }

          if (st === "正在生成成果" || st === "正在完善成果") {
            return "";
          }

          if (!hasPersistedArtifact) {
            return "";
          }

          const metaParts = [label];
          if (ver && (ver.createdAt || ver.generatedAt)) {
            metaParts.push(formatTime(ver.createdAt || ver.generatedAt));
          }
          if (ver && ver.reviewStatus === "accepted") metaParts.push("已接受");
          if (ver && ver.reviewStatus === "rejected") metaParts.push("已否定");

          let actions = "";
          if (st === "成果已完成" && primary) {
            actions +=
              `<button type="button" class="btn btn-primary" data-action="open-deliverable-artifact" data-open-deliverable-artifact="true" data-artifact-id="${escapeAttr(
                primary.id
              )}" data-version-id="${escapeAttr(ver.id)}" data-deliverable-id="${escapeAttr(
                d.id
              )}" data-task-id="${escapeAttr((pkg && pkg.taskId) || "")}">打开成果</button>`;
            actions +=
              `<button type="button" class="btn-ghost" data-action="accept-ver" data-version-id="${escapeAttr(
                ver.id
              )}">接受</button>`;
            const moreItems = [];
            moreItems.push(
              canGenerate
                ? `<button type="button" class="btn-ghost" data-action="regen" data-deliverable-id="${escapeAttr(
                    d.id
                  )}">重新生成</button>`
                : `<button type="button" class="btn-ghost" disabled title="本次授权已撤销">重新生成</button>`
            );
            moreItems.push(
              `<button type="button" class="btn-ghost" data-action="reveal-art" data-artifact-id="${escapeAttr(
                primary.id
              )}" data-version-id="${escapeAttr(ver.id)}" data-deliverable-id="${escapeAttr(
                d.id
              )}" data-task-id="${escapeAttr((pkg && pkg.taskId) || "")}">打开所在目录</button>`
            );
            if (ver) {
              moreItems.push(
                `<button type="button" class="btn-ghost" data-action="reject-ver" data-version-id="${escapeAttr(
                  ver.id
                )}">否定此版本</button>`
              );
            }
            secondaryArts.forEach((a) => {
              moreItems.push(
                `<button type="button" class="btn-ghost" data-action="open-deliverable-artifact" data-open-deliverable-artifact="true" data-artifact-id="${escapeAttr(
                  a.id
                )}" data-version-id="${escapeAttr(ver.id)}" data-deliverable-id="${escapeAttr(
                  d.id
                )}" data-task-id="${escapeAttr((pkg && pkg.taskId) || "")}">打开 ${escapeAttr(
                  a.format || "其他格式"
                )}</button>`
              );
            });
            actions +=
              `<details class="act-gen-more"><summary class="muted">更多…</summary><div class="builder-actions">${moreItems.join(
                ""
              )}</div></details>`;
          }

          return (
            `<div class="act-gen-item" data-deliverable-id="${d.id}" data-testid="act-gen-artifact-card">` +
            `<div class="act-gen-item-head"><strong>${escapeAttr(d.title || label)}</strong>` +
            `<span class="muted">${metaParts.map(escapeAttr).join(" · ")}</span></div>` +
            (actions ? `<div class="builder-actions">${actions}</div>` : "") +
            `</div>`
          );
        })
        .join("");

    // Single primary action: hide generate while busy or terminal-failed (no continue button).
    // Enhancement must NOT block "打开成果".
    const onlyFailed = anyFailed && !anyReady && !anyGenerating && !anyRepairing;
    updatePrimaryGenerateButton({
      mode: anyReady ? "regenerate" : "generate",
      busy: anyGenerating || anyRepairing,
      disabled: !canGenerate || anyGenerating || anyRepairing || onlyFailed,
      authRevoked,
    });
    // Artifact open is handled once at #app capture (FIX-01D). Do not bind per render.
  }

  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function hidePlanPanel() {
    const panel = $("act-deliverable-plan-panel");
    if (panel) panel.classList.add("hidden");
    if ($("act-plan-status")) $("act-plan-status").textContent = "";
    if ($("act-plan-readiness")) $("act-plan-readiness").textContent = "";
    const gen = $("act-generation-panel");
    if (gen) gen.classList.add("hidden");
    updatePrimaryGenerateButton({ mode: "generate", disabled: true });
  }

  function addBlankItem() {
    const itemsRoot = $("act-plan-items");
    if (!itemsRoot) return;
    const current = collectItemsFromDom();
    current.push({
      id: "local_" + Date.now().toString(36),
      planDisposition: "included",
      kind: "document",
      title: "新预计交付",
      purpose: "",
      format: "docx",
      priority: "recommended",
      order: current.length,
      dependencies: [],
      riskFlags: [],
      supportStatusLabel: "当前不可执行生成",
      contractSupport: "in_current_product_scope",
      runtimeAvailability: "unavailable",
    });
    itemsRoot.innerHTML = current.map((it, i) => renderItemRow(it, i)).join("");
    fillItemFields(itemsRoot, current);
    bindItemControls(itemsRoot);
  }

  global.DeliverablePlannerUi = {
    renderPlanView,
    renderGenerationPanel,
    updatePrimaryGenerateButton,
    hidePlanPanel,
    collectItemsFromDom,
    collectUnderstandingFromDom,
    addBlankItem,
  };
})(window);
