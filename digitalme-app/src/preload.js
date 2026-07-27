"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/** Main-approved test harness flag only (env set by test launcher). Renderer cannot enable. */
const PAN01R_TEST_HARNESS =
  process.env.DIGITALME_PAN01R_TEST_HARNESS === "1" ||
  process.env.DIGITALME_PAN01R_OWNER_RUNTIME === "1";

const OWNER_RUNTIME_TEST = process.env.DIGITALME_OWNER_RUNTIME_TEST === "1";

const R1_SPIKE_HARNESS =
  process.env.DIGITALME_R1_SPIKE_HARNESS === "1" ||
  process.env.DIGITALME_R1_OWNER_RUNTIME === "1";

const R1_FAIL_READY = process.env.DIGITALME_R1_FAIL_READY === "1";
const R1_INJECT_ERROR_BOUNDARY =
  R1_SPIKE_HARNESS && process.env.DIGITALME_R1_INJECT_ERROR_BOUNDARY === "1";

const api = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  getRuntimeStamp: () => ipcRenderer.invoke("runtime:getStamp"),
  ownerRuntimeTest: OWNER_RUNTIME_TEST,
  runtime: {
    apiVersion: 1,
    getStamp: () => ipcRenderer.invoke("runtime:getStamp"),
    getRendererEntry: () => ipcRenderer.invoke("runtime:getRendererEntry"),
    getBoundGeneration: () => ipcRenderer.invoke("runtime:getBoundGeneration"),
    requestRendererEntry: (entry, reason) =>
      ipcRenderer.invoke("runtime:requestRendererEntry", entry, reason),
    signalReady: (generation) => ipcRenderer.invoke("runtime:signalReady", { generation }),
    failReadyEnabled: R1_FAIL_READY,
    injectErrorBoundary: R1_INJECT_ERROR_BOUNDARY,
  },
  setConfig: (cfg) => ipcRenderer.invoke("config:set", cfg),
  clearApiKey: () => ipcRenderer.invoke("config:clearApiKey"),
  getDistillMeSnapshot: () => ipcRenderer.invoke("distillMe:get"),
  createDistillInput: (input) => ipcRenderer.invoke("distillMe:createInput", input),
  generateIdentityExperienceFacts: (draftId) => ipcRenderer.invoke("distillMe:generate", draftId),
  transitionDistillItem: (payload) => ipcRenderer.invoke("distillMe:transition", payload),
  getDistillEvidence: (itemId) => ipcRenderer.invoke("distillMe:evidence", itemId),
  exportDistillSnapshot: () => ipcRenderer.invoke("distillMe:export"),
  getDistillAuditLog: () => ipcRenderer.invoke("distillMe:audit"),
  getDoingContextAudit: () => ipcRenderer.invoke("doingContext:listAudit"),
  getModelRouting: () => ipcRenderer.invoke("modelRouting:get"),
  saveModelRouting: (payload) => ipcRenderer.invoke("modelRouting:save", payload),
  testModelRouting: (payload) => ipcRenderer.invoke("modelRouting:test", payload),
  getRecentModelRouting: () => ipcRenderer.invoke("modelRouting:recent"),
  clearExtensionSecret: (payload) => ipcRenderer.invoke("secrets:clearExtensionEnv", payload),
  loadPackage: () => ipcRenderer.invoke("package:load"),
  actBehalfPreviewContext: (payload) => ipcRenderer.invoke("actBehalf:previewContext", payload),
  actBehalfConfirmContext: (payload) => ipcRenderer.invoke("actBehalf:confirmContext", payload),
  actBehalfList: (payload) => ipcRenderer.invoke("actBehalf:list", payload),
  actBehalfRename: (payload) => ipcRenderer.invoke("actBehalf:rename", payload),
  actBehalfArchiveTask: (payload) => ipcRenderer.invoke("actBehalf:archiveTask", payload),
  actBehalfRestoreTask: (payload) => ipcRenderer.invoke("actBehalf:restoreTask", payload),
  actBehalfSoftDeleteTask: (payload) => ipcRenderer.invoke("actBehalf:softDeleteTask", payload),
  actBehalfGet: (taskId) => ipcRenderer.invoke("actBehalf:get", taskId),
  actBehalfSave: (payload) => ipcRenderer.invoke("actBehalf:save", payload),
  actBehalfPlanEnsure: (payload) => ipcRenderer.invoke("actBehalf:planEnsure", payload),
  actBehalfPlanGenerate: (payload) => ipcRenderer.invoke("actBehalf:planGenerate", payload),
  actBehalfPlanSaveDraft: (payload) => ipcRenderer.invoke("actBehalf:planSaveDraft", payload),
  actBehalfPlanConfirm: (payload) => ipcRenderer.invoke("actBehalf:planConfirm", payload),
  actBehalfPlanCancelDraft: (payload) => ipcRenderer.invoke("actBehalf:planCancelDraft", payload),
  actBehalfPlanGet: (payload) => ipcRenderer.invoke("actBehalf:planGet", payload),
  actBehalfPlanRecomputeReadiness: (payload) =>
    ipcRenderer.invoke("actBehalf:planRecomputeReadiness", payload),
  actBehalfPlanReconcile: (payload) => ipcRenderer.invoke("actBehalf:planReconcile", payload),
  actBehalfPlanArchive: (payload) => ipcRenderer.invoke("actBehalf:planArchive", payload),
  actBehalfPlanSoftDelete: (payload) => ipcRenderer.invoke("actBehalf:planSoftDelete", payload),
  actBehalfPrepareDeliverablePackage: (payload) =>
    ipcRenderer.invoke("actBehalf:prepareDeliverablePackage", payload),
  actBehalfGetDeliverablePackage: (payload) =>
    ipcRenderer.invoke("actBehalf:getDeliverablePackage", payload),
  actBehalfListDeliverablePackagesForTask: (payload) =>
    ipcRenderer.invoke("actBehalf:listDeliverablePackagesForTask", payload),
  actBehalfGenerateDeliverablePackage: (payload) =>
    ipcRenderer.invoke("actBehalf:generateDeliverablePackage", payload),
  actBehalfGenerateDeliverable: (payload) =>
    ipcRenderer.invoke("actBehalf:generateDeliverable", payload),
  actBehalfGetDeliverablePackageById: (payload) =>
    ipcRenderer.invoke("actBehalf:getDeliverablePackageById", payload),
  actBehalfListDeliverableVersions: (payload) =>
    ipcRenderer.invoke("actBehalf:listDeliverableVersions", payload),
  actBehalfOpenArtifact: (payload) => ipcRenderer.invoke("actBehalf:openArtifact", payload),
  actBehalfRevealArtifact: (payload) => ipcRenderer.invoke("actBehalf:revealArtifact", payload),
  actBehalfReviewDeliverableVersion: (payload) =>
    ipcRenderer.invoke("actBehalf:reviewDeliverableVersion", payload),
  actBehalfGetActionIdentity: (payload) =>
    ipcRenderer.invoke("actBehalf:getActionIdentity", payload),
  actBehalfRevokeAuthorization: (payload) =>
    ipcRenderer.invoke("actBehalf:revokeAuthorization", payload),
  actBehalfGetDeliverableLearnJob: (payload) =>
    ipcRenderer.invoke("actBehalf:getDeliverableLearnJob", payload),
  actBehalfResolveDeliverableLearnConflict: (payload) =>
    ipcRenderer.invoke("actBehalf:resolveDeliverableLearnConflict", payload),
  actBehalfRetryDeliverableLearnJob: (payload) =>
    ipcRenderer.invoke("actBehalf:retryDeliverableLearnJob", payload),
  actBehalfConfirmPlanAndGenerate: (payload) =>
    ipcRenderer.invoke("actBehalf:confirmPlanAndGenerate", payload),
  actBehalfRun: (payload) => ipcRenderer.invoke("actBehalf:run", payload),
  actBehalfAutoGenerate: (payload) => ipcRenderer.invoke("actBehalf:autoGenerate", payload),
  actBehalfSelectFiles: (payload) => ipcRenderer.invoke("actBehalf:selectFiles", payload),
  actBehalfSendEmail: (payload) => ipcRenderer.invoke("actBehalf:sendEmail", payload),
  actBehalfExportVideoAudioScript: (payload) =>
    ipcRenderer.invoke("actBehalf:exportVideoAudioScript", payload),
  actBehalfStartResearch: (payload) => ipcRenderer.invoke("actBehalf:startResearch", payload),
  actBehalfGetResearchSkill: () => ipcRenderer.invoke("actBehalf:getResearchSkill"),
  actBehalfGenerateResult: (payload) => ipcRenderer.invoke("actBehalf:generateResult", payload),
  actBehalfSaveResultDraft: (payload) => ipcRenderer.invoke("actBehalf:saveResultDraft", payload),
  actBehalfSaveAutoResult: (payload) => ipcRenderer.invoke("actBehalf:saveAutoResult", payload),
  actBehalfDecideResult: (payload) => ipcRenderer.invoke("actBehalf:decideResult", payload),
  actBehalfCreateExperienceProposal: (payload) =>
    ipcRenderer.invoke("actBehalf:createExperienceProposal", payload),
  actBehalfSaveExperienceProposalReview: (payload) =>
    ipcRenderer.invoke("actBehalf:saveExperienceProposalReview", payload),
  actBehalfPreviewExperienceProposal: (payload) =>
    ipcRenderer.invoke("actBehalf:previewExperienceProposal", payload),
  actBehalfApplyExperienceProposal: (payload) =>
    ipcRenderer.invoke("actBehalf:applyExperienceProposal", payload),
  actBehalfRejectExperienceProposal: (payload) =>
    ipcRenderer.invoke("actBehalf:rejectExperienceProposal", payload),
  getLifeGraph: (opts) => ipcRenderer.invoke("life:getGraph", opts),
  getCognition: () => ipcRenderer.invoke("life:getCognition"),
  generateCognitionReport: () => ipcRenderer.invoke("life:generateCognitionReport"),
  upsertLifePerson: (payload) => ipcRenderer.invoke("life:upsertPerson", payload),
  updateInference: (payload) => ipcRenderer.invoke("life:updateInference", payload),
  updatePersonStatus: (payload) => ipcRenderer.invoke("life:updatePerson", payload),
  updateMindHook: (payload) => ipcRenderer.invoke("life:updateMindHook", payload),
  distillMindHooks: () => ipcRenderer.invoke("life:distillMindHooks"),
  applyMindHooks: () => ipcRenderer.invoke("life:applyMindHooks"),
  markMindHooksDistilled: (ids) => ipcRenderer.invoke("life:markMindHooksDistilled", ids),
  upsertLifeEvent: (payload) => ipcRenderer.invoke("life:upsertEvent", payload),
  deleteLifeEvent: (id) => ipcRenderer.invoke("life:deleteEvent", id),
  getBoundaries: () => ipcRenderer.invoke("policies:getBoundaries"),
  addBoundary: (payload) => ipcRenderer.invoke("policies:addBoundary", payload),
  updateBoundary: (payload) => ipcRenderer.invoke("policies:updateBoundary", payload),
  removeBoundary: (payload) => ipcRenderer.invoke("policies:removeBoundary", payload),
  restoreBoundaryDefaults: (payload) => ipcRenderer.invoke("policies:restoreDefaults", payload),
  sendChat: (payload) => ipcRenderer.invoke("chat:send", payload),
  confirmKnowledgeCandidate: (payload) => ipcRenderer.invoke("knowledge:confirmCandidate", payload),
  stopChat: (payload) => ipcRenderer.invoke("chat:stop", payload),
  pickAttachments: () => ipcRenderer.invoke("chat:pickAttachments"),
  onChatProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("chat:progress", handler);
    return () => ipcRenderer.removeListener("chat:progress", handler);
  },
  onResearchProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("research:progress", handler);
    return () => ipcRenderer.removeListener("research:progress", handler);
  },
  // Sessions
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  getSession: (id) => ipcRenderer.invoke("sessions:get", id),
  createSession: (opts) => ipcRenderer.invoke("sessions:create", opts),
  saveSession: (session) => ipcRenderer.invoke("sessions:save", session),
  renameSession: (payload) => ipcRenderer.invoke("sessions:rename", payload),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  setActiveSession: (id) => ipcRenderer.invoke("sessions:setActive", id),
  /** One-shot legacy handoff from next (libraryId/scene only). */
  consumeLegacyNavIntent: () => ipcRenderer.invoke("r2:consumeLegacyHandoff"),
  // Exports
  exportMarkdown: (payload) => ipcRenderer.invoke("output:exportMarkdown", payload),
  exportDocx: (payload) => ipcRenderer.invoke("output:exportDocx", payload),
  openDraftsFolder: () => ipcRenderer.invoke("output:openDraftsFolder"),
  getDraftsDir: () => ipcRenderer.invoke("output:getDraftsDir"),
  // Deliverables library
  listLibrary: () => ipcRenderer.invoke("library:list"),
  getLibraryItem: (id) => ipcRenderer.invoke("library:get", id),
  saveLibraryItem: (item) => ipcRenderer.invoke("library:save", item),
  deleteLibraryItem: (id) => ipcRenderer.invoke("library:delete", id),
  getLibraryTemplates: () => ipcRenderer.invoke("library:templates"),
  getScenarioPacks: () => ipcRenderer.invoke("library:scenarioPacks"),
  prepareScenario: (packId) => ipcRenderer.invoke("scenarios:prepare", packId),
  getCapabilitySurface: (payload) => ipcRenderer.invoke("capabilities:surface", payload),
  createFromTemplate: (payload) => ipcRenderer.invoke("library:createFromTemplate", payload),
  createBlankLibrary: (payload) => ipcRenderer.invoke("library:createBlank", payload),
  importArtifactToLibrary: (payload) => ipcRenderer.invoke("library:importArtifact", payload),
  exportLibraryItem: (payload) => ipcRenderer.invoke("library:export", payload),
  // Research
  listResearch: () => ipcRenderer.invoke("research:list"),
  getResearch: (id) => ipcRenderer.invoke("research:get", id),
  getActiveResearch: () => ipcRenderer.invoke("research:active"),
  createResearch: (payload) => ipcRenderer.invoke("research:create", payload),
  saveResearch: (item) => ipcRenderer.invoke("research:save", item),
  deleteResearch: (id) => ipcRenderer.invoke("research:delete", id),
  setActiveResearch: (id) => ipcRenderer.invoke("research:setActive", id),
  setResearchStage: (payload) => ipcRenderer.invoke("research:setStage", payload),
  setResearchProgress: (payload) => ipcRenderer.invoke("research:setProgress", payload),
  addResearchMaterial: (payload) => ipcRenderer.invoke("research:addMaterial", payload),
  addResearchSource: (payload) => ipcRenderer.invoke("research:addSource", payload),
  removeResearchMaterial: (payload) => ipcRenderer.invoke("research:removeMaterial", payload),
  removeResearchSource: (payload) => ipcRenderer.invoke("research:removeSource", payload),
  addResearchArtifact: (payload) => ipcRenderer.invoke("research:addArtifact", payload),
  removeResearchArtifact: (payload) => ipcRenderer.invoke("research:removeArtifact", payload),
  runResearchCheck: (payload) => ipcRenderer.invoke("research:runCheck", payload),
  runResearchClaimAudit: (payload) => ipcRenderer.invoke("research:runClaimAudit", payload),
  getResearchStages: () => ipcRenderer.invoke("research:stages"),
  getResearchProgressSteps: () => ipcRenderer.invoke("research:progressSteps"),
  getResearchMethodPacks: () => ipcRenderer.invoke("research:methodPacks"),
  getResearchSourceActions: () => ipcRenderer.invoke("research:sourceActions"),
  prepareResearchMethod: (packId) => ipcRenderer.invoke("research:prepareMethod", packId),
  exportResearchFinal: (payload) => ipcRenderer.invoke("research:exportFinal", payload),
  sendResearchToWriting: (payload) => ipcRenderer.invoke("research:sendToWriting", payload),
  exportResearchDeliverable: (payload) => ipcRenderer.invoke("research:exportDeliverable", payload),
  fetchResearchSourceExcerpt: (payload) => ipcRenderer.invoke("research:fetchSourceExcerpt", payload),
  prepareResearchScene: () => ipcRenderer.invoke("research:prepareScene"),
  prepareCodeScene: () => ipcRenderer.invoke("code:prepareScene"),
  buildCodeDelegationHint: (payload) => ipcRenderer.invoke("code:buildDelegationHint", payload),
  discoverResearchSources: (payload) => ipcRenderer.invoke("research:discoverSources", payload),
  runResearchAgentLoop: (payload) => ipcRenderer.invoke("research:runAgentLoop", payload),
  addResearchLocalSource: (payload) => ipcRenderer.invoke("research:addLocalSource", payload),
  validateResearchGrounded: (payload) => ipcRenderer.invoke("research:validateGrounded", payload),
  // Personal skills
  listSkills: (scene) => ipcRenderer.invoke("skills:list", scene),
  getSkill: (id) => ipcRenderer.invoke("skills:get", id),
  saveSkill: (skill) => ipcRenderer.invoke("skills:save", skill),
  deleteSkill: (id) => ipcRenderer.invoke("skills:delete", id),
  setActiveSkill: (payload) => ipcRenderer.invoke("skills:setActive", payload),
  getActiveSkill: (scene) => ipcRenderer.invoke("skills:getActive", scene),
  saveSkillFromContext: (payload) => ipcRenderer.invoke("skills:saveFromContext", payload),
  previewFeedback: (payload) => ipcRenderer.invoke("feedback:preview", payload),
  applyFeedback: (payload) => ipcRenderer.invoke("feedback:apply", payload),
  createDemoPackage: (opts) => ipcRenderer.invoke("packageStore:createDemo", opts),
  activateTempDemoPackage: (opts) => ipcRenderer.invoke("packageStore:activateTempDemo", opts),
  restoreRegularPackageDir: (opts) =>
    ipcRenderer.invoke("packageStore:restoreRegularPackageDir", opts),
  getSandboxPackageStatus: () => ipcRenderer.invoke("packageStore:getSandboxStatus"),
  inspectPackageStore: (opts) => ipcRenderer.invoke("packageStore:inspect", opts),
  listPackageVersions: () => ipcRenderer.invoke("packageStore:listVersions"),
  getSubjectOverview: () => ipcRenderer.invoke("subject:getOverview"),
  subjectGetIdentity: () => ipcRenderer.invoke("subject:getIdentity"),
  subjectSignData: (p) => ipcRenderer.invoke("subject:signData", p),
  subjectVerifySignature: (p) => ipcRenderer.invoke("subject:verifySignature", p),
  subjectGetRoleView: () => ipcRenderer.invoke("subject:getRoleView"),
  subjectSetRole: (p) => ipcRenderer.invoke("subject:setRole", p),
  subjectGetRoleContext: () => ipcRenderer.invoke("subject:getRoleContext"),
  subjectIssueVC: (p) => ipcRenderer.invoke("subject:issueVC", p),
  subjectVerifyVC: (p) => ipcRenderer.invoke("subject:verifyVC", p),
  subjectPresentCredential: (p) => ipcRenderer.invoke("subject:presentCredential", p),
  subjectRevokeCredential: (p) => ipcRenderer.invoke("subject:revokeCredential", p),
  subjectVerifyCredentialStatus: (p) => ipcRenderer.invoke("subject:verifyCredentialStatus", p),
  subjectListCredentials: () => ipcRenderer.invoke("subject:listCredentials"),
  collaborationCreate: (p) => ipcRenderer.invoke("collaboration:create", p),
  collaborationAddInteraction: (p) => ipcRenderer.invoke("collaboration:addInteraction", p),
  collaborationAddDeliverable: (p) => ipcRenderer.invoke("collaboration:addDeliverable", p),
  collaborationApproveDeliverable: (p) => ipcRenderer.invoke("collaboration:approveDeliverable", p),
  collaborationAddFeedback: (p) => ipcRenderer.invoke("collaboration:addFeedback", p),
  collaborationConfirmFeedback: (p) => ipcRenderer.invoke("collaboration:confirmFeedback", p),
  collaborationRevoke: (p) => ipcRenderer.invoke("collaboration:revoke", p),
  collaborationList: () => ipcRenderer.invoke("collaboration:list"),
  rollbackPackageVersion: (payload) => ipcRenderer.invoke("packageStore:rollback", payload),
  recoverPackageStore: () => ipcRenderer.invoke("packageStore:recover"),
  planPpt: (payload) => ipcRenderer.invoke("output:planPpt", payload),
  savePpt: (plan) => ipcRenderer.invoke("output:savePpt", { plan }),
  // Capability extensions
  getExtensionsCatalog: () => ipcRenderer.invoke("extensions:getCatalog"),
  getExtensionsConfig: () => ipcRenderer.invoke("extensions:getConfig"),
  saveExtensionsConfig: (list) => ipcRenderer.invoke("extensions:saveConfig", list),
  enableExtension: (payload) => ipcRenderer.invoke("extensions:enable", payload),
  disableExtension: (id) => ipcRenderer.invoke("extensions:disable", id),
  pickExtensionDirectory: () => ipcRenderer.invoke("extensions:pickDirectory"),
  pickExtensionFile: () => ipcRenderer.invoke("extensions:pickFile"),
  getExtensionsStatus: () => ipcRenderer.invoke("extensions:getStatus"),
  connectExtension: (id) => ipcRenderer.invoke("extensions:connect", id),
  disconnectExtension: (id) => ipcRenderer.invoke("extensions:disconnect", id),
  listExtensionTools: (id) => ipcRenderer.invoke("extensions:listTools", id),
  callExtensionTool: (payload) => ipcRenderer.invoke("extensions:callTool", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  openPath: (target) => ipcRenderer.invoke("shell:openPath", target),
  l0AuditList: (opts) => ipcRenderer.invoke("l0:auditList", opts),
  decisionAuditList: (opts) => ipcRenderer.invoke("decisionAudit:list", opts),
  decisionAuditVerify: () => ipcRenderer.invoke("decisionAudit:verify"),
  decisionAuditRequestRotate: () => ipcRenderer.invoke("decisionAudit:requestRotate"),
  decisionAuditRotate: (payload) => ipcRenderer.invoke("decisionAudit:rotate", payload),
  l0ListAgents: () => ipcRenderer.invoke("l0:listAgents"),
  l0SetActiveAgent: (agentId) => ipcRenderer.invoke("l0:setActiveAgent", agentId),
  l0SaveCliAgent: (payload) => ipcRenderer.invoke("l0:saveCliAgent", payload),
  l0GetCliAgentConfig: () => ipcRenderer.invoke("l0:getCliAgentConfig"),
  l0BuildControlBrief: (payload) => ipcRenderer.invoke("l0:buildControlBrief", payload),
  l0RequestExternalAgent: (payload) => ipcRenderer.invoke("l0:requestExternalAgent", payload),
  l0CancelExternalAgentConfirmation: (payload) =>
    ipcRenderer.invoke("l0:cancelExternalAgentConfirmation", payload),
  l0RunExternalAgent: (payload) => ipcRenderer.invoke("l0:runExternalAgent", payload),
  l0StopExternalAgent: (payload) => ipcRenderer.invoke("l0:stopExternalAgent", payload),
  onExternalAgentStarted: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("l0:external-agent-started", handler);
    return () => ipcRenderer.removeListener("l0:external-agent-started", handler);
  },
  // Builder
  pickFile: () => ipcRenderer.invoke("builder:pickFile"),
  distill: (payload) => ipcRenderer.invoke("builder:distill", payload),
  cancelDistill: () => ipcRenderer.invoke("builder:cancel"),
  previewDistillWrite: (payload) => ipcRenderer.invoke("builder:previewWrite", payload),
  writeDistill: (payload) => ipcRenderer.invoke("builder:write", payload),
  getMaterialKinds: () => ipcRenderer.invoke("materials:kinds"),
  listCustody: () => ipcRenderer.invoke("materials:listCustody"),
  listInbox: () => ipcRenderer.invoke("inbox:list"),
  enqueueInbox: (files) => ipcRenderer.invoke("inbox:enqueue", files),
  removeInboxItem: (id) => ipcRenderer.invoke("inbox:remove", id),
  setInboxKind: (payload) => ipcRenderer.invoke("inbox:setKind", payload),
  organizeInbox: () => ipcRenderer.invoke("inbox:organize"),
  markInboxStatus: (payload) => ipcRenderer.invoke("inbox:markStatus", payload),
  onInboxProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("inbox:progress", handler);
    return () => ipcRenderer.removeListener("inbox:progress", handler);
  },
  listAccessScopes: () => ipcRenderer.invoke("access:list"),
  addAccessScope: () => ipcRenderer.invoke("access:add"),
  removeAccessScope: (id) => ipcRenderer.invoke("access:remove"),
  scanAccessScopes: (scopeId) => ipcRenderer.invoke("access:scan", scopeId),
  getIntakeQuestions: () => ipcRenderer.invoke("intake:questions"),
  distillIntake: (payload) => ipcRenderer.invoke("intake:distill", payload),
  onBuilderProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("builder:progress", handler);
    return () => ipcRenderer.removeListener("builder:progress", handler);
  },
};

