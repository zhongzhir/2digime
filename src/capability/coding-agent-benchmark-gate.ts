/**
 * SLICE-2C-CODING-BENCHMARK-01
 *
 * 固定 Coding Agent 对照门。这里只定义任务覆盖、评分合同和 fail-closed 判定，
 * 不调用任何 Agent，也不把合成记录写成真实能力结论。
 */
import { readFileSync } from 'node:fs';

export const CODING_PROJECT_CLASSES = ['web', 'desktop', 'backend', 'dirty_worktree'] as const;
export type CodingProjectClass = (typeof CODING_PROJECT_CLASSES)[number];

export const CODING_SCORE_DIMENSIONS = [
  'taskUnderstanding',
  'changeCorrectness',
  'verification',
  'scopeSafety',
  'failureRecovery',
  'talkReceipt',
] as const;
export type CodingScoreDimension = (typeof CODING_SCORE_DIMENSIONS)[number];

export const CODING_SCORE_WEIGHTS: Readonly<Record<CodingScoreDimension, number>> = {
  taskUnderstanding: 15,
  changeCorrectness: 30,
  verification: 20,
  scopeSafety: 15,
  failureRecovery: 10,
  talkReceipt: 10,
};

export interface CodingBenchmarkTask {
  taskId: string;
  projectClass: CodingProjectClass;
  weight: number;
  goal: string;
  projectRequirements: string[];
  preRegisteredVerification: string[];
  dirtyWorktreeRules: string[];
  maxConfirmationCount: 1;
}

export type CodingBenchmarkArm = 'leading_agent_direct' | '2digime_orchestrated';

export interface CodingBenchmarkRun {
  taskId: string;
  arm: CodingBenchmarkArm;
  realRun: boolean;
  projectRevision: string;
  scores: Record<CodingScoreDimension, number>;
  hardFailures: Array<'false_completion' | 'out_of_scope_write' | 'preexisting_change_lost'>;
  endToEndEffectVerified: boolean;
}

export type CodingBenchmarkVerdict =
  | 'protocol_ready'
  | 'real_runs_incomplete'
  | 'coverage_incomplete'
  | 'hard_failure'
  | 'below_95_percent'
  | 'developer_threshold_met_owner_pending';

