"use strict";

/**
 * PAN-01R panorama experience facade.
 * Pure functions remain importable for hermetic unit tests without Electron.
 */

const decisionAudit = require("../decision-audit");
const subjectBrief = require("./subject-brief");
const requestMod = require("./request");
const authorization = require("./authorization");
const execute = require("./execute");
const receipt = require("./receipt");

function defaultAppendAudit(userData, fields) {
  return decisionAudit.appendEntry(userData, fields);
}

function defaultListAudit(userData, opts) {
  return decisionAudit.list(userData, opts);
}

/**
 * @param {{
 *   callModelStream?: Function,
 *   getRuntimeConfig?: Function,
 *   appendAudit?: Function,
 *   listAudit?: Function,
 *   now?: Function|number,
 *   userData?: string,
 *   packageDir?: string,
 * }} [deps]
 */
function createPanoramaExperience(deps = {}) {
  const appendAudit = deps.appendAudit || defaultAppendAudit;
  const listAudit = deps.listAudit || defaultListAudit;
  const getRuntimeConfig = deps.getRuntimeConfig || (() => {
    throw new Error("getRuntimeConfig not configured");
  });
  const callModelStream = deps.callModelStream;
  const now = deps.now;

  function resolvePackageDir(override) {
    if (override) return String(override);
    if (deps.packageDir) return String(deps.packageDir);
    return "";
  }

  function resolveUserData(override) {
    if (override) return String(override);
    if (deps.userData) return String(deps.userData);
    return "";
  }

  return {
    getSubjectBrief(packageDir) {
      return subjectBrief.buildSubjectBrief(resolvePackageDir(packageDir));
    },

    createRequest({ senderId, topic, templateId, evidenceIds, packageDir, userData }) {
      return requestMod.createResearchRequest({
        senderId,
        topic,
        templateId,
        evidenceIds,
        packageDir: resolvePackageDir(packageDir),
        userData: resolveUserData(userData),
        appendAudit,
        now,
      });
    },

    buildAuthPreview({ requestId, senderId, selectedEvidenceIds, packageDir }) {
      return authorization.buildAuthorizationPreview({
        requestId,
        senderId,
        selectedEvidenceIds,
        packageDir: resolvePackageDir(packageDir),
        getRuntimeConfig,
        now,
      });
    },

    rejectRequest({ requestId, senderId, userData }) {
      return requestMod.rejectRequest(requestId, senderId, resolveUserData(userData), {
        appendAudit,
        now,
      });
    },

    async confirmAndExecute({ tokenId, senderId, packageDir, userData, onRunCreated }) {
      return execute.confirmAndExecute({
        tokenId,
        senderId,
        packageDir: resolvePackageDir(packageDir),
        userData: resolveUserData(userData),
        deps: { callModelStream, getRuntimeConfig, appendAudit, now, onRunCreated },
      });
    },

    confirmFromPreview({ previewId, senderId, confirmed, packageDir, userData }) {
      return authorization.confirmFromPreview({
        previewId,
        senderId,
        confirmed,
        packageDir: resolvePackageDir(packageDir),
        userData: resolveUserData(userData),
        getRuntimeConfig,
        appendAudit,
        now,
      });
    },

    /**
     * Production confirm path: freeze preview → token → execute.
     * IPC allowlist is previewId + confirmed only.
     */
    async confirmFromPreviewThenExecute({
      previewId,
      confirmed,
      senderId,
      packageDir,
      userData,
      onRunCreated,
    }) {
      const granted = authorization.confirmFromPreview({
        previewId,
        senderId,
        confirmed,
        packageDir: resolvePackageDir(packageDir),
        userData: resolveUserData(userData),
        getRuntimeConfig,
        appendAudit,
        now,
      });
      if (!granted.ok) return granted;
      return execute.confirmAndExecute({
        tokenId: granted.tokenId,
        senderId,
        packageDir: resolvePackageDir(packageDir),
        userData: resolveUserData(userData),
        deps: { callModelStream, getRuntimeConfig, appendAudit, now, onRunCreated },
      });
    },

    grantAuthorization({ requestId, senderId, selectedEvidenceIds, packageDir, userData }) {
      return authorization.grantAuthorization({
        requestId,
        senderId,
        selectedEvidenceIds,
        packageDir: resolvePackageDir(packageDir),
        getRuntimeConfig,
        appendAudit,
        userData: resolveUserData(userData),
        now,
      });
    },

    /**
     * Hermetic / internal helper: grant via preview freeze then execute.
     * Prefer confirmFromPreviewThenExecute for production IPC.
     */
    async confirmGrantAndExecute({
      requestId,
      tokenId,
      previewId,
      confirmed,
      senderId,
      selectedEvidenceIds,
      packageDir,
      userData,
      onRunCreated,
    }) {
      if (previewId) {
        return this.confirmFromPreviewThenExecute({
          previewId,
          confirmed: confirmed !== false,
          senderId,
          packageDir,
          userData,
          onRunCreated,
        });
      }
      let tid = tokenId;
      if (!tid) {
        const granted = authorization.grantAuthorization({
          requestId,
          senderId,
          selectedEvidenceIds,
          packageDir: resolvePackageDir(packageDir),
          getRuntimeConfig,
          appendAudit,
          userData: resolveUserData(userData),
          now,
        });
        if (!granted.ok) return granted;
        tid = granted.tokenId;
      }
      return execute.confirmAndExecute({
        tokenId: tid,
        senderId,
        packageDir: resolvePackageDir(packageDir),
        userData: resolveUserData(userData),
        deps: { callModelStream, getRuntimeConfig, appendAudit, now, onRunCreated },
      });
    },

    cancelRun({ runId, senderId, userData }) {
      return execute.cancelOrAbandonRun({
        runId,
        senderId,
        userData: resolveUserData(userData),
        deps: { appendAudit, now },
      });
    },

    getRun(runId) {
      return execute.getRun(runId);
    },

    adoptResult({ runId, senderId, userData }) {
      return receipt.adoptResult({
        runId,
        senderId,
        userData: resolveUserData(userData),
        deps: {
          appendAudit,
          auditResolveState: (ud) => decisionAudit.resolveState(ud),
        },
      });
    },

    rejectResult({ runId, senderId, userData, reasonCategory }) {
      return receipt.rejectResult({
        runId,
        senderId,
        userData: resolveUserData(userData),
        reasonCategory,
        deps: { appendAudit },
      });
    },

    getReceiptSummary({ requestId, runId, senderId, userData }) {
      return receipt.getReceiptSummary({
        requestId,
        runId,
        senderId,
        userData: resolveUserData(userData),
        deps: {
          listAudit: (ud, opts) => {
            const listed = listAudit(ud, opts);
            return listed && listed.entries ? listed.entries : listed || [];
          },
        },
      });
    },
  };
}

