/**
 * 按成果合同分派的 Outcome Check。
 * 无适用检查器时显式 not_applicable，不得默默套用文本检查。
 */
import type { CapabilityOutput } from '../capability/adapter';
import {
  checkOutcome,
  chooseExecutionProfile,
  type OutcomeCheckResult,
  type OutcomeVerdict,
} from './ai-first-policy';
import {
  CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
  CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
  CODE_BUNDLE_ROLES,
} from '../capability/adapters/code-repo-analysis-contract';
import { CODE_CHANGE_BUNDLE_ROLES } from '../execution/external-executor-contract';

export type OutcomeCheckKind = 'text' | 'bundle' | 'external' | 'not_applicable';

export interface DispatchedOutcomeResult extends OutcomeCheckResult {
  checkKind: OutcomeCheckKind;
}

export function capabilityOutputText(output: CapabilityOutput): string | null {
  const payload = output.artifact?.payload;
  if (payload && payload.kind === 'text') return payload.text;
  return null;
}

export function dispatchOutcomeCheck(input: {
  goal: string;
  output: CapabilityOutput;
  isRemote?: boolean;
  hardBoundaryTexts?: string[];
  previousText?: string;
  revisionRequest?: string;
  requestedArtifactType?: string;
}): DispatchedOutcomeResult {
  const payload = input.output.artifact?.payload;
  const profile = chooseExecutionProfile({
    goal: input.goal,
    ...(input.requestedArtifactType
      ? { requestedArtifactType: input.requestedArtifactType }
      : {}),
  });

  if (!payload) {
    return {
      checkKind: 'not_applicable',
      verdict: 'pass',
      defects: [],
      profile,
    };
  }

  if (payload.kind === 'text') {
    const base = checkOutcome({
      goal: input.goal,
      text: payload.text,
      profile,
      ...(input.hardBoundaryTexts ? { hardBoundaryTexts: input.hardBoundaryTexts } : {}),
      ...(input.previousText ? { previousText: input.previousText } : {}),
      ...(input.revisionRequest ? { revisionRequest: input.revisionRequest } : {}),
    });
    return { ...base, checkKind: 'text' };
  }

  if (payload.kind === 'bundle') {
    const roles = new Set(
      payload.entries.map((e) => String(e.role || '').toLowerCase()).filter(Boolean),
    );
    const isCodeChange = CODE_CHANGE_BUNDLE_ROLES.every((r) => roles.has(r));
    if (isCodeChange || input.requestedArtifactType === 'code-change') {
      return {
        ...checkCodeChangeBundleOutcome(payload.entries),
        profile,
        checkKind: 'bundle',
      };
    }
    return {
      ...checkBundleOutcome(payload.entries),
      profile,
      checkKind: 'bundle',
    };
  }

  if (payload.kind === 'file') {
    return {
      checkKind: 'not_applicable',
      verdict: 'pass',
      defects: [],
      profile,
    };
  }

  if (input.isRemote) {
    const meta = input.output.candidateMeta;
    const defects: string[] = [];
    if (!input.output.artifact?.type) defects.push('外部结果缺少成果类型。');
    if (meta && meta.contentDigest === '') defects.push('外部结果缺少内容摘要。');
    const verdict: OutcomeVerdict = defects.length ? 'blocked' : 'pass';
    return { checkKind: 'external', verdict, defects, profile };
  }

  return {
    checkKind: 'not_applicable',
    verdict: 'pass',
    defects: [],
    profile,
  };
}

export function checkBundleOutcome(
  entries: Array<{ role?: string; mediaType?: string; sourcePath?: string }>,
): { verdict: OutcomeVerdict; defects: string[] } {
  const defects: string[] = [];
  const roles = new Set(
    entries.map((e) => String(e.role || '').toLowerCase()).filter(Boolean),
  );
  for (const required of CODE_BUNDLE_ROLES) {
    if (!roles.has(required)) {
      defects.push(`成果包缺少「${required}」部分，无法作为完整分析结果。`);
    }
  }
  if (entries.length < 3) {
    defects.push('成果包条目不完整。');
  }
  // 角色齐备即通过结构检查；schema 细校验在 adapter 侧已做，此处不读盘
  void CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION;
  void CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION;

  if (defects.length > 0) {
    return { verdict: 'blocked', defects };
  }
  return { verdict: 'pass', defects: [] };
}

export function checkCodeChangeBundleOutcome(
  entries: Array<{ role?: string; mediaType?: string; sourcePath?: string }>,
): { verdict: OutcomeVerdict; defects: string[] } {
  const defects: string[] = [];
  const roles = new Set(
    entries.map((e) => String(e.role || '').toLowerCase()).filter(Boolean),
  );
  for (const required of CODE_CHANGE_BUNDLE_ROLES) {
    if (!roles.has(required)) {
      defects.push(`成果包缺少「${required}」部分，无法作为完整代码修改结果。`);
    }
  }
  if (defects.length > 0) {
    return { verdict: 'blocked', defects };
  }
  return { verdict: 'pass', defects: [] };
}
