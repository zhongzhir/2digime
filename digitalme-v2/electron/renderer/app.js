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
    panelChat: document.getElementById("panel-chat"),
    panelSubject: document.getElementById("panel-subject"),
    panelWork: document.getElementById("panel-work"),
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
    collabMaterials: document.getElementById("collab-materials"),
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
  let saveTimer = null;
  let suppressSave = false;
  let jobWatchTimer = null;
  let jobWatchTaskId = null;
  /** @type {'welcome'|'shell'|'settings'|'help'} */
  let currentView = "welcome";
  let returnView = "welcome";
  /** @type {'chat'|'subject'|'work'} */
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
    for (const btn of [els.navChat, els.navSubject, els.navWork]) {
      if (!btn) continue;
      btn.classList.toggle("active", btn.dataset.nav === nav);
    }
    if (els.panelChat) els.panelChat.hidden = nav !== "chat";
    if (els.panelSubject) els.panelSubject.hidden = nav !== "subject";
    if (els.panelWork) els.panelWork.hidden = nav !== "work";
    if (nav === "chat") await refreshChatPanel();
    if (nav === "subject") await refreshSubjectPanel();
    if (nav === "work") await refreshTasks();
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
    refreshTasks();
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
    materials = [];
    renderMaterials();
    renderJobStatus(detail);
    const connected = await refreshConnectionFromCapabilities();
    applyJobControls(detail, connected);

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

  function resetCollabUi() {
    activeGrantId = null;
    if (els.collabForm) els.collabForm.hidden = true;
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

  if (els.collabOpen) {
    els.collabOpen.addEventListener("click", () => {
      if (!activeTaskId) {
        showStatus(els.collabError, "请先开始或选择一个任务", true);
        return;
      }
      if (els.collabForm) els.collabForm.hidden = !els.collabForm.hidden;
      if (els.collabMaterials && materials.length) {
        els.collabMaterials.value = materials.map((m) => m.path).join("\n");
      }
      showStatus(els.collabError, "");
    });
  }
  if (els.collabPickPeer) {
    els.collabPickPeer.addEventListener("click", async () => {
      const dir = await api.dialogs.pickOpenDirectory();
      if (dir && els.collabPeerDir) els.collabPeerDir.value = dir;
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
      const mats = els.collabMaterials
        ? String(els.collabMaterials.value || "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      if (!peer || !subtask) {
        showStatus(els.collabError, "请选择协作者目录并填写子任务要求", true);
        return;
      }
      try {
        const issued = await api.invoke("collab.simulateInteraction", {
          action: "issue",
          granteePackageDir: peer,
          issuerTaskId: activeTaskId,
          subtaskGoal: subtask,
          allowedMaterialPaths: mats,
        });
        activeGrantId = issued.grantId;
        if (els.collabStatus) {
          els.collabStatus.textContent = `已授权 · ${issued.grantId}`;
        }
        showCollabActions(true);
      } catch (err) {
        showStatus(els.collabError, err.message || "授权失败", true);
      }
    });
  }
  if (els.collabExecute) {
    els.collabExecute.addEventListener("click", async () => {
      showStatus(els.collabError, "");
      if (!activeGrantId) return;
      if (els.collabStatus) els.collabStatus.textContent = "协作执行中…";
      try {
        const result = await api.invoke("collab.simulateInteraction", {
          action: "execute",
          grantId: activeGrantId,
        });
        if (result.denied) {
          showStatus(els.collabError, result.reason || "协作被拒绝", true);
          if (els.collabStatus) els.collabStatus.textContent = "未执行";
          return;
        }
        if (els.collabStatus) els.collabStatus.textContent = `协作完成 · ${result.status || ""}`;
        if (els.collabReturn) {
          els.collabReturn.hidden = false;
          els.collabReturn.textContent = result.artifactText || result.grant?.returnedExcerpt || "";
        }
      } catch (err) {
        showStatus(els.collabError, err.message || "协作执行失败", true);
      }
    });
  }
  async function decideCollabReturn(decision) {
    showStatus(els.collabError, "");
    if (!activeGrantId) return;
    try {
      await api.invoke("collab.simulateInteraction", {
        action: "acceptReturn",
        grantId: activeGrantId,
        decision,
      });
      if (els.collabStatus) {
        els.collabStatus.textContent = decision === "accept" ? "已采用返回成果" : "未采用返回成果";
      }
    } catch (err) {
      showStatus(els.collabError, err.message || "未能保存决定", true);
    }
  }
  if (els.collabAccept) {
    els.collabAccept.addEventListener("click", () => decideCollabReturn("accept"));
  }
  if (els.collabReject) {
    els.collabReject.addEventListener("click", () => decideCollabReturn("reject"));
  }
  if (els.collabRevoke) {
    els.collabRevoke.addEventListener("click", async () => {
      showStatus(els.collabError, "");
      if (!activeGrantId) return;
      try {
        await api.invoke("collab.simulateInteraction", {
          action: "revoke",
          grantId: activeGrantId,
        });
        if (els.collabStatus) els.collabStatus.textContent = "授权已撤销";
      } catch (err) {
        showStatus(els.collabError, err.message || "撤销失败", true);
      }
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
