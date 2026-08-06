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
    welcomeStepIntro: document.getElementById("welcome-step-intro"),
    welcomeStepModel: document.getElementById("welcome-step-model"),
    welcomeStepStart: document.getElementById("welcome-step-start"),
    btnWelcomeToModel: document.getElementById("btn-welcome-to-model"),
    btnWelcomeSkipModel: document.getElementById("btn-welcome-skip-model"),
    btnWelcomeSkipModel2: document.getElementById("btn-welcome-skip-model-2"),
    welcomeSkipHint: document.getElementById("welcome-skip-hint"),
    welcomeModelProvider: document.getElementById("welcome-model-provider"),
    welcomeModelApiKey: document.getElementById("welcome-model-api-key"),
    welcomeModelBaseUrl: document.getElementById("welcome-model-base-url"),
    welcomeModelId: document.getElementById("welcome-model-id"),
    welcomeModelState: document.getElementById("welcome-model-state"),
    btnWelcomeSaveModel: document.getElementById("btn-welcome-save-model"),
    welcomeModelStatus: document.getElementById("welcome-model-status"),
    welcomeModelReadyNote: document.getElementById("welcome-model-ready-note"),
    welcomeStartStatus: document.getElementById("welcome-start-status"),
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
    modelConnectionState: document.getElementById("model-connection-state"),
    toggleApiKey: document.getElementById("btn-toggle-api-key"),
    advancedConnection: document.getElementById("advanced-connection"),
    restoreModelPreset: document.getElementById("btn-restore-model-preset"),
    settingsTechDetail: document.getElementById("settings-tech-detail"),
    settingsTechBody: document.getElementById("settings-tech-body"),
    saveModel: document.getElementById("btn-save-model"),
    testModel: document.getElementById("btn-test-model"),
    deleteModel: document.getElementById("btn-delete-model"),
    settingsStatus: document.getElementById("settings-status"),
    remoteCapStatusLabel: document.getElementById("remote-cap-status-label"),
    remoteCapBaseUrl: document.getElementById("remote-cap-base-url"),
    btnRemoteCapTest: document.getElementById("btn-remote-cap-test"),
    btnRemoteCapSave: document.getElementById("btn-remote-cap-save"),
    btnRemoteCapDisable: document.getElementById("btn-remote-cap-disable"),
    remoteCapSettingsStatus: document.getElementById("remote-cap-settings-status"),
    settingsRemoteCapStatus: document.getElementById("settings-remote-cap-status"),
    collabExtCapStatus: document.getElementById("collab-ext-cap-status"),
    collabExtCapConnectPanel: document.getElementById("collab-ext-cap-connect-panel"),
    collabExtCapAdvanced: document.getElementById("collab-ext-cap-advanced"),
    btnCollabExtConnect: document.getElementById("btn-collab-ext-connect"),
    btnCollabExtAuth: document.getElementById("btn-collab-ext-auth"),
    collabExtCapAuthPanel: document.getElementById("collab-ext-cap-auth-panel"),
    collabExtCapAuthPoints: document.getElementById("collab-ext-cap-auth-points"),
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
    collabPageTargetMode: document.getElementById("collab-page-target-mode"),
    collabPagePeerFlow: document.getElementById("collab-page-peer-flow"),
    collabPageContextNote: document.getElementById("collab-page-context-note"),
    btnCollabPageCancel: document.getElementById("btn-collab-page-cancel"),
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
    btnCollabDetailRetry: document.getElementById("btn-collab-detail-retry"),
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
    btnWorkOpenCollabDetail: document.getElementById("btn-work-open-collab-detail"),
    collabPagePeerPath: document.getElementById("collab-page-peer-path"),
    collabBox: document.getElementById("collab-box"),
    chatContext: document.getElementById("chat-context"),
    chatTurns: document.getElementById("chat-turns"),
    chatEmpty: document.getElementById("chat-empty"),
    chatInput: document.getElementById("chat-input"),
    chatSend: document.getElementById("btn-chat-send"),
    chatRetry: document.getElementById("btn-chat-retry"),
    chatClear: document.getElementById("btn-chat-clear"),
    chatToTask: document.getElementById("btn-chat-to-task"),
    chatStatus: document.getElementById("chat-status"),
    subjectBrief: document.getElementById("subject-brief"),
    subjectMore: document.getElementById("subject-more"),
    subjectCapture: document.getElementById("btn-subject-capture"),
    importSubjectMaterial: document.getElementById("btn-import-subject-material"),
    subjectActionStatus: document.getElementById("subject-action-status"),
    subjectActiveList: document.getElementById("subject-active-list"),
    subjectActiveEmpty: document.getElementById("subject-active-empty"),
    subjectRecentList: document.getElementById("subject-recent-list"),
    subjectRecentEmpty: document.getElementById("subject-recent-empty"),
    subjectMaterialList: document.getElementById("subject-material-list"),
    subjectMaterialEmpty: document.getElementById("subject-material-empty"),
    newTask: document.getElementById("btn-new-task"),
    workLayout: document.querySelector("#panel-work .work-layout"),
    workComposeTitle: document.getElementById("work-compose-title"),
    workStageTabs: document.getElementById("work-stage-tabs"),
    workToggleTasks: document.getElementById("btn-work-toggle-tasks"),
    goalDetails: document.getElementById("goal-details"),
    goalSummaryLabel: document.getElementById("goal-summary-label"),
    taskList: document.getElementById("task-list"),
    taskEmpty: document.getElementById("task-empty"),
    goal: document.getElementById("goal"),
    artifactType: document.getElementById("artifact-type"),
    materialList: document.getElementById("material-list"),
    materialListWrap: document.getElementById("material-list-wrap"),
    materialListSummary: document.getElementById("material-list-summary"),
    materialSummary: document.getElementById("material-summary"),
    materialSummaryLine: document.getElementById("material-summary-line"),
    materialSummaryBody: document.getElementById("material-summary-body"),
    addFiles: document.getElementById("btn-add-files"),
    addFolder: document.getElementById("btn-add-folder"),
    clearMaterials: document.getElementById("btn-clear-materials"),
    submit: document.getElementById("btn-submit"),
    cancel: document.getElementById("btn-cancel"),
    retry: document.getElementById("btn-retry"),
    restartCompose: document.getElementById("btn-restart-compose"),
    jobStatus: document.getElementById("job-status"),
    jobActionable: document.getElementById("job-actionable"),
    ownerChoicePrompt: document.getElementById("owner-choice-prompt"),
    ownerChoiceQuestion: document.getElementById("owner-choice-question"),
    ownerChoiceActions: document.getElementById("owner-choice-actions"),
    artifactPanel: document.getElementById("artifact-panel"),
    artifactEditor: document.getElementById("artifact-editor"),
    reviseBox: document.getElementById("revise-box"),
    bundleView: document.getElementById("bundle-view"),
    bundleQuality: document.getElementById("bundle-quality"),
    bundleReport: document.getElementById("bundle-report"),
    bundleStaleNotice: document.getElementById("bundle-stale-notice"),
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
    appliedUnderstanding: document.getElementById("applied-understanding"),
    revisionRequest: document.getElementById("revision-request"),
    revise: document.getElementById("btn-revise"),
    copy: document.getElementById("btn-copy"),
    exportMd: document.getElementById("btn-export-md"),
    exportDocx: document.getElementById("btn-export-docx"),
    reveal: document.getElementById("btn-reveal"),
    collabOpen: document.getElementById("btn-collab-open"),
    externalCapOpen: document.getElementById("btn-external-cap-open"),
    externalCapPanel: document.getElementById("external-cap-panel"),
    externalCapName: document.getElementById("external-cap-name"),
    externalCapDesc: document.getElementById("external-cap-desc"),
    externalCapSuitable: document.getElementById("external-cap-suitable"),
    externalCapShare: document.getElementById("external-cap-share"),
    externalCapEta: document.getElementById("external-cap-eta"),
    externalCapAvail: document.getElementById("external-cap-avail"),
    externalCapGoal: document.getElementById("external-cap-goal"),
    externalCapExtra: document.getElementById("external-cap-extra"),
    externalCapMaterialChecks: document.getElementById("external-cap-material-checks"),
    externalCapConfirm: document.getElementById("external-cap-confirm"),
    externalCapConfirmPoints: document.getElementById("external-cap-confirm-points"),
    btnExternalCapPreview: document.getElementById("btn-external-cap-preview"),
    btnExternalCapIssue: document.getElementById("btn-external-cap-issue"),
    btnExternalCapCancel: document.getElementById("btn-external-cap-cancel"),
    externalCapStatus: document.getElementById("external-cap-status"),
    externalCapError: document.getElementById("external-cap-error"),
    externalCapFailureActions: document.getElementById("external-cap-failure-actions"),
    btnExternalGotoCollab: document.getElementById("btn-external-goto-collab"),
    btnExternalRetry: document.getElementById("btn-external-retry"),
    btnExternalUseLocal: document.getElementById("btn-external-use-local"),
    btnExternalBackTask: document.getElementById("btn-external-back-task"),
    externalCapResult: document.getElementById("external-cap-result"),
    externalCapSource: document.getElementById("external-cap-source"),
    externalCapReturnedAt: document.getElementById("external-cap-returned-at"),
    externalCapCheckStatus: document.getElementById("external-cap-check-status"),
    externalCapBody: document.getElementById("external-cap-body"),
    btnExternalAccept: document.getElementById("btn-external-accept"),
    btnExternalReject: document.getElementById("btn-external-reject"),
    btnExternalRegenerate: document.getElementById("btn-external-regenerate"),
    collabForm: document.getElementById("collab-form"),
    collabTargetMode: document.getElementById("collab-target-mode"),
    collabLocalPeerBlock: document.getElementById("collab-local-peer-block"),
    collabExternalHint: document.getElementById("collab-external-hint"),
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
  /** @type {string|null} */
  let externalCapTaskId = null;
  /** @type {string|null} */
  let externalCapJobId = null;
  /** @type {string|null} */
  let externalCapArtifactId = null;
  let externalCapWatchTimer = null;
  /** @type {any[]} */
  let externalCapMats = [];
  /** @type {string|null} */
  let externalCapCapabilityId = null;
  let activeJobId = null;
  let activeArtifactId = null;
  let lastArtifactRejectionReason = "";
  let activeHeadVersionId = null;
  /** @type {string} */
  let activeTaskRequestedArtifactType = "document";
  /** @type {string|null} */
  let activeTaskIntentKind = null;
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
  /** @type {'chat'|'subject'|'work'|'collab'|'settings'} */
  let activeNav = "work";
  /** @type {'chat'|'subject'|'work'|'collab'} */
  let returnNav = "work";
  let lastChatUserText = "";
  /** 最近一次对话回复是否失败（用于重试） */
  let lastChatReplyFailed = false;
  let shellStatus = null;
  let shellBootInfo = null;
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
  /** 用户本会话是否改过高级连接字段（避免误覆盖已保存自定义值） */
  let advancedFieldsDirty = false;
  let settingsConnectionLabel = "尚未连接";
  let welcomeModelSkipped = false;
  let welcomeModelVerified = false;
  /** @type {'intro'|'model'|'start'} */
  let welcomeStep = "intro";
  let collabWizardExternal = false;

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
    if (nav === "settings") {
      openSettings();
      return;
    }
    activeNav = nav;
    for (const btn of [els.navWork, els.navChat, els.navSubject, els.navCollab]) {
      if (!btn) continue;
      btn.classList.toggle("active", btn.dataset.nav === nav);
    }
    const panels = [
      [els.panelChat, "chat"],
      [els.panelSubject, "subject"],
      [els.panelWork, "work"],
      [els.panelCollab, "collab"],
    ];
    for (const [panel, key] of panels) {
      if (!panel) continue;
      const show = nav === key;
      panel.hidden = !show;
      if (show) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      panel.setAttribute("aria-hidden", show ? "false" : "true");
    }
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
    if (activeNav !== "settings") {
      returnNav =
        activeNav === "chat" || activeNav === "subject" || activeNav === "work" || activeNav === "collab"
          ? activeNav
          : "work";
    }
    activeNav = "settings";
    for (const btn of [els.navWork, els.navChat, els.navSubject, els.navCollab]) {
      if (!btn) continue;
      btn.classList.remove("active");
    }
    fillSettingsForm();
    setView("settings");
  }

  const REMOTE_CONNECT_FAIL =
    "无法连接研究分析能力，请确认服务正在运行并检查地址。";

  function userFacingRemoteError(err, fallback) {
    const msg = (err && err.message) || String(err || "");
    if (/Error invoking remote method|shell:|IPC|invoke/i.test(msg)) {
      return fallback || REMOTE_CONNECT_FAIL;
    }
    if (!msg.trim()) return fallback || REMOTE_CONNECT_FAIL;
    return msg;
  }

  function setRemoteCapStatusLabel(text) {
    if (els.collabExtCapStatus) els.collabExtCapStatus.textContent = text;
    if (els.remoteCapStatusLabel) els.remoteCapStatusLabel.textContent = text;
    if (els.settingsRemoteCapStatus) els.settingsRemoteCapStatus.textContent = text;
  }

  function remoteCapStatusLine(remote) {
    const label = (remote && remote.statusLabel) || "未配置";
    return `状态：${label}`;
  }

  function refreshRemoteCapabilityUi(remote) {
    const st = remote || lastBootRemoteCapability();
    setRemoteCapStatusLabel(remoteCapStatusLine(st || {}));
  }

  function externalCapUnavailableMessage(card) {
    if (card && card.availabilityLabel) return card.availabilityLabel;
    const remote = lastBootRemoteCapability();
    if (remote && remote.statusLabel === "可用") return "当前可用";
    return "专业能力当前不可用，请到设置中配置并验证。";
  }

  function renderExternalCapCheckStatus(selfCheck) {
    if (!els.externalCapCheckStatus) return;
    if (!selfCheck || typeof selfCheck.passed !== "boolean") {
      els.externalCapCheckStatus.hidden = true;
      els.externalCapCheckStatus.textContent = "";
      return;
    }
    els.externalCapCheckStatus.hidden = false;
    if (selfCheck.passed === true) {
      els.externalCapCheckStatus.textContent = "检查状态：已通过";
      return;
    }
    const notes = Array.isArray(selfCheck.notes) ? selfCheck.notes.filter(Boolean) : [];
    els.externalCapCheckStatus.textContent = notes.length
      ? `检查状态：未通过（${notes.join("；")}）`
      : "检查状态：未通过";
  }

  function welcomeModelReady() {
    return (
      welcomeModelVerified ||
      !!(shellBootInfo && shellBootInfo.modelReady) ||
      !!(lastConnectionState && lastConnectionState.available)
    );
  }

  function showWelcomeStep(step) {
    welcomeStep = step;
    if (els.welcomeStepIntro) els.welcomeStepIntro.hidden = step !== "intro";
    if (els.welcomeStepModel) els.welcomeStepModel.hidden = step !== "model";
    if (els.welcomeStepStart) els.welcomeStepStart.hidden = step !== "start";
  }

  function showWelcomeStatus(text, isError, onStartStep) {
    const startEl = els.welcomeStartStatus || els.welcomeStatus;
    const introEl = els.welcomeStatus || els.welcomeStartStatus;
    if (onStartStep) {
      showStatus(startEl, text, isError);
      if (introEl && introEl !== startEl) showStatus(introEl, "");
    } else {
      showStatus(introEl, text, isError);
      if (startEl && startEl !== introEl) showStatus(startEl, "");
    }
  }

  function setWelcomeModelStateLabel(label, tone) {
    if (!els.welcomeModelState) return;
    els.welcomeModelState.textContent = `连接状态：${label || "尚未连接"}`;
    els.welcomeModelState.classList.toggle("is-error", tone === "error");
    els.welcomeModelState.classList.toggle("is-ok", tone === "ok");
  }

  function fillWelcomeModelForm() {
    const status = shellStatus || {};
    const preset =
      status.providerPreset ||
      (status.baseUrl && String(status.baseUrl).includes("deepseek")
        ? "deepseek"
        : status.baseUrl
          ? "openai-compatible"
          : "deepseek");
    const provider = preset === "deepseek" ? "deepseek" : "openai-compatible";
    if (els.welcomeModelProvider) els.welcomeModelProvider.value = provider;
    const savedBase = status.baseUrl || "";
    const savedModel = status.model || "";
    if (els.welcomeModelBaseUrl) {
      els.welcomeModelBaseUrl.value =
        provider === "deepseek" ? savedBase || presets.deepseek.baseUrl : savedBase;
    }
    if (els.welcomeModelId) {
      els.welcomeModelId.value =
        provider === "deepseek" ? savedModel || presets.deepseek.model : savedModel;
    }
    if (els.welcomeModelApiKey) {
      els.welcomeModelApiKey.value = "";
      els.welcomeModelApiKey.type = "password";
      els.welcomeModelApiKey.placeholder = isCredentialConfigured()
        ? "若要更换密钥，请输入新密钥"
        : "粘贴你的密钥";
    }
    const available = !!(lastConnectionState && lastConnectionState.available);
    if (available) setWelcomeModelStateLabel("已连接", "ok");
    else if (isCredentialConfigured()) setWelcomeModelStateLabel("尚未确认（可测试连接）", null);
    else setWelcomeModelStateLabel("尚未连接", null);
    showStatus(els.welcomeModelStatus, "");
  }

  function initWelcomeFlow() {
    welcomeModelSkipped = false;
    if (els.welcomeSkipHint) els.welcomeSkipHint.hidden = true;
    showWelcomeStatus("", false, false);
    showWelcomeStatus("", false, true);
    if (welcomeModelReady()) {
      welcomeModelVerified = true;
      showWelcomeStep("start");
      if (els.welcomeModelReadyNote) {
        els.welcomeModelReadyNote.hidden = false;
        els.welcomeModelReadyNote.textContent = "模型已连接，可以直接开始使用。";
      }
    } else {
      welcomeModelVerified = false;
      if (els.welcomeModelReadyNote) els.welcomeModelReadyNote.hidden = true;
      showWelcomeStep("intro");
    }
  }

  function proceedWelcomeAfterModelSkip() {
    welcomeModelSkipped = true;
    if (els.welcomeSkipHint) els.welcomeSkipHint.hidden = false;
    showWelcomeStep("start");
    showWelcomeStatus("", false, true);
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
    // 产品入口不强迫选成果类型；由 Runtime 按意图派生。
    return "";
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
    const configured = isCredentialConfigured() || available;
    updateKeyStateUi();
    if (els.deleteModel) els.deleteModel.disabled = !configured;
    if (available) setConnectionStateLabel("已连接", "ok");
    else if (currentView === "settings") {
      /* keep latest settings probe label unless freshly unavailable */
    } else if (!configured) {
      setConnectionStateLabel("尚未连接", null);
    }
  }

  function rememberShellMeta(info) {
    if (!info) return;
    const prevRemote = shellBootInfo && shellBootInfo.remoteCapability;
    shellBootInfo = { ...(shellBootInfo || {}), ...info };
    if (!info.remoteCapability && prevRemote) {
      shellBootInfo.remoteCapability = prevRemote;
    }
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
    if (info && info.remoteCapability) {
      refreshRemoteCapabilityUi(info.remoteCapability);
    }
  }

  function redactSecrets(text) {
    return String(text || "")
      .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*["']?[^\s"'\\]+/gi, "$1=[已隐藏]")
      .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[已隐藏]")
      .replace(/\b[a-f0-9]{32,}\b/gi, "[已隐藏]");
  }

  function userFacingModelError(err, fallback) {
    const raw = redactSecrets((err && err.message) || String(err || ""));
    const msg = raw.split("\n")[0].trim();
    if (/Error invoking remote method|shell:|IPC|ECONNREFUSED|ENOTFOUND|fetch failed|network|timeout|AbortError/i.test(raw)) {
      return fallback || "无法连接，请检查网络、密钥或高级连接设置";
    }
    if (/401|403|Unauthorized|invalid.?api.?key|incorrect.?api.?key|鉴权|密钥/i.test(raw)) {
      return "无法连接，请检查密钥或高级连接设置";
    }
    if (!msg) return fallback || "无法连接，请检查密钥或高级连接设置";
    if (msg.length > 180) return fallback || "无法连接，请检查密钥或高级连接设置";
    return msg;
  }

  function setSettingsTechDetail(raw) {
    if (!els.settingsTechDetail || !els.settingsTechBody) return;
    const text = redactSecrets(raw || "").trim();
    if (!text) {
      els.settingsTechDetail.hidden = true;
      els.settingsTechBody.textContent = "";
      return;
    }
    els.settingsTechBody.textContent = text.slice(0, 800);
    els.settingsTechDetail.hidden = false;
    els.settingsTechDetail.removeAttribute("open");
  }

  function setConnectionStateLabel(label, tone) {
    settingsConnectionLabel = label || "尚未连接";
    if (!els.modelConnectionState) return;
    els.modelConnectionState.textContent = `连接状态：${settingsConnectionLabel}`;
    els.modelConnectionState.classList.toggle("is-error", tone === "error");
    els.modelConnectionState.classList.toggle("is-ok", tone === "ok");
  }

  function isCredentialConfigured() {
    return !!(shellStatus && shellStatus.credentialConfigured);
  }

  function updateKeyStateUi() {
    const configured = isCredentialConfigured();
    if (els.modelKeyState) {
      els.modelKeyState.textContent = configured ? "密钥：已保存（不会重新显示）" : "密钥：尚未保存";
    }
    if (els.deleteModel) els.deleteModel.disabled = !configured;
    if (els.modelApiKey) {
      els.modelApiKey.placeholder = configured ? "若要更换密钥，请输入新密钥" : "粘贴你的密钥";
    }
  }

  function syncAdvancedOpenForProvider() {
    if (!els.advancedConnection) return;
    const custom = els.modelProvider && els.modelProvider.value === "openai-compatible";
    if (custom) els.advancedConnection.open = true;
  }

  function applyProviderPreset(opts) {
    const force = !!(opts && opts.force);
    const key = els.modelProvider.value;
    const preset = presets[key] || presets["openai-compatible"];
    if (key === "deepseek") {
      if (force || !advancedFieldsDirty) {
        els.modelBaseUrl.value = preset.baseUrl;
        els.modelId.value = preset.model;
        advancedFieldsDirty = false;
      }
      if (els.advancedConnection && !(opts && opts.keepAdvancedOpen)) {
        els.advancedConnection.open = false;
      }
    } else {
      syncAdvancedOpenForProvider();
      if (force) {
        els.modelBaseUrl.value = "";
        els.modelId.value = "";
        advancedFieldsDirty = false;
      }
    }
  }

  function fillSettingsForm() {
    const status = shellStatus || {};
    const preset =
      status.providerPreset ||
      (status.baseUrl && String(status.baseUrl).includes("deepseek")
        ? "deepseek"
        : status.baseUrl
          ? "openai-compatible"
          : "deepseek");
    const provider = preset === "deepseek" ? "deepseek" : "openai-compatible";
    els.modelProvider.value = provider;
    const savedBase = status.baseUrl || "";
    const savedModel = status.model || "";
    if (provider === "deepseek") {
      els.modelBaseUrl.value = savedBase || presets.deepseek.baseUrl;
      els.modelId.value = savedModel || presets.deepseek.model;
    } else {
      els.modelBaseUrl.value = savedBase;
      els.modelId.value = savedModel;
    }
    advancedFieldsDirty = false;
    els.modelApiKey.value = "";
    if (els.modelApiKey) els.modelApiKey.type = "password";
    if (els.toggleApiKey) {
      els.toggleApiKey.textContent = "显示";
      els.toggleApiKey.setAttribute("aria-pressed", "false");
    }
    if (els.advancedConnection) {
      els.advancedConnection.open = provider === "openai-compatible";
    }
    updateKeyStateUi();
    const available = !!(lastConnectionState && lastConnectionState.available);
    if (available) setConnectionStateLabel("已连接", "ok");
    else if (isCredentialConfigured()) setConnectionStateLabel("尚未确认（可测试连接）", null);
    else setConnectionStateLabel("尚未连接", null);
    showStatus(els.settingsStatus, "");
    setSettingsTechDetail("");
  }

  async function fillRemoteCapabilitySettings() {
    try {
      const st =
        typeof api.getRemoteCapabilityStatus === "function"
          ? await api.getRemoteCapabilityStatus()
          : lastBootRemoteCapability() || {};
      if (els.remoteCapBaseUrl) {
        const next = st.baseUrl || st.resolvedBaseUrl || "";
        if (next) els.remoteCapBaseUrl.value = next;
      }
      refreshRemoteCapabilityUi(st);
      showStatus(els.remoteCapSettingsStatus, "");
    } catch {
      refreshRemoteCapabilityUi({ statusLabel: "未配置" });
    }
  }

  function lastBootRemoteCapability() {
    return shellBootInfo && shellBootInfo.remoteCapability ? shellBootInfo.remoteCapability : null;
  }

  function basenamePath(p) {
    const s = String(p || "");
    const parts = s.split(/[/\\]/);
    return parts[parts.length - 1] || s;
  }

  function renderMaterials() {
    els.materialList.innerHTML = "";
    const count = materials.length;
    if (els.materialListSummary) {
      els.materialListSummary.textContent =
        count === 0 ? "尚未添加材料" : `已添加 ${count} 项`;
    }
    if (els.materialListWrap) {
      els.materialListWrap.open = count > 0 && count <= 5;
      if (count === 0) els.materialListWrap.open = true;
      if (count > 5) els.materialListWrap.open = false;
    }
    const canRemove = workMode === "compose";
    for (const item of materials) {
      const li = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "material-meta";
      const kind = item.kind === "folder" ? "文件夹" : "文件";
      const name = document.createElement("div");
      name.className = "material-name";
      name.textContent = `${kind} · ${basenamePath(item.path)}`;
      const pathEl = document.createElement("div");
      pathEl.className = "material-path";
      pathEl.textContent = item.path;
      meta.appendChild(name);
      meta.appendChild(pathEl);
      li.appendChild(meta);
      if (canRemove) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "ghost material-remove";
        rm.textContent = "移除";
        rm.addEventListener("click", () => {
          materials = materials.filter((m) => !(m.path === item.path && m.kind === item.kind));
          renderMaterials();
        });
        li.appendChild(rm);
      }
      els.materialList.appendChild(li);
    }
  }

  function syncGoalPresentation() {
    if (els.panelWork) {
      els.panelWork.classList.toggle("work-compose-focus", workMode === "compose");
    }
    const hasArtifact = !!(els.artifactPanel && !els.artifactPanel.hidden);
    const goalText = (els.goal && els.goal.value ? els.goal.value : "").trim();
    if (els.goalSummaryLabel) {
      if (workMode === "compose") {
        els.goalSummaryLabel.textContent = "你要完成的工作";
      } else if (goalText) {
        const preview = goalText.length > 72 ? `${goalText.slice(0, 72)}…` : goalText;
        els.goalSummaryLabel.textContent = hasArtifact ? `任务说明 · ${preview}` : "任务说明";
      } else {
        els.goalSummaryLabel.textContent = "任务说明";
      }
    }
    if (els.goalDetails) {
      if (workMode === "compose") els.goalDetails.open = true;
      else if (hasArtifact) els.goalDetails.open = false;
      else els.goalDetails.open = true;
    }
    if (els.workStageTabs) {
      els.workStageTabs.hidden = !hasArtifact;
    }
    if (els.workLayout && hasArtifact && els.workLayout.dataset.stage !== "artifact") {
      /* keep current stage when already on artifact */
    }
  }

  function setWorkStage(stage) {
    if (!els.workLayout) return;
    const next = stage === "artifact" ? "artifact" : "center";
    els.workLayout.dataset.stage = next;
    if (els.workStageTabs) {
      for (const btn of els.workStageTabs.querySelectorAll("[data-work-stage]")) {
        btn.classList.toggle("active", btn.getAttribute("data-work-stage") === next);
      }
    }
  }

  function setWorkTasksOpen(open) {
    if (!els.workLayout) return;
    els.workLayout.dataset.tasks = open ? "open" : "closed";
  }

  /** @type {{ mode: 'local-peer'|'external-research', issuerTaskId: string|null, subtask: string, materials: {path:string,checked:boolean}[] } | null} */
  let collabDraftFromWork = null;

  function carryTaskContextIntoAssist(kind) {
    const goal = (els.goal && els.goal.value ? els.goal.value : "").trim();
    if (kind === "collab") {
      if (els.collabSubtask && !String(els.collabSubtask.value || "").trim() && goal) {
        els.collabSubtask.value = goal.slice(0, 1200);
      }
      fillWorkMaterialChecks();
    } else if (kind === "external") {
      if (els.externalCapGoal && !String(els.externalCapGoal.value || "").trim()) {
        els.externalCapGoal.value =
          goal || "请根据已授权材料，形成 500–800 字结构化项目风险摘要。";
      }
      fillExternalMaterialChecks();
    }
  }

  function syncCollabPageMode() {
    let mode = "local-peer";
    if (collabWizardExternal) {
      mode = "external-research";
    } else if (els.collabPageTargetMode) {
      const val = String(els.collabPageTargetMode.value || "local-peer");
      const hasExternalOption = !!els.collabPageTargetMode.querySelector(
        'option[value="external-research"]',
      );
      mode = val === "external-research" && hasExternalOption ? "external-research" : "local-peer";
    }
    if (els.collabPagePeerFlow) els.collabPagePeerFlow.hidden = mode !== "local-peer";
    if (els.externalCapPanel) els.externalCapPanel.hidden = mode !== "external-research";
    return mode;
  }

  function applyCollabDraftToWizard() {
    const draft = collabDraftFromWork;
    collabWizardExternal = !!(draft && draft.mode === "external-research");
    const hasExternalOption =
      els.collabPageTargetMode &&
      !!els.collabPageTargetMode.querySelector('option[value="external-research"]');
    if (els.collabPageTargetMode) {
      if (collabWizardExternal && hasExternalOption) {
        els.collabPageTargetMode.value = "external-research";
      } else {
        els.collabPageTargetMode.value = "local-peer";
      }
    }
    const mode = syncCollabPageMode();
    if (els.collabPageContextNote) {
      if (draft && draft.issuerTaskId) {
        els.collabPageContextNote.hidden = false;
        els.collabPageContextNote.textContent = "已带入当前任务；发送前请核对材料与授权。";
      } else {
        els.collabPageContextNote.hidden = true;
        els.collabPageContextNote.textContent = "";
      }
    }
    if (mode === "local-peer") {
      if (els.collabPageSubtask) {
        els.collabPageSubtask.value = draft && draft.subtask ? draft.subtask : "";
      }
      if (els.collabPageExtra) els.collabPageExtra.value = "";
      collabPageMaterials = draft && Array.isArray(draft.materials) ? draft.materials.map((m) => ({ ...m })) : [];
      renderMaterialChecks(els.collabPageMaterialChecks, collabPageMaterials, () => {
        if (els.collabPageConfirm) els.collabPageConfirm.hidden = true;
      });
      if (els.collabPageConfirm) els.collabPageConfirm.hidden = true;
    } else {
      if (els.externalCapGoal) {
        els.externalCapGoal.value =
          (draft && draft.subtask) ||
          "请根据已授权材料，形成 500–800 字结构化项目风险摘要。";
      }
      if (els.externalCapExtra) els.externalCapExtra.value = "";
      externalCapMats =
        draft && Array.isArray(draft.materials)
          ? draft.materials.map((m) => ({ path: m.path, checked: false }))
          : materials.map((m) => ({ path: m.path, checked: false }));
      renderMaterialChecks(els.externalCapMaterialChecks, externalCapMats, () => {
        if (els.externalCapConfirm && !els.externalCapConfirm.hidden) {
          void refreshExternalAuthPreview();
        }
      });
      if (els.externalCapConfirm) els.externalCapConfirm.hidden = true;
      hideExternalCandidate();
      if (els.externalCapFailureActions) els.externalCapFailureActions.hidden = true;
      showStatus(els.externalCapError, "");
      if (els.externalCapStatus) els.externalCapStatus.textContent = "";
      void refreshExternalCapabilityCard();
    }
  }

  async function openCollabWizardFromWork(kind) {
    const goal = (els.goal && els.goal.value ? els.goal.value : "").trim();
    if (!activeTaskId || workMode !== "task") {
      showStatus(els.collabError, "请先描述目标并开始或选择一个任务", true);
      if (els.goal && workMode === "compose") els.goal.focus();
      return;
    }
    if (!goal) {
      showStatus(els.collabError, "请先填写任务目标，再发起协作", true);
      if (els.goalDetails) els.goalDetails.open = true;
      if (els.goal) els.goal.focus();
      return;
    }
    collabDraftFromWork = {
      mode: kind === "external" ? "external-research" : "local-peer",
      issuerTaskId: activeTaskId,
      subtask: goal.slice(0, 1200),
      materials: materials.map((m) => ({ path: m.path, checked: false })),
    };
    showStatus(els.collabError, "");
    await setNav("collab");
    showCollabPage("new");
    clearPeerCard(pagePeerCardEls());
    if (els.collabPagePeerEmpty) els.collabPagePeerEmpty.hidden = true;
    showStatus(els.collabPageNewError, "");
    applyCollabDraftToWizard();
  }

  function clearMaterialSummary() {
    if (!els.materialSummary) return;
    els.materialSummary.hidden = true;
    els.materialSummary.removeAttribute("open");
    if (els.materialSummaryLine) els.materialSummaryLine.textContent = "";
    if (els.materialSummaryBody) els.materialSummaryBody.innerHTML = "";
  }

  function renderMaterialSummary(summary) {
    if (!els.materialSummary || !els.materialSummaryLine || !els.materialSummaryBody) return;
    if (!summary || !summary.summaryLine) {
      clearMaterialSummary();
      return;
    }
    els.materialSummary.hidden = false;
    els.materialSummaryLine.textContent = String(summary.summaryLine);
    const body = els.materialSummaryBody;
    body.innerHTML = "";
    const included = Array.isArray(summary.included) ? summary.included : [];
    const skipped = Array.isArray(summary.skipped) ? summary.skipped : [];
    if (included.length > 0) {
      const h = document.createElement("h4");
      h.textContent = "已纳入";
      body.appendChild(h);
      const ul = document.createElement("ul");
      for (const entry of included) {
        const li = document.createElement("li");
        li.textContent = entry.displayName || basenamePath(entry.path);
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    if (skipped.length > 0) {
      const h = document.createElement("h4");
      h.textContent = "暂未纳入";
      body.appendChild(h);
      const ul = document.createElement("ul");
      for (const entry of skipped) {
        const li = document.createElement("li");
        const name = entry.displayName || basenamePath(entry.path);
        const reason = entry.reason ? `（${entry.reason}）` : "";
        li.textContent = `${name}${reason}`;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
  }

  function clearAppliedUnderstanding() {
    if (!els.appliedUnderstanding) return;
    els.appliedUnderstanding.hidden = true;
    els.appliedUnderstanding.removeAttribute("open");
    els.appliedUnderstanding.innerHTML = "";
  }

  function renderAppliedUnderstanding(applied) {
    if (!els.appliedUnderstanding) return;
    const items =
      applied && Array.isArray(applied.items)
        ? applied.items.filter((it) => it && String(it.text || "").trim()).slice(0, 3)
        : [];
    if (!applied || !applied.notice || items.length === 0) {
      clearAppliedUnderstanding();
      return;
    }
    const notice = String(applied.notice).replace(/。$/, "");
    els.appliedUnderstanding.hidden = false;
    els.appliedUnderstanding.innerHTML = "";
    const summary = document.createElement("summary");
    summary.textContent = notice;
    els.appliedUnderstanding.appendChild(summary);
    const ul = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = String(item.text).trim();
      ul.appendChild(li);
    }
    els.appliedUnderstanding.appendChild(ul);
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
    if (hasArtifact) setWorkStage(els.workLayout.dataset.stage === "artifact" ? "artifact" : "center");
    else setWorkStage("center");
    syncGoalPresentation();
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
    if (els.acceptArtifact) els.acceptArtifact.disabled = true;
    if (els.rejectArtifact) els.rejectArtifact.disabled = true;
    renderArtifactDecision({ status: "undecided" });
    if (els.decisionNote) els.decisionNote.value = "";
    showStatus(els.decisionError, "");
    clearAppliedUnderstanding();
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
    const isCodeAnalysis =
      activeArtifactKind === "bundle" ||
      activeTaskRequestedArtifactType === "code-analysis" ||
      activeTaskIntentKind === "analyze_code";
    const baseText =
      kind === "accept"
        ? note ||
          (isCodeAnalysis
            ? `采用代码分析：可沿用关注点、判断标准与工作方法。任务：${goal || "本次任务"}`.slice(
                0,
                400,
              )
            : `采用成果：${goal || "本次任务"}`.slice(0, 400))
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
        requestedArtifactType: activeTaskRequestedArtifactType || "document",
        sourceCapabilityKind: "local",
        ...(note ? (kind === "reject" ? { rejectionReason: note } : {}) : {}),
        ...(kind === "reject" && lastArtifactRejectionReason
          ? { rejectionReason: lastArtifactRejectionReason }
          : {}),
        ...(els.revisionRequest && String(els.revisionRequest.value || "").trim()
          ? { revisionRequest: String(els.revisionRequest.value || "").trim() }
          : {}),
      });
      if (result && result.captureOutcome === "distill_failed") {
        showStatus(els.decisionError, "决定已记下，但相关体会还没记全，请稍后再试。", true);
      }
      const status =
        (result && result.ownerDecision) || (kind === "accept" ? "accepted" : "rejected");
      renderArtifactDecision({ status });
      if (els.decisionNote && status === "accepted") els.decisionNote.value = "";
      if (kind === "reject" && status === "rejected") {
        if (els.decisionStatus) {
          els.decisionStatus.textContent = note
            ? "已记录为未采用，并保存了你的说明。可继续填写修改要求并按说明修改。"
            : "已记录为未采用。请说明如何修改后继续。";
        }
        if (els.saveStatus) els.saveStatus.textContent = "已记录你的决定。";
        // 不采用后自然进入修订：打开修订区；有说明则预填
        if (els.reviseBox) {
          els.reviseBox.hidden = false;
          els.reviseBox.removeAttribute("hidden");
          els.reviseBox.open = true;
        }
        if (note && els.revisionRequest) {
          if (!(els.revisionRequest.value || "").trim()) {
            els.revisionRequest.value = note;
          }
        }
        lastArtifactRejectionReason = note || baseText;
      }
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

  function startNewTaskComposer(seed) {
    workMode = "compose";
    activeTaskId = null;
    activeJobId = null;
    const seedGoal = seed && seed.goal != null ? String(seed.goal) : "";
    const seedMats =
      seed && Array.isArray(seed.materials)
        ? seed.materials
            .filter((m) => m && (m.kind === "file" || m.kind === "folder") && m.path)
            .map((m) => ({ kind: m.kind, path: m.path }))
        : [];
    materials = seedMats;
    renderMaterials();
    clearMaterialSummary();
    clearAppliedUnderstanding();
    els.goal.value = seedGoal;
    els.goal.readOnly = false;
    if (els.workComposeTitle) els.workComposeTitle.textContent = "新建任务";
    clearJobChrome();
    clearArtifactView();
    setWorkCollabVisible(false);
    if (els.restartCompose) els.restartCompose.hidden = true;
    setWorkStage("center");
    setWorkTasksOpen(false);
    syncGoalPresentation();
    refreshTasks();
    requestAnimationFrame(() => {
      if (els.goal && workMode === "compose") els.goal.focus();
    });
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

  function renderOwnerChoicePrompt(detail) {
    const box = els.ownerChoicePrompt;
    const q = els.ownerChoiceQuestion;
    const actions = els.ownerChoiceActions;
    if (!box || !q || !actions) return;
    const prompt = detail && detail.ownerChoicePrompt;
    if (!prompt || !prompt.question) {
      box.hidden = true;
      actions.innerHTML = "";
      return;
    }
    box.hidden = false;
    q.textContent = String(prompt.question);
    actions.innerHTML = "";
    const labelA = String(prompt.labelA || "第一种");
    const labelB = String(prompt.labelB || "第二种");
    const choices = [
      { label: "仅本次使用「" + labelA + "」", action: "use_a_once" },
      { label: "仅本次使用「" + labelB + "」", action: "use_b_once" },
      { label: "以后优先采用「" + labelA + "」", action: "prefer_a" },
      { label: "以后优先采用「" + labelB + "」", action: "prefer_b" },
      { label: "稍后再说", action: "defer" },
    ];
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost";
      btn.textContent = c.label;
      btn.addEventListener("click", async () => {
        await api.invoke("subject.respondToLearning", {
          eventId: prompt.eventIdA,
          peerEventId: prompt.eventIdB,
          taskId: detail.task && detail.task.id ? detail.task.id : activeTaskId,
          action: c.action,
        });
        box.hidden = true;
        actions.innerHTML = "";
        await refreshSubjectPanel();
        if (activeTaskId) await syncActiveTaskStatus();
      });
      actions.appendChild(btn);
    }
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
      const cancelledMsg =
        detail && detail.latestJob && detail.latestJob.actionable
          ? String(detail.latestJob.actionable)
          : "任务已取消。可以重试。";
      els.jobActionable.textContent = cancelledMsg;
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
    if (els.restartCompose) {
      const showRestart =
        workMode === "task" &&
        (!!status && (status === "failed" || status === "cancelled" || status === "succeeded"));
      els.restartCompose.hidden = !showRestart;
    }
  }

  async function syncActiveTaskStatus(eventNote, eventStatus) {
    if (!activeTaskId || workMode !== "task") return null;
    const detail = await api.invoke("work.getTask", { taskId: activeTaskId });
    activeJobId = detail.latestJob ? detail.latestJob.jobId : activeJobId;
    renderJobStatus(detail, eventNote);
    renderOwnerChoicePrompt(detail);
    renderMaterialSummary(detail.materialSummary);
    const connected = await refreshConnectionFromCapabilities();
    applyJobControls(detail, connected);

    if (isJobActive(detail)) {
      startJobWatch(activeTaskId);
      clearArtifactView();
      clearAppliedUnderstanding();
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
        renderAppliedUnderstanding(detail.appliedUnderstanding);
      } else {
        clearArtifactView();
        clearAppliedUnderstanding();
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
    activeTaskRequestedArtifactType =
      (detail.task && detail.task.requestedArtifactType) || "document";
    activeTaskIntentKind = (detail.task && detail.task.intentKind) || null;
    const refs =
      detail.task && Array.isArray(detail.task.contextRefs) ? detail.task.contextRefs : [];
    materials = refs
      .filter((r) => r && (r.kind === "file" || r.kind === "folder") && r.path)
      .map((r) => ({ kind: r.kind, path: r.path }));
    renderMaterials();
    renderJobStatus(detail);
    renderOwnerChoicePrompt(detail);
    renderMaterialSummary(detail.materialSummary);
    const connected = await refreshConnectionFromCapabilities();
    applyJobControls(detail, connected);
    setWorkCollabVisible(true);
    syncGoalPresentation();

    if (isJobActive(detail)) {
      startJobWatch(taskId);
      clearArtifactView();
      clearAppliedUnderstanding();
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
        renderAppliedUnderstanding(detail.appliedUnderstanding);
      } else {
        clearArtifactView();
        clearAppliedUnderstanding();
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
      const qualitySource =
        content.bundle && content.bundle.manifestSummary
          ? content.bundle.manifestSummary.quality
          : null;
      const qualityUi =
        (window.DigitalMeBundleQualityUi &&
          window.DigitalMeBundleQualityUi.resolveBundleQualityUi(qualitySource)) || {
          showBanner: false,
          className: "bundle-quality usable",
          bannerText: "",
          saveStatus: "已载入",
        };
      lastQualityGrade =
        qualitySource && qualitySource.grade ? qualitySource.grade : null;
      lastQualityBannerText = qualityUi.bannerText || "";
      els.bundleView.hidden = false;
      els.bundleView.removeAttribute("hidden");
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
      if (els.reviseBox) {
        els.reviseBox.hidden = false;
        els.reviseBox.removeAttribute("hidden");
        const summary = els.reviseBox.querySelector("summary");
        if (summary) summary.textContent = "用说明重新执行";
        if (els.revise) els.revise.textContent = "按说明重新分析";
      } else if (els.revise) {
        els.revise.closest(".revise-box").hidden = false;
      }
      suppressSave = true;
      if (els.bundleReport) {
        if ("value" in els.bundleReport) els.bundleReport.value = content.text || "";
        else els.bundleReport.textContent = content.text || "";
      }
      suppressSave = false;
      if (els.bundleStaleNotice) {
        if (content.evidenceStale) {
          els.bundleStaleNotice.hidden = false;
          els.bundleStaleNotice.removeAttribute("hidden");
        } else {
          els.bundleStaleNotice.hidden = true;
          els.bundleStaleNotice.setAttribute("hidden", "");
        }
      }
      if (els.bundleQuality) {
        if (qualityUi.showBanner && qualityUi.bannerText) {
          els.bundleQuality.hidden = false;
          els.bundleQuality.textContent = qualityUi.bannerText;
          els.bundleQuality.className = qualityUi.className || "bundle-quality";
        } else {
          els.bundleQuality.hidden = true;
        }
      }
      els.bundleManifest.textContent = "";
      els.bundleEntries.innerHTML = "";
      if (content.bundle && content.bundle.manifestSummary) {
        const m = content.bundle.manifestSummary;
        const langs = (m.languages || [])
          .slice(0, 4)
          .map((l) => `${l.language || "?"} ${l.files || 0}`)
          .join("、");
        els.bundleManifest.textContent = [
          `扫描 ${m.fileCountScanned || 0} 个文件`,
          langs ? `语言 ${langs}` : null,
          m.truncated ? "已截断" : null,
          m.skippedSensitiveCount ? `敏感跳过 ${m.skippedSensitiveCount}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
      const evidenceEntry = ((content.bundle && content.bundle.entries) || []).find(
        (e) => e.role === "evidence",
      );
      let evidenceSummary = "";
      if (evidenceEntry && evidenceEntry.text) {
        try {
          const parsed = JSON.parse(evidenceEntry.text);
          const items = parsed.items || [];
          evidenceSummary = `证据 ${items.length} 条`;
          const sample = items
            .slice(0, 5)
            .map((it) => `${it.claimId || "?"} → ${it.path || "?"}`)
            .join("；");
          if (sample) evidenceSummary += `：${sample}`;
        } catch {
          evidenceSummary = "证据摘要不可用";
        }
      }
      const roles = ((content.bundle && content.bundle.entries) || [])
        .map((e) => e.role)
        .filter(Boolean);
      const li = document.createElement("li");
      li.textContent = [
        roles.includes("manifest") ? "包含清单" : null,
        evidenceSummary || (roles.includes("evidence") ? "包含证据" : null),
        content.evidenceStale ? "依据未随人工改稿更新" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (li.textContent) els.bundleEntries.appendChild(li);
      els.exportMd.hidden = true;
      els.exportDocx.hidden = true;
      els.reveal.hidden = false;
      els.saveStatus.textContent = content.evidenceStale
        ? "报告为人工编辑；依据未同步更新"
        : qualityUi.saveStatus;
      const connected = await refreshConnectionFromCapabilities();
      els.revise.disabled = !connected;
    } else {
      activeArtifactKind = "document";
      lastQualityGrade = null;
      lastQualityBannerText = "";
      if (els.bundleStaleNotice) {
        els.bundleStaleNotice.hidden = true;
        els.bundleStaleNotice.setAttribute("hidden", "");
      }
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
      els.artifactEditor.hidden = false;
      els.artifactEditor.removeAttribute("hidden");
      if (els.reviseBox) {
        els.reviseBox.hidden = false;
        els.reviseBox.removeAttribute("hidden");
        els.reviseBox.removeAttribute("open");
        const summary = els.reviseBox.querySelector("summary");
        if (summary) summary.textContent = "用说明修改成果";
        if (els.revise) els.revise.textContent = "按说明修改";
      } else if (els.revise) {
        els.revise.closest(".revise-box").hidden = false;
      }
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

    if (els.subjectRecentList && els.subjectRecentEmpty) {
      const recent = overview.recentLearnings || [];
      els.subjectRecentList.innerHTML = "";
      els.subjectRecentEmpty.hidden = recent.length > 0;
      for (const item of recent) {
        const li = document.createElement("li");
        li.innerHTML = `<div class="subject-item-text">${escapeHtml(item.text)}</div>`;
        if (item.sourceNote) {
          const note = document.createElement("p");
          note.className = "muted tiny";
          note.textContent = String(item.sourceNote);
          li.appendChild(note);
        }
        if (item.suggestConfirm) {
          const row = document.createElement("div");
          row.className = "subject-actions";
          const adopt = document.createElement("button");
          adopt.type = "button";
          adopt.className = "ghost";
          adopt.textContent = "确认采用";
          adopt.addEventListener("click", async () => {
            await api.invoke("subject.respondToLearning", {
              eventId: item.eventId,
              action: "adopt",
            });
            await refreshSubjectPanel();
          });
          const dismiss = document.createElement("button");
          dismiss.type = "button";
          dismiss.className = "ghost";
          dismiss.textContent = "先不采用";
          dismiss.addEventListener("click", async () => {
            await api.invoke("subject.respondToLearning", {
              eventId: item.eventId,
              action: "dismiss",
            });
            await refreshSubjectPanel();
          });
          row.appendChild(adopt);
          row.appendChild(dismiss);
          li.appendChild(row);
        }
        els.subjectRecentList.appendChild(li);
      }
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
    showStatus(els.welcomeStartStatus, "");
    await enterShell();
  }

  async function tryStartFromWelcome(opts) {
    const skipIntro = !!(opts && opts.skipIntro);
    if (!welcomeModelReady() && !welcomeModelSkipped) {
      showWelcomeStep("model");
      fillWelcomeModelForm();
      showWelcomeStatus("请先连接模型，或选择跳过（跳过后对话和做事仍需要模型）。", true, false);
      return;
    }
    try {
      await createOrOpenDefaultPackage({ skipIntro });
    } catch (err) {
      showWelcomeStatus(err.message || String(err), true, true);
    }
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

  if (els.btnWelcomeToModel) {
    els.btnWelcomeToModel.addEventListener("click", () => {
      showWelcomeStep("model");
      fillWelcomeModelForm();
      showWelcomeStatus("", false, false);
    });
  }
  if (els.btnWelcomeSkipModel) {
    els.btnWelcomeSkipModel.addEventListener("click", () => {
      proceedWelcomeAfterModelSkip();
    });
  }
  if (els.btnWelcomeSkipModel2) {
    els.btnWelcomeSkipModel2.addEventListener("click", () => {
      proceedWelcomeAfterModelSkip();
    });
  }
  if (els.btnWelcomeSaveModel) {
    els.btnWelcomeSaveModel.addEventListener("click", async () => {
      try {
        const apiKey = els.welcomeModelApiKey ? (els.welcomeModelApiKey.value || "").trim() : "";
        const baseUrl = els.welcomeModelBaseUrl ? (els.welcomeModelBaseUrl.value || "").trim() : "";
        const model = els.welcomeModelId ? (els.welcomeModelId.value || "").trim() : "";
        const provider = els.welcomeModelProvider ? els.welcomeModelProvider.value : "deepseek";
        const configured = isCredentialConfigured();
        if (!apiKey && !configured) {
          showStatus(els.welcomeModelStatus, "请输入 API Key 后再保存", true);
          setWelcomeModelStateLabel("尚未连接", "error");
          return;
        }
        if (!baseUrl || !model) {
          showStatus(els.welcomeModelStatus, "请在高级连接中填写服务地址与模型名称", true);
          setWelcomeModelStateLabel("尚未连接", "error");
          return;
        }
        els.btnWelcomeSaveModel.disabled = true;
        setWelcomeModelStateLabel("正在检查", null);
        showStatus(els.welcomeModelStatus, "正在保存并验证…");
        const result = await api.saveModelCredential({
          apiKey,
          baseUrl,
          model,
          providerPreset: provider,
          allowExistingKey: !apiKey && configured,
        });
        rememberShellMeta(result || {});
        if (els.welcomeModelApiKey) {
          els.welcomeModelApiKey.value = "";
          els.welcomeModelApiKey.type = "password";
        }
        await refreshConnectionFromCapabilities();
        if (lastConnectionState && lastConnectionState.available) {
          welcomeModelVerified = true;
          welcomeModelSkipped = false;
          setWelcomeModelStateLabel("已连接", "ok");
          showStatus(els.welcomeModelStatus, "已保存并连接。");
          showWelcomeStep("start");
          if (els.welcomeModelReadyNote) {
            els.welcomeModelReadyNote.hidden = false;
            els.welcomeModelReadyNote.textContent = "模型已连接，可以直接开始使用。";
          }
          if (els.welcomeSkipHint) els.welcomeSkipHint.hidden = true;
        } else {
          setWelcomeModelStateLabel("尚未确认（可测试连接）", null);
          showStatus(els.welcomeModelStatus, "已保存密钥，但尚未确认连接。请检查高级连接设置。");
        }
      } catch (err) {
        const facing = userFacingModelError(err, "保存失败，请检查密钥或高级连接设置");
        showStatus(els.welcomeModelStatus, facing, true);
        setWelcomeModelStateLabel("无法连接，请检查密钥或高级连接设置", "error");
      } finally {
        if (els.btnWelcomeSaveModel) els.btnWelcomeSaveModel.disabled = false;
      }
    });
  }

  if (els.createPkg) {
    els.createPkg.addEventListener("click", () => {
      void tryStartFromWelcome({ skipIntro: false });
    });
  }

  if (els.createSkip) {
    els.createSkip.addEventListener("click", () => {
      void tryStartFromWelcome({ skipIntro: true });
    });
  }

  if (els.navChat) els.navChat.addEventListener("click", () => setNav("chat"));
  els.navSubject.addEventListener("click", () => setNav("subject"));
  els.navWork.addEventListener("click", () => setNav("work"));
  if (els.navCollab) els.navCollab.addEventListener("click", () => setNav("collab"));
  // 设置/帮助为次级入口，不在主导航平权
  els.newTask.addEventListener("click", () => {
    setNav("work");
    startNewTaskComposer();
  });
  if (els.workToggleTasks) {
    els.workToggleTasks.addEventListener("click", () => {
      if (!els.workLayout) return;
      setWorkTasksOpen(els.workLayout.dataset.tasks !== "open");
    });
  }
  if (els.workStageTabs) {
    els.workStageTabs.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-work-stage]") : null;
      if (!btn) return;
      setWorkStage(btn.getAttribute("data-work-stage"));
    });
  }
  if (els.restartCompose) {
    els.restartCompose.addEventListener("click", () => {
      const goal = els.goal ? String(els.goal.value || "") : "";
      const mats = materials.slice();
      startNewTaskComposer({ goal, materials: mats });
    });
  }

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
        if (typeof api.conversation.reply !== "function") {
          throw new Error("对话回复功能不可用");
        }
        els.chatSend.disabled = true;
        if (els.chatRetry) {
          els.chatRetry.hidden = true;
          els.chatRetry.setAttribute("hidden", "");
        }
        lastChatReplyFailed = false;
        if (els.chatStatus) els.chatStatus.textContent = "正在发送…";
        await api.conversation.append({ role: "user", text });
        lastChatUserText = text;
        if (els.chatInput) els.chatInput.value = "";
        await refreshChatPanel();

        if (els.chatStatus) els.chatStatus.textContent = "正在回复…";
        let replyText = "";
        let replyStatus = "complete";
        let userTurnId = null;
        try {
          const replied = await api.conversation.reply({ text });
          replyText = String((replied && replied.text) || "").trim();
          replyStatus = String((replied && replied.status) || "complete");
          userTurnId = replied && replied.userTurnId ? String(replied.userTurnId) : null;
        } catch (err) {
          lastChatReplyFailed = true;
          const msg = (err && err.message) || String(err);
          const incomplete = /回复未完成|CHAT_INCOMPLETE|timeout|网络|中断/i.test(msg);
          if (els.chatStatus) {
            els.chatStatus.textContent = incomplete
              ? "回复未完成，可重试"
              : `无法回复，请重试。${msg}`;
          }
          if (els.chatRetry) {
            els.chatRetry.hidden = false;
            els.chatRetry.removeAttribute("hidden");
          }
          await refreshChatPanel();
          return;
        }
        // 不完整：可落盘部分正文；空正文也不得伪装「已回复」
        if (replyStatus === "incomplete") {
          lastChatReplyFailed = true;
          if (replyText) {
            await api.conversation.append({ role: "assistant", text: replyText });
            await refreshChatPanel();
          }
          if (els.chatStatus) els.chatStatus.textContent = "回复未完成，可重试";
          if (els.chatRetry) {
            els.chatRetry.hidden = false;
            els.chatRetry.removeAttribute("hidden");
          }
          return;
        }
        if (!replyText || replyStatus === "failed") {
          lastChatReplyFailed = true;
          if (els.chatStatus) els.chatStatus.textContent = "无法回复，请重试";
          if (els.chatRetry) {
            els.chatRetry.hidden = false;
            els.chatRetry.removeAttribute("hidden");
          }
          return;
        }
        await api.conversation.append({ role: "assistant", text: replyText });
        await refreshChatPanel();
        lastChatReplyFailed = false;
        if (els.chatStatus) els.chatStatus.textContent = "已回复。";
        // 成长由主进程调度；此处仅在失败耗尽后展示克制提示（不暴露内部状态名）
        if (userTurnId && api.conversation.growthHint) {
          setTimeout(async () => {
            try {
              const hint = await api.conversation.growthHint({ turnId: userTurnId });
              if (hint && hint.message && els.chatStatus && !lastChatReplyFailed) {
                els.chatStatus.textContent = `已回复。${hint.message}`;
              }
            } catch {
              /* ignore */
            }
          }, 2500);
        }
      } catch (err) {
        lastChatReplyFailed = true;
        if (els.chatStatus) els.chatStatus.textContent = (err && err.message) || String(err);
        if (els.chatRetry) {
          els.chatRetry.hidden = false;
          els.chatRetry.removeAttribute("hidden");
        }
      } finally {
        if (els.chatSend) els.chatSend.disabled = false;
      }
    });
  }

  if (els.chatRetry) {
    els.chatRetry.addEventListener("click", async () => {
      const text = lastChatUserText;
      if (!text) {
        if (els.chatStatus) els.chatStatus.textContent = "没有可重试的消息。";
        return;
      }
      if (!api.conversation || typeof api.conversation.reply !== "function") {
        if (els.chatStatus) els.chatStatus.textContent = "对话回复功能不可用";
        return;
      }
      els.chatRetry.disabled = true;
      if (els.chatSend) els.chatSend.disabled = true;
      if (els.chatStatus) els.chatStatus.textContent = "正在回复…";
      try {
        // 重试：不重复写入用户消息，不重复成长采集
        const replied = await api.conversation.reply({ text });
        const replyText = String((replied && replied.text) || "").trim();
        const replyStatus = String((replied && replied.status) || "complete");
        if (replyStatus === "incomplete") {
          lastChatReplyFailed = true;
          if (replyText) {
            await api.conversation.append({ role: "assistant", text: replyText });
            await refreshChatPanel();
          }
          if (els.chatStatus) els.chatStatus.textContent = "回复未完成，可重试";
          els.chatRetry.hidden = false;
          els.chatRetry.removeAttribute("hidden");
          return;
        }
        if (!replyText || replyStatus === "failed") {
          lastChatReplyFailed = true;
          if (els.chatStatus) els.chatStatus.textContent = "无法回复，请重试";
          els.chatRetry.hidden = false;
          els.chatRetry.removeAttribute("hidden");
          return;
        }
        await api.conversation.append({ role: "assistant", text: replyText });
        await refreshChatPanel();
        lastChatReplyFailed = false;
        els.chatRetry.hidden = true;
        els.chatRetry.setAttribute("hidden", "");
        if (els.chatStatus) els.chatStatus.textContent = "已回复。";
      } catch (err) {
        lastChatReplyFailed = true;
        const msg = (err && err.message) || String(err);
        const incomplete = /回复未完成|CHAT_INCOMPLETE|timeout|网络|中断/i.test(msg);
        if (els.chatStatus) {
          els.chatStatus.textContent = incomplete
            ? "回复未完成，可重试"
            : `无法回复，请重试。${msg}`;
        }
        els.chatRetry.hidden = false;
        els.chatRetry.removeAttribute("hidden");
      } finally {
        els.chatRetry.disabled = false;
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
        lastChatReplyFailed = false;
        if (els.chatRetry) {
          els.chatRetry.hidden = true;
          els.chatRetry.setAttribute("hidden", "");
        }
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
  els.settingsBack.addEventListener("click", () => {
    const target = returnView || "shell";
    setView(target);
    if (target === "shell") {
      void (async () => {
        await setNav(returnNav || "work");
        if ((returnNav || "work") === "work" && workMode === "task" && activeTaskId) {
          await selectTask(activeTaskId);
        }
        if ((returnNav || "work") === "chat") {
          await refreshChatPanel();
        }
      })();
    }
  });
  if (els.helpBack) els.helpBack.addEventListener("click", () => setView(returnView || "shell"));
  els.modelProvider.addEventListener("change", () => {
    const next = els.modelProvider.value;
    if (next === "deepseek") {
      // 主动选择预设：套用推荐；若用户本会话已改高级字段且不像 DeepSeek，则保留并打开高级区提示
      const base = String(els.modelBaseUrl.value || "");
      const customUnlikeDeepseek = advancedFieldsDirty && base && !base.includes("deepseek");
      if (customUnlikeDeepseek) {
        if (els.advancedConnection) els.advancedConnection.open = true;
        showStatus(
          els.settingsStatus,
          "已切换到 DeepSeek。当前高级连接仍保留你改过的内容；需要推荐值可点「恢复推荐设置」。",
        );
      } else {
        applyProviderPreset({ force: true });
      }
    } else {
      syncAdvancedOpenForProvider();
      showStatus(els.settingsStatus, "自定义服务请填写高级连接中的服务地址与模型名称。");
    }
  });
  if (els.modelBaseUrl) {
    els.modelBaseUrl.addEventListener("input", () => {
      advancedFieldsDirty = true;
    });
  }
  if (els.modelId) {
    els.modelId.addEventListener("input", () => {
      advancedFieldsDirty = true;
    });
  }
  if (els.toggleApiKey) {
    els.toggleApiKey.addEventListener("click", () => {
      if (!els.modelApiKey) return;
      const show = els.modelApiKey.type === "password";
      els.modelApiKey.type = show ? "text" : "password";
      els.toggleApiKey.textContent = show ? "隐藏" : "显示";
      els.toggleApiKey.setAttribute("aria-pressed", show ? "true" : "false");
    });
  }
  if (els.restoreModelPreset) {
    els.restoreModelPreset.addEventListener("click", () => {
      els.modelProvider.value = "deepseek";
      applyProviderPreset({ force: true, keepAdvancedOpen: true });
      if (els.advancedConnection) els.advancedConnection.open = true;
      showStatus(els.settingsStatus, "已恢复 DeepSeek 推荐设置。可继续保存。");
      setSettingsTechDetail("");
    });
  }
  if (els.artifactType) {
    els.artifactType.addEventListener("change", () => refreshConnectionFromCapabilities());
  }

  els.saveModel.addEventListener("click", async () => {
    try {
      const apiKey = (els.modelApiKey.value || "").trim();
      const baseUrl = (els.modelBaseUrl.value || "").trim();
      const model = (els.modelId.value || "").trim();
      const configured = isCredentialConfigured();
      if (!apiKey && !configured) {
        showStatus(els.settingsStatus, "请输入 API Key 后再保存", true);
        setConnectionStateLabel("尚未连接", "error");
        return;
      }
      if (!baseUrl || !model) {
        if (els.advancedConnection) els.advancedConnection.open = true;
        showStatus(els.settingsStatus, "请在高级连接中填写服务地址与模型名称", true);
        setConnectionStateLabel("尚未连接", "error");
        return;
      }
      if (els.modelProvider.value === "openai-compatible" && (!baseUrl || !model)) {
        if (els.advancedConnection) els.advancedConnection.open = true;
        showStatus(els.settingsStatus, "自定义服务需要填写服务地址与模型名称", true);
        return;
      }
      els.saveModel.disabled = true;
      setConnectionStateLabel("正在检查", null);
      showStatus(els.settingsStatus, "正在保存…");
      setSettingsTechDetail("");
      const result = await api.saveModelCredential({
        apiKey,
        baseUrl,
        model,
        providerPreset: els.modelProvider.value,
        allowExistingKey: !apiKey && configured,
      });
      rememberShellMeta(result || {});
      els.modelApiKey.value = "";
      if (els.modelApiKey) els.modelApiKey.type = "password";
      if (els.toggleApiKey) {
        els.toggleApiKey.textContent = "显示";
        els.toggleApiKey.setAttribute("aria-pressed", "false");
      }
      advancedFieldsDirty = false;
      updateKeyStateUi();
      await refreshConnectionFromCapabilities();
      if (lastConnectionState && lastConnectionState.available) {
        setConnectionStateLabel("已连接", "ok");
        showStatus(els.settingsStatus, "已保存并连接。");
      } else {
        setConnectionStateLabel("尚未确认（可测试连接）", null);
        showStatus(els.settingsStatus, "已保存密钥。可点「测试连接」确认。");
      }
    } catch (err) {
      const facing = userFacingModelError(err, "保存失败，请检查密钥或高级连接设置");
      showStatus(els.settingsStatus, facing, true);
      setConnectionStateLabel("无法连接，请检查密钥或高级连接设置", "error");
      setSettingsTechDetail((err && err.message) || String(err || ""));
    } finally {
      els.saveModel.disabled = false;
    }
  });

  if (els.btnRemoteCapTest) {
    els.btnRemoteCapTest.addEventListener("click", async () => {
      const baseUrl = els.remoteCapBaseUrl ? String(els.remoteCapBaseUrl.value || "").trim() : "";
      if (!baseUrl) {
        showStatus(els.remoteCapSettingsStatus, "请填写服务地址", true);
        if (els.collabExtCapConnectPanel) els.collabExtCapConnectPanel.hidden = false;
        if (els.collabExtCapAdvanced) els.collabExtCapAdvanced.open = true;
        return;
      }
      setRemoteCapStatusLabel("状态：正在检查");
      showStatus(els.remoteCapSettingsStatus, "正在检查连接…");
      try {
        const result = await api.testRemoteCapability({ baseUrl });
        if (result && result.ok) {
          const label =
            (result.remoteCapability && result.remoteCapability.statusLabel) || "可用";
          setRemoteCapStatusLabel(`状态：${label}`);
          showStatus(els.remoteCapSettingsStatus, result.message || "连接正常");
        } else {
          setRemoteCapStatusLabel("状态：暂时无法连接");
          showStatus(
            els.remoteCapSettingsStatus,
            (result && result.message) || REMOTE_CONNECT_FAIL,
            true,
          );
        }
      } catch (err) {
        setRemoteCapStatusLabel("状态：暂时无法连接");
        showStatus(els.remoteCapSettingsStatus, userFacingRemoteError(err, REMOTE_CONNECT_FAIL), true);
      }
    });
  }

  if (els.btnRemoteCapSave) {
    els.btnRemoteCapSave.addEventListener("click", async () => {
      const baseUrl = els.remoteCapBaseUrl ? String(els.remoteCapBaseUrl.value || "").trim() : "";
      if (!baseUrl) {
        showStatus(els.remoteCapSettingsStatus, "请填写服务地址", true);
        return;
      }
      setRemoteCapStatusLabel("状态：正在检查");
      els.btnRemoteCapSave.disabled = true;
      showStatus(els.remoteCapSettingsStatus, "正在检查并保存…");
      try {
        const result = await api.saveRemoteCapability({ baseUrl });
        if (!result || result.ok === false) {
          setRemoteCapStatusLabel("状态：暂时无法连接");
          showStatus(
            els.remoteCapSettingsStatus,
            (result && result.message) || REMOTE_CONNECT_FAIL,
            true,
          );
          return;
        }
        rememberShellMeta(result || {});
        setRemoteCapStatusLabel(
          `状态：${
            (result.remoteCapability && result.remoteCapability.statusLabel) || "可用"
          }`,
        );
        showStatus(els.remoteCapSettingsStatus, result.message || "研究分析能力已可用。");
        if (els.collabExtCapConnectPanel) els.collabExtCapConnectPanel.hidden = true;
        await refreshConnectionFromCapabilities();
        await refreshExternalCapabilityCard();
      } catch (err) {
        setRemoteCapStatusLabel("状态：暂时无法连接");
        showStatus(els.remoteCapSettingsStatus, userFacingRemoteError(err, REMOTE_CONNECT_FAIL), true);
      } finally {
        els.btnRemoteCapSave.disabled = false;
      }
    });
  }

  if (els.btnRemoteCapDisable) {
    els.btnRemoteCapDisable.addEventListener("click", async () => {
      els.btnRemoteCapDisable.disabled = true;
      try {
        const result = await api.disableRemoteCapability();
        rememberShellMeta(result || {});
        refreshRemoteCapabilityUi(result && result.remoteCapability);
        showStatus(els.remoteCapSettingsStatus, result.message || "已停用外部专业能力。");
        await refreshConnectionFromCapabilities();
        await refreshExternalCapabilityCard();
      } catch (err) {
        showStatus(
          els.remoteCapSettingsStatus,
          userFacingRemoteError(err, "停用失败，请稍后重试。"),
          true,
        );
      } finally {
        els.btnRemoteCapDisable.disabled = false;
      }
    });
  }

  if (els.btnCollabExtConnect) {
    els.btnCollabExtConnect.addEventListener("click", () => {
      if (els.collabExtCapConnectPanel) {
        els.collabExtCapConnectPanel.hidden = false;
      }
      if (els.collabExtCapAdvanced) els.collabExtCapAdvanced.open = true;
      if (els.remoteCapBaseUrl) {
        try {
          els.remoteCapBaseUrl.focus();
        } catch {
          /* ignore */
        }
      }
    });
  }

  if (els.btnCollabExtAuth) {
    els.btnCollabExtAuth.addEventListener("click", async () => {
      if (!els.collabExtCapAuthPanel || !els.collabExtCapAuthPoints) return;
      try {
        const res = await api.invoke("capability.list", {
          includeAvailability: true,
          previewAuthorization: {
            goal: "请根据已授权材料，形成 500–800 字结构化项目风险摘要。",
            allowedMaterialPaths: [],
          },
        });
        const points =
          res.authorizationPreview && Array.isArray(res.authorizationPreview.confirmPoints)
            ? res.authorizationPreview.confirmPoints
            : [
                "只会发送你明确勾选的材料与任务要求文字。",
                "不会发送完整数字之我资料、对话记录或其它任务。",
                "可随时取消；迟到成果不会加入你的成果。",
              ];
        els.collabExtCapAuthPoints.innerHTML = "";
        for (const p of points) {
          const li = document.createElement("li");
          li.textContent = p;
          els.collabExtCapAuthPoints.appendChild(li);
        }
        els.collabExtCapAuthPanel.hidden = false;
      } catch {
        showStatus(els.remoteCapSettingsStatus, "暂时无法显示授权边界，请稍后重试。", true);
      }
    });
  }

  els.testModel.addEventListener("click", async () => {
    const keptKey = els.modelApiKey ? els.modelApiKey.value : "";
    try {
      setConnectionStateLabel("正在检查", null);
      showStatus(els.settingsStatus, "正在检查连接…");
      setSettingsTechDetail("");
      const result = await api.testModelConnection({
        baseUrl: (els.modelBaseUrl.value || "").trim(),
        model: (els.modelId.value || "").trim(),
        apiKey: (els.modelApiKey.value || "").trim() || undefined,
        providerPreset: els.modelProvider.value,
      });
      if (els.modelApiKey) els.modelApiKey.value = keptKey;
      if (result && result.ok) {
        setConnectionStateLabel("已连接", "ok");
        showStatus(els.settingsStatus, "连接成功。");
      } else {
        const reason = redactSecrets((result && result.reason) || "连接失败");
        setConnectionStateLabel("无法连接，请检查密钥或高级连接设置", "error");
        showStatus(els.settingsStatus, "无法连接，请检查密钥或高级连接设置", true);
        setSettingsTechDetail(reason);
      }
    } catch (err) {
      if (els.modelApiKey) els.modelApiKey.value = keptKey;
      const facing = userFacingModelError(err, "无法连接，请检查密钥或高级连接设置");
      setConnectionStateLabel("无法连接，请检查密钥或高级连接设置", "error");
      showStatus(els.settingsStatus, facing, true);
      setSettingsTechDetail((err && err.message) || String(err || ""));
    }
  });

  els.deleteModel.addEventListener("click", async () => {
    try {
      const result = await api.deleteModelCredential({});
      rememberShellMeta(result || {});
      els.modelApiKey.value = "";
      if (els.modelApiKey) els.modelApiKey.type = "password";
      if (els.toggleApiKey) {
        els.toggleApiKey.textContent = "显示";
        els.toggleApiKey.setAttribute("aria-pressed", "false");
      }
      await refreshConnectionFromCapabilities();
      updateKeyStateUi();
      setConnectionStateLabel("尚未连接", null);
      showStatus(els.settingsStatus, "已清除密钥。");
      setSettingsTechDetail("");
    } catch (err) {
      showStatus(
        els.settingsStatus,
        userFacingModelError(err, "清除失败，请稍后重试"),
        true,
      );
      await refreshConnectionFromCapabilities();
    }
  });

  els.addFiles.addEventListener("click", async () => {
    if (workMode !== "compose") {
      els.jobActionable.textContent = "如需更换材料，请先点「重新开始」或「新建任务」。";
      return;
    }
    const files = await api.dialogs.pickOpenFiles();
    for (const p of files || []) materials.push({ kind: "file", path: p });
    renderMaterials();
  });

  els.addFolder.addEventListener("click", async () => {
    if (workMode !== "compose") {
      els.jobActionable.textContent = "如需更换材料，请先点「重新开始」或「新建任务」。";
      return;
    }
    const folder = await api.dialogs.pickOpenDirectory();
    if (folder) materials.push({ kind: "folder", path: folder });
    renderMaterials();
  });

  els.clearMaterials.addEventListener("click", () => {
    if (workMode !== "compose") {
      els.jobActionable.textContent = "如需清空材料，请先点「重新开始」或「新建任务」。";
      return;
    }
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
      const result = await api.invoke("subject.captureInput", {
        text,
        sourceKind: "conversation",
      });
      els.subjectMore.value = "";
      const outcome = result && result.captureOutcome;
      if (outcome === "distill_failed") {
        els.subjectActionStatus.textContent = "刚才这条体会还没记上，请稍后再试。";
      } else if (outcome === "pending_confirmation") {
        els.subjectActionStatus.textContent = "有一条新体会待你确认。";
      } else if (outcome === "nothing_to_learn") {
        els.subjectActionStatus.textContent = "已收到。这次没有需要记住的新要点。";
      } else {
        els.subjectActionStatus.textContent = "已记下。";
      }
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
      const payload = {
        goal,
        contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path })),
      };
      // 不强迫传成果类型；Runtime 按意图派生。显式仅在隐藏控件有非空值时透传。
      if (type) payload.requestedArtifactType = type;
      const result = await api.invoke("work.submitTask", payload);
      workMode = "task";
      activeTaskId = result.taskId;
      activeJobId = result.jobId;
      activeTaskIntentKind = result.intentKind || null;
      activeTaskRequestedArtifactType =
        result.intentKind === "analyze_code" ? "code-analysis" : "document";
      els.goal.readOnly = true;
      if (els.workComposeTitle) els.workComposeTitle.textContent = "当前任务";
      setWorkCollabVisible(true);
      syncGoalPresentation();
      if (result.userFacingNotice) {
        els.jobStatus.textContent = result.userFacingNotice;
        els.jobStatus.classList.remove("error");
        if (els.jobActionable) els.jobActionable.textContent = "";
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
      const rejectionReason = String(
        lastArtifactRejectionReason ||
          (els.decisionNote && els.decisionNote.value) ||
          "",
      ).trim();
      const result = await api.invoke("work.reviseArtifact", {
        taskId: activeTaskId,
        artifactId: activeArtifactId,
        revisionRequest,
        ...(rejectionReason ? { rejectionReason } : {}),
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

  if (els.bundleReport && "addEventListener" in els.bundleReport) {
    els.bundleReport.addEventListener("input", () => {
      if (suppressSave || !activeArtifactId || workMode !== "task") return;
      if (activeArtifactKind !== "bundle") return;
      els.saveStatus.textContent = "正在保存人工编辑…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const text =
            "value" in els.bundleReport
              ? els.bundleReport.value
              : els.bundleReport.textContent || "";
          await api.invoke("artifact.saveEdit", {
            artifactId: activeArtifactId,
            text,
          });
          els.saveStatus.textContent = "已保存人工编辑；依据未同步更新";
          if (els.bundleStaleNotice) {
            els.bundleStaleNotice.hidden = false;
            els.bundleStaleNotice.removeAttribute("hidden");
          }
          if (activeArtifactId) await loadArtifact(activeArtifactId);
        } catch (err) {
          els.saveStatus.textContent = err.message || "保存失败";
        }
      }, 500);
    });
  }

  els.copy.addEventListener("click", async () => {
    const resolve =
      (window.DigitalMeBundleCopy && window.DigitalMeBundleCopy.resolveCopyPayload) || null;
    if (!resolve) {
      els.saveStatus.textContent = "复制功能不可用";
      return;
    }
    const payload = resolve({
      kind: activeArtifactKind,
      editorText: els.artifactEditor.value,
      reportText: els.bundleReport
        ? "value" in els.bundleReport
          ? els.bundleReport.value
          : els.bundleReport.textContent
        : "",
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

  function collabUserLabel(item) {
    if (!item) return "";
    if (item.status === "revoked" || item.status === "withdrawn") return "已撤销";
    if (item.status === "failed") return "未完成";
    if (item.status === "running") return "正在处理";
    if (item.status === "awaiting_owner") return "等待对方确认";
    if (item.status === "awaiting_clarification") return "等待补充说明";
    if (item.status === "counter_proposed") return "对方提出调整";
    if (item.status === "proposed") return "等待对方回应";
    if (item.status === "delivered") return "需要你确认";
    if (item.status === "authorized" || item.status === "agreed" || item.status === "requested") {
      return "等待开始";
    }
    if (item.ownerDecision === "accept" || item.status === "completed") return "已完成";
    if (item.ownerDecision === "reject" || item.status === "rejected") return "未完成";
    return "等待开始";
  }

  function collabBucket(item) {
    if (item.status === "revoked" || item.status === "withdrawn") return "revoked";
    if (item.status === "failed") return "active";
    if (
      item.ownerDecision === "accept" ||
      item.ownerDecision === "reject" ||
      item.status === "rejected" ||
      item.status === "completed"
    ) {
      return "done";
    }
    if (item.status === "delivered") return "done";
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
    // external-cap-panel 已迁入协作向导，勿在做事页重置时隐藏
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
    const listed = await api.invoke("collab.interact", { action: "list" });
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
        li.addEventListener("click", () => openCollabDetail(item.recordId || item.grantId));
        li.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openCollabDetail(item.recordId || item.grantId);
          }
        });
        ul.appendChild(li);
      }
    }

    fill(els.collabListActive, els.collabEmptyActive, buckets.active);
    fill(els.collabListDone, els.collabEmptyDone, buckets.done);
    fill(els.collabListRevoked, els.collabEmptyRevoked, buckets.revoked);
    await fillRemoteCapabilitySettings();
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
      (activeGrantId &&
        forTask.find((i) => i.recordId === activeGrantId || i.grantId === activeGrantId)) ||
      forTask[0] ||
      null;
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
    activeGrantId = current.recordId || current.grantId;
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
      const st = await api.invoke("collab.interact", {
        action: "status",
        recordId: grantId,
        grantId,
      });
      const item = {
        recordId: st.recordId || grantId,
        grantId: st.grantId,
        status: st.status,
        ownerDecision: st.ownerDecision || st.grant?.ownerDecision,
        subtaskGoal: st.grant?.subtaskGoal,
        granteeDisplayName: st.grant?.granteeDisplayName,
        allowedMaterials: st.grant?.allowedMaterials || [],
        returnedExcerpt: st.artifactText || st.grant?.returnedExcerpt || "",
        issuerTaskId: st.grant?.issuerTaskId,
        failureMessage: st.grant?.failureMessage,
        localArtifactId: st.grant?.localArtifactId || st.artifactId,
      };
      activeGrantId = item.recordId;
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
      const revoked = item.status === "revoked" || item.status === "withdrawn";
      const hasReturn = !!text || item.status === "delivered";
      const isFailed = item.status === "failed";
      const canFulfill =
        !revoked &&
        !hasReturn &&
        !isFailed &&
        (item.status === "authorized" || item.status === "agreed");
      const canRetry = !revoked && isFailed;
      if (els.btnCollabDetailExecute) {
        els.btnCollabDetailExecute.hidden = canRetry;
        els.btnCollabDetailExecute.disabled = !canFulfill;
      }
      if (els.btnCollabDetailRetry) {
        els.btnCollabDetailRetry.hidden = !canRetry;
      }
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
      const peer = await api.invoke("collab.interact", {
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
      action: "propose",
      granteePackageDir: peer,
      subtaskGoal: goal,
      intent: goal,
      allowedMaterialPaths: mats,
      acceptanceCriteria: ["提供可核对的完整成果，并说明依据"],
      deadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };
    // 仅做事页已有任务时写入关联；协作页新建不创建空 Task。
    if (opts.issuerTaskId) payload.issuerTaskId = opts.issuerTaskId;
    const issued = await api.invoke("collab.interact", payload);
    activeGrantId = issued.recordId || issued.grantId;
    return issued;
  }

  async function executeActiveGrant(statusEl, returnEl, errorEl) {
    showStatus(errorEl, "");
    if (!activeGrantId) return;
    if (statusEl) statusEl.textContent = "正在处理";
    try {
      const result = await api.invoke("collab.interact", {
        action: "fulfill",
        recordId: activeGrantId,
        grantId: activeGrantId,
      });
      if (result.denied) {
        showStatus(errorEl, collabErrorMessage({ message: result.reason }, "execute"), true);
        if (statusEl) statusEl.textContent = "未完成";
        return;
      }
      if (result.status === "failed") {
        showStatus(errorEl, "对方未能完成", true);
        if (statusEl) statusEl.textContent = "未完成";
        return;
      }
      if (statusEl) statusEl.textContent = "需要你确认";
      const text = result.artifactText || "";
      if (returnEl) {
        returnEl.hidden = !text;
        returnEl.textContent = text;
      }
      await refreshCollabHome();
      await syncWorkCollabFromDomain();
    } catch (err) {
      showStatus(errorEl, collabErrorMessage(err, "execute"), true);
      if (statusEl) statusEl.textContent = "未完成";
    }
  }

  async function decideCollabReturn(decision, statusEl, errorEl) {
    showStatus(errorEl, "");
    if (!activeGrantId) return;
    try {
      await api.invoke("collab.interact", {
        action: "decideResult",
        recordId: activeGrantId,
        grantId: activeGrantId,
        decision,
      });
      if (statusEl) {
        statusEl.textContent = decision === "accept" ? "已完成" : "未完成";
      }
      await refreshCollabHome();
      await syncWorkCollabFromDomain();
      if (decision === "accept") {
        let targetTask = activeTaskId || null;
        try {
          const st = await api.invoke("collab.interact", {
            action: "status",
            recordId: activeGrantId,
            grantId: activeGrantId,
          });
          if (st && st.grant && st.grant.issuerTaskId) targetTask = st.grant.issuerTaskId;
        } catch {
          /* ignore */
        }
        if (!targetTask && collabDraftFromWork && collabDraftFromWork.issuerTaskId) {
          targetTask = collabDraftFromWork.issuerTaskId;
        }
        if (targetTask) {
          await setNav("work");
          await selectTask(targetTask);
          try {
            const detail = await api.invoke("work.getTask", { taskId: targetTask });
            if (detail.artifactIds && detail.artifactIds[0]) {
              await loadArtifact(detail.artifactIds[0]);
            }
          } catch {
            /* ignore */
          }
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
      await api.invoke("collab.interact", {
        action: "revoke",
        recordId: activeGrantId,
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
    if (!els.collabMaterialChecks) return;
    const items = materials.map((m) => ({ path: m.path, checked: false }));
    renderMaterialChecks(els.collabMaterialChecks, items, () => {
      if (els.collabConfirm) els.collabConfirm.hidden = true;
    });
    els._workCollabMats = items;
  }

  function syncCollabTargetMode() {
    if (!els.collabTargetMode) return;
    const mode = String(els.collabTargetMode.value || "local-peer");
    const external = mode === "external-research";
    if (els.collabLocalPeerBlock) els.collabLocalPeerBlock.hidden = external;
    if (els.collabExternalHint) els.collabExternalHint.hidden = !external;
    if (external && els.collabConfirm) els.collabConfirm.hidden = true;
  }

  if (els.collabTargetMode) {
    els.collabTargetMode.addEventListener("change", () => {
      syncCollabTargetMode();
      showStatus(els.collabError, "");
    });
    syncCollabTargetMode();
  }

  if (els.collabOpen) {
    els.collabOpen.addEventListener("click", () => {
      void openCollabWizardFromWork("collab");
    });
  }

  if (els.collabPageTargetMode) {
    els.collabPageTargetMode.addEventListener("change", () => {
      collabWizardExternal = false;
      const mode = syncCollabPageMode();
      if (collabDraftFromWork) collabDraftFromWork.mode = mode;
      showStatus(els.collabPageNewError, "");
      if (mode === "external-research") {
        void refreshExternalCapabilityCard();
      }
    });
  }

  function fillExternalMaterialChecks() {
    externalCapMats = materials.map((m) => ({
      path: m.path,
      checked: false,
    }));
    renderMaterialChecks(els.externalCapMaterialChecks, externalCapMats, () => {
      if (els.externalCapConfirm && !els.externalCapConfirm.hidden) {
        void refreshExternalAuthPreview();
      }
    });
  }

  function hideExternalCandidate() {
    if (els.externalCapResult) els.externalCapResult.hidden = true;
    if (els.externalCapBody) els.externalCapBody.textContent = "";
    if (els.externalCapFailureActions) els.externalCapFailureActions.hidden = true;
    renderExternalCapCheckStatus(null);
  }

  function stopExternalCapWatch() {
    if (externalCapWatchTimer) {
      clearInterval(externalCapWatchTimer);
      externalCapWatchTimer = null;
    }
  }

  function applyExternalCard(card) {
    if (!card) return;
    if (els.externalCapName) els.externalCapName.textContent = card.displayName || "研究分析能力";
    if (els.externalCapDesc) els.externalCapDesc.textContent = card.shortDescription || "";
    if (els.externalCapSuitable) els.externalCapSuitable.textContent = card.suitableFor || "";
    if (els.externalCapShare) els.externalCapShare.textContent = card.shareSummary || "";
    if (els.externalCapEta) els.externalCapEta.textContent = card.estimatedDuration || "";
    if (els.externalCapAvail) {
      els.externalCapAvail.textContent = `当前是否可用：${card.availabilityLabel || (card.available ? "当前可用" : "当前不可用")}`;
    }
  }

  async function refreshExternalCapabilityCard() {
    const mats = selectedMaterialPaths(externalCapMats);
    const goal =
      (els.externalCapGoal && String(els.externalCapGoal.value || "").trim()) ||
      "请根据已授权材料，形成 500–800 字结构化项目风险摘要。";
    try {
      const res = await api.invoke("capability.list", {
        includeAvailability: true,
        previewAuthorization: {
          goal,
          allowedMaterialPaths: mats,
          ...(externalCapCapabilityId ? { capabilityId: externalCapCapabilityId } : {}),
        },
      });
      const list = (res && res.capabilities) || [];
      const research = list.find(
        (c) =>
          c &&
          (c.id === "cap_a2a_research_analysis" ||
            String(c.displayName || "").includes("研究分析能力") ||
            String(c.displayName || "").includes("研究分析")),
      );
      if (research) externalCapCapabilityId = research.id;
      if (res.externalCapabilityCard) applyExternalCard(res.externalCapabilityCard);
      else if (!research) {
        applyExternalCard({
          displayName: "研究分析能力",
          shortDescription: "可根据授权材料形成结构化项目风险摘要。",
          suitableFor: "适合完成：基于明确授权材料的结构化项目风险摘要（约 500–800 字）。",
          shareSummary: "将共享：仅你勾选的材料与任务要求文字。",
          estimatedDuration: "预计可能耗时：数秒到两分钟。",
          available: false,
          availabilityLabel: externalCapUnavailableMessage(),
        });
      }
      return res;
    } catch {
      applyExternalCard({
        displayName: "研究分析能力",
        shortDescription: "可根据授权材料形成结构化项目风险摘要。",
        suitableFor: "适合完成：基于明确授权材料的结构化项目风险摘要（约 500–800 字）。",
        shareSummary: "将共享：仅你勾选的材料与任务要求文字。",
        estimatedDuration: "预计可能耗时：数秒到两分钟。",
        available: false,
        availabilityLabel: externalCapUnavailableMessage(),
      });
      return null;
    }
  }

  async function refreshExternalAuthPreview() {
    const goal = els.externalCapGoal ? String(els.externalCapGoal.value || "").trim() : "";
    const extra = els.externalCapExtra ? String(els.externalCapExtra.value || "").trim() : "";
    const mats = selectedMaterialPaths(externalCapMats);
    if (!goal) {
      showStatus(els.externalCapError, "请填写任务要求", true);
      return null;
    }
    const res = await api.invoke("capability.list", {
      includeAvailability: true,
      previewAuthorization: {
        goal,
        allowedMaterialPaths: mats,
        ...(extra ? { extraNote: extra } : {}),
        ...(externalCapCapabilityId ? { capabilityId: externalCapCapabilityId } : {}),
      },
    });
    if (res.externalCapabilityCard) applyExternalCard(res.externalCapabilityCard);
    const points =
      res.authorizationPreview && Array.isArray(res.authorizationPreview.confirmPoints)
        ? res.authorizationPreview.confirmPoints
        : null;
    if (!points) {
      showStatus(els.externalCapError, "无法生成授权说明，请稍后重试", true);
      return null;
    }
    renderConfirmPoints(els.externalCapConfirmPoints, points);
    if (els.externalCapConfirm) els.externalCapConfirm.hidden = false;
    showStatus(els.externalCapError, "");
    return res;
  }

  function showExternalFailureActions(kind) {
    if (!els.externalCapFailureActions) return;
    els.externalCapFailureActions.hidden = false;
    const showGoto = kind === "goto_collab" || kind === "check_connection";
    const showRetry = kind === "retry_or_local" || showGoto;
    if (els.btnExternalGotoCollab) els.btnExternalGotoCollab.hidden = !showGoto;
    if (els.btnExternalRetry) els.btnExternalRetry.hidden = !showRetry;
    if (els.btnExternalUseLocal) els.btnExternalUseLocal.hidden = kind !== "retry_or_local";
    if (els.btnExternalBackTask) els.btnExternalBackTask.hidden = false;
  }

  async function showExternalCandidate(artifactId, returnedAt, selfCheck) {
    if (!artifactId) return;
    externalCapArtifactId = artifactId;
    const content = await api.invoke("artifact.getContent", { artifactId });
    const text = content && content.text ? String(content.text) : "";
    if (els.externalCapSource) {
      els.externalCapSource.textContent = "来源：研究分析能力";
    }
    if (els.externalCapReturnedAt) {
      els.externalCapReturnedAt.textContent = returnedAt
        ? `返回时间：${returnedAt}`
        : "返回时间：刚刚";
    }
    renderExternalCapCheckStatus(selfCheck);
    if (els.externalCapBody) els.externalCapBody.textContent = text;
    if (els.externalCapResult) els.externalCapResult.hidden = false;
  }

  async function syncExternalCapStatus() {
    if (!externalCapTaskId) return;
    try {
      const detail = await api.invoke("work.getTask", { taskId: externalCapTaskId });
      const job = detail && detail.latestJob;
      if (job) externalCapJobId = job.jobId;
      const label = detail.userFacingLabel || "";
      if (els.externalCapStatus) els.externalCapStatus.textContent = label;
      if (els.btnExternalCapCancel) {
        els.btnExternalCapCancel.disabled = !(
          job &&
          (job.status === "queued" || job.status === "running")
        );
      }
      if (job && job.status === "failed") {
        stopExternalCapWatch();
        const msg = job.actionable || "研究分析能力目前无法使用，请稍后重试或改用本地能力。";
        showStatus(els.externalCapError, msg, true);
        if (/尚未连接/.test(msg)) showExternalFailureActions("goto_collab");
        else if (/材料无法按当前授权/.test(msg)) showExternalFailureActions("reselect_materials");
        else if (/完整性检查/.test(msg)) {
          if (els.externalCapFailureActions) els.externalCapFailureActions.hidden = true;
        } else showExternalFailureActions("retry_or_local");
        return;
      }
      if (job && job.status === "cancelled") {
        stopExternalCapWatch();
        if (els.externalCapStatus) els.externalCapStatus.textContent = "已取消";
        showStatus(els.externalCapError, job.actionable || "已停止本次外部处理。", false);
        hideExternalCandidate();
        return;
      }
      if (job && job.status === "succeeded" && detail.artifactIds && detail.artifactIds[0]) {
        stopExternalCapWatch();
        if (els.externalCapStatus) els.externalCapStatus.textContent = "已返回成果";
        showStatus(els.externalCapError, "");
        if (els.externalCapFailureActions) els.externalCapFailureActions.hidden = true;
        await showExternalCandidate(detail.artifactIds[0], job.startedAt || "");
        await refreshTasks();
      }
    } catch (err) {
      stopExternalCapWatch();
      showStatus(
        els.externalCapError,
        "研究分析能力目前无法使用，请稍后重试或改用本地能力。",
        true,
      );
      showExternalFailureActions("retry_or_local");
      void err;
    }
  }

  function startExternalCapWatch() {
    stopExternalCapWatch();
    externalCapWatchTimer = setInterval(() => {
      void syncExternalCapStatus();
    }, 1000);
    void syncExternalCapStatus();
  }

  if (els.externalCapOpen) {
    els.externalCapOpen.addEventListener("click", () => {
      void openCollabWizardFromWork("external");
    });
  }

  if (els.btnExternalCapPreview) {
    els.btnExternalCapPreview.addEventListener("click", async () => {
      try {
        await refreshExternalAuthPreview();
      } catch (err) {
        showStatus(els.externalCapError, "无法生成授权说明，请稍后重试", true);
        void err;
      }
    });
  }

  if (els.btnExternalCapIssue) {
    els.btnExternalCapIssue.addEventListener("click", async () => {
      showStatus(els.externalCapError, "");
      if (!activeTaskId) {
        showStatus(els.externalCapError, "请先开始或选择一个任务", true);
        return;
      }
      const goal = els.externalCapGoal ? String(els.externalCapGoal.value || "").trim() : "";
      const extra = els.externalCapExtra ? String(els.externalCapExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(externalCapMats);
      if (!goal) {
        showStatus(els.externalCapError, "请填写任务要求", true);
        return;
      }
      if (els.externalCapConfirm && els.externalCapConfirm.hidden) {
        try {
          await refreshExternalAuthPreview();
        } catch (err) {
          showStatus(els.externalCapError, "无法生成授权说明，请稍后重试", true);
          void err;
        }
        return;
      }
      try {
        const listed = await refreshExternalCapabilityCard();
        const list = (listed && listed.capabilities) || [];
        const research = list.find(
          (c) =>
            c &&
            (c.id === "cap_a2a_research_analysis" ||
              String(c.displayName || "").includes("研究分析能力") ||
              String(c.displayName || "").includes("研究分析")),
        );
        if (!research) {
          showStatus(els.externalCapError, externalCapUnavailableMessage(), true);
          showExternalFailureActions("goto_collab");
          return;
        }
        if (listed && listed.externalCapabilityCard && !listed.externalCapabilityCard.available) {
          const card = listed.externalCapabilityCard;
          const label = card.availabilityLabel || "";
          showStatus(els.externalCapError, externalCapUnavailableMessage(card), true);
          if (/设置|配置|未配置|尚未验证|不可用|尚未连接/.test(label)) {
            showExternalFailureActions("goto_collab");
          } else {
            showExternalFailureActions("retry_or_local");
          }
          return;
        }
        const fullGoal = extra ? `${goal}\n补充说明：${extra}` : goal;
        const result = await api.invoke("work.submitTask", {
          goal: fullGoal,
          contextRefs: mats.map((p) => ({ kind: "file", path: p })),
          requestedArtifactType: "document",
          capabilityId: research.id,
        });
        externalCapTaskId = result.taskId;
        externalCapJobId = result.jobId;
        externalCapArtifactId = null;
        activeTaskId = result.taskId;
        activeJobId = result.jobId;
        hideExternalCandidate();
        if (els.externalCapFailureActions) els.externalCapFailureActions.hidden = true;
        if (els.externalCapStatus) els.externalCapStatus.textContent = "准备中";
        if (els.btnExternalCapCancel) els.btnExternalCapCancel.disabled = false;
        showStatus(els.externalCapError, "");
        await refreshTasks();
        startExternalCapWatch();
        startJobWatch(result.taskId);
      } catch (err) {
        const msg = err && err.message ? String(err.message) : "";
        if (/credential|secret|尚未连接|api[_-]?key/i.test(msg)) {
          showStatus(els.externalCapError, externalCapUnavailableMessage(), true);
          showExternalFailureActions("goto_collab");
        } else if (/material|授权|projection/i.test(msg)) {
          showStatus(els.externalCapError, "所选材料无法按当前授权发送，请重新选择。", true);
          showExternalFailureActions("reselect_materials");
        } else {
          showStatus(
            els.externalCapError,
            "研究分析能力目前无法使用，请稍后重试或改用本地能力。",
            true,
          );
          showExternalFailureActions("retry_or_local");
        }
      }
    });
  }

  if (els.btnExternalCapCancel) {
    els.btnExternalCapCancel.addEventListener("click", async () => {
      if (!externalCapJobId) return;
      try {
        await api.invoke("work.cancelJob", { jobId: externalCapJobId });
        if (els.externalCapStatus) els.externalCapStatus.textContent = "已取消";
        showStatus(els.externalCapError, "已停止本次外部处理。", false);
        hideExternalCandidate();
        stopExternalCapWatch();
        await refreshTasks();
      } catch {
        showStatus(els.externalCapError, "已停止本次外部处理。", false);
      }
    });
  }

  if (els.btnExternalGotoCollab) {
    els.btnExternalGotoCollab.addEventListener("click", async () => {
      showCollabPage("home");
      await refreshCollabHome();
    });
  }
  if (els.btnExternalRetry) {
    els.btnExternalRetry.addEventListener("click", async () => {
      if (externalCapTaskId) {
        try {
          const res = await api.invoke("work.retryTask", { taskId: externalCapTaskId });
          externalCapJobId = res.jobId;
          hideExternalCandidate();
          showStatus(els.externalCapError, "");
          if (els.externalCapFailureActions) els.externalCapFailureActions.hidden = true;
          startExternalCapWatch();
        } catch {
          if (els.btnExternalCapIssue) els.btnExternalCapIssue.click();
        }
      } else if (els.btnExternalCapIssue) {
        els.btnExternalCapIssue.click();
      }
    });
  }
  if (els.btnExternalUseLocal) {
    els.btnExternalUseLocal.addEventListener("click", async () => {
      showStatus(els.externalCapError, "");
      if (els.goal && els.externalCapGoal) {
        const g = String(els.externalCapGoal.value || "").trim();
        if (g && !String(els.goal.value || "").trim()) els.goal.value = g;
      }
      await setNav("work");
      showStatus(els.jobActionable, "已切换为本地处理：请确认材料后点击「开始处理」。", false);
    });
  }
  if (els.btnExternalBackTask) {
    els.btnExternalBackTask.addEventListener("click", async () => {
      showStatus(els.externalCapError, "");
      await setNav("work");
      if (activeTaskId) await selectTask(activeTaskId);
    });
  }

  async function decideExternalCandidate(decision) {
    if (!externalCapArtifactId || !externalCapTaskId) return;
    try {
      const content = await api.invoke("artifact.getContent", {
        artifactId: externalCapArtifactId,
      });
      const versionId = content && content.headVersionId ? content.headVersionId : undefined;
      await api.invoke("subject.captureInput", {
        text:
          decision === "accept"
            ? "采用研究分析能力返回的成果"
            : "不采用外部专业能力返回的成果",
        sourceKind: decision === "accept" ? "artifact_acceptance" : "artifact_rejection",
        taskId: externalCapTaskId,
        artifactId: externalCapArtifactId,
        ...(versionId ? { artifactVersionId: versionId } : {}),
        requestedArtifactType: "document",
        sourceCapabilityKind: "external_capability",
        ...(externalCapCapabilityId ? { capabilityId: externalCapCapabilityId } : {}),
      });
      if (els.externalCapStatus) {
        els.externalCapStatus.textContent = decision === "accept" ? "已采用" : "未采用";
      }
      if (decision === "accept") {
        await setNav("work");
        await selectTask(externalCapTaskId);
      } else {
        hideExternalCandidate();
      }
      showStatus(els.externalCapError, "");
      await refreshTasks();
    } catch (err) {
      showStatus(els.externalCapError, "操作未能完成", true);
      void err;
    }
  }

  if (els.btnExternalAccept) {
    els.btnExternalAccept.addEventListener("click", () => decideExternalCandidate("accept"));
  }
  if (els.btnExternalReject) {
    els.btnExternalReject.addEventListener("click", () => decideExternalCandidate("reject"));
  }
  if (els.btnExternalRegenerate) {
    els.btnExternalRegenerate.addEventListener("click", async () => {
      if (externalCapTaskId) {
        try {
          const res = await api.invoke("work.retryTask", { taskId: externalCapTaskId });
          externalCapJobId = res.jobId;
          hideExternalCandidate();
          if (els.externalCapStatus) els.externalCapStatus.textContent = "准备中";
          startExternalCapWatch();
        } catch {
          if (els.btnExternalCapIssue) els.btnExternalCapIssue.click();
        }
      }
    });
  }

  // legacy collab open kept above; removed duplicate handler block marker
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
    els.btnCollabPreview.addEventListener("click", async () => {
      const mode = els.collabTargetMode ? String(els.collabTargetMode.value || "local-peer") : "local-peer";
      const peer = els.collabPeerDir ? String(els.collabPeerDir.value || "").trim() : "";
      const subtask = els.collabSubtask ? String(els.collabSubtask.value || "").trim() : "";
      const extra = els.collabExtra ? String(els.collabExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(els._workCollabMats || []);
      if (mode === "external-research") {
        if (!subtask) {
          showStatus(els.collabError, "请填写希望外部能力完成的具体内容", true);
          return;
        }
        try {
          const res = await api.invoke("capability.list", {
            previewAuthorization: {
              goal: subtask,
              allowedMaterialPaths: mats,
              ...(extra ? { extraNote: extra } : {}),
            },
          });
          const points =
            res.authorizationPreview && Array.isArray(res.authorizationPreview.confirmPoints)
              ? res.authorizationPreview.confirmPoints
              : null;
          if (!points) throw new Error("no preview");
          renderConfirmPoints(els.collabConfirmPoints, points);
          if (els.collabConfirm) els.collabConfirm.hidden = false;
          showStatus(els.collabError, "");
        } catch {
          showStatus(els.collabError, "无法生成授权说明，请稍后重试", true);
        }
        return;
      }
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
      const mode = els.collabTargetMode ? String(els.collabTargetMode.value || "local-peer") : "local-peer";
      const peer = els.collabPeerDir ? String(els.collabPeerDir.value || "").trim() : "";
      const subtask = els.collabSubtask ? String(els.collabSubtask.value || "").trim() : "";
      const extra = els.collabExtra ? String(els.collabExtra.value || "").trim() : "";
      const mats = selectedMaterialPaths(els._workCollabMats || []);
      if (mode === "external-research") {
        if (!subtask) {
          showStatus(els.collabError, "请填写希望外部能力完成的具体内容", true);
          return;
        }
        if (els.collabConfirm && els.collabConfirm.hidden) {
          try {
            const res = await api.invoke("capability.list", {
              previewAuthorization: {
                goal: subtask,
                allowedMaterialPaths: mats,
                ...(extra ? { extraNote: extra } : {}),
              },
            });
            const points =
              res.authorizationPreview && Array.isArray(res.authorizationPreview.confirmPoints)
                ? res.authorizationPreview.confirmPoints
                : null;
            if (!points) throw new Error("no preview");
            renderConfirmPoints(els.collabConfirmPoints, points);
            els.collabConfirm.hidden = false;
          } catch {
            showStatus(els.collabError, "无法生成授权说明，请稍后重试", true);
          }
          return;
        }
        try {
          const caps = await api.invoke("capability.list", { includeAvailability: true });
          const list = (caps && caps.capabilities) || [];
          const research = list.find(
            (c) =>
              c &&
              (c.id === "cap_a2a_research_analysis" ||
                String(c.displayName || "").includes("研究分析能力") ||
                String(c.displayName || "").includes("研究分析")),
          );
          if (!research) {
            showStatus(els.collabError, externalCapUnavailableMessage(), true);
            return;
          }
          const goal = extra ? `${subtask}\n补充说明：${extra}` : subtask;
          const result = await api.invoke("work.submitTask", {
            goal,
            contextRefs: mats.map((p) => ({ kind: "file", path: p })),
            requestedArtifactType: "document",
            capabilityId: research.id,
          });
          externalCapTaskId = result.taskId;
          externalCapJobId = result.jobId;
          activeTaskId = result.taskId;
          activeJobId = result.jobId;
          if (els.collabStatus) els.collabStatus.textContent = "准备中";
          showCollabActions(false);
          showStatus(els.collabError, "");
          await refreshTasks();
          startExternalCapWatch();
          startJobWatch(result.taskId);
        } catch (err) {
          const msg = err && err.message ? String(err.message) : "";
          if (/credential|尚未连接|secret/i.test(msg)) {
            showStatus(els.collabError, externalCapUnavailableMessage(), true);
          } else {
            showStatus(
              els.collabError,
              "研究分析能力目前无法使用，请稍后重试或改用本地能力。",
              true,
            );
          }
        }
        return;
      }
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
        if (els.collabStatus) els.collabStatus.textContent = "等待开始";
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
  if (els.btnWorkOpenCollabDetail) {
    els.btnWorkOpenCollabDetail.addEventListener("click", async () => {
      if (!activeGrantId) {
        await setNav("collab");
        return;
      }
      await setNav("collab");
      await openCollabDetail(activeGrantId);
    });
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
      collabDraftFromWork = null;
      collabWizardExternal = false;
      showCollabPage("new");
      clearPeerCard(pagePeerCardEls());
      if (els.collabPagePeerEmpty) els.collabPagePeerEmpty.hidden = true;
      showStatus(els.collabPageNewError, "");
      if (els.collabPageTargetMode) els.collabPageTargetMode.value = "local-peer";
      applyCollabDraftToWizard();
    });
  }
  if (els.btnCollabPageCancel) {
    els.btnCollabPageCancel.addEventListener("click", async () => {
      collabDraftFromWork = null;
      collabWizardExternal = false;
      showCollabPage("home");
      await refreshCollabHome();
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
        const issued = await issueCollaboration({
          peer,
          subtask,
          extra,
          materials: mats,
          issuerTaskId: collabDraftFromWork && collabDraftFromWork.issuerTaskId
            ? collabDraftFromWork.issuerTaskId
            : null,
        });
        collabDraftFromWork = null;
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
  if (els.btnCollabDetailRetry) {
    els.btnCollabDetailRetry.addEventListener("click", async () => {
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
    if (!opened) {
      setView("welcome");
      initWelcomeFlow();
    }
  })();
})();
