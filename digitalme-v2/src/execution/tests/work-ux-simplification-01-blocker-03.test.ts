/**
 * WORK-UX-SIMPLIFICATION-01-BLOCKER-03 — 普通成果不得显示软件执行 UI
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { deriveWorkIntentSync } from '../../work-runtime/work-intent.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const proj = require('../../../electron/renderer/work-artifact-projection.js') as {
  resolveArtifactProjection: (d: Record<string, unknown>) => {
    kind: string;
    contradiction: boolean;
  };
  sanitizeArtifactTypeForTask: (d: {
    taskIntent?: string | null;
    rawArtifactType?: string | null;
  }) => string;
  isSoftwareExecutionTask: (t: unknown) => boolean;
};

const root = path.resolve(__dirname, '../../..');

describe('work-ux-simplification-01-blocker-03', () => {
  it('1-5 目标反例：项目介绍/总结/投资分析 ≠ 软件；开发/改仓库 = 软件', () => {
    const cases: Array<[string, string]> = [
      ['整理一份200字的项目介绍。', 'document'],
      ['根据材料写一份项目总结', 'document'],
      ['分析这个投资项目', 'document'],
      ['开发一个CRM软件', 'code-change'],
      ['修改这个仓库的登录页', 'code-change'],
    ];
    for (const [goal, family] of cases) {
      const intent = deriveWorkIntentSync({ goal, contextRefs: [] });
      if (family === 'document') {
        assert.notEqual(intent.intentKind, 'modify_code', goal);
        assert.notEqual(intent.expectedOutputFamily, 'code-change', goal);
      } else {
        assert.equal(intent.intentKind, 'modify_code', goal);
        assert.equal(intent.expectedOutputFamily, 'code-change', goal);
      }
    }
  });

  it('6-7 普通 task + content.codeChange → document；software + code-change → code-change', () => {
    const doc = proj.resolveArtifactProjection({
      taskIntent: 'create_document',
      artifactType: 'document',
      artifactContent: {
        codeChange: { summary: 'fake', changedFiles: ['a.ts'] },
        content: { kind: 'text' },
      },
    });
    assert.equal(doc.kind, 'document');
    assert.equal(doc.contradiction, true);

    const general = proj.resolveArtifactProjection({
      taskIntent: 'general',
      artifactType: 'document',
      artifactContent: {
        codeChange: { summary: 'fake' },
        content: { kind: 'bundle' },
      },
    });
    assert.equal(general.kind, 'bundle');
    assert.equal(general.contradiction, true);

    const soft = proj.resolveArtifactProjection({
      taskIntent: 'modify_code',
      artifactType: 'code-change',
      artifactContent: { codeChange: { summary: 'ok' }, content: { kind: 'bundle' } },
    });
    assert.equal(soft.kind, 'code-change');
    assert.equal(soft.contradiction, false);

    // 仅有 codeChange 字段、无正式类型 → 不得打开 code UI
    const metaOnly = proj.resolveArtifactProjection({
      taskIntent: 'modify_code',
      artifactType: 'document',
      artifactContent: { codeChange: { summary: 'x' } },
    });
    assert.notEqual(metaOnly.kind, 'code-change');
  });

  it('8-10 sanitize 与 DOM/CSS 门控：非软件不得沿用 code-change 类型；hidden 覆盖 display:flex', async () => {
    assert.equal(
      proj.sanitizeArtifactTypeForTask({
        taskIntent: 'general',
        rawArtifactType: 'code-change',
      }),
      'document',
    );
    assert.equal(
      proj.sanitizeArtifactTypeForTask({
        taskIntent: 'modify_code',
        rawArtifactType: 'code-change',
      }),
      'code-change',
    );

    const css = await fs.readFile(path.join(root, 'electron/renderer/styles.css'), 'utf8');
    assert.match(css, /\.code-change-view\[hidden\]/);
    assert.match(css, /display:\s*none\s*!important/);

    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /setCodeChangeViewVisible\(false\)|style\.display = "none"/);
    assert.match(appJs, /DigitalMeArtifactProjection|work-artifact-projection/);
    assert.match(appJs, /sanitizeArtifactTypeForTask/);
    assert.match(appJs, /logArtifactProjectionDiagnostic/);

    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    assert.match(html, /work-artifact-projection\.js/);
    assert.match(html, /id="code-change-view"[^>]*hidden/);
    assert.match(html, /修改文件/);
    assert.match(html, /代码变化/);
  });
});
