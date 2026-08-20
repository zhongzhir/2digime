/**
 * Electron 原生菜单中文标签。保留 role，以免破坏快捷键与开发者工具。
 */
'use strict';

const { Menu, app } = require('electron');

function isMac() {
  return process.platform === 'darwin';
}

function buildApplicationMenuTemplate(handlers) {
  const openHelp = handlers && typeof handlers.openHelp === 'function' ? handlers.openHelp : null;
  const template = [];
  if (isMac()) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    });
  }
  template.push({
    label: '文件',
    submenu: isMac()
      ? [{ role: 'close', label: '关闭窗口' }]
      : [{ role: 'quit', label: '退出' }],
  });
  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'delete', label: '删除' },
      { type: 'separator' },
      { role: 'selectAll', label: '全选' },
    ],
  });
  template.push({
    label: '视图',
    submenu: [
      { role: 'reload', label: '重新加载' },
      { role: 'forceReload', label: '强制重新加载' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '切换全屏' },
    ],
  });
  template.push({
    label: '窗口',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      ...(isMac()
        ? [{ type: 'separator' }, { role: 'front', label: '全部置于顶层' }]
        : [{ role: 'close', label: '关闭' }]),
    ],
  });
  template.push({
    label: '帮助',
    submenu: [
      {
        label: '数字之我如何成长',
        click: () => {
          if (openHelp) openHelp();
        },
      },
    ],
  });
  return template;
}

function installApplicationMenu(handlers) {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(handlers));
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = {
  buildApplicationMenuTemplate,
  installApplicationMenu,
};
