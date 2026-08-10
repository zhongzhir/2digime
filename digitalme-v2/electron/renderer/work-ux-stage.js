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
 * @property {boolean} [projectFolderCard]
 * @property {boolean} [projectCreateConfirm]
 * @property {boolean} [projectDirReady]
 * @property {boolean} [executorSetupCard]
 * @property {boolean} [executionConfirmCard]
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
    if (f.executorSetupCard) return 'needs_capability';
    // 项目位置已就绪时不得继续 needs_input（卡片残留也不算）
    const projectInputOpen = !!(f.projectFolderCard || f.projectCreateConfirm) && !f.projectDirReady;
    if (projectInputOpen && f.projectCreateConfirm) return 'needs_input';
    if (projectInputOpen && f.projectFolderCard) return 'needs_input';
    if (f.executionConfirmCard) return 'needs_confirmation';
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
      statusLine = '';
      push('start_submit', '开始处理', 'primary', 'middle');
    } else if (stage === 'needs_input') {
      if (f.projectCreateConfirm) {
        statusLine = '请确认新项目位置';
        push('confirm_create_project', '确认并开始', 'primary', 'middle');
        push('change_project_location', '更改位置', 'secondary', 'middle');
        push('cancel_create_project', '取消', 'more', 'middle');
      } else if (f.projectFolderCard) {
        statusLine = '这项任务需要一个项目位置';
        push('create_project', '由 Digital Me 创建新项目', 'primary', 'middle');
        push('pick_existing_project', '使用已有项目', 'secondary', 'middle');
      } else if (f.ownerChoicePrompt) {
        statusLine = '请选择本次如何处理';
      } else {
        statusLine = '请补充任务所需信息';
      }
    } else if (stage === 'needs_capability') {
      statusLine = f.modelReady === false ? '请先连接模型' : '完成这项任务需要代码执行能力';
      if (f.modelReady === false) {
        push('goto_settings', '连接模型', 'primary', 'middle');
      } else {
        push('coding_connect', '连接代码执行能力', 'primary', 'middle');
        push('coding_later', '稍后连接', 'secondary', 'middle');
        push('coding_install', '安装推荐能力', 'more', 'middle');
        push('coding_settings', '打开设置', 'more', 'middle');
        push('coding_recheck', '重新检查', 'more', 'middle');
      }
    } else if (stage === 'needs_confirmation') {
      statusLine = '开始前请确认项目与修改范围';
      const confirmLabel =
        f.understandingReliable === false ? '仍要继续' : '确认并开始';
      push('confirm_execution', confirmLabel, 'primary', 'middle');
      push('cancel_execution', '返回修改', 'secondary', 'middle');
    } else if (stage === 'running') {
      statusLine = '正在处理';
      if (f.jobCancelSupported !== false) {
        push('cancel_job', '取消', 'secondary', 'middle');
      }
    } else if (stage === 'needs_revision') {
      hideDecisionHint = true;
      if (f.taskPaused) {
        statusLine = '任务已暂停';
        push('confirm_continue', '确认继续', 'primary', 'right');
        push('supplement_opinion', '补充意见', 'secondary', 'right');
      } else if (f.revisionComposerOpen) {
        statusLine = '说明还需要修改什么，或补充你的意见';
        push('submit_revision', '提交修改', 'primary', 'right');
        push('cancel_revision', '取消', 'secondary', 'right');
        push('add_revision_shot', '添加截图', 'more', 'right');
      } else if (f.decisionStatus === 'rejected') {
        statusLine = '这份成果未采用';
        push('confirm_continue', '确认继续', 'primary', 'right');
        push('supplement_opinion', '补充意见', 'secondary', 'right');
        push('restart_compose', '创建新任务', 'secondary', 'middle');
      } else if (f.adoptWarningOpen || f.canAdoptSuggested === false) {
        statusLine =
          f.primaryAction === 'need_decision' ? '需要你做一项决定' : '建议继续修正';
        push('confirm_continue', '确认继续', 'primary', 'right');
        push('supplement_opinion', '补充意见', 'secondary', 'right');
        if (f.primaryAction === 'need_decision') {
          push('adopt_anyway', '仍然采用', 'secondary', 'right');
        }
        push('pause_task', '暂停任务', 'more', 'right');
      } else {
        statusLine = '建议继续修正';
        push('confirm_continue', '确认继续', 'primary', 'right');
        push('supplement_opinion', '补充意见', 'secondary', 'right');
        push('pause_task', '暂停任务', 'more', 'right');
      }
      if (f.hasWorkingDirectory) push('restore_baseline', '恢复执行前状态', 'more', 'right');
      if (f.hasWorkingDirectory) push('open_project', '打开项目', 'more', 'middle');
      if (f.decisionStatus !== 'rejected') push('restart_compose', '创建新任务', 'more', 'middle');
    } else if (stage === 'needs_review') {
      statusLine = 'Digital Me 建议采用当前成果';
      hideDecisionHint = true;
      push('accept', '确认采用', 'primary', 'right');
      push('supplement_opinion', '补充意见', 'secondary', 'right');
      push('pause_task', '暂停任务', 'more', 'right');
      if (f.hasWorkingDirectory) push('restore_baseline', '恢复执行前状态', 'more', 'right');
      if (f.hasWorkingDirectory) push('open_project', '打开项目', 'more', 'middle');
      push('restart_compose', '创建新任务', 'more', 'middle');
      push('collab_open', '请人帮忙', 'more', 'middle');
      push('external_cap', '用专业能力', 'more', 'middle');
    } else if (stage === 'adopted') {
      hideDecisionHint = true;
      if (f.revisionComposerOpen) {
        statusLine = '说明还需要修改什么';
        push('submit_revision', '提交修改', 'primary', 'right');
        push('cancel_revision', '取消', 'secondary', 'right');
        push('add_revision_shot', '添加截图', 'more', 'right');
      } else if (f.canTryRun && !f.startupFailed) {
        statusLine = '可以试用了';
        push('try_run', '试运行', 'primary', 'right');
        push('continue_revise', '继续修改', 'secondary', 'right');
        push('open_project', '打开项目', 'secondary', 'right');
      } else if (f.codeChange && f.startupFailed) {
        statusLine = '已采用，但仍需修复后才能正常使用';
        push('continue_revise', '继续修复', 'primary', 'right');
        push('open_project', '打开项目', 'secondary', 'right');
        push('tell_what_wrong', '告诉 Digital Me 哪里不对', 'more', 'right');
      } else if (f.codeChange) {
        statusLine = '已采用';
        push('open_project', '打开项目', 'primary', 'right');
        push('continue_revise', '继续修改', 'secondary', 'right');
      } else {
        statusLine = '已采用';
        push('reveal_artifact', '打开所在目录', 'primary', 'right');
        push('continue_revise', '继续修改', 'secondary', 'right');
      }
      push('restore_baseline', '恢复执行前状态', 'more', 'right');
      push('restart_compose', '创建新任务', 'more', 'middle');
      push('collab_open', '请人帮忙', 'more', 'middle');
      push('external_cap', '用专业能力', 'more', 'middle');
      push('export_md', '导出 Markdown', 'more', 'right');
      push('export_docx', '导出 Word', 'more', 'right');
      push('copy_artifact', '复制', 'more', 'right');
    } else if (stage === 'blocked') {
      statusLine = jsLabelBlocked(f);
      push('retry_job', '重试', 'primary', 'middle');
      push('restart_compose', '返回修改', 'secondary', 'middle');
      if (f.hasWorkingDirectory) push('open_project', '打开项目', 'more', 'middle');
      if (f.hasWorkingDirectory) push('restore_baseline', '恢复执行前状态', 'more', 'right');
      push('collab_open', '请人帮忙', 'more', 'middle');
    }

    // 预算裁剪：主≤1，次≤2；其余进更多
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
        if (secondary > 2) return { ...a, slot: 'more' };
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
    if (secondary.length > 2) errors.push('secondary>' + secondary.length);
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
