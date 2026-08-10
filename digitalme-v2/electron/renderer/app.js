(() => {
  const api = window.digitalMe;
  if (!api) {
    document.body.textContent = "应用桥接未就绪。请通过 npm run dev 启动。";
    return;
  }

  const USER_FACING_TASK_START_FAILED =
    "Digital Me 暂时无法开始这项任务，请重新打开应用后重试。";

  function userFacingWorkError(err) {
    const msg = String((err && err.message) || err || "");
    if (
      /work runtime not attached|artifact workspace not attached|no active subject|open or create a package|runtime not ready|Error invoking remote method|command:invoke|PACKAGE_ATTACH_FAILED/i.test(
        msg,
      )
    ) {
      return USER_FACING_TASK_START_FAILED;
    }
    return msg || USER_FACING_TASK_START_FAILED;
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
    restoreBaseline: document.getElementById("btn-restore-baseline"),
    openProjectFolder: document.getElementById("btn-open-project-folder"),
    restartCompose: document.getElementById("btn-restart-compose"),
    workMoreMenu: document.getElementById("work-more-menu"),
    workMoreActions: document.getElementById("work-more-actions"),
    workAssistEntries: document.getElementById("work-assist-entries"),
    codingOnboardingMore: document.getElementById("coding-onboarding-more"),
    artifactExportsMore: document.getElementById("artifact-exports-more"),
    ccRestoreRow: document.getElementById("cc-restore-row"),
    ccRestoreHint: document.getElementById("cc-restore-hint"),
    decisionHint: document.getElementById("artifact-decision-hint"),
    executorSetupCard: document.getElementById("executor-setup-card"),
    executorSetupTitle: document.getElementById("executor-setup-title"),
    executorSetupDescription: document.getElementById("executor-setup-description"),
    projectFolderCard: document.getElementById("project-folder-card"),
    projectFolderMessage: document.getElementById("project-folder-message"),
    pickExistingProject: document.getElementById("btn-pick-existing-project"),
    pickEmptyProject: document.getElementById("btn-pick-empty-project"),
    createNewProject: document.getElementById("btn-create-new-project"),
    projectFolderActions: document.getElementById("project-folder-actions"),
    projectCreateConfirm: document.getElementById("project-create-confirm"),
    projectCreatePath: document.getElementById("project-create-path"),
    confirmCreateProject: document.getElementById("btn-confirm-create-project"),
    changeProjectLocation: document.getElementById("btn-change-project-location"),
    cancelCreateProject: document.getElementById("btn-cancel-create-project"),
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
    ccAcceptanceBullets: document.getElementById("cc-acceptance-bullets"),
    ccAcceptanceReco: document.getElementById("cc-acceptance-reco"),
    ccTechEvidence: document.getElementById("cc-tech-evidence"),
    ccTechBullets: document.getElementById("cc-tech-bullets"),
    executorSetupMessage: document.getElementById("executor-setup-message"),
    codingCapScanList: document.getElementById("coding-cap-scan-list"),
    codingCapInstallPanel: document.getElementById("coding-cap-install-panel"),
    codingCapInstallBody: document.getElementById("coding-cap-install-body"),
    codingUseInstalled: document.getElementById("btn-coding-use-installed"),
    codingInstallRecommended: document.getElementById("btn-coding-install-recommended"),
    codingConnectLater: document.getElementById("btn-coding-connect-later"),
    codingUseCloud: document.getElementById("btn-coding-use-cloud"),
    codingOpenGuide: document.getElementById("btn-coding-open-guide"),
    codingBackOnboarding: document.getElementById("btn-coding-back-onboarding"),
    settingsCodingCapabilities: document.getElementById("settings-coding-capabilities"),
    settingsCodingAdvancedName: document.getElementById("settings-coding-advanced-name"),
    executorGotoSettings: document.getElementById("btn-executor-goto-settings"),
    executorRecheck: document.getElementById("btn-executor-recheck"),
    executionConfirmCard: document.getElementById("execution-confirm-card"),
    executionConfirmTitle: document.getElementById("execution-confirm-title"),
    executionConfirmNotice: document.getElementById("execution-confirm-notice"),
    executionConfirmExecutor: document.getElementById("execution-confirm-executor"),
    executionConfirmProject: document.getElementById("execution-confirm-project"),
    executionConfirmDir: document.getElementById("execution-confirm-dir"),
    executionConfirmAllowed: document.getElementById("execution-confirm-allowed"),
    executionConfirmAccept: document.getElementById("execution-confirm-accept"),
    executionConfirmDonot: document.getElementById("execution-confirm-donot"),
    executionConfirmForbidden: document.getElementById("execution-confirm-forbidden"),
    executionConfirmUnderstanding: document.getElementById("execution-confirm-understanding"),
    executionConfirmUnderstandingList: document.getElementById("execution-confirm-understanding-list"),
    confirmExecution: document.getElementById("btn-confirm-execution"),
    cancelExecution: document.getElementById("btn-cancel-execution"),
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
  let confirmSubmitInFlight = false;
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

  function hideExecutorSetupCard() {
    if (!els.executorSetupCard) return;
    els.executorSetupCard.hidden = true;
    els.executorSetupCard.setAttribute("hidden", "");
    pendingCodingOnboarding = null;
    if (els.codingCapScanList) {
      els.codingCapScanList.hidden = true;
      els.codingCapScanList.innerHTML = "";
    }
    if (els.codingCapInstallPanel) {
      els.codingCapInstallPanel.hidden = true;
      els.codingCapInstallPanel.setAttribute("hidden", "");
    }
    if (els.codingOpenGuide) els.codingOpenGuide.hidden = true;
    if (els.codingBackOnboarding) els.codingBackOnboarding.hidden = true;
  }

  function showExecutorSetupCard(payloadOrMessage) {
    hideExecutionConfirmCard();
    hideProjectFolderCard();
    if (!els.executorSetupCard) return;
    const payload =
      payloadOrMessage && typeof payloadOrMessage === "object"
        ? payloadOrMessage
        : {
            message:
              payloadOrMessage ||
              "尚未检测到可用的代码执行能力。",
            title: "完成这项任务需要代码执行能力",
            description:
              "Digital Me 会使用它在你确认的项目目录中创建或修改代码，并运行测试。",
          };
    pendingCodingOnboarding = payload;
    els.executorSetupCard.hidden = false;
    els.executorSetupCard.removeAttribute("hidden");
    if (els.executorSetupTitle) {
      els.executorSetupTitle.textContent = payload.title || "完成这项任务需要代码执行能力";
    }
    if (els.executorSetupDescription) {
      els.executorSetupDescription.textContent =
        payload.description ||
        "Digital Me 会使用它在你确认的项目目录中创建或修改代码，并运行测试。";
    }
    if (els.executorSetupMessage) {
      els.executorSetupMessage.textContent =
        payload.message ||
        "尚未检测到可用的代码执行能力。";
    }
    const actions = payload.actions || [
      "use_installed",
      "install_recommended",
      "connect_later",
    ];
    if (els.codingUseCloud) {
      const showCloud = actions.includes("use_cloud");
      els.codingUseCloud.hidden = !showCloud;
      if (showCloud) els.codingUseCloud.removeAttribute("hidden");
      else els.codingUseCloud.setAttribute("hidden", "");
    }
    if (els.codingCapScanList) {
      els.codingCapScanList.hidden = true;
      els.codingCapScanList.innerHTML = "";
    }
    if (els.codingCapInstallPanel) {
      els.codingCapInstallPanel.hidden = true;
      els.codingCapInstallPanel.setAttribute("hidden", "");
    }
    if (els.codingOpenGuide) {
      els.codingOpenGuide.hidden = true;
      els.codingOpenGuide.setAttribute("hidden", "");
    }
    if (els.codingBackOnboarding) {
      els.codingBackOnboarding.hidden = true;
      els.codingBackOnboarding.setAttribute("hidden", "");
    }
    if (Array.isArray(payload.capabilities)) {
      lastCodingCapabilities = payload.capabilities;
    }
    if (payload.recommended) lastCodingRecommendation = payload.recommended;
    refreshWorkUxView({ executorSetupCard: true });
  }

  function renderCodingScanList(caps) {
    if (!els.codingCapScanList) return;
    els.codingCapScanList.innerHTML = "";
    els.codingCapScanList.hidden = false;
    els.codingCapScanList.removeAttribute("hidden");
    const list = Array.isArray(caps) ? caps : [];
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "尚未检测到可用的代码执行能力。";
      els.codingCapScanList.appendChild(p);
      return;
    }
    for (const cap of list) {
      const item = document.createElement("div");
      item.className = "coding-cap-item";
      const title = document.createElement("div");
      title.className = "coding-cap-title";
      title.textContent = `${cap.displayName} · ${cap.connectionStatus || ""}`;
      const msg = document.createElement("div");
      msg.className = "muted tiny";
      msg.textContent = cap.actionableMessage || cap.executionModeLabel || "";
      item.appendChild(title);
      item.appendChild(msg);
      const row = document.createElement("div");
      row.className = "row";
      if (cap.availability === "ready" && cap.supportsAutomaticExecution) {
        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.className = "primary";
        useBtn.textContent = "使用此能力";
        useBtn.addEventListener("click", () => resumePendingSoftwareTask(cap.capabilityId));
        row.appendChild(useBtn);
      } else if (cap.availability === "needs_login") {
        const checkBtn = document.createElement("button");
        checkBtn.type = "button";
        checkBtn.className = "ghost";
        checkBtn.textContent = "检查连接";
        checkBtn.addEventListener("click", async () => {
          await refreshExecutorCapabilityUi(true);
          await scanInstalledCodingCapabilities();
        });
        row.appendChild(checkBtn);
        const guideBtn = document.createElement("button");
        guideBtn.type = "button";
        guideBtn.className = "ghost";
        guideBtn.textContent = "打开连接说明";
        guideBtn.addEventListener("click", () => openSettings());
        row.appendChild(guideBtn);
      } else if (cap.availability === "unsupported" || cap.invocationKind === "desktop_handoff") {
        const already =
          /不能.*自动调用|无法自动使用/.test(String(cap.actionableMessage || "")) ||
          /不能.*自动调用|无法自动使用/.test(String(cap.executionModeLabel || ""));
        if (!already) {
          const note = document.createElement("p");
          note.className = "muted tiny";
          note.textContent = "检测到该工具，但当前还不能由 Digital Me 自动调用。";
          item.appendChild(note);
        }
      }
      if (row.childNodes.length) item.appendChild(row);
      els.codingCapScanList.appendChild(item);
    }
  }

  function showCodingInstallPanel() {
    if (!els.codingCapInstallPanel || !els.codingCapInstallBody) return;
    const rec = lastCodingRecommendation || (pendingCodingOnboarding && pendingCodingOnboarding.recommended);
    els.codingCapInstallPanel.hidden = false;
    els.codingCapInstallPanel.removeAttribute("hidden");
    if (els.codingCapScanList) {
      els.codingCapScanList.hidden = true;
      els.codingCapScanList.setAttribute("hidden", "");
    }
    const perms = (rec && rec.permissions) || [];
    els.codingCapInstallBody.innerHTML = "";
    const lines = [
      `能完成什么：${(rec && rec.canDo) || "在确认的项目目录中修改代码并运行测试。"}`,
      `为什么需要：${(rec && rec.whyNeeded) || "软件开发任务需要可自动执行的代码能力。"}`,
      `安装后 Digital Me 可以获得：${perms.join("；") || "在确认范围内读写项目文件并运行测试"}`,
      `安装由谁提供：${(rec && rec.installProvider) || "由该能力的官方安装渠道提供"}`,
      "不会自动 commit、push 或部署。",
    ];
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      els.codingCapInstallBody.appendChild(p);
    }
    if (els.codingOpenGuide) {
      els.codingOpenGuide.hidden = false;
      els.codingOpenGuide.removeAttribute("hidden");
    }
    if (els.codingBackOnboarding) {
      els.codingBackOnboarding.hidden = false;
      els.codingBackOnboarding.removeAttribute("hidden");
    }
  }

  async function scanInstalledCodingCapabilities() {
    const listed = await api.invoke("capability.list", { includeAvailability: true });
    lastCodingCapabilities = (listed && listed.codingCapabilities) || [];
    lastCodingRecommendation = (listed && listed.codingRecommendation) || lastCodingRecommendation;
    renderCodingScanList(lastCodingCapabilities);
    const ready = lastCodingCapabilities.find(
      (c) => c.availability === "ready" && c.supportsAutomaticExecution,
    );
    if (ready) {
      els.jobStatus.textContent = "已找到可用的代码执行能力";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "可点击「使用此能力」继续。";
    } else {
      els.jobStatus.textContent = "尚未找到可自动使用的代码执行能力";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "可安装推荐能力，或稍后连接。";
    }
    return listed;
  }

  async function resumePendingSoftwareTask(capabilityId) {
    const goal = (els.goal && els.goal.value ? els.goal.value : "").trim();
    if (!goal) {
      els.jobStatus.textContent = "请先填写任务目标";
      els.jobStatus.classList.add("error");
      return;
    }
    const payload = {
      goal,
      contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path, ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}) })),
    };
    if (capabilityId) payload.capabilityId = capabilityId;
    workMode = "compose";
    const result = await api.invoke("work.submitTask", payload);
    if (result.needsProjectFolder) {
      showProjectFolderCard(result.needsProjectFolder.message || result.userFacingNotice);
      return;
    }
    if (result.needsExecutorSetup) {
      showExecutorSetupCard(result.needsExecutorSetup);
      return;
    }
    if (result.needsExecutionConfirm) {
      pendingExecutionConfirm = {
        goal,
        contextRefs: payload.contextRefs,
        preview: result.needsExecutionConfirm,
        capabilityId:
          capabilityId ||
          result.needsExecutionConfirm.selectedCapabilityId ||
          null,
      };
      showExecutionConfirmCard(result.needsExecutionConfirm);
      els.jobStatus.textContent = "开始前请确认项目与修改权限";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = result.needsExecutionConfirm.notice || "";
      return;
    }
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
      showExecutorSetupCard({
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
    activeAcceptanceSummary = codeChange.acceptanceSummary || null;
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
      if (acc) {
        els.ccAcceptanceSection.hidden = false;
        els.ccAcceptanceSection.removeAttribute("hidden");
        if (els.ccAcceptanceTitle) els.ccAcceptanceTitle.textContent = acc.title || "Digital Me 检查结果";
        if (els.ccAcceptanceExec) {
          els.ccAcceptanceExec.textContent =
            acc.executionStatusLabel || "本次处理已结束";
        }
        if (els.ccAcceptanceGoal) {
          els.ccAcceptanceGoal.textContent = acc.headline || acc.goalLabel || "无法验证";
          els.ccAcceptanceGoal.className =
            "cc-acceptance-goal" +
            (acc.canAdoptSuggested ? " is-ok" : acc.canAdoptSuggested === false ? " is-warn" : " is-bad");
        }
        if (els.ccAcceptanceBullets) {
          els.ccAcceptanceBullets.innerHTML = "";
          for (const b of acc.bullets || []) {
            if (/命中关键词|keyword matching|goal_alignment/i.test(String(b))) continue;
            const li = document.createElement("li");
            li.textContent = b;
            els.ccAcceptanceBullets.appendChild(li);
          }
        }
        if (els.ccAcceptanceReco) {
          els.ccAcceptanceReco.textContent = "建议：" + (acc.recommendation || "暂不建议采用");
          els.ccAcceptanceReco.className =
            "cc-acceptance-reco" + (acc.canAdoptSuggested ? " is-ok" : " is-warn");
        }
        const tech = acc.technicalBullets || [];
        if (els.ccTechEvidence && els.ccTechBullets) {
          if (tech.length) {
            els.ccTechEvidence.hidden = false;
            els.ccTechEvidence.removeAttribute("hidden");
            els.ccTechBullets.innerHTML = "";
            for (const t of tech) {
              const li = document.createElement("li");
              li.textContent = t;
              els.ccTechBullets.appendChild(li);
            }
          } else {
            els.ccTechEvidence.hidden = true;
            els.ccTechEvidence.setAttribute("hidden", "");
          }
        }
      } else {
        els.ccAcceptanceSection.hidden = true;
        els.ccAcceptanceSection.setAttribute("hidden", "");
      }
    }
    if (els.ccSummary) {
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
      els.ccSummary.textContent = brief || "已完成本次项目修改。";
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
    const understanding = codeChange.understanding || null;
    if (els.ccUnderstandingSection) {
      const goalText = String((understanding && understanding.goal) || "").trim();
      const keyFiles = (understanding && understanding.keyFiles) || [];
      if (goalText || keyFiles.length) {
        els.ccUnderstandingSection.hidden = false;
        els.ccUnderstandingSection.removeAttribute("hidden");
        if (els.ccUnderstandingGoal) {
          els.ccUnderstandingGoal.textContent = goalText || "已根据项目材料形成任务理解。";
        }
        if (els.ccUnderstandingFiles) {
          els.ccUnderstandingFiles.innerHTML = "";
          for (const f of keyFiles.slice(0, 10)) {
            const li = document.createElement("li");
            li.textContent = f.reason ? `${f.path}：${f.reason}` : f.path;
            els.ccUnderstandingFiles.appendChild(li);
          }
        }
      } else {
        els.ccUnderstandingSection.hidden = true;
        els.ccUnderstandingSection.setAttribute("hidden", "");
      }
    }
    if (els.ccPlanSection && els.ccPlanList) {
      const steps = (understanding && understanding.planSteps) || [];
      if (steps.length) {
        els.ccPlanSection.hidden = false;
        els.ccPlanSection.removeAttribute("hidden");
        els.ccPlanList.innerHTML = "";
        for (const step of steps.slice(0, 8)) {
          const li = document.createElement("li");
          li.textContent = step;
          els.ccPlanList.appendChild(li);
        }
      } else {
        els.ccPlanSection.hidden = true;
        els.ccPlanSection.setAttribute("hidden", "");
        els.ccPlanList.innerHTML = "";
      }
    }
    const risks = (codeChange.risks || (understanding && understanding.risks) || []).filter(Boolean);
    if (els.ccRisksSection && els.ccRisksList) {
      if (risks.length) {
        els.ccRisksSection.hidden = false;
        els.ccRisksSection.removeAttribute("hidden");
        els.ccRisksList.innerHTML = "";
        for (const item of risks.slice(0, 12)) {
          const li = document.createElement("li");
          li.textContent = item;
          els.ccRisksList.appendChild(li);
        }
      } else {
        els.ccRisksSection.hidden = true;
        els.ccRisksSection.setAttribute("hidden", "");
        els.ccRisksList.innerHTML = "";
      }
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
    activeAcceptanceSummary = null;
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
    if (softwareTask && codeChangeArtifact) {
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
        return "处理中";
      case "completed":
        return "需要你确认";
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
          return detail.artifactIds && detail.artifactIds[0] ? "需要你确认" : "需要处理";
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

  function hideProjectFolderCard() {
    if (!els.projectFolderCard) return;
    els.projectFolderCard.hidden = true;
    els.projectFolderCard.setAttribute("hidden", "");
    pendingCreateProject = null;
    if (els.projectCreateConfirm) {
      els.projectCreateConfirm.hidden = true;
      els.projectCreateConfirm.setAttribute("hidden", "");
    }
    if (els.projectFolderActions) {
      els.projectFolderActions.hidden = false;
      els.projectFolderActions.removeAttribute("hidden");
    }
  }

  function showProjectFolderCard(message) {
    hideExecutionConfirmCard();
    hideExecutorSetupCard();
    if (!els.projectFolderCard) return;
    els.projectFolderCard.hidden = false;
    els.projectFolderCard.removeAttribute("hidden");
    if (els.projectFolderMessage) {
      els.projectFolderMessage.textContent =
        message || "这项任务需要一个项目位置。可由 Digital Me 创建新项目，或使用你已有的项目。";
    }
    if (els.projectCreateConfirm) {
      els.projectCreateConfirm.hidden = true;
      els.projectCreateConfirm.setAttribute("hidden", "");
    }
    if (els.projectFolderActions) {
      els.projectFolderActions.hidden = false;
      els.projectFolderActions.removeAttribute("hidden");
    }
    refreshWorkUxView({ projectFolderCard: true });
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
    resetArtifactProjection();
    hideRevisionActiveBanner();
    resetCollabUi();
    copyBlockedFailed = false;
    setCopyEnabled(false);
    if (els.artifactEmpty) {
      els.artifactEmpty.hidden = true;
      els.artifactEmpty.setAttribute("hidden", "");
    }
    if (els.decisionBox) {
      els.decisionBox.hidden = true;
      els.decisionBox.setAttribute("hidden", "");
    }
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
    box.hidden = false;
    box.removeAttribute("hidden");
    if (els.revisionComposerTitle) {
      els.revisionComposerTitle.textContent = continueMode
        ? "继续修改"
        : "继续修改这项成果";
    }
    if (els.revisionRequest && !(els.revisionRequest.value || "").trim()) {
      els.revisionRequest.placeholder =
        "说明还需要修改什么。可粘贴截图，或点击「添加截图」。";
    }
    updateRevisionShotHint();
    if (els.revisionRequest) els.revisionRequest.focus();
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
      els.decisionStatus.textContent = "这份成果未采用";
      if (noteField) noteField.hidden = true;
    } else {
      els.decisionStatus.textContent = "请确认成果";
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

  function startNewTaskComposer(seed) {
    bumpUiEpoch();
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
    hideExecutionConfirmCard();
    hideProjectFolderCard();
    hideExecutorSetupCard();
    clearArtifactView();
    setWorkCollabVisible(false);
    if (els.restartCompose) els.restartCompose.hidden = true;
    if (els.submit) {
      els.submit.hidden = false;
      els.submit.removeAttribute("hidden");
      els.submit.disabled = false;
    }
    setWorkStage("center");
    setWorkTasksOpen(false);
    syncGoalPresentation();
    refreshTasks();
    if (!(seed && seed.preservePending)) {
      void api.invoke("capability.list", { codingAction: { type: "clear_pending" } }).catch(() => {});
    }
    requestAnimationFrame(() => {
      if (els.goal && workMode === "compose") els.goal.focus();
    });
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
    return {
      workMode,
      modelReady: lastModelReady !== false,
      projectFolderCard: !!(els.projectFolderCard && !els.projectFolderCard.hidden),
      projectCreateConfirm: !!(els.projectCreateConfirm && !els.projectCreateConfirm.hidden),
      projectDirReady,
      executorSetupCard: !!(els.executorSetupCard && !els.executorSetupCard.hidden),
      executionConfirmCard: !!(els.executionConfirmCard && !els.executionConfirmCard.hidden),
      ownerChoicePrompt: !!(els.ownerChoicePrompt && !els.ownerChoicePrompt.hidden),
      revisionComposerOpen: revisionOpen,
      adoptWarningOpen: adoptWarn,
      jobStatus: js,
      hasArtifact: !!activeArtifactId,
      decisionStatus: lastDecisionStatus,
      canAdoptSuggested:
        acc && typeof acc.canAdoptSuggested === "boolean" ? acc.canAdoptSuggested : null,
      codeChange: isActiveSoftwareCodeChangeProjection(),
      canTryRun: canTry,
      startupFailed,
      hasWorkingDirectory: !!activeCodeChangeWorkingDirectory && isActiveSoftwareCodeChangeProjection(),
      jobCancelSupported: true,
      ...(extra || {}),
    };
  }

  const WORK_UX_EL_BY_ID = () => ({
    start_submit: els.submit,
    cancel_job: els.cancel,
    retry_job: els.retry,
    create_project: els.createNewProject,
    pick_existing_project: els.pickExistingProject,
    confirm_create_project: els.confirmCreateProject,
    change_project_location: els.changeProjectLocation,
    cancel_create_project: els.cancelCreateProject,
    confirm_execution: els.confirmExecution,
    cancel_execution: els.cancelExecution,
    coding_connect: els.codingUseInstalled,
    coding_later: els.codingConnectLater,
    coding_install: els.codingInstallRecommended,
    coding_settings: els.executorGotoSettings,
    coding_recheck: els.executorRecheck,
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
    if (actionId === "continue_revise") {
      // 继续修改必须走既有 revision 入口，不能藏进警告卡
      return facts.adoptWarningOpen ? els.adoptContinueRevise || els.proposeRevision : els.proposeRevision;
    }
    if (actionId === "adopt_anyway") {
      return facts.adoptWarningOpen ? els.adoptAnyway || els.acceptArtifact : els.acceptArtifact;
    }
    if (actionId === "tell_what_wrong") return els.proposeRevision;
    return byId[actionId] || null;
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

    for (const action of view.actions || []) {
      if (action.id === "try_run") continue;
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

    setElVisible(els.workMoreMenu, hasMore);

    if (view.stage === "needs_capability" && facts.executorSetupCard) {
      setElVisible(els.codingUseInstalled, true);
      if (els.codingUseInstalled) {
        els.codingUseInstalled.textContent = "连接代码执行能力";
        els.codingUseInstalled.classList.add("primary");
        els.codingUseInstalled.disabled = false;
      }
      setElVisible(els.codingConnectLater, true);
      if (els.codingConnectLater) els.codingConnectLater.disabled = false;
      setElVisible(els.codingOnboardingMore, true);
      setElVisible(els.codingInstallRecommended, true);
      setElVisible(els.executorGotoSettings, true);
      setElVisible(els.executorRecheck, true);
    }

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
    // 决策按钮：计划中则明确启用；running/blocked 等已在基线隐藏
    if (els.acceptArtifact) {
      const showAccept =
        planned.has("accept") ||
        (planned.has("adopt_anyway") && !facts.adoptWarningOpen);
      if (showAccept) els.acceptArtifact.disabled = false;
    }
    if (els.rejectArtifact && planned.has("reject")) {
      els.rejectArtifact.disabled = false;
    }
    if (els.proposeRevision) {
      const showPropose =
        planned.has("propose_revision") ||
        (planned.has("continue_revise") && !facts.adoptWarningOpen) ||
        planned.has("tell_what_wrong");
      if (showPropose) els.proposeRevision.disabled = false;
    }

    if (els.decisionHint) {
      setElVisible(els.decisionHint, !view.hideDecisionHint && !!els.decisionHint.textContent);
    }
    if (els.ccRestoreHint) setElVisible(els.ccRestoreHint, false);
    if (els.ccRestoreRow) {
      setElVisible(els.ccRestoreRow, planned.has("restore_baseline"));
    }
    if (els.workAssistEntries) setElVisible(els.workAssistEntries, false);

    if (view.statusLine && els.jobStatus && workMode === "compose" && !facts.executorSetupCard) {
      // drafting: 不强制改状态
    } else if (
      view.statusLine &&
      els.jobStatus &&
      (facts.executorSetupCard || facts.projectFolderCard || facts.projectCreateConfirm || facts.executionConfirmCard)
    ) {
      if (!els.jobStatus.textContent || /开始处理|需要代码执行|项目位置|确认/.test(els.jobStatus.textContent)) {
        els.jobStatus.textContent = view.statusLine;
      }
      if (els.jobActionable && /已检测|尚未检测|完成这项任务需要/.test(els.jobActionable.textContent || "")) {
        els.jobActionable.textContent = "";
      }
    }

    document.body.dataset.workUxStage = view.stage;
    return view;
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
    // 更多：恢复等
    const moreActs = planned.filter((a) => a.slot === "more" && a.column === "right");
    if (moreActs.length && els.nextStepsActions) {
      const details = document.createElement("details");
      details.className = "work-more-menu";
      const summary = document.createElement("summary");
      summary.textContent = "更多";
      details.appendChild(summary);
      const row = document.createElement("div");
      row.className = "row work-more-actions";
      for (const a of moreActs) {
        if (a.id === "restore_baseline" && els.restoreBaseline) {
          setElVisible(els.restoreBaseline, true);
          row.appendChild(els.restoreBaseline);
        } else if (a.id === "tell_what_wrong") {
          addBtn(a.label, false, () => {
            showRevisionComposer({ continueMode: true });
          });
        }
      }
      details.appendChild(row);
      els.nextStepsActions.appendChild(details);
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
      els.jobStatus.textContent = rev ? "正在按你的修改要求继续处理…" : "正在处理这项任务…";
      els.jobStatus.classList.remove("error");
      clearAppliedUnderstanding();
      applyJobControls(detail, connected);
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
    // 原子切换：立即清掉上一任务的中右栏与材料，避免串态
    materials = [];
    renderMaterials();
    clearMaterialSummary();
    hideExecutionConfirmCard();
    hideProjectFolderCard();
    hideExecutorSetupCard();
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
    activeJobId = detail.latestJob ? detail.latestJob.jobId : null;
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
      nextMaterials.unshift({
        kind: "folder",
        path: detail.latestJob.externalExecution.workingDirectory,
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
        els.artifactEmpty.hidden = false;
        els.artifactEmpty.removeAttribute("hidden");
        els.artifactEmpty.textContent = "处理完成后将在这里显示成果。";
      }
      els.jobStatus.textContent = rev ? "正在按你的修改要求继续处理…" : "正在处理这项任务…";
      clearAppliedUnderstanding();
      refreshWorkUxView({});
    } else {
      stopJobWatch();
      hideRevisionActiveBanner();
      if (
        detail.latestJob &&
        detail.latestJob.status === "succeeded" &&
        detail.artifactIds &&
        detail.artifactIds[0]
      ) {
        copyBlockedFailed = false;
        await loadArtifact(detail.artifactIds[0], { taskId, epoch });
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
    copyBlockedFailed = false;
    if (els.artifactEmpty) {
      els.artifactEmpty.hidden = true;
      els.artifactEmpty.setAttribute("hidden", "");
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
    if (els.acceptArtifact) els.acceptArtifact.disabled = !!blockAcceptForStaleDir;
    if (els.rejectArtifact) els.rejectArtifact.disabled = false;
    hideArtifactLoading();
    refreshWorkUxView({});
    if (blockAcceptForStaleDir && els.acceptArtifact) els.acceptArtifact.disabled = true;
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
    startNewTaskComposer({ preservePending: true });
    await refreshConnectionFromCapabilities();
    await refreshTasks();
    await refreshSubjectPanel();
    await restorePendingSoftwareDraftIfAny();
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
      startNewTaskComposer();
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
            opt.textContent = "请先在设置中连接另一个 Digital Me";
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
        showStatus(els.collabSignalStatus, "请先在设置中连接另一个 Digital Me。", true);
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
    const folder = await api.dialogs.pickOpenDirectory();
    if (!folder) return;
    let softwareProject = null;
    try {
      if (typeof api.inspectSoftwareProject === "function") {
        softwareProject = await api.inspectSoftwareProject(folder);
      }
    } catch {
      softwareProject = null;
    }
    materials.push({
      kind: "folder",
      path: folder,
      ...(softwareProject ? { softwareProject } : {}),
    });
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
      hideProjectFolderCard();
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
    if (els.projectFolderActions) {
      els.projectFolderActions.hidden = true;
      els.projectFolderActions.setAttribute("hidden", "");
    }
    if (els.projectCreateConfirm) {
      els.projectCreateConfirm.hidden = false;
      els.projectCreateConfirm.removeAttribute("hidden");
    }
    if (els.projectCreatePath) els.projectCreatePath.textContent = pathText;
    // 必须重新派生，否则「确认并开始」会保持上一轮 hidden
    refreshWorkUxView({ projectFolderCard: true, projectCreateConfirm: true });
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
    hideProjectFolderCard();
    els.jobStatus.textContent = reused
      ? "已沿用本任务的项目文件夹。"
      : "已创建新项目文件夹。";
    els.jobStatus.classList.remove("error");
    els.jobActionable.textContent = "";
    // 项目位置已成立：必须自动进入下一门控，不得停在 needs_input / 无按钮
    await advanceAfterProjectLocationReady();
  }

  /**
   * 项目位置只是输入门槛：选定后立即继续提交门控，进入 capability / confirmation。
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
      if (workMode !== "compose") {
        refreshWorkUxView({});
        return;
      }
      const goal = (els.goal && els.goal.value ? String(els.goal.value) : "").trim();
      if (!goal) {
        els.jobStatus.textContent = "请先填写任务目标";
        els.jobStatus.classList.add("error");
        refreshWorkUxView({});
        return;
      }
      const type = selectedArtifactType();
      const payload = {
        goal,
        contextRefs: materials.map((m) => ({
          kind: m.kind,
          path: m.path,
          ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}),
        })),
      };
      if (type) payload.requestedArtifactType = type;
      const result = await api.invoke("work.submitTask", payload);
      await applySubmitTaskResult(result, payload, goal);
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
      refreshWorkUxView({});
    } finally {
      await refreshConnectionFromCapabilities();
      if (els.submit) els.submit.disabled = false;
    }
  }

  async function applySubmitTaskResult(result, payload, goal) {
    if (result.needsProjectFolder) {
      showProjectFolderCard(result.needsProjectFolder.message || result.userFacingNotice);
      els.jobStatus.textContent = "这项任务需要一个项目位置";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "可由 Digital Me 创建新项目，或使用你已有的项目。";
      clearArtifactView();
      refreshWorkUxView({ projectFolderCard: true, projectDirReady: false });
      return "needs_project";
    }
    if (result.needsExecutorSetup) {
      showExecutorSetupCard(result.needsExecutorSetup);
      els.jobStatus.textContent = "请先连接可用的代码执行能力";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "可连接代码执行能力，或稍后连接后继续。";
      refreshWorkUxView({ executorSetupCard: true, projectDirReady: true });
      return "needs_capability";
    }
    if (result.needsExecutionConfirm) {
      pendingExecutionConfirm = {
        goal,
        contextRefs: payload.contextRefs,
        preview: result.needsExecutionConfirm,
        capabilityId: result.needsExecutionConfirm.selectedCapabilityId || null,
      };
      showExecutionConfirmCard(result.needsExecutionConfirm);
      els.jobStatus.textContent = "开始前请确认项目与修改权限";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = result.needsExecutionConfirm.notice || "";
      refreshWorkUxView({
        executionConfirmCard: true,
        projectDirReady: true,
        understandingReliable: result.needsExecutionConfirm.understandingReliable !== false,
      });
      return "needs_confirmation";
    }
    workMode = "task";
    activeTaskId = result.taskId;
    activeJobId = result.jobId;
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
    refreshWorkUxView({});
    return "started";
  }

  if (els.createNewProject) {
    els.createNewProject.addEventListener("click", () => beginCreateNewProjectFlow());
  }
  if (els.confirmCreateProject) {
    els.confirmCreateProject.addEventListener("click", () => confirmPendingCreateProject());
  }
  if (els.changeProjectLocation) {
    els.changeProjectLocation.addEventListener("click", async () => {
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
        if (els.projectCreatePath) {
          els.projectCreatePath.textContent =
            "Digital Me 将为这项任务创建项目文件夹：\n" +
            (prepared.displayPath || prepared.path);
        }
        refreshWorkUxView({ projectFolderCard: true, projectCreateConfirm: true });
      } catch (err) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      }
    });
  }
  if (els.cancelCreateProject) {
    els.cancelCreateProject.addEventListener("click", () => {
      pendingCreateProject = null;
      if (els.projectCreateConfirm) {
        els.projectCreateConfirm.hidden = true;
        els.projectCreateConfirm.setAttribute("hidden", "");
      }
      if (els.projectFolderActions) {
        els.projectFolderActions.hidden = false;
        els.projectFolderActions.removeAttribute("hidden");
      }
      refreshWorkUxView({ projectFolderCard: true, projectCreateConfirm: false });
    });
  }
  if (els.pickExistingProject) {
    els.pickExistingProject.addEventListener("click", () => addProjectFolderFromPicker(false));
  }
  if (els.pickEmptyProject) {
    els.pickEmptyProject.addEventListener("click", () => addProjectFolderFromPicker(true));
  }
  if (els.adoptContinueRevise) {
    els.adoptContinueRevise.addEventListener("click", () => {
      hideAdoptWarning();
      showRevisionComposer({ continueMode: true });
    });
  }
  if (els.adoptAnyway) {
    els.adoptAnyway.addEventListener("click", () => {
      hideAdoptWarning();
      void submitArtifactDecision("accept", { forceAdopt: true });
    });
  }

  els.submit.addEventListener("click", async () => {
    try {
      await refreshConnectionFromCapabilities();
      const type = selectedArtifactType();
      if (!canSubmit(lastConnectionState)) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        els.jobActionable.textContent = "前往设置连接真实模型后再开始处理。";
        refreshWorkUxView({ modelReady: false });
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
        contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path, ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}) })),
      };
      // 不强迫传成果类型；Runtime 按意图派生。显式仅在隐藏控件有非空值时透传。
      if (type) payload.requestedArtifactType = type;
      const result = await api.invoke("work.submitTask", payload);
      await applySubmitTaskResult(result, payload, goal);
    } catch (err) {
      els.jobStatus.textContent = userFacingWorkError(err);
      els.jobStatus.classList.add("error");
    } finally {
      await refreshConnectionFromCapabilities();
      if (els.submit) els.submit.disabled = false;
    }
  });

  function hideExecutionConfirmCard() {
    pendingExecutionConfirm = null;
    if (els.executionConfirmCard) {
      els.executionConfirmCard.hidden = true;
      els.executionConfirmCard.setAttribute("hidden", "");
    }
  }

  /**
   * 确认卡「返回修改」：回到可编辑起草态并恢复「开始处理」。
   * 必须刷新 Work UX；否则仍按 needs_confirmation 隐藏提交按钮。
   * 不清除材料、不创建任务/Job、不进入改码。
   */
  function returnFromExecutionConfirmToEdit() {
    hideExecutionConfirmCard();
    workMode = "compose";
    if (els.goal) els.goal.readOnly = false;
    if (els.workComposeTitle) els.workComposeTitle.textContent = "新建任务";
    if (els.submit) {
      els.submit.hidden = false;
      els.submit.removeAttribute("hidden");
      els.submit.disabled = false;
      els.submit.textContent = "开始处理";
      els.submit.classList.add("primary");
      els.submit.classList.remove("ghost");
    }
    setWorkCollabVisible(false);
    syncGoalPresentation();
    refreshWorkUxView({
      workMode: "compose",
      executionConfirmCard: false,
      projectFolderCard: false,
      executorSetupCard: false,
      jobStatus: null,
      hasArtifact: false,
      decisionStatus: null,
    });
  }

  function showExecutionConfirmCard(preview) {
    hideExecutorSetupCard();
    hideProjectFolderCard();
    if (!els.executionConfirmCard) return;
    els.executionConfirmCard.hidden = false;
    els.executionConfirmCard.removeAttribute("hidden");
    if (els.executionConfirmTitle) {
      els.executionConfirmTitle.textContent = preview.title || "这项任务需要修改项目文件";
    }
    if (els.executionConfirmNotice) els.executionConfirmNotice.textContent = preview.notice || "";
    if (els.confirmExecution) {
      const unreliable = preview.understandingReliable === false;
      els.confirmExecution.textContent = unreliable ? "仍要继续" : "确认并开始";
    }
    if (els.executionConfirmExecutor) {
      els.executionConfirmExecutor.textContent = "代码执行能力";
    }
    if (els.executionConfirmProject) {
      els.executionConfirmProject.textContent =
        preview.projectName || basenamePath(preview.workingDirectory || "") || "（未命名项目）";
    }
    if (els.executionConfirmDir) els.executionConfirmDir.textContent = preview.workingDirectory || "";
    const acc = preview.acceptancePreview || {};
    if (els.executionConfirmAccept) {
      const parts = []
        .concat(acc.goals || [])
        .concat(acc.tests || []);
      els.executionConfirmAccept.textContent = parts.filter(Boolean).join("；") || "按任务目标验收";
    }
    if (els.executionConfirmAllowed) {
      els.executionConfirmAllowed.textContent = (preview.allowed || []).join("；") ||
        "读取当前项目文件；修改确认范围内文件；运行本地测试";
    }
    if (els.executionConfirmDonot) {
      const lines = (preview.forbidden || []).concat(acc.doNotDo || []);
      els.executionConfirmDonot.textContent = [...new Set(lines)].slice(0, 8).join("；");
    }
    if (els.executionConfirmUnderstanding && els.executionConfirmUnderstandingList) {
      const summaryLines = (preview.understandingSummary || [])
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      if (summaryLines.length) {
        els.executionConfirmUnderstanding.hidden = false;
        els.executionConfirmUnderstanding.removeAttribute("hidden");
        els.executionConfirmUnderstandingList.innerHTML = "";
        for (const line of summaryLines.slice(0, 8)) {
          const li = document.createElement("li");
          li.textContent = line;
          els.executionConfirmUnderstandingList.appendChild(li);
        }
      } else {
        els.executionConfirmUnderstanding.hidden = true;
        els.executionConfirmUnderstanding.setAttribute("hidden", "");
        els.executionConfirmUnderstandingList.innerHTML = "";
      }
    }
    if (els.executionConfirmForbidden) {
      els.executionConfirmForbidden.innerHTML = "";
      els.executionConfirmForbidden.hidden = true;
      els.executionConfirmForbidden.setAttribute("hidden", "");
    }
    refreshWorkUxView({
      executionConfirmCard: true,
      understandingReliable: preview.understandingReliable !== false,
    });
  }

  async function startTaskAfterConfirm(payload) {
    els.submit.disabled = true;
    clearArtifactView();
    hideExecutionConfirmCard();
    const result = await api.invoke("work.submitTask", payload);
    if (result.needsExecutorSetup) {
      showExecutorSetupCard(result.needsExecutorSetup);
      els.submit.disabled = false;
      return;
    }
    if (result.needsExecutionConfirm) {
      pendingExecutionConfirm = {
        goal: payload.goal,
        contextRefs: payload.contextRefs,
        preview: result.needsExecutionConfirm,
        capabilityId:
          payload.capabilityId ||
          result.needsExecutionConfirm.selectedCapabilityId ||
          null,
      };
      showExecutionConfirmCard(result.needsExecutionConfirm);
      els.submit.disabled = false;
      return;
    }
    workMode = "task";
    activeTaskId = result.taskId;
    activeJobId = result.jobId;
    activeTaskIntentKind = result.intentKind || null;
    activeTaskRequestedArtifactType =
      result.intentKind === "modify_code" ? "code-change" : result.intentKind === "analyze_code" ? "code-analysis" : "document";
    els.goal.readOnly = true;
    if (els.workComposeTitle) els.workComposeTitle.textContent = "当前任务";
    setWorkCollabVisible(true);
    syncGoalPresentation();
    if (result.userFacingNotice) {
      els.jobStatus.textContent = result.userFacingNotice;
      els.jobStatus.classList.remove("error");
    }
    await syncActiveTaskStatus();
    startJobWatch(activeTaskId);
  }

  if (els.confirmExecution) {
    els.confirmExecution.addEventListener("click", async () => {
      try {
        if (!pendingExecutionConfirm || confirmSubmitInFlight) return;
        confirmSubmitInFlight = true;
        const preview = pendingExecutionConfirm.preview;
        const confirmPayload = {
          goal: pendingExecutionConfirm.goal,
          contextRefs: pendingExecutionConfirm.contextRefs.map((r) => {
            const mat = materials.find((m) => m.path === r.path);
            return {
              kind: r.kind,
              path: r.path,
              ...(mat && mat.projectOrigin ? { projectOrigin: mat.projectOrigin } : {}),
              ...(preview.projectOrigin && r.kind === "folder"
                ? { projectOrigin: preview.projectOrigin }
                : {}),
            };
          }),
          executionAuthorization: {
            confirmed: true,
            workingDirectory: preview.workingDirectory,
            readScope: preview.readScope,
            writeScope: preview.writeScope,
            ...(preview.projectOrigin ? { projectOrigin: preview.projectOrigin } : {}),
            ...(materials.find((m) => m.kind === "folder" && m.projectOrigin)
              ? {
                  projectOrigin: materials.find((m) => m.kind === "folder" && m.projectOrigin)
                    .projectOrigin,
                }
              : {}),
          },
        };
        if (pendingExecutionConfirm.capabilityId) {
          confirmPayload.capabilityId = pendingExecutionConfirm.capabilityId;
        } else if (preview.selectedCapabilityId) {
          confirmPayload.capabilityId = preview.selectedCapabilityId;
        }
        await startTaskAfterConfirm(confirmPayload);
      } catch (err) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      } finally {
        confirmSubmitInFlight = false;
        els.submit.disabled = false;
        await refreshConnectionFromCapabilities();
      }
    });
  }

  if (els.cancelExecution) {
    els.cancelExecution.addEventListener("click", () => {
      returnFromExecutionConfirmToEdit();
      els.jobStatus.textContent = "已返回修改";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "可调整目标或材料后再次开始。";
    });
  }

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

  if (els.executorGotoSettings) {
    els.executorGotoSettings.addEventListener("click", () => {
      if (typeof openSettings === "function") openSettings();
    });
  }

  if (els.executorRecheck) {
    els.executorRecheck.addEventListener("click", async () => {
      try {
        const listed = await refreshExecutorCapabilityUi(true);
        const card = listed && listed.executorCapabilityCard;
        const available = !!(card && card.available);
        if (available) {
          await resumePendingSoftwareTask(
            (listed && listed.preferredCodingCapabilityId) || card.capabilityId,
          );
        } else {
          showExecutorSetupCard(
            pendingCodingOnboarding || {
              message: (card && card.detail) || "尚未检测到可用的代码执行能力。",
            },
          );
          els.jobStatus.textContent = "代码执行能力尚未就绪";
          els.jobStatus.classList.remove("error");
          els.jobActionable.textContent = (card && card.detail) || "请安装或连接后再试。";
        }
      } catch {
        els.jobActionable.textContent = "重新检查未完成，请稍后再试。";
      }
    });
  }

  if (els.codingUseInstalled) {
    els.codingUseInstalled.addEventListener("click", async () => {
      try {
        await scanInstalledCodingCapabilities();
      } catch (err) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      }
    });
  }
  if (els.codingInstallRecommended) {
    els.codingInstallRecommended.addEventListener("click", () => {
      showCodingInstallPanel();
    });
  }
  if (els.codingConnectLater) {
    els.codingConnectLater.addEventListener("click", async () => {
      try {
        const goal = (els.goal && els.goal.value ? els.goal.value : "").trim();
        await api.invoke("capability.list", {
          codingAction: {
            type: "save_pending",
            goal,
            contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path, ...(m.projectOrigin ? { projectOrigin: m.projectOrigin } : {}) })),
          },
        });
        hideExecutorSetupCard();
        els.jobStatus.textContent = "连接代码执行能力后可继续";
        els.jobStatus.classList.remove("error");
        els.jobActionable.textContent = "目标和项目材料已保留，不会创建失败任务。";
        if (els.workComposeTitle) els.workComposeTitle.textContent = "待继续的任务";
      } catch (err) {
        els.jobStatus.textContent = userFacingWorkError(err);
        els.jobStatus.classList.add("error");
      }
    });
  }
  if (els.codingOpenGuide) {
    els.codingOpenGuide.addEventListener("click", () => {
      const url =
        (lastCodingRecommendation && lastCodingRecommendation.installGuideUrl) ||
        (pendingCodingOnboarding &&
          pendingCodingOnboarding.recommended &&
          pendingCodingOnboarding.recommended.installGuideUrl) ||
        "";
      if (url && window.digitalMe && typeof window.digitalMe.openExternal === "function") {
        window.digitalMe.openExternal(url);
      } else if (url) {
        els.jobActionable.textContent = `请在浏览器打开安装说明：${url}`;
      } else {
        openSettings();
      }
    });
  }
  if (els.codingBackOnboarding) {
    els.codingBackOnboarding.addEventListener("click", () => {
      if (els.codingCapInstallPanel) {
        els.codingCapInstallPanel.hidden = true;
        els.codingCapInstallPanel.setAttribute("hidden", "");
      }
      if (els.codingOpenGuide) {
        els.codingOpenGuide.hidden = true;
        els.codingOpenGuide.setAttribute("hidden", "");
      }
      if (els.codingBackOnboarding) {
        els.codingBackOnboarding.hidden = true;
        els.codingBackOnboarding.setAttribute("hidden", "");
      }
      showExecutorSetupCard(pendingCodingOnboarding || {});
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
      const result = await api.invoke("work.reviseArtifact", {
        taskId: activeTaskId,
        artifactId: activeArtifactId,
        revisionRequest,
        ...(attachmentPaths.length ? { attachmentPaths } : {}),
      });
      hideRevisionComposer();
      showRevisionActiveBanner(revisionRequest);
      if (els.revisionRequest) els.revisionRequest.value = "";
      clearRevisionShots();
      activeJobId = result.jobId;
      els.jobStatus.textContent = "正在按你的修改要求继续处理";
      els.jobStatus.classList.remove("error");
      if (els.jobActionable) {
        els.jobActionable.textContent =
          "修改要求：" +
          revisionRequest +
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
        showExecutorSetupCard(msg);
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
    els.acceptArtifact.addEventListener("click", () => submitArtifactDecision("accept"));
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
