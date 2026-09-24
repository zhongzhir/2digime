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
  let lastRelated = [];
  let lastView = null;
  let activeSection = 'for-you';
  let activeSearchGenerationId = '';
  let activeFeedMode = 'personal';

  function newSearchGenerationId() {
    return 'sg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

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

  function isHttps(url) {
    return /^https:\/\//i.test(String(url || ''));
  }

  function sourceLine(card) {
    const bits = [];
    if (card.publisherDisplayName) bits.push(card.publisherDisplayName);
    else if (card.url) {
      try {
        bits.push(new URL(card.url).hostname.replace(/^www\./, ''));
      } catch {
        bits.push(card.url);
      }
    }
    if (card.author && card.author !== card.publisherDisplayName) bits.push(card.author);
    if (card.publishedAt) {
      const d = Date.parse(card.publishedAt);
      bits.push(Number.isFinite(d) ? new Date(d).toLocaleString() : '发布时间未知');
    }
    if (card.durationSeconds) {
      const n = Math.round(Number(card.durationSeconds));
      if (Number.isFinite(n) && n > 0) {
        const m = Math.floor(n / 60);
        const s = n % 60;
        bits.push(m + ':' + String(s).padStart(2, '0'));
      }
    }
    return bits.join(' · ');
  }

  function typeLabel(card) {
    const map = { news: '新闻', article: '文章', image: '图片', audio: '音频', video: '视频' };
    return map[card.contentType] || '';
  }

  function consumeLabel(card) {
    const type = String(card.contentType || '');
    if (type === 'video') return '在来源观看';
    if (type === 'image') return '打开原页';
    if (type === 'audio') return '在来源收听';
    return '阅读原文';
  }

  function askTalk(card) {
    const context = {
      contentId: card.itemId || '',
      title: card.title || '',
      canonicalUrl: card.url || '',
      source: sourceLine(card),
      contentType: card.contentType || '',
      summary: String(card.text || '').slice(0, 600),
      bodyText: String(card.representation && card.representation.bodyText || '').slice(0, 16000),
    };
    if (card.itemId) void act('asked', { itemId: card.itemId }, { skipRender: true });
    goTalk();
    if (window.TalkPage && typeof window.TalkPage.setContentContext === 'function') {
      window.TalkPage.setContentContext(context);
    }
  }

  function openCard(card) {
    if (card.url) window.open(card.url, '_blank', 'noopener,noreferrer');
    if (card.itemId) void act('open', { itemId: card.itemId }, { skipRender: true });
  }

  function stashLater(card) {
    if (!card || !card.itemId) return;
    laterById.set(card.itemId, card);
  }

  function cardById(itemId) {
    return (
      lastCards.find((row) => row.itemId === itemId) ||
      lastRelated.find((row) => row.itemId === itemId) ||
      laterById.get(itemId) ||
      null
    );
  }

  async function act(action, extra, opts) {
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
    if (action === 'reverse' || action === 'resetRecent') {
      activeSearchGenerationId = newSearchGenerationId();
      activeFeedMode = 'personal';
      lastView = null;
    }
    const result = await client.invoke(
      'content',
      Object.assign({ action: action, searchGenerationId: activeSearchGenerationId }, extra || {}),
    );
    if (opts && opts.skipRender) return result;
    applyView(result && result.view);
    if (action === 'later') showSection('later');
    if (action === 'reverse' || action === 'resetRecent') showSection('prefs');
    return result;
  }

  function coverUrl(card) {
    if (card.contentType === 'image') {
      if (isHttps(card.thumbnailUrl)) return card.thumbnailUrl;
      if (isHttps(card.mediaUrl)) return card.mediaUrl;
      if (isHttps(card.url) && /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(card.url)) return card.url;
      return '';
    }
    if (isHttps(card.thumbnailUrl)) return card.thumbnailUrl;
    return '';
  }

  function renderCard(card, opts) {
    const li = document.createElement('li');
    const type = String(card.contentType || 'article');
    li.className = 'content-discover-card content-discover-card--' + (type || 'article');
    if (card.itemId) li.setAttribute('data-item-id', card.itemId);
    li.setAttribute(
      'data-card-sig',
      [card.itemId || '', type, card.thumbnailUrl || '', card.mediaUrl || '', card.title || ''].join('|'),
    );
    const cover = coverUrl(card);
    if (cover) {
      const img = document.createElement('img');
      img.className = type === 'image' ? 'content-discover-cover content-discover-cover--image' : 'content-discover-cover';
      img.alt = card.title || '';
      img.referrerPolicy = 'no-referrer';
      img.src = cover;
      img.addEventListener('error', () => {
        img.remove();
      });
      li.appendChild(img);
    }
    const body = document.createElement('div');
    body.className = 'content-discover-body';
    const kind = typeLabel(card);
    if (kind) {
      const badge = document.createElement('p');
      badge.className = 'content-discover-kind muted tiny';
      badge.textContent = kind;
      body.appendChild(badge);
    }
    const h = document.createElement('h3');
    h.textContent = card.title || '';
    body.appendChild(h);
    const src = sourceLine(card);
    if (src) {
      const meta = document.createElement('p');
      meta.className = 'content-discover-source muted tiny';
      meta.textContent = src;
      body.appendChild(meta);
    }
    if (card.text && type !== 'image') {
      const p = document.createElement('p');
      p.className = 'content-discover-excerpt';
      p.textContent = card.text;
      body.appendChild(p);
    }
    if (type === 'audio' && isHttps(card.mediaUrl) && card.consumption !== 'OFFICIAL_EMBED') {
      const audio = document.createElement('audio');
      audio.className = 'content-discover-audio';
      audio.preload = 'metadata';
      audio.hidden = true;
      audio.src = card.mediaUrl;
      const reveal = () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        audio.hidden = false;
        audio.controls = true;
      };
      audio.addEventListener('loadedmetadata', reveal);
      audio.addEventListener('error', () => {
        audio.remove();
      });
      body.appendChild(audio);
    }
    if (card.reason) {
      const why = document.createElement('p');
      why.className = 'content-discover-reason muted tiny';
      why.textContent = card.reason;
      body.appendChild(why);
    }
    const actions = document.createElement('div');
    actions.className = 'content-discover-actions';
    if (card.representation && card.representation.bodyText) {
      const reader = document.createElement('details');
      const heading = document.createElement('summary');
      heading.textContent = '直接阅读';
      const text = document.createElement('div');
      text.style.whiteSpace = 'pre-wrap';
      text.textContent = card.representation.bodyText;
      reader.append(heading, text);
      body.appendChild(reader);
    }
    if (card.sources && card.sources.length > 1) {
      const sources = document.createElement('details');
      const heading = document.createElement('summary');
      const publishers = new Set(card.sources.map(source => {
        try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return source.publisher || source.url; }
      }));
      heading.textContent = '来自 ' + publishers.size + ' 个来源';
      sources.appendChild(heading);
      card.sources.forEach(source => {
        if (!/^https?:\/\//i.test(source.url || '')) return;
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = (source.publisher || source.title) + ' ';
        sources.appendChild(link);
      });
      body.appendChild(sources);
    }
    if (card.url) actions.appendChild(btn(consumeLabel(card), () => openCard(card), 'primary'));
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
    body.appendChild(actions);
    li.appendChild(body);
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

  function renderRelated(cards, title) {
    const wrap = $('content-discover-related');
    const list = $('content-discover-related-list');
    const heading = $('content-discover-related-title');
    if (!wrap || !list) return;
    list.innerHTML = '';
    const rows = Array.isArray(cards) ? cards : [];
    wrap.hidden = rows.length === 0;
    if (heading && title) heading.textContent = title;
    for (const card of rows) list.appendChild(renderCard(card));
  }

  function friendlyNotice(notice) {
    return String(notice || '').trim();
  }

  function setStatus(text) {
    const status = $('content-discover-status');
    if (!status) return;
    const value = String(text || '').trim();
    status.textContent = value;
    status.hidden = !value;
  }

  function cardKey(card) {
    return String((card && (card.itemId || card.url)) || '');
  }

  function isPrimaryMediaCard(card) {
    const type = String((card && card.contentType) || '');
    if (type === 'image') return isHttps(card.thumbnailUrl) || isHttps(card.mediaUrl);
    if (type === 'video') return isHttps(card.embedUrl) || isHttps(card.mediaUrl) || isHttps(card.thumbnailUrl);
    if (type === 'audio') return isHttps(card.mediaUrl) || isHttps(card.embedUrl);
    return false;
  }

  function shouldApplyView(view) {
    if (!view) return false;
    const gen = String(view.searchGenerationId || '');
    const mode = view.feedMode === 'intent' ? 'intent' : 'personal';
    if (activeFeedMode === 'intent') {
      return mode === 'intent' && !!activeSearchGenerationId && gen === activeSearchGenerationId;
    }
    if (mode === 'intent') return false;
    if (gen && activeSearchGenerationId && gen !== activeSearchGenerationId) return false;
    return true;
  }

  function mergeClientIntent(current, incoming) {
    const incomingCards = (incoming && incoming.cards) || [];
    const incomingRelated = (incoming && incoming.relatedCards) || [];
    const incomingKeys = new Set(incomingCards.map(cardKey));
    const currentCards = (current && current.cards) || [];
    const preserved = currentCards.filter((card) => isPrimaryMediaCard(card) && !incomingKeys.has(cardKey(card)));
    const pulled = incomingRelated.filter((card) =>
      currentCards.some((row) => cardKey(row) === cardKey(card) && isPrimaryMediaCard(row)),
    );
    const pulledKeys = new Set(pulled.map(cardKey));
    const mergedCards = [];
    const seen = new Set();
    for (const row of incomingCards.concat(pulled, preserved)) {
      const key = cardKey(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mergedCards.push(row);
    }
    return Object.assign({}, incoming, {
      cards: mergedCards,
      relatedCards: incomingRelated.filter((card) => !pulledKeys.has(cardKey(card))),
      feedMode: 'intent',
      searchGenerationId: current.searchGenerationId || incoming.searchGenerationId,
      searchQuery: incoming.searchQuery || current.searchQuery,
    });
  }

  function applyView(view) {
    if (!shouldApplyView(view)) return;
    let next = view;
    if (
      activeFeedMode === 'intent' &&
      view.feedMode === 'intent' &&
      lastView &&
      lastView.feedMode === 'intent' &&
      String(lastView.searchGenerationId || '') === String(view.searchGenerationId || '')
    ) {
      next = mergeClientIntent(lastView, view);
    }
    const incoming = (next && next.cards) || [];
    const notice = friendlyNotice(next && next.notice);
    const replenishing = !!(next && next.replenishing);
    if (
      !incoming.length &&
      lastCards.length &&
      (next && next.feedMode) !== 'intent' &&
      (replenishing || /暂时无法|检查连接|检查联网|没有找到可以直接看/.test(notice))
    ) {
      next = Object.assign({}, next || {}, {
        cards: lastCards,
        relatedCards: lastRelated,
        notice: notice,
        replenishing: replenishing,
      });
    }
    lastView = next;
    renderView(next);
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
    const feedTitle = $('content-discover-feed-title');
    if (feedTitle) {
      feedTitle.textContent = (view && view.feedTitle) || ((view && view.feedMode) === 'intent' ? '当前搜索' : '为你发现');
    }
    const queryInput = $('content-discover-query');
    if (queryInput && view && view.feedMode === 'intent' && view.searchQuery) {
      queryInput.value = view.searchQuery;
    }
    if (lead) {
      lead.textContent =
        (view && view.lead) || '这里可以直接看文章、图片、音频和视频。兔机米按你的数字之我挑选，不是中心推荐。';
    }
    lastCards = (view && view.cards) || [];
    lastRelated = (view && view.relatedCards) || [];
    lastView = view;
    if (notice) {
      notice.textContent = lastCards.length ? friendlyNotice(view && view.notice) : '';
    }
    const replenishing = !!(view && view.replenishing);
    if (replenishing && !lastCards.length) {
      setStatus('兔机米正在准备一些值得看的内容……');
    } else {
      setStatus('');
    }
    if (list) {
      const scrollTop = list.scrollTop;
      const byId = new Map();
      Array.prototype.forEach.call(list.children, (node) => {
        const id = node.getAttribute('data-item-id');
        if (id) byId.set(id, node);
      });
      lastCards.forEach((card, index) => {
        const id = String(card.itemId || '');
        const sig = [id, String(card.contentType || 'article'), card.thumbnailUrl || '', card.mediaUrl || '', card.title || ''].join('|');
        let node = id ? byId.get(id) : null;
        if (node && node.getAttribute('data-card-sig') !== sig) node = null;
        if (!node) node = renderCard(card);
        const current = list.children[index];
        if (current !== node) list.insertBefore(node, current || null);
      });
      while (list.children.length > lastCards.length) list.removeChild(list.lastChild);
      list.scrollTop = scrollTop;
    }
    renderRelated(lastRelated, view && view.relatedTitle);
    const emptyText = $('content-discover-empty-text');
    if (emptyText && !lastCards.length && !replenishing) {
      emptyText.textContent =
        friendlyNotice(view && view.notice) || '这次没有找到可以直接看的内容。';
    }
    if (empty) empty.hidden = lastCards.length > 0 || replenishing;
    const back = $('btn-discover-personal');
    if (back) back.hidden = (view && view.feedMode) !== 'intent';
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
    if (!activeSearchGenerationId) activeSearchGenerationId = newSearchGenerationId();
    activeFeedMode = 'personal';
    if (!lastCards.length) setStatus('兔机米正在准备一些值得看的内容……');
    try {
      const result = await client.invoke('content', {
        action: 'discover',
        searchGenerationId: activeSearchGenerationId,
      });
      applyView(result && result.view);
      if (result && result.view && result.view.replenishing && activeFeedMode === 'personal') {
        if (!lastCards.length) setStatus('兔机米正在准备一些值得看的内容……');
        const next = await client.invoke('content', {
          action: 'replenish',
          searchGenerationId: activeSearchGenerationId,
        });
        applyView(next && next.view);
      }
    } catch {
      setStatus('');
      if (!lastCards.length) {
        renderView({
          headline: '发现',
          lead: '这里可以直接看文章、图片、音频和视频。兔机米按你的数字之我挑选，不是中心推荐。',
          cards: [],
          relatedCards: [],
          preferences: [],
          notice: '暂时无法获取新内容，可以稍后再试或检查联网设置。',
        });
      } else {
        const notice = $('content-discover-notice');
        if (notice) notice.textContent = '暂时无法获取新内容，可以稍后再试或检查联网设置。';
      }
    }
  }

  async function refreshBatch() {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    setStatus('兔机米正在帮你找些值得看的内容……');
    try {
      const result = await client.invoke('content', {
        action: 'refresh',
        searchGenerationId: activeSearchGenerationId,
      });
      applyView(result && result.view);
    } catch {
      setStatus('');
      const notice = $('content-discover-notice');
      if (notice) notice.textContent = '暂时无法获取新内容，可以稍后再试或检查联网设置。';
    }
  }

  async function showPersonal() {
    const input = $('content-discover-query');
    if (input) input.value = '';
    activeSearchGenerationId = newSearchGenerationId();
    activeFeedMode = 'personal';
    lastView = null;
    await refresh();
    showSection('for-you');
  }

  async function seek(query, opts) {
    const client = api();
    if (!client || typeof client.invoke !== 'function') return;
    const text = String(query || '').trim();
    if (!text) return;
    const input = $('content-discover-query');
    if (input) input.value = text;
    const gen = newSearchGenerationId();
    activeSearchGenerationId = gen;
    activeFeedMode = 'intent';
    lastView = null;
    if (opts && opts.navigate) await goDiscover({ skipRefresh: true });
    showSection('for-you');
    try {
      const result = await client.invoke('content', {
        action: 'seek',
        text: text,
        searchGenerationId: gen,
      });
      applyView(result && result.view);
      if (
        result &&
        result.view &&
        result.view.replenishing &&
        activeSearchGenerationId === gen &&
        activeFeedMode === 'intent'
      ) {
        const next = await client.invoke('content', {
          action: 'replenish',
          searchGenerationId: gen,
        });
        applyView(next && next.view);
      }
    } catch {
      const notice = $('content-discover-notice');
      if (notice) notice.textContent = '暂时无法获取新内容，可以稍后再试或检查联网设置。';
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
        void refreshBatch();
      });
    }
    const personalBtn = $('btn-discover-personal');
    if (personalBtn && !personalBtn.dataset.bound) {
      personalBtn.dataset.bound = '1';
      personalBtn.addEventListener('click', () => {
        void showPersonal();
      });
    }
    const resetRecent = $('btn-reset-recent');
    if (resetRecent && !resetRecent.dataset.bound) {
      resetRecent.dataset.bound = '1';
      resetRecent.addEventListener('click', () => {
        void act('resetRecent');
      });
    }
  }

  window.ContentDiscoverPage = {
    refresh: refresh,
    seek: seek,
    showSection: showSection,
    renderView: renderView,
    showPersonal: showPersonal,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bind();
    });
  } else {
    bind();
  }
})();
