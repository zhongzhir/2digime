/**
 * P0.1 契约冒烟:状态派生(无 Task 指针)、Job 转移守卫、幂等提交与崩溃恢复、
 * 成长闭环(candidate→confirmed→视图)、Grant 泛化、Adapter 白名单、命令面上限。
 * 运行:npm run verify
 */
import { newId, nowIso } from './shared/ids';
import { deriveConfirmedExperience } from './subject-core/derived-views';
import { confirmCandidate, type GrowthEvent } from './subject-core/growth-event';
import {
  canTransition,
  recoverJobOnStartup,
  transitionJob,
  type ExecutionJob,
} from './work-runtime/execution-job';
import { artifactIdForJob } from './work-runtime/artifact';
import { deriveTaskState, latestJob, toUserFacingLabel } from './work-runtime/derive';
import type { Task } from './work-runtime/task';
import { CapabilityRegistry } from './capability/registry';
import type { CapabilityAdapter } from './capability/adapter';
import type { CapabilityRegistration } from './capability/registration';
import { grantCapabilityPermissions, simulateInteraction } from './collaboration/local-simulation';
import { COMMAND_NAMES, COMMAND_COUNT_LIMIT } from './runtime/commands';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const okay = JSON.stringify(actual) === JSON.stringify(expected);
  if (!okay) {
    failures += 1;
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
function checkThrows(name: string, fn: () => unknown): void {
  try {
    fn();
    failures += 1;
    console.error(`FAIL ${name}: expected throw`);
  } catch {
    console.log(`ok   ${name}`);
  }
}

const at = nowIso();
const subjectId = newId('subject');

// --- Task 是纯意图对象(无 jobIds/activeJobId/artifactIds;编译期即约束)---
const task: Task = {
  id: newId('task'),
  subjectId,
  createdAt: at,
  goal: '整理一份材料摘要',
  contextRefs: [{ kind: 'file', path: 'C:/tmp/material.docx' }],
  requestedArtifactType: 'document',
};
check('Task 无状态与指针字段', 'status' in task || 'jobIds' in task || 'activeJobId' in task, false);

// --- Job 五态与转移守卫 ---
function makeJob(createdAt: string): ExecutionJob {
  return {
    id: newId('job'),
    taskId: task.id,
    capabilityId: newId('capability'),
    createdAt,
    status: 'queued',
  };
}
check('queued→running 合法', canTransition('queued', 'running'), true);
check('queued→succeeded 非法', canTransition('queued', 'succeeded'), false);
check('终态 succeeded 不可迁移', canTransition('succeeded', 'failed'), false);

let job1 = makeJob('2026-08-02T10:00:00.000Z');
job1 = transitionJob(job1, 'running', at);
job1 = transitionJob(job1, 'failed', at);
checkThrows('非法迁移被拒绝', () => transitionJob(job1, 'running', at));

// --- 派生状态:重试后以最新 Job 为准(Task 不持有指针)---
let job2: ExecutionJob = { ...makeJob('2026-08-02T11:00:00.000Z'), snapshotId: newId('snapshot') };
job2 = transitionJob(job2, 'running', at);
job2 = { ...transitionJob(job2, 'succeeded', at), artifactId: artifactIdForJob(job2.id) };
const jobsForTask = [job2, job1]; // 无序输入
check('latestJob 选取最新', latestJob(jobsForTask)?.id, job2.id);
check('重试后派生 completed', deriveTaskState(jobsForTask), 'completed');
check('仅失败 Job 时 attention', deriveTaskState([job1]), 'attention');
check('无 Job 时 waiting', deriveTaskState([]), 'waiting');
check('用户面文案', toUserFacingLabel('completed'), '已完成');

// --- 幂等提交与崩溃恢复协议 ---
check('Artifact id 由 jobId 确定性派生', artifactIdForJob(job2.id), artifactIdForJob(job2.id));
const crashRunning = transitionJob(makeJob(at), 'running', at);
check('恢复:running+已有 Artifact → 补交', recoverJobOnStartup(crashRunning, true), 'commit_succeeded');
check('恢复:running 无 Artifact → failed', recoverJobOnStartup(crashRunning, false), 'mark_failed');
check('恢复:queued → 重新入队', recoverJobOnStartup(makeJob(at), false), 'requeue');
check('恢复:succeeded+有 Artifact → 不动作', recoverJobOnStartup(job2, true), 'none');
check('恢复:succeeded 无 Artifact → failed', recoverJobOnStartup(job2, false), 'mark_failed');
const cancelledJob: ExecutionJob = {
  ...makeJob(at),
  status: 'cancelled',
  finishedAt: at,
};
check('恢复:cancelled → 不动作', recoverJobOnStartup(cancelledJob, false), 'none');

// --- 成长闭环:具体修改 → candidate → confirmed → 视图复用 ---
const candidate: GrowthEvent = {
  id: newId('growthEvent'),
  subjectId,
  occurredAt: at,
  type: 'feedback_recorded',
  source: { kind: 'artifact_edit', taskId: task.id, artifactId: artifactIdForJob(job2.id) },
  payload: {
    title: '摘要偏好',
    detail: '结论先行',
    evidence: { artifactId: artifactIdForJob(job2.id), toVersionId: newId('artifactVersion') },
  },
  confidence: 'candidate',
};
const viewBefore = deriveConfirmedExperience(subjectId, [candidate], at);
check('candidate 不进入视图', viewBefore.entries.length, 0);
const confirmed = confirmCandidate(candidate, newId('growthEvent'), at);
check('确认事件指回 candidate', confirmed.confirms, candidate.id);
check('确认保留精确锚点', confirmed.payload.evidence?.artifactId, artifactIdForJob(job2.id));
const viewAfter = deriveConfirmedExperience(subjectId, [candidate, confirmed], at);
check('confirmed 进入视图', viewAfter.entries.length, 1);
check('视图条目标题', viewAfter.entries[0]?.title, '摘要偏好');
checkThrows('重复确认被拒绝', () => confirmCandidate(confirmed, newId('growthEvent'), at));

// --- Grant 泛化:remote-subject 与 capability 共用;origin 内嵌快照 ---
const sim = simulateInteraction({
  grantor: { subjectId, displayName: '我', scheme: 'local' },
  granteeName: '模拟协作者',
  scope: { actions: ['read_artifact'] },
  goal: '本地模拟协作请求',
});
check('模拟请求为本地模式', sim.request.mode, 'local_simulation');
check('协作授权 grantee 类型', sim.grant.grantee.kind, 'remote_subject');
check(
  'origin 内嵌请求快照(无悬空引用)',
  sim.grant.origin.kind === 'interaction_request' && sim.grant.origin.requestSummary.goal,
  '本地模拟协作请求',
);
const capGrant = grantCapabilityPermissions({
  grantorSubjectId: subjectId,
  capabilityId: newId('capability'),
  scope: { actions: ['network', 'secret_access'] },
});
check('能力授权 grantee 类型', capGrant.grantee.kind, 'capability');
check('能力授权来源 owner_direct', capGrant.origin.kind, 'owner_direct');

// --- Adapter 白名单 ---
function makeAdapter(reg: CapabilityRegistration): CapabilityAdapter {
  return {
    registration: reg,
    execute: async () => ({
      artifact: { type: 'document', title: 't', payload: { kind: 'text', format: 'markdown', text: '# t' } },
    }),
  };
}
const goodReg: CapabilityRegistration = {
  id: newId('capability'),
  kind: 'model',
  displayName: '应用内模型',
  description: '按任务目标与材料生成文档',
  inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
  outputArtifactTypes: ['document'],
  permissions: ['network', 'secret_access'],
  cost: { estimate: '按 token 计' },
  latencyEstimate: '数十秒',
  location: 'remote',
  availability: 'available',
  adapter: { type: 'openai-compatible-model', adapterId: 'default' },
};
const registry = new CapabilityRegistry();
registry.register(makeAdapter(goodReg));
check('白名单类型注册成功', registry.list().length, 1);
check('按类型选择能力', registry.selectFor('document')?.registration.id, goodReg.id);
const badReg = {
  ...goodReg,
  id: newId('capability'),
  adapter: { type: 'arbitrary-module-path' as never, adapterId: 'x' },
};
checkThrows('非白名单 adapter 类型被拒绝', () => registry.register(makeAdapter(badReg)));

// --- 命令面上限 ---
check('命令数 ≤ 上限', COMMAND_NAMES.length <= COMMAND_COUNT_LIMIT, true);
check('命令面当前条数', COMMAND_NAMES.length, 20);

if (failures > 0) {
  console.error(`\nsmoke FAILED: ${failures} checks`);
  process.exit(1);
}
console.log(`\nsmoke passed: all checks green`);
