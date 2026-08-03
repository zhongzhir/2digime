import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createDigitalMeRuntime } from '../../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../../work-runtime/job-runner';
import {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
  type RuntimeModelCredential,
} from '../../../infrastructure/env-secrets';
import { buildDocxFromMarkdown } from '../../../infrastructure/export';
import { writeZip } from '../../../infrastructure/zip';
import { OPENAI_COMPATIBLE_CAPABILITY_ID } from '../openai-compatible';
import { artifactIdForJob } from '../../../work-runtime/artifact';

let runtimeCred: RuntimeModelCredential | null = null;
let modelEnv: {
  configured: boolean;
  baseUrl: string;
  model: string;
  providerId: string;
  source: 'env' | 'app_runtime_file' | 'default';
} = {
  configured: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  providerId: 'openai-compatible',
  source: 'default',
};

async function loadAppCredentialViaElectron(): Promise<boolean> {
  if (process.env.DIGITALME_SKIP_APP_MODEL === '1') return false;
  const existing = await resolveModelEnvAsync(process.cwd(), process.env);
  if (existing.runtime) return true;

  const script = path.join(process.cwd(), 'scripts', 'load-app-model-credential.cjs');
  const appDir = path.resolve(process.cwd(), '..', 'digitalme-app');
  try {
    await fs.access(script);
    await fs.access(path.join(appDir, 'package.json'));
  } catch {
    return false;
  }

  // 优先本包 electron 二进制(参数数组,shell:false);禁止拼接含空格路径的命令字符串。
  let command: string;
  let args: string[];
  let cwd = process.cwd();
  try {
    const electronPath = require('electron') as string;
    if (typeof electronPath !== 'string') throw new Error('bad electron path');
    command = electronPath;
    args = [script];
  } catch {
    const electronCli = path.join(appDir, 'node_modules', 'electron', 'cli.js');
    try {
      await fs.access(electronCli);
      command = process.execPath;
      args = [electronCli, script];
      cwd = appDir;
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += String(d);
      });
      child.stderr.on('data', (d) => {
        out += String(d);
      });
      child.on('close', (code) => {
        done(code === 0 && /"ok"\s*:\s*true/.test(out));
      });
      child.on('error', () => done(false));
    } catch {
      done(false);
    }
  });
}

test('bootstrap:加载应用模型凭证(若可用)', async () => {
  await loadAppCredentialViaElectron();
  const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
  runtimeCred = resolved.runtime;
  modelEnv = {
    configured: resolved.configured,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    providerId: resolved.providerId,
    source: resolved.source,
  };
  // 无凭证时后续真实用例 skip;不伪造成功。
  assert.ok(typeof modelEnv.configured === 'boolean');
});

