/**
 * A2A remote capability E2E — one real-model happy path + deterministic faults.
 */
'use strict';

const { promises: fs } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startResearchA2AAgent } = require('./_research-a2a-agent-lifecycle.cjs');

async function loadPeerModelEnv(appRoot) {
  const out = {};
  const runtimeFile = path.join(
    appRoot,
    'scripts',
    '_mvp-p14-real-capability-evidence',
    '.runtime-model-credential.json',
  );
  try {
    const raw = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
    if (raw.apiKey) out.DIGITALME_RESEARCH_AGENT_API_KEY = String(raw.apiKey);
    if (raw.baseUrl) out.DIGITALME_RESEARCH_AGENT_BASE_URL = String(raw.baseUrl);
    if (raw.model) out.DIGITALME_RESEARCH_AGENT_MODEL = String(raw.model);
  } catch {
    /* fall through to process.env */
  }
  if (!out.DIGITALME_RESEARCH_AGENT_API_KEY) {
    out.DIGITALME_RESEARCH_AGENT_API_KEY =
      process.env.DIGITALME_RESEARCH_AGENT_API_KEY ||
      process.env.DIGITALME_MODEL_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      '';
  }
  if (!out.DIGITALME_RESEARCH_AGENT_BASE_URL) {
    out.DIGITALME_RESEARCH_AGENT_BASE_URL =
      process.env.DIGITALME_RESEARCH_AGENT_BASE_URL ||
      process.env.DIGITALME_MODEL_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.DEEPSEEK_BASE_URL ||
      '';
  }
  if (!out.DIGITALME_RESEARCH_AGENT_MODEL) {
    out.DIGITALME_RESEARCH_AGENT_MODEL =
      process.env.DIGITALME_RESEARCH_AGENT_MODEL ||
      process.env.DIGITALME_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.DEEPSEEK_MODEL ||
      '';
  }
  if (!out.DIGITALME_RESEARCH_AGENT_API_KEY) {
    throw new Error('missing research agent model credential for real-model acceptance');
  }
  return out;
}

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const {
    createDigitalMeRuntime,
  } = require('../dist/runtime/digitalme-runtime.js');
  const {
    A2A_REMOTE_CAPABILITY_ID,
  } = require('../dist/capability/adapters/a2a-remote.js');
  const {
    createPrivateHttpRemoteCapabilityAdapter,
  } = require('../dist/capability/adapters/private-http-remote.js');
  const { buildResearchEndpointPolicy } = require('../dist/capability/remote-endpoint-policy.js');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner.js');
  const { artifactIdForJob } = require('../dist/work-runtime/artifact.js');
  const { newId, nowIso } = require('../dist/shared/ids.js');

  const peerEnv = await loadPeerModelEnv(appRoot);
  const agent = await startResearchA2AAgent({
    ...peerEnv,
    RESEARCH_A2A_PORT: String(43121 + Math.floor(Math.random() * 200)),
    RESEARCH_A2A_DELAY_MS: '900',
  });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-a2a-e2e-'));
  const pkgDir = path.join(root, 'pkg');
  const matDir = path.join(root, 'materials');
  await fs.mkdir(matDir, { recursive: true });
  const allowedFile = path.join(matDir, 'project-brief.txt');
  const secretFile = path.join(matDir, 'secret.txt');
  await fs.writeFile(
    allowedFile,
    [
      '项目：北极星指标看板改造',
      '客户分层：企业版与成长版',
      '当前风险：范围未冻结、外部依赖不稳定、验收标准定性过多',
      '约束：两周内交付可核对摘要，不开放支付与公网广播',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(secretFile, 'SECRET_UNAUTHORIZED_PAYLOAD_XYZ 未授权融资细节', 'utf8');

  const endpoint = buildResearchEndpointPolicy({
    baseUrl: agent.baseUrl,
    maxTaskDuration: 180_000,
  });

  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    a2aRemoteCapability: {
      endpoint,
      pollIntervalMs: 150,
    },
  });

  const comparison = {
    a2aAdapterFiles: [
      'src/capability/adapters/a2a-remote.ts',
      'src/capability/a2a-wire.ts',
      'src/capability/remote-endpoint-policy.ts',
    ],
    privateAdapterFiles: ['src/capability/adapters/private-http-remote.ts'],
    secondCapabilityCoreTouch: [
      'src/runtime/digitalme-runtime.ts (register only)',
      'endpoint policy instance',
    ],
    notes: [],
  };

  try {
    await runtime.createPackage({
      displayName: 'A2A验收主体',
      targetDir: pkgDir,
      initialSelfDescription: '我做 B2B 产品，重视可核对的风险摘要',
    });

    // --- Happy path: real model ---
    const grantId = newId('grant');
    const pkg = runtime.subject.requireActive();
    const grant = {
      id: grantId,
      grantorSubjectId: pkg.id,
      grantee: { kind: 'remote_subject', subjectId: 'research_a2a_peer' },
      scope: {
        actions: ['read_authorized_context', 'execute_subtask', 'return_artifact'],
        resourceRefs: [allowedFile],
      },
      origin: { kind: 'owner_direct' },
      status: 'granted',
      grantedAt: nowIso(),
      subtaskGoal: '根据明确授权的项目材料，形成一份 500–800 字的结构化项目风险摘要',
    };
    const grantDir = path.join(pkg.rootDir, 'collaboration', 'grants');
    await fs.mkdir(grantDir, { recursive: true });
    await fs.writeFile(path.join(grantDir, `${grantId}.json`), `${JSON.stringify(grant, null, 2)}\n`);

    const { jobId } = await runtime.submitTask({
      goal: '根据明确授权的项目材料，形成一份 500–800 字的结构化项目风险摘要',
      contextRefs: [
        { kind: 'file', path: allowedFile },
        { kind: 'file', path: secretFile },
      ],
      requestedArtifactType: 'document',
      capabilityId: A2A_REMOTE_CAPABILITY_ID,
      authorization: {
        grantId,
        issuerSubjectId: pkg.id,
        granteeSubjectId: 'research_a2a_peer',
      },
    });

    const job = await waitForJobTerminal(runtime.workRuntime, jobId, 200_000);
    if (job.status !== 'succeeded') {
      throw new Error(`expected succeeded, got ${job.status}: ${job.failure?.message || ''}`);
    }
    if (!job.remoteExecution?.executionId) {
      throw new Error('missing remoteExecution mapping');
    }

    const artifactId = artifactIdForJob(jobId);
    const artifact = await runtime.getArtifact(artifactId);
    if (!artifact) throw new Error('missing artifact');
    const content = await runtime.getContent({
      artifactId,
      versionId: artifact.headVersionId,
    });
    const text = String(
      content.text ||
        content.bundle?.entries?.map((e) => e.text || '').join('\n') ||
        '',
    );
    if (/SECRET_UNAUTHORIZED_PAYLOAD_XYZ/.test(text)) {
      throw new Error('unauthorized material leaked');
    }
    if (text.length < 400) {
      throw new Error(`artifact too short: ${text.length}`);
    }
    const provenance =
      (content.bundle &&
        content.bundle.entries.find((e) => e.role === 'action-receipt') &&
        'receipt') ||
      '';
    const receiptEntry = content.bundle?.entries?.find((e) => e.role === 'action-receipt');
    let receipt = null;
    if (receiptEntry?.text) {
      receipt = JSON.parse(receiptEntry.text);
    } else if (receiptEntry?.sourcePath) {
      receipt = JSON.parse(await fs.readFile(receiptEntry.sourcePath, 'utf8'));
    }
    if (!String(receipt.artifact?.provenance || '').includes('reachedModel=true')) {
      console.warn('WARN: reachedModel not true; checking health modelConfigured');
      if (agent.modelConfigured) {
        throw new Error('expected reachedModel=true for real-model representative task');
      }
    } else {
      console.log('OK: reachedModel=true');
    }
    if (!receipt?.protocolMapping || receipt.protocolMapping.protocol !== 'a2a') {
      throw new Error('action receipt missing a2a protocolMapping');
    }
    const receiptRaw = JSON.stringify(receipt);
    if (/api[_-]?key|sk-|Bearer\s+[A-Za-z0-9]/i.test(receiptRaw)) {
      throw new Error('action receipt must not contain credentials');
    }
    // content integrity must be distinguishable in candidate path (artifact bundle or provenance)
    if (!/reachedModel=true/.test(String(receipt.artifact?.provenance || ''))) {
      throw new Error('provenance must record reachedModel separately from quality');
    }

    // --- Integrity faults: short revise success / revise fail / no template padding ---
    async function runFaultJob(fault, expectStatus) {
      const rt = createDigitalMeRuntime({
        documentCapability: 'none',
        registerOpenAiStub: false,
        a2aRemoteCapability: {
          endpoint,
          pollIntervalMs: 80,
          defaultFault: fault,
        },
      });
      await rt.openPackage({ dir: pkgDir });
      const submitted = await rt.submitTask({
        goal: '根据明确授权的项目材料，形成一份 500–800 字的结构化项目风险摘要',
        contextRefs: [{ kind: 'file', path: allowedFile }],
        requestedArtifactType: 'document',
        capabilityId: A2A_REMOTE_CAPABILITY_ID,
      });
      const job = await waitForJobTerminal(rt.workRuntime, submitted.jobId, 180_000);
      rt.workRuntime.stop();
      if (job.status !== expectStatus) {
        throw new Error(
          `fault=${fault} expected ${expectStatus}, got ${job.status}: ${job.failure?.message || ''}`,
        );
      }
      return job;
    }

    await runFaultJob('short_output', 'succeeded');
    console.log('OK: short_output revised to success');
    await runFaultJob('short_output_revise_fail', 'failed');
    console.log('OK: short_output_revise_fail failed without template success');

    // 模板补写检测：本地验证层
    const {
      verifyCandidateArtifact,
    } = require('../dist/capability/candidate-artifact-verify.js');
    const padded = verifyCandidateArtifact({
      output: {
        artifact: {
          type: 'document',
          title: 'x',
          payload: {
            kind: 'text',
            format: 'markdown',
            text:
              '短文\n交付范围漂移：若关键决策标准未冻结，后续迭代可能偏离原目标。',
          },
        },
        candidateMeta: {
          provenance: 'a2a:1.0:test',
          sourceBinding: 'x',
          contentIntegrity: {
            modelGeneratedContent: '短文',
            modelContentDigest: require('crypto').createHash('sha256').update('短文', 'utf8').digest('hex'),
            deterministicFormatting: ['title'],
            reachedModel: true,
            insufficientLength: false,
          },
        },
      },
      goal: '形成项目风险摘要',
      expectedArtifactType: 'document',
      auth: {
        allowedFields: [],
        allowedMaterials: [],
        purpose: 't',
        maxCalls: 1,
        maxMaterialBytes: 100000,
        maxRuntimeMs: 60000,
        allowRemotePersist: false,
        allowRedelegate: false,
      },
      nowIso: new Date().toISOString(),
    });
    if (
      padded.verdict !== 'rejected' ||
      !padded.issues.some((i) => i.code === 'template_padding_detected')
    ) {
      throw new Error('expected template_padding_detected rejection');
    }
    console.log('OK: template padding rejected by verification');

    const before = await runtime.subject.listGrowthEvents();
    await runtime.captureSubjectInput({
      text: '采用该风险摘要中的范围冻结建议',
      sourceKind: 'artifact_acceptance',
      artifactId,
      artifactVersionId: artifact.headVersionId,
    });
    const after = await runtime.subject.listGrowthEvents();
    if (after.length <= before.length) throw new Error('expected growth after accept');
    runtime.workRuntime.stop();

    // reject path on a second task with fault leak -> verification fail, no growth
    const leakRuntime = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      a2aRemoteCapability: {
        endpoint,
        pollIntervalMs: 80,
        defaultFault: 'leak_unauthorized',
      },
    });
    await leakRuntime.openPackage({ dir: pkgDir });
    const beforeReject = await leakRuntime.subject.listGrowthEvents();
    const leakSubmit = await leakRuntime.submitTask({
      goal: '泄漏检测任务',
      contextRefs: [{ kind: 'file', path: allowedFile }],
      requestedArtifactType: 'document',
      capabilityId: A2A_REMOTE_CAPABILITY_ID,
    });
    const leakJob = await waitForJobTerminal(leakRuntime.workRuntime, leakSubmit.jobId, 60_000);
    if (leakJob.status !== 'failed') {
      throw new Error(`expected leak verification failure, got ${leakJob.status}`);
    }
    const afterReject = await leakRuntime.subject.listGrowthEvents();
    if (afterReject.length !== beforeReject.length) {
      throw new Error('failed verification must not create positive growth');
    }
    leakRuntime.workRuntime.stop();

    // cancel + late result gate
    const cancelRuntime = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      a2aRemoteCapability: {
        endpoint,
        pollIntervalMs: 60,
        defaultFault: 'never_complete',
      },
    });
    await cancelRuntime.openPackage({ dir: pkgDir });
    const cancelSubmit = await cancelRuntime.submitTask({
      goal: '取消门禁任务',
      contextRefs: [{ kind: 'file', path: allowedFile }],
      requestedArtifactType: 'document',
      capabilityId: A2A_REMOTE_CAPABILITY_ID,
    });
    const cancelStarted = Date.now();
    while (Date.now() - cancelStarted < 8_000) {
      const view = await cancelRuntime.workRuntime.getJob(cancelSubmit.jobId);
      if (view?.status === 'running' && view.remoteExecution?.executionId) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await cancelRuntime.workRuntime.cancelJob({ jobId: cancelSubmit.jobId });
    const cancelJob = await waitForJobTerminal(cancelRuntime.workRuntime, cancelSubmit.jobId, 30_000);
    if (cancelJob.status !== 'cancelled') {
      throw new Error(`expected cancelled, got ${cancelJob.status}`);
    }
    cancelRuntime.workRuntime.stop();

    // restart recovery
    const recoverRuntime1 = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      a2aRemoteCapability: {
        endpoint,
        pollIntervalMs: 80,
        defaultFault: 'delay_complete',
      },
    });
    await recoverRuntime1.openPackage({ dir: pkgDir });
    const recoverSubmit = await recoverRuntime1.submitTask({
      goal: '重启恢复任务：形成项目风险摘要',
      contextRefs: [{ kind: 'file', path: allowedFile }],
      requestedArtifactType: 'document',
      capabilityId: A2A_REMOTE_CAPABILITY_ID,
    });
    const recoverWait = Date.now();
    let remoteId = null;
    while (Date.now() - recoverWait < 10_000) {
      const view = await recoverRuntime1.workRuntime.getJob(recoverSubmit.jobId);
      if (view?.remoteExecution?.executionId) {
        remoteId = view.remoteExecution.executionId;
        if (view.status === 'running') break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!remoteId) throw new Error('recover path missing remoteExecution before restart');
    recoverRuntime1.workRuntime.stop();

    const recoverRuntime2 = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      a2aRemoteCapability: {
        endpoint,
        pollIntervalMs: 80,
      },
    });
    await recoverRuntime2.openPackage({ dir: pkgDir });
    recoverRuntime2.workRuntime.start();
    const recovered = await waitForJobTerminal(
      recoverRuntime2.workRuntime,
      recoverSubmit.jobId,
      120_000,
    );
    if (recovered.status !== 'succeeded' && recovered.status !== 'cancelled') {
      throw new Error(
        `recover expected terminal success/cancel, got ${recovered.status}: ${recovered.failure?.message || ''}`,
      );
    }
    if (recovered.remoteExecution?.executionId !== remoteId) {
      throw new Error('remoteExecution mapping changed across restart');
    }
    recoverRuntime2.workRuntime.stop();

    // private API comparison (engineering only)
    const privateAdapter = createPrivateHttpRemoteCapabilityAdapter({
      endpoint: agent.baseUrl,
      timeoutMs: 120_000,
    });
    comparison.notes.push(
      `A2A adapter surface files=${comparison.a2aAdapterFiles.length}; private=${comparison.privateAdapterFiles.length}`,
    );
    comparison.notes.push(
      'Second external agent: add endpoint policy + register adapter; no Subject/Work/Artifact contract edits',
    );
    comparison.notes.push(
      'Private path lacks durable cancel/recover task semantics; A2A reuses Job.remoteExecution mapping',
    );
    const privateAvail = await privateAdapter.checkAvailability();
    if (!privateAvail.available) throw new Error('private compare endpoint unavailable');

    // no second store
    const runnerSrc = await fs.readFile(path.join(appRoot, 'src/work-runtime/job-runner.ts'), 'utf8');
    if (/class\s+RemoteExecutionStore|A2ATaskStore/.test(runnerSrc)) {
      throw new Error('forbidden second remote store in job-runner');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          reachedModelProvenance: String(receipt.artifact?.provenance || ''),
          remoteExecutionId: job.remoteExecution.executionId,
          protocolMapping: receipt.protocolMapping,
          comparison,
          agent: {
            baseUrl: agent.baseUrl,
            independentPid: agent.pid,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      runtime.workRuntime?.stop();
    } catch {
      /* ignore */
    }
    await agent.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
