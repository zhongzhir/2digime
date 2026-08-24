(() => {
  const api = window.digitalMe;
  if (!api) {
    document.body.textContent = "应用桥接未就绪。请通过 npm run dev 启动。";
    return;
  }

  const USER_FACING_TASK_START_FAILED =
    "Digital Me 暂时无法开始这项任务，请重新打开应用后重试。";

  const HELP_TOPIC_TITLES = {
    chat: "对话",
    work: "做事",
    collab: "协作",
    subject: "数字之我",
    settings: "设置",
  };

  function applyHelpTopic(topic) {
    const resolved = HELP_TOPIC_TITLES[topic] ? topic : "chat";
    const titleEl = document.getElementById("help-topic-title");
    if (titleEl) titleEl.textContent = HELP_TOPIC_TITLES[resolved];
    for (const node of document.querySelectorAll(".help-topic")) {
      const show = node.getAttribute("data-help-topic") === resolved;
      node.hidden = !show;
      if (show) node.removeAttribute("hidden");
      else node.setAttribute("hidden", "");
    }
  }

  function userFacingChatError(err) {
    const raw = String((err && err.message) || err || "");
    if (/请先连接模型|MODEL_NOT_CONFIGURED/i.test(raw)) {
      return "请先连接模型后再试。";
    }
    if (/本次未能读取数字之我信息/.test(raw)) {
      return "本次未能读取数字之我信息，请重试。";
    }
    if (/回复未完成|CHAT_INCOMPLETE|timeout|网络|中断/i.test(raw)) {
      return "回复未完成，可重试";
    }
    if (
      /Error invoking remote method|shell:|IPC|invoke|JSON|stack|ECONNREFUSED|ENOTFOUND/i.test(
        raw,
      ) ||
      /[{[]/.test(raw)
    ) {
      return "暂时无法回复，请稍后重试。";
    }
    const first = raw.split("\n")[0].trim();
    if (!first) return "暂时无法回复，请稍后重试。";
    if (first.length > 80) return "暂时无法回复，请稍后重试。";
    return first;
  }

  function userFacingWorkError(err) {
    const msg = String((err && err.message) || err || "");
    if (
      /work runtime not attached|artifact workspace not attached|no active subject|open or create a package|runtime not ready|Error invoking remote method|command:invoke|PACKAGE_ATTACH_FAILED/i.test(
        msg,
      )
    ) {
      return USER_FACING_TASK_START_FAILED;
    }
    if (/trusted directory|skip-git-repo-check|not inside a trusted/i.test(msg)) {
      return "尚未明确授权项目文件夹。请通过文件夹选择器添加项目位置后再开始。";
    }
    return msg || USER_FACING_TASK_START_FAILED;
  }

  function resolveMaterialsProjectOrigin() {
    const folder = materials.find((m) => m && m.kind === "folder" && m.path);
    if (!folder) return null;
    if (folder.projectOrigin === "digitalme_created") return "digitalme_created";
    if (folder.projectOrigin === "user_selected") return "user_selected";
    if (folder.projectOrigin === "unknown") return "unknown";
    // 选择器添加的文件夹缺字段时按用户明确选择处理，不得落成 unknown
    return "user_selected";
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
    remoteRelayUrl: document.getElementById("remote-relay-url"),
    remoteDmConnectionState: document.getElementById("remote-dm-connection-state"),
    btnRemoteRelayConnect: document.getElementById("btn-remote-relay-connect"),
    btnRemoteCreateInvite: document.getElementById("btn-remote-create-invite"),
    remoteInviteInput: document.getElementById("remote-invite-input"),
    remoteInviteOutput: document.getElementById("remote-invite-output"),
    btnRemoteAcceptInvite: document.getElementById("btn-remote-accept-invite"),
    remotePeerList: document.getElementById("remote-peer-list"),
    remoteDmStatus: document.getElementById("remote-dm-status"),
    collabSignalPeer: document.getElementById("collab-signal-peer"),
    collabSignalIntent: document.getElementById("collab-signal-intent"),
    btnCollabSendSignal: document.getElementById("btn-collab-send-signal"),
    collabSignalStatus: document.getElementById("collab-signal-status"),
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
    collabListOpportunities: document.getElementById("collab-list-opportunities"),
    collabEmptyActive: document.getElementById("collab-empty-active"),
    collabEmptyDone: document.getElementById("collab-empty-done"),
    collabEmptyRevoked: document.getElementById("collab-empty-revoked"),
    collabEmptyOpportunities: document.getElementById("collab-empty-opportunities"),
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
    btnCollabDetailRespondAccept: document.getElementById("btn-collab-detail-respond-accept"),
    btnCollabDetailRespondReject: document.getElementById("btn-collab-detail-respond-reject"),
    btnCollabDetailAccept: document.getElementById("btn-collab-detail-accept"),
    btnCollabDetailRevise: document.getElementById("btn-collab-detail-revise"),
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
    chatClearConfirm: document.getElementById("chat-clear-confirm"),
    chatClearConfirmBtn: document.getElementById("btn-chat-clear-confirm"),
    chatClearCancel: document.getElementById("btn-chat-clear-cancel"),
    chatToTask: document.getElementById("btn-chat-to-task"),
    chatStatus: document.getElementById("chat-status"),
    subjectBrief: document.getElementById("subject-brief"),
    subjectMore: document.getElementById("subject-more"),
    subjectCapture: document.getElementById("btn-subject-capture"),
    importSubjectMaterial: document.getElementById("btn-import-subject-material"),
    subjectActionStatus: document.getElementById("subject-action-status"),
    subjectActiveList: document.getElementById("subject-active-list"),
    subjectActiveEmpty: document.getElementById("subject-active-empty"),
    subjectLearnedList: document.getElementById("subject-learned-list"),
    subjectLearnedEmpty: document.getElementById("subject-learned-empty"),
    subjectRecentList: document.getElementById("subject-recent-list"),
    subjectRecentEmpty: document.getElementById("subject-recent-empty"),
    subjectMaterialList: document.getElementById("subject-material-list"),
    subjectMaterialEmpty: document.getElementById("subject-material-empty"),
    btnGrowthUnderstanding: document.getElementById("btn-growth-understanding"),
    growthUnderstanding: document.getElementById("growth-understanding"),
    growthUnderstandingList: document.getElementById("growth-understanding-list"),
    growthUnderstandingEmpty: document.getElementById("growth-understanding-empty"),
    growthUnderstandingStatus: document.getElementById("growth-understanding-status"),
    btnGrowthBackUnderstanding: document.getElementById("btn-growth-back-understanding"),
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
    goalSend: document.getElementById("btn-goal-send"),
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
    restoreBaseline: document.getElementById("btn-restore-baseline"),
    openProjectFolder: document.getElementById("btn-open-project-folder"),
    restartCompose: document.getElementById("btn-restart-compose"),
    workMoreMenu: document.getElementById("work-more-menu"),
    workMoreActions: document.getElementById("work-more-actions"),
    workAssistEntries: document.getElementById("work-assist-entries"),
    artifactExportsMore: document.getElementById("artifact-exports-more"),
    taskWorkspaceTitle: document.getElementById("task-workspace-title"),
    taskWorkspacePlan: document.getElementById("task-workspace-plan"),
    taskWorkspacePrep: document.getElementById("task-workspace-prep"),
    startDevelopment: document.getElementById("btn-start-development"),
    twCreateProject: document.getElementById("btn-tw-create-project"),
    twPickProject: document.getElementById("btn-tw-pick-project"),
    twConnectCoding: document.getElementById("btn-tw-connect-coding"),
    twOpenSettings: document.getElementById("btn-tw-open-settings"),
    twPrepContinue: document.getElementById("btn-tw-prep-continue"),
    twHighRiskConfirm: document.getElementById("btn-tw-high-risk-confirm"),
    twHighRiskCancel: document.getElementById("btn-tw-high-risk-cancel"),
    ccRestoreRow: document.getElementById("cc-restore-row"),
    ccRestoreHint: document.getElementById("cc-restore-hint"),
    decisionHint: document.getElementById("artifact-decision-hint"),
    artifactEmpty: document.getElementById("artifact-empty"),
    artifactLoading: document.getElementById("artifact-loading"),
    revisionActiveBanner: document.getElementById("revision-active-banner"),
    revisionActiveTitle: document.getElementById("revision-active-title"),
    revisionActiveText: document.getElementById("revision-active-text"),
    adoptWarningCard: document.getElementById("adopt-warning-card"),
    adoptWarningList: document.getElementById("adopt-warning-list"),
    adoptContinueRevise: document.getElementById("btn-adopt-continue-revise"),
    adoptAnyway: document.getElementById("btn-adopt-anyway"),
    nextStepsCard: document.getElementById("next-steps-card"),
    nextStepsTitle: document.getElementById("next-steps-title"),
    nextStepsLead: document.getElementById("next-steps-lead"),
    nextStepsActions: document.getElementById("next-steps-actions"),
    nextStepsStatus: document.getElementById("next-steps-status"),
    ccRevisionSection: document.getElementById("cc-revision-section"),
    ccRevisionRequest: document.getElementById("cc-revision-request"),
    ccAcceptanceSection: document.getElementById("cc-acceptance-section"),
    ccAcceptanceTitle: document.getElementById("cc-acceptance-title"),
    ccAcceptanceExec: document.getElementById("cc-acceptance-exec"),
    ccAcceptanceGoal: document.getElementById("cc-acceptance-goal"),
    ccCtoReport: document.getElementById("cc-cto-report"),
    ccAcceptanceBullets: document.getElementById("cc-acceptance-bullets"),
    ccAcceptanceNext: document.getElementById("cc-acceptance-next"),
    ccAcceptanceReco: document.getElementById("cc-acceptance-reco"),
    ccTechEvidence: document.getElementById("cc-tech-evidence"),
    ccTechBullets: document.getElementById("cc-tech-bullets"),
    workTimeline: document.getElementById("work-timeline"),
    workNlInput: document.getElementById("work-nl-input"),
    workNlSend: document.getElementById("btn-work-nl-send"),
    workNlComposer: document.getElementById("work-nl-composer"),
    workComposeSetup: document.getElementById("work-compose-setup"),
    workConversationScroll: document.getElementById("work-conversation-scroll"),
    artifactEmptyHint: document.getElementById("artifact-empty-hint"),
    panelWork: document.getElementById("panel-work"),
    settingsCodingCapabilities: document.getElementById("settings-coding-capabilities"),
    settingsCodingAdvancedName: document.getElementById("settings-coding-advanced-name"),
    goalExamples: document.getElementById("goal-examples"),
    codeChangeView: document.getElementById("code-change-view"),
    ccSummary: document.getElementById("cc-summary"),
    ccVerification: document.getElementById("cc-verification"),
    ccFileList: document.getElementById("cc-file-list"),
    ccFilesMore: document.getElementById("btn-cc-files-more"),
    ccDiff: document.getElementById("cc-diff"),
    ccDiffPanel: document.getElementById("cc-diff-panel"),
    ccTestList: document.getElementById("cc-test-list"),
    ccTestsSection: document.getElementById("cc-tests-section"),
    ccUnresolvedSection: document.getElementById("cc-unresolved-section"),
    ccUnresolvedList: document.getElementById("cc-unresolved-list"),
    ccUnderstandingSection: document.getElementById("cc-understanding-section"),
    ccUnderstandingGoal: document.getElementById("cc-understanding-goal"),
    ccUnderstandingFiles: document.getElementById("cc-understanding-files"),
    ccPlanSection: document.getElementById("cc-plan-section"),
    ccPlanList: document.getElementById("cc-plan-list"),
    ccRisksSection: document.getElementById("cc-risks-section"),
    ccRisksList: document.getElementById("cc-risks-list"),
    jobStatus: document.getElementById("job-status"),
    jobActionable: document.getElementById("job-actionable"),
    settingsExecutorStatus: document.getElementById("settings-executor-status"),
    settingsExecutorDesc: document.getElementById("settings-executor-desc"),
    settingsExecutorScope: document.getElementById("settings-executor-scope"),
    checkExecutor: document.getElementById("btn-check-executor"),
    executorSettingsStatus: document.getElementById("executor-settings-status"),
    ownerChoicePrompt: document.getElementById("owner-choice-prompt"),
    ownerChoiceQuestion: document.getElementById("owner-choice-question"),
    ownerChoiceActions: document.getElementById("owner-choice-actions"),
    artifactPanel: document.getElementById("artifact-panel"),
    artifactEditor: document.getElementById("artifact-editor"),
    reviseBox: document.getElementById("revision-composer"),
    revisionComposer: document.getElementById("revision-composer"),
    revisionComposerTitle: document.getElementById("revision-composer-title"),
    proposeRevision: document.getElementById("btn-propose-revision"),
    cancelRevision: document.getElementById("btn-cancel-revision"),
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
    revisionShots: document.getElementById("revision-shots"),
    addRevisionShot: document.getElementById("btn-add-revision-shot"),
    revisionShotFile: document.getElementById("revision-shot-file"),
    revisionShotHint: document.getElementById("revision-shot-hint"),
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

  /** @type {{ kind: 'file'|'folder', path: string, softwareProject?: { isSoftwareProject: boolean, projectName: string, userFacingHint: string } }[]} */
  let materials = [];
  /** @type {null | { goal: string, contextRefs: {kind:string,path:string}[], preview: any }} */
  let pendingExecutionConfirm = null;
  let pendingCodingOnboarding = null;
  let lastCodingCapabilities = [];
  let lastCodingRecommendation = null;
  /** @type {string | null} */
  let activeCodeChangeWorkingDirectory = null;
  let activeCodeChangeRunInfo = null;
  let activeAcceptanceSummary = null;
  let activeAcceptanceFailed = false;
  let activeAcceptanceFailureMessage = "";
  /** CTO 闭环：用户暂停当前任务（不新增任务状态机，仅 UI 事实） */
  let taskPausedCto = false;
  /** 本会话追加的对话轮次（派生时间线之外的用户补充） */
  let workExtraTurns = [];
  /** Task.meta.conversation 的持久化对话轮（唯一权威记录的投影；重启可恢复） */
  let persistedConversationTurns = [];
  /** 对话中枢先建的理解任务（尚无 Job）；确定性开始时经 existingTaskId 复用同一 Task */
  let converseDraftTaskId = null;
  /** D11-B：当前任务权威规划（来自 Task.meta.plan）。 */
  let activeTaskPlan = null;
  /** 2DIGIME-AI-NATIVE-THIN-RUNTIME-26：当前任务是否走薄主链。 */
  let activeRuntimePath = null;
  /** 薄主链失败说明已触发的 Job，避免重复对话。 */
  let thinFailureExplainedJobId = null;
  /** D11-B：准备受阻 / 高风险确认态（派生投影，不落盘）。 */
  let prepBlockedState = null;
  let lastCtoTimelineKey = "";
  let activeArtifactVersionLabel = "";
  let pendingCreateProject = null;
  /** @type {{ id: string, dataUrl: string, path?: string }[]} */
  let revisionShotItems = [];
  let revisionShotSeq = 0;
  let ccFilesExpanded = false;
  /** @type {'compose'|'task'} */
  let workMode = "compose";
  let lastDecisionStatus = null;
  let lastJobDetailForUx = null;
  let lastModelReady = true;
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
  let uiEpoch = 0;
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
  let lastGrowthSnapshot = null;
  let growthSubjectView = "home";
  let growthHomeScroll = 0;
  let growthFlowGoal = "";
  let returnView = "welcome";
  /** @type {'chat'|'subject'|'work'|'collab'|'settings'} */
  let activeNav = "chat";
  /** @type {'chat'|'subject'|'work'|'collab'} */
  let returnNav = "chat";
  let lastChatUserText = "";
  /** 最近一次对话回复是否失败（用于重试） */
  let lastChatReplyFailed = false;
  /** 清空对话时递增；用于丢弃迟到的 reply / 换题结果。仅运行态，不落盘。 */
  let chatGeneration = 0;
  /** 对话模式：normal | growth_guided。仅 renderer 内存运行态，不落盘、不新增状态库。 */
  let chatGuideMode = "normal";
  /** 只读运行态暴露，供验收断言；不新增命令、不落盘。 */
  window.__dmGetChatGuideMode = () => chatGuideMode;
  let shellStatus = null;
  let shellBootInfo = null;
  let displayModelName = null;
  let connectionRefreshSeq = 0;
  /** @type {'document'|'bundle'} */
  let activeArtifactKind = "document";
  /** @type {'code-change'|'bundle'|'document'|null} */
  let activeArtifactProjectionKind = null;
  let lastArtifactProjectionDiagnostic = null;
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
    if (nav !== "chat") setChatGuideMode("normal");
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
    if (nav === "subject") {
      showGrowthSubjectView("home", { resetScroll: true });
      await refreshSubjectPanel();
    }
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
          : "chat";
    }
    activeNav = "settings";
    for (const btn of [els.navWork, els.navChat, els.navSubject, els.navCollab]) {
      if (!btn) continue;
      btn.classList.remove("active");
    }
    fillSettingsForm();
    setView("settings");
    void refreshExecutorCapabilityUi(false);
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

  async function refreshExecutorCapabilityUi(includeAvailability) {
    if (!els.settingsExecutorStatus && !els.settingsCodingCapabilities) return;
    try {
      const listed = await api.invoke("capability.list", {
        includeAvailability: !!includeAvailability,
      });
      lastCodingCapabilities = (listed && listed.codingCapabilities) || [];
      lastCodingRecommendation = (listed && listed.codingRecommendation) || null;
      renderSettingsCodingCapabilities(lastCodingCapabilities, listed && listed.preferredCodingCapabilityId);
      const card = listed && listed.executorCapabilityCard;
      if (!card) {
        if (els.settingsExecutorStatus) els.settingsExecutorStatus.textContent = "状态：未配置";
        if (els.settingsExecutorDesc) els.settingsExecutorDesc.textContent = "";
        if (els.settingsExecutorScope) els.settingsExecutorScope.textContent = "";
        return listed;
      }
      if (els.settingsExecutorStatus) {
        els.settingsExecutorStatus.textContent = `状态：${card.availabilityLabel || (card.available ? "已连接" : "未连接")}`;
      }
      if (els.settingsExecutorDesc) {
        els.settingsExecutorDesc.textContent = `${card.displayName} — ${card.canDo || card.shortDescription || ""}`;
      }
      if (els.settingsExecutorScope) {
        const mode = card.executionModeLabel ? ` · ${card.executionModeLabel}` : "";
        els.settingsExecutorScope.textContent = `${card.allowedScope || ""}${mode}`;
      }
      if (els.settingsCodingAdvancedName) {
        els.settingsCodingAdvancedName.textContent = card.available
          ? `当前默认：${card.displayName}`
          : "";
      }
      return listed;
    } catch (err) {
      if (els.settingsExecutorStatus) els.settingsExecutorStatus.textContent = "状态：检查失败";
      if (els.executorSettingsStatus) {
        els.executorSettingsStatus.textContent = err.message || String(err);
      }
      return null;
    }
  }

  function renderSettingsCodingCapabilities(caps, preferredId) {
    if (!els.settingsCodingCapabilities) return;
    els.settingsCodingCapabilities.innerHTML = "";
    const list = Array.isArray(caps) ? caps : [];
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "muted tiny";
      p.textContent = "尚未检测到可用的代码执行能力。";
      els.settingsCodingCapabilities.appendChild(p);
      return;
    }
    for (const cap of list) {
      const item = document.createElement("div");
      item.className = "coding-cap-item";
      const title = document.createElement("div");
      title.className = "coding-cap-title";
      title.textContent = `${cap.displayName} · ${cap.connectionStatus || ""}`;
      const desc = document.createElement("div");
      desc.className = "muted tiny";
      desc.textContent = `${cap.canDo || ""} · ${cap.executionModeLabel || ""}`;
      const actions = document.createElement("div");
      actions.className = "row";
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "ghost";
      checkBtn.textContent = "检查连接";
      checkBtn.addEventListener("click", async () => {
        await refreshExecutorCapabilityUi(true);
      });
      actions.appendChild(checkBtn);
      if (cap.availability === "ready" && cap.supportsAutomaticExecution) {
        const defBtn = document.createElement("button");
        defBtn.type = "button";
        defBtn.className = "ghost";
        defBtn.textContent =
          preferredId === cap.capabilityId ? "当前默认" : "设置为默认";
        defBtn.disabled = preferredId === cap.capabilityId;
        defBtn.addEventListener("click", async () => {
          await api.invoke("capability.list", {
            codingAction: { type: "set_default", capabilityId: cap.capabilityId },
            includeAvailability: true,
          });
          await refreshExecutorCapabilityUi(true);
        });
        actions.appendChild(defBtn);
      }
      item.appendChild(title);
      item.appendChild(desc);
      item.appendChild(actions);
      els.settingsCodingCapabilities.appendChild(item);
    }
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

  function openHelp(sectionId) {
    returnView = currentView === "help" ? returnView : currentView;
    const fromMenu = sectionId === "help-growth";
    const topic = fromMenu
      ? "subject"
      : activeNav === "settings" ||
          activeNav === "chat" ||
          activeNav === "work" ||
          activeNav === "collab" ||
          activeNav === "subject"
        ? activeNav
        : "chat";
    applyHelpTopic(topic);
    setView("help");
    if (sectionId) {
      const node = document.getElementById(sectionId);
      if (node && typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ block: "start" });
      }
    }
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
    const softwareCount = materials.filter((m) => m.softwareProject && m.softwareProject.isSoftwareProject).length;
    if (els.materialListSummary) {
      if (count === 0) els.materialListSummary.textContent = "尚未添加材料";
      else if (softwareCount > 0)
        els.materialListSummary.textContent = `已添加 ${count} 项（含 ${softwareCount} 个软件项目）`;
      else els.materialListSummary.textContent = `已添加 ${count} 项`;
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
      const isNewProj = !!(item.softwareProject && item.softwareProject.isNewProjectCandidate);
      const isSoft = !!(item.softwareProject && item.softwareProject.isSoftwareProject);
      const kind = isNewProj
        ? "准备创建的软件项目"
        : isSoft
          ? "已添加软件项目"
          : item.kind === "folder"
            ? "文件夹"
            : "文件";
      const name = document.createElement("div");
      name.className = "material-name" + (isSoft ? " is-software-project" : "");
      const displayName =
        (item.softwareProject && item.softwareProject.projectName) || basenamePath(item.path);
      name.textContent = `${kind} · ${displayName}`;
      const pathEl = document.createElement("div");
      pathEl.className = "material-path";
      pathEl.textContent = item.path;
      meta.appendChild(name);
      meta.appendChild(pathEl);
      if (isSoft && item.softwareProject.userFacingHint) {
        const hint = document.createElement("div");
        hint.className = "material-hint";
        hint.textContent = item.softwareProject.userFacingHint;
        meta.appendChild(hint);
      }
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

  function mapProgressNoteForUi(note) {
    const raw = String(note || "").trim();
    if (!raw) return "";
    if (/queued|running|artifact|collector|verifier|executorRunId|adapter/i.test(raw)) {
      return "正在处理";
    }
    return raw;
  }

  /** D11-E：中栏三确认卡已移除；开发前准备只走右栏 prepBlocked。 */

  async function scanInstalledCodingCapabilities() {
    const listed = await api.invoke("capability.list", { includeAvailability: true });
    lastCodingCapabilities = (listed && listed.codingCapabilities) || [];
    lastCodingRecommendation = (listed && listed.codingRecommendation) || lastCodingRecommendation;
    await refreshExecutorCapabilityUi(false);
    const ready = lastCodingCapabilities.find(
      (c) => c.availability === "ready" && c.supportsAutomaticExecution,
    );
    if (ready) {
      els.jobStatus.textContent = "已找到可用的代码执行能力";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "可点击右侧「继续准备」继续。";
    } else {
      els.jobStatus.textContent = "尚未找到可自动使用的代码执行能力";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "请在设置中安装或连接后再继续。";
    }
    return listed;
  }

  async function connectCodingCapabilityFromPrep() {
    try {
      const listed = await scanInstalledCodingCapabilities();
      const ready = lastCodingCapabilities.find(
        (c) => c.availability === "ready" && c.supportsAutomaticExecution,
      );
      if (ready) {
        clearPrepBlocked();
        await resumePendingSoftwareTask(
          (listed && listed.preferredCodingCapabilityId) || ready.capabilityId,
        );
        return;
      }
      const card = listed && listed.executorCapabilityCard;
      if (card && card.available) {
        clearPrepBlocked();
        await resumePendingSoftwareTask(
          (listed && listed.preferredCodingCapabilityId) || card.capabilityId,
        );
        return;
      }
      openSettings();
      showPrepBlocked(
        "executor",
        pendingCodingOnboarding || {
          message: (card && card.detail) || "尚未检测到可用的代码执行能力。",
        },
      );
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
    }
  }

  async function resumePendingSoftwareTask(capabilityId) {
    const goal = (els.goal && els.goal.value ? els.goal.value : "").trim();
    if (!goal) {
      els.jobStatus.textContent = "请先填写任务目标";
      els.jobStatus.classList.add("error");
      return;
    }
    // SINGLE-RUNTIME-PATH-20：能力就绪后仍须已有可确认模型规划，不得无规划直提
    if (
      !activeTaskPlan ||
      activeTaskPlan.source === "seed_internal" ||
      activeTaskPlan.version == null ||
      !(activeTaskId || converseDraftTaskId)
    ) {
      els.jobStatus.textContent = "代码执行能力已就绪。请先在对话中确认开发规划后再开始。";
      els.jobStatus.classList.remove("error");
      clearPrepBlocked();
      refreshWorkUxView({});
      focusWorkNaturalLanguageInput();
      return;
    }
    const payload = {
      goal,
      contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path, ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}) })),
    };
    if (capabilityId) payload.capabilityId = capabilityId;
    if (converseDraftTaskId) payload.existingTaskId = converseDraftTaskId;
    if (activeTaskId) payload.existingTaskId = activeTaskId;
    payload.confirmedPlanVersion = activeTaskPlan.version;
    workMode = "compose";
    const result = await api.invoke("work.submitTask", payload);
    await applySubmitTaskResult(result, payload, goal, { fromPlanConfirm: true });
  }

  async function restorePendingSoftwareDraftIfAny() {
    try {
      const listed = await api.invoke("capability.list", {
        codingAction: { type: "get_pending" },
      });
      const pending = listed && listed.pendingSoftwareTask;
      if (!pending || !pending.goal) return false;
      workMode = "compose";
      activeTaskId = null;
      els.goal.value = pending.goal;
      els.goal.readOnly = false;
      materials = (pending.contextRefs || []).map((r) => ({
        kind: r.kind,
        path: r.path,
      }));
      renderMaterials();
      if (els.workComposeTitle) els.workComposeTitle.textContent = "待继续的任务";
      showPrepBlocked("executor", {
        title: "完成这项任务需要代码执行能力",
        description:
          "Digital Me 会使用它在你确认的项目目录中创建或修改代码，并运行测试。",
        message: pending.userFacingNotice || "连接代码执行能力后可继续",
      });
      els.jobStatus.textContent = "连接代码执行能力后可继续";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "目标和项目材料已保留。";
      return true;
    } catch {
      return false;
    }
  }

  function renderCodeChangeView(codeChange) {
    if (!els.codeChangeView || !codeChange) return;
    hideArtifactLoading();
    setCodeChangeViewVisible(true);
    activeCodeChangeWorkingDirectory = codeChange.workingDirectory || null;
    activeCodeChangeRunInfo = codeChange.runInfo || null;
    activeAcceptanceSummary = codeChange.acceptanceSummary || activeAcceptanceSummary;
    const revisionText = String(codeChange.revisionRequest || "").trim();
    if (els.ccRevisionSection) {
      if (revisionText) {
        els.ccRevisionSection.hidden = false;
        els.ccRevisionSection.removeAttribute("hidden");
        if (els.ccRevisionRequest) els.ccRevisionRequest.textContent = revisionText;
      } else {
        els.ccRevisionSection.hidden = true;
        els.ccRevisionSection.setAttribute("hidden", "");
      }
    }
    const acc = codeChange.acceptanceSummary;
    if (els.ccAcceptanceSection) {
      els.ccAcceptanceSection.hidden = true;
      els.ccAcceptanceSection.setAttribute("hidden", "");
    }
    if (acc) {
      const ctoKey = String(activeHeadVersionId || "") + "::" + String(acc.ctoReport || "").slice(0, 80);
      if (acc.ctoReport && ctoKey !== lastCtoTimelineKey) {
        lastCtoTimelineKey = ctoKey;
      }
      renderWorkTimeline();
      if (els.artifactEmptyHint) {
        els.artifactEmptyHint.hidden = true;
        els.artifactEmptyHint.setAttribute("hidden", "");
      }
    }
    if (els.ccSummary) {
      const happenedSection = els.ccSummary.closest ? els.ccSummary.closest(".cc-section") : null;
      const summaryText = String(codeChange.summary || "").trim();
      const happened = summaryText.match(/##\s*发生了什么\s*([\s\S]*?)(?=\n##\s|$)/);
      let brief = happened ? happened[1].trim() : "";
      if (!brief) {
        brief =
          summaryText
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .find((p) => p && !p.startsWith("#") && !p.startsWith("**验收") && !/^##\s*目标/.test(p)) ||
          summaryText.slice(0, 800);
      }
      els.ccSummary.hidden = false;
      els.ccSummary.removeAttribute("hidden");
      els.ccSummary.textContent = brief || "已完成本次处理。可在下方查看文件，或打开项目文件夹。";
      if (happenedSection) {
        happenedSection.hidden = false;
        happenedSection.removeAttribute("hidden");
      }
    }
    if (els.ccVerification) {
      els.ccVerification.textContent = codeChange.verificationLabel || "";
    }
    const changes =
      Array.isArray(codeChange.changes) && codeChange.changes.length
        ? codeChange.changes
        : (codeChange.changedFiles || []).map((p) => ({ path: p, status: "modified" }));
    if (els.ccFileList) {
      els.ccFileList.innerHTML = "";
      const limit = ccFilesExpanded ? changes.length : 8;
      const shown = changes.slice(0, limit);
      const statusLabel = { added: "新增", modified: "修改", deleted: "删除", unknown: "变更" };
      for (const ch of shown) {
        const li = document.createElement("li");
        const st = document.createElement("span");
        st.className = "cc-file-status";
        st.textContent = statusLabel[ch.status] || "变更";
        li.appendChild(st);
        li.appendChild(document.createTextNode(ch.path));
        els.ccFileList.appendChild(li);
      }
      if (els.ccFilesMore) {
        const needMore = changes.length > 8;
        els.ccFilesMore.hidden = !needMore;
        if (needMore) {
          els.ccFilesMore.removeAttribute("hidden");
          els.ccFilesMore.textContent = ccFilesExpanded
            ? "收起文件列表"
            : `显示全部 ${changes.length} 个文件`;
        } else els.ccFilesMore.setAttribute("hidden", "");
      }
    }
    if (els.ccDiff) {
      const diff = String(codeChange.unifiedDiff || "").trim();
      els.ccDiff.textContent = diff ? diff.slice(0, 120000) : "（无 diff）";
      if (els.ccDiffPanel) {
        els.ccDiffPanel.hidden = false;
        els.ccDiffPanel.removeAttribute("hidden");
        els.ccDiffPanel.open = !!diff && diff.length < 4000;
      }
    }
    if (els.ccTestList) {
      els.ccTestList.innerHTML = "";
      const tests = codeChange.testResults || [];
      if (els.ccTestsSection) {
        els.ccTestsSection.hidden = tests.length === 0;
        if (tests.length === 0) els.ccTestsSection.setAttribute("hidden", "");
        else els.ccTestsSection.removeAttribute("hidden");
      }
      for (const t of tests) {
        const li = document.createElement("li");
        const head = document.createElement("div");
        head.textContent = `${t.passed ? "通过" : "失败"} · ${t.command || "测试"}`;
        li.appendChild(head);
        if (t.summary) {
          const s = document.createElement("div");
          s.className = "muted tiny";
          s.textContent = t.summary;
          li.appendChild(s);
        }
        if (t.logExcerpt) {
          const details = document.createElement("details");
          const sum = document.createElement("summary");
          sum.textContent = "完整日志";
          const pre = document.createElement("pre");
          pre.className = "cc-test-log";
          pre.textContent = t.logExcerpt;
          details.appendChild(sum);
          details.appendChild(pre);
          li.appendChild(details);
        }
        els.ccTestList.appendChild(li);
      }
    }
    if (els.ccUnderstandingSection) {
      els.ccUnderstandingSection.hidden = true;
      els.ccUnderstandingSection.setAttribute("hidden", "");
    }
    if (els.ccPlanSection) {
      els.ccPlanSection.hidden = true;
      els.ccPlanSection.setAttribute("hidden", "");
    }
    if (els.ccRisksSection) {
      els.ccRisksSection.hidden = true;
      els.ccRisksSection.setAttribute("hidden", "");
    }
    const unresolved = (codeChange.unresolvedItems || []).filter(Boolean);
    if (els.ccUnresolvedSection && els.ccUnresolvedList) {
      if (unresolved.length) {
        els.ccUnresolvedSection.hidden = false;
        els.ccUnresolvedSection.removeAttribute("hidden");
        els.ccUnresolvedList.innerHTML = "";
        for (const item of unresolved.slice(0, 20)) {
          const li = document.createElement("li");
          li.textContent = item;
          els.ccUnresolvedList.appendChild(li);
        }
      } else {
        els.ccUnresolvedSection.hidden = true;
        els.ccUnresolvedSection.setAttribute("hidden", "");
      }
    }
  }

  function hideCodeChangeView() {
    activeCodeChangeWorkingDirectory = null;
    activeCodeChangeRunInfo = null;
    ccFilesExpanded = false;
    setCodeChangeViewVisible(false);
    if (els.ccRevisionSection) {
      els.ccRevisionSection.hidden = true;
      els.ccRevisionSection.setAttribute("hidden", "");
    }
    if (els.ccAcceptanceSection) {
      els.ccAcceptanceSection.hidden = true;
      els.ccAcceptanceSection.setAttribute("hidden", "");
    }
    if (els.ccAcceptanceTitle) els.ccAcceptanceTitle.textContent = "";
    if (els.ccAcceptanceExec) els.ccAcceptanceExec.textContent = "";
    if (els.ccAcceptanceGoal) {
      els.ccAcceptanceGoal.textContent = "";
      els.ccAcceptanceGoal.className = "cc-acceptance-goal";
    }
    if (els.ccAcceptanceBullets) els.ccAcceptanceBullets.innerHTML = "";
    if (els.ccAcceptanceReco) {
      els.ccAcceptanceReco.textContent = "";
      els.ccAcceptanceReco.className = "cc-acceptance-reco";
    }
    if (els.ccTechEvidence) {
      els.ccTechEvidence.hidden = true;
      els.ccTechEvidence.setAttribute("hidden", "");
    }
    if (els.ccTechBullets) els.ccTechBullets.innerHTML = "";
    if (els.ccSummary) els.ccSummary.textContent = "";
    if (els.ccVerification) els.ccVerification.textContent = "";
    if (els.ccFileList) els.ccFileList.innerHTML = "";
    if (els.ccDiff) els.ccDiff.textContent = "";
    if (els.ccDiffPanel) {
      els.ccDiffPanel.hidden = true;
      els.ccDiffPanel.setAttribute("hidden", "");
      els.ccDiffPanel.open = false;
    }
    if (els.ccTestList) els.ccTestList.innerHTML = "";
    if (els.ccUnresolvedList) els.ccUnresolvedList.innerHTML = "";
    if (els.ccTestsSection) {
      els.ccTestsSection.hidden = true;
      els.ccTestsSection.setAttribute("hidden", "");
    }
    if (els.ccUnresolvedSection) {
      els.ccUnresolvedSection.hidden = true;
      els.ccUnresolvedSection.setAttribute("hidden", "");
    }
    if (els.ccUnderstandingSection) {
      els.ccUnderstandingSection.hidden = true;
      els.ccUnderstandingSection.setAttribute("hidden", "");
    }
    if (els.ccUnderstandingGoal) els.ccUnderstandingGoal.textContent = "";
    if (els.ccUnderstandingFiles) els.ccUnderstandingFiles.innerHTML = "";
    if (els.ccPlanSection) {
      els.ccPlanSection.hidden = true;
      els.ccPlanSection.setAttribute("hidden", "");
    }
    if (els.ccPlanList) els.ccPlanList.innerHTML = "";
    if (els.ccRisksSection) {
      els.ccRisksSection.hidden = true;
      els.ccRisksSection.setAttribute("hidden", "");
    }
    if (els.ccRisksList) els.ccRisksList.innerHTML = "";
    if (els.ccFilesMore) {
      els.ccFilesMore.hidden = true;
      els.ccFilesMore.setAttribute("hidden", "");
    }
    if (els.openProjectFolder) {
      els.openProjectFolder.hidden = true;
      els.openProjectFolder.setAttribute("hidden", "");
    }
    if (els.restoreBaseline) {
      els.restoreBaseline.hidden = true;
      els.restoreBaseline.setAttribute("hidden", "");
    }
    if (els.ccRestoreRow) {
      els.ccRestoreRow.hidden = true;
      els.ccRestoreRow.setAttribute("hidden", "");
    }
    if (els.ccRestoreHint) {
      els.ccRestoreHint.hidden = true;
      els.ccRestoreHint.setAttribute("hidden", "");
    }
    hideNextStepsCard();
  }

  /**
   * 成果投影：委托纯函数模块（work-artifact-projection.js）。
   * code-change UI 仅当软件执行 Task + 正式 code-change Artifact。
   */
  function projectionApi() {
    return window.DigitalMeArtifactProjection || null;
  }

  function isSoftwareExecutionTask(taskIntent) {
    const api = projectionApi();
    if (api && typeof api.isSoftwareExecutionTask === "function") {
      return api.isSoftwareExecutionTask(taskIntent);
    }
    return String(taskIntent || "") === "modify_code";
  }

  function isFormalCodeChangeArtifactType(artifactType, artifactKind) {
    const api = projectionApi();
    if (api && typeof api.isFormalCodeChangeArtifactType === "function") {
      return api.isFormalCodeChangeArtifactType(artifactType, artifactKind);
    }
    const t = String(artifactType || "");
    const k = String(artifactKind || "");
    return t === "code-change" || t === "code_change" || k === "code-change";
  }

  function resolveArtifactProjection(dispatch) {
    const api = projectionApi();
    if (api && typeof api.resolveArtifactProjection === "function") {
      return api.resolveArtifactProjection(dispatch);
    }
    const intent = dispatch && dispatch.taskIntent ? String(dispatch.taskIntent) : "";
    const artifactType = dispatch && dispatch.artifactType ? String(dispatch.artifactType) : "";
    const artifactKind = dispatch && dispatch.artifactKind ? String(dispatch.artifactKind) : "";
    const hasCodeMeta = !!(dispatch && dispatch.artifactContent && dispatch.artifactContent.codeChange);
    const softwareTask = isSoftwareExecutionTask(intent);
    const codeChangeArtifact = isFormalCodeChangeArtifactType(artifactType, artifactKind);
    if (softwareTask && (codeChangeArtifact || hasCodeMeta)) {
      return { kind: "code-change", contradiction: false };
    }
    const contradiction = !!(hasCodeMeta && !(softwareTask && codeChangeArtifact));
    if (
      dispatch &&
      dispatch.artifactContent &&
      dispatch.artifactContent.content &&
      dispatch.artifactContent.content.kind === "bundle"
    ) {
      return { kind: "bundle", contradiction };
    }
    return { kind: "document", contradiction };
  }

  function sanitizeArtifactTypeForTask(taskIntent, rawType) {
    const api = projectionApi();
    if (api && typeof api.sanitizeArtifactTypeForTask === "function") {
      return api.sanitizeArtifactTypeForTask({ taskIntent, rawArtifactType: rawType });
    }
    const raw = String(rawType || "document");
    if (!isSoftwareExecutionTask(taskIntent) && isFormalCodeChangeArtifactType(raw, null)) {
      return "document";
    }
    return raw || "document";
  }

  function isActiveSoftwareCodeChangeProjection() {
    return activeArtifactProjectionKind === "code-change";
  }

  function setCodeChangeViewVisible(visible) {
    if (!els.codeChangeView) return;
    if (visible) {
      els.codeChangeView.hidden = false;
      els.codeChangeView.removeAttribute("hidden");
      els.codeChangeView.style.display = "";
    } else {
      els.codeChangeView.hidden = true;
      els.codeChangeView.setAttribute("hidden", "");
      els.codeChangeView.style.display = "none";
    }
  }

  function logArtifactProjectionDiagnostic(info) {
    if (typeof console === "undefined" || typeof console.info !== "function") return;
    console.info("[digitalme] artifact-projection", info);
  }

  /** 渲染前彻底清掉上一成果的投影，避免 display:none 继承残留 */
  function resetArtifactProjection() {
    activeArtifactProjectionKind = null;
    lastArtifactProjectionDiagnostic = null;
    hideCodeChangeView();
    hideRevisionComposer();
    hideNextStepsCard();
    hideAdoptWarning();
    hideRevisionActiveBanner();
    if (els.bundleView) {
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
    }
    if (els.bundleManifest) els.bundleManifest.textContent = "";
    if (els.bundleEntries) els.bundleEntries.innerHTML = "";
    if (els.bundleReport) {
      if ("value" in els.bundleReport) els.bundleReport.value = "";
      else els.bundleReport.textContent = "";
    }
    if (els.bundleQuality) {
      els.bundleQuality.hidden = true;
      els.bundleQuality.textContent = "";
    }
    if (els.bundleStaleNotice) {
      els.bundleStaleNotice.hidden = true;
      els.bundleStaleNotice.setAttribute("hidden", "");
    }
    if (els.artifactEditor) {
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
      suppressSave = true;
      els.artifactEditor.value = "";
      suppressSave = false;
    }
    if (els.exportMd) {
      els.exportMd.hidden = true;
      els.exportMd.setAttribute("hidden", "");
    }
    if (els.exportDocx) {
      els.exportDocx.hidden = true;
      els.exportDocx.setAttribute("hidden", "");
    }
    if (els.reveal) {
      els.reveal.hidden = true;
      els.reveal.setAttribute("hidden", "");
    }
    if (els.copy) setCopyEnabled(false);
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
    if (els.goalSend) {
      els.goalSend.hidden = workMode !== "compose" || !!(els.goal && els.goal.readOnly);
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

  function isThinRuntimeActive(detail) {
    if (activeRuntimePath === "thin_v1") return true;
    const d = detail || lastJobDetailForUx;
    return !!(d && d.task && d.task.meta && d.task.meta.runtimePath === "thin_v1");
  }

  function labelForState(state, userFacingLabel) {
    if (userFacingLabel) return userFacingLabel;
    switch (state) {
      case "waiting":
        return "等待开始";
      case "processing":
        return "处理中";
      case "completed":
        return isThinRuntimeActive() ? "请看结论后决定是否采用" : "尚未决定";
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
      const progress = mapProgressNoteForUi(job.progressNote);
      if (job.status === "running" && progress) return progress;
      if (job.status === "failed" && progress) return "执行失败，可重试";
      switch (job.status) {
        case "queued":
          return "等待开始";
        case "running":
          return job.revisionRequest ? "正在修改" : "处理中";
        case "succeeded":
          return detail.artifactIds && detail.artifactIds[0]
            ? isThinRuntimeActive(detail)
              ? "这一轮已经做完，请看结论后决定是否采用"
              : "尚未决定"
            : "受阻";
        case "failed":
          return "执行失败，可重试";
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
    // 三栏宽度常驻，避免 2↔3 列切换抖动；has-artifact 仅作状态标记
    els.workLayout.classList.add("has-artifact");
    els.workLayout.classList.toggle("artifact-ready", !!hasArtifact);
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

  function bumpUiEpoch() {
    uiEpoch += 1;
    return uiEpoch;
  }

  function hideRevisionActiveBanner() {
    if (!els.revisionActiveBanner) return;
    els.revisionActiveBanner.hidden = true;
    els.revisionActiveBanner.setAttribute("hidden", "");
  }

  function showRevisionActiveBanner(revisionRequest) {
    if (!els.revisionActiveBanner) return;
    const text = String(revisionRequest || "").trim();
    if (!text) {
      hideRevisionActiveBanner();
      return;
    }
    els.revisionActiveBanner.hidden = false;
    els.revisionActiveBanner.removeAttribute("hidden");
    if (els.revisionActiveTitle) {
      els.revisionActiveTitle.textContent = "正在按你的修改要求继续处理";
    }
    if (els.revisionActiveText) els.revisionActiveText.textContent = text;
  }

  function hideNextStepsCard() {
    if (!els.nextStepsCard) return;
    els.nextStepsCard.hidden = true;
    els.nextStepsCard.setAttribute("hidden", "");
    if (els.nextStepsActions) els.nextStepsActions.innerHTML = "";
    if (els.nextStepsStatus) els.nextStepsStatus.textContent = "";
  }

  function hideAdoptWarning() {
    if (!els.adoptWarningCard) return;
    els.adoptWarningCard.hidden = true;
    els.adoptWarningCard.setAttribute("hidden", "");
  }

  function showArtifactLoading(message) {
    activeArtifactId = null;
    activeHeadVersionId = null;
    activeCodeChangeWorkingDirectory = null;
    activeCodeChangeRunInfo = null;
    activeAcceptanceSummary = null;
    activeAcceptanceFailed = false;
    activeAcceptanceFailureMessage = "";
    hideCodeChangeView();
    hideRevisionComposer();
    hideNextStepsCard();
    hideAdoptWarning();
    copyBlockedFailed = false;
    setCopyEnabled(false);
    if (els.decisionBox) {
      els.decisionBox.hidden = true;
      els.decisionBox.setAttribute("hidden", "");
    }
    if (els.artifactEditor) {
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
    }
    if (els.bundleView) {
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
    }
    if (els.artifactEmpty) {
      els.artifactEmpty.hidden = true;
      els.artifactEmpty.setAttribute("hidden", "");
    }
    els.artifactPanel.hidden = false;
    els.artifactPanel.removeAttribute("hidden");
    setWorkLayoutArtifact(true);
    if (els.artifactLoading) {
      els.artifactLoading.hidden = false;
      els.artifactLoading.removeAttribute("hidden");
      const p = els.artifactLoading.querySelector("p");
      if (p) p.textContent = message || "正在打开任务…";
    }
    if (els.versionMeta) els.versionMeta.textContent = "";
    if (els.saveStatus) els.saveStatus.textContent = "";
    clearAppliedUnderstanding();
  }

  function hideArtifactLoading() {
    if (!els.artifactLoading) return;
    els.artifactLoading.hidden = true;
    els.artifactLoading.setAttribute("hidden", "");
  }

  function showEmptyArtifact(message) {
    activeArtifactId = null;
    activeHeadVersionId = null;
    activeCodeChangeRunInfo = null;
    activeAcceptanceSummary = null;
    activeAcceptanceFailed = false;
    activeAcceptanceFailureMessage = "";
    hideCodeChangeView();
    hideRevisionComposer();
    hideNextStepsCard();
    hideAdoptWarning();
    hideArtifactLoading();
    copyBlockedFailed = false;
    setCopyEnabled(false);
    if (els.decisionBox) {
      els.decisionBox.hidden = true;
      els.decisionBox.setAttribute("hidden", "");
    }
    if (els.artifactEditor) {
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
    }
    if (els.bundleView) {
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
    }
    els.artifactPanel.hidden = false;
    els.artifactPanel.removeAttribute("hidden");
    setWorkLayoutArtifact(true);
    if (els.artifactEmpty) {
      els.artifactEmpty.hidden = false;
      els.artifactEmpty.removeAttribute("hidden");
      els.artifactEmpty.textContent = message || "这项任务尚未产生成果。";
    }
    if (els.versionMeta) els.versionMeta.textContent = "";
    if (els.saveStatus) els.saveStatus.textContent = "";
    clearAppliedUnderstanding();
    refreshWorkUxView({});
  }

  function clearArtifactView() {
    // 稳定三栏：清空内容但不坍缩成果栏外框
    activeArtifactId = null;
    activeHeadVersionId = null;
    activeArtifactVersionLabel = "";
    resetArtifactProjection();
    hideRevisionActiveBanner();
    resetCollabUi();
    copyBlockedFailed = false;
    setCopyEnabled(false);
    if (els.artifactEmpty) {
      els.artifactEmpty.hidden = true;
      els.artifactEmpty.setAttribute("hidden", "");
    }
    if (els.artifactEmptyHint) {
      els.artifactEmptyHint.hidden = false;
      els.artifactEmptyHint.removeAttribute("hidden");
    }
    if (els.decisionBox) {
      els.decisionBox.hidden = true;
      els.decisionBox.setAttribute("hidden", "");
    }
    if (els.codeChangeView) {
      els.codeChangeView.hidden = true;
      els.codeChangeView.setAttribute("hidden", "");
    }
    if (els.versionMeta) els.versionMeta.textContent = "";
    hideArtifactLoading();
    els.artifactPanel.hidden = false;
    els.artifactPanel.removeAttribute("hidden");
    setWorkLayoutArtifact(true);
    if (els.revise) els.revise.disabled = true;
    if (els.acceptArtifact) els.acceptArtifact.disabled = true;
    if (els.rejectArtifact) els.rejectArtifact.disabled = true;
    renderArtifactDecision({ status: "undecided" });
    if (els.decisionNote) els.decisionNote.value = "";
    showStatus(els.decisionError, "");
    clearAppliedUnderstanding();
  }

  function clearRevisionShots() {
    revisionShotItems = [];
    renderRevisionShots();
    if (els.revisionShotHint) {
      els.revisionShotHint.hidden = true;
      els.revisionShotHint.textContent = "";
    }
  }

  function renderRevisionShots() {
    if (!els.revisionShots) return;
    els.revisionShots.innerHTML = "";
    for (const shot of revisionShotItems) {
      const wrap = document.createElement("div");
      wrap.className = "revision-shot";
      const img = document.createElement("img");
      img.src = shot.dataUrl;
      img.alt = "问题截图";
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.setAttribute("aria-label", "删除截图");
      del.addEventListener("click", () => {
        revisionShotItems = revisionShotItems.filter((s) => s.id !== shot.id);
        renderRevisionShots();
      });
      wrap.appendChild(img);
      wrap.appendChild(del);
      els.revisionShots.appendChild(wrap);
    }
  }

  function updateRevisionShotHint() {
    if (!els.revisionShotHint) return;
    if (!revisionShotItems.length) {
      els.revisionShotHint.hidden = true;
      els.revisionShotHint.textContent = "";
      return;
    }
    // 当前默认主模型不保证支持视觉：不假称已看懂图片
    els.revisionShotHint.hidden = false;
    els.revisionShotHint.removeAttribute("hidden");
    els.revisionShotHint.textContent =
      "已附上截图。Digital Me 会把截图保存为修改材料，并结合你的文字说明继续处理；请用文字写清问题要点。";
  }

  async function addRevisionShotFromDataUrl(dataUrl) {
    const raw = String(dataUrl || "");
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw)) return false;
    if (revisionShotItems.length >= 6) {
      if (els.revisionShotHint) {
        els.revisionShotHint.hidden = false;
        els.revisionShotHint.textContent = "一次最多附上 6 张截图。";
      }
      return false;
    }
    revisionShotSeq += 1;
    revisionShotItems.push({
      id: "shot_" + revisionShotSeq,
      dataUrl: raw,
    });
    renderRevisionShots();
    updateRevisionShotHint();
    return true;
  }

  async function persistRevisionShots() {
    const paths = [];
    for (const shot of revisionShotItems) {
      if (shot.path) {
        paths.push(shot.path);
        continue;
      }
      if (typeof api.saveRevisionImage !== "function") {
        throw new Error("当前环境无法保存截图");
      }
      const saved = await api.saveRevisionImage({ dataUrl: shot.dataUrl });
      if (!saved || !saved.ok || !saved.path) {
        throw new Error((saved && saved.error) || "截图保存失败");
      }
      shot.path = saved.path;
      paths.push(saved.path);
    }
    return paths;
  }

  function hideRevisionComposer() {
    if (!els.revisionComposer && !els.reviseBox) return;
    const box = els.revisionComposer || els.reviseBox;
    box.hidden = true;
    box.setAttribute("hidden", "");
  }

  function showRevisionComposer(opts) {
    const box = els.revisionComposer || els.reviseBox;
    if (!box) return;
    const continueMode = !!(opts && opts.continueMode);
    // 主路径：中栏自然语言；右侧补充区仅作截图等辅助，默认不抢焦点
    if (continueMode && !(opts && opts.forceOpen)) {
      hideRevisionComposer();
      focusWorkNaturalLanguageInput();
      refreshWorkUxView({});
      return;
    }
    box.hidden = false;
    box.removeAttribute("hidden");
    if (els.revisionComposerTitle) {
      els.revisionComposerTitle.textContent = continueMode
        ? "补充意见"
        : "补充意见（可选）";
    }
    if (els.revisionRequest && !(els.revisionRequest.value || "").trim()) {
      els.revisionRequest.placeholder =
        "也可直接在中间对话区输入。可粘贴截图，或点击「添加截图」。";
    }
    updateRevisionShotHint();
    focusWorkNaturalLanguageInput();
    refreshWorkUxView({});
  }

  function renderArtifactDecision(decision) {
    if (!els.decisionStatus) return;
    const status = decision && decision.status ? decision.status : "undecided";
    lastDecisionStatus = status;
    const noteField = els.decisionNote
      ? els.decisionNote.closest(".decision-note") || els.decisionNote.closest("label")
      : null;
    if (status === "accepted") {
      els.decisionStatus.textContent = "已采用";
      els.decisionStatus.hidden = false;
      els.decisionStatus.removeAttribute("hidden");
      if (els.decisionActions) els.decisionActions.hidden = false;
      if (noteField) noteField.hidden = true;
      const isCodeChange = isActiveSoftwareCodeChangeProjection();
      if (isCodeChange) renderNextStepsCard();
      else hideNextStepsCard();
      refreshWorkUxView({ decisionStatus: status });
      return;
    }
    hideNextStepsCard();
    if (status === "rejected") {
      els.decisionStatus.textContent = "未采用";
      els.decisionStatus.hidden = false;
      els.decisionStatus.removeAttribute("hidden");
      if (noteField) noteField.hidden = true;
    } else if (isThinRuntimeActive()) {
      els.decisionStatus.textContent =
        activeAcceptanceSummary && activeAcceptanceSummary.canAdoptSuggested
          ? "已经完成修改并检查通过。"
          : "请查看结论";
      els.decisionStatus.hidden = false;
      els.decisionStatus.removeAttribute("hidden");
      if (noteField) noteField.hidden = true;
    } else {
      els.decisionStatus.textContent = "尚未决定";
      els.decisionStatus.hidden = false;
      els.decisionStatus.removeAttribute("hidden");
      if (noteField) noteField.hidden = true;
    }
    if (els.decisionActions) els.decisionActions.hidden = false;
    refreshWorkUxView({ decisionStatus: status });
  }

  async function submitArtifactDecision(kind, opts) {
    showStatus(els.decisionError, "");
    hideAdoptWarning();
    if (!activeArtifactId || !activeHeadVersionId || !activeTaskId) {
      showStatus(els.decisionError, "当前没有可决定的成果", true);
      return;
    }
    const forceAdopt = !!(opts && opts.forceAdopt);
    const note = els.decisionNote ? String(els.decisionNote.value || "").trim() : "";
    const goal = els.goal && els.goal.value ? String(els.goal.value).trim() : "";
    const isCodeChange = isActiveSoftwareCodeChangeProjection();
    if (
      kind === "accept" &&
      isCodeChange &&
      !forceAdopt &&
      activeAcceptanceSummary &&
      activeAcceptanceSummary.canAdoptSuggested === false
    ) {
      const warnings =
        (activeAcceptanceSummary.adoptWarnings && activeAcceptanceSummary.adoptWarnings.length
          ? activeAcceptanceSummary.adoptWarnings
          : ["Digital Me 检查发现还有问题"]).slice(0, 6);
      if (els.adoptWarningCard && els.adoptWarningList) {
        els.adoptWarningCard.hidden = false;
        els.adoptWarningCard.removeAttribute("hidden");
        els.adoptWarningList.innerHTML = "";
        for (const w of warnings) {
          const li = document.createElement("li");
          li.textContent = w;
          els.adoptWarningList.appendChild(li);
        }
        refreshWorkUxView({ adoptWarningOpen: true, canAdoptSuggested: false });
      }
      return;
    }
    const isCodeAnalysis =
      activeArtifactKind === "bundle" ||
      activeTaskRequestedArtifactType === "code-analysis" ||
      activeTaskIntentKind === "analyze_code";
    const baseText =
      kind === "accept"
        ? note ||
          (isCodeChange
            ? `采用当前项目修改并保留文件变更。任务：${goal || "本次任务"}`.slice(0, 400)
            : isCodeAnalysis
              ? `采用代码分析：可沿用关注点、判断标准与工作方法。任务：${goal || "本次任务"}`.slice(
                  0,
                  400,
                )
              : `采用成果：${goal || "本次任务"}`.slice(0, 400))
        : note ||
          (isCodeChange
            ? `不采用当前修改结果（不会自动还原项目文件）。任务：${goal || "本次任务"}`.slice(0, 400)
            : `未采用成果：${goal || "本次任务"}`.slice(0, 400));
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
        ...(kind === "reject" && note ? { rejectionReason: note } : {}),
      });
      if (result && result.captureOutcome === "distill_failed") {
        showStatus(els.decisionError, "决定已记下，但相关体会还没记全，请稍后再试。", true);
      }
      const status =
        (result && result.ownerDecision) || (kind === "accept" ? "accepted" : "rejected");
      renderArtifactDecision({ status });
      if (els.decisionNote && status === "accepted") els.decisionNote.value = "";
      if (kind === "reject" && status === "rejected") {
        hideRevisionComposer();
        lastArtifactRejectionReason = note || "";
        if (els.saveStatus) els.saveStatus.textContent = "已记录你的决定。这份成果未采用。";
        // 不自动 reviseArtifact；仅进入 needs_revision，主动作「继续修改」
        refreshWorkUxView({ decisionStatus: "rejected", hasArtifact: true });
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

  function focusWorkNaturalLanguageInput() {
    if (!els.workNlInput || els.workNlInput.disabled) return;
    requestAnimationFrame(() => {
      try {
        els.workNlInput.focus();
      } catch {
        /* ignore */
      }
    });
  }

  function startNewTaskComposer(seed) {
    bumpUiEpoch();
    workMode = "compose";
    activeTaskId = null;
    activeJobId = null;
    workExtraTurns = [];
    persistedConversationTurns = [];
    converseDraftTaskId = null;
    activeTaskPlan = null;
    activeRuntimePath = null;
    thinFailureExplainedJobId = null;
    prepBlockedState = null;
    taskPausedCto = false;
    lastCtoTimelineKey = "";
    activeArtifactVersionLabel = "";
    lastJobDetailForUx = null;
    activeAcceptanceSummary = null;
    activeAcceptanceFailed = false;
    activeAcceptanceFailureMessage = "";
    lastDecisionStatus = null;
    activeArtifactId = null;
    activeHeadVersionId = null;
    if (els.workNlInput) {
      els.workNlInput.value = "";
      els.workNlInput.disabled = false;
    }
    if (els.workTimeline) els.workTimeline.innerHTML = "";
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
    pendingExecutionConfirm = null;
    pendingCreateProject = null;
    pendingCodingOnboarding = null;
    clearArtifactView();
    setWorkCollabVisible(false);
    if (els.restartCompose) els.restartCompose.hidden = true;
    if (els.submit) {
      // 首轮由中栏自然语言发送驱动；快捷「开始处理」仍可由 UX 阶段派生显示
      els.submit.hidden = true;
      els.submit.setAttribute("hidden", "");
      els.submit.disabled = false;
    }
    setWorkStage("center");
    setWorkTasksOpen(false);
    syncGoalPresentation();
    refreshTasks();
    if (!(seed && seed.preservePending)) {
      void api.invoke("capability.list", { codingAction: { type: "clear_pending" } }).catch(() => {});
    }
    focusWorkNaturalLanguageInput();
    refreshWorkUxView({ workMode: "compose", hasArtifact: false, decisionStatus: null, jobStatus: null });
  }

  function setWorkCollabVisible(visible) {
    if (!els.collabBox) return;
    // 协作入口收入「更多」，不再平铺抢主路径
    els.collabBox.hidden = !visible;
    if (els.workAssistEntries) setElVisible(els.workAssistEntries, false);
    if (!visible) resetCollabUi();
  }

  async function refreshTasks() {
    const requestEpoch = uiEpoch;
    const { tasks } = await api.invoke("work.listTasks", { limit: 50 });
    if (requestEpoch !== uiEpoch && workMode === "task") {
      // 允许 compose 时刷新；task 模式下若已切换则仍应用列表（顺序/标签来自权威 list），但不要用过期 epoch 挡列表
    }
    els.taskList.innerHTML = "";
    els.taskEmpty.hidden = tasks.length > 0;
    for (const t of tasks) {
      const li = document.createElement("li");
      li.dataset.taskId = t.taskId;
      if (workMode === "task" && t.taskId === activeTaskId) li.classList.add("active");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "linkish";
      btn.dataset.taskId = t.taskId;
      const stateLabel = t.userFacingLabel || labelForState(t.state);
      btn.innerHTML = `<div class="task-goal">${escapeHtml(t.goal.slice(0, 80))}</div>
        <div class="task-state" data-task-state="${escapeHtml(t.taskId)}">${escapeHtml(stateLabel)}</div>`;
      btn.addEventListener("click", () => selectTask(t.taskId));
      li.appendChild(btn);
      els.taskList.appendChild(li);
    }
  }

  /** 仅更新指定 taskId 的列表标签，禁止用「当前任务」变量改任意项。 */
  function updateTaskListItemLabel(taskId, label) {
    if (!taskId || !label) return;
    const node = els.taskList.querySelector(
      '.task-state[data-task-state="' + CSS.escape(taskId) + '"]',
    );
    if (node) node.textContent = label;
    const li = els.taskList.querySelector('li[data-task-id="' + CSS.escape(taskId) + '"]');
    if (li) {
      if (workMode === "task" && taskId === activeTaskId) li.classList.add("active");
      else li.classList.remove("active");
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

  async function explainThinJobFailure(detail) {
    if (!isThinRuntimeActive(detail)) return;
    const job = detail && detail.latestJob;
    if (!job || job.status !== "failed") return;
    const jobId = job.jobId || job.id;
    if (!jobId || thinFailureExplainedJobId === jobId) return;
    const taskId = activeTaskId;
    if (!taskId || workConverseInFlight) return;
    thinFailureExplainedJobId = jobId;
    try {
      const res = await api.invoke("work.converse", {
        taskId,
        text: "请根据刚才的执行结果，用平实的话说明为什么没做成，以及我现在可以怎么做。",
        silentOutcomeExplain: true,
      });
      if (res && res.reply) {
        persistedConversationTurns = persistedConversationTurns.concat(
          (res.newTurns || [])
            .filter((t) => t && t.content)
            .map((t) => ({
              id: t.turnId,
              role: t.role === "digital_me" ? "digital_me" : "user",
              kind: "message",
              text: String(t.content),
              createdAt: t.createdAt,
            })),
        );
        renderWorkTimeline();
      }
    } catch {
      /* 状态栏仍有失败说明；对话补充失败不得冒充成功 */
    }
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
    if (job && (job.status === "running" || job.status === "queued")) {
      label = "正在处理…";
    }
    els.jobStatus.textContent = label;
    els.jobStatus.classList.toggle("error", failed);
    els.jobActionable.textContent = "";
    if (failed) {
      els.jobActionable.textContent = userFacingFailureReason(detail, eventNote);
      void explainThinJobFailure(detail);
    } else if (cancelled) {
      const cancelledMsg =
        detail && detail.latestJob && detail.latestJob.actionable
          ? String(detail.latestJob.actionable)
          : "任务已取消。可以重试。";
      els.jobActionable.textContent = cancelledMsg;
    } else if (job && (job.status === "queued" || job.status === "running") && job.revisionRequest) {
      els.jobActionable.textContent = "修改要求：" + String(job.revisionRequest);
    } else if (detail.state === "attention") {
      els.jobActionable.textContent = "可以重试，或调整目标与材料后再试。";
    }
  }

  function setElVisible(el, visible) {
    if (!el) return;
    el.hidden = !visible;
    if (visible) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }

  function collectWorkUxFacts(extra) {
    const detail = lastJobDetailForUx;
    const job = detail && detail.latestJob;
    const js = job && job.status ? String(job.status) : null;
    const runInfo = activeCodeChangeRunInfo;
    const acc = activeAcceptanceSummary;
    const startupFailed =
      !!acc &&
      (((acc.bullets || []).some((b) => /启动检查失败|尚不能确认/.test(b)) ||
        (acc.adoptWarnings || []).some((w) => /启动检查/.test(w)) ||
        (acc.canAdoptSuggested === false && runInfo && runInfo.runnable === false)));
    const canTry = !!(runInfo && runInfo.runnable && runInfo.canSuggestTryRun !== false && !startupFailed);
    const revisionOpen = !!(els.revisionComposer && !els.revisionComposer.hidden);
    const adoptWarn = !!(els.adoptWarningCard && !els.adoptWarningCard.hidden);
    const projectDirReady = materials.some((m) => m && m.kind === "folder" && m.path);
    const prepKind = prepBlockedState && prepBlockedState.kind ? String(prepBlockedState.kind) : null;
    return {
      workMode,
      modelReady: lastModelReady !== false,
      // D11-E：阶段只看右栏 prepBlocked / 规划确认
      projectCreateConfirm: prepKind === "project_confirm",
      projectDirReady,
      prepBlocked: !!prepBlockedState,
      prepBlockedKind: prepKind,
      hasPlanDraft: !!(
        activeTaskPlan &&
        activeTaskPlan.content &&
        activeTaskPlan.source !== "seed_internal" &&
        !activeArtifactId &&
        js !== "queued" &&
        js !== "running"
      ),
      ownerChoicePrompt: !!(els.ownerChoicePrompt && !els.ownerChoicePrompt.hidden),
      revisionComposerOpen: revisionOpen,
      adoptWarningOpen: adoptWarn,
      jobStatus: js,
      hasArtifact: !!activeArtifactId,
      decisionStatus: lastDecisionStatus,
      canAdoptSuggested:
        acc && typeof acc.canAdoptSuggested === "boolean" ? acc.canAdoptSuggested : null,
      primaryAction: acc && acc.primaryAction ? String(acc.primaryAction) : null,
      taskPaused: !!taskPausedCto,
      codeChange: isActiveSoftwareCodeChangeProjection(),
      canTryRun: canTry,
      startupFailed,
      hasWorkingDirectory: !!activeCodeChangeWorkingDirectory && isActiveSoftwareCodeChangeProjection(),
      jobCancelSupported: true,
      thinRuntime: isThinRuntimeActive(detail),
      ...(extra || {}),
    };
  }

  const WORK_UX_EL_BY_ID = () => ({
    start_submit: els.submit,
    cancel_job: els.cancel,
    retry_job: els.retry,
    goto_settings: els.gotoSettings,
    accept: els.acceptArtifact,
    reject: els.rejectArtifact,
    propose_revision: els.proposeRevision,
    continue_revise: els.adoptContinueRevise || els.proposeRevision,
    adopt_anyway: els.adoptAnyway,
    submit_revision: els.revise,
    cancel_revision: els.cancelRevision,
    add_revision_shot: els.addRevisionShot,
    restore_baseline: els.restoreBaseline,
    open_project: els.openProjectFolder,
    restart_compose: els.restartCompose,
    reveal_artifact: els.reveal,
    copy_artifact: els.copy,
    export_md: els.exportMd,
    export_docx: els.exportDocx,
    collab_open: els.collabOpen,
    external_cap: els.externalCapOpen,
  });

  /**
   * 唯一入口：canonical facts → deriveWorkUxView → 原子更新 UI。
   * loading 不进入永久 WorkUxStage；各事实变化后应调用本函数。
   */
  function refreshWorkUxView(extraFacts) {
    return applyWorkUxChrome(extraFacts || {});
  }

  function resolveWorkUxActionEl(actionId, facts, byId) {
    if (actionId === "continue_revise" || actionId === "confirm_continue") {
      // 继续修改必须走既有 revision 入口，不能藏进警告卡
      return facts.adoptWarningOpen ? els.adoptContinueRevise || els.proposeRevision : els.proposeRevision;
    }
    if (actionId === "supplement_opinion") {
      return els.proposeRevision;
    }
    if (actionId === "adopt_anyway") {
      return facts.adoptWarningOpen ? els.adoptAnyway || els.acceptArtifact : els.acceptArtifact;
    }
    if (actionId === "tell_what_wrong") return els.proposeRevision;
    if (actionId === "pause_task") return null;
    return byId[actionId] || null;
  }

  async function runCtoConfirmContinue(userSupplement) {
    if (workMode !== "task" || !activeTaskId) return;
    const artifactId =
      activeArtifactId ||
      (lastJobDetailForUx &&
        lastJobDetailForUx.artifactIds &&
        lastJobDetailForUx.artifactIds[0]) ||
      (lastJobDetailForUx &&
        lastJobDetailForUx.latestJob &&
        (lastJobDetailForUx.latestJob.artifactId ||
          lastJobDetailForUx.latestJob.latestArtifactId)) ||
      null;
    if (!artifactId) {
      if (els.jobStatus) {
        els.jobStatus.textContent = "当前没有可修改的成果，请先完成一轮开发后再说明修改要求。";
        els.jobStatus.classList.add("error");
      }
      return;
    }
    activeArtifactId = artifactId;
    const connected = await refreshConnectionFromCapabilities();
    if (!connected) {
      if (els.jobStatus) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
      }
      return;
    }
    const acc = activeAcceptanceSummary || {};
    const directive = String(acc.revisionDirective || "").trim();
    const next = String(acc.userFacingNextStep || "").trim();
    const userText = String(userSupplement || "").trim();
    let revisionRequest = "";
    if (userText) {
      // FIX-22：Owner 明确修订以用户原文为主；CTO 建议仅作附录，不得盖过用户要求
      revisionRequest = userText;
      if (directive && directive !== userText) {
        revisionRequest = `${userText}\n\n【Digital Me 此前建议】\n${directive}`;
      }
    } else {
      revisionRequest =
        directive || next || "请按 Digital Me 验收结论继续修正，补齐未达标项并提供可核对证据。";
    }
    taskPausedCto = false;
    hideRevisionComposer();
    hideAdoptWarning();
    if (els.jobStatus) {
      els.jobStatus.textContent = "正在按你的修改要求继续…";
      els.jobStatus.classList.remove("error");
    }
    try {
      const result = await api.invoke("work.reviseArtifact", {
        taskId: activeTaskId,
        artifactId,
        revisionRequest,
      });
      if (result && result.jobId) {
        activeJobId = result.jobId;
        workMode = "task";
        refreshWorkUxView({});
        if (typeof pollActiveJob === "function") pollActiveJob();
        else if (typeof refreshTaskDetail === "function") refreshTaskDetail();
      }
    } catch (err) {
      if (els.jobStatus) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      }
    }
  }

  function syncWorkComposeVisibility() {
    if (els.panelWork) {
      if (workMode === "task" && activeTaskId) els.panelWork.classList.add("work-task-focus");
      else els.panelWork.classList.remove("work-task-focus");
    }
    if (els.workNlComposer) {
      const adopted = lastDecisionStatus === "accepted";
      els.workNlComposer.hidden = false;
      if (els.workNlInput) {
        els.workNlInput.disabled = false;
        els.workNlInput.placeholder = adopted
          ? "成果已采用。可继续询问或说明新的修改要求。"
          : "直接说明下一步：例如「继续完善……」「这里不符合我的要求……」「现在能不能用」。";
      }
      if (els.workNlSend) els.workNlSend.disabled = false;
    }
  }

  /**
   * 从 Task.meta.conversation（唯一权威记录）水合中栏对话；重启/刷新后可恢复。
   * 尚无 Job 的任务视为对话中枢的理解任务，确定性开始时复用同一 Task。
   */
  function hydrateConversationFromTask(detail) {
    const meta = detail && detail.task && detail.task.meta;
    const conv = meta && meta.conversation;
    const turns = conv && Array.isArray(conv.turns) ? conv.turns : [];
    persistedConversationTurns = turns
      .filter((t) => t && t.content)
      .map((t) => ({
        id: t.turnId || "turn_" + Math.random().toString(36).slice(2),
        role: t.role === "digital_me" ? "digital_me" : "user",
        kind: "message",
        text: String(t.content),
        createdAt: t.createdAt,
      }));
    converseDraftTaskId =
      detail && detail.task && !detail.latestJob ? detail.task.id : null;
    hydratePlanFromTask(detail);
  }

  function hydratePlanFromTask(detail) {
    const plan = detail && detail.task && detail.task.meta && detail.task.meta.plan;
    // seed_internal 仅内部恢复，不得进入用户可见规划态
    if (plan && plan.content && plan.source !== "seed_internal") {
      activeTaskPlan = {
        version: plan.version,
        status: plan.status,
        content: plan.content,
        confirmedAt: plan.confirmedAt,
        confirmedFacts: plan.confirmedFacts,
        source: plan.source || "model",
      };
    } else {
      activeTaskPlan = null;
    }
    refreshTaskWorkspace();
  }

  function refreshTaskWorkspace() {
    const tw = window.DigitalMeTaskWorkspace;
    if (!tw || typeof tw.renderTaskWorkspace !== "function") return;
    const panel = document.getElementById("artifact-panel");
    const detail = lastJobDetailForUx;
    const job = detail && detail.latestJob;
    const js = job ? String(job.status || "") : "";
    const running = js === "queued" || js === "running";
    const hasArtifact = !!activeArtifactId;
    const revising =
      running &&
      !!(job && job.revisionRequest);
    const loop =
      detail && detail.task && detail.task.meta && detail.task.meta.revisionLoop
        ? detail.task.meta.revisionLoop
        : null;
    const artifactIds =
      detail && Array.isArray(detail.artifactIds) ? detail.artifactIds : [];
    const latestArtifactId =
      (job && (job.artifactId || job.latestArtifactId)) || artifactIds[0] || null;
    let mode = tw.deriveWorkspaceMode
      ? tw.deriveWorkspaceMode({
          prepBlocked: !!prepBlockedState,
          jobStatus: js,
          revising,
          hasArtifact: hasArtifact || !!latestArtifactId,
          artifactIds,
          latestArtifactId,
          hasPlan: !!(activeTaskPlan && activeTaskPlan.content),
        })
      : prepBlockedState
        ? "prep_blocked"
        : revising
          ? "revising"
          : running
            ? "running"
            : hasArtifact || latestArtifactId
              ? "complete"
              : activeTaskPlan && activeTaskPlan.content
                ? "planning"
                : "idle";
    const progressNote = running
      ? "正在处理…"
      : (loop && loop.paused && loop.pauseReason
        ? "已暂停自动修订。可在对话中说明下一步，或点继续。"
        : null) ||
        (job && (job.progressNote || job.actionable || job.userFacingLabel)) ||
        (detail && detail.userFacingLabel) ||
        "";
    const thin = isThinRuntimeActive(detail);
    tw.renderTaskWorkspace({
      root: panel,
      mode,
      plan: activeTaskPlan,
      goal: (els.goal && els.goal.value) || "",
      prep: prepBlockedState,
      thinRuntime: thin,
      running: running
        ? {
            progressNote: "正在处理…",
          }
        : null,
      title: thin && mode === "planning" ? "任务工作区 · 当前方案" : tw.titleForMode(mode),
    });
    if (running) {
      const runTitle = document.getElementById("tw-running-title");
      if (runTitle) runTitle.textContent = "正在处理…";
      const runProgress = document.getElementById("tw-running-progress");
      if (runProgress) runProgress.textContent = "正在处理…";
      const runPlan = document.getElementById("tw-running-plan");
      if (runPlan) runPlan.textContent = "";
      const runHint = document.getElementById("tw-running-hint");
      if (runHint) {
        runHint.hidden = true;
        runHint.setAttribute("hidden", "");
      }
      if (els.artifactEmptyHint) {
        els.artifactEmptyHint.hidden = true;
        els.artifactEmptyHint.setAttribute("hidden", "");
      }
      if (!hasArtifact && els.artifactEmpty) {
        els.artifactEmpty.hidden = true;
        els.artifactEmpty.setAttribute("hidden", "");
      }
    }
    if (els.artifactExportsMore) {
      const summary = els.artifactExportsMore.querySelector("summary");
      if (summary) summary.textContent = "导出副本";
      els.artifactExportsMore.hidden = !hasArtifact;
    }
    syncPrepActionButtons();
  }

  function syncPrepActionButtons() {
    const kind = prepBlockedState && prepBlockedState.kind;
    const set = (el, on) => {
      if (!el) return;
      el.hidden = !on;
    };
    set(els.twCreateProject, kind === "project");
    set(els.twPickProject, kind === "project" || kind === "project_confirm");
    set(els.twConnectCoding, kind === "executor");
    set(els.twOpenSettings, kind === "executor" || kind === "model");
    set(els.twPrepContinue, kind === "project" || kind === "executor" || kind === "project_confirm");
    if (els.twPrepContinue) {
      els.twPrepContinue.textContent =
        kind === "project_confirm" ? "确认项目并开始开发" : "准备好了，继续";
    }
    set(els.twHighRiskConfirm, kind === "high_risk");
    set(els.twHighRiskCancel, kind === "high_risk" || kind === "project_confirm");
    if (els.twHighRiskCancel && kind === "project_confirm") {
      els.twHighRiskCancel.textContent = "取消";
      els.twHighRiskCancel.hidden = false;
    }
  }

  function showPrepBlocked(kind, payload) {
    if (kind === "project") {
      prepBlockedState = {
        kind: "project",
        title: "开发前还需完成准备",
        missing: "还缺少可用的项目位置。",
        why: "没有项目位置，就无法在安全范围内创建或修改文件。",
        checked: "Digital Me 已确认：当前任务需要可写入的项目目录。",
        action: "可由 Digital Me 创建新项目，或选择你已有的项目。",
        continueHint: "选好位置后点「继续准备」，将按已确认的规划开始。",
        payload: payload || null,
      };
    } else if (kind === "executor") {
      const msg =
        (payload && (payload.message || payload.description)) ||
        "尚未检测到可用的代码执行能力。";
      prepBlockedState = {
        kind: "executor",
        title: "开发前还需完成准备",
        missing: "还缺少可用的代码执行能力。",
        why: "没有它，Digital Me 无法在项目里实际创建或修改代码。",
        checked: "Digital Me 已完成检测：" + msg,
        action: "请连接代码执行能力，或打开设置完成安装与登录。",
        continueHint: "连接成功后点「继续准备」，将按已确认的规划开始。",
        payload: payload || null,
      };
    } else if (kind === "high_risk") {
      prepBlockedState = {
        kind: "high_risk",
        title: "需要额外确认",
        missing: "这项操作涉及更高风险的取舍。",
        why: (payload && payload.notice) || "确认后才会按扩大后的权限或破坏性意图执行。",
        checked:
          "确认对象：规划版本 v" +
          String((activeTaskPlan && activeTaskPlan.version) || "?") +
          "；工作目录：" +
          ((payload && payload.workingDirectory) || "（未指定）"),
        action: "请确认你了解后果后再继续。",
        continueHint: "",
        payload: payload || null,
      };
    } else {
      prepBlockedState = null;
    }
    refreshTaskWorkspace();
    refreshWorkUxView({
      prepBlocked: !!prepBlockedState,
      prepBlockedKind: prepBlockedState && prepBlockedState.kind ? prepBlockedState.kind : null,
      projectCreateConfirm: !!(prepBlockedState && prepBlockedState.kind === "project_confirm"),
    });
  }

  function clearPrepBlocked() {
    prepBlockedState = null;
    refreshTaskWorkspace();
  }

  function renderWorkTimeline() {
    const conv = window.DigitalMeWorkConversation;
    if (!conv || !els.workTimeline) return;
    const detail = lastJobDetailForUx;
    const job = detail && detail.latestJob;
    const js = job && job.status ? String(job.status) : "";
    const acc = activeAcceptanceSummary || {};
    const understandingLines = [];
    if (acc.ctoReport) {
      /* CTO 报告单独呈现 */
    }
    const pending = pendingExecutionConfirm && pendingExecutionConfirm.preview;
    if (pending && pending.understandingSummary) {
      for (const line of pending.understandingSummary) understandingLines.push(String(line));
    }
    const turns = conv.buildWorkTimeline({
      // 有持久化对话时首条用户轮即目标本身，避免目标重复显示
      goal: persistedConversationTurns.length
        ? ""
        : (els.goal && els.goal.value) || (detail && detail.goal) || "",
      taskCreatedAt: detail && detail.createdAt,
      understandingLines,
      jobRunning: js === "queued" || js === "running",
      jobFailed: js === "failed" || js === "cancelled",
      failureMessage: (els.jobActionable && els.jobActionable.textContent) || "",
      revisionActive: !!(job && job.revisionRequest),
      ctoReport: acc.ctoReport || "",
      ctoDecision: (acc.ctoReview && acc.ctoReview.decision) || "",
      primaryAction: acc.primaryAction || "",
      acceptanceFailed: !!activeAcceptanceFailed,
      acceptanceFailureMessage: activeAcceptanceFailureMessage || "",
      revisionPaused: !!(
        detail &&
        detail.task &&
        detail.task.meta &&
        detail.task.meta.revisionLoop &&
        detail.task.meta.revisionLoop.paused
      ),
      requireUserDecision: !!(
        (acc.ctoReview && acc.ctoReview.requiresUserDecision) ||
        acc.primaryAction === "need_decision"
      ),
      userFacingNextStep: acc.userFacingNextStep || "",
      canAdoptSuggested: !!acc.canAdoptSuggested,
      artifactVersionId: activeHeadVersionId || "",
      hasArtifact: !!activeArtifactId,
      decisionAccepted: lastDecisionStatus === "accepted",
      extraTurns: persistedConversationTurns.concat(workExtraTurns),
    });
    els.workTimeline.innerHTML = "";
    for (const turn of turns) {
      const li = document.createElement("li");
      li.className = "work-turn work-turn-" + turn.role;
      li.dataset.turnKind = turn.kind || "";
      const role = document.createElement("div");
      role.className = "work-turn-role";
      role.textContent = conv.roleLabel(turn.role);
      const body = document.createElement("div");
      body.className = "work-turn-text";
      body.textContent = turn.text || "";
      li.appendChild(role);
      li.appendChild(body);
      if (turn.actions && turn.actions.length) {
        const row = document.createElement("div");
        row.className = "work-turn-actions";
        for (const action of turn.actions) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = action.id === "confirm_adopt" ? "primary" : "ghost";
          btn.textContent = action.label;
          btn.addEventListener("click", () => handleWorkTimelineAction(action.id, turn));
          row.appendChild(btn);
        }
        li.appendChild(row);
      }
      els.workTimeline.appendChild(li);
    }
    if (els.workConversationScroll && turns.length) {
      els.workConversationScroll.scrollTop = els.workConversationScroll.scrollHeight;
    }
    syncWorkComposeVisibility();
  }

  function hideAdoptConfirm() {
    const box = document.getElementById("adopt-confirm");
    if (box) box.hidden = true;
  }

  function showAdoptConfirm(versionHint) {
    let box = document.getElementById("adopt-confirm");
    if (!box) {
      box = document.createElement("div");
      box.id = "adopt-confirm";
      box.className = "work-turn work-turn-digital_me adopt-confirm";
      box.innerHTML =
        '<p class="work-turn-role">Digital Me</p>' +
        '<p id="adopt-confirm-text" class="work-turn-text"></p>' +
        '<div class="row adopt-confirm-actions">' +
        '<button type="button" id="btn-adopt-confirm" class="primary">确认采用</button>' +
        '<button type="button" id="btn-adopt-later" class="ghost">再看看</button>' +
        "</div>";
      const host = els.workTimeline && els.workTimeline.parentNode;
      if (host) host.insertBefore(box, els.workTimeline.nextSibling);
      else if (els.workConversationScroll) els.workConversationScroll.appendChild(box);
      const yes = box.querySelector("#btn-adopt-confirm");
      const later = box.querySelector("#btn-adopt-later");
      if (yes) {
        yes.addEventListener("click", () => {
          hideAdoptConfirm();
          void submitArtifactDecision("accept", { forceAdopt: false });
        });
      }
      if (later) later.addEventListener("click", () => hideAdoptConfirm());
    }
    const textEl = box.querySelector("#adopt-confirm-text");
    if (textEl) {
      textEl.textContent =
        "确认采用「" +
        versionHint +
        "」？采用意味着结束当前交付循环，并将该成果沉淀为已采用结果。采用后如需新工作，请新建任务。";
    }
    box.hidden = false;
    box.removeAttribute("hidden");
    if (typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "nearest" });
  }

  async function handleWorkTimelineAction(actionId, turn) {
    if (actionId === "confirm_adopt") {
      const versionHint =
        activeArtifactVersionLabel ||
        (turn && turn.artifactVersionId) ||
        activeHeadVersionId ||
        "当前版本";
      showAdoptConfirm(versionHint);
      return;
    }
    if (actionId === "confirm_continue") {
      await runCtoConfirmContinue("");
      return;
    }
    if (actionId === "retry_acceptance") {
      if (!activeArtifactId) return;
      els.jobStatus.textContent = "正在重新整理验收说明…";
      els.jobStatus.classList.remove("error");
      try {
        await api.invoke("artifact.getContent", {
          artifactId: activeArtifactId,
          retryAcceptance: true,
          ...(activeTaskId ? { expectedTaskId: activeTaskId } : {}),
        });
        await loadArtifact(activeArtifactId, { taskId: activeTaskId, epoch: uiEpoch });
      } catch (err) {
        els.jobStatus.textContent = "成果已生成，但验收说明暂未完成，可重试。";
        if (els.jobActionable) {
          els.jobActionable.textContent = userFacingWorkError(err) || "现有成果已保留。";
        }
      }
      return;
    }
    if (actionId === "retry_job" && els.retry) {
      els.retry.click();
    }
  }

  let workConverseInFlight = false;

  /**
   * D11-A：自然语言输入一律先经 work.converse 得到 Digital Me 的理解与回应；
   * 不做本地关键词路由，不默认触发修改。执行只在 startAuthorized 后经确定性命令发生。
   */
  async function submitWorkNaturalLanguage(presetText) {
    if (!els.workNlInput && presetText == null) return;
    if (workConverseInFlight) {
      if (els.jobStatus) {
        els.jobStatus.textContent = "正在思考…";
        els.jobStatus.classList.remove("error");
      }
      return;
    }
    const text = String(
      presetText != null ? presetText : (els.workNlInput && els.workNlInput.value) || "",
    ).trim();
    if (!text) return;
    const payload = { text };
    const targetTaskId = activeTaskId || converseDraftTaskId;
    if (targetTaskId) payload.taskId = targetTaskId;
    else if (materials.length) {
      payload.contextRefs = materials.map((m) => ({
        kind: m.kind,
        path: m.path,
        ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}),
      }));
    }
    if (els.workNlInput) els.workNlInput.value = "";
    // 乐观显示用户输入；权威记录由 work.converse 持久化后回填
    const pendingId = "user_pending_" + Date.now();
    workExtraTurns = workExtraTurns.concat([
      {
        id: pendingId,
        role: "user",
        kind: "message",
        text,
        createdAt: new Date().toISOString(),
      },
    ]);
    renderWorkTimeline();
    if (els.workNlSend) els.workNlSend.disabled = true;
    if (els.jobStatus) {
      els.jobStatus.textContent = "正在思考…";
      els.jobStatus.classList.remove("error");
    }
    workConverseInFlight = true;
    let res;
    try {
      res = await api.invoke("work.converse", payload);
    } catch (err) {
      workExtraTurns = workExtraTurns.concat([
        {
          id: "dm_err_" + Date.now(),
          role: "digital_me",
          kind: "note",
          text: userFacingWorkError(err),
        },
      ]);
      renderWorkTimeline();
      if (els.jobStatus && els.jobStatus.textContent === "正在思考…") els.jobStatus.textContent = "";
      return;
    } finally {
      workConverseInFlight = false;
      if (els.workNlSend) els.workNlSend.disabled = false;
    }
    // 用持久化轮替换乐观轮
    workExtraTurns = workExtraTurns.filter((t) => t.id !== pendingId);
    persistedConversationTurns = persistedConversationTurns.concat(
      (res.newTurns || [])
        .filter((t) => t && t.content)
        .map((t) => ({
          id: t.turnId,
          role: t.role === "digital_me" ? "digital_me" : "user",
          kind: "message",
          text: String(t.content),
          createdAt: t.createdAt,
        })),
    );
    if (res.runtimePath) activeRuntimePath = String(res.runtimePath);
    if (res.createdTask && !activeTaskId) {
      // 首轮对话建立了理解任务（无 Job）；进入任务态，后续确认在同一 Task 上执行
      converseDraftTaskId = res.taskId;
      await selectTask(res.taskId);
    }
    if (res.plan) {
      activeTaskPlan = {
        version: res.plan.version,
        status: res.plan.status,
        content: res.plan.content,
        source: res.plan.source || "model",
      };
      clearPrepBlocked();
      refreshTaskWorkspace();
    } else if (res.planGenerationFailed) {
      activeTaskPlan = null;
      refreshTaskWorkspace();
    }
    renderWorkTimeline();
    if (res.degraded || res.needsClarification) {
      if (els.jobStatus && els.jobStatus.textContent === "正在思考…") els.jobStatus.textContent = "";
      return;
    }
    // 确定性效果（AI 只给结论；执行/暂停/采用均走既有确定性路径）
    // FIX-22：Owner 明确修订授权优先于「暂停自动修改」展示；暂停只拦系统自动修订
    if (res.pauseRequested && !(res.startAuthorized && res.startMode === "revision")) {
      taskPausedCto = true;
      refreshWorkUxView({ taskPaused: true });
      if (els.jobStatus && els.jobStatus.textContent === "正在思考…") els.jobStatus.textContent = "";
      return;
    }
    if (res.adoptRequested) {
      if (els.jobStatus && els.jobStatus.textContent === "正在思考…") els.jobStatus.textContent = "";
      await submitArtifactDecision("accept", { forceAdopt: true });
      return;
    }
    if (res.startAuthorized) {
      if (res.startMode === "revision" && activeTaskId && activeArtifactId) {
        // FIX-22：修订指令必须用 Owner 本轮原文，不得用规划正文顶替
        await runCtoConfirmContinue(text);
        return;
      }
      const execKind = String(res.executionIntentKind || "").trim();
      const execFamily = String(res.executionRequestedArtifactType || "").trim();
      if (!execKind || !execFamily) {
        if (els.jobStatus) {
          els.jobStatus.textContent = "这次还不能开始处理：还没有形成可用的执行判断。请再确认一次。";
          els.jobStatus.classList.remove("error");
        }
        return;
      }
      await startConversationTaskExecution(res.taskId, {
        fromPlanConfirm: true,
        intentKind: execKind,
        requestedArtifactType: execFamily,
      });
    }
    if (els.jobStatus && els.jobStatus.textContent === "正在思考…") els.jobStatus.textContent = "";
  }

  /**
   * 对话确认后的确定性执行入口：在同一理解任务上开始执行（不新建 Task）。
   * D11-B：确认明确规划版本；低风险自动附带执行授权，不再弹出三步技术确认卡。
   */
  async function startConversationTaskExecution(taskId, opts) {
    const options = opts || {};
    try {
      await refreshConnectionFromCapabilities();
      if (!canSubmit(lastConnectionState)) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        els.jobActionable.textContent = "前往设置连接真实模型后再开始处理。";
        refreshWorkUxView({ modelReady: false });
        return;
      }
      const goalFromUi =
        (els.goal && String(els.goal.value || "").trim()) ||
        (lastJobDetailForUx && lastJobDetailForUx.task && lastJobDetailForUx.task.goal) ||
        "";
      let goal = goalFromUi;
      let contextRefs = materials.map((m) => ({
        kind: m.kind,
        path: m.path,
        ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}),
      }));
      try {
        const bound = await api.invoke("work.getTask", { taskId });
        if (bound && bound.task) {
          if (String(bound.task.goal || "").trim()) goal = String(bound.task.goal).trim();
          const refs = Array.isArray(bound.task.contextRefs) ? bound.task.contextRefs : [];
          if (refs.some((r) => r && r.kind === "folder" && r.path)) {
            contextRefs = refs
              .filter((r) => r && (r.kind === "file" || r.kind === "folder") && r.path)
              .map((r) => ({
                kind: r.kind,
                path: r.path,
                ...(r.projectOrigin ? { projectOrigin: r.projectOrigin } : {}),
              }));
          }
        }
      } catch {
        /* 回落到界面当前材料 */
      }
      if (!goal) return;
      if (!contextRefs.some((r) => r.kind === "folder" || r.kind === "file")) {
        let taskRefs =
          lastJobDetailForUx && lastJobDetailForUx.task && lastJobDetailForUx.task.contextRefs;
        if (!Array.isArray(taskRefs) || !taskRefs.length) {
          try {
            const detail = await api.invoke("work.getTask", { taskId });
            taskRefs = detail && detail.task && detail.task.contextRefs;
          } catch {
            taskRefs = null;
          }
        }
        if (Array.isArray(taskRefs)) {
          contextRefs = taskRefs
            .filter((r) => r && (r.kind === "file" || r.kind === "folder") && r.path)
            .map((r) => ({
              kind: r.kind,
              path: r.path,
              ...(r.projectOrigin ? { projectOrigin: r.projectOrigin } : {}),
            }));
        }
      }
      const thin =
        isThinRuntimeActive() ||
        options.intentKind === "modify_code" ||
        options.requestedArtifactType === "code-change";
      const payload = {
        goal,
        contextRefs,
        existingTaskId: taskId,
      };
      if (options.confirmedPlanVersion != null) {
        payload.confirmedPlanVersion = options.confirmedPlanVersion;
      } else if (activeTaskPlan && activeTaskPlan.version != null) {
        payload.confirmedPlanVersion = activeTaskPlan.version;
      }
      if (options.executionAuthorization) {
        payload.executionAuthorization = options.executionAuthorization;
      }
      if (options.capabilityId) payload.capabilityId = options.capabilityId;
      if (options.intentKind) payload.intentKind = options.intentKind;
      if (options.requestedArtifactType) payload.requestedArtifactType = options.requestedArtifactType;
      if (!options.fromPlanConfirm && thin && !payload.intentKind) {
        payload.intentKind = "modify_code";
        payload.requestedArtifactType = "code-change";
      }
      const result = await api.invoke("work.submitTask", payload);
      await applySubmitTaskResult(result, payload, goal, {
        fromPlanConfirm: options.fromPlanConfirm === true,
      });
    } catch (err) {
      const msg = userFacingWorkError(err);
      els.jobStatus.textContent = msg;
      els.jobStatus.classList.add("error");
      if (String(err && err.code) === "plan_version_mismatch" || /规划已更新/.test(msg)) {
        try {
          const detail = await api.invoke("work.getTask", { taskId });
          hydratePlanFromTask(detail);
        } catch {
          /* ignore */
        }
      }
      refreshWorkUxView({});
    }
  }

  async function confirmPlanAndStartDevelopment() {
    const btn = els.startDevelopment;
    const prevLabel = btn ? String(btn.textContent || "") : "";
    if (els.jobStatus) {
      els.jobStatus.textContent = "已确认，正在开始…";
      els.jobStatus.classList.remove("error");
    }
    if (els.jobActionable) els.jobActionable.textContent = "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "正在开始…";
    }
    const taskId = activeTaskId || converseDraftTaskId;
    if (!taskId) {
      if (els.jobStatus) {
        els.jobStatus.textContent = "还没有可确认的方案。请先发送要做的事。";
        els.jobStatus.classList.add("error");
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "确认并开始";
      }
      return;
    }
    try {
      await submitWorkNaturalLanguage("确认");
    } catch (err) {
      if (els.jobStatus) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      }
    } finally {
      const started = !!(activeJobId || (lastJobDetailForUx && lastJobDetailForUx.latestJob));
      if (btn && !started) {
        btn.disabled = false;
        btn.textContent = prevLabel || "确认并开始";
      }
    }
  }

  function applyWorkUxChrome(extraFacts) {
    const ux = window.DigitalMeWorkUx;
    if (!ux || typeof ux.deriveWorkUxView !== "function") return null;
    const facts = collectWorkUxFacts(extraFacts);
    const view = ux.deriveWorkUxView(facts);
    const byId = WORK_UX_EL_BY_ID();
    const planned = new Map((view.actions || []).map((a) => [a.id, a]));

    // 每次先回到明确基线，再按当前 view 设置（避免跨 stage 残留 hidden/disabled）
    const seen = new Set();
    for (const el of Object.values(byId)) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      setElVisible(el, false);
      if (el.tagName === "BUTTON") el.disabled = false;
    }
    if (els.adoptContinueRevise) {
      setElVisible(els.adoptContinueRevise, false);
      els.adoptContinueRevise.disabled = false;
    }
    if (els.adoptAnyway) {
      setElVisible(els.adoptAnyway, false);
      els.adoptAnyway.disabled = false;
    }

    const moreHost = els.workMoreActions;
    if (moreHost) moreHost.innerHTML = "";
    let hasMore = false;

    // CTO 动作：独立代理按钮，避免与旧「继续修改」混用
    const ctoHost = els.decisionActions;
    if (ctoHost) {
      Array.from(ctoHost.querySelectorAll("[data-cto-action]")).forEach((n) => n.remove());
    }

    for (const action of view.actions || []) {
      if (action.id === "try_run") continue;

      if (
        action.id === "confirm_continue" ||
        action.id === "supplement_opinion" ||
        action.id === "pause_task"
      ) {
        const host =
          action.slot === "more" ? moreHost : ctoHost || moreHost;
        if (!host) continue;
        if (action.slot === "more") hasMore = true;
        const proxy = document.createElement("button");
        proxy.type = "button";
        proxy.className = action.slot === "primary" ? "primary" : "ghost";
        proxy.textContent = action.label || action.id;
        proxy.dataset.ctoAction = action.id;
        proxy.addEventListener("click", async () => {
          if (action.id === "pause_task") {
            taskPausedCto = true;
            hideRevisionComposer();
            hideAdoptWarning();
            if (els.jobStatus) els.jobStatus.textContent = "任务已暂停";
            if (activeJobId) {
              try {
                await api.invoke("work.cancelJob", { jobId: activeJobId });
              } catch {
                /* ignore */
              }
            }
            workExtraTurns = workExtraTurns.concat([
              {
                id: "dm_pause_btn_" + Date.now(),
                role: "digital_me",
                kind: "pause",
                text: "已暂停。你可以随时在对话区继续说明下一步。",
              },
            ]);
            refreshWorkUxView({ taskPaused: true });
            return;
          }
          if (action.id === "supplement_opinion") {
            taskPausedCto = false;
            focusWorkNaturalLanguageInput();
            return;
          }
          // confirm_continue：直接按 CTO 修正指令进入同任务下一轮
          await runCtoConfirmContinue("");
        });
        host.appendChild(proxy);
        continue;
      }

      const el = resolveWorkUxActionEl(action.id, facts, byId);
      if (!el) continue;
      if (action.label && el.tagName === "BUTTON") el.textContent = action.label;
      if (action.slot === "more") {
        hasMore = true;
        if (moreHost) {
          const proxy = document.createElement("button");
          proxy.type = "button";
          proxy.className = "ghost";
          proxy.textContent = action.label || el.textContent || action.id;
          proxy.dataset.workUxProxy = action.id;
          proxy.addEventListener("click", () => {
            if (typeof el.click === "function") el.click();
          });
          moreHost.appendChild(proxy);
        }
        setElVisible(el, false);
      } else {
        setElVisible(el, true);
        if (el.tagName === "BUTTON") el.disabled = false;
        if (action.slot === "primary") {
          el.classList.add("primary");
          el.classList.remove("ghost");
        } else {
          el.classList.remove("primary");
          if (!el.classList.contains("ghost")) el.classList.add("ghost");
        }
      }
    }

    setElVisible(els.workMoreMenu, false);

    if (els.cancel) {
      const showCancel = planned.has("cancel_job");
      setElVisible(els.cancel, showCancel);
      els.cancel.disabled = !showCancel;
    }
    if (els.retry) {
      const showRetry = planned.has("retry_job");
      setElVisible(els.retry, showRetry);
      els.retry.disabled = !showRetry || lastModelReady === false;
    }

    const reviewish =
      view.stage === "needs_review" ||
      view.stage === "needs_revision" ||
      (view.stage === "adopted" && facts.revisionComposerOpen);
    if (els.decisionBox && activeArtifactId && reviewish) {
      setElVisible(els.decisionBox, true);
    }
    if (els.decisionActions) {
      if (view.stage === "adopted" && !facts.revisionComposerOpen) {
        setElVisible(els.acceptArtifact, false);
        setElVisible(els.rejectArtifact, false);
      }
    }
    // 确认采用仅在中栏时间线；右栏成果区永不露出采用按钮
    if (els.acceptArtifact) {
      setElVisible(els.acceptArtifact, false);
      els.acceptArtifact.disabled = true;
    }
    if (els.rejectArtifact && planned.has("reject")) {
      els.rejectArtifact.disabled = false;
    }
    if (els.proposeRevision) {
      const showPropose =
        planned.has("propose_revision") ||
        (planned.has("continue_revise") && !facts.adoptWarningOpen) ||
        planned.has("tell_what_wrong");
      if (showPropose) {
        els.proposeRevision.disabled = false;
      }
    }

    if (els.decisionHint) {
      setElVisible(els.decisionHint, !view.hideDecisionHint && !!els.decisionHint.textContent);
    }
    if (els.ccRestoreHint) setElVisible(els.ccRestoreHint, false);
    if (els.ccRestoreRow) {
      setElVisible(els.ccRestoreRow, planned.has("restore_baseline"));
    }
    if (els.workAssistEntries) setElVisible(els.workAssistEntries, false);

    if (
      view.statusLine &&
      els.jobStatus &&
      (facts.prepBlocked || facts.projectCreateConfirm)
    ) {
      if (!els.jobStatus.textContent || /开始处理|需要代码执行|项目位置|确认|开发前/.test(els.jobStatus.textContent)) {
        els.jobStatus.textContent = view.statusLine;
      }
      if (els.jobActionable && /已检测|尚未检测|完成这项任务需要/.test(els.jobActionable.textContent || "")) {
        els.jobActionable.textContent = "";
      }
    }

    document.body.dataset.workUxStage = view.stage;
    applyThinOwnerSurface(view, facts);
    renderWorkTimeline();
    return view;
  }

  function applyThinOwnerSurface(view, facts) {
    if (!facts || !facts.thinRuntime || !els.jobStatus) return;
    const js = facts.jobStatus;
    let happening = "";
    let result = "";
    let needAct = "";
    if (view.stage === "drafting") {
      const composeEmpty =
        facts.workMode === "compose" &&
        !String((els.goal && els.goal.value) || "").trim();
      if (composeEmpty) {
        happening = "";
        result = "";
        needAct = "";
      } else {
        happening = facts.hasPlanDraft ? "已根据你的目标形成当前方案" : "正在理解你的目标";
        result = "还没有开始改项目";
        needAct = facts.hasPlanDraft ? "请确认方案后开始" : "请说明要做什么";
      }
    } else if (view.stage === "needs_input") {
      happening = "开始前还缺准备";
      result = "还没有开始";
      needAct = view.statusLine || "请按右侧说明补齐";
    } else if (view.stage === "needs_capability") {
      happening = "还不能开始处理";
      result = facts.modelReady === false ? "需要先连接模型" : "代码执行能力未就绪";
      needAct = facts.modelReady === false ? "请先连接模型" : "请先连接代码执行能力";
    } else if (view.stage === "needs_confirmation") {
      happening = "这项操作需要额外确认";
      result = "尚未开始";
      needAct = "请看右侧说明后再决定是否开始";
    } else if (view.stage === "running") {
      happening = "正在处理…";
      result = "";
      needAct = "";
    } else if (view.stage === "needs_review") {
      happening = facts.canAdoptSuggested === false ? "这一轮已经做完" : "已经完成修改并检查通过";
      result = facts.canAdoptSuggested === false ? "建议先看结论" : "";
      needAct = facts.canAdoptSuggested === false ? "如需调整，直接说明即可" : "如需调整，直接说明即可";
    } else if (view.stage === "needs_revision") {
      happening = "需要继续修改";
      result = facts.decisionStatus === "rejected" ? "这份成果未采用" : "还不能采用";
      needAct = "请在对话里说明下一步";
    } else if (view.stage === "adopted") {
      happening = "已采用这份成果";
      result = facts.canTryRun
        ? "可以试用"
        : facts.startupFailed
          ? "仍需修复才能正常使用"
          : "已采用";
      needAct = facts.canTryRun ? "可以试用，或继续修改" : "如需再改，直接说明即可";
    } else if (view.stage === "blocked") {
      happening = "没有做成";
      const existingReason = String((els.jobActionable && els.jobActionable.textContent) || "").trim();
      result =
        js === "cancelled"
          ? "已取消"
          : existingReason && !/^需要你：/.test(existingReason)
            ? existingReason
            : "执行失败";
      needAct = "请看对话里的原因和下一步，或重试";
    }
    if (!happening) return;
    els.jobStatus.textContent = happening + (result ? "。" + result : "");
    if (els.jobActionable) {
      els.jobActionable.textContent = needAct ? "需要你：" + needAct : "";
    }
  }

  function renderNextStepsCard() {
    if (!els.nextStepsCard || !els.nextStepsActions) return;
    const ux = window.DigitalMeWorkUx;
    const facts = collectWorkUxFacts({});
    const view = ux && ux.deriveWorkUxView ? ux.deriveWorkUxView(facts) : null;
    const runInfo = activeCodeChangeRunInfo;
    const canTry = !!(view && view.actions.some((a) => a.id === "try_run"));
    const primaryFix = !!(view && view.actions.some((a) => a.id === "continue_revise" && a.slot === "primary"));

    els.nextStepsCard.hidden = false;
    els.nextStepsCard.removeAttribute("hidden");
    if (els.nextStepsTitle) {
      els.nextStepsTitle.textContent = canTry
        ? "可以试用了"
        : primaryFix
          ? "还不能正常运行"
          : "已采用";
    }
    if (els.nextStepsLead) {
      els.nextStepsLead.textContent = canTry
        ? "可以试运行，或继续完善。"
        : primaryFix
          ? "建议先继续修复。"
          : "";
    }
    els.nextStepsActions.innerHTML = "";
    const addBtn = (label, primary, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.className = primary ? "primary" : "ghost";
      btn.addEventListener("click", onClick);
      els.nextStepsActions.appendChild(btn);
      return btn;
    };
    const planned = (view && view.actions) || [];
    const rightish = planned.filter(
      (a) =>
        a.id === "try_run" ||
        a.id === "continue_revise" ||
        a.id === "open_project" ||
        a.id === "tell_what_wrong",
    );
    const primary = rightish.find((a) => a.slot === "primary");
    const secondaries = rightish.filter((a) => a.slot === "secondary").slice(0, 2);
    const show = [primary, ...secondaries].filter(Boolean);
    for (const action of show) {
      addBtn(action.label, action.slot === "primary", async () => {
        if (action.id === "try_run") {
          if (!activeCodeChangeWorkingDirectory) return;
          if (els.nextStepsStatus) els.nextStepsStatus.textContent = "正在准备试运行…";
          try {
            if (typeof api.tryRunProject !== "function") {
              if (els.nextStepsStatus) {
                els.nextStepsStatus.textContent =
                  "当前环境无法自动打开程序。";
              }
              return;
            }
            const result = await api.tryRunProject({ path: activeCodeChangeWorkingDirectory });
            if (els.nextStepsStatus) {
              els.nextStepsStatus.textContent =
                (result && result.message) || "已发起试运行。";
            }
          } catch (err) {
            if (els.nextStepsStatus) els.nextStepsStatus.textContent = userFacingWorkError(err);
          }
          return;
        }
        if (action.id === "open_project") {
          if (!activeCodeChangeWorkingDirectory) return;
          try {
            await api.revealPath(activeCodeChangeWorkingDirectory);
          } catch (err) {
            if (els.nextStepsStatus) els.nextStepsStatus.textContent = userFacingWorkError(err);
          }
          return;
        }
        showRevisionComposer({ continueMode: true });
        if (els.revisionRequest && action.id === "tell_what_wrong") {
          els.revisionRequest.placeholder =
            "描述你看到的问题。也可粘贴截图。";
          els.revisionRequest.focus();
        }
      });
    }
    refreshWorkUxView({});
  }

  function applyJobControls(detail, connected) {
    lastJobDetailForUx = detail || lastJobDetailForUx;
    lastModelReady = connected !== false;
    const job = detail && detail.latestJob;
    const status = job && job.status;
    const view = refreshWorkUxView({
      jobStatus: status || null,
      jobCancelSupported: !!(job && (status === "queued" || status === "running")),
    });
    // 兼容：若派生不可用，回退旧逻辑
    if (!view) {
      els.cancel.disabled = !(job && (status === "queued" || status === "running"));
      els.retry.disabled =
        !connected || !(job && (status === "failed" || status === "cancelled"));
      if (els.submit) {
        const hideSubmit =
          workMode === "task" &&
          !!status &&
          (status === "succeeded" ||
            status === "failed" ||
            status === "cancelled" ||
            status === "running" ||
            status === "queued");
        setElVisible(els.submit, !hideSubmit);
      }
    }
  }

  async function syncActiveTaskStatus(eventNote, eventStatus) {
    if (!activeTaskId || workMode !== "task") return null;
    const detail = await api.invoke("work.getTask", { taskId: activeTaskId });
    activeJobId = detail.latestJob ? detail.latestJob.jobId : activeJobId;
    lastJobDetailForUx = detail;
    hydrateConversationFromTask(detail);
    renderJobStatus(detail, eventNote);
    renderOwnerChoicePrompt(detail);
    renderMaterialSummary(detail.materialSummary);
    const connected = await refreshConnectionFromCapabilities();

    if (isJobActive(detail)) {
      startJobWatch(activeTaskId);
      const rev =
        detail.latestJob && detail.latestJob.revisionRequest
          ? detail.latestJob.revisionRequest
          : "";
      showRevisionActiveBanner(rev);
      // running 不是 loading stage：清除「正在打开任务…」残留，仅用状态栏表达处理中
      hideArtifactLoading();
      if (!activeArtifactId) {
        if (els.artifactEmpty) {
          els.artifactEmpty.hidden = false;
          els.artifactEmpty.removeAttribute("hidden");
          els.artifactEmpty.textContent = "处理完成后将在这里显示成果。";
        }
        if (els.decisionBox) {
          els.decisionBox.hidden = true;
          els.decisionBox.setAttribute("hidden", "");
        }
      }
      els.jobStatus.textContent = "正在处理…";
      els.jobStatus.classList.remove("error");
      clearAppliedUnderstanding();
      applyJobControls(detail, connected);
      refreshTaskWorkspace();
      const runTitle = document.getElementById("tw-running-title");
      if (runTitle) runTitle.textContent = "正在处理…";
      const runProgress = document.getElementById("tw-running-progress");
      if (runProgress) runProgress.textContent = "正在处理…";
      if (els.artifactEmptyHint) {
        els.artifactEmptyHint.hidden = true;
        els.artifactEmptyHint.setAttribute("hidden", "");
      }
      if (els.artifactEmpty) {
        els.artifactEmpty.hidden = true;
        els.artifactEmpty.setAttribute("hidden", "");
      }
      refreshWorkUxView({});
    } else {
      stopJobWatch();
      hideRevisionActiveBanner();
      const terminalStatus = detail.latestJob && detail.latestJob.status;
      if (
        terminalStatus === "succeeded" &&
        detail.artifactIds &&
        detail.artifactIds[0] &&
        (!eventStatus || eventStatus === "succeeded")
      ) {
        copyBlockedFailed = false;
        const epoch = uiEpoch;
        const taskId = activeTaskId;
        await loadArtifact(detail.artifactIds[0], { taskId, epoch });
        if (epoch === uiEpoch && activeTaskId === taskId) {
          renderAppliedUnderstanding(detail.appliedUnderstanding);
        }
      } else if (terminalStatus === "failed" || terminalStatus === "cancelled") {
        /* keep failure chrome; do not resurrect unrelated artifacts */
        if (!activeArtifactId) showEmptyArtifact("这项任务尚未产生可用成果。");
        else hideArtifactLoading();
      } else {
        showEmptyArtifact("这项任务尚未产生成果。");
        clearAppliedUnderstanding();
      }
      // 必须在 artifact/job 事实落地后再派生，避免 running 覆盖 review
      applyJobControls(detail, connected);
      refreshWorkUxView({});
    }
    await refreshTasks();
    return detail;
  }

  async function selectTask(taskId) {
    const epoch = bumpUiEpoch();
    workMode = "task";
    activeTaskId = taskId;
    activeJobId = null;
    workExtraTurns = [];
    persistedConversationTurns = [];
    converseDraftTaskId = null;
    activeTaskPlan = null;
    activeRuntimePath = null;
    thinFailureExplainedJobId = null;
    prepBlockedState = null;
    taskPausedCto = false;
    lastCtoTimelineKey = "";
    activeArtifactVersionLabel = "";
    // 原子切换：立即清掉上一任务的中右栏与材料，避免串态
    materials = [];
    renderMaterials();
    clearMaterialSummary();
    pendingExecutionConfirm = null;
    pendingCreateProject = null;
    pendingCodingOnboarding = null;
    hideRevisionActiveBanner();
    clearJobChrome();
    resetArtifactProjection();
    els.jobStatus.textContent = "正在打开任务…";
    els.jobStatus.classList.remove("error");
    showArtifactLoading("正在打开任务…");
    if (els.workComposeTitle) els.workComposeTitle.textContent = "当前任务";
    updateTaskListItemLabel(taskId, "正在打开…");
    let detail;
    try {
      detail = await api.invoke("work.getTask", { taskId });
    } catch (err) {
      if (epoch !== uiEpoch || activeTaskId !== taskId) return;
      showEmptyArtifact("当前任务暂时无法加载，请从任务列表重新选择。");
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
      activeTaskId = null;
      workMode = "compose";
      await refreshTasks();
      return;
    }
    if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    lastJobDetailForUx = detail;
    activeJobId = detail.latestJob ? detail.latestJob.jobId : null;
    activeRuntimePath =
      detail.task && detail.task.meta && detail.task.meta.runtimePath
        ? String(detail.task.meta.runtimePath)
        : null;
    hydrateConversationFromTask(detail);
    els.goal.value = detail.task && detail.task.goal ? detail.task.goal : "";
    els.goal.readOnly = true;
    activeTaskRequestedArtifactType =
      (detail.task && detail.task.requestedArtifactType) ||
      ((detail.task && detail.task.intentKind) === "modify_code"
        ? "code-change"
        : (detail.task && detail.task.intentKind) === "analyze_code"
          ? "code-analysis"
          : "document");
    activeTaskIntentKind = (detail.task && detail.task.intentKind) || null;
    if (detail.userFacingLabel) {
      updateTaskListItemLabel(taskId, detail.userFacingLabel);
    }
    const readyArtifactId =
      (detail.artifactIds && detail.artifactIds[0]) ||
      (detail.latestJob && (detail.latestJob.artifactId || detail.latestJob.latestArtifactId)) ||
      null;
    if (
      readyArtifactId &&
      detail.latestJob &&
      String(detail.latestJob.status || "") === "succeeded"
    ) {
      copyBlockedFailed = false;
      await loadArtifact(readyArtifactId, { taskId, epoch });
      if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    }
    const refs =
      detail.task && Array.isArray(detail.task.contextRefs) ? detail.task.contextRefs : [];
    const nextMaterials = refs
      .filter((r) => r && (r.kind === "file" || r.kind === "folder") && r.path)
      .map((r) => ({ kind: r.kind, path: r.path, ...(r.projectOrigin ? { projectOrigin: r.projectOrigin } : {}) }));
    // 项目目录也可来自 Job（磁盘事实），避免仅因 contextRefs 瞬时空而显示「需要项目位置」
    if (
      !nextMaterials.some((m) => m.kind === "folder") &&
      detail.latestJob &&
      detail.latestJob.externalExecution &&
      detail.latestJob.externalExecution.workingDirectory
    ) {
      const ext = detail.latestJob.externalExecution;
      nextMaterials.unshift({
        kind: "folder",
        path: ext.workingDirectory,
        ...(ext.projectOrigin ? { projectOrigin: ext.projectOrigin } : {}),
      });
    }
    for (const item of nextMaterials) {
      if (item.kind !== "folder" || !item.path) continue;
      try {
        if (typeof api.inspectSoftwareProject === "function") {
          const inspected = await api.inspectSoftwareProject(item.path);
          if (epoch !== uiEpoch || activeTaskId !== taskId) return;
          item.softwareProject = inspected;
        }
      } catch {
        /* ignore */
      }
      if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    }
    if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    materials = nextMaterials;
    renderMaterials();
    renderJobStatus(detail);
    renderOwnerChoicePrompt(detail);
    renderMaterialSummary(detail.materialSummary);
    const connected = await refreshConnectionFromCapabilities();
    if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    applyJobControls(detail, connected);
    setWorkCollabVisible(true);
    syncGoalPresentation();

    if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    if (isJobActive(detail)) {
      startJobWatch(taskId);
      const rev =
        detail.latestJob && detail.latestJob.revisionRequest
          ? detail.latestJob.revisionRequest
          : "";
      showRevisionActiveBanner(rev);
      hideArtifactLoading();
      if (els.artifactEmpty) {
        els.artifactEmpty.hidden = true;
        els.artifactEmpty.setAttribute("hidden", "");
      }
      if (els.artifactEmptyHint) {
        els.artifactEmptyHint.hidden = true;
        els.artifactEmptyHint.setAttribute("hidden", "");
      }
      els.jobStatus.textContent = "正在处理…";
      clearAppliedUnderstanding();
      refreshTaskWorkspace();
      const runTitle = document.getElementById("tw-running-title");
      if (runTitle) runTitle.textContent = "正在处理…";
      const runProgress = document.getElementById("tw-running-progress");
      if (runProgress) runProgress.textContent = "正在处理…";
      refreshWorkUxView({});
    } else {
      stopJobWatch();
      hideRevisionActiveBanner();
      const readyArtifactId =
        (detail.artifactIds && detail.artifactIds[0]) ||
        (detail.latestJob && (detail.latestJob.artifactId || detail.latestJob.targetArtifactId)) ||
        null;
      if (readyArtifactId) {
        // 已有成果必须展示；后续修订 Job 失败不得宣称「尚未产生成果」
        // succeeded 时即使 Artifact ID 相同也要重载，以拿到新 headVersion / CTO
        copyBlockedFailed = false;
        await loadArtifact(readyArtifactId, { taskId, epoch });
        if (epoch === uiEpoch && activeTaskId === taskId) {
          renderAppliedUnderstanding(detail.appliedUnderstanding);
        }
      } else {
        if (epoch !== uiEpoch || activeTaskId !== taskId) return;
        showEmptyArtifact(
          detail.latestJob && detail.latestJob.status === "failed"
            ? "这项任务执行失败，尚未产生可确认的成果。"
            : "这项任务尚未产生成果。",
        );
        clearAppliedUnderstanding();
        refreshWorkUxView({});
      }
    }
    if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    await refreshTasks();
    if (epoch !== uiEpoch || activeTaskId !== taskId) return;
    await syncWorkCollabFromDomain();
  }

  async function loadArtifact(artifactId, opts) {
    const expectedTaskId =
      (opts && opts.taskId) || activeTaskId || null;
    const epoch = (opts && opts.epoch != null) ? opts.epoch : uiEpoch;
    if (!artifactId) {
      showEmptyArtifact("这项任务尚未产生成果。");
      return null;
    }
    let content;
    try {
      content = await api.invoke("artifact.getContent", {
        artifactId,
        ...(expectedTaskId ? { expectedTaskId } : {}),
      });
    } catch (err) {
      if (epoch !== uiEpoch) return null;
      showEmptyArtifact(userFacingWorkError(err) || "当前任务暂时无法加载成果。");
      return null;
    }
    if (epoch !== uiEpoch) return null;
    if (workMode !== "task") return null;
    if (expectedTaskId && activeTaskId && expectedTaskId !== activeTaskId) return null;
    if (content.artifactTaskId && activeTaskId && content.artifactTaskId !== activeTaskId) {
      return null;
    }
    if (content.artifact && content.artifact.taskId && activeTaskId && content.artifact.taskId !== activeTaskId) {
      return null;
    }
    hideArtifactLoading();
    resetArtifactProjection();
    const rawArtifactType =
      (content.artifact && content.artifact.requestedArtifactType) ||
      (content.artifact && content.artifact.artifactType) ||
      activeTaskRequestedArtifactType ||
      "document";
    const artifactTypeFromContent = sanitizeArtifactTypeForTask(
      activeTaskIntentKind,
      rawArtifactType,
    );
    const projection = resolveArtifactProjection({
      taskIntent: activeTaskIntentKind,
      artifactType: artifactTypeFromContent,
      artifactKind: content.artifact && content.artifact.kind,
      artifactContent: content,
    });
    activeArtifactProjectionKind = projection.kind;
    lastArtifactProjectionDiagnostic = {
      taskId: activeTaskId,
      artifactId,
      taskIntent: activeTaskIntentKind,
      requestedArtifactType: activeTaskRequestedArtifactType,
      artifactType: artifactTypeFromContent,
      hasCodeChangeMeta: !!content.codeChange,
      projectionKind: projection.kind,
      contradiction: !!projection.contradiction,
      codeChangeDomId: "code-change-view",
    };
    logArtifactProjectionDiagnostic(lastArtifactProjectionDiagnostic);
    const isCodeChange = projection.kind === "code-change";
    const isBundle = projection.kind === "bundle" || projection.kind === "code-change";
    let blockAcceptForStaleDir = false;
    activeArtifactId = artifactId;
    activeHeadVersionId = content.headVersionId || null;
    activeArtifactVersionLabel =
      content.versionCount != null ? `版本 ${content.versionCount}` : "当前版本";
    copyBlockedFailed = false;
    if (els.artifactEmpty) {
      els.artifactEmpty.hidden = true;
      els.artifactEmpty.setAttribute("hidden", "");
    }
    if (els.artifactEmptyHint) {
      els.artifactEmptyHint.hidden = true;
      els.artifactEmptyHint.setAttribute("hidden", "");
    }
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

    if (isBundle || isCodeChange) {
      activeArtifactKind = isCodeChange ? "code-change" : "bundle";
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

      if (isCodeChange) {
        if (els.bundleView) {
          els.bundleView.hidden = true;
          els.bundleView.setAttribute("hidden", "");
        }
        renderCodeChangeView(content.codeChange);
      } else {
        hideCodeChangeView();
        els.bundleView.hidden = false;
        els.bundleView.removeAttribute("hidden");
      }
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
      hideRevisionComposer();
      if (els.proposeRevision) {
        els.proposeRevision.hidden = false;
        els.proposeRevision.removeAttribute("hidden");
        const st =
          content.ownerDecision && content.ownerDecision.status
            ? content.ownerDecision.status
            : "undecided";
        els.proposeRevision.textContent =
          st === "accepted" || st === "rejected" ? "继续修改" : "提出修改";
      }
      if (els.revise) {
        els.revise.textContent = "提交修改";
      }
      // 仅软件 code-change 投影才露出项目/恢复动作
      if (els.restoreBaseline) {
        const showRestore = isCodeChange && !!(content.codeChange && content.codeChange.workingDirectory);
        els.restoreBaseline.hidden = !showRestore;
        if (showRestore) els.restoreBaseline.removeAttribute("hidden");
        else els.restoreBaseline.setAttribute("hidden", "");
      }
      if (els.openProjectFolder) {
        const showOpen = isCodeChange && !!(content.codeChange && content.codeChange.workingDirectory);
        els.openProjectFolder.hidden = !showOpen;
        if (showOpen) els.openProjectFolder.removeAttribute("hidden");
        else els.openProjectFolder.setAttribute("hidden", "");
      }
      if (isCodeChange && content.codeChange && content.codeChange.directoryChangedSinceResult) {
        els.jobActionable.textContent =
          "当前项目已与待验收结果不同。请重新核对后再采用，或先恢复执行前状态。";
        blockAcceptForStaleDir = true;
        if (els.acceptArtifact) els.acceptArtifact.disabled = true;
      }
      suppressSave = true;
      if (els.bundleReport && !isCodeChange) {
        if ("value" in els.bundleReport) els.bundleReport.value = content.text || "";
        else els.bundleReport.textContent = content.text || "";
      }
      suppressSave = false;
      if (els.bundleStaleNotice) {
        if (content.evidenceStale && !isCodeChange) {
          els.bundleStaleNotice.hidden = false;
          els.bundleStaleNotice.removeAttribute("hidden");
        } else {
          els.bundleStaleNotice.hidden = true;
          els.bundleStaleNotice.setAttribute("hidden", "");
        }
      }
      if (els.bundleQuality && !isCodeChange) {
        if (qualityUi.showBanner && qualityUi.bannerText) {
          els.bundleQuality.hidden = false;
          els.bundleQuality.textContent = qualityUi.bannerText;
          els.bundleQuality.className = qualityUi.className || "bundle-quality";
        } else {
          els.bundleQuality.hidden = true;
        }
      }
      if (!isCodeChange) {
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
      }
      els.exportMd.hidden = true;
      els.exportDocx.hidden = true;
      els.reveal.hidden = false;
      els.saveStatus.textContent = isCodeChange
        ? content.codeChange.verificationLabel || "已载入修改结果"
        : content.evidenceStale
          ? "报告为人工编辑；依据未同步更新"
          : qualityUi.saveStatus;
      const connected = await refreshConnectionFromCapabilities();
      els.revise.disabled = !connected;
    } else {
      activeArtifactKind = "document";
      activeArtifactProjectionKind = "document";
      lastQualityGrade = null;
      lastQualityBannerText = "";
      hideCodeChangeView();
      if (els.bundleStaleNotice) {
        els.bundleStaleNotice.hidden = true;
        els.bundleStaleNotice.setAttribute("hidden", "");
      }
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
      els.artifactEditor.hidden = false;
      els.artifactEditor.removeAttribute("hidden");
      hideRevisionComposer();
      if (els.proposeRevision) {
        els.proposeRevision.hidden = false;
        els.proposeRevision.removeAttribute("hidden");
        const st =
          content.ownerDecision && content.ownerDecision.status
            ? content.ownerDecision.status
            : "undecided";
        els.proposeRevision.textContent =
          st === "accepted" || st === "rejected" ? "继续修改" : "提出修改";
      }
      if (els.revise) els.revise.textContent = "提交修改";
      els.exportMd.hidden = false;
      els.exportMd.removeAttribute("hidden");
      els.exportDocx.hidden = false;
      els.exportDocx.removeAttribute("hidden");
      els.reveal.hidden = false;
      els.reveal.removeAttribute("hidden");
      suppressSave = true;
      els.artifactEditor.value = content.text || "";
      suppressSave = false;
      els.saveStatus.textContent = "已载入最新内容";
      const connected = await refreshConnectionFromCapabilities();
      els.revise.disabled = !connected;
    }
    activeAcceptanceSummary =
      content.acceptanceSummary ||
      (content.codeChange && content.codeChange.acceptanceSummary) ||
      null;
    activeAcceptanceFailed = content.acceptanceStatus === "failed";
    activeAcceptanceFailureMessage = String(content.acceptanceFailureMessage || "");
    // 右栏永不启用确认采用；采用仅经中栏时间线
    if (els.acceptArtifact) {
      setElVisible(els.acceptArtifact, false);
      els.acceptArtifact.disabled = true;
    }
    if (els.rejectArtifact) els.rejectArtifact.disabled = false;
    hideArtifactLoading();
    refreshTaskWorkspace();
    refreshWorkUxView({});
    if (els.acceptArtifact) {
      setElVisible(els.acceptArtifact, false);
      els.acceptArtifact.disabled = true;
    }
    await syncWorkCollabFromDomain();
  }

  async function enterWorkWithGrowthContext(goalText) {
    let materialsForTask = [];
    try {
      const overview = await api.invoke("subject.getOverview", {});
      materialsForTask = (overview.materials || [])
        .filter((m) => m && m.absolutePath)
        .map((m) => ({ kind: "file", path: m.absolutePath }));
    } catch {
      materialsForTask = [];
    }
    await setNav("work");
    startNewTaskComposer({
      goal: goalText || "",
      materials: materialsForTask,
    });
  }

  async function handleGrowthContinueTask(item) {
    if (!item || !item.taskId) return;
    await setNav("work");
    await selectTask(item.taskId);
  }

  function lastUserTurnIndex(turns) {
    for (let i = (turns || []).length - 1; i >= 0; i -= 1) {
      if (turns[i] && turns[i].role === "user") return i;
    }
    return -1;
  }

  function unansweredAssistantContains(turns, questionText) {
    const q = String(questionText || "").trim();
    if (!q) return false;
    const start = lastUserTurnIndex(turns) + 1;
    for (let i = start; i < turns.length; i += 1) {
      if (turns[i] && turns[i].role === "assistant" && String(turns[i].text || "").includes(q)) {
        return true;
      }
    }
    return false;
  }

  function isInternalChatContextPhrase(value) {
    return /本次成果未采用|本次成果已采用|尚未决定|修补采用内容|建议采用|建议继续修改|可试用|开发中|\bcapture\b|\bfreeze\b|\bevent\b|GrowthEvent|Package|Artifact/i.test(
      String(value || ""),
    );
  }

  function isEphemeralChatIntent(value) {
    return /不要记住这段|别记住这段|别记这段|不要记住这个|不要把这段记下来|这件事不要长期记录|不要长期记录|不要长期了解|这次不要记住|不要记录这段/.test(
      String(value || "").trim(),
    );
  }

  /** 引导期间判断用户是否提出了与引导无关的新问题（含明确提问句式，中英）。 */
  function looksLikeNewQuestion(value) {
    const t = String(value || "").trim();
    if (!t) return false;
    if (/[?？]$/.test(t)) return true;
    if (/^(请|帮我|推荐|请问|什么是|怎么|为什么|如何|能否|可以吗|介绍一下|解释|说明|建议)/.test(t)) return true;
    return /^(please|recommend|suggest|what|how|why|when|where|can|could|should|explain|describe|tell me)/i.test(
      t,
    );
  }

  function setGuideControlsVisible(visible) {
    const actions = document.getElementById("growth-guide-actions");
    if (actions) {
      actions.hidden = !visible;
      if (visible) actions.removeAttribute("hidden");
      else actions.setAttribute("hidden", "");
    }
  }

  /** 对话引导模式：仅 renderer 内存运行态。normal 不显示成长控件、不带强制追问指令。 */
  function setChatGuideMode(mode) {
    chatGuideMode = mode === "growth_guided" ? "growth_guided" : "normal";
    if (chatGuideMode !== "growth_guided") setGuideControlsVisible(false);
  }

  function isLiveChatGeneration(generation) {
    return generation === chatGeneration;
  }

  function resetChatComposer() {
    lastChatUserText = "";
    lastChatReplyFailed = false;
    setGuideControlsVisible(false);
    const live = document.getElementById("chat-input");
    if (live) els.chatInput = live;
    if (els.chatSend) els.chatSend.disabled = false;
    if (els.chatRetry) {
      els.chatRetry.disabled = false;
      els.chatRetry.hidden = true;
      els.chatRetry.setAttribute("hidden", "");
    }
    if (els.chatInput) {
      els.chatInput.disabled = false;
      els.chatInput.readOnly = false;
      els.chatInput.removeAttribute("disabled");
      els.chatInput.removeAttribute("readonly");
    }
  }

  function showGrowthSubjectView(view, options) {
    const next = view === "situation" || view === "other" || view === "understanding" ? view : "home";
    const home = document.getElementById("growth-home");
    const situation = document.getElementById("growth-situation");
    const other = document.getElementById("growth-other-ways");
    const understanding = document.getElementById("growth-understanding");
    const panel = els.panelSubject;
    if (growthSubjectView === "home" && next !== "home" && panel) {
      growthHomeScroll = panel.scrollTop || 0;
    }
    growthSubjectView = next;
    if (home) {
      home.hidden = next !== "home";
      if (next === "home") home.removeAttribute("hidden");
      else home.setAttribute("hidden", "");
    }
    if (situation) {
      situation.hidden = next !== "situation";
      if (next === "situation") situation.removeAttribute("hidden");
      else situation.setAttribute("hidden", "");
    }
    if (other) {
      other.hidden = next !== "other";
      if (next === "other") other.removeAttribute("hidden");
      else other.setAttribute("hidden", "");
    }
    if (understanding) {
      understanding.hidden = next !== "understanding";
      if (next === "understanding") understanding.removeAttribute("hidden");
      else understanding.setAttribute("hidden", "");
    }
    if (!panel) return;
    if (next === "home") {
      panel.scrollTop = options && options.resetScroll ? 0 : growthHomeScroll;
    } else {
      panel.scrollTop = 0;
    }
  }

  function resolveGuidedQuestion(preferredKey) {
    const snapshot = lastGrowthSnapshot || {};
    const cockpitGaps = (snapshot.cockpit && snapshot.cockpit.gaps) || [];
    if (preferredKey) {
      const hit = cockpitGaps.find((item) => item.dimensionKey === preferredKey);
      if (hit && hit.question) {
        return { dimensionKey: preferredKey, text: String(hit.question) };
      }
      const groups = snapshot.dimensionGroups || {};
      const all = [].concat(groups.unknown || [], groups.partial || [], groups.known || []);
      const named = all.find((item) => item.key === preferredKey);
      if (named && snapshot.guidedQuestion && snapshot.guidedQuestion.dimensionKey === preferredKey) {
        return snapshot.guidedQuestion;
      }
    }
    if (snapshot.guidedQuestion && snapshot.guidedQuestion.text) return snapshot.guidedQuestion;
    return {
      dimensionKey: "identity",
      text: "方便的话，可以怎么称呼你，或者你希望我怎样认识你？",
    };
  }

  async function continueUnderstandingMe(preferredKey) {
    const generation = chatGeneration;
    setChatGuideMode("growth_guided");
    const question = resolveGuidedQuestion(preferredKey);
    await setNav("chat");
    if (!isLiveChatGeneration(generation)) return;
    if (!api.conversation || typeof api.conversation.append !== "function") return;
    let turns = [];
    try {
      const listed = await api.conversation.list();
      turns = (listed && listed.turns) || [];
    } catch {
      turns = [];
    }
    if (!isLiveChatGeneration(generation)) return;
    if (!unansweredAssistantContains(turns, question.text)) {
      await api.conversation.append({ role: "assistant", text: question.text });
    }
    if (!isLiveChatGeneration(generation)) return;
    await refreshChatPanel();
    if (!isLiveChatGeneration(generation)) return;
    setGuideControlsVisible(true);
  }

  async function handleGuideChoice(action) {
    const generation = chatGeneration;
    const question = lastGrowthSnapshot && lastGrowthSnapshot.guidedQuestion;
    const dimension = (question && question.dimensionKey) || "identity";
    const previousText = question && question.text ? String(question.text) : "";
    const choice = action === "later" ? "later" : "switch";
    try {
      await api.invoke("subject.captureInput", {
        text: choice,
        sourceKind: "conversation",
        captureKey: "growth:guide_choice:" + dimension + ":" + choice,
      });
    } catch {
      /* 选择失败不得阻断对话 */
    }
    if (!isLiveChatGeneration(generation)) return;
    await refreshSubjectPanel();
    if (!isLiveChatGeneration(generation)) return;
    const next = lastGrowthSnapshot && lastGrowthSnapshot.guidedQuestion;
    if (choice === "later") {
      // 稍后再聊这个：结束本次引导，回到 normal；回复简短即可。
      setChatGuideMode("normal");
      if (api.conversation && typeof api.conversation.append === "function") {
        await api.conversation.append({ role: "assistant", text: "好的，随时可以继续。" });
      }
      if (!isLiveChatGeneration(generation)) return;
      await setNav("chat");
      if (!isLiveChatGeneration(generation)) return;
      await refreshChatPanel();
      return;
    }
    // 换一个问题：保持 growth_guided 并更换问题。
    const ack = "好，换一个问题。";
    let text = ack;
    if (next && next.text && String(next.text) !== previousText) {
      text = ack + "\n\n" + String(next.text);
    }
    if (api.conversation && typeof api.conversation.append === "function") {
      await api.conversation.append({ role: "assistant", text });
    }
    if (!isLiveChatGeneration(generation)) return;
    await setNav("chat");
    if (!isLiveChatGeneration(generation)) return;
    await refreshChatPanel();
    if (!isLiveChatGeneration(generation)) return;
    setGuideControlsVisible(!!(next && next.text));
  }

  async function handleGrowthTask(task) {
    const key = task && task.key;
    if (key === "continue_conversation") {
      await continueUnderstandingMe();
      return;
    }
    if (key === "add_representative_material") {
      const importBtn = document.getElementById("btn-import-subject-material");
      if (importBtn) importBtn.click();
      return;
    }
    if (key === "answer_short_form") {
      showGrowthSubjectView("other");
      const input = document.getElementById("subject-more");
      if (input) input.focus();
      return;
    }
    if (key === "optional_learn_from_work") {
      await setNav("work");
      startNewTaskComposer({});
      return;
    }
    if (key === "resolve_important_conflict") {
      await continueUnderstandingMe();
    }
  }

  async function continueGrowthConversation() {
    await continueUnderstandingMe();
  }

  function renderUnderstandingList(items) {
    const list = els.growthUnderstandingList;
    if (!list) return;
    list.innerHTML = "";
    const itemsArr = items || [];
    if (els.growthUnderstandingEmpty) {
      els.growthUnderstandingEmpty.hidden = itemsArr.length > 0;
    }
    for (const item of itemsArr) {
      const li = document.createElement("li");
      const textNode = document.createElement("div");
      textNode.className = "subject-item-text";
      textNode.textContent = String(item.text || "");
      const actions = document.createElement("div");
      actions.className = "subject-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost";
      editBtn.textContent = "修改";
      editBtn.addEventListener("click", () => {
        openInlineEdit(li, textNode, actions, item);
      });
      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "ghost";
      stopBtn.textContent = "停止使用";
      stopBtn.addEventListener("click", async () => {
        try {
          await api.invoke("subject.respondToLearning", {
            eventId: item.eventId,
            action: "retire",
          });
          setUnderstandingStatus("已停止使用这条。");
          await refreshSubjectPanel();
        } catch (err) {
          setUnderstandingStatus((err && err.message) || "操作失败，请重试。");
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(stopBtn);
      li.appendChild(textNode);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  function openInlineEdit(li, textNode, actions, item) {
    textNode.style.display = "none";
    actions.style.display = "none";
    const box = document.createElement("div");
    box.className = "subject-edit-box";
    const input = document.createElement("textarea");
    input.className = "subject-edit-input";
    input.value = String(item.text || "");
    input.rows = 2;
    const btnRow = document.createElement("div");
    btnRow.className = "subject-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary";
    save.textContent = "保存";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = "取消";
    btnRow.appendChild(save);
    btnRow.appendChild(cancel);
    box.appendChild(input);
    box.appendChild(btnRow);
    li.appendChild(box);
    input.focus();
    save.addEventListener("click", async () => {
      const next = String(input.value || "").trim();
      if (!next) {
        setUnderstandingStatus("请写出更准确的说法。");
        return;
      }
      try {
        await api.invoke("subject.respondToLearning", {
          eventId: item.eventId,
          action: "revise",
          revisionText: next,
        });
        setUnderstandingStatus("已更新。");
        await refreshSubjectPanel();
      } catch (err) {
        setUnderstandingStatus((err && err.message) || "更新失败，请重试。");
      }
    });
    cancel.addEventListener("click", () => {
      box.remove();
      textNode.style.display = "";
      actions.style.display = "";
    });
  }

  function setUnderstandingStatus(text) {
    if (els.growthUnderstandingStatus) {
      els.growthUnderstandingStatus.textContent = String(text || "");
    }
  }

  async function refreshSubjectPanel() {
    const overview = await api.invoke("subject.getOverview", {});
    lastGrowthSnapshot = overview.growth || null;
    try {
      if (window.DigitalMeGrowthPanel) {
        window.DigitalMeGrowthPanel.render(document, lastGrowthSnapshot, {
          onTask: (task) => {
            void handleGrowthTask(task);
          },
          onContinueTask: (item) => {
            void handleGrowthContinueTask(item);
          },
          onGap: (item) => {
            void continueUnderstandingMe(item && item.dimensionKey);
          },
          onViewSituation: () => {
            showGrowthSubjectView("situation");
          },
          onViewMaterials: () => {
            showGrowthSubjectView("other");
            const list = document.getElementById("subject-material-list");
            if (list && list.scrollIntoView) list.scrollIntoView({ block: "nearest" });
          },
        });
      }
    } catch {
      /* 成长区块失败不得影响数字之我主列表 */
    }
    const brief =
      (overview.userVisibleFacts &&
        overview.userVisibleFacts[0] &&
        overview.userVisibleFacts[0].text) ||
      (overview.activeUnderstandings &&
        overview.activeUnderstandings[0] &&
        overview.activeUnderstandings[0].text) ||
      overview.summaryLine ||
      overview.displayName ||
      "";
    els.subjectBrief.textContent = brief;

    // 「它目前了解的我」：只展示当前有效、用户可理解的少量高价值条目（userVisibleFacts 已裁剪）。
    const understandItems = overview.userVisibleFacts || [];
    renderUnderstandingList(understandItems);

    // 01B：「已经了解」必须与对话模型上下文共用 userVisibleFacts（具体事实及其具体值）。
    const items = overview.userVisibleFacts || overview.activeUnderstandings || [];
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

    if (els.subjectLearnedList && els.subjectLearnedEmpty) {
      const learned = overview.recentConfirmedLearnings || [];
      els.subjectLearnedList.innerHTML = "";
      els.subjectLearnedEmpty.hidden = learned.length > 0;
      for (const item of learned) {
        const li = document.createElement("li");
        li.innerHTML = `<div class="subject-item-text">${escapeHtml(item.text)}</div>`;
        els.subjectLearnedList.appendChild(li);
      }
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
      // 01B：可参考已确认内容 = 与「已经了解」/模型上下文同一 userVisibleFacts 投影源。
      const knownPoints = (overview.userVisibleFacts || overview.activeUnderstandings || [])
        .map((c) => (c && c.text ? String(c.text).trim() : ""))
        .filter((text) => text && !isInternalChatContextPhrase(text))
        .slice(0, 3);
      if (els.chatContext) {
        if (knownPoints.length) {
          els.chatContext.hidden = false;
          els.chatContext.textContent = "可参考已确认内容：" + knownPoints.join("；");
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
    const pendingQuestion =
      chatGuideMode === "growth_guided" &&
      lastGrowthSnapshot &&
      lastGrowthSnapshot.guidedQuestion &&
      lastGrowthSnapshot.guidedQuestion.text;
    setGuideControlsVisible(!!pendingQuestion && unansweredAssistantContains(turns, pendingQuestion));
  }

  async function restoreLatestOpenTaskIfAny() {
    try {
      const listed = await api.invoke("work.listTasks", { limit: 50 });
      const tasks = (listed && listed.tasks) || [];
      if (!tasks.length) return false;
      let chosen = tasks[0];
      for (const t of tasks) {
        const label = String(t.userFacingLabel || "");
        if (/尚未决定|建议采用|已采用|未采用|可试用|开发中|修订/.test(label)) {
          chosen = t;
          break;
        }
      }
      if (!chosen || !chosen.taskId) return false;
      await selectTask(chosen.taskId);
      return true;
    } catch {
      return false;
    }
  }

  async function enterShell() {
    setView("shell");
    await refreshConnectionFromCapabilities();
    await refreshTasks();
    await refreshSubjectPanel();
    const restored = await restoreLatestOpenTaskIfAny();
    if (restored) {
      await setNav("work");
      return;
    }
    startNewTaskComposer({ preservePending: true });
    await restorePendingSoftwareDraftIfAny();
    await setNav("chat");
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

  if (els.navChat) els.navChat.addEventListener("click", () => {
    setChatGuideMode("normal");
    setNav("chat");
  });
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
      startNewTaskComposer();
    });
  }

  if (els.chatSend) {
    els.chatSend.addEventListener("click", async () => {
      let generation = chatGeneration;
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
        generation = chatGeneration;
        els.chatSend.disabled = true;
        if (els.chatRetry) {
          els.chatRetry.hidden = true;
          els.chatRetry.setAttribute("hidden", "");
        }
        const guideActions = document.getElementById("growth-guide-actions");
        if (guideActions) {
          guideActions.hidden = true;
          guideActions.setAttribute("hidden", "");
        }
        const skipGrowthCapture = isEphemeralChatIntent(text);
        setGuideControlsVisible(false);
        // 引导期间提出新的无关问题时：优先回答新问题，自动回到 normal，不再追加成长问题。
        if (chatGuideMode === "growth_guided" && looksLikeNewQuestion(text)) {
          setChatGuideMode("normal");
        }
        lastChatReplyFailed = false;
        if (els.chatStatus) els.chatStatus.textContent = "正在发送…";
        const guided = lastGrowthSnapshot && lastGrowthSnapshot.guidedQuestion;
        const guideMode = chatGuideMode;
        await api.conversation.append({
          role: "user",
          text,
          skipGrowthCapture,
          ...(guideMode === "growth_guided" && guided && guided.dimensionKey
            ? { guideDimension: guided.dimensionKey }
            : {}),
        });
        if (!isLiveChatGeneration(generation)) return;
        lastChatUserText = text;
        if (els.chatInput) els.chatInput.value = "";
        await refreshChatPanel();
        if (!isLiveChatGeneration(generation)) return;

        if (els.chatStatus) els.chatStatus.textContent = "正在回复…";
        let replyText = "";
        let replyStatus = "complete";
        let userTurnId = null;
        try {
          const replied = await api.conversation.reply({ text, skipGrowthCapture, guideMode });
          if (!isLiveChatGeneration(generation)) return;
          replyText = String((replied && replied.text) || "").trim();
          replyStatus = String((replied && replied.status) || "complete");
          userTurnId = replied && replied.userTurnId ? String(replied.userTurnId) : null;
        } catch (err) {
          if (!isLiveChatGeneration(generation)) return;
          lastChatReplyFailed = true;
          if (els.chatStatus) {
            els.chatStatus.textContent = userFacingChatError(err);
          }
          if (els.chatRetry) {
            els.chatRetry.hidden = false;
            els.chatRetry.removeAttribute("hidden");
          }
          await refreshChatPanel();
          return;
        }
        if (!isLiveChatGeneration(generation) || replyStatus === "cancelled") return;
        // 不完整：可落盘部分正文；空正文也不得伪装「已回复」
        if (replyStatus === "incomplete") {
          lastChatReplyFailed = true;
          if (replyText) {
            await api.conversation.append({ role: "assistant", text: replyText });
            if (!isLiveChatGeneration(generation)) return;
            await refreshChatPanel();
          }
          if (!isLiveChatGeneration(generation)) return;
          if (els.chatStatus) els.chatStatus.textContent = "回复未完成，可重试";
          if (els.chatRetry) {
            els.chatRetry.hidden = false;
            els.chatRetry.removeAttribute("hidden");
          }
          return;
        }
        if (!replyText || replyStatus === "failed") {
          lastChatReplyFailed = true;
          // 01B：unsupported inference 被拦截时不得显示违规正文为成功。
          const blockedReason = String((replied && replied.finishReason) || "");
          if (els.chatStatus) {
            els.chatStatus.textContent =
              blockedReason === "unsupported_inference"
                ? "回复包含未能从你的信息中确认的推断，已停止展示，请换个说法重试。"
                : "无法回复，请重试";
          }
          if (els.chatRetry) {
            els.chatRetry.hidden = false;
            els.chatRetry.removeAttribute("hidden");
          }
          return;
        }
        await api.conversation.append({ role: "assistant", text: replyText });
        if (!isLiveChatGeneration(generation)) return;
        await refreshChatPanel();
        if (!isLiveChatGeneration(generation)) return;
        lastChatReplyFailed = false;
        if (els.chatStatus) els.chatStatus.textContent = "已回复。";
        // 成长由主进程调度；此处仅在失败耗尽后展示克制提示（不暴露内部状态名）
        if (userTurnId && api.conversation.growthHint) {
          setTimeout(async () => {
            if (!isLiveChatGeneration(generation)) return;
            try {
              const hint = await api.conversation.growthHint({ turnId: userTurnId });
              if (!isLiveChatGeneration(generation)) return;
              if (hint && hint.message && els.chatStatus && !lastChatReplyFailed) {
                els.chatStatus.textContent = `已回复。${hint.message}`;
              }
            } catch {
              /* ignore */
            }
          }, 2500);
        }
      } catch (err) {
        if (!isLiveChatGeneration(generation)) return;
        lastChatReplyFailed = true;
        if (els.chatStatus) els.chatStatus.textContent = userFacingChatError(err);
        if (els.chatRetry) {
          els.chatRetry.hidden = false;
          els.chatRetry.removeAttribute("hidden");
        }
      } finally {
        if (!isLiveChatGeneration(generation)) return;
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
      const generation = chatGeneration;
      els.chatRetry.disabled = true;
      if (els.chatSend) els.chatSend.disabled = true;
      if (els.chatStatus) els.chatStatus.textContent = "正在回复…";
      try {
        // 重试：不重复写入用户消息，不重复成长采集
        const replied = await api.conversation.reply({ text, guideMode: chatGuideMode });
        if (!isLiveChatGeneration(generation) || String((replied && replied.status) || "") === "cancelled") {
          return;
        }
        const replyText = String((replied && replied.text) || "").trim();
        const replyStatus = String((replied && replied.status) || "complete");
        if (replyStatus === "incomplete") {
          lastChatReplyFailed = true;
          if (replyText) {
            await api.conversation.append({ role: "assistant", text: replyText });
            if (!isLiveChatGeneration(generation)) return;
            await refreshChatPanel();
          }
          if (!isLiveChatGeneration(generation)) return;
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
        if (!isLiveChatGeneration(generation)) return;
        await refreshChatPanel();
        if (!isLiveChatGeneration(generation)) return;
        lastChatReplyFailed = false;
        els.chatRetry.hidden = true;
        els.chatRetry.setAttribute("hidden", "");
        if (els.chatStatus) els.chatStatus.textContent = "已回复。";
      } catch (err) {
        if (!isLiveChatGeneration(generation)) return;
        lastChatReplyFailed = true;
        if (els.chatStatus) {
          els.chatStatus.textContent = userFacingChatError(err);
        }
        els.chatRetry.hidden = false;
        els.chatRetry.removeAttribute("hidden");
      } finally {
        if (!isLiveChatGeneration(generation)) return;
        els.chatRetry.disabled = false;
        if (els.chatSend) els.chatSend.disabled = false;
      }
    });
  }

  function setClearConfirmVisible(visible) {
    if (els.chatClearConfirm) {
      els.chatClearConfirm.hidden = !visible;
      if (visible) els.chatClearConfirm.removeAttribute("hidden");
      else els.chatClearConfirm.setAttribute("hidden", "");
    }
  }

  async function performClearConversation() {
    setClearConfirmVisible(false);
    const generation = ++chatGeneration;
    setChatGuideMode("normal");
    resetChatComposer();
    if (els.chatStatus) els.chatStatus.textContent = "对话已清空。";
    try {
      if (!api.conversation || typeof api.conversation.clear !== "function") {
        throw new Error("对话功能不可用");
      }
      await api.conversation.clear();
      if (!isLiveChatGeneration(generation)) return;
      await refreshChatPanel();
      if (!isLiveChatGeneration(generation)) return;
      resetChatComposer();
      if (els.chatStatus) els.chatStatus.textContent = "对话已清空。";
    } catch (err) {
      if (!isLiveChatGeneration(generation)) return;
      if (els.chatStatus) els.chatStatus.textContent = (err && err.message) || String(err);
    }
  }

  if (els.chatClear) {
    els.chatClear.addEventListener("click", () => {
      setClearConfirmVisible(true);
    });
    if (els.chatClearConfirmBtn) {
      els.chatClearConfirmBtn.addEventListener("click", () => {
        void performClearConversation();
      });
    }
    if (els.chatClearCancel) {
      els.chatClearCancel.addEventListener("click", () => {
        setClearConfirmVisible(false);
      });
    }
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
        await setNav(returnNav || "chat");
        if ((returnNav || "chat") === "work" && workMode === "task" && activeTaskId) {
          await selectTask(activeTaskId);
        }
        if ((returnNav || "chat") === "chat") {
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

  if (els.checkExecutor) {
    els.checkExecutor.addEventListener("click", async () => {
      if (els.executorSettingsStatus) els.executorSettingsStatus.textContent = "正在检查…";
      const listed = await refreshExecutorCapabilityUi(true);
      const card = listed && listed.executorCapabilityCard;
      if (els.executorSettingsStatus) {
        els.executorSettingsStatus.textContent = card
          ? card.available
            ? "连接正常"
            : card.detail || "未连接：请先安装并连接代码执行能力"
          : "未找到代码执行能力";
      }
    });
  }

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

  async function refreshRemotePeers() {
    if (!els.remotePeerList && !els.collabSignalPeer) return;
    try {
      const listed = await api.invoke("subject.communicate", { action: "listPeers" });
      if (els.remoteDmConnectionState) {
        els.remoteDmConnectionState.textContent = `连接状态：${listed.connectionLabel || "尚未配置"}`;
      }
      if (els.remoteRelayUrl && listed.relayUrl && !(els.remoteRelayUrl.value || "").trim()) {
        els.remoteRelayUrl.value = listed.relayUrl;
      }
      const peers = listed.peers || [];
      const peerSig = JSON.stringify(
        peers.map((p) => ({
          endpointRef: p.endpointRef || "",
          displayName: p.displayName || "",
          statusLabel: p.statusLabel || "",
        })),
      );
      if (peerSig !== lastRemotePeersSignature) {
        lastRemotePeersSignature = peerSig;
        if (els.remotePeerList) {
          els.remotePeerList.innerHTML = "";
          for (const p of peers) {
            const li = document.createElement("li");
            li.textContent = `${p.displayName} · ${p.statusLabel || ""}`;
            els.remotePeerList.appendChild(li);
          }
        }
        if (els.collabSignalPeer) {
          const prev = els.collabSignalPeer.value;
          const hadFocus = document.activeElement === els.collabSignalPeer;
          els.collabSignalPeer.innerHTML = "";
          if (!peers.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "请先在设置中连接另一台电脑上的数字之我";
            els.collabSignalPeer.appendChild(opt);
          } else {
            for (const p of peers) {
              const opt = document.createElement("option");
              opt.value = p.endpointRef || "";
              opt.textContent = `${p.displayName}${p.statusLabel ? ` · ${p.statusLabel}` : ""}`;
              els.collabSignalPeer.appendChild(opt);
            }
            if (prev && [...els.collabSignalPeer.options].some((o) => o.value === prev)) {
              els.collabSignalPeer.value = prev;
            }
          }
          if (hadFocus) {
            try {
              els.collabSignalPeer.focus({ preventScroll: true });
            } catch {
              els.collabSignalPeer.focus();
            }
          }
        }
      }
    } catch {
      /* 包未打开时忽略 */
    }
  }

  // 原始 intent 是语义判断的权威输入；此处只派生软标签，不要求「提供/可以」模板。
  function deriveSignalFields(intent) {
    const text = String(intent || "").replace(/\s+/g, " ").trim().slice(0, 240);
    return { seeking: text ? [text] : [], offering: [] };
  }

  function refreshPendingSignalStatus(retryResult) {
    if (!els.collabSignalStatus) return;
    const text = String(els.collabSignalStatus.textContent || "");
    if (!/暂时无法送达/.test(text)) return;
    const remaining =
      retryResult && typeof retryResult.remaining === "number"
        ? retryResult.remaining
        : null;
    const submitted =
      retryResult && typeof retryResult.submitted === "number"
        ? retryResult.submitted
        : 0;
    // remaining===0：待投递已清空。submitted>0：本轮确有成功提交（兼容仍有其它历史失败项）
    if (remaining === 0 || submitted > 0) {
      showStatus(els.collabSignalStatus, "已发出。对方上线后会看到相关提示。");
    }
  }

  async function syncRemoteTransportQuietly() {
    let retryResult = null;
    try {
      retryResult = await api.invoke("subject.communicate", { action: "retryOutbox" });
      refreshPendingSignalStatus(retryResult);
    } catch {
      /* ignore */
    }
    try {
      await api.invoke("subject.communicate", { action: "pullRemote" });
    } catch {
      /* ignore */
    }
  }

  let remoteCommWatchTimer = null;
  function ensureRemoteCommWatch() {
    if (remoteCommWatchTimer) return;
    remoteCommWatchTimer = setInterval(async () => {
      try {
        await syncRemoteTransportQuietly();
        if (document.getElementById("panel-collab") && !document.getElementById("panel-collab").hidden) {
          await refreshOpportunityCards();
        }
      } catch {
        /* ignore */
      }
    }, 8000);
  }

  if (els.btnRemoteRelayConnect) {
    els.btnRemoteRelayConnect.addEventListener("click", async () => {
      try {
        const relayUrl = (els.remoteRelayUrl && els.remoteRelayUrl.value) || "";
        const r = await api.invoke("subject.communicate", {
          action: "configureRelay",
          relayUrl: relayUrl.trim(),
        });
        if (els.remoteDmConnectionState) {
          els.remoteDmConnectionState.textContent = `连接状态：${r.connectionLabel || "无法连接"}`;
        }
        showStatus(els.remoteDmStatus, r.reachable ? "中继已连接。" : "暂时无法连接中继。", !r.reachable);
        await refreshRemotePeers();
        ensureRemoteCommWatch();
      } catch (err) {
        showStatus(els.remoteDmStatus, String(err.message || err), true);
      }
    });
  }
  if (els.btnRemoteCreateInvite) {
    els.btnRemoteCreateInvite.addEventListener("click", async () => {
      try {
        const r = await api.invoke("subject.communicate", { action: "createInvite" });
        if (els.remoteInviteOutput) els.remoteInviteOutput.value = r.inviteJson || "";
        showStatus(els.remoteDmStatus, "邀请已生成，可复制给对方。");
      } catch (err) {
        showStatus(els.remoteDmStatus, String(err.message || err), true);
      }
    });
  }
  if (els.btnRemoteAcceptInvite) {
    els.btnRemoteAcceptInvite.addEventListener("click", async () => {
      try {
        const inviteJson = (els.remoteInviteInput && els.remoteInviteInput.value) || "";
        const r = await api.invoke("subject.communicate", {
          action: "acceptInvite",
          inviteJson: inviteJson.trim(),
        });
        if (els.remoteInviteOutput && r.inviteJson) {
          els.remoteInviteOutput.value = r.inviteJson;
        }
        showStatus(
          els.remoteDmStatus,
          r.peerDisplayName ? `已与「${r.peerDisplayName}」建立联系。请把回执邀请交给对方。` : "已接受邀请。",
        );
        await refreshRemotePeers();
        ensureRemoteCommWatch();
      } catch (err) {
        showStatus(els.remoteDmStatus, String(err.message || err), true);
      }
    });
  }
  if (els.btnCollabSendSignal) {
    els.btnCollabSendSignal.addEventListener("click", async () => {
      const intent = ((els.collabSignalIntent && els.collabSignalIntent.value) || "").trim();
      const peerEndpointRef = (els.collabSignalPeer && els.collabSignalPeer.value) || "";
      if (!peerEndpointRef) {
        showStatus(els.collabSignalStatus, "请先在设置中连接另一台电脑上的数字之我。", true);
        return;
      }
      if (!intent) {
        showStatus(els.collabSignalStatus, "请先写明你的合作意向。", true);
        return;
      }
      try {
        showStatus(els.collabSignalStatus, "正在发出…");
        const fields = deriveSignalFields(intent);
        const r = await api.invoke("subject.communicate", {
          action: "sendSignal",
          peerEndpointRef,
          signal: {
            intent,
            seeking: fields.seeking,
            offering: fields.offering,
            disclosureLevel: "minimal",
          },
        });
        if (r.delivered === false) {
          showStatus(
            els.collabSignalStatus,
            "暂时无法送达，恢复连接后会继续尝试。",
            true,
          );
        } else {
          showStatus(els.collabSignalStatus, "已发出。对方上线后会看到相关提示。");
        }
        ensureRemoteCommWatch();
        await refreshCollabHome();
      } catch (err) {
        showStatus(els.collabSignalStatus, String(err.message || err), true);
      }
    });
  }
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
    // 与右栏「使用已有项目」同一入口语义：用户明确选择 → user_selected
    await addProjectFolderFromPicker(false);
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

  const growthContinueLearn = document.getElementById("btn-growth-continue-learn");
  if (growthContinueLearn) {
    growthContinueLearn.addEventListener("click", () => {
      void continueUnderstandingMe();
    });
  }
  const growthOtherBtn = document.getElementById("btn-growth-other-ways");
  if (growthOtherBtn) {
    growthOtherBtn.addEventListener("click", () => {
      showGrowthSubjectView("other");
    });
  }
  const growthSituationBtn = document.getElementById("btn-growth-situation");
  if (growthSituationBtn) {
    growthSituationBtn.addEventListener("click", () => {
      showGrowthSubjectView("situation");
    });
  }
  const growthBackSituation = document.getElementById("btn-growth-back-situation");
  if (growthBackSituation) {
    growthBackSituation.addEventListener("click", () => {
      showGrowthSubjectView("home");
    });
  }
  const growthBackOther = document.getElementById("btn-growth-back-other");
  if (growthBackOther) {
    growthBackOther.addEventListener("click", () => {
      showGrowthSubjectView("home");
    });
  }
  const growthUnderstandingBtn = document.getElementById("btn-growth-understanding");
  if (growthUnderstandingBtn) {
    growthUnderstandingBtn.addEventListener("click", () => {
      showGrowthSubjectView("understanding");
    });
  }
  const growthBackUnderstanding = document.getElementById("btn-growth-back-understanding");
  if (growthBackUnderstanding) {
    growthBackUnderstanding.addEventListener("click", () => {
      showGrowthSubjectView("home");
    });
  }
  const optionalWork = document.getElementById("btn-growth-optional-work");
  if (optionalWork) {
    optionalWork.addEventListener("click", () => {
      void handleGrowthTask({ key: "optional_learn_from_work" });
    });
  }
  const guideSwitch = document.getElementById("btn-guide-switch");
  if (guideSwitch) guideSwitch.addEventListener("click", () => void handleGuideChoice("switch"));
  const guideLater = document.getElementById("btn-guide-later");
  if (guideLater) guideLater.addEventListener("click", () => void handleGuideChoice("later"));
  if (api.onOpenHelp) {
    api.onOpenHelp((info) => openHelp(info && info.sectionId ? info.sectionId : "help-growth"));
  }

  async function addProjectFolderFromPicker(preferEmpty) {
    try {
      const dir = await api.dialogs.pickOpenDirectory();
      if (!dir) return;
      let inspected = null;
      if (typeof api.inspectSoftwareProject === "function") {
        inspected = await api.inspectSoftwareProject(dir);
      }
      if (preferEmpty && inspected && !inspected.isEmptyDirectory && !inspected.isNewProjectCandidate) {
        els.jobStatus.textContent = "请选择空文件夹以开始新项目，或改用「使用已有项目」。";
        els.jobStatus.classList.add("error");
        return;
      }
      materials = materials.filter((m) => !(m.kind === "folder"));
      materials.push({
        kind: "folder",
        path: dir,
        projectOrigin: "user_selected",
        softwareProject: inspected || undefined,
      });
      renderMaterials();
      pendingCreateProject = null;
      els.jobStatus.textContent = inspected && inspected.isNewProjectCandidate
        ? "已准备好新项目位置。"
        : "已添加项目文件夹。";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "";
      await advanceAfterProjectLocationReady();
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
      refreshWorkUxView({});
    }
  }

  function showProjectCreateConfirmUi(pathText) {
    // D11-E：确认 UI 只投影到右栏准备区
    prepBlockedState = {
      kind: "project_confirm",
      title: "请确认新项目位置",
      missing: "需要确认即将使用的项目文件夹。",
      why: "确认后才会在该位置创建或使用项目，并按已确认的规划开始开发。",
      checked: pathText,
      action: "确认位置无误后继续；也可更改位置或取消。",
      continueHint: "",
      payload: null,
    };
    refreshTaskWorkspace();
    refreshWorkUxView({
      projectCreateConfirm: true,
      prepBlocked: true,
      prepBlockedKind: "project_confirm",
    });
  }

  async function beginCreateNewProjectFlow() {
    const goal = (els.goal && els.goal.value ? String(els.goal.value) : "").trim();
    if (!goal) {
      els.jobStatus.textContent = "请先填写任务目标";
      els.jobStatus.classList.add("error");
      return;
    }
    // 幂等：同一任务草稿已选定项目目录时复用，不创建 (2)
    const existing = materials.find(
      (m) => m.kind === "folder" && m.projectOrigin === "digitalme_created" && m.path,
    );
    if (existing) {
      pendingCreateProject = {
        ok: true,
        path: existing.path,
        displayPath: existing.path,
        reused: true,
      };
      showProjectCreateConfirmUi(
        "将继续使用已为这项任务准备的项目文件夹：\n" + existing.path,
      );
      return;
    }
    if (pendingCreateProject && pendingCreateProject.path) {
      showProjectCreateConfirmUi(
        "Digital Me 将为这项任务创建项目文件夹：\n" +
          (pendingCreateProject.displayPath || pendingCreateProject.path),
      );
      return;
    }
    if (typeof api.prepareSoftwareProject !== "function") {
      els.jobStatus.textContent = "当前环境无法自动创建项目文件夹";
      els.jobStatus.classList.add("error");
      return;
    }
    try {
      const prepared = await api.prepareSoftwareProject({ goal });
      if (!prepared || !prepared.ok || !prepared.path) {
        els.jobStatus.textContent =
          (prepared && prepared.error) || "无法创建项目文件夹";
        els.jobStatus.classList.add("error");
        return;
      }
      pendingCreateProject = prepared;
      showProjectCreateConfirmUi(
        "Digital Me 将为这项任务创建项目文件夹：\n" +
          (prepared.displayPath || prepared.path),
      );
      els.jobStatus.textContent = "请确认新项目位置";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "";
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
    }
  }

  async function confirmPendingCreateProject() {
    if (!pendingCreateProject || !pendingCreateProject.path) return;
    const prepared = pendingCreateProject;
    const dir = prepared.path;
    const reused = !!prepared.reused;
    let inspected = null;
    try {
      if (typeof api.inspectSoftwareProject === "function") {
        inspected = await api.inspectSoftwareProject(dir);
      }
    } catch {
      /* ignore */
    }
    materials = materials.filter((m) => !(m.kind === "folder"));
    materials.push({
      kind: "folder",
      path: dir,
      projectOrigin: "digitalme_created",
      softwareProject: inspected || { isNewProjectCandidate: true, isEmptyDirectory: true },
    });
    renderMaterials();
    pendingCreateProject = null;
    els.jobStatus.textContent = reused
      ? "已沿用本任务的项目文件夹。"
      : "已创建新项目文件夹。";
    els.jobStatus.classList.remove("error");
    els.jobActionable.textContent = "";
    // 项目位置已成立：必须自动进入下一门控，不得停在 needs_input / 无按钮
    await advanceAfterProjectLocationReady();
  }

  /**
   * 项目位置只是输入门槛：选定后刷新门控，不得绕过规划确认直接 submitTask。
   */
  async function advanceAfterProjectLocationReady() {
    refreshWorkUxView({});
    try {
      await refreshConnectionFromCapabilities();
      if (!canSubmit(lastConnectionState)) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        els.jobActionable.textContent = "前往设置连接真实模型后再开始处理。";
        refreshWorkUxView({ modelReady: false });
        return;
      }
      if (
        activeTaskPlan &&
        activeTaskPlan.content &&
        activeTaskPlan.source !== "seed_internal" &&
        (activeTaskId || converseDraftTaskId)
      ) {
        els.jobStatus.textContent = "项目位置已就绪。请在右侧确认规划后再开始开发。";
        els.jobStatus.classList.remove("error");
        els.jobActionable.textContent = "";
        refreshTaskWorkspace();
        refreshWorkUxView({ projectDirReady: true, prepBlocked: false });
        return;
      }
      els.jobStatus.textContent = "项目已添加。请写下要做的事，然后发送给 Digital Me。";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "";
      refreshWorkUxView({ projectDirReady: true });
      focusWorkNaturalLanguageInput();
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
      refreshWorkUxView({});
    }
  }

  async function applySubmitTaskResult(result, payload, goal, opts) {
    const options = opts || {};
    const fromPlanConfirm = !!options.fromPlanConfirm;
    if (result.needsProjectFolder) {
      showPrepBlocked("project", result.needsProjectFolder);
      els.jobStatus.textContent = "开发前还需完成准备：项目位置";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "请在右侧任务工作区选择或创建项目位置。";
      clearArtifactView();
      refreshWorkUxView({ projectDirReady: false, prepBlocked: true, prepBlockedKind: "project" });
      return "needs_project";
    }
    if (result.needsExecutorSetup) {
      showPrepBlocked("executor", result.needsExecutorSetup);
      els.jobStatus.textContent = "开发前还需完成准备：代码执行能力";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "请在右侧任务工作区连接代码执行能力。";
      refreshWorkUxView({ projectDirReady: true, prepBlocked: true, prepBlockedKind: "executor" });
      return "needs_capability";
    }
    if (result.needsExecutionConfirm) {
      const preview = result.needsExecutionConfirm;
      const tw = window.DigitalMeTaskWorkspace;
      const highRisk =
        tw && typeof tw.isHighRiskExecution === "function"
          ? tw.isHighRiskExecution(goal, preview)
          : false;
      // D11-B：仅在用户明确确认最新规划后，低风险才自动附带执行授权
      if (fromPlanConfirm && !highRisk && !options._authDone) {
        const authPayload = Object.assign({}, payload, {
          capabilityId: preview.selectedCapabilityId || payload.capabilityId,
          executionAuthorization: {
            confirmed: true,
            workingDirectory: preview.workingDirectory,
            readScope: preview.readScope,
            writeScope: preview.writeScope,
            projectOrigin:
              preview.projectOrigin ||
              resolveMaterialsProjectOrigin() ||
              "user_selected",
          },
        });
        const next = await api.invoke("work.submitTask", authPayload);
        return applySubmitTaskResult(next, authPayload, goal, {
          fromPlanConfirm: true,
          _authDone: true,
        });
      }
      if (highRisk) {
        pendingExecutionConfirm = {
          goal,
          contextRefs: payload.contextRefs,
          preview,
          existingTaskId: payload.existingTaskId || null,
          capabilityId: preview.selectedCapabilityId || null,
          confirmedPlanVersion: payload.confirmedPlanVersion,
        };
        showPrepBlocked("high_risk", preview);
        els.jobStatus.textContent = "需要额外确认后再开始";
        els.jobStatus.classList.remove("error");
        els.jobActionable.textContent = preview.notice || "";
        refreshWorkUxView({ prepBlocked: true, prepBlockedKind: "high_risk" });
        return "needs_confirmation";
      }
      // 非规划确认入口：不得自动附授权；引导用户在右栏确认最新规划
      els.jobStatus.textContent = "请先在右侧确认最新规划后再开始";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "确认规划后才会开始开发；高风险操作仍会单独请你确认。";
      clearPrepBlocked();
      refreshTaskWorkspace();
      refreshWorkUxView({ prepBlocked: false });
      return "needs_plan_confirm";
    }
    workMode = "task";
    activeTaskId = result.taskId;
    activeJobId = result.jobId;
    converseDraftTaskId = null;
    clearPrepBlocked();
    activeTaskIntentKind = result.intentKind || null;
    activeTaskRequestedArtifactType =
      result.intentKind === "analyze_code"
        ? "code-analysis"
        : result.intentKind === "modify_code"
          ? "code-change"
          : "document";
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
    refreshTaskWorkspace();
    refreshWorkUxView({});
    return "started";
  }

  async function changePendingCreateProjectLocation() {
    const parent = await api.dialogs.pickSaveDirectory();
    if (!parent) return;
    const goal = (els.goal && els.goal.value ? String(els.goal.value) : "").trim() || "新项目";
    try {
      const prepared = await api.prepareSoftwareProject({ goal, parentDir: parent });
      if (!prepared || !prepared.ok) {
        els.jobStatus.textContent = (prepared && prepared.error) || "无法更改位置";
        els.jobStatus.classList.add("error");
        return;
      }
      pendingCreateProject = prepared;
      showProjectCreateConfirmUi(
        "Digital Me 将为这项任务创建项目文件夹：\n" +
          (prepared.displayPath || prepared.path),
      );
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
    }
  }

  if (els.adoptContinueRevise) {
    els.adoptContinueRevise.addEventListener("click", () => {
      hideAdoptWarning();
      focusWorkNaturalLanguageInput();
      refreshWorkUxView({});
    });
  }
  if (els.adoptAnyway) {
    els.adoptAnyway.addEventListener("click", () => {
      hideAdoptWarning();
      void submitArtifactDecision("accept", { forceAdopt: true });
    });
  }

  if (els.workNlSend) {
    els.workNlSend.addEventListener("click", () => {
      void submitWorkNaturalLanguage();
    });
  }
  if (els.goalSend) {
    els.goalSend.addEventListener("click", () => {
      const goal = String((els.goal && els.goal.value) || "").trim();
      if (!goal) {
        if (els.jobStatus) {
          els.jobStatus.textContent = "请先写下要完成的工作。";
          els.jobStatus.classList.remove("error");
        }
        return;
      }
      els.goalSend.disabled = true;
      if (els.jobStatus) {
        els.jobStatus.textContent = "正在发送给 Digital Me…";
        els.jobStatus.classList.remove("error");
      }
      void submitWorkNaturalLanguage(goal).finally(() => {
        if (els.goalSend) els.goalSend.disabled = workMode !== "compose";
        syncGoalPresentation();
      });
    });
  }
  if (els.startDevelopment) {
    els.startDevelopment.addEventListener("click", () => {
      void confirmPlanAndStartDevelopment();
    });
  }
  if (els.twCreateProject) {
    els.twCreateProject.addEventListener("click", () => beginCreateNewProjectFlow());
  }
  if (els.twPickProject) {
    els.twPickProject.addEventListener("click", () => {
      if (prepBlockedState && prepBlockedState.kind === "project_confirm") {
        void changePendingCreateProjectLocation();
        return;
      }
      addProjectFolderFromPicker(false);
    });
  }
  if (els.twConnectCoding) {
    els.twConnectCoding.addEventListener("click", () => {
      void connectCodingCapabilityFromPrep();
    });
  }
  if (els.twOpenSettings) {
    els.twOpenSettings.addEventListener("click", () => {
      if (els.openSettings) els.openSettings.click();
    });
  }
  if (els.twPrepContinue) {
    els.twPrepContinue.addEventListener("click", () => {
      if (prepBlockedState && prepBlockedState.kind === "project_confirm") {
        void confirmPendingCreateProject();
        return;
      }
      const taskId = activeTaskId || converseDraftTaskId;
      if (!taskId) return;
      void startConversationTaskExecution(taskId, {
        confirmedPlanVersion: activeTaskPlan && activeTaskPlan.version,
        fromPlanConfirm: true,
      });
    });
  }
  if (els.twHighRiskConfirm) {
    els.twHighRiskConfirm.addEventListener("click", async () => {
      const pending = pendingExecutionConfirm;
      if (!pending || !pending.preview) return;
      const goal = pending.goal || "";
      const payload = {
        goal,
        contextRefs: pending.contextRefs || [],
        existingTaskId: pending.existingTaskId || undefined,
        capabilityId: pending.capabilityId || undefined,
        confirmedPlanVersion: pending.confirmedPlanVersion,
        executionAuthorization: {
          confirmed: true,
          workingDirectory: pending.preview.workingDirectory,
          readScope: pending.preview.readScope,
          writeScope: pending.preview.writeScope,
          projectOrigin:
            pending.preview.projectOrigin ||
            resolveMaterialsProjectOrigin() ||
            "user_selected",
        },
      };
      clearPrepBlocked();
      const result = await api.invoke("work.submitTask", payload);
      await applySubmitTaskResult(result, payload, goal, {
        fromPlanConfirm: true,
        _authDone: true,
      });
    });
  }
  if (els.twHighRiskCancel) {
    els.twHighRiskCancel.addEventListener("click", () => {
      if (prepBlockedState && prepBlockedState.kind === "project_confirm") {
        pendingCreateProject = null;
        clearPrepBlocked();
        showPrepBlocked("project", null);
        return;
      }
      pendingExecutionConfirm = null;
      clearPrepBlocked();
      refreshTaskWorkspace();
      focusWorkNaturalLanguageInput();
    });
  }
  if (els.workNlInput) {
    els.workNlInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        void submitWorkNaturalLanguage();
      }
    });
  }

  els.submit.addEventListener("click", async () => {
    // SINGLE-RUNTIME-PATH-20：封死旧「开始处理」直提 submitTask。
    // 有可确认模型规划时，转唯一主链确认入口；否则只引导对话。
    try {
      if (
        activeTaskPlan &&
        activeTaskPlan.content &&
        activeTaskPlan.source !== "seed_internal" &&
        (activeTaskId || converseDraftTaskId)
      ) {
        await confirmPlanAndStartDevelopment();
        return;
      }
      els.jobStatus.textContent = "请先在对话中说明目标并确认开发规划；确认前不会开始修改项目。";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "";
      if (els.submit) {
        els.submit.hidden = true;
        els.submit.setAttribute("hidden", "");
      }
      refreshWorkUxView({});
      focusWorkNaturalLanguageInput();
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
    }
  });

  if (els.goalExamples) {
    els.goalExamples.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-goal-example]") : null;
      if (!btn || workMode !== "compose") return;
      const text = btn.getAttribute("data-goal-example") || "";
      if (els.goal && text) {
        els.goal.value = text;
        els.goal.focus();
      }
    });
  }

  if (els.ccFilesMore) {
    els.ccFilesMore.addEventListener("click", () => {
      ccFilesExpanded = !ccFilesExpanded;
      if (activeArtifactId) loadArtifact(activeArtifactId);
    });
  }

  if (els.openProjectFolder) {
    els.openProjectFolder.addEventListener("click", async () => {
      if (!activeCodeChangeWorkingDirectory) return;
      try {
        if (typeof api.revealPath === "function") {
          await api.revealPath(activeCodeChangeWorkingDirectory);
        }
      } catch (err) {
        els.jobActionable.textContent = err.message || "无法打开项目文件夹";
      }
    });
  }

  if (els.proposeRevision) {
    els.proposeRevision.addEventListener("click", () => {
      const st = els.decisionStatus ? els.decisionStatus.textContent : "";
      showRevisionComposer({ continueMode: /已采用/.test(st || "") });
    });
  }
  if (els.cancelRevision) {
    els.cancelRevision.addEventListener("click", () => {
      hideRevisionComposer();
      if (els.revisionRequest) els.revisionRequest.value = "";
      clearRevisionShots();
    });
  }

  if (els.revisionRequest) {
    els.revisionRequest.addEventListener("paste", async (ev) => {
      const items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      let handled = false;
      for (const item of items) {
        if (!item.type || !item.type.startsWith("image/")) continue;
        handled = true;
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          await addRevisionShotFromDataUrl(String(reader.result || ""));
          showRevisionComposer({ continueMode: true });
        };
        reader.readAsDataURL(file);
      }
      if (handled) ev.preventDefault();
    });
    els.revisionRequest.addEventListener("dragover", (ev) => {
      ev.preventDefault();
    });
    els.revisionRequest.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      const files = ev.dataTransfer && ev.dataTransfer.files;
      if (!files || !files.length) return;
      for (const file of files) {
        if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          await addRevisionShotFromDataUrl(String(reader.result || ""));
        };
        reader.readAsDataURL(file);
      }
      showRevisionComposer({ continueMode: true });
    });
  }
  if (els.addRevisionShot && els.revisionShotFile) {
    els.addRevisionShot.addEventListener("click", () => {
      els.revisionShotFile.click();
    });
    els.revisionShotFile.addEventListener("change", async () => {
      const files = els.revisionShotFile.files;
      if (!files) return;
      for (const file of files) {
        if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          await addRevisionShotFromDataUrl(String(reader.result || ""));
        };
        reader.readAsDataURL(file);
      }
      els.revisionShotFile.value = "";
      showRevisionComposer({ continueMode: true });
    });
  }

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
      if (!revisionRequest && revisionShotItems.length === 0) {
        els.jobStatus.textContent = "请先说明还需要修改什么，或附上截图";
        els.jobStatus.classList.add("error");
        showRevisionComposer();
        return;
      }
      if (!revisionRequest && revisionShotItems.length > 0) {
        els.jobStatus.textContent = "请用文字简要说明截图里的问题";
        els.jobStatus.classList.add("error");
        showRevisionComposer({ continueMode: true });
        return;
      }
      const attachmentPaths = await persistRevisionShots();
      // 采用/不采用说明不得作为 revisionRequest
      // CTO：用户补充意见时，附带 Digital Me 修正指令再委派
      let revisionPayload = revisionRequest;
      const ctoDirective =
        activeAcceptanceSummary && activeAcceptanceSummary.revisionDirective
          ? String(activeAcceptanceSummary.revisionDirective).trim()
          : "";
      if (ctoDirective && !/^【Digital Me 修正指令】/.test(revisionRequest)) {
        revisionPayload = `${ctoDirective}\n\n【用户补充意见】\n${revisionRequest}`;
      }
      taskPausedCto = false;
      const result = await api.invoke("work.reviseArtifact", {
        taskId: activeTaskId,
        artifactId: activeArtifactId,
        revisionRequest: revisionPayload,
        ...(attachmentPaths.length ? { attachmentPaths } : {}),
      });
      hideRevisionComposer();
      showRevisionActiveBanner(revisionRequest);
      if (els.revisionRequest) els.revisionRequest.value = "";
      clearRevisionShots();
      activeJobId = result.jobId;
      els.jobStatus.textContent = "正在按修正指令继续处理";
      els.jobStatus.classList.remove("error");
      if (els.jobActionable) {
        els.jobActionable.textContent =
          "修正说明：" +
          revisionRequest.slice(0, 200) +
          (attachmentPaths.length ? `（附 ${attachmentPaths.length} 张截图）` : "");
      }
      showArtifactLoading("正在按你的修改要求继续处理…");
      await syncActiveTaskStatus();
      startJobWatch(activeTaskId);
    } catch (err) {
      const msg = userFacingWorkError(err);
      els.jobStatus.textContent = msg;
      els.jobStatus.classList.add("error");
      if (/重新连接|设置中检查连接|登录|认证/i.test(msg)) {
        showPrepBlocked("executor", { message: msg });
      }
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

  if (els.restoreBaseline) {
    els.restoreBaseline.addEventListener("click", async () => {
      if (!activeTaskId) return;
      try {
        const ok = window.confirm(
          "恢复执行前状态会改写当前项目文件，使其回到本次执行前的内容。确定继续？",
        );
        if (!ok) return;
        const result = await api.invoke("work.retryTask", {
          taskId: activeTaskId,
          action: "restore_baseline",
        });
        els.jobStatus.textContent = result.message || (result.restored ? "已恢复执行前状态" : "恢复未完成");
        els.jobStatus.classList.toggle("error", !result.restored);
        if (result.conflicts && result.conflicts.length) {
          els.jobActionable.textContent = `无法安全恢复：${result.conflicts.slice(0, 5).join("、")}`;
        } else if (!result.restored) {
          els.jobActionable.textContent = "恢复已停止。请先处理冲突后再试。";
        } else {
          els.jobActionable.textContent =
            "不采用不会自动还原文件。如需还原，请使用「恢复执行前状态」。";
          if (activeArtifactId) await loadArtifact(activeArtifactId);
        }
      } catch (err) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      }
    });
  }

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
    els.acceptArtifact.addEventListener("click", () => {
      const versionHint = activeArtifactVersionLabel || activeHeadVersionId || "当前版本";
      showAdoptConfirm(versionHint);
    });
  }
  if (els.rejectArtifact) {
    els.rejectArtifact.addEventListener("click", () => submitArtifactDecision("reject"));
  }

  function collabUserLabel(item) {
    if (!item) return "";
    const role = item.role || "initiator";
    if (item.status === "revoked" || item.status === "withdrawn") return "已结束";
    if (item.status === "failed") return "未完成";
    if (item.status === "running") {
      return role === "responder" ? "你正在完成" : "对方正在处理";
    }
    if (item.status === "awaiting_owner") return "等待对方确认";
    if (item.status === "awaiting_clarification") return "等待补充说明";
    if (item.status === "counter_proposed") return "对方提出调整";
    if (item.status === "proposed") {
      return role === "responder" ? "待你确认协作" : "等待对方确认";
    }
    if (item.status === "delivered") {
      return role === "initiator" ? "需要你确认" : "等待对方确认";
    }
    if (item.status === "authorized" || item.status === "agreed" || item.status === "requested") {
      return "协作已建立";
    }
    if (item.ownerDecision === "accept" || item.status === "completed") return "已完成";
    if (item.ownerDecision === "reject" || item.status === "rejected") return "暂未建立协作";
    return role === "responder" ? "待你确认协作" : "等待开始";
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

  function opportunityStageLabel(stage) {
    if (stage === "brief_shared") return "已交换简介";
    if (stage === "mutual_interest") return "双方愿意进一步了解";
    if (stage === "continued") return "已表示愿意了解";
    if (stage === "collaboration_started") return "已发起协作";
    if (stage === "inbound_pending") return "对方发来的提示";
    return "可能值得了解";
  }

  /** 机会卡内容签名：轮询无变化时跳过 DOM 重建，避免协作页周期性抖动。 */
  let lastOpportunityCardsSignature = "";
  let lastRemotePeersSignature = "";

  function opportunityCardsSignature(rows) {
    return JSON.stringify(
      (rows || []).map((card) => ({
        id: card.id || "",
        stage: card.stage || "",
        peerDisplayName: card.peerDisplayName || "",
        whyWorthKnowing: card.whyWorthKnowing || "",
        seekingSummary: card.seekingSummary || "",
        offeringSummary: card.offeringSummary || "",
        peerBrief: card.peerBrief || "",
        privacyNote: card.privacyNote || "",
        collaborationRecordId: card.collaborationRecordId || "",
      })),
    );
  }

  function collabPanelScrollTop() {
    const panel = els.panelCollab;
    if (!panel) return 0;
    let node = panel;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
        return node.scrollTop;
      }
      node = node.parentElement;
    }
    return panel.scrollTop || 0;
  }

  function restoreCollabPanelScroll(scrollTop) {
    const panel = els.panelCollab;
    if (!panel || scrollTop == null) return;
    let node = panel;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
        node.scrollTop = scrollTop;
        return;
      }
      node = node.parentElement;
    }
    if (panel.scrollHeight > panel.clientHeight) panel.scrollTop = scrollTop;
  }

  async function refreshOpportunityCards() {
    const ul = els.collabListOpportunities;
    const emptyEl = els.collabEmptyOpportunities;
    if (!ul) return;
    let rows = [];
    try {
      await api.invoke("subject.communicate", { action: "processInbox" });
      const listed = await api.invoke("subject.communicate", { action: "listOpportunities" });
      rows = Array.isArray(listed.items) ? listed.items : [];
    } catch {
      rows = [];
    }
    const signature = opportunityCardsSignature(rows);
    if (signature === lastOpportunityCardsSignature) {
      if (emptyEl) emptyEl.hidden = rows.length > 0;
      return;
    }
    lastOpportunityCardsSignature = signature;
    const preservedScroll = collabPanelScrollTop();
    const active = document.activeElement;
    const preserveFocus =
      active &&
      (active.id === "collab-signal-intent" ||
        active.id === "collab-signal-peer" ||
        active === els.collabSignalIntent ||
        active === els.collabSignalPeer);
    ul.innerHTML = "";
    if (emptyEl) emptyEl.hidden = rows.length > 0;
    for (const card of rows) {
      if (card.stage === "collaboration_started" && card.collaborationRecordId) {
        // 已转正式协作：仍可一键打开，不占主决策
      }
      const li = document.createElement("li");
      li.className = "collab-opp-card";
      const title = document.createElement("p");
      title.className = "entry-title";
      title.textContent =
        card.stage === "inbound_pending" || card.stage === "potential"
          ? "发现一个可能值得了解的合作机会"
          : card.stage === "continued" || card.stage === "mutual_interest"
            ? card.whyWorthKnowing && /愿意进一步了解/.test(card.whyWorthKnowing)
              ? "对方也愿意进一步了解"
              : "可能值得进一步了解"
            : card.peerDisplayName || "合作机会";
      const peerLine = document.createElement("p");
      peerLine.className = "entry-meta";
      peerLine.textContent = card.peerDisplayName ? `对方：${card.peerDisplayName}` : "";
      const why = document.createElement("p");
      why.className = "entry-meta";
      why.textContent = card.whyWorthKnowing || "双方需求可能互补。";
      const privacy = document.createElement("p");
      privacy.className = "muted tiny";
      privacy.textContent =
        card.privacyNote || "双方 Digital Me 只交换了判断这次机会所需的少量信息。";
      const meta = document.createElement("p");
      meta.className = "entry-meta muted tiny";
      meta.textContent = [
        opportunityStageLabel(card.stage),
        card.seekingSummary ? `关注：${card.seekingSummary}` : "",
        card.offeringSummary ? `可提供：${card.offeringSummary}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      li.appendChild(title);
      if (peerLine.textContent) li.appendChild(peerLine);
      li.appendChild(why);
      li.appendChild(privacy);
      li.appendChild(meta);
      if (card.peerBrief) {
        const brief = document.createElement("p");
        brief.className = "muted tiny";
        brief.textContent = `对方简介：${card.peerBrief}`;
        li.appendChild(brief);
      }
      const actions = document.createElement("div");
      actions.className = "collab-opp-actions";
      const stage = String(card.stage || "");
      const addBtn = (label, primary, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = primary ? "primary" : "ghost";
        btn.textContent = label;
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onClick();
        });
        actions.appendChild(btn);
      };
      if (stage === "potential" || stage === "inbound_pending") {
        addBtn("继续了解", true, async () => {
          try {
            await api.invoke("subject.communicate", {
              action: "continueInterest",
              opportunityId: card.id,
            });
            await refreshCollabHome();
          } catch (err) {
            showStatus(els.collabDetailError || els.collabError, String(err.message || err), true);
          }
        });
        addBtn("暂不考虑", false, async () => {
          try {
            await api.invoke("subject.communicate", {
              action: "decline",
              opportunityId: card.id,
            });
            await refreshCollabHome();
          } catch (err) {
            showStatus(els.collabDetailError || els.collabError, String(err.message || err), true);
          }
        });
      } else if (stage === "continued" || stage === "mutual_interest") {
        addBtn("交换简介", true, async () => {
          try {
            await api.invoke("subject.communicate", {
              action: "discloseBrief",
              opportunityId: card.id,
            });
            await refreshCollabHome();
          } catch (err) {
            showStatus(els.collabDetailError || els.collabError, String(err.message || err), true);
          }
        });
        addBtn("暂不考虑", false, async () => {
          try {
            await api.invoke("subject.communicate", {
              action: "decline",
              opportunityId: card.id,
            });
            await refreshCollabHome();
          } catch (err) {
            showStatus(els.collabDetailError || els.collabError, String(err.message || err), true);
          }
        });
      } else if (stage === "brief_shared") {
        addBtn("发起协作", true, async () => {
          try {
            const started = await api.invoke("subject.communicate", {
              action: "startCollaboration",
              opportunityId: card.id,
            });
            await refreshCollabHome();
            if (started.recordId) await openCollabDetail(started.recordId);
          } catch (err) {
            showStatus(els.collabDetailError || els.collabError, String(err.message || err), true);
          }
        });
        addBtn("暂不考虑", false, async () => {
          try {
            await api.invoke("subject.communicate", {
              action: "decline",
              opportunityId: card.id,
            });
            await refreshCollabHome();
          } catch (err) {
            showStatus(els.collabDetailError || els.collabError, String(err.message || err), true);
          }
        });
      } else if (stage === "collaboration_started" && card.collaborationRecordId) {
        addBtn("打开协作", true, async () => {
          await openCollabDetail(card.collaborationRecordId);
        });
      }
      if (actions.childNodes.length) li.appendChild(actions);
      ul.appendChild(li);
    }
    restoreCollabPanelScroll(preservedScroll);
    if (preserveFocus && active && typeof active.focus === "function") {
      try {
        active.focus({ preventScroll: true });
      } catch {
        active.focus();
      }
    }
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
        meta.textContent = `${item.peerDisplayName || item.granteeDisplayName || "协作对象"} · ${collabUserLabel(item)}`;
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
    await refreshRemotePeers();
    ensureRemoteCommWatch();
    await syncRemoteTransportQuietly();
    await refreshOpportunityCards();
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
        role: st.role,
        peerDisplayName: st.peerDisplayName,
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
      const role = item.role || "initiator";
      if (els.collabDetailPeer) {
        const peer = item.peerDisplayName || item.granteeDisplayName || "本机数字之我";
        els.collabDetailPeer.textContent =
          role === "responder" ? `来自：${peer}` : `协作对象：${peer}`;
      }
      if (els.collabDetailGoal) {
        els.collabDetailGoal.textContent = item.subtaskGoal || "";
      }
      if (els.collabDetailStatus) {
        els.collabDetailStatus.textContent = `现在：${collabUserLabel(item)}`;
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
      const done =
        item.ownerDecision === "accept" ||
        item.ownerDecision === "reject" ||
        item.status === "completed" ||
        item.status === "rejected";
      const hasReturn = !!text || item.status === "delivered";
      const isFailed = item.status === "failed";
      const awaitingRespond =
        !revoked &&
        !done &&
        role === "responder" &&
        (item.status === "proposed" || item.status === "awaiting_clarification");
      // 本轮只收口「建立协作」；已建立后不展开履行/成果循环入口。
      const canFulfill = false;
      const canRetry = false;
      const canDecide = false;
      const canRevoke = false;

      if (els.btnCollabDetailRespondAccept) {
        els.btnCollabDetailRespondAccept.hidden = !awaitingRespond;
      }
      if (els.btnCollabDetailRespondReject) {
        els.btnCollabDetailRespondReject.hidden = !awaitingRespond;
      }
      if (els.btnCollabDetailExecute) {
        els.btnCollabDetailExecute.hidden = canRetry || awaitingRespond || !canFulfill;
        els.btnCollabDetailExecute.disabled = !canFulfill;
      }
      if (els.btnCollabDetailRetry) {
        els.btnCollabDetailRetry.hidden = !canRetry;
      }
      if (els.btnCollabDetailAccept) {
        els.btnCollabDetailAccept.hidden = !canDecide;
        els.btnCollabDetailAccept.disabled = !canDecide;
      }
      if (els.btnCollabDetailRevise) {
        els.btnCollabDetailRevise.hidden = !canDecide;
        els.btnCollabDetailRevise.disabled = !canDecide;
      }
      if (els.btnCollabDetailReject) {
        els.btnCollabDetailReject.hidden = !canDecide;
        els.btnCollabDetailReject.disabled = !canDecide;
      }
      if (els.btnCollabDetailRevoke) {
        els.btnCollabDetailRevoke.hidden = !canRevoke;
        els.btnCollabDetailRevoke.disabled = !canRevoke;
      }
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
      skipAutoEvaluate: true,
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
        await openCollabDetail(issued.recordId || issued.grantId);
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
  if (els.btnCollabDetailRespondAccept) {
    els.btnCollabDetailRespondAccept.addEventListener("click", async () => {
      showStatus(els.collabDetailError, "");
      if (!activeGrantId) return;
      try {
        await api.invoke("collab.interact", {
          action: "respond",
          recordId: activeGrantId,
          decision: "accept",
        });
        if (els.collabDetailStatus) els.collabDetailStatus.textContent = "现在：协作已建立";
        await openCollabDetail(activeGrantId);
        await refreshCollabHome();
      } catch (err) {
        showStatus(els.collabDetailError, collabErrorMessage(err, "decide"), true);
      }
    });
  }
  if (els.btnCollabDetailRespondReject) {
    els.btnCollabDetailRespondReject.addEventListener("click", async () => {
      showStatus(els.collabDetailError, "");
      if (!activeGrantId) return;
      try {
        await api.invoke("collab.interact", {
          action: "respond",
          recordId: activeGrantId,
          decision: "reject",
          note: "本次不适合承接",
        });
        if (els.collabDetailStatus) els.collabDetailStatus.textContent = "现在：暂未建立协作";
        await openCollabDetail(activeGrantId);
        await refreshCollabHome();
      } catch (err) {
        showStatus(els.collabDetailError, collabErrorMessage(err, "decide"), true);
      }
    });
  }
  if (els.btnCollabDetailAccept) {
    els.btnCollabDetailAccept.addEventListener("click", async () => {
      await decideCollabReturn("accept", els.collabDetailStatus, els.collabDetailError);
      if (activeGrantId) await openCollabDetail(activeGrantId);
    });
  }
  if (els.btnCollabDetailRevise) {
    els.btnCollabDetailRevise.addEventListener("click", async () => {
      showStatus(els.collabDetailError, "");
      if (!activeGrantId) return;
      const note = window.prompt(
        "请说明希望对方如何修改",
        "请更关注普通用户实际体验，减少偏技术的表述。",
      );
      if (!note || !String(note).trim()) return;
      try {
        if (els.collabDetailStatus) els.collabDetailStatus.textContent = "现在：对方正在处理";
        const result = await api.invoke("collab.interact", {
          action: "requestRevision",
          recordId: activeGrantId,
          grantId: activeGrantId,
          note: String(note).trim(),
        });
        if (result.status === "failed") {
          showStatus(els.collabDetailError, "对方未能完成修改", true);
        }
        await openCollabDetail(activeGrantId);
        await refreshCollabHome();
      } catch (err) {
        showStatus(els.collabDetailError, collabErrorMessage(err, "execute"), true);
      }
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
      if (activeArtifactId && workMode === "task" && activeTaskId) {
        const epoch = uiEpoch;
        await loadArtifact(activeArtifactId, { taskId: activeTaskId, epoch });
      }
    }
    if (event.kind === "subject.updated" && activeNav === "subject") {
      await refreshSubjectPanel();
    }
  });

  api.onBoot(async (info) => {
    rememberShellMeta(info || {});
    await refreshConnectionFromCapabilities();
    if (currentView === "settings") fillSettingsForm();
    // 主进程 rebootstrap 后默认包已重新挂载；shell 内刷新任务，welcome 则尝试进入做事。
    if (currentView === "shell") {
      try {
        await refreshTasks();
        if (activeNav === "subject") await refreshSubjectPanel();
      } catch {
        /* ignore */
      }
    } else if (currentView === "welcome") {
      try {
        const opened = await tryAutoOpenDefault();
        if (opened) return;
      } catch {
        /* ignore */
      }
    }
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
