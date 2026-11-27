'use strict';
/**
 * 数字之我页：只投影 Digital Self 唯一权威。
 * 围绕：现在怎样理解我 / 为什么（来源）/ 我可以纠正。
 * 不展示 Event / Store / Candidate ID / confidence / provenance 结构。
 */
(function () {
  const CURRENT_ORDER = ['about_me', 'goals', 'preferences', 'boundaries'];
  const GROUP_TITLE = {
    learning: '最近新增',
    about_me: '关于我',
    goals: '关心与目标',
    preferences: '偏好与判断',
    boundaries: '边界',
  };
  const OVERVIEW_CURRENT_LIMIT = 3;
  let ledgerOpen = false;
  let lastGroups = null;

  function api() {
    return window.digitalMe;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setBusy(busy) {
    const tell = $('btn-ds-tell');
    const submit = $('btn-ds-tell-submit');
    const imp = $('btn-ds-import');
    if (tell) tell.disabled = busy;
    if (submit) submit.disabled = busy;
    if (imp) imp.disabled = busy;
  }

  function setNotice(text) {
    const el = $('ds-notice');
    if (!el) return;
    el.textContent = text || '';
  }

  function setProjectionNotice(text) {
    const el = $('ds-capability-notice');
    if (el) el.textContent = text || '';
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text || '';
  }

  function collaborationLabel(item) {
    const role = item && item.role === 'responder' ? 'responder' : 'initiator';
    const status = item ? item.status : '';
    if (status === 'revoked' || status === 'withdrawn') return '已结束';
    if (status === 'failed') return '未完成';
    if (status === 'running') return role === 'responder' ? '你正在完成' : '对方正在处理';
    if (status === 'awaiting_owner') return role === 'responder' ? '等待你确认' : '等待对方确认';
    if (status === 'awaiting_clarification') return '等待补充说明';
    if (status === 'counter_proposed') return role === 'responder' ? '等待你确认调整' : '对方提出调整';
    if (status === 'proposed') return role === 'responder' ? '待你确认协作' : '等待对方确认';
    if (status === 'delivered') return role === 'initiator' ? '需要你确认结果' : '等待对方确认结果';
    if (status === 'authorized' || status === 'agreed') return '协作已建立';
    if (item && (item.ownerDecision === 'accept' || status === 'completed')) return '已完成';
    if (item && item.ownerDecision === 'reject' && item.returnedExcerpt) return '结果已退回';
    if (item && (item.ownerDecision === 'reject' || status === 'rejected')) return '暂未建立协作';
    return role === 'responder' ? '待你确认协作' : '等待开始';
  }

  function collaborationNeedsAttention(item) {
    const status = item ? item.status : '';
    if (status === 'awaiting_owner' || status === 'counter_proposed') return true;
    if (status === 'proposed') return item && item.role === 'responder';
    if (status === 'delivered') return !item || item.role !== 'responder';
    return false;
  }

  function collaborationCanRespond(item) {
    return Boolean(
      item &&
        item.role === 'responder' &&
        (item.status === 'proposed' || item.status === 'awaiting_owner'),
    );
  }

  function collaborationCanDecideResult(item) {
    return Boolean(item && item.role === 'initiator' && item.status === 'delivered');
  }

  function collaborationCanStop(item) {
    if (!item) return false;
    if (collaborationCanRespond(item) || collaborationCanDecideResult(item)) return false;
    return ![
      'completed',
      'rejected',
      'revoked',
      'withdrawn',
    ].includes(item.status);
  }

  async function runCollaborationAction(item, action, row) {
    const peer = item.peerDisplayName || item.granteeDisplayName || '协作对象';
    let prompt = '';
    let success = '';
    let input;
    if (action === 'accept') {
      prompt = `接受后，兔机米会按当前目标和已选择的材料建立本次授权。确认接受与${peer}的协作吗？`;
      success = `已接受与${peer}的协作。`;
      input = { action: 'respond', recordId: item.recordId, decision: 'accept' };
    } else if (action === 'reject') {
      prompt = `确认拒绝与${peer}的这次协作吗？`;
      success = `已拒绝与${peer}的这次协作。`;
      input = { action: 'respond', recordId: item.recordId, decision: 'reject' };
    } else if (action === 'accept_result') {
      prompt = `确认采用${peer}交付的这份协作结果吗？`;
      success = `已采用${peer}交付的协作结果。`;
      input = { action: 'decideResult', recordId: item.recordId, decision: 'accept' };
    } else if (action === 'reject_result') {
      prompt = `退回后，这份结果不会被采用。确认退回${peer}交付的协作结果吗？`;
      success = `已退回${peer}交付的协作结果。`;
      input = { action: 'decideResult', recordId: item.recordId, decision: 'reject' };
    } else {
      prompt = `结束后，对方不能再使用本次授权继续处理。确认结束与${peer}的协作吗？`;
      success = `已结束与${peer}的协作。`;
      input = { action: 'revoke', recordId: item.recordId };
    }
    if (!window.confirm(prompt)) return;
    const buttons = row ? Array.from(row.querySelectorAll('button')) : [];
    for (const button of buttons) button.disabled = true;
    setProjectionNotice('正在更新协作…');
    try {
      await api().invoke('collab.interact', input);
      await refreshCapabilityProjection();
      setProjectionNotice(success);
    } catch (_err) {
      setProjectionNotice('这次协作操作没有完成，原状态保持不变。');
    } finally {
      for (const button of buttons) button.disabled = false;
    }
  }

  function appendCollaborationAction(actions, label, item, action, row) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'accept' || action === 'accept_result' ? 'primary' : 'ghost';
    button.textContent = label;
    button.addEventListener('click', () => runCollaborationAction(item, action, row));
    actions.appendChild(button);
  }

  function renderCollaborations(items) {
    const list = $('ds-collaboration-list');
    const empty = $('ds-collaboration-empty');
    const rows = Array.isArray(items) ? items : [];
    const attention = rows.filter(collaborationNeedsAttention).length;
    setText(
      'ds-collaboration-summary',
      rows.length ? `${rows.length} 项协作${attention ? ` · ${attention} 项需要处理` : ''}` : '0 项协作',
    );
    if (empty) empty.hidden = rows.length > 0;
    if (!list) return;
    list.textContent = '';
    for (const item of rows.slice(0, 3)) {
      const li = document.createElement('li');
      li.className = 'ds-collaboration-item';
      const title = document.createElement('p');
      title.className = 'ds-collaboration-title';
      title.textContent = item.peerDisplayName || item.granteeDisplayName || '协作对象';
      const goal = document.createElement('p');
      goal.className = 'ds-collaboration-goal';
      goal.textContent = item.subtaskGoal || '协作事项';
      const meta = document.createElement('p');
      meta.className = 'muted tiny';
      meta.textContent = `${item.role === 'responder' ? '对方发来' : '你发起'} · ${collaborationLabel(item)}`;
      li.appendChild(title);
      li.appendChild(goal);
      li.appendChild(meta);
      if (Array.isArray(item.allowedMaterials)) {
        const scope = document.createElement('p');
        scope.className = 'muted tiny';
        scope.textContent = item.allowedMaterials.length
          ? `${item.role === 'responder' ? '对方计划提供' : '本次允许'} ${item.allowedMaterials.length} 份材料`
          : '本次没有文件材料';
        li.appendChild(scope);
      }
      if (item.returnedExcerpt) {
        const result = document.createElement('p');
        result.className = 'ds-collaboration-result';
        result.textContent = `结果：${String(item.returnedExcerpt).slice(0, 100)}`;
        li.appendChild(result);
      }
      if (
        collaborationCanRespond(item) ||
        collaborationCanDecideResult(item) ||
        collaborationCanStop(item)
      ) {
        const actions = document.createElement('div');
        actions.className = 'ds-collaboration-actions';
        if (collaborationCanRespond(item)) {
          appendCollaborationAction(actions, '接受', item, 'accept', li);
          appendCollaborationAction(actions, '拒绝', item, 'reject', li);
        } else if (collaborationCanDecideResult(item)) {
          appendCollaborationAction(actions, '采用结果', item, 'accept_result', li);
          appendCollaborationAction(actions, '退回结果', item, 'reject_result', li);
        } else if (collaborationCanStop(item)) {
          const stopLabel = item.status === 'proposed' ? '取消请求' : '结束协作';
          appendCollaborationAction(actions, stopLabel, item, 'revoke', li);
        }
        li.appendChild(actions);
      }
      list.appendChild(li);
    }
  }

  function automationTriggerLabel(item) {
    const trigger = item && item.trigger ? item.trigger.type : '';
    if (trigger === 'scheduled') return '按设定时间';
    if (trigger === 'file_arrival') return '有新文件到达时';
    if (trigger === 'institution_event') return '机构发来事件时';
    return '按已设条件';
  }

  function automationStateLabel(item) {
    if (!item) return '';
    if (item.lifecycle === 'paused') return '已暂停';
    if (item.lifecycle === 'revoked') return '已撤销';
    return '运行中';
  }

  async function runAutomationAction(item, action, receipt, row) {
    const labels = {
      automationPause: '暂停后，新事件不会触发这项自动化。确认暂停吗？',
      automationResume: '确认恢复这项自动化吗？',
      automationRevoke: '撤销后不能恢复，但已有结果会保留。确认撤销吗？',
      automationConfirm: `确认现在运行“${item.title || '这项自动化'}”吗？`,
    };
    if (!window.confirm(labels[action] || '确认继续吗？')) return;
    const buttons = row ? Array.from(row.querySelectorAll('button')) : [];
    for (const button of buttons) button.disabled = true;
    setProjectionNotice(action === 'automationConfirm' ? '正在完成这项自动化…' : '正在更新自动化…');
    try {
      await api().invoke('digitalSelf', {
        action,
        automationId: item.id,
        ...(receipt ? { receiptId: receipt.id } : {}),
      });
      await refreshCapabilityProjection();
      if (action === 'automationConfirm') {
        setProjectionNotice('已运行，结果已回到对话。');
        const nav = $('nav-chat');
        if (nav) nav.click();
      } else {
        setProjectionNotice('自动化设置已更新。');
      }
    } catch (_err) {
      setProjectionNotice('这次自动化操作没有完成，原设置保持不变。');
    } finally {
      for (const button of buttons) button.disabled = false;
    }
  }

  function appendAutomationAction(actions, label, item, action, receipt, row, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'primary' : 'ghost';
    button.textContent = label;
    button.addEventListener('click', () => runAutomationAction(item, action, receipt, row));
    actions.appendChild(button);
  }

  function renderAutomations(items) {
    const list = $('ds-automation-list');
    const empty = $('ds-automation-empty');
    const rows = Array.isArray(items) ? items : [];
    const active = rows.filter((item) => item.lifecycle === 'active').length;
    const pending = rows.reduce(
      (count, item) => count + (
        item.lifecycle === 'active' &&
        Array.isArray(item.receipts) &&
        item.receipts.some((receipt) => !receipt.confirmedAt)
          ? 1
          : 0
      ),
      0,
    );
    setText(
      'ds-automation-summary',
      rows.length ? `${active} 项运行中${pending ? ` · ${pending} 项需要确认` : ''}` : '0 项自动化',
    );
    if (empty) empty.hidden = rows.length > 0;
    if (!list) return;
    list.textContent = '';
    for (const item of rows.slice(0, 3)) {
      const li = document.createElement('li');
      li.className = 'ds-collaboration-item';
      const title = document.createElement('p');
      title.className = 'ds-collaboration-title';
      title.textContent = item.title || '自动化';
      const goal = document.createElement('p');
      goal.className = 'ds-collaboration-goal';
      goal.textContent = item.goalTemplate || '按已设目标处理';
      const meta = document.createElement('p');
      meta.className = 'muted tiny';
      meta.textContent = `${automationTriggerLabel(item)} · ${automationStateLabel(item)}`;
      li.appendChild(title);
      li.appendChild(goal);
      li.appendChild(meta);
      const receipts = Array.isArray(item.receipts) ? item.receipts : [];
      const pendingReceipt = receipts.find((receipt) => !receipt.confirmedAt);
      const latest = receipts[0];
      if (pendingReceipt || latest) {
        const result = document.createElement('p');
        result.className = 'muted tiny';
        result.textContent = pendingReceipt
          ? item.lifecycle === 'revoked'
            ? '撤销前收到的触发已取消，不会执行。'
            : item.lifecycle === 'paused'
              ? '有一次新触发；恢复后可由你确认。'
              : '有一次新触发，正在等你确认。'
          : latest.artifactPaths && latest.artifactPaths.length
            ? '最近一次已完成，结果在对话中。'
            : '最近一次已处理，详情在对话中。';
        li.appendChild(result);
      }
      if (item.lifecycle !== 'revoked' || pendingReceipt) {
        const actions = document.createElement('div');
        actions.className = 'ds-collaboration-actions';
        if (pendingReceipt && item.lifecycle === 'active') {
          appendAutomationAction(actions, '确认运行', item, 'automationConfirm', pendingReceipt, li, true);
        }
        if (item.lifecycle === 'active') {
          appendAutomationAction(actions, '暂停', item, 'automationPause', null, li, false);
        } else if (item.lifecycle === 'paused') {
          appendAutomationAction(actions, '恢复', item, 'automationResume', null, li, true);
        }
        if (item.lifecycle !== 'revoked') {
          appendAutomationAction(actions, '撤销', item, 'automationRevoke', null, li, false);
        }
        li.appendChild(actions);
      }
      list.appendChild(li);
    }
  }

  async function refreshCapabilityProjection() {
    const client = api();
    if (!client || typeof client.invoke !== 'function') {
      setProjectionNotice('暂时无法读取身份与授权摘要。');
      return;
    }
    setProjectionNotice('');
    const requests = [
      client.invoke('subject.getOverview', {}),
      typeof client.listFilesystemGrants === 'function'
        ? client.listFilesystemGrants()
        : Promise.reject(new Error('filesystem grants unavailable')),
      typeof client.getInstitutionStatus === 'function'
        ? client.getInstitutionStatus()
        : Promise.reject(new Error('institution status unavailable')),
      client.invoke('collab.interact', { action: 'list' }),
      client.invoke('digitalSelf', { action: 'automationList' }),
    ];
    const [identity, authorization, institution, collaboration, automation] = await Promise.allSettled(requests);

    if (identity.status === 'fulfilled' && identity.value) {
      setText('ds-identity-name', identity.value.displayName || '我的数字之我');
      setText('ds-identity-state', '本机主体已建立');
    } else {
      setText('ds-identity-name', '暂时无法读取');
      setText('ds-identity-state', '本次未能确认本机主体状态');
      setProjectionNotice('部分身份或授权信息暂时无法读取，请稍后重试。');
    }

    if (institution.status === 'fulfilled' && institution.value) {
      const info = institution.value;
      if (info.enabled && info.institutionUserId) {
        setText('ds-institution-state', `机构账号：已连接 ${info.organizationName || '机构服务'}`);
        setText('ds-identity-detail', '机构账号连接不等于真实身份认证；当前仍只确认本机主体归属。');
      } else {
        setText('ds-institution-state', '真实身份认证：尚未接入');
        setText('ds-identity-detail', '当前只确认本机主体归属；后续可在安全认证能力具备后连接真实身份。');
      }
    } else {
      setText('ds-institution-state', '身份认证状态暂时无法读取');
      setText('ds-identity-detail', '读取失败不表示未认证，请稍后重试。');
      setProjectionNotice('部分身份或授权信息暂时无法读取，请稍后重试。');
    }

    if (authorization.status === 'fulfilled' && authorization.value && authorization.value.ok) {
      const grants = Array.isArray(authorization.value.grants) ? authorization.value.grants : [];
      setText('ds-authorization-count', grants.length ? `已授权 ${grants.length} 个文件夹` : '没有文件夹授权');
      setText(
        'ds-authorization-detail',
        grants.length ? '这些文件夹可在设置中逐项撤销。' : '兔机米目前不能读取或修改你未授权的文件夹。',
      );
    } else {
      setText('ds-authorization-count', '暂时无法读取');
      setText('ds-authorization-detail', '读取失败不表示没有授权，请稍后重试。');
      setProjectionNotice('部分身份或授权信息暂时无法读取，请稍后重试。');
    }

    if (collaboration.status === 'fulfilled' && collaboration.value) {
      renderCollaborations(collaboration.value.items);
    } else {
      setText('ds-collaboration-summary', '暂时无法读取');
      setText('ds-collaboration-empty', '读取失败不表示没有协作，请稍后重试。');
      const empty = $('ds-collaboration-empty');
      if (empty) empty.hidden = false;
      const list = $('ds-collaboration-list');
      if (list) list.textContent = '';
      setProjectionNotice('部分身份、授权或协作信息暂时无法读取，请稍后重试。');
    }

    if (automation.status === 'fulfilled' && automation.value) {
      renderAutomations(automation.value.automations);
    } else {
      setText('ds-automation-summary', '暂时无法读取');
      const empty = $('ds-automation-empty');
      if (empty) {
        empty.textContent = '读取失败不表示没有自动化，请稍后重试。';
        empty.hidden = false;
      }
      const list = $('ds-automation-list');
      if (list) list.textContent = '';
      setProjectionNotice('部分身份、授权、协作或自动化信息暂时无法读取，请稍后重试。');
    }
  }

  function openTalkForCollaboration() {
    const nav = $('nav-chat');
    if (nav) nav.click();
    window.setTimeout(() => {
      const input = $('chat-input');
      if (!input) return;
      if (!String(input.value || '').trim()) input.value = '我想发起一项协作：';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    }, 0);
  }

  function showTellForm(show) {
    const form = $('ds-tell-form');
    if (!form) return;
    form.hidden = !show;
    if (show) {
      form.removeAttribute('hidden');
      const input = $('ds-tell-input');
      if (input) input.focus();
    } else {
      form.setAttribute('hidden', '');
    }
  }

  function flattenCurrent(groups) {
    const out = [];
    for (const key of CURRENT_ORDER) {
      for (const item of groups[key] || []) out.push(item);
    }
    return out;
  }

  function renderItem(item) {
    const li = document.createElement('li');
    li.className = 'ds-item';
    li.dataset.id = item.id;
    const text = document.createElement('p');
    text.className = 'ds-text';
    text.textContent = item.text;
    li.appendChild(text);

    const source = document.createElement('p');
    source.className = 'ds-source-line';
    const parts = [item.sourceLabel, item.confirmationLabel].filter(Boolean);
    source.textContent = parts.join(' · ');
    li.appendChild(source);

    const actions = document.createElement('div');
    actions.className = 'ds-item-actions';
    if (item.canConfirm) {
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary';
      confirm.dataset.act = 'confirm';
      confirm.textContent = '确认';
      actions.appendChild(confirm);
      const ignore = document.createElement('button');
      ignore.type = 'button';
      ignore.className = 'ghost';
      ignore.dataset.act = 'ignore';
      ignore.textContent = '忽略';
      actions.appendChild(ignore);
    }
    const correct = document.createElement('button');
    correct.type = 'button';
    correct.className = 'ghost';
    correct.dataset.act = 'correct';
    correct.textContent = '纠正';
    actions.appendChild(correct);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost';
    del.dataset.act = 'delete';
    del.textContent = '删除';
    actions.appendChild(del);
    li.appendChild(actions);
    return li;
  }

  function appendSection(parent, title, items, extraClass) {
    if (!items.length) return;
    const section = document.createElement('section');
    section.className = extraClass ? 'ds-group ' + extraClass : 'ds-group';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    section.appendChild(h2);
    const ul = document.createElement('ul');
    ul.className = 'ds-list';
    for (const item of items) ul.appendChild(renderItem(item));
    section.appendChild(ul);
    parent.appendChild(section);
  }

  function appendCollapsedGroup(parent, key, items, query) {
    if (!items.length) return;
    const details = document.createElement('details');
    details.className = 'ds-group ds-ledger-group';
    details.dataset.group = key;
    const q = String(query || '').trim().toLowerCase();
    const visible = q
      ? items.filter((item) => String(item.text || '').toLowerCase().includes(q) || String(item.sourceLabel || '').toLowerCase().includes(q))
      : items;
    if (!visible.length) return;
    if (q) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `${GROUP_TITLE[key] || key}（${visible.length}）`;
    details.appendChild(summary);
    const ul = document.createElement('ul');
    ul.className = 'ds-list';
    for (const item of visible) ul.appendChild(renderItem(item));
    details.appendChild(ul);
    parent.appendChild(details);
  }

  function setLedgerOpen(open) {
    ledgerOpen = !!open;
    const overview = $('ds-overview');
    const ledger = $('ds-ledger');
    if (overview) overview.hidden = ledgerOpen;
    if (ledger) ledger.hidden = !ledgerOpen;
    if (!lastGroups) return;
    if (ledgerOpen) {
      renderLedger(lastGroups, $('ds-fact-search') ? $('ds-fact-search').value : '');
    } else {
      const groupsEl = $('ds-groups');
      if (groupsEl) groupsEl.textContent = '';
      renderOverview(lastGroups);
    }
  }

  let defaultHeadline = '兔机米现在怎样理解我';

  function applyBrand(brand) {
    if (brand && brand.strings && brand.strings.selfHeadline) {
      defaultHeadline = brand.strings.selfHeadline;
    }
    const headline = $('ds-headline');
    if (headline && (!headline.textContent || /兔机米现在怎样理解我|助手现在怎样理解我/.test(headline.textContent))) {
      headline.textContent = defaultHeadline;
    }
    const emptyEl = $('ds-empty');
    if (emptyEl && brand && brand.strings && brand.strings.talkTitle) {
      const talkName = brand.strings.talkTitle;
      emptyEl.textContent = `还没有任何了解。在「${talkName}」里说话，或在这里补充一件事。`;
    }
  }

  function renderOverview(groups) {
    const summary = $('ds-overview-summary');
    const body = $('ds-overview-body');
    if (!body) return;
    body.textContent = '';
    const recent = groups.learning || [];
    const current = flattenCurrent(groups);
    const sources = [];
    const seen = new Set();
    for (const item of recent.concat(current)) {
      const label = item.sourceLabel;
      if (!label || seen.has(label)) continue;
      seen.add(label);
      sources.push(label);
    }
    if (summary) {
      const parts = [`当前 ${current.length} 条`, `最近新增 ${recent.length} 条`];
      if (sources.length) parts.push(`来源：${sources.slice(0, 4).join('、')}`);
      summary.textContent = parts.join(' · ');
    }
    appendSection(body, '最近它又了解了你这些', recent, 'ds-group-recent');
    appendSection(body, '当前理解', current.slice(0, OVERVIEW_CURRENT_LIMIT), 'ds-group-current');
    const openBtn = $('btn-ds-open-ledger');
    if (openBtn) openBtn.hidden = recent.length + current.length === 0;
  }

  function renderLedger(groups, query) {
    const groupsEl = $('ds-groups');
    if (!groupsEl) return;
    groupsEl.textContent = '';
    appendCollapsedGroup(groupsEl, 'learning', groups.learning || [], query);
    for (const key of CURRENT_ORDER) {
      appendCollapsedGroup(groupsEl, key, groups[key] || [], query);
    }
  }

  function renderView(view) {
    const headline = $('ds-headline');
    if (headline) headline.textContent = (view && view.headline) || defaultHeadline;
    setNotice(view && view.notice ? view.notice : '');
    const groups = (view && view.groups) || {};
    lastGroups = groups;
    const recent = groups.learning || [];
    const current = flattenCurrent(groups);
    const any = recent.length + current.length > 0;
    if (ledgerOpen && any) {
      renderLedger(groups, $('ds-fact-search') ? $('ds-fact-search').value : '');
      if ($('ds-overview')) $('ds-overview').hidden = true;
      if ($('ds-ledger')) $('ds-ledger').hidden = false;
    } else {
      ledgerOpen = false;
      renderOverview(groups);
      const groupsEl = $('ds-groups');
      if (groupsEl) groupsEl.textContent = '';
      if ($('ds-overview')) $('ds-overview').hidden = !any;
      if ($('ds-ledger')) $('ds-ledger').hidden = true;
    }
    const emptyEl = $('ds-empty');
    if (emptyEl) {
      emptyEl.hidden = any || (view && view.empty === false);
      if (!emptyEl.hidden) emptyEl.removeAttribute('hidden');
      else emptyEl.setAttribute('hidden', '');
    }
  }

  async function invoke(action, extra) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') {
      throw new Error('应用命令通道不可用');
    }
    return client.invoke('digitalSelf', Object.assign({ action: action }, extra || {}));
  }

  async function refresh() {
    try {
      const result = await invoke('read');
      renderView(result && result.view);
    } catch (err) {
      setNotice('没能读取数字之我。');
    }
    await refreshCapabilityProjection();
  }

  function bind() {
    const tellBtn = $('btn-ds-tell');
    const cancel = $('btn-ds-tell-cancel');
    const form = $('ds-tell-form');
    const importBtn = $('btn-ds-import');
    const fileInput = $('ds-import-file');
    const page = $('digital-self-page');
    const openLedger = $('btn-ds-open-ledger');
    const closeLedger = $('btn-ds-close-ledger');
    const search = $('ds-fact-search');
    const openSettings = $('btn-ds-open-settings');
    const startCollaboration = $('btn-ds-start-collaboration');
    if (tellBtn) {
      tellBtn.addEventListener('click', () => showTellForm(true));
    }
    if (cancel) {
      cancel.addEventListener('click', () => {
        showTellForm(false);
        const input = $('ds-tell-input');
        if (input) input.value = '';
      });
    }
    if (form) {
      form.addEventListener('submit', async (evt) => {
        evt.preventDefault();
        const input = $('ds-tell-input');
        const text = input ? String(input.value || '').trim() : '';
        if (!text) return;
        setBusy(true);
        try {
          const result = await invoke('tell', { text: text });
          if (input) input.value = '';
          showTellForm(false);
          renderView(result && result.view);
        } catch (err) {
          setNotice('没能记下这件事。');
        } finally {
          setBusy(false);
        }
      });
    }
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) {
          setNotice('没能取得这份资料。');
          return;
        }
        const filePath =
          (api().pathForFile && api().pathForFile(file)) || file.path || '';
        if (!filePath) {
          setNotice('没能取得这份资料的位置。');
          return;
        }
        setBusy(true);
        try {
          const result = await invoke('import', { filePath: filePath });
          renderView(result && result.view);
        } catch (err) {
          setNotice('没能从资料里了解你。');
        } finally {
          setBusy(false);
        }
      });
    }
    if (openLedger) {
      openLedger.addEventListener('click', () => setLedgerOpen(true));
    }
    if (closeLedger) {
      closeLedger.addEventListener('click', () => setLedgerOpen(false));
    }
    if (search) {
      search.addEventListener('input', () => {
        if (lastGroups) renderLedger(lastGroups, search.value);
      });
    }
    if (openSettings) {
      openSettings.addEventListener('click', () => {
        const nav = $('nav-settings');
        if (nav) nav.click();
      });
    }
    if (startCollaboration) {
      startCollaboration.addEventListener('click', openTalkForCollaboration);
    }
    if (page) {
      page.addEventListener('click', async (evt) => {
        const btn = evt.target && evt.target.closest ? evt.target.closest('button[data-act]') : null;
        if (!btn) return;
        const item = btn.closest('.ds-item');
        const id = item && item.dataset.id;
        if (!id) return;
        const act = btn.dataset.act;
        if (act === 'correct') {
          let formEl = item.querySelector('.ds-correct-form');
          if (formEl) {
            formEl.remove();
            return;
          }
          formEl = document.createElement('form');
          formEl.className = 'ds-correct-form';
          const label = document.createElement('label');
          label.className = 'field';
          const span = document.createElement('span');
          span.textContent = '更正为';
          const textarea = document.createElement('textarea');
          textarea.rows = 2;
          textarea.className = 'ds-correct-input';
          label.appendChild(span);
          label.appendChild(textarea);
          const row = document.createElement('div');
          row.className = 'row';
          const save = document.createElement('button');
          save.type = 'submit';
          save.className = 'primary';
          save.textContent = '保存纠正';
          row.appendChild(save);
          formEl.appendChild(label);
          formEl.appendChild(row);
          formEl.addEventListener('submit', async (sub) => {
            sub.preventDefault();
            const text = String(textarea.value || '').trim();
            if (!text) return;
            setBusy(true);
            try {
              const result = await invoke('correct', { understandingId: id, text: text });
              renderView(result && result.view);
            } catch (err) {
              setNotice('没能保存纠正。');
            } finally {
              setBusy(false);
            }
          });
          item.appendChild(formEl);
          textarea.focus();
          return;
        }
        if (act === 'delete' || act === 'confirm' || act === 'ignore') {
          setBusy(true);
          try {
            const result = await invoke(act, { understandingId: id });
            renderView(result && result.view);
          } catch (err) {
            setNotice('没能完成这项操作。');
          } finally {
            setBusy(false);
          }
        }
      });
    }
  }

  window.DigitalSelfPage = {
    refresh: refresh,
    show: refresh,
    applyBrand: applyBrand,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
