/**
 * 成果投影判定 — 纯函数，不构成第二 Store。
 * code-change UI 仅当软件执行 Task + 正式 code-change Artifact 同时成立。
 */
(function (root) {
  'use strict';

  /**
   * @param {unknown} taskIntent
   * @returns {boolean}
   */
  function isSoftwareExecutionTask(taskIntent) {
    return String(taskIntent || '') === 'modify_code';
  }

  /**
   * @param {unknown} artifactType
   * @param {unknown} [artifactKind]
   * @returns {boolean}
   */
  function isFormalCodeChangeArtifactType(artifactType, artifactKind) {
    const t = String(artifactType || '');
    const k = String(artifactKind || '');
    return t === 'code-change' || t === 'code_change' || k === 'code-change';
  }

  /**
   * @param {{
   *   taskIntent?: string|null,
   *   artifactType?: string|null,
   *   artifactKind?: string|null,
   *   artifactContent?: { codeChange?: unknown, content?: { kind?: string } }|null
   * }} dispatch
   * @returns {{ kind: 'code-change'|'bundle'|'document', contradiction: boolean }}
   */
  function resolveArtifactProjection(dispatch) {
    const d = dispatch || {};
    const intent = d.taskIntent ? String(d.taskIntent) : '';
    const artifactType = d.artifactType ? String(d.artifactType) : '';
    const artifactKind = d.artifactKind ? String(d.artifactKind) : '';
    const hasCodeMeta = !!(d.artifactContent && d.artifactContent.codeChange);
    const softwareTask = isSoftwareExecutionTask(intent);
    const codeChangeArtifact = isFormalCodeChangeArtifactType(artifactType, artifactKind);

    if (softwareTask && codeChangeArtifact) {
      return { kind: 'code-change', contradiction: false };
    }

    const contradiction = !!(hasCodeMeta && !(softwareTask && codeChangeArtifact));
    if (
      d.artifactContent &&
      d.artifactContent.content &&
      d.artifactContent.content.kind === 'bundle'
    ) {
      return { kind: 'bundle', contradiction };
    }
    return { kind: 'document', contradiction };
  }

  /**
   * 非软件任务不得沿用残留的 code-change 类型标签。
   * @param {{ taskIntent?: string|null, rawArtifactType?: string|null }} input
   */
  function sanitizeArtifactTypeForTask(input) {
    const intent = input && input.taskIntent ? String(input.taskIntent) : '';
    const raw = input && input.rawArtifactType ? String(input.rawArtifactType) : 'document';
    if (!isSoftwareExecutionTask(intent) && isFormalCodeChangeArtifactType(raw, null)) {
      return 'document';
    }
    return raw || 'document';
  }

  const api = {
    isSoftwareExecutionTask,
    isFormalCodeChangeArtifactType,
    resolveArtifactProjection,
    sanitizeArtifactTypeForTask,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DigitalMeArtifactProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
