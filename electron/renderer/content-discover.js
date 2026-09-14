'use strict';
/**
 * Talk 旁路 Discover 投影。只渲染 content 命令的 view，不持有偏好或 Digital Self。
 */
(function () {
  function api() {
    return window.digitalMe;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function btn(label, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ghost';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function askTalk(card) {
    const lines = ['请根据这篇原文帮我理解，并告诉我可以怎么用。', `标题：${card.title || ''}`];
    if (card.url) lines.push(`链接：${card.url}`);
    if (card.text) lines.push(card.text);
    const text = lines.join('\n');
    if (window.TalkPage && typeof window.TalkPage.handleSend === 'function') {
      void window.TalkPage.handleSend(text);
    }
  }

  async function act(action, extra) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    const result = await client.invoke('content', Object.assign({ action: action }, extra || {}));
    renderView(result && result.view);
  }

  function renderView(view) {
    const root = $('content-discover');
    if (!root) return;
    const title = $('content-discover-title');
    const lead = $('content-discover-lead');
    const list = $('content-discover-list');
    const notice = $('content-discover-notice');
    const prefsBox = $('content-discover-prefs');
    const prefsList = $('content-discover-pref-list');
    if (!view) {
      root.hidden = true;
      return;
    }
    if (title) title.textContent = view.headline || '发现';
    if (lead) lead.textContent = view.lead || '';
    if (notice) notice.textContent = view.notice || '';
    if (list) {
      list.innerHTML = '';
      for (const card of view.cards || []) {
        const li = document.createElement('li');
        li.className = 'content-discover-card';
        const h = document.createElement('h3');
        h.textContent = card.title || '';
        li.appendChild(h);
        if (card.reason) {
          const why = document.createElement('p');
          why.className = 'content-discover-reason muted tiny';
          why.textContent = card.reason;
          li.appendChild(why);
        }
        if (card.text) {
          const p = document.createElement('p');
          p.textContent = card.text;
          li.appendChild(p);
        }
        const actions = document.createElement('div');
        actions.className = 'content-discover-actions';
        if (card.url) {
          actions.appendChild(
            btn('打开原文', () => {
              window.open(card.url, '_blank', 'noopener,noreferrer');
              if (card.source !== 'web') void act('open', { itemId: card.itemId });
            }),
          );
        }
        actions.appendChild(btn('稍后看', () => void act('later', { itemId: card.itemId })));
        actions.appendChild(btn('问兔机米', () => askTalk(card)));
        actions.appendChild(btn('加推类似', () => void act('boost', { itemId: card.itemId })));
        actions.appendChild(btn('少推类似', () => void act('reduce', { itemId: card.itemId })));
        if (card.publisherSubjectId) {
          actions.appendChild(btn('关注来源', () => void act('follow', { itemId: card.itemId })));
          actions.appendChild(btn('不再看这个来源', () => void act('block', { itemId: card.itemId })));
        }
        li.appendChild(actions);
        list.appendChild(li);
      }
    }
    const prefs = view.preferences || [];
    if (prefsBox && prefsList) {
      prefsList.innerHTML = '';
      for (const row of prefs) {
        const li = document.createElement('li');
        const text = document.createElement('span');
        text.textContent = row.text || row.kind;
        li.appendChild(text);
        li.appendChild(btn('撤销', () => void act('reverse', { directiveId: row.id })));
        prefsList.appendChild(li);
      }
      prefsBox.hidden = prefs.length === 0;
    }
    const hasCards = !!(view.cards && view.cards.length);
    const hasNotice = !!(view.notice && String(view.notice).trim());
    const hasPrefs = prefs.length > 0;
    root.hidden = !hasCards && !hasNotice && !hasPrefs;
  }

  async function refresh() {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    try {
      const result = await client.invoke('content', { action: 'discover' });
      renderView(result && result.view);
    } catch {
      renderView({
        headline: '发现',
        lead: '兔机米根据你的数字之我挑选，不是中心推荐。',
        cards: [],
        preferences: [],
        notice: '',
      });
    }
  }

  async function seek(query) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    const text = String(query || '').trim();
    if (!text) return;
    try {
      const result = await client.invoke('content', { action: 'seek', text: text });
      renderView(result && result.view);
    } catch {
      /* 主动获取失败不得挡住交谈 */
    }
  }

  window.ContentDiscoverPage = { refresh: refresh, seek: seek };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  }
})();
