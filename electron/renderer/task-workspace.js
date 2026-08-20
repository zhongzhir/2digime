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
        /^(任务目标|目标|预期交付|如何判断完成|交付|准备怎么做|建议实现路径|实现路径|路径|必要准备条件|准备条件|准备|重要边界或风险|重要边界|边界|风险)\s*[:：]\s*(.*)$/,
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
    if (/如何判断完成|交付/.test(label)) return 'delivery';
    if (/准备怎么做|路径/.test(label)) return 'path';
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
   * @param {{ progressNote?: string, planVersion?: number }|null} [input.running]
   * @param {string} [input.title]
   */
  function renderTaskWorkspace(input) {
    const root = input && input.root;
    if (!root) return;
    const planEl = root.querySelector('#task-workspace-plan');
    const prepEl = root.querySelector('#task-workspace-prep');
    const runningEl = root.querySelector('#task-workspace-running');
    const titleEl = root.querySelector('#task-workspace-title');
    const mode = (input && input.mode) || 'idle';

    if (titleEl) {
      titleEl.textContent = input.title || titleForMode(mode);
    }

    if (planEl) {
      const showPlan = mode === 'planning' && input.plan && input.plan.content;
      planEl.hidden = !showPlan;
      if (showPlan) setPlanEl(planEl, input.plan, input.goal, !!input.thinRuntime);
    }
    if (prepEl) {
      const showPrep = mode === 'prep_blocked' && input.prep;
      prepEl.hidden = !showPrep;
      if (showPrep) setPrepEl(prepEl, input.prep);
    }
    if (runningEl) {
      const showRunning = mode === 'running' || mode === 'revising';
      runningEl.hidden = !showRunning;
      if (showRunning) {
        setRunningEl(runningEl, input.running || {}, input.plan, mode === 'revising', !!input.thinRuntime);
      }
    }
  }

  /**
   * 从现有 Task/Job/Artifact 事实派生右栏模式。
   * 已有 Job 或成果时不得回到初始「开发规划 + 开始开发」。
   */
  function deriveWorkspaceMode(facts) {
    const f = facts || {};
    const js = String(f.jobStatus || '');
    const running = js === 'queued' || js === 'running';
    const hasArtifact = !!(
      f.hasArtifact ||
      (Array.isArray(f.artifactIds) && f.artifactIds.length) ||
      f.latestArtifactId
    );
    if (f.prepBlocked) return 'prep_blocked';
    if (running && f.revising) return 'revising';
    if (running) return 'running';
    if (hasArtifact) return 'complete';
    if (js === 'failed' || js === 'cancelled') return 'idle';
    if (f.hasPlan && !js) return 'planning';
    return 'idle';
  }

  function titleForMode(mode) {
    if (mode === 'planning') return '任务工作区 · 开发规划';
    if (mode === 'prep_blocked') return '任务工作区 · 准备';
    if (mode === 'running') return '任务工作区 · 开发中';
    if (mode === 'revising') return '任务工作区 · 修订中';
    if (mode === 'complete') return '任务工作区 · 成果';
    return '任务工作区';
  }

  function setPlanEl(planEl, plan, goal, thinRuntime) {
    const sections = parsePlanSections(plan.content, goal);
    const versionEl = planEl.querySelector('#tw-plan-version');
    const statusEl = planEl.querySelector('#tw-plan-status');
    const headingEl = planEl.querySelector('#tw-plan-heading');
    const setText = (sel, text) => {
      const el = planEl.querySelector(sel);
      if (el) el.textContent = text || '（待补充）';
    };
    if (headingEl) headingEl.textContent = thinRuntime ? '当前方案' : '开发规划';
    if (versionEl) {
      versionEl.textContent = thinRuntime ? '确认后开始处理' : '规划版本 v' + String(plan.version || 1);
      versionEl.hidden = false;
    }
    if (statusEl) {
      statusEl.textContent = plan.status === 'confirmed' ? '已确认' : '待你确认';
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
      startBtn.textContent = thinRuntime ? '确认并开始' : '确认规划并开始开发';
    }
    const hint = planEl.querySelector('#tw-plan-confirm-hint');
    if (hint) {
      hint.hidden = true;
      hint.textContent = '';
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

  function setRunningEl(runningEl, running, plan, revising, thinRuntime) {
    const title = runningEl.querySelector('#tw-running-title');
    const planEl = runningEl.querySelector('#tw-running-plan');
    const progressEl = runningEl.querySelector('#tw-running-progress');
    if (title) title.textContent = revising ? '修订中' : '开发中';
    if (planEl) {
      const round = running.round;
      const ver = running.planVersion || (plan && plan.version);
      const parts = [];
      if (thinRuntime) {
        parts.push('按已确认的方案执行');
      } else if (ver) {
        parts.push('按已确认的规划版本 v' + String(ver));
      }
      if (round) parts.push('第 ' + String(round) + ' 轮');
      planEl.textContent = parts.length ? parts.join(' · ') : '按已确认的规划执行';
    }
    if (progressEl) {
      progressEl.textContent =
        String(running.progressNote || '').trim() ||
        (revising ? '正在按修订方案继续处理…' : '正在实现与验证，请稍候…');
    }
  }

  /**
   * 低风险自动授权：仅当确认对象已是当前规划、且无扩大权限/破坏性意图时。
   */
  function isHighRiskExecution(goal, preview) {
    const g = String(goal || '');
    if (
      /删除整个|清空(项目|仓库|目录)|格式化磁盘|覆盖全部|系统目录|管理员权限|\bsudo\b|git\s+push|\bpush\s+到|提交并推送|部署到|发布到生产|rm\s+-rf/i.test(
        g,
      )
    ) {
      return true;
    }
    const writeScope = (preview && preview.writeScope) || [];
    const wd = preview && preview.workingDirectory ? String(preview.workingDirectory) : '';
    const norm = (p) =>
      String(p || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
    const root = norm(wd);
    if (!root) return false;
    const isInsideProject = (raw) => {
      const child = norm(raw);
      if (!child || child === '.' || child === './') return true;
      if (child === root || child.startsWith(root + '/')) return true;
      const isAbs = /^[a-z]:/.test(child) || child.startsWith('/');
      if (!isAbs) {
        const resolved = norm(root + '/' + child.replace(/^\.\//, ''));
        return resolved === root || resolved.startsWith(root + '/');
      }
      return false;
    };
    return writeScope.some((s) => !isInsideProject(s));
  }

  const api = {
    parsePlanSections,
    renderTaskWorkspace,
    isHighRiskExecution,
    titleForMode,
    deriveWorkspaceMode,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DigitalMeTaskWorkspace = api;
})(typeof window !== 'undefined' ? window : globalThis);
