'use strict';
/**
 * Talk 旁路 Discover 投影。只渲染 content.discover 的 view，不持有偏好或 Digital Self。
 */
(function () {
  function api() {
    return window.digitalMe;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function renderView(view) {
    const root = $('content-discover');
    if (!root) return;
    const title = $('content-discover-title');
    const lead = $('content-discover-lead');
    const list = $('content-discover-list');
    const notice = $('content-discover-notice');
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
        if (card.url) {
          const a = document.createElement('a');
          a.href = card.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = '打开原文';
          li.appendChild(a);
        }
        list.appendChild(li);
      }
    }
    const hasCards = !!(view.cards && view.cards.length);
    const hasNotice = !!(view.notice && String(view.notice).trim());
    root.hidden = !hasCards && !hasNotice;
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
        notice: '',
      });
    }
  }

  window.ContentDiscoverPage = { refresh: refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  }
})();
