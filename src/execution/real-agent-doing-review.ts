/**
 * REAL-AGENT-DOING-01 — 2digime 独立验收（不采信 Agent 自评）。
 * 依据：git diff、变更文件、独立测试退出码、公共 API、范围。
 */
export type RealAgentDoingVerdict = 'accepted' | 'cto_review_rejected';

export interface RealAgentDoingReviewInput {
  goal: string;
  changedFiles: string[];
  gitDiff: string;
  independentTestExitCode: number;
  independentTestOutput: string;
  publicApiIntact: boolean;
  sourceModuleStillExports: string[];
  /** 默认 REAL-AGENT-DOING-01 的 format 模块；第二 Agent 库存任务传入 inventory。 */
  sourceFile?: string;
  testFile?: string;
  allowedRel?: string[];
}

export interface RealAgentDoingReview {
  verdict: RealAgentDoingVerdict;
  reasons: string[];
  nextStep?: string;
  sourceChanged: boolean;
  testsOnlyChanged: boolean;
  unrelatedChanges: string[];
}

const DEFAULT_SOURCE_FILE = 'src/format.js';
const DEFAULT_TEST_FILE = 'test/format.test.js';
const DEFAULT_ALLOWED_REL = ['src/format.js', 'test/format.test.js'];

function normalizeRel(p: string): string {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

export function assessRealAgentDoing(input: RealAgentDoingReviewInput): RealAgentDoingReview {
  const sourceFile = input.sourceFile || DEFAULT_SOURCE_FILE;
  const testFile = input.testFile || DEFAULT_TEST_FILE;
  const allowedRel = new Set(input.allowedRel?.length ? input.allowedRel : DEFAULT_ALLOWED_REL);
  const changed = [...new Set(input.changedFiles.map(normalizeRel).filter(Boolean))];
  const sourceChanged = changed.includes(sourceFile);
  const testChanged = changed.includes(testFile);
  const unrelatedChanges = changed.filter((f) => !allowedRel.has(f) && !f.startsWith('node_modules/'));
  const testsOnlyChanged = testChanged && !sourceChanged;
  const reasons: string[] = [];

  if (!sourceChanged) {
    reasons.push('源码未被修改，问题未真正修复。');
  }
  if (testsOnlyChanged) {
    reasons.push('只改了测试，不能视为修复。');
  }
  if (input.independentTestExitCode !== 0) {
    reasons.push('独立复跑测试未通过。');
  }
  if (!input.publicApiIntact) {
    reasons.push('公共 API 已改变。');
  }
  for (const name of input.sourceModuleStillExports) {
    if (!input.publicApiIntact) break;
    void name;
  }
  if (unrelatedChanges.length) {
    reasons.push(`存在与目标无关的修改：${unrelatedChanges.slice(0, 8).join(', ')}`);
  }
  if (!input.gitDiff.trim() && !sourceChanged) {
    reasons.push('没有可核对的 git diff。');
  }

  if (reasons.length) {
    return {
      verdict: 'cto_review_rejected',
      reasons,
      nextStep: '请根据上述依据修正后，由用户再次确认同一目标；系统不会自动再派一次代码修改任务。',
      sourceChanged,
      testsOnlyChanged,
      unrelatedChanges,
    };
  }
  return {
    verdict: 'accepted',
    reasons: ['独立核对：源码已改、测试通过、公共 API 保持、改动未超出目标。'],
    sourceChanged,
    testsOnlyChanged,
    unrelatedChanges,
  };
}

export function userFacingDoingResult(review: RealAgentDoingReview): string {
  if (review.verdict === 'accepted') {
    return '已经完成修改并检查通过。';
  }
  return '这次修改没有通过检查，不会自动再试。';
}
