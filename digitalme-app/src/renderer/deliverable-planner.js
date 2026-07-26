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
    const btnGenerate = $("btn-act-generate-package");
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
      if (btnGenerate) btnGenerate.classList.add("hidden");
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
      if (btnGenerate) btnGenerate.classList.add("hidden");
      return;
    }

    status.textContent =
      (readiness && readiness.userSummary) ||
      "成果包已准备，可以开始生成。";
    btnPrepare.classList.add("hidden");
    btnView.classList.remove("hidden");
    if (btnGenerate) btnGenerate.classList.remove("hidden");
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

  function renderGenerationPanel(view) {
    const panel = $("act-generation-panel");
    const status = $("act-generation-status");
    const itemsRoot = $("act-generation-items");
    if (!panel || !itemsRoot) return;
    if (!view || !view.deliverables || !view.deliverables.length) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const included = view.deliverables.filter((d) => d.planDisposition === "included");
    const ready = included.filter((d) => d.generationStatus === "ready" || d.currentVersionId).length;
    const failed = included.filter((d) => d.generationStatus === "failed").length;
    if (status) {
      status.textContent =
        "共 " + included.length + " 项 · 已完成 " + ready + " · 未完成 " + failed;
    }
    const versions = view.versions || {};
    itemsRoot.innerHTML = included
      .map((d) => {
        const ver = d.currentVersionId ? versions[d.currentVersionId] : null;
        const label = kindLabelZh(d.kind);
        const fmt =
          (ver && ver.generator && ver.generator.uiFormatLabel) ||
          (d.kind === "presentation" && !ver ? "" : "");
        const st =
          d.generationStatus === "ready"
            ? "已生成"
            : d.generationStatus === "failed"
              ? "未成功"
              : d.generationStatus === "generating"
                ? "正在生成"
                : "尚未生成";
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
        const openBtns = uniqueArts
          .map(
            (a) =>
              `<button type="button" class="btn-ghost" data-action="open-art" data-artifact-id="${a.id}">打开 ${escapeAttr(
                a.format || "文件"
              )}</button>` +
              `<button type="button" class="btn-ghost" data-action="reveal-art" data-artifact-id="${a.id}">打开所在目录</button>`
          )
          .join("");
        const reviewBtns = ver
          ? `<button type="button" class="btn-ghost" data-action="accept-ver" data-version-id="${ver.id}">接受此版本</button>` +
            `<button type="button" class="btn-ghost" data-action="reject-ver" data-version-id="${ver.id}">否定此版本</button>` +
            `<button type="button" class="btn-ghost" data-action="regen" data-deliverable-id="${d.id}">重新生成</button>`
          : `<button type="button" class="btn-ghost" data-action="regen" data-deliverable-id="${d.id}">生成此项</button>`;
        return (
          `<div class="act-gen-item" data-deliverable-id="${d.id}">` +
          `<div class="act-gen-item-head"><strong>${escapeAttr(d.title || label)}</strong>` +
          `<span class="muted">${label}${fmt ? " · " + escapeAttr(fmt) : ""} · ${st}` +
          (ver ? " · 版本 " + ver.version : "") +
          (ver && ver.reviewStatus && ver.reviewStatus !== "unreviewed"
            ? " · " + (ver.reviewStatus === "accepted" ? "已接受" : "已否定")
            : "") +
          `</span></div>` +
          `<div class="builder-actions">${openBtns}${reviewBtns}</div>` +
          `</div>`
        );
      })
      .join("");
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
    renderGenerationPanel,
    hidePlanPanel,
    collectItemsFromDom,
    collectUnderstandingFromDom,
    addBlankItem,
  };
})(window);