// R1 spike harness only — ordinary renderer cannot enable via query/hash/localStorage.
if (R1_SPIKE_HARNESS) {
  api.r1SpikeHarness = true;
  api.runtime.testRequestNext = (reason) =>
    ipcRenderer.invoke("runtime:testRequestNext", reason || "preload_harness");
  api.runtime.testGetEntrySnapshot = () => ipcRenderer.invoke("runtime:testGetEntrySnapshot");
}

/** R2 narrow API for renderer-next — no saveSession / no attachment bodies. */
api.r2 = {
  listSessions: () => ipcRenderer.invoke("r2:listSessions"),
  getSession: (id) => ipcRenderer.invoke("r2:getSession", id),
  createSession: (opts) => ipcRenderer.invoke("r2:createSession", opts),
  renameSession: (payload) => ipcRenderer.invoke("r2:renameSession", payload),
  deleteSession: (id) => ipcRenderer.invoke("r2:deleteSession", id),
  setCurrentSession: (id) => ipcRenderer.invoke("r2:setCurrentSession", id),
  sendChat: (payload) => ipcRenderer.invoke("r2:sendChat", payload),
  stopChat: (payload) => ipcRenderer.invoke("r2:stopChat", payload),
  getActiveRequest: () => ipcRenderer.invoke("r2:getActiveRequest"),
  acknowledgeChat: (payload) => ipcRenderer.invoke("r2:acknowledgeChat", payload),
  clearAttachmentToken: (payload) => ipcRenderer.invoke("r2:clearAttachmentToken", payload),
  pickAttachments: (payload) => ipcRenderer.invoke("r2:pickAttachments", payload),
  clearLinkedArtifact: (payload) => ipcRenderer.invoke("r2:clearLinkedArtifact", payload),
  openLinkedArtifact: (payload) => ipcRenderer.invoke("r2:openLinkedArtifact", payload),
  onChatEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("chat:event", handler);
    return () => ipcRenderer.removeListener("chat:event", handler);
  },
};

if (R1_SPIKE_HARNESS || process.env.DIGITALME_R2_FAKE_MODEL === "1") {
  api.r2.testSetAttachmentClock = (payload) =>
    ipcRenderer.invoke("r2:testSetAttachmentClock", payload);
  api.r2.testAttachmentVaultSize = () => ipcRenderer.invoke("r2:testAttachmentVaultSize");
  api.r2.testExpireAttachmentTokens = () => ipcRenderer.invoke("r2:testExpireAttachmentTokens");
  api.r2.testSeedSession = (payload) => ipcRenderer.invoke("r2:testSeedSession", payload);
  api.r2.testCorruptSessionsFile = () => ipcRenderer.invoke("r2:testCorruptSessionsFile");
  api.r2.testMintAttachmentToken = (payload) =>
    ipcRenderer.invoke("r2:testMintAttachmentToken", payload);
}

contextBridge.exposeInMainWorld("digitalMe", api);
