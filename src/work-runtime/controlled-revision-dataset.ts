import type { ControlledRevisionEvidence, RevisionAttribution } from './controlled-revision';

export interface ControlledRevisionEvalCase {
  id: string;
  evidence: ControlledRevisionEvidence;
  expectedAttribution: RevisionAttribution;
  expectedAction: 'auto_revise' | 'pause' | 'await_user' | 'stop_success' | 'noop';
}

const needs = (message: string, plan = '修复相关实现并重新运行检查。'): ControlledRevisionEvidence => ({
  decision: 'needs_revision',
  revisionPlan: plan,
  failureMessage: message,
});

/** D11-D 金标集：归因与第一轮决策；连续失败情形由单测覆盖。 */
export const CONTROLLED_REVISION_EVAL_CASES: ControlledRevisionEvalCase[] = [
  { id: 'tool-01', evidence: needs('tool unavailable'), expectedAttribution: 'tool_unavailable', expectedAction: 'auto_revise' },
  { id: 'tool-02', evidence: needs('能力不可用'), expectedAttribution: 'tool_unavailable', expectedAction: 'auto_revise' },
  { id: 'path-01', evidence: needs('project invalid'), expectedAttribution: 'invalid_project_or_path', expectedAction: 'auto_revise' },
  { id: 'path-02', evidence: needs('目录不存在'), expectedAttribution: 'invalid_project_or_path', expectedAction: 'auto_revise' },
  { id: 'scope-01', evidence: needs('permission denied'), expectedAttribution: 'permission_or_scope', expectedAction: 'auto_revise' },
  { id: 'scope-02', evidence: needs('超出授权 scope'), expectedAttribution: 'permission_or_scope', expectedAction: 'auto_revise' },
  { id: 'env-01', evidence: needs('dependency missing'), expectedAttribution: 'dependency_or_environment', expectedAction: 'auto_revise' },
  { id: 'env-02', evidence: needs('环境变量缺失'), expectedAttribution: 'dependency_or_environment', expectedAction: 'auto_revise' },
  { id: 'impl-01', evidence: needs('implementation defect'), expectedAttribution: 'implementation_defect', expectedAction: 'auto_revise' },
  { id: 'impl-02', evidence: needs('存在 bug'), expectedAttribution: 'implementation_defect', expectedAction: 'auto_revise' },
  { id: 'test-01', evidence: needs('test failed'), expectedAttribution: 'test_or_build_failure', expectedAction: 'auto_revise' },
  { id: 'test-02', evidence: needs('编译失败'), expectedAttribution: 'test_or_build_failure', expectedAction: 'auto_revise' },
  { id: 'runtime-01', evidence: needs('runtime exception'), expectedAttribution: 'runtime_failure', expectedAction: 'auto_revise' },
  { id: 'runtime-02', evidence: needs('启动失败'), expectedAttribution: 'runtime_failure', expectedAction: 'auto_revise' },
  { id: 'evidence-01', evidence: { decision: 'insufficient_evidence' }, expectedAttribution: 'insufficient_evidence', expectedAction: 'pause' },
  { id: 'evidence-02', evidence: needs('缺少证据'), expectedAttribution: 'insufficient_evidence', expectedAction: 'auto_revise' },
  { id: 'goal-01', evidence: needs('需求歧义'), expectedAttribution: 'goal_ambiguity', expectedAction: 'auto_revise' },
  { id: 'goal-02', evidence: needs('需要 clarification'), expectedAttribution: 'goal_ambiguity', expectedAction: 'auto_revise' },
  { id: 'other-01', evidence: needs('未知异常描述'), expectedAttribution: 'other', expectedAction: 'auto_revise' },
  { id: 'other-02', evidence: needs('状态不一致'), expectedAttribution: 'other', expectedAction: 'auto_revise' },
  { id: 'success-01', evidence: { decision: 'meets_plan' }, expectedAttribution: 'other', expectedAction: 'stop_success' },
  { id: 'success-02', evidence: { decision: 'meets_plan', failureMessage: 'test failed' }, expectedAttribution: 'test_or_build_failure', expectedAction: 'stop_success' },
  { id: 'blocked-01', evidence: { decision: 'blocked', failureMessage: '权限不足' }, expectedAttribution: 'permission_or_scope', expectedAction: 'pause' },
  { id: 'blocked-02', evidence: { decision: 'blocked', failureMessage: '环境不可用' }, expectedAttribution: 'dependency_or_environment', expectedAction: 'pause' },
  { id: 'risk-01', evidence: needs('test failed', '删除整个项目后重建。'), expectedAttribution: 'test_or_build_failure', expectedAction: 'await_user' },
  { id: 'risk-02', evidence: needs('test failed', '使用 sudo 修复权限。'), expectedAttribution: 'test_or_build_failure', expectedAction: 'await_user' },
  { id: 'goal-change-01', evidence: needs('test failed', '修改任务目标并重写产品。'), expectedAttribution: 'test_or_build_failure', expectedAction: 'await_user' },
  { id: 'check-01', evidence: { decision: 'needs_revision', revisionPlan: '补充测试。', checks: [{ id: 'unit_test', verdict: 'unsatisfied', detail: 'test failed' }] }, expectedAttribution: 'test_or_build_failure', expectedAction: 'auto_revise' },
  { id: 'check-02', evidence: { decision: 'needs_revision', revisionPlan: '修复启动配置。', checks: [{ id: 'run_startup_check', verdict: 'unsatisfied', detail: 'runtime timeout' }] }, expectedAttribution: 'runtime_failure', expectedAction: 'auto_revise' },
  { id: 'check-03', evidence: { decision: 'needs_revision', revisionPlan: '补充实现。', checks: [{ id: 'contract', verdict: 'unsatisfied', detail: 'implementation defect' }] }, expectedAttribution: 'implementation_defect', expectedAction: 'auto_revise' },
];

export const CONTROLLED_REVISION_EVAL_MIN_CASES = 30;
