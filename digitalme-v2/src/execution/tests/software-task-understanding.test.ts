/**
 * software-task-understanding — 有界只读扫描与质量门禁标签。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSoftwareTaskUnderstanding,
  formatUnderstandingSummaryLines,
} from '../software-task-understanding';
import {
  USER_FACING_LABELS,
  userFacingLabelFromLatestJob,
  type SoftwareOutcomeHint,
} from '../../work-runtime/derive';
import { deriveTaskDisplayState } from '../../work-runtime/task-display-state';
import type { ExecutionJob } from '../../work-runtime/execution-job';
import type { Task } from '../../work-runtime/task';

describe('software-task-understanding', () => {
  it('bounded scan reads package scripts and relative key files without absolute paths in copy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-understanding-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'demo',
        scripts: { test: 'node --test', build: 'tsc', lint: 'eslint .' },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(root, 'src', 'index.ts'),
      'export function greet(name: string) { return name; }\nexport class App {}\n',
      'utf8',
    );
    await fs.writeFile(path.join(root, 'README.md'), '# Demo\n', 'utf8');

    const u = await buildSoftwareTaskUnderstanding({
      goal: '给问候函数增加默认参数',
      workingDirectory: root,
      subjectDecisionBriefs: ['偏好：改动保持最小', '边界：不要升级依赖'],
    });

    assert.equal(u.schemaVersion, 'software-task-understanding/1');
    assert.match(u.goal, /问候函数/);
    assert.ok(u.keyFiles.some((f) => f.path === 'package.json' || f.path.endsWith('package.json')));
    assert.ok(u.keyFiles.some((f) => f.path.includes('index.ts')));
    assert.ok(u.proposedTests.some((t) => /npm run test|npm run build|npm run lint/.test(t)));
    assert.ok(u.symbols.includes('greet') || u.symbols.includes('App'));
    assert.ok(u.planSteps.length >= 3 && u.planSteps.length <= 7);
    assert.ok(u.subjectConstraints.some((c) => /最小|依赖/.test(c)));
    assert.ok(u.risks.length >= 1);

    const blob = JSON.stringify(u);
    assert.equal(blob.includes(root), false, 'understanding must not embed absolute root path');
    for (const f of u.keyFiles) {
      assert.equal(path.isAbsolute(f.path), false);
      assert.equal(/^[A-Za-z]:\\/.test(f.path), false);
    }

    const summary = formatUnderstandingSummaryLines(u);
    assert.ok(summary.length >= 1);
    assert.equal(summary.join('\n').includes(root), false);
  });

  it('degraded quality grade must not show awaiting-confirm label', () => {
    const job: ExecutionJob = {
      id: 'job_1',
      taskId: 'task_1',
      capabilityId: 'cap_code_repo_analysis',
      status: 'succeeded',
      createdAt: '2026-08-10T00:00:00.000Z',
      artifactId: 'art_1',
    };
    const soft: SoftwareOutcomeHint = { qualityGrade: 'degraded_scan_only' };
    const label = userFacingLabelFromLatestJob([job], { softwareOutcome: soft });
    assert.equal(label, USER_FACING_LABELS.attention);
    assert.notEqual(label, USER_FACING_LABELS.completed);
    assert.notEqual(label, '需要你确认');

    const task: Task = {
      id: 'task_1',
      subjectId: 'sub_1',
      goal: '分析仓库',
      createdAt: '2026-08-10T00:00:00.000Z',
      intentKind: 'analyze_code',
      requestedArtifactType: 'code-analysis',
      contextRefs: [],
    };
    const display = deriveTaskDisplayState({
      task,
      jobsForTask: [job],
      artifacts: [
        {
          id: 'art_1',
          taskId: 'task_1',
          jobId: 'job_1',
          subjectId: 'sub_1',
          type: 'code-analysis',
          title: '分析',
          createdAt: '2026-08-10T00:00:00.000Z',
          headVersionId: 'v1',
          storageDir: path.join(os.tmpdir(), 'dm-art'),
          versions: [
            {
              versionId: 'v1',
              createdAt: '2026-08-10T00:00:00.000Z',
              author: 'capability',
              content: { kind: 'bundle', entries: [] },
            },
          ],
        },
      ],
      softwareOutcome: soft,
    });
    assert.equal(display.label, USER_FACING_LABELS.attention);
    assert.equal(display.state, 'attention');
    assert.notEqual(display.displayId, 'awaiting_confirm');
  });
});
