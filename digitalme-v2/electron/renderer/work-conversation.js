/**
 * 做事页中栏对话时间线 — 从 Task/Job/Artifact/acceptance 事实派生展示，
 * 不新增第二套会话状态机或事实源。
 */
(function (root) {
  'use strict';

  /**
   * @typedef {object} WorkTurn
   * @property {string} id
   * @property {'user'|'digital_me'|'system'} role
   * @property {string} kind
   * @property {string} text
   * @property {string} [createdAt]
   * @property {Array<{id:string,label:string}>} [actions]
   * @property {string} [artifactVersionId]
   */

  /**
   * @param {object} input
   * @returns {WorkTurn[]}
   */
  function buildWorkTimeline(input) {
    const turns = [];
    const push = (partial) => {
      const text = String(partial.text || '').trim();
      if (!text && !(partial.actions && partial.actions.length)) return;
      turns.push({
        id: partial.id || `turn_${turns.length + 1}`,
        role: partial.role || 'system',
        kind: partial.kind || 'note',
        text,
        ...(partial.createdAt ? { createdAt: partial.createdAt } : {}),
        ...(partial.actions && partial.actions.length ? { actions: partial.actions } : {}),
        ...(partial.artifactVersionId ? { artifactVersionId: partial.artifactVersionId } : {}),
      });
    };

    const goal = String(input.goal || '').trim();
    if (goal) {
      push({
        id: 'user_goal',
        role: 'user',
        kind: 'goal',
        text: goal,
        createdAt: input.taskCreatedAt,
      });
    }

    for (const line of input.understandingLines || []) {
      const t = String(line || '').trim();
      if (t) {
        push({
          id: `understanding_${turns.length}`,
          role: 'digital_me',
          kind: 'understanding',
          text: t,
        });
      }
    }

    if (input.jobRunning) {
      push({
        id: 'progress_running',
        role: 'digital_me',
        kind: 'progress',
        text: input.revisionActive
          ? '正在按你的意见继续处理同一任务…'
          : '正在处理这项任务…',
      });
    }

    if (input.jobFailed) {
      push({
        id: 'progress_failed',
        role: 'digital_me',
        kind: 'failure',
        text:
          String(input.failureMessage || '').trim() ||
          '本轮执行未能完成。你可以继续说明期望，或使用快捷「重试」。',
        actions: [{ id: 'retry_job', label: '重试' }],
      });
    }

    const cto = String(input.ctoReport || '').trim();
    if (cto) {
      const actions = [];
      if (input.canAdoptSuggested) {
        actions.push({ id: 'confirm_adopt', label: '确认采用' });
      }
      push({
        id: `cto_${input.artifactVersionId || 'latest'}`,
        role: 'digital_me',
        kind: 'acceptance',
        text: cto,
        artifactVersionId: input.artifactVersionId || '',
        actions,
      });
      const next = String(input.userFacingNextStep || '').trim();
      if (next) {
        push({
          id: `cto_next_${input.artifactVersionId || 'latest'}`,
          role: 'digital_me',
          kind: 'next_step',
          text: next,
        });
      }
    } else if (input.hasArtifact && !input.jobRunning) {
      push({
        id: 'artifact_ready_no_cto',
        role: 'digital_me',
        kind: 'progress',
        text: '本轮已有成果，正在整理验收说明…',
      });
    }

    if (input.decisionAccepted) {
      push({
        id: 'adopted',
        role: 'digital_me',
        kind: 'adopted',
        text: '你已确认采用当前成果。交付循环已结束，结果已沉淀。',
      });
    }

    for (const extra of input.extraTurns || []) {
      push(extra);
    }

    return turns;
  }

  /**
   * 将中栏自然语言路由为提交首轮 / 修订 / 暂停（不靠关键词规则表；仅识别明确暂停用语）。
   * @param {object} ctx
   */
  function routeWorkNaturalLanguage(ctx) {
    const text = String(ctx.text || '').trim();
    if (!text) return { action: 'noop', reason: 'empty' };

    const paused =
      /^(先)?暂停(任务)?[。.!！]?$/.test(text) ||
      /^pause$/i.test(text) ||
      /^先停一下[。.!！]?$/.test(text);
    if (paused) return { action: 'pause', text };

    if (ctx.workMode === 'compose' || !ctx.activeTaskId) {
      return { action: 'submit_new', text };
    }
    if (ctx.jobRunning) {
      return { action: 'note_only', text, reason: 'running' };
    }
    if (ctx.decisionAccepted) {
      return { action: 'note_only', text, reason: 'adopted' };
    }
    if (ctx.activeArtifactId) {
      return { action: 'revise', text };
    }
    if (ctx.jobFailed) {
      return { action: 'revise_or_retry', text };
    }
    return { action: 'submit_new', text };
  }

  function roleLabel(role) {
    if (role === 'user') return '你';
    if (role === 'digital_me') return 'Digital Me';
    return '系统';
  }

  const api = {
    buildWorkTimeline,
    routeWorkNaturalLanguage,
    roleLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DigitalMeWorkConversation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
