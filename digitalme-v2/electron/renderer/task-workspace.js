/**
 * D11-B 右栏「任务工作区」— 规划卡 / 准备受阻视图。
 * 不构成第二状态机；只渲染 Task.meta.plan 与派生的准备事实。
 */
(function (root) {
  'use strict';

  /**
   * 从规划正文抽取面向用户的栏目。容许模型用「目标：」「交付：」等标签行。
   * @param {string} content
   * @param {string} [fallbackGoal]
   */
  function parsePlanSections(content, fallbackGoal) {
    const text = String(content || '').trim();
    const sections = {
      goal: '',
      delivery: '',
      path: '',
      prep: '',
      bounds: '',
      rest: '',
    };
    if (!text) {
      sections.goal = String(fallbackGoal || '').trim();
      return sections;
    }

    const buckets = {
      goal: [],
      delivery: [],
      path: [],
      prep: [],
      bounds: [],
      rest: [],
    };
    let current = 'rest';
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = String(raw || '').trim();
      if (!line) continue;
      const labeled = line.match(
        /^(任务目标|目标|预期交付|交付|建议实现路径|实现路径|路径|必要准备条件|准备条件|准备|重要边界或风险|重要边界|边界|风险)\s*[:：]\s*(.*)$/,
      );
      if (labeled) {
        const key = mapLabel(labeled[1]);
        current = key;
        if (labeled[2]) buckets[key].push(labeled[2]);
        continue;
      }
      buckets[current].push(line.replace(/^[-*•]\s*/, ''));
    }

    for (const k of Object.keys(sections)) {
      sections[k] = buckets[k].join('\n').trim();
    }
    if (!sections.goal) sections.goal = String(fallbackGoal || '').trim();
    if (!sections.bounds) {
      sections.bounds = '不会自动提交、推送或发布；仅在你确认的项目范围内工作。';
    }
    if (!sections.prep) {
      sections.prep = '若需改代码：可用的项目位置与已连接的代码执行能力。';
    }
    return sections;
  }

  function mapLabel(label) {
    if (/目标/.test(label)) return 'goal';
    if (/交付/.test(label)) return 'delivery';
    if (/路径/.test(label)) return 'path';
    if (/准备/.test(label)) return 'prep';
    if (/边界|风险/.test(label)) return 'bounds';
    return 'rest';
  }

  /**
   * @param {object} input
   * @param {HTMLElement|null} input.root
   * @param {object|null} input.plan
   * @param {string} [input.goal]
   * @param {'planning'|'prep_blocked'|'running'|'complete'|'idle'} input.mode
   * @param {object|null} [input.prep]
   * @param {string} [input.title]
   */
  function renderTaskWorkspace(input) {
    const root = input && input.root;
    if (!root) return;
    const planEl = root.querySelector('#task-workspace-plan');
    const prepEl = root.querySelector('#task-workspace-prep');
    const titleEl = root.querySelector('#task-workspace-title');
    const mode = (input && input.mode) || 'idle';

    if (titleEl) {
      titleEl.textContent = input.title || titleForMode(mode);
    }

    if (planEl) {
      const showPlan = mode === 'planning' && input.plan && input.plan.content;
      planEl.hidden = !showPlan;
      if (showPlan) setPlanEl(planEl, input.plan, input.goal);
    }
    if (prepEl) {
      const showPrep = mode === 'prep_blocked' && input.prep;
      prepEl.hidden = !showPrep;
      if (showPrep) setPrepEl(prepEl, input.prep);
    }
  }

  function titleForMode(mode) {
    if (mode === 'planning') return '任务工作区 · 规划';
    if (mode === 'prep_blocked') return '任务工作区 · 准备';
    if (mode === 'running') return '任务工作区 · 进行中';
    if (mode === 'complete') return '任务工作区 · 成果';
    return '任务工作区';
  }

  function setPlanEl(planEl, plan, goal) {
    const sections = parsePlanSections(plan.content, goal);
    const versionEl = planEl.querySelector('#tw-plan-version');
    const statusEl = planEl.querySelector('#tw-plan-status');
    const setText = (sel, text) => {
      const el = planEl.querySelector(sel);
      if (el) el.textContent = text || '（待补充）';
    };
    if (versionEl) versionEl.textContent = '规划版本 v' + String(plan.version || 1);
    if (statusEl) {
      statusEl.textContent =
        plan.status === 'confirmed' ? '已确认' : '待确认 · 可继续在对话中修改';
    }
    setText('#tw-plan-goal', sections.goal);
    setText('#tw-plan-delivery', sections.delivery || sections.rest);
    setText('#tw-plan-path', sections.path);
    setText('#tw-plan-prep', sections.prep);
    setText('#tw-plan-bounds', sections.bounds);
    const startBtn = planEl.querySelector('#btn-start-development');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.dataset.planVersion = String(plan.version || 1);
    }
    const hint = planEl.querySelector('#tw-plan-confirm-hint');
    if (hint) {
      hint.textContent =
        '确认后将按规划版本 v' +
        String(plan.version || 1) +
        ' 开始开发。确认对象是这份规划，不会再分别确认普通技术细节。';
    }
  }

  function setPrepEl(prepEl, prep) {
    const setText = (sel, text) => {
      const el = prepEl.querySelector(sel);
      if (el) el.textContent = text || '';
    };
    setText('#tw-prep-title', prep.title || '开发前还需完成准备');
    setText('#tw-prep-missing', prep.missing || '');
    setText('#tw-prep-why', prep.why || '');
    setText('#tw-prep-checked', prep.checked || '');
    setText('#tw-prep-action', prep.action || '');
    setText('#tw-prep-continue', prep.continueHint || '完成后点「继续准备」或再次确认开始。');
  }

  /**
   * 低风险自动授权：仅当确认对象已是当前规划、且无扩大权限/破坏性意图时。
   */
  function isHighRiskExecution(goal, preview) {
    const g = String(goal || '');
    if (/删除整个|清空(项目|仓库|目录)|格式化|覆盖全部|系统目录|管理员权限|\bsudo\b/i.test(g)) {
      return true;
    }
    const writeScope = (preview && preview.writeScope) || [];
    const wd = preview && preview.workingDirectory ? String(preview.workingDirectory) : '';
    if (wd && writeScope.some((s) => !String(s).startsWith(wd))) {
      return true;
    }
    return false;
  }

  const api = {
    parsePlanSections,
    renderTaskWorkspace,
    isHighRiskExecution,
    titleForMode,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DigitalMeTaskWorkspace = api;
})(typeof window !== 'undefined' ? window : globalThis);