export interface CodingBenchmarkResult {
  verdict: CodingBenchmarkVerdict;
  relativePercent: number | null;
  directWeightedScore: number | null;
  orchestratedWeightedScore: number | null;
  missingProjectClasses: CodingProjectClass[];
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function nonEmptyStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

export function validateCodingBenchmarkTasks(input: unknown): CodingBenchmarkTask[] {
  if (!Array.isArray(input)) throw new Error('coding benchmark tasks must be an array');
  const ids = new Set<string>();
  const classes = new Set<CodingProjectClass>();
  let totalWeight = 0;

  for (const raw of input) {
    if (!isRecord(raw)) throw new Error('coding benchmark task must be an object');
    const taskId = nonEmptyString(raw.taskId, 'taskId');
    if (ids.has(taskId)) throw new Error(`duplicate coding benchmark task: ${taskId}`);
    ids.add(taskId);
    const projectClass = nonEmptyString(raw.projectClass, 'projectClass');
    if (!(CODING_PROJECT_CLASSES as readonly string[]).includes(projectClass)) {
      throw new Error(`unknown coding project class: ${projectClass}`);
    }
    classes.add(projectClass as CodingProjectClass);
    if (typeof raw.weight !== 'number' || !Number.isFinite(raw.weight) || raw.weight <= 0) {
      throw new Error(`weight must be positive: ${taskId}`);
    }
    totalWeight += raw.weight;
    nonEmptyString(raw.goal, 'goal');
    nonEmptyStringArray(raw.projectRequirements, 'projectRequirements');
    nonEmptyStringArray(raw.preRegisteredVerification, 'preRegisteredVerification');
    nonEmptyStringArray(raw.dirtyWorktreeRules, 'dirtyWorktreeRules');
    if (raw.maxConfirmationCount !== 1) throw new Error(`maxConfirmationCount must equal 1: ${taskId}`);
  }

  const missing = CODING_PROJECT_CLASSES.filter((item) => !classes.has(item));
  if (missing.length) throw new Error(`missing coding project classes: ${missing.join(',')}`);
  if (Math.abs(totalWeight - 100) > 0.0001) throw new Error(`coding task weights must total 100, got ${totalWeight}`);
  return input as CodingBenchmarkTask[];
}

export function loadCodingBenchmarkTasks(filePath: string): CodingBenchmarkTask[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const tasks = isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : parsed;
  return validateCodingBenchmarkTasks(tasks);
}

export function scoreCodingRun(run: CodingBenchmarkRun): number {
  if (run.hardFailures.length) return 0;
  let score = 0;
  for (const dimension of CODING_SCORE_DIMENSIONS) {
    const value = run.scores[dimension];
    if (!Number.isFinite(value) || value < 0 || value > 5) {
      throw new Error(`${run.taskId}/${run.arm}/${dimension} score must be between 0 and 5`);
    }
    score += (value / 5) * CODING_SCORE_WEIGHTS[dimension];
  }
  return score;
}

export function evaluateCodingBenchmark(
  tasks: readonly CodingBenchmarkTask[],
  runs: readonly CodingBenchmarkRun[],
  options: { protocolOnly?: boolean } = {},
): CodingBenchmarkResult {
  validateCodingBenchmarkTasks(tasks);
  if (options.protocolOnly) {
    return {
      verdict: 'protocol_ready',
      relativePercent: null,
      directWeightedScore: null,
      orchestratedWeightedScore: null,
      missingProjectClasses: [],
      reasons: ['仅完成评分合同和任务覆盖自检，未运行真实 Agent'],
    };
  }

  const missingProjectClasses = CODING_PROJECT_CLASSES.filter((projectClass) => {
    const classTaskIds = new Set(tasks.filter((task) => task.projectClass === projectClass).map((task) => task.taskId));
    return ![...classTaskIds].some((taskId) =>
      runs.some((run) => run.taskId === taskId && run.realRun),
    );
  });
  if (missingProjectClasses.length) {
    return emptyResult('coverage_incomplete', missingProjectClasses, ['四类项目真实覆盖不完整']);
  }

  const byKey = new Map(runs.map((run) => [`${run.taskId}:${run.arm}`, run]));
  const missingRuns = tasks.flatMap((task) =>
    (['leading_agent_direct', '2digime_orchestrated'] as const)
      .filter((arm) => !byKey.get(`${task.taskId}:${arm}`)?.realRun)
      .map((arm) => `${task.taskId}:${arm}`),
  );
  if (missingRuns.length) {
    return emptyResult('real_runs_incomplete', [], [`缺少真实对照运行：${missingRuns.join(', ')}`]);
  }

  const hardFailures = runs.filter((run) => run.hardFailures.length);
  if (hardFailures.length) {
    return emptyResult(
      'hard_failure',
      [],
      hardFailures.map((run) => `${run.taskId}:${run.arm}:${run.hardFailures.join('+')}`),
    );
  }

  let directWeightedScore = 0;
  let orchestratedWeightedScore = 0;
  for (const task of tasks) {
    const direct = byKey.get(`${task.taskId}:leading_agent_direct`)!;
    const orchestrated = byKey.get(`${task.taskId}:2digime_orchestrated`)!;
    directWeightedScore += scoreCodingRun(direct) * (task.weight / 100);
    orchestratedWeightedScore += scoreCodingRun(orchestrated) * (task.weight / 100);
  }
  const relativePercent = directWeightedScore > 0
    ? (orchestratedWeightedScore / directWeightedScore) * 100
    : null;
  const hasEndToEnd = runs.some(
    (run) => run.arm === '2digime_orchestrated' && run.realRun && run.endToEndEffectVerified,
  );
  if (!hasEndToEnd) {
    return {
      verdict: 'real_runs_incomplete',
      relativePercent,
      directWeightedScore,
      orchestratedWeightedScore,
      missingProjectClasses: [],
      reasons: ['尚无 2digime 端到端真实修改及可核验效果'],
    };
  }
  const verdict: CodingBenchmarkVerdict = relativePercent !== null && relativePercent >= 95
    ? 'developer_threshold_met_owner_pending'
    : 'below_95_percent';
  return {
    verdict,
    relativePercent,
    directWeightedScore,
    orchestratedWeightedScore,
    missingProjectClasses: [],
    reasons: verdict === 'developer_threshold_met_owner_pending'
      ? ['开发对照阈值达到，仍需 Owner 产品验收']
      : ['相对选定领先 Agent 的加权得分未达到 95%'],
  };
}

function emptyResult(
  verdict: CodingBenchmarkVerdict,
  missingProjectClasses: CodingProjectClass[],
  reasons: string[],
): CodingBenchmarkResult {
  return {
    verdict,
    relativePercent: null,
    directWeightedScore: null,
    orchestratedWeightedScore: null,
    missingProjectClasses,
    reasons,
  };
}
