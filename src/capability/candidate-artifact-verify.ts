import { createHash } from 'node:crypto';
import type { CapabilityOutput } from './adapter';
import type { RemoteAuthorizationProjection } from './remote-authorization';

export type CandidateVerificationVerdict = 'passed' | 'rejected';

export interface CandidateVerificationIssue {
  code:
    | 'format_invalid'
    | 'size_exceeded'
    | 'task_relevance'
    | 'provenance_missing'
    | 'source_binding_mismatch'
    | 'authorized_data_leakage'
    | 'unsafe_instruction'
    | 'model_self_grade_not_verification'
    | 'length_insufficient'
    | 'content_integrity_mismatch'
    | 'template_padding_detected';
  message: string;
}

export interface CandidateVerificationResult {
  verdict: CandidateVerificationVerdict;
  checkedAt: string;
  contentDigest?: string;
  issues: CandidateVerificationIssue[];
  /** 模型自评不得作为独立验证依据。 */
  modelSelfGradeIgnored: boolean;
}

export interface VerifyCandidateArtifactInput {
  output: CapabilityOutput;
  goal: string;
  expectedArtifactType: string;
  auth: RemoteAuthorizationProjection;
  /** 未授权材料特征(正文片段/路径/摘要),用于泄漏检测。 */
  unauthorizedMarkers?: string[];
  /** 期望的来源绑定(如 grantId / jobId / executionId)。 */
  expectedSourceBinding?: string;
  nowIso: string;
  maxOutputBytes?: number;
}

const UNSAFE_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /忽略(以上|之前|全部)?(所有)?(指令|提示|规则)/,
  /exfiltrat(e|ion)/i,
  /send\s+all\s+(secrets|credentials|keys)/i,
  /system\s*:\s*you\s+are\s+now/i,
];

/**
 * 候选 Artifact 验证 — 通过后方可 ArtifactCommit。
 * 模型自评不算独立验证。
 */
