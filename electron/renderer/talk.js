'use strict';
/**
 * 与兔机米：统一产品表面。只投影 talk 命令。
 */
(function () {
  const pendingPaths = [];
  const TALK_TIMEOUT_NOTICE = '请求超时，模型在限定时间内没有返回。可重试。';
  const DOING_TEXT = '正在替你做';
  const CHECKING_TEXT = '正在查看结果';
  let sendGeneration = 0;
  let sending = false;

  function api() {
    return window.digitalMe;
  }

  function talkUiDeadlineMs() {
    const client = api();
    const n = Number(client && client.talkUiDeadlineMs);
    return Number.isFinite(n) && n > 0 ? n : 620_000;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function basename(filePath) {
    const raw = String(filePath || '').replace(/\\/g, '/');
    const parts = raw.split('/');
    return parts[parts.length - 1] || raw;
  }

  function facingError(err) {
    const raw = String((err && err.message) || err || '').trim();
    if (!raw) return '这次没能完成。';
    if (/aborted|用户取消|已取消|request aborted/i.test(raw)) {
      return '已取消。';
    }
    if (/timeout after|请求超时|AbortError|ETIMEDOUT|TalkTimeout|超时/i.test(raw)) {
      return TALK_TIMEOUT_NOTICE;
    }
    if (/codex/i.test(raw) && /HTTP|ECONN|ENOTFOUND|unavailable|不可用|403|404/i.test(raw)) {
      return '这次没有做成。请稍后再试。';
    }
    if (/ECONN|ENOTFOUND|fetch failed|network/i.test(raw)) {
      return '这次没能连上。请检查网络后重试。';
    }
    if (/HTTP|status code|adapter|cap_|stack|ENOENT|Error invoking|runtime|provider|executor|IPC/i.test(raw)) {
      return '这次没有做成。请稍后再试。';
    }
    return raw;
  }

  function setNotice(text) {
    const el = $('chat-status');
    if (el) el.textContent = text || '';
  }

  function setCancelVisible(show) {
    const el = $('btn-chat-cancel');
    if (!el) return;
    el.hidden = !show;
    if (show) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function hideLegacyChrome() {
    const hideIds = [
      'chat-session-aside',
      'first-value',
      'growth-guide-actions',
      'btn-chat-to-task',
      'btn-chat-retry',
      'chat-context',
    ];
    for (const id of hideIds) {
      const el = $(id);
      if (!el) continue;
      el.hidden = true;
      el.setAttribute('hidden', '');
    }
    const title = document.querySelector('#panel-chat .page-title');
    if (title) title.textContent = '与兔机米';
    const lead = document.querySelector('#panel-chat .page-lead');
    if (lead) lead.hidden = true;
    const label = document.querySelector('label[for="chat-input"]');
    if (label) label.textContent = '告诉兔机米';
    if (!sending) setCancelVisible(false);
  }

  function autosizeInput() {
    const input = $('chat-input');
    if (!input) return;
    input.style.height = 'auto';
    const maxPx = Math.min(Math.round(window.innerHeight * 0.42), 360);
    const next = Math.min(Math.max(input.scrollHeight, 52), maxPx);
    input.style.height = next + 'px';
  }

  function bindAutosize() {
    const input = $('chat-input');
    if (!input || input.dataset.autosizeBound) return;
    input.dataset.autosizeBound = '1';
    input.addEventListener('input', autosizeInput);
    window.addEventListener('resize', autosizeInput);
    autosizeInput();
  }

  function renderChips() {
    const list = $('talk-attach-chips');
    if (!list) return;
    list.textContent = '';
    if (!pendingPaths.length) {
      list.hidden = true;
      list.setAttribute('hidden', '');
      return;
    }
    list.hidden = false;
    list.removeAttribute('hidden');
    pendingPaths.forEach((filePath, index) => {
      const li = document.createElement('li');
      li.className = 'talk-attach-chip';
      const name = document.createElement('span');
      name.textContent = basename(filePath);
      li.appendChild(name);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost';
      remove.textContent = '×';
      remove.setAttribute('aria-label', '移除这次上下文 ' + basename(filePath));
      remove.addEventListener('click', () => {
        pendingPaths.splice(index, 1);
        renderChips();
      });
      li.appendChild(remove);
      list.appendChild(li);
    });
  }

  function addPaths(paths) {
    for (const item of paths || []) {
      const p = String(item || '').trim();
      if (p && pendingPaths.indexOf(p) < 0) pendingPaths.push(p);
    }
    renderChips();
  }

  function closeAttachMenu() {
    const menu = $('talk-attach-menu');
    if (menu) menu.open = false;
  }

  function resultFiles(turn) {
    if (turn && turn.result && turn.result.path) {
      return [{ title: turn.result.title || basename(turn.result.path), path: turn.result.path }];
    }
    return [];
  }

  function appendResultCard(li, file) {
    const card = document.createElement('div');
    card.className = 'talk-result-card';
    const note = document.createElement('p');
    note.className = 'talk-result-note';
    note.textContent = '这次完成的结果';
    card.appendChild(note);
    const title = document.createElement('p');
    title.className = 'talk-result-name';
    title.textContent = file.title || basename(file.path);
    card.appendChild(title);
    const actions = document.createElement('div');
    actions.className = 'talk-result-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary talk-result-open';
    open.textContent = '打开';
    open.addEventListener('click', () => {
      const client = api();
      if (client && typeof client.openPath === 'function') {
        void client.openPath(file.path).then((out) => {
          if (out && out.opened === false && typeof client.revealPath === 'function') {
            void client.revealPath(file.path);
          }
        });
      } else if (client && typeof client.revealPath === 'function') {
        void client.revealPath(file.path);
      }
    });
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'ghost talk-result-reveal';
    reveal.textContent = '在文件夹中显示';
    reveal.addEventListener('click', () => {
      const client = api();
      if (client && typeof client.revealPath === 'function') {
        void client.revealPath(file.path);
      }
    });
    actions.appendChild(open);
    actions.appendChild(reveal);
    card.appendChild(actions);
    li.appendChild(card);
  }

  let lastView = { turns: [] };

  function renderView(view, pending) {
    const list = $('chat-turns');
    const empty = $('chat-empty');
    if (!list) return;
    if (view) lastView = view;
    list.textContent = '';
    const turns = (lastView && lastView.turns) || [];
    for (const turn of turns) {
      const li = document.createElement('li');
      li.className = turn.role === 'user' ? 'chat-turn-user' : 'chat-turn-assistant';
      const role = document.createElement('p');
      role.className = 'talk-role';
      role.textContent = turn.role === 'user' ? '你' : '兔机米';
      li.appendChild(role);
      const p = document.createElement('p');
      p.className = 'chat-text';
      p.textContent = turn.text || '';
      li.appendChild(p);
      for (const file of resultFiles(turn)) appendResultCard(li, file);
      list.appendChild(li);
    }
    if (pending && pending.userText) {
      const userLi = document.createElement('li');
      userLi.className = 'chat-turn-user';
      const role = document.createElement('p');
      role.className = 'talk-role';
      role.textContent = '你';
      userLi.appendChild(role);
      const p = document.createElement('p');
      p.className = 'chat-text';
      p.textContent = pending.userText;
      userLi.appendChild(p);
      list.appendChild(userLi);
      if (!pending.failed) {
        const wait = document.createElement('li');
        wait.className = 'chat-turn-assistant talk-processing';
        wait.setAttribute('data-talk-processing', '1');
        const waitRole = document.createElement('p');
        waitRole.className = 'talk-role';
        waitRole.textContent = '兔机米';
        wait.appendChild(waitRole);
        const waitText = document.createElement('p');
        waitText.className = 'chat-text';
        waitText.setAttribute('data-talk-doing', '1');
        waitText.textContent = pending.doingText || DOING_TEXT;
        wait.appendChild(waitText);
        list.appendChild(wait);
      }
    }
    const hasTurns = turns.length > 0 || !!(pending && pending.userText);
    if (empty) {
      empty.hidden = hasTurns;
      if (empty.hidden) empty.setAttribute('hidden', '');
      else empty.removeAttribute('hidden');
    }
    if (!pending) setNotice((lastView && lastView.notice) || '');
    list.scrollTop = list.scrollHeight;
  }

  function setDoingText(text) {
    const el = document.querySelector('[data-talk-doing]');
    if (el) el.textContent = text;
  }

  async function invokeTalk(payload) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') {
      throw new Error('应用命令通道不可用');
    }
    return client.invoke('talk', payload);
  }

  async function refresh() {
    hideLegacyChrome();
    bindAutosize();
    renderChips();
    try {
      const result = await invokeTalk({});
      renderView(result && result.view);
    } catch (err) {
      setNotice(facingError(err));
    }
  }

  function cancelSend() {
    if (!sending) return;
    sendGeneration += 1;
    sending = false;
    setCancelVisible(false);
    const send = $('btn-chat-send');
    if (send) send.disabled = false;
    renderView(lastView);
    setNotice('已取消。');
  }

  async function handleSend(text, extra) {
    hideLegacyChrome();
    const input = $('chat-input');
    const send = $('btn-chat-send');
    const trimmed = String(text || '').trim();
    const paths = extra && Array.isArray(extra.contextPaths) ? extra.contextPaths.slice() : pendingPaths.slice();
    if (!trimmed && !paths.length) {
      setNotice('请先写一句话。');
      return;
    }
    if (input) {
      input.value = '';
      autosizeInput();
    }
    pendingPaths.length = 0;
    renderChips();
    const generation = ++sendGeneration;
    sending = true;
    setNotice(DOING_TEXT);
    setCancelVisible(true);
    if (send) send.disabled = true;
    const pendingText =
      paths.length && trimmed
        ? `${trimmed}\n\n（这次一起看：${paths.map(basename).join('、')}）`
        : trimmed;
    renderView(lastView, { userText: pendingText, doingText: DOING_TEXT });
    let watchdog = 0;
    let checkTimer = 0;
    try {
      const payload = { text: trimmed };
      if (paths.length) payload.contextPaths = paths;
      checkTimer = setTimeout(() => {
        if (generation !== sendGeneration) return;
        setDoingText(CHECKING_TEXT);
        setNotice(CHECKING_TEXT);
      }, 8000);
      const result = await Promise.race([
        invokeTalk(payload),
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error(TALK_TIMEOUT_NOTICE)), talkUiDeadlineMs());
        }),
      ]);
      if (generation !== sendGeneration) return;
      renderView(result && result.view);
    } catch (err) {
      if (generation !== sendGeneration) return;
      // 后端可能已在超时路径落盘最终回复；再读一次 Thread，避免「文件已成但界面只剩超时」。
      try {
        const recovered = await invokeTalk({});
        const turns = recovered && recovered.view && recovered.view.turns;
        const prevLen = (lastView && lastView.turns && lastView.turns.length) || 0;
        if (Array.isArray(turns) && turns.length > prevLen) {
          renderView(recovered.view);
          if (!(recovered.view && recovered.view.notice)) setNotice(facingError(err));
          return;
        }
      } catch (_recoverErr) {
        /* 恢复失败仍走原错误展示 */
      }
      renderView(lastView, { userText: pendingText, failed: true });
      setNotice(facingError(err));
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (checkTimer) clearTimeout(checkTimer);
      if (generation === sendGeneration) {
        sending = false;
        setCancelVisible(false);
        if (send) send.disabled = false;
      }
    }
  }

  async function pickFiles() {
    const client = api();
    closeAttachMenu();
    if (!client || !client.dialogs || typeof client.dialogs.pickOpenFiles !== 'function') return;
    const picked = await client.dialogs.pickOpenFiles();
    addPaths(Array.isArray(picked) ? picked : []);
  }

  async function pickFolder() {
    const client = api();
    closeAttachMenu();
    if (!client || !client.dialogs || typeof client.dialogs.pickOpenDirectory !== 'function') return;
    const picked = await client.dialogs.pickOpenDirectory();
    if (picked) addPaths([picked]);
  }

  function bindAttach() {
    const fileBtn = $('btn-talk-attach-file');
    const folderBtn = $('btn-talk-attach-folder');
    if (fileBtn && !fileBtn.dataset.bound) {
      fileBtn.dataset.bound = '1';
      fileBtn.addEventListener('click', () => {
        void pickFiles();
      });
    }
    if (folderBtn && !folderBtn.dataset.bound) {
      folderBtn.dataset.bound = '1';
      folderBtn.addEventListener('click', () => {
        void pickFolder();
      });
    }
  }

  window.TalkPage = {
    refresh: refresh,
    handleSend: handleSend,
    cancel: cancelSend,
    pendingPaths: pendingPaths,
    addContextPaths: addPaths,
    attachFiles: pickFiles,
    attachFolder: pickFolder,
  };

  function start() {
    hideLegacyChrome();
    bindAutosize();
    bindAttach();
    void refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
