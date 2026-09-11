'use strict';
/**
 * 数字之我页：只投影 Digital Self 唯一权威。
 * 围绕：现在怎样理解我 / 为什么（来源）/ 我可以纠正。
 * 不展示 Event / Store / Candidate ID / confidence / provenance 结构。
 */
(function () {
  const CURRENT_ORDER = ['about_me', 'goals', 'preferences', 'boundaries'];

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

  function renderView(view) {
    const headline = $('ds-headline');
    if (headline) headline.textContent = (view && view.headline) || defaultHeadline;
    setNotice(view && view.notice ? view.notice : '');
    const groupsEl = $('ds-groups');
    const emptyEl = $('ds-empty');
    if (!groupsEl) return;
    groupsEl.textContent = '';
    const groups = (view && view.groups) || {};
    const recent = groups.learning || [];
    const current = flattenCurrent(groups);
    appendSection(groupsEl, '最近它又了解了你这些', recent, 'ds-group-recent');
    appendSection(groupsEl, '当前理解', current, 'ds-group-current');
    const any = recent.length + current.length > 0;
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
    const groups = $('ds-groups');
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
    if (groups) {
      groups.addEventListener('click', async (evt) => {
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
