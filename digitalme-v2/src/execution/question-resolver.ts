/**
 * 执行器提问自动判答 — 每个原始 Job 最多自动续执行一次。
 */
import type { ExecutorTaskPackage } from './external-executor-contract';

export type QuestionResolution =
  | { kind: 'auto_answer'; answer: string; rationale: string }
  | { kind: 'ask_user'; reason: string };

const HIGH_RISK_RE =
  /扩大|范围外|删除仓库|git\s*push|push\s+origin|部署|发布|付款|依赖升级|upgrade\s+depend|architecture|架构取舍|改目标|重新定义目标|rm\s+-rf|delete\s+repo/i;

export function resolveExecutorQuestion(
  question: string,
  pkg: ExecutorTaskPackage,
): QuestionResolution {
  const q = String(question || '').trim();
  if (!q) {
    return { kind: 'ask_user', reason: '问题为空' };
  }

  // 可安全回答：重申已冻结边界（先于高风险启发式，避免「能否 push」被误升级）
  if (/能否|可以|允许|permission|scope|范围|commit|push/i.test(q)) {
    if (/commit|push|pr\b|deploy|发布/i.test(q) && !/扩大|范围外|仓库外/i.test(q)) {
      return {
        kind: 'auto_answer',
        answer:
          '不允许 commit、push、创建远程合并请求或部署。请只在工作区保留文件改动并结束。',
        rationale: '任务包已冻结禁止 git_commit / git_push / deploy',
      };
    }
    if (/范围|scope|哪些文件|which files/i.test(q) && !/扩大|范围外|仓库外/i.test(q)) {
      return {
        kind: 'auto_answer',
        answer: `请严格限制在以下可写范围：${pkg.writeScope.join(', ')}。不要修改范围外文件。`,
        rationale: '复述用户已确认的写范围',
      };
    }
  }

  if (HIGH_RISK_RE.test(q)) {
    return {
      kind: 'ask_user',
      reason: '涉及目标变化、扩大范围、删除、依赖升级或高风险操作，需由你确认',
    };
  }

  // 复述目标与验收
  if (/目标是什么|acceptance|验收|要做什么/i.test(q)) {
    return {
      kind: 'auto_answer',
      answer: [
        `目标：${pkg.goal}`,
        `验收：${pkg.acceptanceCriteria.join('；')}`,
        `不做：${pkg.doNotDo.slice(0, 3).join('；')}`,
      ].join('\n'),
      rationale: '复述执行前已冻结的目标与验收条件',
    };
  }

  // 默认：无法从已确认边界安全回答 → 问用户
  return {
    kind: 'ask_user',
    reason: '该问题无法仅凭已确认目标与边界安全自动回答',
  };
}

export function buildAutoContinueRevisionRequest(
  questions: Array<{ text: string; answer: string; rationale: string }>,
): string {
  const parts = questions.map(
    (q, i) =>
      `问题${i + 1}：${q.text}\n已根据既有边界自动回答（依据：${q.rationale}）：${q.answer}`,
  );
  return [
    '请根据以下自动答复继续完成任务，不要再次提出相同问题，不要扩大范围：',
    ...parts,
  ].join('\n\n');
}
