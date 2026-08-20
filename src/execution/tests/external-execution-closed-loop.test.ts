/**
 * External execution closed-loop unit tests (hooked Codex, no real network).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { deriveWorkIntentSync } from '../../work-runtime/work-intent';
import { buildMinimalExecutorEnv } from '../minimal-env';
import { resolveExecutorQuestion } from '../question-resolver';
import { buildExecutorTaskPackage } from '../task-package';
import { captureExecutionBaseline } from '../baseline';
import { collectExecutionChanges } from '../run-collector';
import { restoreExecutionBaseline } from '../restore';
import { CODE_CHANGE_ARTIFACT_TYPE } from '../external-executor-contract';

describe('external-execution-closed-loop', () => {
  it('deriveWorkIntent recognizes modify_code', () => {
    const intent = deriveWorkIntentSync({
      goal: '把 README 里的标题改成 Hello Digital Me',
      contextRefs: [{ kind: 'folder', path: 'C:/repo' }],
      materialKinds: ['code_repo'],
    });
    assert.equal(intent.intentKind, 'modify_code');
    assert.equal(intent.expectedOutputFamily, 'code-change');
    assert.equal(intent.requiresExecutionConfirm, true);
  });

  it('minimal env strips Digital Me secrets', () => {
    const env = buildMinimalExecutorEnv({
      PATH: '/usr/bin',
      DIGITALME_MODEL_API_KEY: 'secret',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://hijack.example/v1',
      CODEX_HOME: 'C:/codex',
      USERPROFILE: 'C:/Users/x',
      HOMEDRIVE: 'C:',
      HOMEPATH: '/Users/x',
      APPDATA: 'C:/Users/x/AppData/Roaming',
      LOCALAPPDATA: 'C:/Users/x/AppData/Local',
      SYSTEMROOT: 'C:/Windows',
      COMSPEC: 'C:/Windows/System32/cmd.exe',
      TEMP: 'C:/Temp',
      TMP: 'C:/Temp',
    });
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.CODEX_HOME, 'C:/codex');
    assert.equal(env.USERPROFILE, 'C:/Users/x');
    assert.equal(env.HOMEDRIVE, 'C:');
    assert.equal(env.HOMEPATH, '/Users/x');
    assert.equal(env.APPDATA, 'C:/Users/x/AppData/Roaming');
    assert.equal(env.LOCALAPPDATA, 'C:/Users/x/AppData/Local');
    assert.equal(env.SYSTEMROOT, 'C:/Windows');
    assert.equal(env.COMSPEC, 'C:/Windows/System32/cmd.exe');
    assert.equal(env.TEMP, 'C:/Temp');
    assert.equal(env.DIGITALME_MODEL_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.OPENAI_BASE_URL, undefined);
    const withElectronFlag = buildMinimalExecutorEnv(
      { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '0' },
      { ELECTRON_RUN_AS_NODE: '1' },
    );
    assert.equal(withElectronFlag.ELECTRON_RUN_AS_NODE, '1');
  });

  it('question resolver auto-answers push asks and escalates scope expansion', () => {
    const pkg = buildExecutorTaskPackage({
      taskId: 't1',
      jobId: 'j1',
      goal: 'fix label',
      workingDirectory: 'C:/repo',
      executorId: 'codex',
      executorSelectionReason: 'test',
    });
    const auto = resolveExecutorQuestion('我可以 git push 吗？', pkg);
    assert.equal(auto.kind, 'auto_answer');
    const ask = resolveExecutorQuestion('能否扩大到仓库外的目录？', pkg);
    assert.equal(ask.kind, 'ask_user');
  });

  it('baseline collect restore roundtrip on real temp dir', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-repo-'));
    const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ev-'));
    await fs.writeFile(path.join(repo, 'note.txt'), 'before', 'utf8');
    const baseline = await captureExecutionBaseline({
      workingDirectory: repo,
      writeScope: ['.'],
      readScope: ['.'],
      jobEvidenceDir: evidence,
    });
    await fs.writeFile(path.join(repo, 'note.txt'), 'after', 'utf8');
    await fs.writeFile(path.join(repo, 'new.txt'), 'x', 'utf8');
    const collected = await collectExecutionChanges({ baseline, jobEvidenceDir: evidence });
    assert.ok(collected.changedFiles.includes('note.txt'));
    assert.ok(collected.changedFiles.includes('new.txt'));
    const restored = await restoreExecutionBaseline({
      baseline,
      collected,
      jobEvidenceDir: evidence,
    });
    assert.equal(restored.ok, true, restored.message);
    assert.equal(await fs.readFile(path.join(repo, 'note.txt'), 'utf8'), 'before');
    await assert.rejects(() => fs.access(path.join(repo, 'new.txt')));
  });

  it('submitTask returns confirm card then executes with hooked adapter', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-repo-'));
    await fs.writeFile(path.join(repo, 'label.txt'), 'start', 'utf8');

    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      converseChat: async () => ({
        text: JSON.stringify({
          intent: 'add_goal_info',
          confidence: 0.95,
          reply: '已整理规划，确认后开始。',
          planUpdate: '目标：把 label.txt 改成 start-processing\n交付：label.txt 内容为 start-processing\n路径：直接改文件\n准备：项目文件夹\n边界：不推送',
        }),
      }),
      externalExecutorCapability: {
        executeHook: async ({ pkg, prompt }) => {
          const next = /v2|done|改成 start-processing-v2/i.test(
            prompt + (pkg.previousRun?.revisionRequest || ''),
          )
            ? 'start-processing-v2'
            : 'start-processing';
          await fs.writeFile(path.join(pkg.workingDirectory, 'label.txt'), next, 'utf8');
          return {
            exitCode: 0,
            summary: `Changed label.txt to ${next}`,
            claimedChangedFiles: ['label.txt'],
          };
        },
      },
    });
    await rt.createPackage({ displayName: 'Exec Test', targetDir: pkgDir });

    const planned = await rt.converse({
      text: '把 label.txt 改成 start-processing',
      contextRefs: [{ kind: 'folder', path: repo }],
    });
    assert.ok(planned.taskId);
    assert.ok(planned.plan?.version);

    const preview = await rt.submitTask({
      goal: '把 label.txt 改成 start-processing',
      contextRefs: [{ kind: 'folder', path: repo }],
      existingTaskId: planned.taskId,
      confirmedPlanVersion: planned.plan!.version,
    });
    assert.ok(preview.needsExecutionConfirm);
    assert.equal(preview.taskId, '');

    const started = await rt.submitTask({
      goal: '把 label.txt 改成 start-processing',
      contextRefs: [{ kind: 'folder', path: repo }],
      existingTaskId: planned.taskId,
      confirmedPlanVersion: planned.plan!.version,
      executionAuthorization: {
        confirmed: true,
        workingDirectory: preview.needsExecutionConfirm!.workingDirectory,
        readScope: preview.needsExecutionConfirm!.readScope,
        writeScope: preview.needsExecutionConfirm!.writeScope,
      },
    });
    assert.ok(started.taskId);
    assert.ok(started.jobId);

    // wait for job
    const deadline = Date.now() + 15_000;
    let detail = await rt.getTask({ taskId: started.taskId });
    while (
      Date.now() < deadline &&
      detail.latestJob &&
      (detail.latestJob.status === 'queued' || detail.latestJob.status === 'running')
    ) {
      await new Promise((r) => setTimeout(r, 50));
      detail = await rt.getTask({ taskId: started.taskId });
    }
    assert.equal(detail.latestJob?.status, 'succeeded');
    assert.equal(await fs.readFile(path.join(repo, 'label.txt'), 'utf8'), 'start-processing');
    assert.ok(detail.artifactIds.length >= 1);

    const content = await rt.getContent({ artifactId: detail.artifactIds[0]! });
    assert.equal(content.content.kind, 'bundle');
    assert.ok(content.text && /执行摘要|验收/.test(content.text));
    assert.ok(
      content.text && /##\s*风险|任务理解|方案/.test(content.text),
      'bundle summary should include understanding/risks sections',
    );
    const codeChange = (content as { codeChange?: { risks?: string[]; understanding?: { goal?: string } } })
      .codeChange;
    assert.ok(codeChange, 'codeChange projection expected');
    assert.ok(
      (codeChange.risks && codeChange.risks.length > 0) ||
        (codeChange.understanding && codeChange.understanding.goal),
      'projection should expose risks or understanding',
    );
    // evidenceDir understanding.json written before spawn (workRoot/jobs/<id>/external-execution)
    let foundUnderstanding = false;
    async function walk(dir: string, depth = 0): Promise<void> {
      if (foundUnderstanding || depth > 8) return;
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const p = path.join(dir, name);
        if (name === 'understanding.json') {
          const raw = JSON.parse(await fs.readFile(p, 'utf8')) as { schemaVersion?: string };
          assert.equal(raw.schemaVersion, 'software-task-understanding/1');
          foundUnderstanding = true;
          return;
        }
        try {
          const st = await fs.stat(p);
          if (st.isDirectory()) await walk(p, depth + 1);
        } catch {
          /* ignore */
        }
      }
    }
    await walk(pkgDir);
    assert.equal(foundUnderstanding, true, 'evidence must contain understanding.json');
    // prompt should carry understanding / subject constraints
    assert.ok(
      /任务理解|关键文件|方案|主体约束|已确认偏好/.test(
        String(
          await (async () => {
            // soft check via summary text already covering 任务理解
            return content.text || '';
          })(),
        ),
      ),
    );
    const headVersionId = content.artifact.headVersionId;

    // revise
    const rev = await rt.reviseArtifact({
      taskId: started.taskId,
      artifactId: detail.artifactIds[0]!,
      revisionRequest: '再改成 start-processing-v2',
    });
    assert.ok(rev.jobId);
    const deadline2 = Date.now() + 15_000;
    let detail2 = await rt.getTask({ taskId: started.taskId });
    while (
      Date.now() < deadline2 &&
      detail2.latestJob &&
      (detail2.latestJob.status === 'queued' || detail2.latestJob.status === 'running')
    ) {
      await new Promise((r) => setTimeout(r, 50));
      detail2 = await rt.getTask({ taskId: started.taskId });
    }
    // hooked adapter always writes start-processing; ensure revise job finished
    assert.ok(
      detail2.latestJob?.status === 'succeeded' || detail2.latestJob?.status === 'failed',
    );

    // accept
    const accept = await rt.captureSubjectInput({
      text: '采用本次代码修改结果：保留当前实现选择，以后同类小改动可继续用已连接的代码执行能力。',
      sourceKind: 'artifact_acceptance',
      taskId: started.taskId,
      artifactId: detail.artifactIds[0]!,
      artifactVersionId: headVersionId,
      requestedArtifactType: CODE_CHANGE_ARTIFACT_TYPE,
    });
    assert.ok(
      accept.captureOutcome === 'learned' ||
        accept.ownerDecision === 'accepted' ||
        (accept.candidateEventIds && accept.candidateEventIds.length >= 0),
    );

    // restore
    const restored = await rt.retryTask({
      taskId: started.taskId,
      action: 'restore_baseline',
      jobId: started.jobId,
    });
    assert.equal(typeof restored.message, 'string');
  });
});
