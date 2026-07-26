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
      return {
        id,
        planDisposition: removed ? "removed" : "included",
        kind: (row.querySelector("[data-field=kind]") || {}).value || "document",
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

  function renderUnderstanding(u) {
    const dl = $("act-plan-understanding-dl");
    if (!dl) return;
    const understanding = u || {};
    dl.innerHTML =
      '<label class="library-title-label">目标<textarea id="act-plan-u-goal" rows="2" data-testid="act-plan-u-goal"></textarea></label>' +
      '<label class="library-title-label">受众<input id="act-plan-u-audience" type="text" data-testid="act-plan-u-audience" /></label>' +
      '<label class="library-title-label">用途<input id="act-plan-u-usage" type="text" data-testid="act-plan-u-usage" /></label>' +
      '<label class="library-title-label">约束<textarea id="act-plan-u-constraints" rows="2" data-testid="act-plan-u-constraints"></textarea></label>' +
      '<label class="library-title-label">假设<textarea id="act-plan-u-assumptions" rows="2" data-testid="act-plan-u-assumptions"></textarea></label>' +
      '<label class="library-title-label">未解决问题<textarea id="act-plan-u-questions" rows="2" data-testid="act-plan-u-questions"></textarea></label>';
    if ($("act-plan-u-goal")) $("act-plan-u-goal").value = fieldValue(understanding.goal) === "—" ? "" : fieldValue(understanding.goal);
    if ($("act-plan-u-audience"))
      $("act-plan-u-audience").value = fieldValue(understanding.audience) === "—" ? "" : fieldValue(understanding.audience);
    if ($("act-plan-u-usage"))
      $("act-plan-u-usage").value = fieldValue(understanding.usage) === "—" ? "" : fieldValue(understanding.usage);
    if ($("act-plan-u-constraints"))
      $("act-plan-u-constraints").value =
        fieldValue(understanding.constraints) === "—" ? "" : fieldValue(understanding.constraints);
    if ($("act-plan-u-assumptions"))
      $("act-plan-u-assumptions").value = (understanding.assumptions || []).join("\n");
    if ($("act-plan-u-questions"))
      $("act-plan-u-questions").value = (understanding.unresolvedQuestions || []).join("\n");
  }

  function renderItemRow(item, index) {
    const removed = item.planDisposition === "removed";
    const support = item.supportStatusLabel || "当前不可执行生成";
    const risks = (item.riskFlags || []).join("，");
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
      '<div class="act-plan-item-head">' +
      "<strong>" +
      kindLabel(item.kind) +
      "</strong>" +
      '<span class="muted">' +
      support +
      "</span>" +
      "</div>" +
      '<label class="library-title-label">类型<select data-field="kind">' +
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
      '<label class="library-title-label">标题<input data-field="title" type="text" value="" /></label>' +
      '<label class="library-title-label">用途<textarea data-field="purpose" rows="2"></textarea></label>' +
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
      '<label class="library-title-label">依赖项 ID（逗号分隔）<input data-field="dependencies" type="text" /></label>' +
      '<label class="library-title-label">风险提示<input data-field="riskFlags" type="text" /></label>' +
      '<div class="builder-actions">' +
      '<button type="button" class="btn-ghost" data-action="move-up">上移</button>' +
      '<button type="button" class="btn-ghost" data-action="move-down">下移</button>' +
      '<button type="button" class="btn-ghost" data-action="toggle-remove">' +
      (removed ? "恢复" : "删除") +
      "</button>" +
      "</div>" +
      (risks ? '<p class="muted write-rail-hint">风险：' + risks + "</p>" : "") +
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
      set("dependencies", (item.dependencies || []).join(", "));
      set("riskFlags", (item.riskFlags || []).join("，"));
    });
  }

  function renderPlanView(view) {
    const panel = $("act-deliverable-plan-panel");
    if (!panel) return;
    if (!view || !view.version) {
      panel.classList.add("hidden");
      renderPackagePrep(null);
      return;
    }
    panel.classList.remove("hidden");
    if ($("act-plan-status")) {
      $("act-plan-status").textContent = view.statusBanner || view.message || "";
    }
    if ($("act-plan-readiness")) {
      const r = view.readiness || {};
      const parts = [];
      if (r.userSummary) parts.push(r.userSummary);
      if (r.status) parts.push("执行条件评估：" + r.status);
      $("act-plan-readiness").textContent = parts.join(" ");
    }
    renderUnderstanding(view.version.understanding);
    const itemsRoot = $("act-plan-items");
    if (itemsRoot) {
      const items = view.version.items || [];
      itemsRoot.innerHTML = items.map((it, i) => renderItemRow(it, i)).join("");
      fillItemFields(itemsRoot, items);
      bindItemControls(itemsRoot);
    }
    if (typeof global.__digitalMeRefreshPackagePrep === "function") {
      global.__digitalMeRefreshPackagePrep(view);
    }
  }

  function renderPackagePrep(state) {
    const summary = $("act-package-prep-summary");
    const status = $("act-package-prep-status");
    const btnPrepare = $("btn-act-prepare-package");
    const btnView = $("btn-act-view-package-prep");
    if (!summary || !status || !btnPrepare || !btnView) return;

    const hasConfirmed = !!(state && state.hasConfirmed);
    const hasPackage = !!(state && state.package);
    const readiness = (state && state.readiness) || null;
    const itemCount =
      state && Array.isArray(state.deliverables)
        ? state.deliverables.filter((d) => d && d.planDisposition === "included").length
        : state && state.includedCount != null
          ? Number(state.includedCount)
          : 0;
    const oneLine =
      (state && state.oneLineUnderstanding) ||
      (state && state.understandingSummary) ||
      "";

    if (!hasConfirmed) {
      summary.textContent = "请先确认成果计划，再准备成果包。";
      status.textContent = "";
      btnPrepare.classList.add("hidden");
      btnPrepare.disabled = true;
      btnView.classList.add("hidden");
      return;
    }

    const parts = [];
    if (oneLine) parts.push(oneLine);
    parts.push("预计交付 " + itemCount + " 项");
    summary.textContent = parts.join(" · ");

    if (!hasPackage) {
      status.textContent = "尚未准备成果包。";
      btnPrepare.classList.remove("hidden");
      btnPrepare.disabled = false;
      btnView.classList.add("hidden");
      return;
    }

    status.textContent =
      (readiness && readiness.userSummary) ||
      "成果包已准备；当前尚无法生成真实文件。";
    btnPrepare.classList.add("hidden");
    btnView.classList.remove("hidden");
  }

  function hidePlanPanel() {
    const panel = $("act-deliverable-plan-panel");
    if (panel) panel.classList.add("hidden");
    if ($("act-plan-status")) $("act-plan-status").textContent = "";
    if ($("act-plan-readiness")) $("act-plan-readiness").textContent = "";
    renderPackagePrep(null);
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
    renderPackagePrep,
    hidePlanPanel,
    collectItemsFromDom,
    collectUnderstandingFromDom,
    addBlankItem,
  };
})(window);
