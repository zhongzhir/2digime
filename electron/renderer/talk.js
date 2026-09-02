'use strict';
/**
 * 与 2digime：Phase 2 最小主表面。只投影 talk 命令。
 */
(function () {
  function api() {
    return window.digitalMe;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setNotice(text) {
    const el = $('chat-status');
    if (el) el.textContent = text || '';
  }

  function hideLegacyChrome() {
    const aside = $('chat-session-aside');
    if (aside) aside.hidden = true;
    const first = $('first-value');
    if (first) first.hidden = true;
    const guide = $('growth-guide-actions');
    if (guide) {
      guide.hidden = true;
      guide.setAttribute('hidden', '');
    }
    const title = document.querySelector('#panel-chat .page-title');
    if (title) title.textContent = '与 2digime';
    const lead = document.querySelector('#panel-chat .page-lead');
    if (lead) lead.hidden = true;
    const toTask = $('btn-chat-to-task');
    if (toTask) toTask.hidden = true;
    const label = document.querySelector('label[for="chat-input"]');
    if (label) label.textContent = '告诉 2digime';
  }

  function renderView(view) {
    const list = $('chat-turns');
    const empty = $('chat-empty');
    if (!list) return;
    list.textContent = '';
    const turns = (view && view.turns) || [];
    for (const turn of turns) {
      const li = document.createElement('li');
      li.className = turn.role === 'user' ? 'chat-turn-user' : 'chat-turn-assistant';
      const p = document.createElement('p');
      p.textContent = turn.text || '';
      li.appendChild(p);
      if (turn.result && turn.result.path) {
        const card = document.createElement('div');
        card.className = 'talk-result-card';
        const title = document.createElement('p');
        title.textContent = turn.result.title || '结果';
        card.appendChild(title);
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = '打开结果';
        open.addEventListener('click', () => {
          const client = api();
          if (client && typeof client.revealPath === 'function') {
            void client.revealPath(turn.result.path);
          }
        });
        card.appendChild(open);
        li.appendChild(card);
      }
      list.appendChild(li);
    }
    if (empty) {
      empty.hidden = turns.length > 0;
      if (empty.hidden) empty.setAttribute('hidden', '');
      else empty.removeAttribute('hidden');
    }
    setNotice((view && view.notice) || '');
    list.scrollTop = list.scrollHeight;
  }

  async function invokeTalk(text) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') {
      throw new Error('应用命令通道不可用');
    }
    return client.invoke('talk', text ? { text: text } : {});
  }

  async function refresh() {
    hideLegacyChrome();
    try {
      const result = await invokeTalk('');
      renderView(result && result.view);
    } catch (err) {
      setNotice((err && err.message) || '没能读取交流。');
    }
  }

  async function handleSend(text) {
    hideLegacyChrome();
    const input = $('chat-input');
    const send = $('btn-chat-send');
    if (input) input.value = '';
    setNotice('正在处理…');
    if (send) send.disabled = true;
    try {
      const result = await invokeTalk(text);
      renderView(result && result.view);
    } catch (err) {
      setNotice((err && err.message) || '这次没能完成。');
    } finally {
      if (send) send.disabled = false;
    }
  }

  window.TalkPage = { refresh: refresh, handleSend: handleSend };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    void refresh();
  }
})();
