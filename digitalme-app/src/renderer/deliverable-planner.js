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
      updatePrimaryGenerateButton({ mode: "generate", disabled: true });
      return;
    }
    panel.classList.remove("hidden");
    const materialsStale = !!(view.materialsStale || (view.statusBanner && /参考材料已变化/.test(String(view.statusBanner))));
    if ($("act-plan-status")) {
      const u = view.version.understanding || {};
      const understandingLine =
        u.summary ||
        u.oneLineSummary ||
        (u.goal && (u.goal.value || u.goal)) ||
        "";
      // Stale materials banner must outrank ordinary understanding text.
      const one = materialsStale
        ? view.statusBanner || "参考材料已变化，请重新形成预计交付后再生成。"
        : understandingLine || view.statusBanner || "";
      $("act-plan-status").textContent = one ? String(one) : "";
      $("act-plan-status").classList.toggle("is-materials-stale", materialsStale);
    }
    if ($("act-plan-readiness")) {
      $("act-plan-readiness").textContent = "";
    }
    renderUnderstanding(view.version.understanding);
    const itemsRoot = $("act-plan-items");
    if (itemsRoot) {
      const items = view.version.items || [];
      itemsRoot.innerHTML = items.map((it, i) => renderItemRow(it, i)).join("");
      fillItemFields(itemsRoot, items);
      bindItemControls(itemsRoot);
    }
    updatePrimaryGenerateButton({
      mode: "generate",
      disabled: materialsStale,
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
    const disabled = !!(state && state.disabled) || busy;
    let label = "生成成果";
    if (busy) label = "正在生成…";
    else if (mode === "regenerate") label = "重新生成成果";
    else if (mode === "new_version") label = "生成新版本";
    btn.textContent = label;
    btn.disabled = disabled;
    btn.setAttribute("data-mode", mode);
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

  function userGenStatus(d) {
    const s = d && d.generationStatus;
    if (s === "ready" || (d && d.currentVersionId && s !== "failed" && s !== "generating" && s !== "blocked")) {
      return "已生成";
    }
    if (s === "failed") return "生成失败";
    if (s === "generating") return "正在生成";
    if (s === "blocked" || s === "skipped_dependency") return "因依赖失败暂未生成";
    return "等待生成";
  }

  function pickPrimaryArtifact(kind, arts) {
    if (!arts || !arts.length) return null;
    const prefer = {
      webpage: ["html"],
      presentation: ["pptx", "html"],
      document: ["html", "docx", "md"],
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
    const anyGenerating = included.some((d) => d.generationStatus === "generating");
    const anyReady = included.some((d) => d.generationStatus === "ready" || d.currentVersionId);
    const anyFailed = included.some((d) => d.generationStatus === "failed");
    if (status) {
      if (included.length <= 1) {
        status.textContent = "";
      } else if (anyGenerating) {
        status.textContent = "正在生成各项成果…";
      } else if (anyFailed && anyReady) {
        status.textContent = "部分成果已生成，部分未成功。";
      } else if (anyFailed) {
        status.textContent = "生成未完成。";
      } else if (anyReady) {
        status.textContent = "成果已生成。";
      } else {
        status.textContent = "";
      }
    }

    const pkg = view.package || {};
    const identitySnap = pkg.identityContextSnapshot || null;
    const identitySource = (identitySnap && identitySnap.identityContextSource) || pkg.identityContextSource || "";
    const roleLabel =
      (identitySnap && identitySnap.actingRoleRef && identitySnap.actingRoleRef.displayName) ||
      "默认本人模式";
    const identityBlock =
      `<div class="act-identity-summary muted" data-package-id="${escapeAttr(pkg.id || "")}">` +
      `<div>由你的 Digital Me 代表你生成 · 成果归你所有 · 最终由你确认</div>` +
      `<div>执行能力：当前模型与文档工具 · 当前角色：${escapeAttr(roleLabel)}</div>` +
      (identitySource === "legacy_default_inference"
        ? `<div>此记录按兼容默认推断展示，不是原始完整授权落盘。</div>`
        : "") +
      `<details class="act-gen-more act-identity-details"><summary class="muted">高级：身份与授权</summary>` +
      `<div class="builder-actions">` +
      `<button type="button" class="btn-ghost" data-action="refresh-identity" data-package-id="${escapeAttr(
        pkg.id || ""
      )}" data-task-id="${escapeAttr(pkg.taskId || "")}">刷新身份摘要</button>` +
      `<button type="button" class="btn-ghost" data-action="revoke-auth" data-task-id="${escapeAttr(
        pkg.taskId || ""
      )}">撤销本次授权</button>` +
      `<div class="muted act-identity-detail-body">发起者：你 · 代表主体：你 · 行动主体：你的 Digital Me · 授权范围：本任务本地成果生成与学习</div>` +
      `</div></details></div>`;

    itemsRoot.innerHTML =
      identityBlock +
      included
      .map((d) => {
        const ver = d.currentVersionId ? versions[d.currentVersionId] : null;
        const label = kindLabelZh(d.kind);
        const st = userGenStatus(d);
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
        const primary = pickPrimaryArtifact(d.kind, uniqueArts);
        const secondaryArts = uniqueArts.filter((a) => !primary || a.id !== primary.id);
        const metaParts = [label, st];
        if (ver && ver.version != null) metaParts.push("版本 " + ver.version);
        if (ver && (ver.createdAt || ver.generatedAt)) {
          metaParts.push(formatTime(ver.createdAt || ver.generatedAt));
        }
        if (ver && ver.reviewStatus === "accepted") metaParts.push("已接受");
        if (ver && ver.reviewStatus === "rejected") metaParts.push("已否定");
        if (ver && ver.actingRoleRef && ver.actingRoleRef.displayName) {
          metaParts.push("角色 " + ver.actingRoleRef.displayName);
        }

        let actions = "";
        if (st === "已生成" && primary) {
          actions +=
            `<button type="button" class="btn btn-primary" data-action="open-primary" data-artifact-id="${primary.id}">打开成果</button>`;
          actions +=
            `<button type="button" class="btn-ghost" data-action="accept-ver" data-version-id="${ver.id}">接受此版本</button>`;
          actions +=
            `<button type="button" class="btn-ghost" data-action="regen" data-deliverable-id="${d.id}">重新生成</button>`;
          const moreItems = [];
          moreItems.push(
            `<button type="button" class="btn-ghost" data-action="reveal-art" data-artifact-id="${primary.id}">打开所在目录</button>`
          );
          if (ver) {
            moreItems.push(
              `<button type="button" class="btn-ghost" data-action="reject-ver" data-version-id="${ver.id}">否定此版本</button>`
            );
          }
          secondaryArts.forEach((a) => {
            moreItems.push(
              `<button type="button" class="btn-ghost" data-action="open-art" data-artifact-id="${a.id}">打开 ${escapeAttr(
                a.format || "其他格式"
              )}</button>`
            );
          });
          actions +=
            `<details class="act-gen-more"><summary class="muted">更多…</summary><div class="builder-actions">${moreItems.join(
              ""
            )}</div></details>`;
        } else if (st === "生成失败" || st === "因依赖失败暂未生成") {
          actions +=
            `<button type="button" class="btn" data-action="regen" data-deliverable-id="${d.id}">重试生成</button>`;
        }

        return (
          `<div class="act-gen-item" data-deliverable-id="${d.id}">` +
          `<div class="act-gen-item-head"><strong>${escapeAttr(d.title || label)}</strong>` +
          `<span class="muted">${metaParts.map(escapeAttr).join(" · ")}</span></div>` +
          (actions ? `<div class="builder-actions">${actions}</div>` : "") +
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