module.exports = {
  createPanoramaExperience,
  buildSubjectBrief: subjectBrief.buildSubjectBrief,
  computePersonalized: subjectBrief.computePersonalized,
  KIND_LABELS: subjectBrief.KIND_LABELS,
  selectDefaultsForKind: subjectBrief.selectDefaultsForKind,
  MAX_EVIDENCE: subjectBrief.MAX_EVIDENCE,
  createResearchRequest: requestMod.createResearchRequest,
  getRequest: requestMod.getRequest,
  rejectRequest: requestMod.rejectRequest,
  buildAuthorizationPreview: authorization.buildAuthorizationPreview,
  confirmFromPreview: authorization.confirmFromPreview,
  grantAuthorization: authorization.grantAuthorization,
  consumeToken: authorization.consumeToken,
  confirmAndExecute: execute.confirmAndExecute,
  cancelOrAbandonRun: execute.cancelOrAbandonRun,
  getRun: execute.getRun,
  adoptResult: receipt.adoptResult,
  rejectResult: receipt.rejectResult,
  getReceiptSummary: receipt.getReceiptSummary,
  createExecutor: execute.createExecutor,
  __test: {
    clearAll() {
      requestMod.clearRequestStoreForTests();
      authorization.clearTokenStoreForTests();
      authorization.clearPreviewStoreForTests();
      execute.clearRunStoreForTests();
    },
    clearRequestStore: requestMod.clearRequestStoreForTests,
    clearTokenStore: authorization.clearTokenStoreForTests,
    clearPreviewStore: authorization.clearPreviewStoreForTests,
    clearRunStore: execute.clearRunStoreForTests,
  },
};
