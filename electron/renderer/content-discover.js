'use strict';
/**
 * 一级「发现」页投影。只渲染 content 命令的 view，不持有偏好或 Digital Self。
 */
(function () {
  const KIND_LABEL = {
    boost: '加推类似',
    reduce: '少推类似',
    follow: '关注来源',
    block: '不再看来源',
  };
  const laterById = new Map();
  let lastCards = [];
  let activeSection = 'for-you';

  function api() {
    return window.digitalMe;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function btn(label, onClick, className) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className || 'ghost';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function goTalk() {
    if (window.ShellNav && typeof window.ShellNav.setNav === 'function') {
      void window.ShellNav.setNav('chat');
    }
  }

  function goDiscover(opts) {
    if (window.ShellNav && typeof window.ShellNav.setNav === 'function') {
      return window.ShellNav.setNav('discover', opts);
    }
    return Promise.resolve();
  }

  function askTalk(card) {
    const lines = ['请根据这篇原文帮我理解，并告诉我可以怎么用。', `标题：${card.title || ''}`];
    if (card.url) lines.push(`链接：${card.url}`);
    if (card.text) lines.push(card.text);
    const text = lines.join('\n');
    goTalk();
    if (window.TalkPage && typeof window.TalkPage.handleSend === 'function') {
      void window.TalkPage.handleSend(text);
    }
  }

  function sourceLine(card) {
    if (card.publisherDisplayName) return card.publisherDisplayName;
    if (card.url) {
      try {
        return new URL(card.url).hostname.replace(/^www\./, '');
      } catch {
        return card.url;
      }
    }
    return '';
  }

  function openCard(card) {
    if (card.url) window.open(card.url, '_blank', 'noopener,noreferrer');
    if (card.source !== 'web' && card.itemId) void act('open', { itemId: card.itemId });
  }

  function stashLater(card) {
    if (!card || !card.itemId) return;
    laterById.set(card.itemId, card);
  }

  function cardById(itemId) {
    return lastCards.find((row) => row.itemId === itemId) || laterById.get(itemId) || null;
  }

  async function act(action, extra) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    if (action === 'later' && extra && extra.itemId) {
      const card = cardById(extra.itemId);
      if (card) stashLater(card);
      if (card && card.source === 'web') {
        renderLater();
        showSection('later');
        return;
      }
    }
    const result = await client.invoke('content', Object.assign({ action: action }, extra || {}));
    renderView(result && result.view);
    if (action === 'later') showSection('later');
    if (action === 'reverse') showSection('prefs');
  }

  function typeLabel(card) {
    const map = { article: '文章', image: '图片', audio: '音频', video: '视频', other: '内容' };
    return map[card.contentType] || '';
  }

  function renderCard(card, opts) {
    const li = document.createElement('li');
    li.className = 'content-discover-card';
    if (card.thumbnailUrl && /^https?:\/\//i.test(card.thumbnailUrl)) {
      const img = document.createElement('img');
      img.className = 'content-discover-thumb';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = card.thumbnailUrl;
      li.appendChild(img);
    }
    const meta = document.createElement('p');
    meta.className = 'content-discover-source muted tiny';
    const bits = [typeLabel(card), sourceLine(card)].filter(Boolean);
    if (card.durationSeconds) bits.push(Math.round(Number(card.durationSeconds)) + 's');
    meta.textContent = bits.join(' · ');
    if (bits.length) li.appendChild(meta);
    const h = document.createElement('h3');
    h.textContent = card.title || '';
    li.appendChild(h);
    if (card.text) {
      const p = document.createElement('p');
      p.className = 'content-discover-excerpt';
      p.textContent = card.text;
      li.appendChild(p);
    }
    if (card.reason) {
      const why = document.createElement('p');
      why.className = 'content-discover-reason muted tiny';
      why.textContent = card.reason;
      li.appendChild(why);
    }
    const actions = document.createElement('div');
    actions.className = 'content-discover-actions';
    if (card.url) actions.appendChild(btn('打开', () => openCard(card), 'primary'));
    if (!opts || !opts.hideLater) {
      actions.appendChild(btn('稍后看', () => void act('later', { itemId: card.itemId })));
    }
    actions.appendChild(btn('问兔机米', () => askTalk(card)));
    actions.appendChild(btn('加推类似', () => void act('boost', { itemId: card.itemId })));
    actions.appendChild(btn('少推类似', () => void act('reduce', { itemId: card.itemId })));
    if (card.publisherSubjectId) {
      const more = document.createElement('details');
      more.className = 'content-discover-more';
      const summary = document.createElement('summary');
      summary.textContent = '更多';
      more.appendChild(summary);
      more.appendChild(btn('关注来源', () => void act('follow', { itemId: card.itemId })));
      more.appendChild(btn('不再看这个来源', () => void act('block', { itemId: card.itemId })));
      actions.appendChild(more);
    }
    li.appendChild(actions);
    return li;
  }

  function renderLater() {
    const list = $('content-discover-later-list');
    const empty = $('content-discover-later-empty');
    if (!list) return;
    list.innerHTML = '';
    const cards = Array.from(laterById.values());
    for (const card of cards) list.appendChild(renderCard(card, { hideLater: true }));
    if (empty) empty.hidden = cards.length > 0;
  }

  function friendlyNotice(notice) {
    const text = String(notice || '').trim();
    if (!text || text === '还没有新内容。' || text === '还没有新内容' || /^还没有新内容/.test(text)) {
      return '';
    }
    return text;
  }

  function showSection(name) {
    activeSection = name || 'for-you';
    const sections = document.querySelectorAll('#content-discover .discover-section');
    for (const section of sections) {
      const show = section.getAttribute('data-discover-section') === activeSection;
      section.hidden = !show;
    }
    const switches = document.querySelectorAll('.discover-switch');
    for (const el of switches) {
      el.classList.toggle('active', el.getAttribute('data-discover-section') === activeSection);
    }
  }

  function renderView(view) {
    const root = $('content-discover');
    if (!root) return;
    const title = $('content-discover-title');
    const lead = $('content-discover-lead');
    const list = $('content-discover-list');
    const notice = $('content-discover-notice');
    const empty = $('content-discover-empty');
    const prefsList = $('content-discover-pref-list');
    const prefEmpty = $('content-discover-pref-empty');
    if (title) title.textContent = (view && view.headline) || '发现';
    if (lead) {
      lead.textContent =
        (view && view.lead) || '兔机米会从公开内容和你的内容网络中，帮你找到值得看的东西。';
    }
    lastCards = (view && view.cards) || [];
    if (notice) notice.textContent = friendlyNotice(view && view.notice);
    if (list) {
      list.innerHTML = '';
      for (const card of lastCards) list.appendChild(renderCard(card));
    }
    if (empty) empty.hidden = lastCards.length > 0;
    const prefs = (view && view.preferences) || [];
    if (prefsList) {
      prefsList.innerHTML = '';
      for (const row of prefs) {
        const li = document.createElement('li');
        const text = document.createElement('span');
        const kind = KIND_LABEL[row.kind] || row.kind;
        text.textContent = `${kind} · ${row.text || ''}（你明确说过）`;
        li.appendChild(text);
        li.appendChild(btn('撤销', () => void act('reverse', { directiveId: row.id })));
        prefsList.appendChild(li);
      }
    }
    if (prefEmpty) prefEmpty.hidden = prefs.length > 0;
    renderLater();
    root.hidden = false;
    showSection(activeSection);
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
        lead: '兔机米会从公开内容和你的内容网络中，帮你找到值得看的东西。',
        cards: [],
        preferences: [],
        notice: '',
      });
    }
  }

  async function seek(query, opts) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    const text = String(query || '').trim();
    if (!text) return;
    const input = $('content-discover-query');
    if (input) input.value = text;
    if (opts && opts.navigate) await goDiscover({ skipRefresh: true });
    showSection('for-you');
    try {
      const result = await client.invoke('content', { action: 'seek', text: text });
      renderView(result && result.view);
    } catch {
      /* 主动获取失败不得挡住交谈 */
    }
  }

  function bind() {
    const form = $('content-discover-search');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', (evt) => {
        evt.preventDefault();
        const input = $('content-discover-query');
        void seek(input ? input.value : '');
      });
    }
    const examples = $('content-discover-examples');
    if (examples && !examples.dataset.bound) {
      examples.dataset.bound = '1';
      examples.addEventListener('click', (evt) => {
        const btnEl = evt.target && evt.target.closest ? evt.target.closest('[data-seek]') : null;
        if (!btnEl) return;
        void seek(btnEl.getAttribute('data-seek'));
      });
    }
    const switcher = document.querySelector('.discover-switcher');
    if (switcher && !switcher.dataset.bound) {
      switcher.dataset.bound = '1';
      switcher.addEventListener('click', (evt) => {
        const btnEl = evt.target && evt.target.closest ? evt.target.closest('[data-discover-section]') : null;
        if (!btnEl) return;
        showSection(btnEl.getAttribute('data-discover-section'));
      });
    }
    const refreshBtn = $('btn-discover-refresh');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => {
        void refresh();
      });
    }
  }

  window.ContentDiscoverPage = { refresh: refresh, seek: seek, showSection: showSection, renderView: renderView };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bind();
    });
  } else {
    bind();
  }
})();
