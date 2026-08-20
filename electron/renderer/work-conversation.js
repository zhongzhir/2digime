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

    const cto = String(input.ctoReport || '').trim();
    const extraTurns = Array.isArray(input.extraTurns) ? input.extraTurns : [];
    const extraJoined = extraTurns.map((t) => String(t && t.text ? t.text : '')).join('\n');

    const isClosingTurn = (text) => /本次任务结束/.test(String(text || ''));
    const isNextFragment = (text) => {
      const t = String(text || '').trim();
      return /^无[，,。]?$/.test(t) || (/可直接交付使用/.test(t) && t.length < 24);
    };
    for (const extra of extraTurns) {
      const extraText = extra && extra.text ? extra.text : '';
      if (isClosingTurn(extraText) || isNextFragment(extraText)) continue;
      push(extra);
    }

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
        text: '正在处理…',
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

    if (cto && extraJoined.indexOf(cto.slice(0, 24)) === -1) {
      const actions = [];
      const decision = String(input.ctoDecision || '').trim();
      if (input.canAdoptSuggested && !input.decisionAccepted) {
        actions.push({ id: 'confirm_adopt', label: '采用这份成果' });
      } else if (
        !input.decisionAccepted &&
        (decision === 'needs_revision' || input.primaryAction === 'confirm_continue') &&
        (input.revisionPaused || input.requireUserDecision)
      ) {
        actions.push({ id: 'confirm_continue', label: '按建议继续修改' });
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
      if (
        next &&
        extraJoined.indexOf(next) === -1 &&
        cto.indexOf(next) === -1 &&
        !/^(无|没有)[，,。]/.test(next) &&
        !/可直接交付使用/.test(next)
      ) {
        push({
          id: `cto_next_${input.artifactVersionId || 'latest'}`,
          role: 'digital_me',
          kind: 'next_step',
          text: next,
        });
      }
    } else if (input.hasArtifact && !input.jobRunning && input.acceptanceFailed) {
      push({
        id: 'acceptance_failed',
        role: 'digital_me',
        kind: 'acceptance',
        text:
          String(input.acceptanceFailureMessage || '').trim() ||
          '成果已生成，但验收说明暂未完成，可重试。',
        actions: [{ id: 'retry_acceptance', label: '重新整理验收说明' }],
      });
    } else if (input.hasArtifact && !input.jobRunning && !cto && !input.decisionAccepted) {
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
        text: '好的，本次任务结束。如有其它需要，请随时告诉我。',
      });
    }

    return turns;
  }

  // D11-A（设计 v0.2 §9.1）：关键词路由 routeWorkNaturalLanguage 已移除。
  // 自然语言意图一律由 AI 经 work.converse 结合完整 Task 上下文判断；
  // 模型不可用时降级为明确提示，不做关键词路由，不得从自然语言创建 Job。

  function roleLabel(role) {
    if (role === 'user') return '你';
    if (role === 'digital_me') return 'Digital Me';
    return '系统';
  }

  const api = {
    buildWorkTimeline,
    roleLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DigitalMeWorkConversation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
