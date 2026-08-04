(() => {
  const api = window.digitalMe;
  if (!api) {
    document.body.textContent = "应用桥接未就绪。请通过 npm run dev 启动。";
    return;
  }

  const els = {
    welcome: document.getElementById("view-welcome"),
    shell: document.getElementById("view-shell"),
    settings: document.getElementById("view-settings"),
    help: document.getElementById("view-help"),
    selfIntro: document.getElementById("self-intro"),
    createPkg: document.getElementById("btn-create-pkg"),
    createSkip: document.getElementById("btn-create-skip"),
    welcomeStatus: document.getElementById("welcome-status"),
    openSettings: document.getElementById("btn-open-settings"),
    openHelp: document.getElementById("btn-open-help"),
    settingsBack: document.getElementById("btn-settings-back"),
    helpBack: document.getElementById("btn-help-back"),
    gotoSettings: document.getElementById("btn-goto-settings"),
    modelGate: document.getElementById("model-gate"),
    modelProvider: document.getElementById("model-provider"),
    modelBaseUrl: document.getElementById("model-base-url"),
    modelId: document.getElementById("model-id"),
    modelApiKey: document.getElementById("model-api-key"),
    modelKeyState: document.getElementById("model-key-state"),
    saveModel: document.getElementById("btn-save-model"),
    testModel: document.getElementById("btn-test-model"),
    deleteModel: document.getElementById("btn-delete-model"),
    settingsStatus: document.getElementById("settings-status"),
    navChat: document.getElementById("nav-chat"),
    navSubject: document.getElementById("nav-subject"),
    navWork: document.getElementById("nav-work"),
    navCollab: document.getElementById("nav-collab"),
    panelChat: document.getElementById("panel-chat"),
    panelSubject: document.getElementById("panel-subject"),
    panelWork: document.getElementById("panel-work"),
    panelCollab: document.getElementById("panel-collab"),
    collabPageHome: document.getElementById("collab-page-home"),
    collabPageNew: document.getElementById("collab-page-new"),
    collabPageDetail: document.getElementById("collab-page-detail"),
    collabListActive: document.getElementById("collab-list-active"),
    collabListDone: document.getElementById("collab-list-done"),
    collabListRevoked: document.getElementById("collab-list-revoked"),
    collabEmptyActive: document.getElementById("collab-empty-active"),
    collabEmptyDone: document.getElementById("collab-empty-done"),
    collabEmptyRevoked: document.getElementById("collab-empty-revoked"),
    btnCollabPageNew: document.getElementById("btn-collab-page-new"),
    btnCollabNewBack: document.getElementById("btn-collab-new-back"),
    collabPagePeerDir: document.getElementById("collab-page-peer-dir"),
    btnCollabPagePickPeer: document.getElementById("btn-collab-page-pick-peer"),
    btnCollabPageImportPeer: document.getElementById("btn-collab-page-import-peer"),
    collabPagePeerEmpty: document.getElementById("collab-page-peer-empty"),
    collabPageSubtask: document.getElementById("collab-page-subtask"),
    collabPageExtra: document.getElementById("collab-page-extra"),
    btnCollabPageAddFiles: document.getElementById("btn-collab-page-add-files"),
    collabPageMaterialChecks: document.getElementById("collab-page-material-checks"),
    collabPageConfirm: document.getElementById("collab-page-confirm"),
    collabPageConfirmPoints: document.getElementById("collab-page-confirm-points"),
    btnCollabPagePreview: document.getElementById("btn-collab-page-preview"),
    btnCollabPageIssue: document.getElementById("btn-collab-page-issue"),
    collabPageNewError: document.getElementById("collab-page-new-error"),
    btnCollabDetailBack: document.getElementById("btn-collab-detail-back"),
    collabDetailPeer: document.getElementById("collab-detail-peer"),
    collabDetailGoal: document.getElementById("collab-detail-goal"),
    collabDetailStatus: document.getElementById("collab-detail-status"),
    collabDetailMaterials: document.getElementById("collab-detail-materials"),
    collabDetailReturn: document.getElementById("collab-detail-return"),
    collabDetailReturnEmpty: document.getElementById("collab-detail-return-empty"),
    collabDetailActions: document.getElementById("collab-detail-actions"),
    btnCollabDetailExecute: document.getElementById("btn-collab-detail-execute"),
    btnCollabDetailAccept: document.getElementById("btn-collab-detail-accept"),
    btnCollabDetailReject: document.getElementById("btn-collab-detail-reject"),
    btnCollabDetailRevoke: document.getElementById("btn-collab-detail-revoke"),
    collabDetailError: document.getElementById("collab-detail-error"),
    collabExtra: document.getElementById("collab-extra"),
    collabMaterialChecks: document.getElementById("collab-material-checks"),
    collabConfirm: document.getElementById("collab-confirm"),
    collabConfirmPoints: document.getElementById("collab-confirm-points"),
    btnCollabPreview: document.getElementById("btn-collab-preview"),
    btnCollabImportPeer: document.getElementById("btn-collab-import-peer"),
    collabPeerEmpty: document.getElementById("collab-peer-empty"),
    collabPeerCard: document.getElementById("collab-peer-card"),
    collabPeerName: document.getElementById("collab-peer-name"),
    collabPeerBrief: document.getElementById("collab-peer-brief"),
    collabPeerPath: document.getElementById("collab-peer-path"),
    collabPagePeerCard: document.getElementById("collab-page-peer-card"),
    collabPagePeerName: document.getElementById("collab-page-peer-name"),
    collabPagePeerBrief: document.getElementById("collab-page-peer-brief"),
    collabPagePeerPath: document.getElementById("collab-page-peer-path"),
    collabBox: document.getElementById("collab-box"),
    chatContext: document.getElementById("chat-context"),
    chatTurns: document.getElementById("chat-turns"),
    chatEmpty: document.getElementById("chat-empty"),
    chatInput: document.getElementById("chat-input"),
    chatSend: document.getElementById("btn-chat-send"),
    chatClear: document.getElementById("btn-chat-clear"),
    chatToTask: document.getElementById("btn-chat-to-task"),
    chatKeepArtifact: document.getElementById("btn-chat-keep-artifact"),
    chatStatus: document.getElementById("chat-status"),
    subjectBrief: document.getElementById("subject-brief"),
    subjectMore: document.getElementById("subject-more"),
    subjectCapture: document.getElementById("btn-subject-capture"),
    importSubjectMaterial: document.getElementById("btn-import-subject-material"),
    subjectActionStatus: document.getElementById("subject-action-status"),
    subjectActiveList: document.getElementById("subject-active-list"),
    subjectActiveEmpty: document.getElementById("subject-active-empty"),
    subjectMaterialList: document.getElementById("subject-material-list"),
    subjectMaterialEmpty: document.getElementById("subject-material-empty"),
    newTask: document.getElementById("btn-new-task"),
    workLayout: document.querySelector("#panel-work .work-layout"),
    workComposeTitle: document.getElementById("work-compose-title"),
    taskList: document.getElementById("task-list"),
    taskEmpty: document.getElementById("task-empty"),
    goal: document.getElementById("goal"),
    artifactType: document.getElementById("artifact-type"),
    materialList: document.getElementById("material-list"),
    addFiles: document.getElementById("btn-add-files"),
    addFolder: document.getElementById("btn-add-folder"),
    clearMaterials: document.getElementById("btn-clear-materials"),
    submit: document.getElementById("btn-submit"),
    cancel: document.getElementById("btn-cancel"),
    retry: document.getElementById("btn-retry"),
    jobStatus: document.getElementById("job-status"),
    jobActionable: document.getElementById("job-actionable"),
    artifactPanel: document.getElementById("artifact-panel"),
    artifactEditor: document.getElementById("artifact-editor"),
    bundleView: document.getElementById("bundle-view"),
    bundleQuality: document.getElementById("bundle-quality"),
    bundleReport: document.getElementById("bundle-report"),
    bundleEvidencePanel: document.getElementById("bundle-evidence-panel"),
    bundleManifest: document.getElementById("bundle-manifest"),
    bundleEntries: document.getElementById("bundle-entries"),
    saveStatus: document.getElementById("save-status"),
    versionMeta: document.getElementById("version-meta"),
    decisionBox: document.getElementById("artifact-decision-box"),
    decisionStatus: document.getElementById("artifact-decision-status"),
    decisionActions: document.getElementById("artifact-decision-actions"),
    decisionNote: document.getElementById("artifact-decision-note"),
    decisionError: document.getElementById("artifact-decision-error"),
    acceptArtifact: document.getElementById("btn-accept-artifact"),
    rejectArtifact: document.getElementById("btn-reject-artifact"),
    revisionRequest: document.getElementById("revision-request"),
    revise: document.getElementById("btn-revise"),
    copy: document.getElementById("btn-copy"),
    exportMd: document.getElementById("btn-export-md"),
    exportDocx: document.getElementById("btn-export-docx"),
    reveal: document.getElementById("btn-reveal"),
    collabOpen: document.getElementById("btn-collab-open"),
    collabForm: document.getElementById("collab-form"),
    collabPeerDir: document.getElementById("collab-peer-dir"),
    collabPickPeer: document.getElementById("btn-collab-pick-peer"),
    collabSubtask: document.getElementById("collab-subtask"),
    collabIssue: document.getElementById("btn-collab-issue"),
    collabStatus: document.getElementById("collab-status"),
    collabReturn: document.getElementById("collab-return"),
    collabActions: document.getElementById("collab-actions"),
    collabExecute: document.getElementById("btn-collab-execute"),
    collabAccept: document.getElementById("btn-collab-accept"),
    collabReject: document.getElementById("btn-collab-reject"),
    collabRevoke: document.getElementById("btn-collab-revoke"),
    collabError: document.getElementById("collab-error"),
  };

  /** @type {{ kind: 'file'|'folder', path: string }[]} */
  let materials = [];
  /** @type {'compose'|'task'} */
  let workMode = "compose";
  let activeTaskId = null;
  let activeJobId = null;
  let activeArtifactId = null;
  let activeHeadVersionId = null;
  let activeGrantId = null;
  /** @type {{ path: string, checked: boolean }[]} */
  let collabPageMaterials = [];
  let saveTimer = null;
  let suppressSave = false;
  let jobWatchTimer = null;
  let jobWatchTaskId = null;
  /** @type {'welcome'|'shell'|'settings'|'help'} */
  let currentView = "welcome";
  let returnView = "welcome";
  /** @type {'chat'|'subject'|'work'|'collab'} */
  let activeNav = "work";
  let lastChatUserText = "";
  let shellStatus = null;
  let displayModelName = null;
  let connectionRefreshSeq = 0;
  /** @type {'document'|'bundle'} */
  let activeArtifactKind = "document";
  let lastQualityGrade = null;
  let lastQualityBannerText = "";
  let copyBlockedFailed = false;

  const presets = {
    deepseek: {
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
    },
    "openai-compatible": {
      baseUrl: "",
      model: "",
    },
  };

  function showStatus(el, text, isError) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("error");
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  function setView(view) {
    currentView = view;
    els.welcome.hidden = view !== "welcome";
    els.shell.hidden = view !== "shell";
    els.settings.hidden = view !== "settings";
    if (els.help) els.help.hidden = view !== "help";
  }

  async function setNav(nav) {
    activeNav = nav;
    for (const btn of [els.navChat, els.navSubject, els.navWork, els.navCollab]) {
      if (!btn) continue;
      btn.classList.toggle("active", btn.dataset.nav === nav);
    }
    if (els.panelChat) els.panelChat.hidden = nav !== "chat";
    if (els.panelSubject) els.panelSubject.hidden = nav !== "subject";
    if (els.panelWork) els.panelWork.hidden = nav !== "work";
    if (els.panelCollab) els.panelCollab.hidden = nav !== "collab";
    if (nav === "chat") await refreshChatPanel();
    if (nav === "subject") await refreshSubjectPanel();
    if (nav === "work") await refreshTasks();
    if (nav === "collab") {
      showCollabPage("home");
      await refreshCollabHome();
    }
  }

  function openSettings() {
    returnView = currentView === "settings" ? returnView : currentView;
    fillSettingsForm();
    setView("settings");
  }

  function openHelp() {
    returnView = currentView === "help" ? returnView : currentView;
    setView("help");
  }

  function deriveModelAvailability(capabilities) {
    const list = Array.isArray(capabilities) ? capabilities : [];
    const documentCaps = list.filter(
      (c) =>
        c &&
        Array.isArray(c.outputArtifactTypes) &&
        c.outputArtifactTypes.includes("document"),
    );
    const codeChangeCaps = list.filter(
      (c) =>
        c &&
        Array.isArray(c.outputArtifactTypes) &&
        c.outputArtifactTypes.includes("code-change"),
    );
    const available = documentCaps.some((c) => c.availability === "available");
    const codeChangeAvailable = codeChangeCaps.some((c) => c.availability === "available");
    const needsSetup = documentCaps.some((c) => c.availability === "needs_setup");
    return {
      available,
      codeChangeAvailable,
      needsSetup: !available && needsSetup,
      showGate: !available,
      capabilities: list,
    };
  }

  function selectedArtifactType() {
    return "document";
  }

  function canSubmit(state) {
    return !!(state && state.available);
  }

  async function refreshConnectionFromCapabilities() {
    const seq = ++connectionRefreshSeq;
    let capabilities = [];
    try {
      const result = await api.invoke("capability.list", {});
      capabilities = (result && result.capabilities) || [];
    } catch {
      capabilities = [];
    }
    if (seq !== connectionRefreshSeq) {
      return deriveModelAvailability(capabilities).available;
    }
    const state = deriveModelAvailability(capabilities);
    applyConnectionUi(state);
    return state.available;
  }

  let lastConnectionState = { available: false, codeChangeAvailable: false, showGate: true };

  function applyConnectionUi(state) {
    lastConnectionState = state || lastConnectionState;
    const available = !!(state && state.available);
    const submitReady = canSubmit(state);
    const showGate = state ? !!state.showGate : !available;

    if (els.modelGate) {
      if (showGate) {
        els.modelGate.hidden = false;
        els.modelGate.removeAttribute("hidden");
        els.modelGate.style.display = "";
        const p = els.modelGate.querySelector("p");
        if (p) {
          p.textContent = "请先连接模型，才能开始处理任务。";
        }
      } else {
        els.modelGate.hidden = true;
        els.modelGate.setAttribute("hidden", "");
        els.modelGate.style.display = "none";
      }
    }

    els.submit.disabled = !submitReady;
    if (!submitReady) {
      els.submit.title = "请先连接模型";
      els.retry.disabled = true;
      els.revise.disabled = true;
    } else {
      els.submit.title = "";
      els.revise.disabled = !activeArtifactId;
    }
    const configured = !!(shellStatus && shellStatus.credentialConfigured) || available;
    if (els.modelKeyState) {
      els.modelKeyState.textContent = configured ? "凭证状态：已配置" : "凭证状态：未配置";
    }
    if (els.deleteModel) els.deleteModel.disabled = !configured;
  }

  function rememberShellMeta(info) {
    shellStatus = (info && info.status) || shellStatus;
    if (info && info.modelMeta && info.modelMeta.model) {
      displayModelName = info.modelMeta.model;
    } else if (shellStatus && shellStatus.model) {
      displayModelName = shellStatus.model;
    } else if (info && info.modelReady === false) {
      displayModelName = null;
    }
    if (shellStatus && shellStatus.presets && shellStatus.presets.deepseek) {
      presets.deepseek.baseUrl =
        shellStatus.presets.deepseek.baseUrl || presets.deepseek.baseUrl;
      presets.deepseek.model = shellStatus.presets.deepseek.model || presets.deepseek.model;
    }
  }

  function fillSettingsForm() {
    const status = shellStatus || {};
    const preset =
      status.providerPreset ||
      (status.baseUrl && String(status.baseUrl).includes("deepseek")
        ? "deepseek"
        : "openai-compatible");
    els.modelProvider.value = preset === "deepseek" ? "deepseek" : "openai-compatible";
    els.modelBaseUrl.value = status.baseUrl || presets[els.modelProvider.value].baseUrl || "";
    els.modelId.value = status.model || presets[els.modelProvider.value].model || "";
    els.modelApiKey.value = "";
    showStatus(els.settingsStatus, "");
  }

  function applyProviderPreset() {
    const key = els.modelProvider.value;
    const preset = presets[key] || presets["openai-compatible"];
    if (key === "deepseek") {
      els.modelBaseUrl.value = preset.baseUrl;
      if (!els.modelId.value.trim()) els.modelId.value = preset.model;
    }
  }

  function renderMaterials() {
    els.materialList.innerHTML = "";
    for (const item of materials) {
      const li = document.createElement("li");
      const kind = item.kind === "folder" ? "文件夹" : "文件";
      li.innerHTML = `<strong>${kind}</strong><div class="muted">${escapeHtml(item.path)}</div>`;
      els.materialList.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function labelForState(state, userFacingLabel) {
    if (userFacingLabel) return userFacingLabel;
    switch (state) {
      case "waiting":
        return "等待开始";
      case "processing":
        return "正在处理";
      case "completed":
        return "已完成";
      case "attention":
        return "需要处理";
      default:
        return "进行中";
    }
  }

  function labelFromJobDetail(detail) {
    if (detail && detail.userFacingLabel) return detail.userFacingLabel;
    const job = detail && detail.latestJob;
    if (job) {
      switch (job.status) {
        case "queued":
          return "等待开始";
        case "running":
          return job.revisionRequest ? "正在修改" : "正在处理";
        case "succeeded":
          return detail.artifactIds && detail.artifactIds[0] ? "已完成" : "需要处理";
        case "failed":
          return "失败";
        case "cancelled":
          return "已取消";
      }
    }
    return labelForState(detail && detail.state);
  }

  function formatElapsed(startIso) {
    if (!startIso) return "";
    const start = Date.parse(startIso);
    if (Number.isNaN(start)) return "";
    const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
    if (sec < 60) return `${sec} 秒`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (min < 60) return rem ? `${min} 分 ${rem} 秒` : `${min} 分`;
    const hr = Math.floor(min / 60);
    const mrem = min % 60;
    return mrem ? `${hr} 小时 ${mrem} 分` : `${hr} 小时`;
  }

  function setWorkLayoutArtifact(hasArtifact) {
    if (!els.workLayout) return;
    els.workLayout.classList.toggle("has-artifact", !!hasArtifact);
  }

  function setCopyEnabled(enabled) {
    if (!els.copy) return;
    els.copy.disabled = !enabled;
    els.copy.hidden = !enabled;
    if (!enabled) els.copy.setAttribute("hidden", "");
    else els.copy.removeAttribute("hidden");
  }

  function clearArtifactView() {
    activeArtifactId = null;
    activeHeadVersionId = null;
    resetCollabUi();
    copyBlockedFailed = false;
    setCopyEnabled(false);
    els.artifactPanel.hidden = true;
    els.artifactPanel.setAttribute("hidden", "");
    setWorkLayoutArtifact(false);
    if (els.revise) els.revise.disabled = true;
    renderArtifactDecision({ status: "undecided" });
    if (els.decisionNote) els.decisionNote.value = "";
    showStatus(els.decisionError, "");
  }

  function renderArtifactDecision(decision) {
    if (!els.decisionStatus) return;
    const status = decision && decision.status ? decision.status : "undecided";
    if (status === "accepted") {
      els.decisionStatus.textContent = "已采用";
      if (els.decisionActions) els.decisionActions.hidden = true;
      if (els.decisionNote) els.decisionNote.closest(".decision-note").hidden = true;
    } else if (status === "rejected") {
      els.decisionStatus.textContent = "未采用";
      if (els.decisionActions) els.decisionActions.hidden = false;
      if (els.decisionNote) els.decisionNote.closest(".decision-note").hidden = false;
    } else {
      els.decisionStatus.textContent = "尚未决定是否采用";
      if (els.decisionActions) els.decisionActions.hidden = false;
      if (els.decisionNote) els.decisionNote.closest(".decision-note").hidden = false;
    }
    if (els.acceptArtifact) els.acceptArtifact.disabled = status === "accepted";
    if (els.rejectArtifact) els.rejectArtifact.disabled = status === "rejected";
  }

  async function submitArtifactDecision(kind) {
    showStatus(els.decisionError, "");
    if (!activeArtifactId || !activeHeadVersionId || !activeTaskId) {
      showStatus(els.decisionError, "当前没有可决定的成果", true);
      return;
    }
    const note = els.decisionNote ? String(els.decisionNote.value || "").trim() : "";
    const goal = els.goal && els.goal.value ? String(els.goal.value).trim() : "";
    const baseText =
      kind === "accept"
        ? note || `采用成果：${goal || "本次任务"}`.slice(0, 400)
        : note || `未采用成果：${goal || "本次任务"}`.slice(0, 400);
    const prevLabel = els.decisionStatus ? els.decisionStatus.textContent : "";
    if (els.acceptArtifact) els.acceptArtifact.disabled = true;
    if (els.rejectArtifact) els.rejectArtifact.disabled = true;
    try {
      const result = await api.invoke("subject.captureInput", {
        text: baseText,
        sourceKind: kind === "accept" ? "artifact_acceptance" : "artifact_rejection",
        taskId: activeTaskId,
        artifactId: activeArtifactId,
        artifactVersionId: activeHeadVersionId,
        requestedArtifactType: "document",
      });
      const status =
        (result && result.ownerDecision) || (kind === "accept" ? "accepted" : "rejected");
      renderArtifactDecision({ status });
      if (els.decisionNote && status === "accepted") els.decisionNote.value = "";
    } catch (err) {
      renderArtifactDecision({
        status: prevLabel === "已采用" ? "accepted" : prevLabel === "未采用" ? "rejected" : "undecided",
      });
      showStatus(els.decisionError, err.message || "未能保存决定，请重试", true);
    }
  }

  function stopJobWatch() {
    if (jobWatchTimer) {
      clearInterval(jobWatchTimer);
      jobWatchTimer = null;
    }
    jobWatchTaskId = null;
  }

  function isJobActive(detail) {
    const status = detail && detail.latestJob && detail.latestJob.status;
    return status === "queued" || status === "running";
  }

  function startJobWatch(taskId) {
    if (jobWatchTaskId === taskId && jobWatchTimer) return;
    stopJobWatch();
    jobWatchTaskId = taskId;
    jobWatchTimer = setInterval(async () => {
      if (workMode !== "task" || activeTaskId !== taskId) {
        stopJobWatch();
        return;
      }
      try {
        const detail = await api.invoke("work.getTask", { taskId });
        if (!isJobActive(detail)) {
          await syncActiveTaskStatus();
          return;
        }
        renderJobStatus(detail);
      } catch {
        /* ignore transient */
      }
    }, 1000);
  }

  function clearJobChrome() {
    stopJobWatch();
    els.jobStatus.textContent = "";
    els.jobStatus.classList.remove("error");
    els.jobActionable.textContent = "";
    els.cancel.disabled = true;
    els.retry.disabled = true;
  }

  function startNewTaskComposer() {
    workMode = "compose";
    activeTaskId = null;
    activeJobId = null;
    materials = [];
    renderMaterials();
    els.goal.value = "";
    els.goal.readOnly = false;
    if (els.workComposeTitle) els.workComposeTitle.textContent = "新建任务";
    clearJobChrome();
    clearArtifactView();
    setWorkCollabVisible(false);
    refreshTasks();
  }

  function setWorkCollabVisible(visible) {
    if (!els.collabBox) return;
    els.collabBox.hidden = !visible;
    if (!visible) resetCollabUi();
  }

  async function refreshTasks() {
    const { tasks } = await api.invoke("work.listTasks", { limit: 50 });
    els.taskList.innerHTML = "";
    els.taskEmpty.hidden = tasks.length > 0;
    for (const t of tasks) {
      const li = document.createElement("li");
      if (workMode === "task" && t.taskId === activeTaskId) li.classList.add("active");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "linkish";
      const stateLabel = t.userFacingLabel || labelForState(t.state);
      btn.innerHTML = `<div class="task-goal">${escapeHtml(t.goal.slice(0, 80))}</div>
        <div class="task-state">${escapeHtml(stateLabel)}</div>`;
      btn.addEventListener("click", () => selectTask(t.taskId));
      li.appendChild(btn);
      els.taskList.appendChild(li);
    }
  }

  function isLatestJobFailed(detail) {
    return !!(detail && detail.latestJob && detail.latestJob.status === "failed");
  }

  function userFacingFailureReason(detail, eventNote) {
    const fromEvent = eventNote != null ? String(eventNote).trim() : "";
    if (fromEvent) return fromEvent;
    const actionable =
      detail && detail.latestJob && detail.latestJob.actionable != null
        ? String(detail.latestJob.actionable).trim()
        : "";
    if (actionable) return actionable;
    const fromJob =
      detail && detail.latestJob && detail.latestJob.progressNote != null
        ? String(detail.latestJob.progressNote).trim()
        : "";
    if (fromJob) return fromJob;
    return "处理未能完成。";
  }

  function renderJobStatus(detail, eventNote) {
    const failed = isLatestJobFailed(detail);
    const cancelled = !!(detail && detail.latestJob && detail.latestJob.status === "cancelled");
    let label = labelFromJobDetail(detail);
    const job = detail && detail.latestJob;
    if (job && job.status === "running") {
      const elapsed = formatElapsed(job.startedAt || job.createdAt);
      if (elapsed) label += ` · ${elapsed}`;
      const startMs = Date.parse(job.startedAt || job.createdAt || "");
      if (!Number.isNaN(startMs) && Date.now() - startMs >= 30000) {
        label += " · 仍在处理";
      }
    }
    els.jobStatus.textContent = label;
    els.jobStatus.classList.toggle("error", failed);
    els.jobActionable.textContent = "";
    if (failed) {
      els.jobActionable.textContent = userFacingFailureReason(detail, eventNote);
    } else if (cancelled) {
      els.jobActionable.textContent = "任务已取消。可以重试。";
    } else if (detail.state === "attention") {
      els.jobActionable.textContent = "可以重试，或调整目标与材料后再试。";
    }
  }

  function applyJobControls(detail, connected) {
    const job = detail && detail.latestJob;
    const status = job && job.status;
    els.cancel.disabled = !(job && (status === "queued" || status === "running"));
    els.retry.disabled =
      !connected || !(job && (status === "failed" || status === "cancelled"));
  }

  async function syncActiveTaskStatus(eventNote, eventStatus) {
    if (!activeTaskId || workMode !== "task") return null;
    const detail = await api.invoke("work.getTask", { taskId: activeTaskId });
    activeJobId = detail.latestJob ? detail.latestJob.jobId : activeJobId;
    renderJobStatus(detail, eventNote);
    const connected = await refreshConnectionFromCapabilities();
    applyJobControls(detail, connected);

    if (isJobActive(detail)) {
      startJobWatch(activeTaskId);
      clearArtifactView();
    } else {
      stopJobWatch();
      const terminalStatus = detail.latestJob && detail.latestJob.status;
      if (
        terminalStatus === "succeeded" &&
        detail.artifactIds &&
        detail.artifactIds[0] &&
        (!eventStatus || eventStatus === "succeeded")
      ) {
        copyBlockedFailed = false;
        activeArtifactId = detail.artifactIds[0];
        await loadArtifact(activeArtifactId);
      } else {
        clearArtifactView();
      }
    }
    await refreshTasks();
    return detail;
  }

  async function selectTask(taskId) {
    workMode = "task";
    activeTaskId = taskId;
    if (els.workComposeTitle) els.workComposeTitle.textContent = "当前任务";
    const detail = await api.invoke("work.getTask", { taskId });
    activeJobId = detail.latestJob ? detail.latestJob.jobId : null;
    els.goal.value = detail.task && detail.task.goal ? detail.task.goal : "";
    els.goal.readOnly = true;
    const refs =
      detail.task && Array.isArray(detail.task.contextRefs) ? detail.task.contextRefs : [];
    materials = refs
      .filter((r) => r && (r.kind === "file" || r.kind === "folder") && r.path)
      .map((r) => ({ kind: r.kind, path: r.path }));
    renderMaterials();
    renderJobStatus(detail);
    const connected = await refreshConnectionFromCapabilities();
    applyJobControls(detail, connected);
    setWorkCollabVisible(true);

    if (isJobActive(detail)) {
      startJobWatch(taskId);
      clearArtifactView();
    } else {
      stopJobWatch();
      if (
        detail.latestJob &&
        detail.latestJob.status === "succeeded" &&
        detail.artifactIds &&
        detail.artifactIds[0]
      ) {
        copyBlockedFailed = false;
        activeArtifactId = detail.artifactIds[0];
        await loadArtifact(activeArtifactId);
      } else {
        clearArtifactView();
      }
    }
    await refreshTasks();
    await syncWorkCollabFromDomain();
  }

  async function loadArtifact(artifactId) {
    const content = await api.invoke("artifact.getContent", { artifactId });
    const isBundle = !!(content.content && content.content.kind === "bundle");
    activeArtifactId = artifactId;
    activeHeadVersionId = content.headVersionId || null;
    copyBlockedFailed = false;
    els.artifactPanel.hidden = false;
    els.artifactPanel.removeAttribute("hidden");
    setWorkLayoutArtifact(true);
    els.versionMeta.textContent = `版本 ${content.versionCount}`;
    setCopyEnabled(true);
    showStatus(els.decisionError, "");
    renderArtifactDecision(content.ownerDecision || { status: "undecided" });
    if (els.decisionBox) {
      els.decisionBox.hidden = false;
      els.decisionBox.removeAttribute("hidden");
    }

    if (isBundle) {
      activeArtifactKind = "bundle";
      const qualityUi =
        (window.DigitalMeBundleQualityUi &&
          window.DigitalMeBundleQualityUi.resolveBundleQualityUi(content)) || {
          grade: null,
          bannerText: "",
          saveStatus: "已载入",
        };
      lastQualityGrade = qualityUi.grade;
      lastQualityBannerText = qualityUi.bannerText || "";
      els.bundleView.hidden = false;
      els.bundleView.removeAttribute("hidden");
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
      els.revise.closest(".revise-box").hidden = true;
      els.bundleReport.textContent = content.text || "";
      if (els.bundleQuality) {
        if (qualityUi.bannerText) {
          els.bundleQuality.hidden = false;
          els.bundleQuality.textContent = qualityUi.bannerText;
          els.bundleQuality.className = `bundle-quality ${qualityUi.cssClass || ""}`.trim();
        } else {
          els.bundleQuality.hidden = true;
        }
      }
      els.bundleManifest.textContent = "";
      els.bundleEntries.innerHTML = "";
      if (content.bundle && content.bundle.manifestSummary) {
        const m = content.bundle.manifestSummary;
        els.bundleManifest.textContent = `扫描 ${m.fileCountScanned || 0} 个文件`;
      }
      els.exportMd.hidden = true;
      els.exportDocx.hidden = true;
      els.reveal.hidden = false;
      els.saveStatus.textContent = qualityUi.saveStatus;
      els.revise.disabled = true;
    } else {
      activeArtifactKind = "document";
      lastQualityGrade = null;
      lastQualityBannerText = "";
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
      els.artifactEditor.hidden = false;
      els.artifactEditor.removeAttribute("hidden");
      els.revise.closest(".revise-box").hidden = false;
      els.exportMd.hidden = false;
      els.exportDocx.hidden = false;
      suppressSave = true;
      els.artifactEditor.value = content.text || "";
      suppressSave = false;
      els.saveStatus.textContent = "已载入最新内容";
      const connected = await refreshConnectionFromCapabilities();
      els.revise.disabled = !connected;
    }
    await syncWorkCollabFromDomain();
  }

  async function refreshSubjectPanel() {
    const overview = await api.invoke("subject.getOverview", {});
    const brief =
      (overview.activeUnderstandings &&
        overview.activeUnderstandings[0] &&
        overview.activeUnderstandings[0].text) ||
      overview.summaryLine ||
      overview.displayName ||
      "";
    els.subjectBrief.textContent = brief;

    const items = overview.activeUnderstandings || [];
    els.subjectActiveList.innerHTML = "";
    els.subjectActiveEmpty.hidden = items.length > 0;
    for (const item of items) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="subject-item-text">${escapeHtml(item.text)}</div>`;
      const row = document.createElement("div");
      row.className = "subject-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "ghost";
      edit.textContent = "修改";
      edit.addEventListener("click", async () => {
        const next = window.prompt("请写出更准确的说法：", item.text);
        if (next == null || !String(next).trim()) return;
        await api.invoke("subject.respondToLearning", {
          eventId: item.eventId,
          action: "revise",
          revisionText: String(next).trim(),
        });
        await refreshSubjectPanel();
      });
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "ghost";
      stop.textContent = "停止使用";
      stop.addEventListener("click", async () => {
        await api.invoke("subject.respondToLearning", {
          eventId: item.eventId,
          action: "retire",
        });
        await refreshSubjectPanel();
      });
      row.appendChild(edit);
      row.appendChild(stop);
      li.appendChild(row);
      els.subjectActiveList.appendChild(li);
    }

    if (els.subjectMaterialList && els.subjectMaterialEmpty) {
      const matItems = overview.materials || [];
      els.subjectMaterialList.innerHTML = "";
      els.subjectMaterialEmpty.hidden = matItems.length > 0;
      for (const mat of matItems) {
        const li = document.createElement("li");
        const addedAt = mat.addedAt ? new Date(mat.addedAt).toLocaleString() : "";
        li.innerHTML = `<div><strong>${escapeHtml(mat.fileName)}</strong></div>
          <div class="muted tiny">${escapeHtml(addedAt)}</div>`;
        const row = document.createElement("div");
        row.className = "subject-actions";
        const revealBtn = document.createElement("button");
        revealBtn.type = "button";
        revealBtn.className = "ghost";
        revealBtn.textContent = "打开所在位置";
        revealBtn.addEventListener("click", () => {
          if (mat.absolutePath) api.revealPath(mat.absolutePath);
        });
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ghost";
        removeBtn.textContent = "移除";
        removeBtn.addEventListener("click", async () => {
          if (!window.confirm(`确定移除「${mat.fileName}」？`)) return;
          try {
            els.subjectActionStatus.textContent = "正在移除…";
            const result = await api.invoke("subject.removeMaterial", {
              materialRef: mat.materialRef,
            });
            await refreshSubjectPanel();
            els.subjectActionStatus.textContent =
              result && result.removed === false
                ? "未找到该资料，列表已刷新。"
                : "资料已移除。";
          } catch (err) {
            els.subjectActionStatus.textContent =
              (err && err.message) || "移除失败，请重试。";
          }
        });
        row.appendChild(revealBtn);
        row.appendChild(removeBtn);
        li.appendChild(row);
        els.subjectMaterialList.appendChild(li);
      }
    }
  }

  async function refreshChatPanel() {
    if (!els.chatTurns) return;
    try {
      const overview = await api.invoke("subject.getOverview", {});
      const knownPoints = (overview.activeUnderstandings || []).slice(0, 3);
      if (els.chatContext) {
        if (knownPoints.length) {
          els.chatContext.hidden = false;
          els.chatContext.textContent =
            "可参考已确认内容：" + knownPoints.map((c) => c.text).join("；");
        } else {
          els.chatContext.hidden = true;
          els.chatContext.textContent = "";
        }
      }
    } catch {
      if (els.chatContext) {
        els.chatContext.hidden = true;
      }
    }

    let turns = [];
    try {
      if (api.conversation && typeof api.conversation.list === "function") {
        const listed = await api.conversation.list();
        turns = (listed && listed.turns) || [];
      }
    } catch {
      turns = [];
    }
    els.chatTurns.innerHTML = "";
    if (els.chatEmpty) els.chatEmpty.hidden = turns.length > 0;
    for (const turn of turns) {
      const li = document.createElement("li");
      const roleLabel =
        turn.role === "user" ? "你" : turn.role === "assistant" ? "数字之我" : "提示";
      li.className = `chat-turn chat-turn-${turn.role || "system"}`;
      li.innerHTML = `<div class="chat-role">${escapeHtml(roleLabel)}</div>
        <div class="chat-text">${escapeHtml(turn.text || "")}</div>`;
      els.chatTurns.appendChild(li);
      if (turn.role === "user" && turn.text) lastChatUserText = turn.text;
    }
  }

  async function enterShell() {
    setView("shell");
    setNav("work");
    startNewTaskComposer();
    await refreshConnectionFromCapabilities();
    await refreshTasks();
    await refreshSubjectPanel();
  }

  async function createOrOpenDefaultPackage(opts) {
    const skipIntro = !!(opts && opts.skipIntro);
    const intro = skipIntro ? "" : ((els.selfIntro && els.selfIntro.value) || "").trim();
    if (typeof api.getDefaultSubjectDir !== "function") {
      throw new Error("默认主体目录不可用");
    }
    const loc = await api.getDefaultSubjectDir();
    if (!loc || !loc.dir) throw new Error("无法解析默认主体目录");

    if (loc.exists) {
      await api.invoke("subject.openPackage", { dir: loc.dir });
      if (intro) {
        await api.invoke("subject.captureInput", {
          text: intro,
          sourceKind: "initial_self_description",
        });
      }
    } else {
      const displayName = intro
        ? intro.slice(0, 24).replace(/\s+/g, " ")
        : "我的数字之我";
      const input = { displayName, targetDir: loc.dir };
      if (intro) input.initialSelfDescription = intro;
      await api.invoke("subject.createPackage", input);
    }
    showStatus(els.welcomeStatus, "");
    await enterShell();
  }

  async function tryAutoOpenDefault() {
    if (typeof api.getDefaultSubjectDir !== "function") return false;
    try {
      const loc = await api.getDefaultSubjectDir();
      if (!loc || !loc.exists) return false;
      await api.invoke("subject.openPackage", { dir: loc.dir });
      await enterShell();
      return true;
    } catch {
      return false;
    }
  }

  els.createPkg.addEventListener("click", async () => {
    try {
      await createOrOpenDefaultPackage({ skipIntro: false });
    } catch (err) {
      showStatus(els.welcomeStatus, err.message || String(err), true);
    }
  });

  els.createSkip.addEventListener("click", async () => {
    try {
      await createOrOpenDefaultPackage({ skipIntro: true });
    } catch (err) {
      showStatus(els.welcomeStatus, err.message || String(err), true);
    }
  });

  if (els.navChat) els.navChat.addEventListener("click", () => setNav("chat"));
  els.navSubject.addEventListener("click", () => setNav("subject"));
  els.navWork.addEventListener("click", () => setNav("work"));
  if (els.navCollab) els.navCollab.addEventListener("click", () => setNav("collab"));
  els.newTask.addEventListener("click", () => {
    setNav("work");
    startNewTaskComposer();
  });

  if (els.chatSend) {
    els.chatSend.addEventListener("click", async () => {
      try {
        const text = ((els.chatInput && els.chatInput.value) || "").trim();
        if (!text) {
          if (els.chatStatus) els.chatStatus.textContent = "请先写一句话。";
          return;
        }
        if (!api.conversation || typeof api.conversation.append !== "function") {
          throw new Error("对话功能不可用");
        }
        els.chatSend.disabled = true;
        if (els.chatStatus) els.chatStatus.textContent = "正在发送…";
        await api.conversation.append({ role: "user", text });
        lastChatUserText = text;
        try {
          await api.invoke("subject.captureInput", {
            text,
            sourceKind: "conversation",
          });
        } catch {
          /* 捕捉失败不阻断对话落盘 */
        }
        await api.conversation.append({
          role: "assistant",
          text: "已记下。需要做成具体工作时，可点「转为任务」。",
        });
        if (els.chatInput) els.chatInput.value = "";
        await refreshChatPanel();
        if (els.chatStatus) els.chatStatus.textContent = "已发送。";
      } catch (err) {
        if (els.chatStatus) els.chatStatus.textContent = (err && err.message) || String(err);
      } finally {
        if (els.chatSend) els.chatSend.disabled = false;
      }
    });
  }

  if (els.chatClear) {
    els.chatClear.addEventListener("click", async () => {
      if (!window.confirm("清空对话记录？已确认的内容不会被删除。")) return;
      try {
        if (!api.conversation || typeof api.conversation.clear !== "function") {
          throw new Error("对话功能不可用");
        }
        await api.conversation.clear();
        lastChatUserText = "";
        await refreshChatPanel();
        if (els.chatStatus) els.chatStatus.textContent = "对话已清空。";
      } catch (err) {
        if (els.chatStatus) els.chatStatus.textContent = (err && err.message) || String(err);
      }
    });
  }

  if (els.chatToTask) {
    els.chatToTask.addEventListener("click", async () => {
      const text =
        lastChatUserText ||
        ((els.chatInput && els.chatInput.value) || "").trim();
      if (!text) {
        if (els.chatStatus) els.chatStatus.textContent = "请先发送或填写一句话。";
        return;
      }
      await setNav("work");
      startNewTaskComposer();
      els.goal.value = text;
      if (els.chatStatus) els.chatStatus.textContent = "已带到做事页，可直接开始处理。";
    });
  }

  els.openSettings.addEventListener("click", () => openSettings());
  if (els.openHelp) els.openHelp.addEventListener("click", () => openHelp());
  els.gotoSettings.addEventListener("click", () => openSettings());
  els.settingsBack.addEventListener("click", () => setView(returnView || "shell"));
  if (els.helpBack) els.helpBack.addEventListener("click", () => setView(returnView || "shell"));
  els.modelProvider.addEventListener("change", () => applyProviderPreset());
  if (els.artifactType) {
    els.artifactType.addEventListener("change", () => refreshConnectionFromCapabilities());
  }

  els.saveModel.addEventListener("click", async () => {
    try {
      const apiKey = (els.modelApiKey.value || "").trim();
      const baseUrl = (els.modelBaseUrl.value || "").trim();
      const model = (els.modelId.value || "").trim();
      if (!apiKey) {
        showStatus(els.settingsStatus, "请输入 API Key 后再保存", true);
        return;
      }
      if (!baseUrl || !model) {
        showStatus(els.settingsStatus, "请填写 Base URL 与 Model ID", true);
        return;
      }
      els.saveModel.disabled = true;
      const result = await api.saveModelCredential({
        apiKey,
        baseUrl,
        model,
        providerPreset: els.modelProvider.value,
      });
      rememberShellMeta(result || {});
      els.modelApiKey.value = "";
      const connected = await refreshConnectionFromCapabilities();
      showStatus(
        els.settingsStatus,
        connected ? "已保存并连接。" : "已保存。请确认连接信息后重试。",
        !connected,
      );
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
    } finally {
      els.saveModel.disabled = false;
    }
  });

  els.testModel.addEventListener("click", async () => {
    try {
      const result = await api.testModelConnection({
        baseUrl: (els.modelBaseUrl.value || "").trim(),
        model: (els.modelId.value || "").trim(),
        apiKey: (els.modelApiKey.value || "").trim() || undefined,
        providerPreset: els.modelProvider.value,
      });
      showStatus(
        els.settingsStatus,
        result && result.ok ? "连接正常。" : (result && result.reason) || "连接失败",
        !(result && result.ok),
      );
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
    }
  });

  els.deleteModel.addEventListener("click", async () => {
    try {
      const result = await api.deleteModelCredential({});
      rememberShellMeta(result || {});
      await refreshConnectionFromCapabilities();
      showStatus(els.settingsStatus, "已删除模型凭证。");
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
      await refreshConnectionFromCapabilities();
    }
  });

  els.addFiles.addEventListener("click", async () => {
    const files = await api.dialogs.pickOpenFiles();
    for (const p of files || []) materials.push({ kind: "file", path: p });
    renderMaterials();
  });

  els.addFolder.addEventListener("click", async () => {
    const folder = await api.dialogs.pickOpenDirectory();
    if (folder) materials.push({ kind: "folder", path: folder });
    renderMaterials();
  });

  els.clearMaterials.addEventListener("click", () => {
    materials = [];
    renderMaterials();
  });

  function normalizeEditablePaste(event) {
    const normalize =
      (window.DigitalMeText && window.DigitalMeText.normalizeNewlines) ||
      ((t) => String(t ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const raw = clipboardData.getData("text/plain");
    if (raw == null) return;
    event.preventDefault();
    const text = normalize(raw);
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const before = target.value.slice(0, start);
    const after = target.value.slice(end);
    target.value = before + text + after;
    const pos = before.length + text.length;
    target.setSelectionRange(pos, pos);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  for (const el of [
    els.goal,
    els.artifactEditor,
    els.revisionRequest,
    els.selfIntro,
    els.subjectMore,
    els.chatInput,
    els.modelBaseUrl,
    els.modelId,
    els.modelApiKey,
  ]) {
    if (el) el.addEventListener("paste", normalizeEditablePaste);
  }

  els.subjectCapture.addEventListener("click", async () => {
    try {
      const text = (els.subjectMore.value || "").trim();
      if (!text) {
        els.subjectActionStatus.textContent = "请先写下一句话。";
        return;
      }
      await api.invoke("subject.captureInput", {
        text,
        sourceKind: "conversation",
      });
      els.subjectMore.value = "";
      els.subjectActionStatus.textContent = "已保存。";
      await refreshSubjectPanel();
    } catch (err) {
      els.subjectActionStatus.textContent = err.message || String(err);
    }
  });

  els.importSubjectMaterial.addEventListener("click", async () => {
    try {
      const files = await api.dialogs.pickOpenFiles();
      if (!files || !files.length) return;
      els.subjectActionStatus.textContent = "正在添加…";
      for (const filePath of files.slice(0, 3)) {
        await api.invoke("subject.importMaterial", {
          sourcePath: filePath,
          distillCandidates: true,
        });
      }
      await refreshSubjectPanel();
      els.subjectActionStatus.textContent = "资料已添加。";
    } catch (err) {
      els.subjectActionStatus.textContent = err.message || String(err);
    }
  });

  els.submit.addEventListener("click", async () => {
    try {
      await refreshConnectionFromCapabilities();
      const type = selectedArtifactType();
      if (!canSubmit(lastConnectionState)) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        els.jobActionable.textContent = "前往设置连接真实模型后再开始处理。";
        return;
      }
      // 新建任务必须从 compose 发起，避免覆盖旧任务输入冒充新任务
      if (workMode !== "compose") {
        els.jobStatus.textContent = "请先点击「新建任务」";
        els.jobStatus.classList.add("error");
        return;
      }
      const normalize =
        (window.DigitalMeText && window.DigitalMeText.normalizeNewlines) ||
        ((t) => String(t ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      const goalNormalized = normalize(els.goal.value || "");
      if (els.goal.value !== goalNormalized) els.goal.value = goalNormalized;
      const goal = goalNormalized.trim();
      if (!goal) {
        els.jobStatus.textContent = "请先填写任务目标";
        els.jobStatus.classList.add("error");
        return;
      }
      els.submit.disabled = true;
      clearArtifactView();
      const result = await api.invoke("work.submitTask", {
        goal,
        contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path })),
        requestedArtifactType: type,
      });
      workMode = "task";
      activeTaskId = result.taskId;
      activeJobId = result.jobId;
      els.goal.readOnly = true;
      if (els.workComposeTitle) els.workComposeTitle.textContent = "当前任务";
      try {
        await api.invoke("subject.captureInput", {
          text: goal,
          sourceKind: "task_requirement",
          taskId: result.taskId,
        });
      } catch {
        /* ignore */
      }
      await syncActiveTaskStatus();
      startJobWatch(activeTaskId);
    } catch (err) {
      els.jobStatus.textContent = err.message || String(err);
      els.jobStatus.classList.add("error");
    } finally {
      await refreshConnectionFromCapabilities();
    }
  });

  els.revise.addEventListener("click", async () => {
    try {
      if (!activeTaskId || !activeArtifactId || workMode !== "task") return;
      const connected = await refreshConnectionFromCapabilities();
      if (!connected) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        return;
      }
      const revisionRequest = (els.revisionRequest.value || "").trim();
      if (!revisionRequest) {
        els.jobStatus.textContent = "请先说明如何修改";
        els.jobStatus.classList.add("error");
        return;
      }
      const result = await api.invoke("work.reviseArtifact", {
        taskId: activeTaskId,
        artifactId: activeArtifactId,
        revisionRequest,
      });
      activeJobId = result.jobId;
      await syncActiveTaskStatus();
      startJobWatch(activeTaskId);
    } catch (err) {
      els.jobStatus.textContent = err.message || String(err);
      els.jobStatus.classList.add("error");
    } finally {
      await refreshConnectionFromCapabilities();
    }
  });

  els.cancel.addEventListener("click", async () => {
    if (!activeJobId) return;
    await api.invoke("work.cancelJob", { jobId: activeJobId });
  });

  els.retry.addEventListener("click", async () => {
    if (!activeTaskId) return;
    const connected = await refreshConnectionFromCapabilities();
    if (!connected) {
      els.jobStatus.textContent = "请先连接模型";
      els.jobStatus.classList.add("error");
      return;
    }
    clearArtifactView();
    const result = await api.invoke("work.retryTask", { taskId: activeTaskId });
    activeJobId = result.jobId;
    await syncActiveTaskStatus();
    startJobWatch(activeTaskId);
  });

  els.artifactEditor.addEventListener("input", () => {
    if (suppressSave || !activeArtifactId || workMode !== "task") return;
    els.saveStatus.textContent = "正在保存…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.invoke("artifact.saveEdit", {
          artifactId: activeArtifactId,
          text: els.artifactEditor.value,
        });
        els.saveStatus.textContent = "已自动保存";
        // 编辑产生新版本后，采用状态不得沿用到旧版本。
        if (activeArtifactId) await loadArtifact(activeArtifactId);
      } catch (err) {
        els.saveStatus.textContent = err.message || "保存失败";
      }
    }, 500);
  });

  els.copy.addEventListener("click", async () => {
    const resolve =
      (window.DigitalMeBundleCopy && window.DigitalMeBundleCopy.resolveCopyPayload) || null;
    if (!resolve) {
      els.saveStatus.textContent = "复制功能不可用";
      return;
    }
    const payload = resolve({
      kind: activeArtifactKind,
      text: els.artifactEditor.value,
      bundleText: els.bundleReport ? els.bundleReport.textContent : "",
      qualityGrade: lastQualityGrade,
      qualityBannerText: lastQualityBannerText,
      failed: copyBlockedFailed,
    });
    if (!payload.ok) {
      els.saveStatus.textContent = payload.error || "无法复制";
      return;
    }
    try {
      await navigator.clipboard.writeText(payload.text);
      els.saveStatus.textContent = "已复制";
    } catch {
      els.saveStatus.textContent = "复制失败";
    }
  });

  els.exportMd.addEventListener("click", async () => {
    if (!activeArtifactId) return;
    await api.invoke("artifact.export", { artifactId: activeArtifactId, format: "md" });
  });
  els.exportDocx.addEventListener("click", async () => {
    if (!activeArtifactId) return;
    await api.invoke("artifact.export", { artifactId: activeArtifactId, format: "docx" });
  });
  els.reveal.addEventListener("click", async () => {
    if (!activeArtifactId) return;
    await api.invoke("artifact.revealInFolder", { artifactId: activeArtifactId });
  });

  if (els.acceptArtifact) {
    els.acceptArtifact.addEventListener("click", () => submitArtifactDecision("accept"));
  }
  if (els.rejectArtifact) {
    els.rejectArtifact.addEventListener("click", () => submitArtifactDecision("reject"));
  }

  function basenamePath(p) {
    const s = String(p || "");
    const parts = s.split(/[/\\]/);
    return parts[parts.length - 1] || s;
  }

  function collabUserLabel(item) {
    if (!item) return "";
    if (item.status === "revoked") return "已撤销";
    if (item.status === "failed") return "失败";
    if (item.status === "running") return "正在完成";
    if (item.status === "authorized" || item.status === "requested") return "等待对方处理";
    if (item.ownerDecision === "accept") return "已采用";
    if (item.ownerDecision === "reject" || item.status === "rejected") return "未采用";
    if (item.status === "completed") return "已返回成果";
    return "等待对方处理";
  }

  function collabBucket(item) {
    if (item.status === "revoked") return "revoked";
    if (item.ownerDecision === "accept" || item.ownerDecision === "reject" || item.status === "rejected") {
      return "done";
    }
    return "active";
  }

  function collabErrorMessage(err, kind) {
    const msg = err && err.message ? String(err.message) : String(err || "");
    if (/revok|已撤销/i.test(msg)) return "授权已撤销";
    if (/ENOENT|not found|无法读取|openPackage|manifest/i.test(msg)) return "无法读取协作对象";
    if (kind === "issue") return "授权未成功";
    if (kind === "execute") return "对方未能完成";
    return msg || "操作未能完成";
  }

  function buildConfirmPoints(peerLabel, goal, materialPaths, extra) {
    const mats = materialPaths.length
      ? materialPaths.map((m) => `「${basenamePath(m)}」`).join("、")
      : "无文件材料（仅协作要求文字）";
    const peer = peerLabel || "所选数字之我";
    return [
      `对方（${peer}）将看到：你的协作要求${extra ? "与补充说明" : ""}，以及你勾选的材料：${mats}。`,
      "对方可以做：根据上述授权内容完成本次子任务，并返回一份成果供你查看。",
      "对方不能做：查看未勾选的材料、你的完整数字之我资料、对话历史或其他任务。",
      "你可以随时撤销这次授权；撤销后对方不能再继续执行或读取这些材料。",
    ];
  }

  function renderConfirmPoints(ul, points) {
    if (!ul) return;
    ul.innerHTML = "";
    for (const p of points) {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    }
  }

  function renderMaterialChecks(ul, items, onChange) {
    if (!ul) return;
    ul.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted tiny";
      li.textContent = "尚未添加可选材料。";
      ul.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.checked;
      cb.addEventListener("change", () => {
        item.checked = !!cb.checked;
        if (typeof onChange === "function") onChange();
      });
      const span = document.createElement("span");
      span.textContent = basenamePath(item.path);
      span.title = item.path;
      label.appendChild(cb);
      label.appendChild(span);
      li.appendChild(label);
      ul.appendChild(li);
    }
  }

  function selectedMaterialPaths(items) {
    return (items || []).filter((i) => i.checked).map((i) => i.path);
  }

  function showCollabPage(which) {
    if (els.collabPageHome) els.collabPageHome.hidden = which !== "home";
    if (els.collabPageNew) els.collabPageNew.hidden = which !== "new";
    if (els.collabPageDetail) els.collabPageDetail.hidden = which !== "detail";
  }

  function resetCollabUi() {
    if (els.collabForm) els.collabForm.hidden = true;
    if (els.collabConfirm) els.collabConfirm.hidden = true;
    if (els.collabStatus) els.collabStatus.textContent = "";
    if (els.collabReturn) {
      els.collabReturn.hidden = true;
      els.collabReturn.textContent = "";
    }
    if (els.collabActions) els.collabActions.hidden = true;
    showStatus(els.collabError, "");
  }

  function showCollabActions(show) {
    if (els.collabActions) els.collabActions.hidden = !show;
  }

  async function listCollabItems() {
    const listed = await api.invoke("collab.simulateInteraction", { action: "list" });
    return Array.isArray(listed.items) ? listed.items : [];
  }

  async function refreshCollabHome() {
    const items = await listCollabItems();
    const buckets = { active: [], done: [], revoked: [] };
    for (const item of items) buckets[collabBucket(item)].push(item);

    function fill(ul, emptyEl, rows) {
      if (!ul) return;
      ul.innerHTML = "";
      if (emptyEl) emptyEl.hidden = rows.length > 0;
      for (const item of rows) {
        const li = document.createElement("li");
        li.tabIndex = 0;
        const title = document.createElement("p");
        title.className = "entry-title";
        title.textContent = item.subtaskGoal || "协作请求";
        const meta = document.createElement("p");
        meta.className = "entry-meta";
        meta.textContent = `${item.granteeDisplayName || "协作对象"} · ${collabUserLabel(item)}`;
        li.appendChild(title);
        li.appendChild(meta);
        li.addEventListener("click", () => openCollabDetail(item.grantId));
        li.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openCollabDetail(item.grantId);
          }
        });
        ul.appendChild(li);
      }
    }

    fill(els.collabListActive, els.collabEmptyActive, buckets.active);
    fill(els.collabListDone, els.collabEmptyDone, buckets.done);
    fill(els.collabListRevoked, els.collabEmptyRevoked, buckets.revoked);
  }

  async function syncWorkCollabFromDomain() {
    if (!activeTaskId) {
      activeGrantId = null;
      resetCollabUi();
      return;
    }
    const items = await listCollabItems();
    const forTask = items.filter((i) => i.issuerTaskId === activeTaskId);
    const current =
      (activeGrantId && forTask.find((i) => i.grantId === activeGrantId)) || forTask[0] || null;
    if (!current) {
      activeGrantId = null;
      if (els.collabStatus) els.collabStatus.textContent = "";
      if (els.collabReturn) {
        els.collabReturn.hidden = true;
        els.collabReturn.textContent = "";
      }
      showCollabActions(false);
      return;
    }
    activeGrantId = current.grantId;
    if (els.collabStatus) els.collabStatus.textContent = collabUserLabel(current);
    if (els.collabReturn) {
      const text = current.returnedExcerpt || "";
      els.collabReturn.hidden = !text;
      els.collabReturn.textContent = text;
    }
    const canAct = current.status !== "revoked";
    showCollabActions(canAct);
  }

  async function openCollabDetail(grantId) {
    activeGrantId = grantId;
    showCollabPage("detail");
    showStatus(els.collabDetailError, "");
    try {
      const st = await api.invoke("collab.simulateInteraction", {
        action: "status",
        grantId,
      });
      const item = {
        grantId,
        status: st.status,
        ownerDecision: st.ownerDecision || st.grant?.ownerDecision,
        subtaskGoal: st.grant?.subtaskGoal,
        granteeDisplayName: st.grant?.granteeDisplayName,
        allowedMaterials: st.grant?.allowedMaterials || [],
        returnedExcerpt: st.artifactText || st.grant?.returnedExcerpt || "",
        issuerTaskId: st.grant?.issuerTaskId,
        failureMessage: st.grant?.failureMessage,
      };
      if (els.collabDetailPeer) {
        els.collabDetailPeer.textContent = `协作对象：${item.granteeDisplayName || "本机数字之我"}`;
      }
      if (els.collabDetailGoal) {
        els.collabDetailGoal.textContent = item.subtaskGoal || "";
      }
      if (els.collabDetailStatus) {
        els.collabDetailStatus.textContent = `当前状态：${collabUserLabel(item)}`;
      }
      if (els.collabDetailMaterials) {
        els.collabDetailMaterials.innerHTML = "";
        if (!item.allowedMaterials.length) {
          const li = document.createElement("li");
          li.textContent = "未共享文件材料";
          els.collabDetailMaterials.appendChild(li);
        } else {
          for (const p of item.allowedMaterials) {
            const li = document.createElement("li");
            li.textContent = basenamePath(p);
            li.title = p;
            els.collabDetailMaterials.appendChild(li);
          }
        }
      }
      const text = item.returnedExcerpt || "";
      if (els.collabDetailReturn) {
        els.collabDetailReturn.hidden = !text;
        els.collabDetailReturn.textContent = text;
      }
      if (els.collabDetailReturnEmpty) els.collabDetailReturnEmpty.hidden = !!text;
      const revoked = item.status === "revoked";
      const hasReturn = !!text;
      if (els.btnCollabDetailExecute) els.btnCollabDetailExecute.disabled = revoked || hasReturn;
      if (els.btnCollabDetailAccept) els.btnCollabDetailAccept.disabled = revoked || !hasReturn;
      if (els.btnCollabDetailReject) els.btnCollabDetailReject.disabled = revoked || !hasReturn;
      if (els.btnCollabDetailRevoke) els.btnCollabDetailRevoke.disabled = revoked;
      await syncWorkCollabFromDomain();
    } catch (err) {
      showStatus(els.collabDetailError, collabErrorMessage(err, "status"), true);
    }
  }

  function clearPeerCard(cardEls) {
    if (cardEls.dir) cardEls.dir.value = "";
    if (cardEls.card) cardEls.card.hidden = true;
    if (cardEls.name) cardEls.name.textContent = "";
    if (cardEls.brief) {
      cardEls.brief.hidden = true;
      cardEls.brief.textContent = "";
    }
    if (cardEls.path) cardEls.path.textContent = "";
  }

  function fillPeerCard(cardEls, peer) {
    if (cardEls.dir) cardEls.dir.value = peer.packageDir || "";
    if (cardEls.card) cardEls.card.hidden = false;
    if (cardEls.name) cardEls.name.textContent = peer.displayName || "本机数字之我";
    if (cardEls.brief) {
      const brief = peer.brief ? String(peer.brief).trim() : "";
      cardEls.brief.hidden = !brief;
      cardEls.brief.textContent = brief;
    }
    if (cardEls.path) cardEls.path.textContent = peer.packageDir ? `本地位置：${peer.packageDir}` : "";
  }

  function workPeerCardEls() {
    return {
      dir: els.collabPeerDir,
      card: els.collabPeerCard,
      name: els.collabPeerName,
      brief: els.collabPeerBrief,
      path: els.collabPeerPath,
    };
  }

  function pagePeerCardEls() {
    return {
      dir: els.collabPagePeerDir,
      card: els.collabPagePeerCard,
      name: els.collabPagePeerName,
      brief: els.collabPagePeerBrief,
      path: els.collabPagePeerPath,
    };
  }

  async function pickAndResolvePeer(cardEls, emptyEl) {
    const dir = await api.dialogs.pickOpenDirectory();
    if (!dir) {
      if (emptyEl) emptyEl.hidden = false;
      return null;
    }
    try {
      const peer = await api.invoke("collab.simulateInteraction", {
        action: "resolvePeer",
        granteePackageDir: dir,
      });
      fillPeerCard(cardEls, {
        displayName: peer.displayName,
        packageDir: peer.packageDir || dir,
        brief: peer.brief,
      });
      if (emptyEl) emptyEl.hidden = true;
      return peer.packageDir || dir;
    } catch (err) {
      clearPeerCard(cardEls);
      if (emptyEl) emptyEl.hidden = false;
      throw err;
    }
  }

  async function issueCollaboration(opts) {
    const peer = String(opts.peer || "").trim();
    const subtask = String(opts.subtask || "").trim();
    const extra = String(opts.extra || "").trim();
    const mats = opts.materials || [];
    if (!peer) throw new Error("无法读取协作对象");
    if (!subtask) throw new Error("请填写想让对方完成的内容");
    const goal = extra ? `${subtask}\n\n补充要求：${extra}` : subtask;
    const payload = {
      action: "issue",
      granteePackageDir: peer,
      subtaskGoal: goal,
      allowedMaterialPaths: mats,
    };
    // 仅做事页已有任务时写入关联；协作页新建不创建空 Task。
    if (opts.issuerTaskId) payload.issuerTaskId = opts.issuerTaskId;
    const issued = await api.invoke("collab.simulateInteraction", payload);
    activeGrantId = issued.grantId;
    return issued;
  }

  async function executeActiveGrant(statusEl, returnEl, errorEl) {
    showStatus(errorEl, "");
    if (!activeGrantId) return;
    if (statusEl) statusEl.textContent = "正在完成";
    try {
      const result = await api.invoke("collab.simulateInteraction", {
        action: "execute",
        grantId: activeGrantId,
      });
      if (result.denied) {
        showStatus(errorEl, collabErrorMessage({ message: result.reason }, "execute"), true);
        if (statusEl) statusEl.textContent = "失败";
        return;
      }
      if (result.status === "failed") {
        showStatus(errorEl, "对方未能完成", true);
        if (statusEl) statusEl.textContent = "失败";
        return;
      }
      if (statusEl) statusEl.textContent = "已返回成果";
      const text = result.artifactText || "";
      if (returnEl) {
        returnEl.hidden = !text;
        returnEl.textContent = text;
      }
      await refreshCollabHome();
      await syncWorkCollabFromDomain();
    } catch (err) {
      showStatus(errorEl, collabErrorMessage(err, "execute"), true);
      if (statusEl) statusEl.textContent = "失败";
    }
  }

  async function decideCollabReturn(decision, statusEl, errorEl) {
    showStatus(errorEl, "");
    if (!activeGrantId) return;
    try {
      await api.invoke("collab.simulateInteraction", {
        action: "acceptReturn",
        grantId: activeGrantId,
        decision,
      });
      if (statusEl) {
        statusEl.textContent = decision === "accept" ? "已采用" : "未采用";
      }
      await refreshCollabHome();
      await syncWorkCollabFromDomain();
      if (activeTaskId && decision === "accept") {
        try {
          const detail = await api.invoke("work.getTask", { taskId: activeTaskId });
          if (detail.artifactIds && detail.artifactIds[0]) {
            await loadArtifact(detail.artifactIds[0]);
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      showStatus(errorEl, collabErrorMessage(err, "decide"), true);
    }
  }

  async function revokeActiveGrant(statusEl, errorEl) {
    showStatus(errorEl, "");
    if (!activeGrantId) return;
    try {
      await api.invoke("collab.simulateInteraction", {
        action: "revoke",
        grantId: activeGrantId,
      });
      if (statusEl) statusEl.textContent = "已撤销";
      await refreshCollabHome();
      await syncWorkCollabFromDomain();
    } catch (err) {
      showStatus(errorEl, collabErrorMessage(err, "revoke"), true);
    }
  }

  function fillWorkMaterialChecks() {
    const items = materials.map((m) => ({ path: m.path, checked: false }));
    renderMaterialChecks(els.collabMaterialChecks, items, () => {
      if (els.collabConfirm) els.collabConfirm.hidden = true;
    });
    els._workCollabMats = items;
  }

  if (els.collabOpen) {
    els.collabOpen.addEventListener("click", () => {
      if (!activeTaskId) {
        showStatus(els.collabError, "请先开始或选择一个任务", true);
        return;
      }
      if (els.collabForm) els.collabForm.hidden = !els.collabForm.hidden;
      fillWorkMaterialChecks();
      if (els.collabConfirm) els.collabConfirm.hidden = true;
      if (els.collabPeerEmpty) els.collabPeerEmpty.hidden = true;
      showStatus(els.collabError, "");
    });
  }
  async function onPickPeerWork() {
    showStatus(els.collabError, "");
    try {
      const dir = await pickAndResolvePeer(workPeerCardEls(), els.collabPeerEmpty);
      if (!dir && els.collabPeerEmpty) els.collabPeerEmpty.hidden = false;
    } catch (err) {
      showStatus(els.collabError, collabErrorMessage(err, "issue"), true);
    }
  }
  if (els.collabPickPeer) els.collabPickPeer.addEventListener("click", onPickPeerWork);
  if (els.btnCollabImportPeer) els.btnCollabImportPeer.addEventListener("click", onPickPeerWork);

  function workPeerLabel() {
    const name = els.collabPeerName ? String(els.collabPeerName.textContent || "").trim() : "";
    return name || "所选数字之我";
  }

  if (els.btnCollabPreview) {
    els.btnCollabPreview.addEventListener("click", () => {
      const peer = els.collabPeerDir ? String(els.collabPeerDir.value || "").trim() : "";
      const subtask = els.collabSubtask ? String(els.collabSubtask.value || "").trim() : "";
      const extra = els.collabExtra ? String(els.collabExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(els._workCollabMats || []);
      if (!peer || !subtask) {
        showStatus(els.collabError, "请先选择协作对象并填写协作要求", true);
        return;
      }
      renderConfirmPoints(
        els.collabConfirmPoints,
        buildConfirmPoints(workPeerLabel(), subtask, mats, extra),
      );
      if (els.collabConfirm) els.collabConfirm.hidden = false;
      showStatus(els.collabError, "");
    });
  }

  if (els.collabIssue) {
    els.collabIssue.addEventListener("click", async () => {
      showStatus(els.collabError, "");
      if (!activeTaskId) {
        showStatus(els.collabError, "请先开始或选择一个任务", true);
        return;
      }
      const peer = els.collabPeerDir ? String(els.collabPeerDir.value || "").trim() : "";
      const subtask = els.collabSubtask ? String(els.collabSubtask.value || "").trim() : "";
      const extra = els.collabExtra ? String(els.collabExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(els._workCollabMats || []);
      if (!peer || !subtask) {
        showStatus(els.collabError, "请选择协作对象并填写协作要求", true);
        return;
      }
      if (els.collabConfirm && els.collabConfirm.hidden) {
        renderConfirmPoints(
          els.collabConfirmPoints,
          buildConfirmPoints(workPeerLabel(), subtask, mats, extra),
        );
        els.collabConfirm.hidden = false;
        return;
      }
      try {
        await issueCollaboration({
          peer,
          subtask,
          extra,
          materials: mats,
          issuerTaskId: activeTaskId,
        });
        if (els.collabStatus) els.collabStatus.textContent = "等待对方处理";
        showCollabActions(true);
        await refreshCollabHome();
      } catch (err) {
        showStatus(els.collabError, collabErrorMessage(err, "issue"), true);
      }
    });
  }
  if (els.collabExecute) {
    els.collabExecute.addEventListener("click", () =>
      executeActiveGrant(els.collabStatus, els.collabReturn, els.collabError),
    );
  }
  if (els.collabAccept) {
    els.collabAccept.addEventListener("click", () =>
      decideCollabReturn("accept", els.collabStatus, els.collabError),
    );
  }
  if (els.collabReject) {
    els.collabReject.addEventListener("click", () =>
      decideCollabReturn("reject", els.collabStatus, els.collabError),
    );
  }
  if (els.collabRevoke) {
    els.collabRevoke.addEventListener("click", () =>
      revokeActiveGrant(els.collabStatus, els.collabError),
    );
  }

  if (els.btnCollabPageNew) {
    els.btnCollabPageNew.addEventListener("click", () => {
      showCollabPage("new");
      collabPageMaterials = [];
      renderMaterialChecks(els.collabPageMaterialChecks, collabPageMaterials);
      if (els.collabPageConfirm) els.collabPageConfirm.hidden = true;
      clearPeerCard(pagePeerCardEls());
      if (els.collabPageSubtask) els.collabPageSubtask.value = "";
      if (els.collabPageExtra) els.collabPageExtra.value = "";
      if (els.collabPagePeerEmpty) els.collabPagePeerEmpty.hidden = true;
      showStatus(els.collabPageNewError, "");
    });
  }
  if (els.btnCollabNewBack) {
    els.btnCollabNewBack.addEventListener("click", async () => {
      showCollabPage("home");
      await refreshCollabHome();
    });
  }
  if (els.btnCollabDetailBack) {
    els.btnCollabDetailBack.addEventListener("click", async () => {
      showCollabPage("home");
      await refreshCollabHome();
    });
  }
  async function onPickPeerPage() {
    showStatus(els.collabPageNewError, "");
    try {
      const dir = await pickAndResolvePeer(pagePeerCardEls(), els.collabPagePeerEmpty);
      if (!dir && els.collabPagePeerEmpty) els.collabPagePeerEmpty.hidden = false;
    } catch (err) {
      showStatus(els.collabPageNewError, collabErrorMessage(err, "issue"), true);
    }
  }
  if (els.btnCollabPagePickPeer) els.btnCollabPagePickPeer.addEventListener("click", onPickPeerPage);
  if (els.btnCollabPageImportPeer) {
    els.btnCollabPageImportPeer.addEventListener("click", onPickPeerPage);
  }

  function pagePeerLabel() {
    const name = els.collabPagePeerName ? String(els.collabPagePeerName.textContent || "").trim() : "";
    return name || "所选数字之我";
  }
  if (els.btnCollabPageAddFiles) {
    els.btnCollabPageAddFiles.addEventListener("click", async () => {
      const files = await api.dialogs.pickOpenFiles();
      for (const f of files || []) {
        if (!collabPageMaterials.some((m) => m.path === f)) {
          collabPageMaterials.push({ path: f, checked: false });
        }
      }
      renderMaterialChecks(els.collabPageMaterialChecks, collabPageMaterials, () => {
        if (els.collabPageConfirm) els.collabPageConfirm.hidden = true;
      });
    });
  }
  if (els.btnCollabPagePreview) {
    els.btnCollabPagePreview.addEventListener("click", () => {
      const peer = els.collabPagePeerDir ? String(els.collabPagePeerDir.value || "").trim() : "";
      const subtask = els.collabPageSubtask ? String(els.collabPageSubtask.value || "").trim() : "";
      const extra = els.collabPageExtra ? String(els.collabPageExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(collabPageMaterials);
      if (!peer || !subtask) {
        showStatus(els.collabPageNewError, "请先选择协作对象并填写协作要求", true);
        return;
      }
      renderConfirmPoints(
        els.collabPageConfirmPoints,
        buildConfirmPoints(pagePeerLabel(), subtask, mats, extra),
      );
      if (els.collabPageConfirm) els.collabPageConfirm.hidden = false;
      showStatus(els.collabPageNewError, "");
    });
  }
  if (els.btnCollabPageIssue) {
    els.btnCollabPageIssue.addEventListener("click", async () => {
      showStatus(els.collabPageNewError, "");
      const peer = els.collabPagePeerDir ? String(els.collabPagePeerDir.value || "").trim() : "";
      const subtask = els.collabPageSubtask ? String(els.collabPageSubtask.value || "").trim() : "";
      const extra = els.collabPageExtra ? String(els.collabPageExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(collabPageMaterials);
      if (!peer || !subtask) {
        showStatus(els.collabPageNewError, "请选择协作对象并填写协作要求", true);
        return;
      }
      if (els.collabPageConfirm && els.collabPageConfirm.hidden) {
        renderConfirmPoints(
          els.collabPageConfirmPoints,
          buildConfirmPoints(pagePeerLabel(), subtask, mats, extra),
        );
        els.collabPageConfirm.hidden = false;
        return;
      }
      try {
        const issued = await issueCollaboration({ peer, subtask, extra, materials: mats });
        await openCollabDetail(issued.grantId);
      } catch (err) {
        showStatus(els.collabPageNewError, collabErrorMessage(err, "issue"), true);
      }
    });
  }
  if (els.btnCollabDetailExecute) {
    els.btnCollabDetailExecute.addEventListener("click", async () => {
      await executeActiveGrant(
        els.collabDetailStatus,
        els.collabDetailReturn,
        els.collabDetailError,
      );
      if (activeGrantId) await openCollabDetail(activeGrantId);
    });
  }
  if (els.btnCollabDetailAccept) {
    els.btnCollabDetailAccept.addEventListener("click", async () => {
      await decideCollabReturn("accept", els.collabDetailStatus, els.collabDetailError);
      if (activeGrantId) await openCollabDetail(activeGrantId);
    });
  }
  if (els.btnCollabDetailReject) {
    els.btnCollabDetailReject.addEventListener("click", async () => {
      await decideCollabReturn("reject", els.collabDetailStatus, els.collabDetailError);
      if (activeGrantId) await openCollabDetail(activeGrantId);
    });
  }
  if (els.btnCollabDetailRevoke) {
    els.btnCollabDetailRevoke.addEventListener("click", async () => {
      await revokeActiveGrant(els.collabDetailStatus, els.collabDetailError);
      if (activeGrantId) await openCollabDetail(activeGrantId);
    });
  }

  api.onEvent(async (event) => {
    if (event.kind === "job.updated") {
      if (event.taskId && event.taskId === activeTaskId && workMode === "task") {
        try {
          await syncActiveTaskStatus(event.progressNote, event.status);
        } catch {
          /* ignore transient */
        }
      } else {
        await refreshTasks();
      }
    }
    if (event.kind === "artifact.updated" && event.artifactId === activeArtifactId) {
      els.saveStatus.textContent = "内容已更新";
      if (activeArtifactId && workMode === "task") await loadArtifact(activeArtifactId);
    }
    if (event.kind === "subject.updated" && activeNav === "subject") {
      await refreshSubjectPanel();
    }
  });

  api.onBoot(async (info) => {
    rememberShellMeta(info || {});
    await refreshConnectionFromCapabilities();
    if (currentView === "settings") fillSettingsForm();
  });

  (async () => {
    if (typeof api.getModelStatus === "function") {
      try {
        const info = await api.getModelStatus();
        rememberShellMeta(info || {});
      } catch {
        /* ignore */
      }
    }
    await refreshConnectionFromCapabilities();
    const opened = await tryAutoOpenDefault();
    if (!opened) setView("welcome");
  })();
})();
