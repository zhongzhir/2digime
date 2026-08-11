/** D11-C 真实风格验收样本；仅供离线/真实模型评测，不含提示词或模型输出。 */
import type { AiCtoDecision } from './ai-cto-review';

export interface AiCtoReviewEvalCase {
  id: string;
  goal: string;
  overall: 'satisfied' | 'partially_satisfied' | 'unsatisfied' | 'unverifiable';
  changedFiles: number;
  checks: Array<{ id: string; verdict: 'satisfied' | 'unsatisfied' | 'unverifiable' }>;
  expected: AiCtoDecision;
  criticalMissing?: boolean;
}

const good = [
  { id: 'file_changes', verdict: 'satisfied' as const },
  { id: 'scope_boundary', verdict: 'satisfied' as const },
  { id: 'git_integrity', verdict: 'satisfied' as const },
  { id: 'build_check', verdict: 'satisfied' as const },
  { id: 'tests_passed', verdict: 'satisfied' as const },
  { id: 'run_startup_check', verdict: 'satisfied' as const },
];
const partial = [
  { id: 'file_changes', verdict: 'satisfied' as const },
  { id: 'scope_boundary', verdict: 'satisfied' as const },
  { id: 'git_integrity', verdict: 'satisfied' as const },
  { id: 'build_check', verdict: 'satisfied' as const },
  { id: 'tests_passed', verdict: 'unverifiable' as const },
];
const failed = [
  { id: 'file_changes', verdict: 'satisfied' as const },
  { id: 'scope_boundary', verdict: 'satisfied' as const },
  { id: 'git_integrity', verdict: 'satisfied' as const },
  { id: 'build_check', verdict: 'unsatisfied' as const },
];
const blocked = [
  { id: 'file_changes', verdict: 'satisfied' as const },
  { id: 'scope_boundary', verdict: 'unsatisfied' as const },
  { id: 'git_integrity', verdict: 'satisfied' as const },
];

export const AI_CTO_REVIEW_EVAL_MIN_CASES = 40;
export const AI_CTO_REVIEW_EVAL_MIN_AGREEMENT = 0.9;
export const AI_CTO_REVIEW_EVAL_CASES: AiCtoReviewEvalCase[] = [
  ['登录页修复后可正常构建', 'satisfied', 3, good, 'meets_plan'],
  ['补齐订单导出功能并通过测试', 'satisfied', 5, good, 'meets_plan'],
  ['优化首页布局且没有越界修改', 'satisfied', 4, good, 'meets_plan'],
  ['修复搜索结果为空的问题', 'satisfied', 2, good, 'meets_plan'],
  ['新增表单校验并验证', 'satisfied', 3, good, 'meets_plan'],
  ['改正日期显示格式', 'satisfied', 1, good, 'meets_plan'],
  ['完成列表筛选并通过构建', 'satisfied', 4, good, 'meets_plan'],
  ['修复移动端导航', 'satisfied', 3, good, 'meets_plan'],
  ['增加空状态提示', 'satisfied', 2, good, 'meets_plan'],
  ['完善文件上传错误处理', 'satisfied', 4, good, 'meets_plan'],
  ['实现主题切换', 'satisfied', 6, good, 'meets_plan'],
  ['修复支付页金额显示', 'satisfied', 2, good, 'meets_plan'],
  ['补充账户设置入口', 'satisfied', 4, good, 'meets_plan'],
  ['调整无障碍标签', 'satisfied', 3, good, 'meets_plan'],
  ['修复通知重复显示', 'satisfied', 2, good, 'meets_plan'],
  ['完善任务列表排序', 'satisfied', 3, good, 'meets_plan'],
  ['改进错误页文案', 'satisfied', 1, good, 'meets_plan'],
  ['更新个人资料保存流程', 'satisfied', 5, good, 'meets_plan'],
  ['修复构建失败', 'partially_satisfied', 2, failed, 'needs_revision'],
  ['测试失败后需要修复', 'unsatisfied', 3, failed, 'needs_revision'],
  ['补齐导出字段但尚未验证测试', 'partially_satisfied', 4, partial, 'needs_revision'],
  ['页面能打开但测试结果不明确', 'partially_satisfied', 3, partial, 'needs_revision'],
  ['完成主要样式但缺少回归验证', 'partially_satisfied', 5, partial, 'needs_revision'],
  ['修复接口但启动检查失败', 'unsatisfied', 2, failed, 'needs_revision'],
  ['完成一半筛选规则', 'partially_satisfied', 2, partial, 'needs_revision'],
  ['上传流程尚有错误', 'unsatisfied', 3, failed, 'needs_revision'],
  ['修改范围超出任务', 'unsatisfied', 4, blocked, 'blocked'],
  ['检测到未经授权的目录变动', 'unsatisfied', 2, blocked, 'blocked'],
  ['工作目录与成果不一致', 'unsatisfied', 3, blocked, 'blocked'],
  ['存在并发修改风险', 'unsatisfied', 2, [{ id: 'concurrent_edit', verdict: 'unsatisfied' }], 'blocked'],
  ['版本状态异常，需要人工处理', 'unsatisfied', 2, [{ id: 'git_integrity', verdict: 'unsatisfied' }], 'blocked'],
  ['没有文件变更可核对', 'unverifiable', 0, [{ id: 'file_changes', verdict: 'unsatisfied' }], 'blocked'],
  ['未提供构建和测试结果', 'unverifiable', 3, [{ id: 'file_changes', verdict: 'satisfied' }], 'insufficient_evidence', true],
  ['只提供执行者自述', 'unverifiable', 2, [], 'insufficient_evidence', true],
  ['目标未明确且没有验证信息', 'unverifiable', 1, [{ id: 'build_check', verdict: 'unverifiable' }], 'insufficient_evidence', true],
  ['修改清单缺失', 'unverifiable', 0, [], 'insufficient_evidence', true],
  ['无法确认是否运行成功', 'unverifiable', 2, [{ id: 'run_startup_check', verdict: 'unverifiable' }], 'insufficient_evidence', true],
  ['没有范围核对记录', 'unverifiable', 3, [{ id: 'build_check', verdict: 'satisfied' }], 'insufficient_evidence', true],
  ['仅有截图没有工程证据', 'unverifiable', 1, [], 'insufficient_evidence', true],
  ['测试未执行且构建未知', 'unverifiable', 2, [{ id: 'tests_passed', verdict: 'unverifiable' }], 'insufficient_evidence', true],
  ['执行者自述成功但独立检查失败', 'unsatisfied', 3, failed, 'needs_revision'],
  ['表面实现了导出但缺少结果文件', 'partially_satisfied', 2, partial, 'needs_revision'],
].map(([goal, overall, changedFiles, checks, expected, criticalMissing], index) => ({
  id: `cto-${String(index + 1).padStart(2, '0')}`,
  goal: goal as string,
  overall: overall as AiCtoReviewEvalCase['overall'],
  changedFiles: changedFiles as number,
  checks: checks as AiCtoReviewEvalCase['checks'],
  expected: expected as AiCtoDecision,
  ...(criticalMissing ? { criticalMissing: true } : {}),
}));