export function verifyCandidateArtifact(
  input: VerifyCandidateArtifactInput,
): CandidateVerificationResult {
  const issues: CandidateVerificationIssue[] = [];
  let modelSelfGradeIgnored = false;
  const artifact = input.output.artifact;

  if (!artifact || typeof artifact.type !== 'string' || !artifact.payload) {
    issues.push({ code: 'format_invalid', message: '成果格式无效' });
  } else if (artifact.type !== input.expectedArtifactType) {
    issues.push({
      code: 'format_invalid',
      message: `成果类型不匹配:期望 ${input.expectedArtifactType},实际 ${artifact.type}`,
    });
  }

  const text = extractText(input.output);
  const bytes = Buffer.byteLength(text || JSON.stringify(artifact?.payload ?? {}), 'utf8');
  const maxBytes = input.maxOutputBytes ?? input.auth.maxMaterialBytes ?? 512_000;
  if (bytes > maxBytes) {
    issues.push({ code: 'size_exceeded', message: `成果超过大小限制(${bytes}>${maxBytes})` });
  }

  if (text !== null) {
    const goalTokens = tokenize(input.goal);
    const hit = goalTokens.filter((t) => text.toLowerCase().includes(t)).length;
    if (goalTokens.length > 0 && hit === 0 && text.length > 0) {
      issues.push({ code: 'task_relevance', message: '成果与任务目标缺乏可核对相关性' });
    }
    for (const re of UNSAFE_PATTERNS) {
      if (re.test(text)) {
        issues.push({ code: 'unsafe_instruction', message: '成果包含不安全指令特征' });
        break;
      }
    }
    for (const marker of input.unauthorizedMarkers ?? []) {
      const m = String(marker || '').trim();
      if (m.length >= 6 && text.includes(m)) {
        issues.push({
          code: 'authorized_data_leakage',
          message: '成果包含未授权材料特征',
        });
        break;
      }
    }
    if (/自[我评]分|self[-_]?grade|quality\s*:\s*(a\+|100|perfect)/i.test(text)) {
      modelSelfGradeIgnored = true;
      // 不单独据此通过或失败;仅标记忽略。
    }
  } else if (artifact?.payload.kind === 'file' || artifact?.payload.kind === 'bundle') {
    // file/bundle:格式层已检查;相关性由 title/type 弱约束
    if (!artifact.title || artifact.title.trim().length === 0) {
      issues.push({ code: 'format_invalid', message: '成果缺少标题' });
    }
  } else {
    issues.push({ code: 'format_invalid', message: '无法解析成果正文' });
  }

  const provenance = input.output.candidateMeta?.provenance;
  if (!provenance) {
    issues.push({ code: 'provenance_missing', message: '缺少成果来源证明' });
  }

  const binding = input.output.candidateMeta?.sourceBinding;
  if (input.expectedSourceBinding) {
    if (!binding || binding !== input.expectedSourceBinding) {
      issues.push({
        code: 'source_binding_mismatch',
        message: '成果来源绑定与执行上下文不一致',
      });
    }
  }

  const integrity = input.output.candidateMeta?.contentIntegrity;
  if (integrity) {
    if (integrity.insufficientLength) {
      issues.push({
        code: 'length_insufficient',
        message: '模型原文篇幅不足且修订后仍不满足要求',
      });
    }
    const expectedDigest = sha256(integrity.modelGeneratedContent || '');
    if (
      integrity.modelContentDigest &&
      integrity.modelContentDigest !== expectedDigest
    ) {
      issues.push({
        code: 'content_integrity_mismatch',
        message: '模型原文摘要与声明不一致',
      });
    }
    if (text && integrity.modelGeneratedContent) {
      const model = integrity.modelGeneratedContent;
      // 最终正文不得包含模型原文之外的固定模板风险判断句
      const TEMPLATE_SUBSTANCE = [
        '交付范围漂移：若关键决策标准未冻结',
        '依赖外部能力可用性：外部专业能力中断或超时会拉长关键路径',
        '材料完整性：授权材料若缺少量化指标，风险判断只能停留在定性层面',
        '验证与采用门禁：未经验证的候选成果不得进入正式成长链',
        '（离线占位',
        'mode=model_length_pad',
      ];
      for (const phrase of TEMPLATE_SUBSTANCE) {
        if (text.includes(phrase) && !model.includes(phrase)) {
          issues.push({
            code: 'template_padding_detected',
            message: '检测到固定模板补写实质内容',
          });
          break;
        }
      }
      // 模型原文应可追溯：最终正文应包含模型原文（允许前后仅有标题/目标行）
      if (model.length >= 20 && !text.includes(model) && !model.includes(text.trim())) {
        const stripFrame = (s: string) =>
          s
            .replace(/^#\s*项目风险摘要\s*/m, '')
            .replace(/^任务目标：.*$/m, '')
            .trim();
        const textCore = stripFrame(text);
        const modelCore = stripFrame(model);
        const probe = (modelCore || model).slice(0, Math.min(40, (modelCore || model).length));
        if (!textCore.includes(probe) && !text.includes(probe)) {
          issues.push({
            code: 'content_integrity_mismatch',
            message: '最终成果无法追溯到模型原文',
          });
        }
      }
    }
    // reachedModel 不得单独作为合格依据 — 无额外通过分支
  }

  const digest =
    input.output.candidateMeta?.contentDigest ??
    (text !== null ? sha256(text) : sha256(JSON.stringify(artifact?.payload ?? {})));

  return {
    verdict: issues.length === 0 ? 'passed' : 'rejected',
    checkedAt: input.nowIso,
    contentDigest: digest,
    issues,
    modelSelfGradeIgnored,
  };
}

export function extractText(output: CapabilityOutput): string | null {
  const payload = output.artifact?.payload;
  if (!payload) return null;
  if (payload.kind === 'text') return payload.text;
  return null;
}

function tokenize(goal: string): string[] {
  const lower = goal.toLowerCase();
  const parts = lower.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 2);
  return [...new Set(parts)].slice(0, 12);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