const HAS_CREDENTIAL = () => modelEnv.configured;

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-real-${prefix}-`));
}

function createRealRuntime() {
  assert.ok(HAS_CREDENTIAL(), 'credential required');
  return createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      displayName: '真实对话模型',
      timeoutMs: 120_000,
    },
    secrets: createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred),
    registerOpenAiStub: false,
  });
}

type PerfRow = {
  case: string;
  submitMs: number;
  totalMs: number;
  modelTokens?: number;
  artifactChars?: number;
  capabilityDurationMs?: number;
  status: string;
};

const perfRows: PerfRow[] = [];
const evidenceDir = path.join(
  process.cwd(),
  'scripts',
  '_mvp-p14-real-capability-evidence',
);

async function writeEvidence(name: string, payload: unknown): Promise<void> {
  await fs.mkdir(evidenceDir, { recursive: true });
  const scrubbed = JSON.parse(
    JSON.stringify(payload, (_k, v) => {
      if (typeof v === 'string' && /sk-[A-Za-z0-9_-]{8,}/.test(v)) return '[redacted]';
      if (typeof v === 'string' && v.length > 2000) return `${v.slice(0, 2000)}…[truncated]`;
      return v;
    }),
  );
  await fs.writeFile(path.join(evidenceDir, name), `${JSON.stringify(scrubbed, null, 2)}\n`, 'utf8');
}

test('无 credential 时明确 blocked(不伪造成功)', async (t) => {
  if (HAS_CREDENTIAL()) {
    t.skip('credential present; blocked-path covered by unit missing-secret test');
    return;
  }
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      availability: 'available',
    },
    secrets: { get: async () => null },
  });
  const root = await tempDir('blocked');
  await runtime.createPackage({ displayName: 'blocked', targetDir: path.join(root, 'pkg') });
  const { jobId } = await runtime.submitTask({
    goal: '应失败',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, jobId, 15_000);
  assert.equal(job.status, 'failed');
  assert.ok(job.failure?.stage === 'capability' || job.failure?.stage === 'model');
  assert.equal(await runtime.getArtifact(artifactIdForJob(jobId)), null);
  await writeEvidence('blocked-no-credential.json', {
    status: 'blocked',
    reason: 'no credential',
    jobStatus: job.status,
    stage: job.failure?.stage,
  });
  await runtime.stop();
});

test('真实模型 e2e:无材料/单文件/PPTX/多文件夹 + 成长闭环 + 取消', async (t) => {
  if (!HAS_CREDENTIAL()) {
    t.skip('no credential after bootstrap; blocked without fabricating success');
    return;
  }
  const root = await tempDir('e2e');
  const runtime = createRealRuntime();
  await runtime.createPackage({ displayName: '真实能力主体', targetDir: path.join(root, 'pkg') });

  // --- 1) 无材料 ---
  {
      const t0 = Date.now();
      const { taskId, jobId } = await runtime.submitTask({
        goal: '用三句话介绍本地优先的数字主体概念',
        contextRefs: [],
        requestedArtifactType: 'document',
      });
      const submitMs = Date.now() - t0;
      const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
      const totalMs = Date.now() - t0;
      assert.equal(job.status, 'succeeded');
      assert.equal(job.capabilityId, OPENAI_COMPATIBLE_CAPABILITY_ID);
      assert.equal(job.artifactId, artifactIdForJob(jobId));
      const content = await runtime.getContent({ artifactId: job.artifactId as string });
      assert.ok((content.text?.length ?? 0) > 20);
      perfRows.push({
        case: 'no-material',
        submitMs,
        totalMs,
        status: job.status,
        ...(job.costActual?.tokens !== undefined ? { modelTokens: job.costActual.tokens } : {}),
        ...(content.text !== undefined ? { artifactChars: content.text.length } : {}),
        ...(job.costActual?.durationMs !== undefined
          ? { capabilityDurationMs: job.costActual.durationMs }
          : {}),
      });
      await writeEvidence('case-no-material.json', {
        taskId,
        jobId,
        submitMs,
        totalMs,
        status: job.status,
        artifactChars: content.text?.length,
        excerpt: content.text?.slice(0, 400),
        model: modelEnv.model,
        baseUrlHost: new URL(modelEnv.baseUrl).host,
      });
    }

    // --- 2) 单文件 ---
    const materials = path.join(root, 'materials');
    await fs.mkdir(materials, { recursive: true });
    const notePath = path.join(materials, 'note.txt');
    await fs.writeFile(notePath, '关键事实:项目代号为青竹,本周完成基础设施端口。', 'utf8');
    {
      const t0 = Date.now();
      const { jobId } = await runtime.submitTask({
        goal: '根据材料写一段项目进展摘要,必须提到青竹',
        contextRefs: [{ kind: 'file', path: notePath }],
        requestedArtifactType: 'document',
      });
      const submitMs = Date.now() - t0;
      const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
      const totalMs = Date.now() - t0;
      assert.equal(job.status, 'succeeded');
      const text = (await runtime.getContent({ artifactId: job.artifactId as string })).text ?? '';
      assert.match(text, /青竹/);
      perfRows.push({
        case: 'single-file',
        submitMs,
        totalMs,
        artifactChars: text.length,
        status: job.status,
      });
      await writeEvidence('case-single-file.json', {
        submitMs,
        totalMs,
        status: job.status,
        mentionsBamboo: /青竹/.test(text),
        excerpt: text.slice(0, 400),
      });
    }

    // --- 3) PPTX ---
    const pptxPath = path.join(materials, 'deck.pptx');
    const slide = (text: string) =>
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${text}</a:t></a:p></p:sld>`;
    await fs.writeFile(
      pptxPath,
      writeZip([
        { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide('幻灯片要点:接口契约冻结'), 'utf8') },
      ]),
    );
    {
      const t0 = Date.now();
      const { jobId } = await runtime.submitTask({
        goal: '把幻灯片要点整理成三条行动建议',
        contextRefs: [{ kind: 'file', path: pptxPath }],
        requestedArtifactType: 'document',
      });
      const submitMs = Date.now() - t0;
      const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
      const totalMs = Date.now() - t0;
      assert.equal(job.status, 'succeeded');
      const text = (await runtime.getContent({ artifactId: job.artifactId as string })).text ?? '';
      assert.ok(text.length > 20);
      perfRows.push({ case: 'pptx', submitMs, totalMs, artifactChars: text.length, status: job.status });
      await writeEvidence('case-pptx.json', {
        submitMs,
        totalMs,
        status: job.status,
        excerpt: text.slice(0, 400),
      });
    }

    // --- 4) 多文件夹 ---
    const folderA = path.join(materials, 'folder-a');
    const folderB = path.join(materials, 'folder-b');
    await fs.mkdir(folderA, { recursive: true });
    await fs.mkdir(folderB, { recursive: true });
    await fs.writeFile(path.join(folderA, 'a.md'), '# A\n模块甲已完成', 'utf8');
    await fs.writeFile(path.join(folderB, 'b.txt'), '模块乙待联调', 'utf8');
    await fs.writeFile(path.join(folderB, 'bad.docx'), Buffer.from('not-zip'));
    {
      const t0 = Date.now();
      const { jobId } = await runtime.submitTask({
        goal: '汇总两个文件夹中的模块状态',
        contextRefs: [
          { kind: 'folder', path: folderA },
          { kind: 'folder', path: folderB },
        ],
        requestedArtifactType: 'document',
      });
      const submitMs = Date.now() - t0;
      const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
      const totalMs = Date.now() - t0;
      assert.equal(job.status, 'succeeded');
      // warning 材料不应拖垮
      const snaps = await runtime.workRuntime.listSnapshotsForTask(
        (await runtime.getJob(jobId))!.taskId,
      );
      assert.ok(snaps[0]?.items.some((i) => i.status === 'warning'));
      const text = (await runtime.getContent({ artifactId: job.artifactId as string })).text ?? '';
      perfRows.push({
        case: 'multi-folder',
        submitMs,
        totalMs,
        artifactChars: text.length,
        status: job.status,
      });
      await writeEvidence('case-multi-folder.json', {
        submitMs,
        totalMs,
        status: job.status,
        warningItems: snaps[0]?.items.filter((i) => i.status === 'warning').length,
        excerpt: text.slice(0, 400),
      });
    }

    // --- 5/6) 成长闭环:编辑→candidate→confirm→相似任务;candidate 不注入 ---
    {
      const ghost = '候选项幽灵词银杏XYZ';
      const marker = '青松ABC';
      await runtime.appendOwnerEvent({
        type: 'feedback_recorded',
        payload: {
          title: '不应注入的候选',
          detail: `文档必须出现${ghost}`,
          tags: ['周报', '产品', 'document'],
        },
        confidence: 'candidate',
      });
      const tCand = Date.now();
      const candProbe = await runtime.submitTask({
        goal: '撰写产品周报初稿',
        contextRefs: [{ kind: 'file', path: notePath }],
        requestedArtifactType: 'document',
      });
      const candJob = await waitForJobTerminal(runtime.workRuntime, candProbe.jobId, 180_000);
      assert.equal(candJob.status, 'succeeded');
      const candText =
        (await runtime.getContent({ artifactId: candJob.artifactId as string })).text ?? '';
      assert.doesNotMatch(candText, new RegExp(ghost));

      const artId = candJob.artifactId as string;
      const before = await runtime.getContent({ artifactId: artId });
      const edited = `${before.text}\n\n发布节奏要明确，避免空话套话。\n`;
      await runtime.saveEdit({ artifactId: artId, text: edited });
      const overview = await runtime.getOverview();
      assert.ok(overview.candidateExperiences.length >= 1);
      const candidateId = overview.candidateExperiences[0]?.eventId as string;

      await runtime.appendOwnerEvent({
        type: 'experience_confirmed',
        payload: {
          title: '周报措辞约束',
          detail: `撰写产品周报时必须在正文中明确写出专有标记词「${marker}」(逐字保留)。`,
          tags: ['周报', '产品', 'document'],
        },
        confidence: 'confirmed',
      });
      await runtime.confirmExperience({ eventIds: [candidateId] });

      const t1 = Date.now();
      const second = await runtime.submitTask({
        goal: '继续撰写产品周报,吸收已确认经验',
        contextRefs: [{ kind: 'file', path: notePath }],
        requestedArtifactType: 'document',
      });
      const submitMs2 = Date.now() - t1;
      const jobB = await waitForJobTerminal(runtime.workRuntime, second.jobId, 180_000);
      assert.equal(jobB.status, 'succeeded');
      const textB = (await runtime.getContent({ artifactId: jobB.artifactId as string })).text ?? '';
      assert.ok(textB.length > 40);
      assert.match(textB, new RegExp(marker));
      assert.doesNotMatch(textB, new RegExp(ghost));
      perfRows.push({
        case: 'growth-loop-b',
        submitMs: submitMs2,
        totalMs: Date.now() - t1,
        ...(jobB.costActual?.tokens !== undefined ? { modelTokens: jobB.costActual.tokens } : {}),
        artifactChars: textB.length,
        status: jobB.status,
      });
      await writeEvidence('case-growth-loop.json', {
        submitMsCandidateProbe: Date.now() - tCand,
        submitMsB: submitMs2,
        confirmedCount: (await runtime.getOverview()).confirmedExperienceCount,
        candidateId,
        markerPresent: new RegExp(marker).test(textB),
        ghostAbsent: !new RegExp(ghost).test(textB),
        capabilityDurationMs: jobB.costActual?.durationMs,
        tokens: jobB.costActual?.tokens,
        excerptB: textB.slice(0, 500),
        model: modelEnv.model,
      });
    }

    // --- 10) abort/cancel during slow path: submit then cancel quickly ---
    {
      const { jobId } = await runtime.submitTask({
        goal: '写一篇较长的架构说明,尽量详细',
        contextRefs: [
          { kind: 'folder', path: folderA },
          { kind: 'folder', path: folderB },
          { kind: 'file', path: notePath },
        ],
        requestedArtifactType: 'document',
      });
      await new Promise((r) => setTimeout(r, 50));
      await runtime.cancelJob({ jobId });
      const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
      assert.ok(job.status === 'cancelled' || job.status === 'succeeded' || job.status === 'failed');
      if (job.status === 'cancelled') {
        assert.equal(await runtime.getArtifact(artifactIdForJob(jobId)), null);
      }
      await writeEvidence('case-cancel.json', { status: job.status, stage: job.failure?.stage });
    }

    // --- 13/14/15/16) 单活跃 + 取消不产 Artifact + retry 新 Job 可成功 ---
    {
      const { taskId, jobId } = await runtime.submitTask({
        goal: '一句话总结本地优先',
        contextRefs: [],
        requestedArtifactType: 'document',
      });
      await assert.rejects(() => runtime.retryTask({ taskId }), /active job/);
      const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
      assert.equal(job.status, 'succeeded');
      assert.ok(job.artifactId);
      assert.ok(await runtime.getArtifact(job.artifactId as string));

      const cancelled = await runtime.submitTask({
        goal: '写一篇将被取消的长文以便验证失败不落成果',
        contextRefs: [
          { kind: 'folder', path: folderA },
          { kind: 'folder', path: folderB },
        ],
        requestedArtifactType: 'document',
      });
      await new Promise((r) => setTimeout(r, 30));
      await runtime.cancelJob({ jobId: cancelled.jobId });
      const cancelledJob = await waitForJobTerminal(runtime.workRuntime, cancelled.jobId, 180_000);
      if (cancelledJob.status === 'cancelled' || cancelledJob.status === 'failed') {
        assert.equal(await runtime.getArtifact(artifactIdForJob(cancelled.jobId)), null);
        const retried = await runtime.retryTask({ taskId: cancelled.taskId });
        assert.notEqual(retried.jobId, cancelled.jobId);
        const retryJob = await waitForJobTerminal(runtime.workRuntime, retried.jobId, 180_000);
        assert.equal(retryJob.status, 'succeeded');
        assert.ok(retryJob.artifactId);
        assert.ok(await runtime.getArtifact(retryJob.artifactId as string));
        await writeEvidence('case-retry-after-cancel.json', {
          cancelledStatus: cancelledJob.status,
          retryJobId: retried.jobId,
          retryStatus: retryJob.status,
          capabilityDurationMs: retryJob.costActual?.durationMs,
          tokens: retryJob.costActual?.tokens,
        });
      } else {
        await writeEvidence('case-retry-after-cancel.json', {
          cancelledStatus: cancelledJob.status,
          note: 'cancel raced past model completion; skip retry path',
        });
      }
    }

    await writeEvidence('perf-summary.json', {
      model: modelEnv.model,
      baseUrlHost: new URL(modelEnv.baseUrl).host,
      source: modelEnv.source,
      rows: perfRows,
    });

    await runtime.stop();
});

test('DOCX 材料真实任务(附加)', async (t) => {
  if (!HAS_CREDENTIAL()) {
    t.skip('no credential after bootstrap');
    return;
  }
  const root = await tempDir('docx');
  const runtime = createRealRuntime();
  await runtime.createPackage({ displayName: 'docx', targetDir: path.join(root, 'pkg') });
  const docxPath = path.join(root, 'brief.docx');
  await fs.writeFile(docxPath, buildDocxFromMarkdown('# 纪要\n\n决议:下周二联调。'));
  const t0 = Date.now();
  const { jobId } = await runtime.submitTask({
    goal: '把纪要改写成待办列表',
    contextRefs: [{ kind: 'file', path: docxPath }],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, jobId, 180_000);
  assert.equal(job.status, 'succeeded');
  await writeEvidence('case-docx.json', {
    submitMs: Date.now() - t0,
    status: job.status,
    excerpt: ((await runtime.getContent({ artifactId: job.artifactId as string })).text ?? '').slice(
      0,
      400,
    ),
  });
  await runtime.stop();
});
