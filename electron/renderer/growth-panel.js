/**
 * 数字之我成长卡 — 只渲染主进程派生结果，不在页面计算阶段。
 */
(function (root) {
  'use strict';

  function el(id, scope) {
    return (scope || document).getElementById(id);
  }

  function text(node, value) {
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function setHidden(node, hidden) {
    if (!node) return;
    node.hidden = !!hidden;
  }

  function fillDimensionList(listId, emptyId, items, scope) {
    const list = el(listId, scope);
    const empty = el(emptyId, scope);
    if (!list) return;
    list.innerHTML = '';
    (items || []).forEach(function (item) {
      const li = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = item.name || '';
      li.appendChild(name);
      if (item.summary) {
        li.appendChild(document.createTextNode('：' + String(item.summary)));
      }
      list.appendChild(li);
    });
    if (empty) setHidden(empty, (items || []).length > 0);
  }

  function renderCockpit(scope, snapshot, handlers) {
    const cockpit = snapshot && snapshot.cockpit ? snapshot.cockpit : {};
    const known = cockpit.knownPreview || [];
    const knownCount = typeof cockpit.knownCount === 'number' ? cockpit.knownCount : known.length;
    const countNode = el('growth-cockpit-known-count', scope);
    text(countNode, knownCount > 0 ? String(knownCount) : '');
    fillDimensionList('growth-cockpit-known', 'growth-cockpit-known-empty', known, scope);

    const gaps = cockpit.gaps || [];
    const gapList = el('growth-cockpit-gaps', scope);
    const gapEmpty = el('growth-cockpit-gaps-empty', scope);
    if (gapList) {
      gapList.innerHTML = '';
      gaps.forEach(function (item) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'growth-gap-btn';
        btn.textContent = item.name || '';
        btn.addEventListener('click', function () {
          if (handlers && typeof handlers.onGap === 'function') handlers.onGap(item);
        });
        li.appendChild(btn);
        gapList.appendChild(li);
      });
    }
    if (gapEmpty) setHidden(gapEmpty, gaps.length > 0);

    const materials = cockpit.materials || { total: 0, byKind: [], recent: [] };
    text(
      el('growth-cockpit-material-count', scope),
      materials.total > 0 ? String(materials.total) : '',
    );
    const kindText = (materials.byKind || [])
      .map(function (row) {
        return String(row.label || '') + ' ' + String(row.count || 0);
      })
      .join(' · ');
    text(el('growth-cockpit-material-kinds', scope), kindText);
    const recentList = el('growth-cockpit-materials', scope);
    const recentEmpty = el('growth-cockpit-materials-empty', scope);
    if (recentList) {
      recentList.innerHTML = '';
      (materials.recent || []).forEach(function (item) {
        const li = document.createElement('li');
        li.textContent = item.fileName || '';
        recentList.appendChild(li);
      });
    }
    if (recentEmpty) setHidden(recentEmpty, (materials.recent || []).length > 0);
  }

  function render(scope, snapshot, handlers) {
    const block = el('growth-block', scope) || el('growth-block');
    if (!block) return;
    if (!snapshot || typeof snapshot.stageName !== 'string') {
      setHidden(block, true);
      return;
    }
    setHidden(block, false);
    text(el('growth-stage-name', scope), snapshot.stageName);
    text(el('growth-stage-explain', scope), snapshot.stageExplanation);
    const cal = el('growth-calibration', scope);
    setHidden(cal, !snapshot.needsCalibration);
    if (cal && snapshot.needsCalibration) cal.textContent = '需要校准';

    const gap = snapshot.nextGap || {};
    text(el('growth-next-title', scope), gap.title || '当前最值得补充');
    text(el('growth-next-purpose', scope), gap.purpose || '');

    const groups = snapshot.dimensionGroups || {};
    fillDimensionList('growth-known-list', 'growth-known-empty', groups.known, scope);
    fillDimensionList('growth-partial-list', 'growth-partial-empty', groups.partial, scope);
    fillDimensionList('growth-unknown-list', null, groups.unknown, scope);
    renderCockpit(scope, snapshot, handlers || {});

    const later = el('growth-later-note', scope);
    if (later) {
      later.textContent = snapshot.laterStagesNote || '';
      setHidden(later, true);
    }
  }

  function toggleDisclosure(id, open) {
    const node = el(id);
    if (!node) return;
    if (open === undefined) node.hidden = !node.hidden;
    else node.hidden = !open;
  }

  root.DigitalMeGrowthPanel = {
    render: render,
    toggleDisclosure: toggleDisclosure,
  };
})(window);
