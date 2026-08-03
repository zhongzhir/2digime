/** 仅重试 digitalme-v2 架构分析并落证据。 */
const { promises: fs } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  process.chdir(appRoot);
  require('child_process').execSync('npm run build', { stdio: 'inherit' });
  try {
    require('child_process').execSync('node scripts/load-app-model-credential.cjs', { stdio: 'pipe' });
  } catch {}
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  const { createEnvSecretAccessor, resolveModelEnvAsync } = require('../dist/infrastructure/env-secrets');
  const modelEnv = await resolveModelEnvAsync(appRoot, process.env);
  const cred = modelEnv.runtime;
  if (!cred) throw new Error('no cred');
  const secrets = createEnvSecretAccessor(process.env, cred.providerId, cred);

  const slim = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-mini-'));
  const files = [
    'package.json',
    'src/runtime/commands.ts',
    'src/work-runtime/execution-job.ts',
    'src/work-runtime/job-runner.ts',
    'src/work-runtime/context-snapshot.ts',
    'src/work-runtime/context-policy.ts',
    'src/capability/adapter.ts',
    'src/capability/registration.ts',
    'src/capability/adapters/code-repo-analysis.ts',
    'src/subject-core/subject-service.ts',
    'src/artifact-workspace/workspace.ts',
    'src/collaboration/local-simulation.ts',
    'electron/main.cjs',
  ];
  for (const rel of files) {
    const dest = path.join(slim, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(appRoot, rel), dest);
  }

  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      providerId: cred.providerId,
      baseUrl: cred.baseUrl,
      model: cred.model,
      temperature: 0.2,
      maxTokens: 8192,
      timeoutMs: 300000,
    },
    secrets,
    registerOpenAiStub: false,
    codeAnalysisCapability: 'openai-compatible',
  });
  const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p22v2-'));
  await runtime.createPackage({ displayName: 'p22-v2', targetDir: pkg });
  const goal =
    '分析 Digital Me V2 当前架构，说明 Subject、Work、Capability、Artifact、Collaboration 的边界；检查是否重新出现多状态、多入口、多 Store、UI 持有事实状态或业务逻辑回流 Electron main 的风险；给出下一阶段建议。';
  const submitted = await runtime.submitTask({
    goal,
    contextRefs: [{ kind: 'folder', path: slim }],
    requestedArtifactType: 'code-analysis',
  });
  const job = await waitForJobTerminal(runtime, submitted.jobId, 500000);
  const outDir = path.join(appRoot, 'scripts', '_mvp-p22-real-code-analysis-evidence');
  await fs.mkdir(outDir, { recursive: true });
  const result = { status: job.status, failure: job.failure || null, jobId: job.id };
  if (job.status === 'succeeded') {
    const task = await runtime.getTask({ taskId: submitted.taskId });
    const content = await runtime.getContent({ artifactId: task.artifactIds[0] });
    await fs.writeFile(path.join(outDir, 'digitalme-v2-report.md'), content.text || '', 'utf8');
    const evidence = (content.bundle?.entries || []).find((e) => e.role === 'evidence');
    const manifest = (content.bundle?.entries || []).find((e) => e.role === 'manifest');
    if (evidence?.text) await fs.writeFile(path.join(outDir, 'digitalme-v2-evidence.json'), evidence.text, 'utf8');
    if (manifest?.text) await fs.writeFile(path.join(outDir, 'digitalme-v2-manifest.json'), manifest.text, 'utf8');
    const text = content.text || '';
    Object.assign(result, {
      artifactId: task.artifactIds[0],
      reportChars: text.length,
      evidenceCount: evidence?.text ? JSON.parse(evidence.text).items.length : 0,
      absolutePathLeaks: /(?:[A-Za-z]:\\|\/Users\/)/.test(text) ? 1 : 0,
      secretLeaks: /sk-[A-Za-z0-9_-]{8,}/.test(text) ? 1 : 0,
      hasSubject: /Subject|subject-core/i.test(text),
      hasWork: /Work Runtime|work-runtime|JobRunner/i.test(text),
      hasCapability: /Capability|Adapter/i.test(text),
      hasArtifact: /Artifact|bundle/i.test(text),
      hasCollab: /Collaboration/i.test(text),
      hasElectron: /Electron/i.test(text),
      hasJobFive: /五态|queued|succeeded|cancelled/i.test(text),
      hasSnapshotFreeze: /Snapshot|冻结|contextPolicy/i.test(text),
      hasCommand16: /16|COMMAND_COUNT|命令/i.test(text),
      distinguishesConfidence: /已证实/.test(text) && /推测/.test(text) && /未覆盖/.test(text),
    });

    // growth edit + confirm
    const edited = text + '\n\n## 人工修正\n应优先保持 Work Runtime 对代码场景零感知，任何新能力只通过 Adapter 与通用 contextPolicy 扩展。\n';
    await runtime.saveEdit({ artifactId: task.artifactIds[0], text: edited });
    const overview = await runtime.getOverview({});
    const candidates = overview.candidateExperiences || [];
    if (candidates[0]) {
      await runtime.confirmExperience({ eventIds: [candidates[0].eventId] });
      result.growthConfirmed = true;
    } else {
      result.growthConfirmed = false;
      result.candidateCount = candidates.length;
    }
  } else {
    // dump raw if present in work dir
    const workRaw = path.join(pkg, 'runtime', 'work', 'jobs', job.id, '_raw-model-response.txt');
    try {
      const raw = await fs.readFile(workRaw, 'utf8');
      await fs.writeFile(path.join(outDir, 'digitalme-v2-raw.txt'), raw.slice(0, 100000), 'utf8');
    } catch {}
  }
  await fs.writeFile(path.join(outDir, 'digitalme-v2-retry.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  await runtime.stop();
  process.exit(job.status === 'succeeded' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
