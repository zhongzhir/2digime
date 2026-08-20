/**
 * DIGITALME-PRODUCT-SEMANTICS-RECOVERY-01
 * 覆盖 Owner 真机暴露的主语义：对话不建 Task、任务身份隔离、
 * CTO 验收、采用结束、外部资料不进本人事实、做事经历可被提及。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { preserveExistingTaskIdentity } from '../../work-runtime/thin-owner-start';
import {
  decideConverseEffects,
  CURRENT_RESULT_ACCEPTED_REPLY,
} from '../../work-runtime/work-converse';
import {
  isExplicitCurrentResultAcceptance,
  isClearOwnerDirectedRevision,
} from '../../work-runtime/work-revision-routing';
import {
  isSubjectFactQuery,
  buildControlledFactualReply,
  buildConversationSystemContent,
} from '../../subject-core/conversation-context';
import { buildDigitalMeCtoReview } from '../../execution/cto-review';
import { projectReadonlyTools } from '../../capability/adapters/mcp-stdio-readonly';
import type { McpTransport } from '../../capability/adapters/mcp-stdio-readonly';

const LOOKUP_Q =
  '查看提供的项目资料，告诉我哪个项目处于 active 状态，以及它的优先级。';
const NAME_GOAL = '只有姓或只有名时用户名会多出空格，请修好并补上测试。';
const INV_GOAL = '库存扣减超过现有数量时不要变成负数，请修好并补上测试。';

const SERVER_TOOLS = [
  { name: 'read_file', annotations: { readOnlyHint: true } },
  { name: 'read_text_file', annotations: { readOnlyHint: true } },
  { name: 'write_file', annotations: { readOnlyHint: false } },
  { name: 'list_directory', annotations: { readOnlyHint: true } },
];

function filesystemTransport(): McpTransport {
  const files: Record<string, string> = {
    'project-alpha.md': 'Project Alpha\nOwner: Alice\nStatus: active\nPriority: high\n',
    'project-beta.md': 'Project Beta\nOwner: Bob\nStatus: paused\nPriority: low\n',
  };
  return {
    async listTools() {
      return SERVER_TOOLS;
    },
    async callTool(name, args) {
      if (name === 'list_directory') {
        return {
          result: {
            content: [{ type: 'text', text: '[FILE] project-alpha.md\n[FILE] project-beta.md' }],
          },
        };
      }
      if (name === 'read_text_file' || name === 'read_file') {
        const p = String(args.path || '').replace(/\\/g, '/');
        const base = p.split('/').pop() || '';
        const text = files[base];
        if (!text) return { error: { message: 'not found' } };
        return { result: { content: [{ type: 'text', text }] } };
      }
      return { error: { message: `unexpected ${name}` } };
    },
    async close() {},
  };
}

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-semantics-${prefix}-`));
}

describe('product-semantics-recovery-01', () => {
  it('A: 资料查询不创建 Task', async () => {
    const dir = await tempDir('lookup');
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      externalExecutorCapability: false,
      mcpReadonlyCapability: {
        transportHook: filesystemTransport(),
        forceAvailability: 'available',
        allowedTools: projectReadonlyTools(SERVER_TOOLS),
        queryMode: 'filesystem-lookup',
        allowedDirectory: path.join(dir, 'notes-root'),
        lookupDirectory: path.join(dir, 'notes-root', 'notes'),
      },
    });
    await rt.createPackage({ displayName: 'sem-lookup', targetDir: dir });
    await fs.mkdir(path.join(dir, 'notes-root', 'notes'), { recursive: true });
    const before = await rt.listTasks({ limit: 50 });
    const looked = await rt.tryProvidedMaterialsLookup(LOOKUP_Q);
    const after = await rt.listTasks({ limit: 50 });
    assert.ok(looked && /Project Alpha/.test(looked.text) && /high/i.test(looked.text));
    assert.equal(after.tasks.length, before.tasks.length);
    rt.workRuntime.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('B: 后一个目标不得覆盖已有 Task 的 goal / 工作目录', async () => {
    const nameDir = path.join(os.tmpdir(), `dm-name-${Date.now()}`);
    const invDir = path.join(os.tmpdir(), `dm-inv-${Date.now()}`);
    await fs.mkdir(nameDir, { recursive: true });
    await fs.mkdir(invDir, { recursive: true });
    const preserved = preserveExistingTaskIdentity(
      { goal: NAME_GOAL, contextRefs: [{ kind: 'folder', path: nameDir }] },
      { goal: INV_GOAL, contextRefs: [{ kind: 'folder', path: invDir }] },
    );
    assert.equal(preserved.goal, NAME_GOAL);
    assert.equal(preserved.contextRefs[0]?.path, nameDir);

    const nameFile = path.join(nameDir, 'readme.txt');
    const invFile = path.join(invDir, 'readme.txt');
    await fs.writeFile(nameFile, 'name', 'utf8');
    await fs.writeFile(invFile, 'inv', 'utf8');
    const pkg = await tempDir('ident-pkg');
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      externalExecutorCapability: false,
    });
    await rt.createPackage({ displayName: 'sem-ident', targetDir: pkg });
    const t1 = await rt.workRuntime.createConversationTask({
      goal: NAME_GOAL,
      contextRefs: [{ kind: 'file', path: nameFile }],
    });
    const t2 = await rt.workRuntime.createConversationTask({
      goal: INV_GOAL,
      contextRefs: [{ kind: 'file', path: invFile }],
    });
    assert.notEqual(t1.id, t2.id);
    try {
      await rt.submitTask({
        existingTaskId: t1.id,
        goal: INV_GOAL,
        contextRefs: [{ kind: 'file', path: invFile }],
        requestedArtifactType: 'document',
      });
    } catch {
      /* 规划硬门可能拒绝执行；身份仍不得被改写 */
    }
    const got1 = await rt.getTask({ taskId: t1.id });
    const got2 = await rt.getTask({ taskId: t2.id });
    assert.equal(got1.task.goal, NAME_GOAL);
    assert.equal(got2.task.goal, INV_GOAL);
    rt.workRuntime.stop();
    await fs.rm(pkg, { recursive: true, force: true });
  });

  it('C: CTO 通过后用户面不得要求 Owner 做技术验收', () => {
    const review = buildDigitalMeCtoReview({
      userGoal: NAME_GOAL,
      verification: {
        overall: 'satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'goal_alignment', title: '目标', verdict: 'satisfied', detail: '' },
          { id: 'file_changes', title: '文件变化', verdict: 'satisfied', detail: '' },
          { id: 'tests', title: '测试', verdict: 'satisfied', detail: '' },
          { id: 'scope_boundary', title: '范围', verdict: 'satisfied', detail: '' },
        ],
      },
      changedFileCount: 2,
      understandingKeyFiles: ['src/format.js'],
    });
    assert.equal(review.goalAttained, true);
    assert.equal(review.requiresUserDecision, false);
    assert.match(review.report, /已经完成修改并检查通过|达到目标/);
    assert.doesNotMatch(review.userFacingNextStep, /请决定是否采用|请判断结果是否正确/);
  });

  it('D: 已有通过成果时「采用」结束本轮，不授权新 Job', () => {
    assert.equal(isExplicitCurrentResultAcceptance('采用。'), true);
    assert.equal(isExplicitCurrentResultAcceptance('就这样'), true);
    assert.equal(isExplicitCurrentResultAcceptance('接受这个版本'), true);
    assert.equal(isExplicitCurrentResultAcceptance('继续修改，把测试补上。'), false);
    const d = decideConverseEffects({
      parsed: {
        intent: 'confirm_start',
        confidence: 0.9,
        reply: '好，开始',
        executionIntentKind: 'modify_code',
        expectedOutputFamily: 'code-change',
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '采用。',
    });
    assert.equal(d.adoptRequested, true);
    assert.equal(d.startAuthorized, false);
    assert.equal(d.reply, CURRENT_RESULT_ACCEPTED_REPLY);
  });

  it('E: 「继续修改」才允许修订 Job', () => {
    assert.equal(isClearOwnerDirectedRevision('继续修改，把边界用例也补上。'), true);
    const d = decideConverseEffects({
      parsed: {
        intent: 'confirm_start',
        confidence: 0.9,
        reply: '好，继续改',
        executionIntentKind: 'modify_code',
        expectedOutputFamily: 'code-change',
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '继续修改，把边界用例也补上。',
    });
    assert.equal(d.startAuthorized, true);
    assert.equal(d.startMode, 'revision');
    assert.equal(d.adoptRequested, false);
  });

  it('F: 外部 Project Alpha 不进入本人事实', async () => {
    const dir = await tempDir('ext-fact');
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      externalExecutorCapability: false,
      mcpReadonlyCapability: {
        transportHook: filesystemTransport(),
        forceAvailability: 'available',
        allowedTools: projectReadonlyTools(SERVER_TOOLS),
        queryMode: 'filesystem-lookup',
        allowedDirectory: path.join(dir, 'notes-root'),
        lookupDirectory: path.join(dir, 'notes-root', 'notes'),
      },
    });
    await rt.createPackage({ displayName: 'sem-ext', targetDir: dir });
    await fs.mkdir(path.join(dir, 'notes-root', 'notes'), { recursive: true });
    const looked = await rt.tryProvidedMaterialsLookup(LOOKUP_Q);
    assert.ok(looked && /Project Alpha/.test(looked.text));
    const overview = await rt.getOverview({});
    const facts = (overview.userVisibleFacts || []).map((f) => String(f.text || ''));
    assert.equal(facts.some((t) => /Project Alpha/i.test(t)), false);
    rt.workRuntime.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('G: 采用后做事经历进入已有事实投影；换说法不得靠预写答案，外部资料不是本人事实', async () => {
    assert.equal(isSubjectFactQuery('你了解我什么？'), true);
    assert.equal(isSubjectFactQuery('现在对我了解增加了吗？'), false);
    assert.equal(isSubjectFactQuery('现在对我了解多了吗？'), false);
    assert.equal(isSubjectFactQuery('你是通过什么方式增加了对我的了解的？'), false);

    const pkg = await tempDir('doing-pkg');
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      externalExecutorCapability: false,
    });
    await rt.createPackage({ displayName: 'sem-doing', targetDir: pkg });
    await rt.captureSubjectInput({
      text: `采用当前项目修改并保留文件变更。任务：${NAME_GOAL}`,
      sourceKind: 'artifact_acceptance',
      taskId: 'task_name_fix',
      artifactId: 'art_name_fix',
      artifactVersionId: 'ver_name_fix',
      requestedArtifactType: 'code-change',
    });
    const overview = await rt.getOverview({});
    const facts = (overview.userVisibleFacts || []).map((f) => String(f.text || ''));
    assert.equal(facts.some((t) => /空格|近期完成的工作/.test(t)), true);
    assert.equal(facts.some((t) => /Project Alpha/i.test(t)), false);
    const inventory = buildControlledFactualReply(facts);
    assert.match(inventory, /空格|近期完成的工作/);
    assert.doesNotMatch(inventory, /Project Alpha/i);
    const system = buildConversationSystemContent({ subjectFacts: facts });
    assert.match(system, /空格|近期完成的工作/);
    assert.doesNotMatch(system, /Project Alpha/i);
    rt.workRuntime.stop();
    await fs.rm(pkg, { recursive: true, force: true }).catch(() => undefined);
  });

  it('源码接线：对话 lookup 不经 submitTask；采用不走修订', async () => {
    const root = path.resolve(__dirname, '../../..');
    const runtimeSrc = await fs.readFile(path.join(root, 'src/runtime/digitalme-runtime.ts'), 'utf8');
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const main = await fs.readFile(path.join(root, 'electron/main.cjs'), 'utf8');
    assert.match(runtimeSrc, /属于对话回答，不得创建 Task/);
    assert.doesNotMatch(main, /understanding_delta_reply/);
    const convCtx = await fs.readFile(path.join(root, 'src/subject-core/conversation-context.ts'), 'utf8');
    assert.match(convCtx, /isSubjectUnderstandingDeltaOrProcessQuery/);
    assert.match(app, /lastJobDetailForUx = null/);
    assert.doesNotMatch(
      runtimeSrc.slice(runtimeSrc.indexOf('tryProvidedMaterialsLookup'), runtimeSrc.indexOf('confirmExperience')),
      /submitTask\(/,
    );
    assert.match(app, /res\.adoptRequested/);
    assert.match(app, /submitArtifactDecision\("accept", \{ forceAdopt: true \}\)/);
  });
});
