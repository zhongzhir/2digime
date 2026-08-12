/**
 * Work UX stage — 从现有 Task/Job/Artifact/decision/acceptance/capability 事实派生。
 * 不新增永久状态；不构成第二状态机。供做事页统一动作预算。
 */
(function (root) {
  'use strict';

  /** @typedef {'drafting'|'needs_input'|'needs_capability'|'needs_confirmation'|'running'|'needs_review'|'needs_revision'|'adopted'|'blocked'} WorkUxStage */

  /**
   * @typedef {object} WorkUxFacts
   * @property {'compose'|'task'} [workMode]
   * @property {boolean} [modelReady]
   * @property {boolean} [projectCreateConfirm]
   * @property {boolean} [projectDirReady]
   * @property {boolean} [understandingReliable]
   * @property {boolean} [ownerChoicePrompt]
   * @property {boolean} [revisionComposerOpen]
   * @property {boolean} [adoptWarningOpen]
   * @property {string|null} [jobStatus]
   * @property {boolean} [hasArtifact]
   * @property {'undecided'|'accepted'|'rejected'|null} [decisionStatus]
   * @property {boolean|null} [canAdoptSuggested]
   * @property {string|null} [primaryAction]
   * @property {boolean} [taskPaused]
   * @property {boolean} [codeChange]
   * @property {boolean} [canTryRun]
   * @property {boolean} [startupFailed]
   * @property {boolean} [hasWorkingDirectory]
   * @property {boolean} [prepBlocked]
   * @property {'project'|'project_confirm'|'executor'|'high_risk'|string|null} [prepBlockedKind]
   * @property {boolean} [hasPlanDraft]
   * @property {boolean} [jobCancelSupported]
   */

  /**
   * @typedef {object} WorkUxAction
   * @property {string} id
   * @property {string} label
   * @property {'primary'|'secondary'|'more'} slot
   * @property {'middle'|'right'|'left'} column
   */

  /**
   * @typedef {object} WorkUxView
   * @property {WorkUxStage} stage
   * @property {WorkUxAction[]} actions
   * @property {string} statusLine
   * @property {boolean} hideDecisionHint
   * @property {boolean} hideMidArtifactActions
   * @property {boolean} collapseExportsToMore
   */

  /** @type {readonly WorkUxStage[]} */
  const STAGES = Object.freeze([
    'drafting',
    'needs_input',
    'needs_capability',
    'needs_confirmation',
    'running',
    'needs_review',
    'needs_revision',
    'adopted',
    'blocked',
  ]);

  /**
   * @param {WorkUxFacts} facts
   * @returns {WorkUxStage}
   */
  function deriveWorkUxStage(facts) {
    const f = facts || {};
    if (f.modelReady === false) return 'needs_capability';
    // D11-E：开发前准备只看右栏 prepBlocked，不再读中栏三确认卡可见性
    if (f.prepBlocked) {
      const kind = String(f.prepBlockedKind || '');
      if (kind === 'executor') return 'needs_capability';
      if (kind === 'high_risk') return 'needs_confirmation';
      return 'needs_input';
    }
    if (f.projectCreateConfirm && !f.projectDirReady) return 'needs_input';
    if (f.ownerChoicePrompt) return 'needs_input';
    const js = f.jobStatus ? String(f.jobStatus) : '';
    if (js === 'queued' || js === 'running') return 'running';
    if (js === 'failed' || js === 'cancelled') return 'blocked';
    if (f.decisionStatus === 'accepted') return 'adopted';
    // 不采用 ≠ 自动修订，但必须进入可继续修改的阶段
    if (f.hasArtifact && f.decisionStatus === 'rejected') return 'needs_revision';
    if (f.revisionComposerOpen || f.adoptWarningOpen) return 'needs_revision';
    if (f.taskPaused && f.hasArtifact) return 'needs_revision';
    if (f.hasArtifact && (f.decisionStatus === 'undecided' || !f.decisionStatus)) {
      if (f.canAdoptSuggested === false) return 'needs_revision';
      return 'needs_review';
    }
    if (f.workMode === 'task' && !f.hasArtifact && js === 'succeeded') return 'needs_review';
    return 'drafting';
  }

  /**
   * @param {WorkUxFacts} facts
   * @returns {WorkUxView}
   */
  function deriveWorkUxView(facts) {
    const f = facts || {};
    const stage = deriveWorkUxStage(f);
    /** @type {WorkUxAction[]} */
    const actions = [];
    const push = (id, label, slot, column) => {
      actions.push({ id, label, slot, column });
    };

    let statusLine = '';
    let hideDecisionHint = true;
    let hideMidArtifactActions = true;
    let collapseExportsToMore = true;

    if (stage === 'drafting') {
      statusLine = f.hasPlanDraft ? '右侧是开发规划。可在对话中补充，或确认后开始开发。' : '';
      if (!f.hasPlanDraft) {
        push('start_submit', '开始处理', 'primary', 'middle');
      }
    } else if (stage === 'needs_input') {
      if (f.prepBlocked || f.projectCreateConfirm) {
        statusLine = '开发前还需完成准备 · 见右侧任务工作区';
      } else if (f.ownerChoicePrompt) {
        statusLine = '请选择本次如何处理';
      } else {
        statusLine = '请补充任务所需信息';
      }
    } else if (stage === 'needs_capability') {
      statusLine =
        f.modelReady === false
          ? '请先连接模型'
          : f.prepBlocked
            ? '开发前还需完成准备 · 见右侧任务工作区'
            : '完成这项任务需要代码执行能力';
      if (f.modelReady === false) {
        push('goto_settings', '连接模型', 'primary', 'middle');
      }
    } else if (stage === 'needs_confirmation') {
      statusLine = '这项操作风险较高，请看右侧说明后再决定是否开始。';
    } else if (stage === 'running') {
      statusLine = '正在开发';
      if (f.jobCancelSupported !== false) {
        push('cancel_job', '取消', 'secondary', 'middle');
      }
    } else if (stage === 'needs_revision') {
      hideDecisionHint = true;
      if (f.taskPaused) {
        statusLine = '任务已暂停 · 可在对话区继续说明';
      } else if (f.revisionComposerOpen) {
        statusLine = '说明还需要修改什么，或补充你的意见';
        push('submit_revision', '提交修改', 'primary', 'right');
        push('cancel_revision', '取消', 'secondary', 'right');
        push('add_revision_shot', '添加截图', 'more', 'right');
      } else if (f.decisionStatus === 'rejected') {
        statusLine = '这份成果未采用 · 可在对话区说明下一步';
      } else if (f.adoptWarningOpen || f.canAdoptSuggested === false) {
        statusLine = '建议继续修改 · 请在对话区直接说明';
      } else {
        statusLine = '建议继续修改 · 请在对话区直接说明';
      }
    } else if (stage === 'needs_review') {
      // 采用入口只在中栏验收消息；右栏不承载确认采用
      statusLine = f.canAdoptSuggested === false
        ? '请先看结论，再决定是否继续修改'
        : '建议采用这份成果 · 可在对话区确认，或继续说明';
      hideDecisionHint = true;
    } else if (stage === 'adopted') {
      hideDecisionHint = true;
      if (f.revisionComposerOpen) {
        statusLine = '说明还需要修改什么';
        push('submit_revision', '提交修改', 'primary', 'right');
        push('cancel_revision', '取消', 'secondary', 'right');
        push('add_revision_shot', '添加截图', 'more', 'right');
      } else if (f.canTryRun && !f.startupFailed) {
        statusLine = '已采用 · 可以试用';
        push('try_run', '查看可试用成果', 'primary', 'right');
        push('continue_revise', '继续修改', 'secondary', 'right');
      } else if (f.codeChange && f.startupFailed) {
        statusLine = '已采用，但仍需修复后才能正常使用';
        push('continue_revise', '继续修复', 'primary', 'right');
        push('open_project', '打开项目', 'secondary', 'right');
      } else if (f.codeChange) {
        statusLine = '已采用';
        push('open_project', '打开项目', 'primary', 'right');
        push('continue_revise', '继续修改', 'secondary', 'right');
      } else {
        statusLine = '已采用';
        push('reveal_artifact', '打开所在目录', 'primary', 'right');
        push('continue_revise', '继续修改', 'secondary', 'right');
      }
    } else if (stage === 'blocked') {
      statusLine = jsLabelBlocked(f) + ' · 可在对话区说明下一步';
      push('retry_job', '重试', 'primary', 'middle');
    }

    // 预算裁剪：主≤1，次≤1
    const budgeted = enforceActionBudget(actions);

    return {
      stage,
      actions: budgeted,
      statusLine,
      hideDecisionHint,
      hideMidArtifactActions,
      collapseExportsToMore,
    };
  }

  /** @param {WorkUxFacts} f */
  function jsLabelBlocked(f) {
    if (f.jobStatus === 'cancelled') return '任务已取消';
    return '处理未能完成';
  }

  /**
   * 主 1 + 次 2；超出的 secondary 降为 more（保持顺序）。
   * @param {WorkUxAction[]} actions
   * @returns {WorkUxAction[]}
   */
  function enforceActionBudget(actions) {
    let primary = 0;
    let secondary = 0;
    return actions.map((a) => {
      if (a.slot === 'primary') {
        primary += 1;
        if (primary > 1) return { ...a, slot: 'more' };
        return a;
      }
      if (a.slot === 'secondary') {
        secondary += 1;
        if (secondary > 1) return { ...a, slot: 'more' };
        return a;
      }
      return a;
    });
  }

  /**
   * @param {WorkUxView} view
   * @returns {{ ok: boolean, errors: string[] }}
   */
  function assertActionBudget(view) {
    const errors = [];
    const primary = (view.actions || []).filter((a) => a.slot === 'primary');
    const secondary = (view.actions || []).filter((a) => a.slot === 'secondary');
    if (primary.length > 1) errors.push('primary>' + primary.length);
    if (secondary.length > 1) errors.push('secondary>' + secondary.length);
    const ids = (view.actions || []).map((a) => a.id);
    if (view.stage === 'drafting' && (ids.includes('accept') || ids.includes('restore_baseline'))) {
      errors.push('drafting_has_review_actions');
    }
    if (view.stage === 'running' && ids.includes('accept')) errors.push('running_has_accept');
    if (
      (view.stage === 'needs_review' || view.stage === 'adopted' || view.stage === 'needs_revision') &&
      ids.includes('start_submit')
    ) {
      errors.push('review_has_submit');
    }
    if (view.stage === 'adopted' && primary.some((a) => a.id === 'accept')) {
      errors.push('adopted_repeat_accept');
    }
    if (view.stage === 'needs_review' && ids.includes('accept')) {
      errors.push('needs_review_right_accept');
    }
    if (view.stage === 'needs_capability' && ids.includes('confirm_execution')) {
      errors.push('capability_has_exec');
    }
    if (view.stage === 'needs_capability' && ids.includes('start_submit')) {
      errors.push('capability_has_submit');
    }
    const mid = (view.actions || []).filter(
      (a) =>
        a.column === 'middle' &&
        (a.id === 'accept' || a.id === 'reject' || a.id === 'propose_revision' || a.id === 'continue_revise'),
    );
    const right = (view.actions || []).filter(
      (a) =>
        a.column === 'right' &&
        (a.id === 'accept' ||
          a.id === 'reject' ||
          a.id === 'propose_revision' ||
          a.id === 'continue_revise' ||
          a.id === 'confirm_continue' ||
          a.id === 'supplement_opinion'),
    );
    if (mid.length && right.length) errors.push('mid_right_decision_dup');
    const restore = (view.actions || []).find((a) => a.id === 'restore_baseline');
    if (restore && restore.slot !== 'more') errors.push('restore_not_in_more');
    return { ok: errors.length === 0, errors };
  }

  /**
   * 检测用户面文案是否泄漏内部词。
   * @param {string} text
   */
  function hasInternalLeak(text) {
    return /\b(Job|Artifact|Adapter|Registry|executorId|CLI)\b/i.test(String(text || ''));
  }

  const api = {
    STAGES,
    deriveWorkUxStage,
    deriveWorkUxView,
    enforceActionBudget,
    assertActionBudget,
    hasInternalLeak,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DigitalMeWorkUx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
