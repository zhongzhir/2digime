/**
 * Apply brand strings to primary shell UI. Does not rewrite Talk/Digital Self semantics.
 */
(function () {
  function text(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }

  function applyBrand(brand) {
    if (!brand || !brand.strings) return;
    const s = brand.strings;
    if (s.windowTitle) document.title = s.windowTitle;
    text('nav-chat', s.navTalk);
    const navDiscover = document.getElementById('nav-discover');
    if (navDiscover) navDiscover.textContent = '发现';
    const navSelf = document.querySelector('[data-nav="subject"]');
    if (navSelf && s.navSelf) navSelf.textContent = s.navSelf;
    const navSettings = document.getElementById('btn-open-settings');
    if (navSettings && s.navSettings) navSettings.textContent = s.navSettings;
    document.querySelectorAll('.brand, .brand-sm').forEach((el) => {
      if (brand.productName) el.textContent = brand.productName;
    });
    text('help-topic-title', s.helpIntro);
    const helpChatTitle = document.querySelector('#help-chat h2');
    if (helpChatTitle && s.talkTitle) helpChatTitle.textContent = s.talkTitle;
    const helpChatMention = document.getElementById('help-chat-mention');
    if (helpChatMention && s.talkTitle) {
      helpChatMention.textContent = `主要来自你在「${s.talkTitle}」里说的话，以及你在这里做的纠正。`;
    }
    const openSource = document.getElementById('brand-opensource-note');
    if (openSource && s.openSourceNote) openSource.textContent = s.openSourceNote;
    const support = document.getElementById('brand-support-text');
    if (support && brand.supportText) support.textContent = brand.supportText;
    if (brand.themeTokens && brand.themeTokens.accent) {
      document.documentElement.style.setProperty('--brand-accent', brand.themeTokens.accent);
    }
    window.__digitalMeBrand = brand;
    if (window.TalkPage && typeof window.TalkPage.applyBrand === 'function') {
      window.TalkPage.applyBrand(brand);
    }
    if (window.DigitalSelfPage && typeof window.DigitalSelfPage.applyBrand === 'function') {
      window.DigitalSelfPage.applyBrand(brand);
    }
  }

  function applyEarly() {
    if (window.__digitalMeBrand) applyBrand(window.__digitalMeBrand);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyEarly);
  } else {
    applyEarly();
  }

  window.DigitalMeBrandUi = { applyBrand };
})();
