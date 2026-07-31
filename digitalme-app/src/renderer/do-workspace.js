"use strict";

/**
 * MVP-DO-WORKFLOW-REBUILD-01 — single do-workspace runtime model + render path.
 *
 * Runtime phases (derived, not a second Store):
 *   draft | ready | running | result | revising | accepted | failed
 *
 * Public API (window.DoWorkspace):
 *   deriveDoWorkspaceViewModel(input)
 *   renderDoWorkspace(viewModel, deps)
 *   requestRender()
 *   startDo / reviseCurrentResult / acceptCurrentResult / openLocalResult / stopDo
 */

(function (global) {
  const PHASES = Object.freeze({
    draft: "draft",
    ready: "ready",
    running: "running",
    result: "result",
    revising: "revising",
    accepted: "accepted",
    failed: "failed",
  });

  /** Ephemeral runtime only — never persisted. */
  const runtime = {
    phaseHint: null, // optional override while async work runs
    busy: false,
    revising: false,
    stopRequested: false,
    lastError: "",
    runningHint: "正在整理任务材料",
    presentedKey: null,
    presentCount: 0,
    resultBodyHtml: "",
    resultBodyText: "",
    resultFormat: "md",
    resultHeading: "",
    acceptLabelVisible: false,
  };

  function $(id, root) {
    const doc = root || (typeof document !== "undefined" ? document : null);
    return doc ? doc.getElementById(id) : null;
  }

  function trimGoal(goal) {
    return String(goal || "").trim();
  }

  function latestAttempt(d, view) {
    if (!d) return null;
    const attempts = (view && view.generationAttempts) || {};
    const id = d.latestGenerationAttemptId;
    return id && attempts[id] ? attempts[id] : null;
  }

  function isGenerationInFlight(packageView) {
    const included = ((packageView && packageView.deliverables) || []).filter(
      (d) => d && d.planDisposition === "included"
    );
    if (!included.length) return !!(runtime.busy || runtime.revising);
    for (const d of included) {
      if (d.generationStatus === "generating") return true;
      const att = latestAttempt(d, packageView);
      if (!att) continue;
      if (att.status === "repairing" || att.outcome === "repair_initiated") return true;
      if (att.phase === "quality_enhancement") return true;
      if (att.enhancement && att.enhancement.pending) return true;
    }
    return false;
  }

  function pickPrimary(packageView, activePackageId) {
    if (!packageView || !packageView.deliverables) return null;
    const included = packageView.deliverables.filter((d) => d && d.planDisposition === "included");
    const versions = packageView.versions || {};
    for (const d of included) {
      if (!(d.generationStatus === "ready" || d.currentVersionId)) continue;
      const ver = d.currentVersionId ? versions[d.currentVersionId] : null;
      if (!ver) continue;
      const arts = []
        .concat(Array.isArray(ver.artifactRefs) ? ver.artifactRefs : [])
        .concat(ver.artifactRef ? [ver.artifactRef] : [])
        .concat(ver.previewRef ? [ver.previewRef] : []);
      const prefer = ["md", "markdown", "txt", "html", "htm", "docx"];
      let primary = null;
      for (const fmt of prefer) {
        primary = arts.find((a) => a && String(a.format || "").toLowerCase() === fmt);
        if (primary) break;
      }
      if (!primary) primary = arts.find((a) => a && a.id);
      if (!primary || !primary.id) continue;
      return {
        deliverableId: String(d.id),
        versionId: String(ver.id),
        artifactId: String(primary.id),
        title: d.title || "成果",
        reviewStatus: ver.reviewStatus || null,
        packageId:
          (packageView.package && packageView.package.id
            ? String(packageView.package.id)
            : null) || activePackageId || null,
      };
    }
    return null;
  }

  /**
   * @param {object} input
   * @param {string} input.goal
   * @param {boolean} input.packageReady
   * @param {boolean} input.modelReady
   * @param {Array} input.materials
   * @param {object|null} input.packageView
   * @param {string|null} input.activePackageId
   * @param {string|null} input.taskId
   * @param {string} input.workspaceHint
   */
  function deriveDoWorkspaceViewModel(input) {
    const goal = trimGoal(input && input.goal);
    const packageReady = !!(input && input.packageReady);
    const modelReady = !!(input && input.modelReady);
    const materials = Array.isArray(input && input.materials) ? input.materials : [];
    const packageView = (input && input.packageView) || null;
    const primary = pickPrimary(packageView, input && input.activePackageId);
    const inFlight = isGenerationInFlight(packageView);
    const accepted = !!(primary && primary.reviewStatus === "accepted");
    const anyFailed =
      packageView &&
      (packageView.deliverables || []).some(
        (d) => d && d.planDisposition === "included" && d.generationStatus === "failed"
      );

    let phase = PHASES.draft;
    if (runtime.phaseHint && Object.values(PHASES).includes(runtime.phaseHint)) {
      phase = runtime.phaseHint;
    } else if (runtime.revising || (runtime.busy && inFlight)) {
      phase = runtime.revising ? PHASES.revising : PHASES.running;
    } else if (runtime.busy) {
      phase = PHASES.running;
    } else if (accepted && primary) {
      phase = PHASES.accepted;
    } else if (primary && !inFlight) {
      phase = PHASES.result;
    } else if (runtime.lastError && !primary) {
      phase = PHASES.failed;
    } else if (!goal) {
      phase = PHASES.draft;
    } else if (packageReady && modelReady) {
      phase = PHASES.ready;
    } else {
      phase = PHASES.draft;
    }

    // Availability for start button — product rules only.
    let startEnabled = false;
    let startReason = "";
    let startReasonAction = null;
    let startLabel = "开始做";
    if (phase === PHASES.running || phase === PHASES.revising || runtime.busy) {
      startEnabled = false;
      startLabel = "正在进行";
    } else if (!packageReady) {
      startReason = "先创建或导入你的 Digital Me。";
    } else if (!modelReady) {
      startReason = "连接模型后即可开始。";
      startReasonAction = "connect_model";
    } else if (!goal) {
      startReason = "先描述你希望完成的工作。";
    } else {
      startEnabled = true;
    }

    return {
      phase,
      goal,
      packageReady,
      modelReady,
      materials,
      materialCount: materials.length,
      taskId: (input && input.taskId) || null,
      activePackageId: (input && input.activePackageId) || null,
      primary,
      start: {
        enabled: startEnabled,
        label: startLabel,
        reason: startReason,
        reasonAction: startReasonAction,
      },
      running: {
        visible: phase === PHASES.running || phase === PHASES.revising,
        hint: runtime.runningHint || "正在完成这项工作……",
      },
      result: {
        visible: phase === PHASES.result || phase === PHASES.accepted,
        heading: runtime.resultHeading || (primary && primary.title) || "成果",
        bodyHtml: runtime.resultBodyHtml || "",
        bodyText: runtime.resultBodyText || "",
        format: runtime.resultFormat || "md",
        revisionEnabled: phase === PHASES.result || phase === PHASES.accepted,
        acceptEnabled: phase === PHASES.result || phase === PHASES.accepted,
        openEnabled: !!(primary && primary.artifactId),
        acceptedVisible: phase === PHASES.accepted || runtime.acceptLabelVisible,
      },
      input: {
        visible: !(phase === PHASES.running || phase === PHASES.revising || phase === PHASES.result || phase === PHASES.accepted),
      },
      hint: runtime.lastError || (input && input.workspaceHint) || "",
      presentCount: runtime.presentCount,
      presentedKey: runtime.presentedKey,
      anyFailed: !!anyFailed,
    };
  }

  function renderDoWorkspace(viewModel, deps) {
    const vm = viewModel || {};
    const escapeHtml =
      (deps && deps.escapeHtml) ||
      ((s) =>
        String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;"));

    const input = $("act-workspace-input");
    const running = $("act-workspace-running");
    const result = $("act-workspace-result");
    const showInput = !!(vm.input && vm.input.visible);
    const showRunning = !!(vm.running && vm.running.visible);
    const showResult = !!(vm.result && vm.result.visible);

    if (input) input.classList.toggle("hidden", !showInput);
    if (running) running.classList.toggle("hidden", !showRunning);
    if (result) result.classList.toggle("hidden", !showResult);

    const stopBtn = $("btn-act-stop");
    if (stopBtn) stopBtn.classList.toggle("hidden", !showRunning);
    const rename = $("act-rename-row");
    if (rename) rename.classList.toggle("hidden", !vm.taskId || showRunning);

    const startBtn = $("btn-act-start-do");
    if (startBtn && vm.start) {
      startBtn.disabled = !vm.start.enabled;
      startBtn.textContent = vm.start.label || "开始做";
      startBtn.setAttribute("aria-disabled", vm.start.enabled ? "false" : "true");
      if (vm.start.reason) startBtn.setAttribute("data-unavailable-reason", "blocked");
      else startBtn.removeAttribute("data-unavailable-reason");
    }
    const reasonEl = $("act-start-do-reason");
    if (reasonEl && vm.start) {
      if (vm.start.enabled || !vm.start.reason) {
        reasonEl.classList.add("hidden");
        reasonEl.textContent = "";
        reasonEl.innerHTML = "";
      } else {
        reasonEl.classList.remove("hidden");
        if (vm.start.reasonAction === "connect_model") {
          reasonEl.innerHTML =
            escapeHtml(vm.start.reason) +
            ' <button type="button" class="btn-link act-start-do-reason-action" data-testid="act-start-do-connect-model">连接模型</button>';
          const actionBtn = reasonEl.querySelector(".act-start-do-reason-action");
          if (actionBtn && deps && typeof deps.openModelConnect === "function") {
            actionBtn.onclick = () => deps.openModelConnect();
          }
        } else {
          reasonEl.textContent = vm.start.reason;
        }
      }
    }

    const runningHint = $("act-running-hint");
    if (runningHint && vm.running) runningHint.textContent = vm.running.hint || "";

    const heading = $("act-result-heading");
    if (heading && vm.result) heading.textContent = vm.result.heading || "";

    const body = $("act-result-body");
    if (body && vm.result && showResult) {
      if (vm.result.format === "html" || vm.result.format === "htm") {
        body.textContent = vm.result.bodyText || "";
      } else if (vm.result.bodyHtml) {
        body.innerHTML = vm.result.bodyHtml;
      }
    }

    const acceptStatus = $("act-accept-status");
    if (acceptStatus && vm.result) {
      acceptStatus.classList.toggle("hidden", !vm.result.acceptedVisible);
      if (vm.result.acceptedVisible) acceptStatus.textContent = "已采用";
    }

    const openBtn = $("btn-act-open-local");
    if (openBtn && vm.result) {
      openBtn.disabled = !vm.result.openEnabled;
    }
    const acceptBtn = $("btn-act-accept-result");
    if (acceptBtn && vm.result) {
      acceptBtn.disabled = !vm.result.acceptEnabled;
    }
    const revisionBtn = $("btn-act-send-revision");
    if (revisionBtn && vm.result) {
      revisionBtn.disabled = !vm.result.revisionEnabled;
    }

    const hint = $("act-workspace-hint");
    if (hint && typeof vm.hint === "string") hint.textContent = vm.hint;

    // Legacy planner panels must never control the formal surface.
    const planPanel = $("act-deliverable-plan-panel");
    if (planPanel) {
      planPanel.classList.add("hidden");
      planPanel.hidden = true;
    }
    const genPanel = $("act-generation-panel");
    if (genPanel) genPanel.classList.add("hidden");

    return vm;
  }

  function setRuntime(patch) {
    Object.assign(runtime, patch || {});
  }

  function getRuntime() {
    return runtime;
  }

  function resetRuntimePresentation() {
    runtime.presentedKey = null;
    runtime.presentCount = 0;
    runtime.resultBodyHtml = "";
    runtime.resultBodyText = "";
    runtime.resultHeading = "";
    runtime.acceptLabelVisible = false;
    runtime.lastError = "";
    runtime.phaseHint = null;
    runtime.busy = false;
    runtime.revising = false;
    runtime.stopRequested = false;
    runtime.runningHint = "正在整理任务材料";
  }

  function presentationKey(primary) {
    if (!primary) return null;
    return [primary.packageId || "", primary.deliverableId || "", primary.versionId || "", primary.artifactId || ""].join(
      "|"
    );
  }

  global.DoWorkspace = {
    PHASES,
    deriveDoWorkspaceViewModel,
    renderDoWorkspace,
    isGenerationInFlight,
    pickPrimary,
    setRuntime,
    getRuntime,
    resetRuntimePresentation,
    presentationKey,
    runtime,
  };
})(typeof window !== "undefined" ? window : globalThis);
