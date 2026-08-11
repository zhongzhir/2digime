/**
 * D11-E：旧中栏三确认卡与密封补丁不得残留。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

describe('D11-E legacy mid confirm cards removed', () => {
  it('HTML/CSS/app 均无旧三卡与 inert 密封', async () => {
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    const css = await fs.readFile(path.join(root, 'electron/renderer/styles.css'), 'utf8');
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    for (const id of ['executor-setup-card', 'project-folder-card', 'execution-confirm-card']) {
      assert.doesNotMatch(html, new RegExp(`id="${id}"`));
      assert.doesNotMatch(css, new RegExp(`#${id}`));
      assert.doesNotMatch(app, new RegExp(id));
    }
    assert.equal(app.includes('sealLegacyMidConfirmCards'), false);
    assert.equal(app.includes('showExecutionConfirmCard'), false);
    assert.equal(app.includes('returnFromExecutionConfirmToEdit'), false);
    assert.match(html, /id="btn-start-development"/);
    assert.match(html, /id="task-workspace-prep"/);
    assert.match(html, /尚未形成可交付成果/);
    assert.match(app, /fromPlanConfirm && !highRisk/);
    assert.match(app, /showPrepBlocked/);
  });
});
