/**
 * 2DIGIME-BUILD-01-REVISION-COMPLETION-GATE-FIX-23
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  ctoFieldsDiffer,
  headVersionBoundToJob,
  pickBundleTextEntry,
  recoverySucceededArtifactId,
  revisionArtifactAdvanced,
  revisionJobHasCommittedArtifact,
  snapshotArtifactRevision,
} from '../revision-completion';
import { applyRecoveryWrite } from '../execution-job';
import type { Artifact } from '../artifact';

describe('revision-completion-gate-fix-23', () => {
  it('旧 Artifact 已有 headVersionId 不得算修订成果变化', () => {
    const before = {
      id: 'art_a',
      jobId: 'job_1',
      headVersionId: 'ver_1',
      versionCount: 1,
      versionIds: ['ver_1'],
    };
    assert.equal(revisionArtifactAdvanced(before, before), false);
    assert.equal(
      revisionArtifactAdvanced(before, {
        ...before,
        headVersionId: 'ver_1',
        versionCount: 1,
      }),
      false,
    );
    assert.equal(
      revisionArtifactAdvanced(before, {
        id: 'art_a',
        jobId: 'job_2',
        headVersionId: 'ver_2',
        versionCount: 2,
        versionIds: ['ver_1', 'ver_2'],
      }),
      true,
    );
  });

  it('bundle previousText 优先 execution-summary', () => {
    const hit = pickBundleTextEntry([
      { role: 'manifest', ref: 'm.json' },
      { role: 'execution-summary', ref: 'summary.md' },
      { role: 'report', ref: 'report.md' },
    ]);
    assert.equal(hit?.ref, 'summary.md');
    assert.equal(pickBundleTextEntry([{ role: 'diff', ref: 'a.diff' }]), undefined);
  });

  it('CTO 五项整体相同则判定未刷新', () => {
    const five = {
      canUse: '证据不足',
      goalAttained: '部分达成',
      needChange: '需要补测试',
      risks: '未执行测试',
      nextStep: '补充测试输出',
    };
    assert.equal(ctoFieldsDiffer(five, five), false);
    assert.equal(ctoFieldsDiffer(five, { ...five, canUse: '仍不建议直接使用' }), true);
  });

  it('修订 Job 恢复：target 已指向本 Job 则视为成果已写；artifactId 不得改写成 art_revision', () => {
    const job = {
      id: 'job_rev',
      status: 'running' as const,
      targetArtifactId: 'art_first',
    };
    assert.equal(
      revisionJobHasCommittedArtifact({
        job,
        existsForDerivedId: false,
        artifactByIdExists: true,
        targetArtifactJobId: 'job_rev',
      }),
      true,
    );
    assert.equal(
      revisionJobHasCommittedArtifact({
        job,
        existsForDerivedId: false,
        artifactByIdExists: true,
        targetArtifactJobId: 'job_first',
      }),
      false,
    );
    assert.equal(recoverySucceededArtifactId(job), 'art_first');
    const recovered = applyRecoveryWrite(
      {
        id: 'job_rev',
        taskId: 'task_1',
        capabilityId: 'cap_x',
        createdAt: '2026-08-13T00:00:00.000Z',
        status: 'running',
        targetArtifactId: 'art_first',
      },
      'commit_succeeded',
      '2026-08-13T00:01:00.000Z',
    );
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.artifactId, 'art_first');
  });

  it('head 版本绑定第二 Job', () => {
    const artifact: Artifact = {
      id: 'art_first',
      taskId: 'task_1',
      jobId: 'job_rev',
      subjectId: 'subj',
      createdAt: 't0',
      type: 'code-change',
      title: 't',
      versions: [
        {
          versionId: 'ver_1',
          createdAt: 't0',
          author: 'capability',
          content: { kind: 'text', format: 'plain', ref: 'a' },
        },
        {
          versionId: 'ver_2',
          createdAt: 't1',
          author: 'capability',
          content: { kind: 'text', format: 'plain', ref: 'b' },
          note: '把 start 改成 done',
        },
      ],
      headVersionId: 'ver_2',
      storageDir: '/tmp',
    };
    const bound = headVersionBoundToJob(artifact, 'job_rev');
    assert.equal(bound.ok, true);
    assert.equal(snapshotArtifactRevision(artifact)?.versionCount, 2);
  });

  it('源码接线：selectTask 有成果时必须 loadArtifact；闸门不得用旧 headVersionId 放行', async () => {
    const root = path.resolve(__dirname, '../../..');
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(app, /已有成果必须展示/);
    assert.match(app, /readyArtifactId/);
    const entry = await fs.readFile(
      path.join(root, 'scripts/electron-cto-real-main-gate-20a-entry.cjs'),
      'utf8',
    );
    assert.match(entry, /revision_job_succeeded/);
    assert.match(entry, /revisionArtifactAdvanced/);
    assert.doesNotMatch(
      entry,
      /artTraceOk = !!\(art && \(art\.headVersionId \|\| \(art\.versions && art\.versions\.length > 1\)\)\)/,
    );
    const runner = await fs.readFile(path.join(root, 'src/work-runtime/job-runner.ts'), 'utf8');
    assert.match(runner, /pickBundleTextEntry/);
    assert.match(runner, /target\.jobId === job\.id/);
  });
});
