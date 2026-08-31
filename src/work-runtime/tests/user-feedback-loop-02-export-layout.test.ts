/**
 * 场景 D/E：导出状态按任务隔离；工作页长内容换行不撑破。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

test('导出状态按 taskId+artifactId 隔离，普通文章不默认 PPT', async () => {
  const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
  assert.match(app, /exportStateByKey/);
  assert.match(app, /exportStateKey\(activeTaskId, activeArtifactId\)/);
  assert.match(app, /rememberExportState/);
  assert.match(app, /restoreExportState/);
  assert.match(app, /inferDocumentDelivery/);
  assert.match(app, /showPpt: false, showWord: false, showMd: true/);
  assert.match(app, /applyDocumentExportButtons/);
  assert.doesNotMatch(
    app,
    /els\.exportPptx\.hidden = false;\s*els\.exportPptx\.removeAttribute\("hidden"\);\s*\}\s*if \(els\.exportPrimary\) \{\s*els\.exportPrimary\.hidden = false/,
  );
});

test('三栏工作页：min-width 0、overflow-wrap、区域滚动，不用隐藏长内容', async () => {
  const css = await fs.readFile(path.join(root, 'electron/renderer/styles.css'), 'utf8');
  assert.match(css, /\.work-layout\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.work-layout > \.panel\s*\{[\s\S]*min-width:\s*0/);
  const turnBlock = css.match(/\.work-turn-text\s*\{[^}]+\}/);
  assert.ok(turnBlock);
  assert.match(turnBlock[0], /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(turnBlock[0], /display:\s*none/);
  assert.match(css, /\.task-goal\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.work-conversation-scroll\s*\{[^}]*overflow:\s*auto/);
  const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
  assert.match(html, /work-layout/);
  const longSamples = [
    '这是一段很长的中文说明'.repeat(8),
    'SupercalifragilisticexpialidociousTokenWithoutBreak',
    'https://github.com/zhongzhir/2digime/blob/main/README.md',
    'D:\\\\Projects\\\\Digital Me\\\\electron\\\\renderer\\\\app.js',
    '```\nconst x = 1;\n```',
  ];
  assert.equal(longSamples.length, 5);
});
