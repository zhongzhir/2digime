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
