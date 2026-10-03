/**
 * 历史对话列表：按项目分组，支持改名、归档/取回、移入/移出项目、删除（需确认范围）。
 * 只显示主进程会话索引的投影；所有改动都经 api.conversation.manage 落到同一份索引。
 */
(function () {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function small(label, onClick, className) {
    const b = el('button', className || 'ghost chat-session-small', label);
    b.type = 'button';
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick(ev);
    });
    return b;
  }

  function nameForm(initial, placeholder, onSave, onCancel) {
    const form = el('form', 'chat-session-form');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = initial || '';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    form.appendChild(input);
    const save = el('button', 'primary chat-session-small', '保存');
    save.type = 'submit';
    form.appendChild(save);
    form.appendChild(small('取消', onCancel));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const value = input.value.trim();
      if (value) onSave(value);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return form;
  }

  // 当前展开的菜单（某场对话 id 或 "proj:<id>"）和它的子状态；重绘时保留
  const uiState = { menu: '', mode: '' };

  /**
   * listed: { currentId, sessions, projects }
   * actions: { open(id), manage(input) -> Promise }
   * 返回前不改动 listed。
   */
  function render(root, listed, actions) {
    const sessions = (listed && listed.sessions) || [];
    const projects = (listed && listed.projects) || [];
    const currentId = listed && listed.currentId;
    root.innerHTML = '';
    const ui = uiState;

    const redraw = () => render(root, listed, actions);
    const run = (input) => {
      ui.menu = '';
      ui.mode = '';
      return Promise.resolve(actions.manage(input)).catch((err) => {
        const note = el('li', 'chat-session-note muted tiny', (err && err.message) || String(err));
        root.prepend(note);
      });
    };

    function sessionRow(session) {
      const li = el('li', 'chat-session-item');
      li.dataset.sessionId = session.id;
      const row = el('div', 'chat-session-row');
      const open = el('button', 'ghost chat-session-title', session.title || '新对话');
      open.type = 'button';
      if (session.id === currentId) open.classList.add('active');
      open.addEventListener('click', () => actions.open(session.id));
      row.appendChild(open);
      const more = small('⋯', () => {
        ui.menu = ui.menu === session.id ? '' : session.id;
        ui.mode = '';
        redraw();
      }, 'ghost chat-session-small chat-session-more');
      more.setAttribute('aria-label', '管理这场对话');
      row.appendChild(more);
      li.appendChild(row);

      if (ui.menu !== session.id) return li;
      const menu = el('div', 'chat-session-menu');
      if (ui.mode === 'rename') {
        menu.appendChild(nameForm(session.title, '对话名称', (v) => run({ op: 'rename', id: session.id, title: v }), () => { ui.mode = ''; redraw(); }));
      } else if (ui.mode === 'delete') {
        menu.appendChild(el('p', 'tiny', '删除这场对话的聊天记录和工作记录。它产出的文件、数字之我里已记下的内容、其他对话都不会被删除。删除后无法恢复。'));
        const bar = el('div', 'chat-session-bar');
        bar.appendChild(small('确认删除', () => run({ op: 'delete', id: session.id, scope: 'conversation_only' }), 'danger chat-session-small'));
        bar.appendChild(small('取消', () => { ui.mode = ''; redraw(); }));
        menu.appendChild(bar);
      } else if (ui.mode === 'project') {
        const bar = el('div', 'chat-session-bar');
        for (const p of projects) {
          if (p.id === session.projectId) continue;
          bar.appendChild(small('移入「' + p.name + '」', () => run({ op: 'move', id: session.id, projectId: p.id })));
        }
        if (session.projectId) bar.appendChild(small('移出项目', () => run({ op: 'move', id: session.id, projectId: null })));
        bar.appendChild(small('新建项目并移入…', () => { ui.mode = 'newproject'; redraw(); }));
        bar.appendChild(small('返回', () => { ui.mode = ''; redraw(); }));
        menu.appendChild(bar);
      } else if (ui.mode === 'newproject') {
        menu.appendChild(nameForm('', '项目名称', (v) => run({ op: 'createProject', id: session.id, title: v }), () => { ui.mode = 'project'; redraw(); }));
      } else {
        const bar = el('div', 'chat-session-bar');
        bar.appendChild(small('改名', () => { ui.mode = 'rename'; redraw(); }));
        bar.appendChild(small(session.archived ? '取回' : '归档', () => run({ op: session.archived ? 'unarchive' : 'archive', id: session.id })));
        bar.appendChild(small(session.projectId ? '换项目…' : '归入项目…', () => { ui.mode = 'project'; redraw(); }));
        bar.appendChild(small('删除…', () => { ui.mode = 'delete'; redraw(); }));
        menu.appendChild(bar);
      }
      li.appendChild(menu);
      return li;
    }

    const active = sessions.filter((s) => !s.archived);
    const archived = sessions.filter((s) => s.archived);
    const known = new Set(projects.map((p) => p.id));

    for (const project of projects) {
      const members = active.filter((s) => s.projectId === project.id);
      const section = el('li', 'chat-session-project');
      const head = el('div', 'chat-session-project-head');
      head.appendChild(el('span', 'chat-session-project-name', project.name + (members.length ? '' : '（空）')));
      const key = 'proj:' + project.id;
      head.appendChild(small('⋯', () => {
        ui.menu = ui.menu === key ? '' : key;
        ui.mode = '';
        redraw();
      }, 'ghost chat-session-small chat-session-more'));
      section.appendChild(head);
      if (ui.menu === key) {
        const menu = el('div', 'chat-session-menu');
        if (ui.mode === 'rename') {
          menu.appendChild(nameForm(project.name, '项目名称', (v) => run({ op: 'renameProject', projectId: project.id, title: v }), () => { ui.mode = ''; redraw(); }));
        } else if (ui.mode === 'remove') {
          menu.appendChild(el('p', 'tiny', '只解散这个项目的分组，里面的对话都会保留，回到未归入项目。'));
          const bar = el('div', 'chat-session-bar');
          bar.appendChild(small('解散项目', () => run({ op: 'removeProject', projectId: project.id }), 'danger chat-session-small'));
          bar.appendChild(small('取消', () => { ui.mode = ''; redraw(); }));
          menu.appendChild(bar);
        } else {
          const bar = el('div', 'chat-session-bar');
          bar.appendChild(small('改名', () => { ui.mode = 'rename'; redraw(); }));
          bar.appendChild(small('解散项目…', () => { ui.mode = 'remove'; redraw(); }));
          menu.appendChild(bar);
        }
        section.appendChild(menu);
      }
      const inner = el('ul', 'chat-session-sublist');
      for (const s of members) inner.appendChild(sessionRow(s));
      section.appendChild(inner);
      root.appendChild(section);
    }

    for (const s of active) {
      if (s.projectId && known.has(s.projectId)) continue;
      root.appendChild(sessionRow(s));
    }

    if (archived.length) {
      const wrap = el('li', 'chat-session-archived');
      const details = el('details');
      if (ui.menu && archived.some((s) => s.id === ui.menu)) details.open = true;
      details.appendChild(el('summary', 'tiny muted', '已归档（' + archived.length + '）'));
      const inner = el('ul', 'chat-session-sublist');
      for (const s of archived) inner.appendChild(sessionRow(s));
      details.appendChild(inner);
      wrap.appendChild(details);
      root.appendChild(wrap);
    }
  }

  window.ChatSessions = { render };
})();
