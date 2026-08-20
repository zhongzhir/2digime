/**
 * 代码分析模型输出的确定性校验(P2.2)。
 * 校验失败不得产出看似可信的完整报告。
 */
import type { ContextSnapshot, SnapshotItem } from '../../work-runtime/context-snapshot';
import {
  CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_EXCERPT_MAX_CHARS,
  type CodeAnalysisEvidenceFile,
  type CodeAnalysisEvidenceRef,
} from './code-repo-analysis-contract';
import { scrubText } from './code-analysis-prompt';

export type FindingConfidence = 'confirmed' | 'inferred' | 'uncovered';
export type FindingImportance = 'high' | 'medium' | 'low';

export interface ModelCodeFinding {
  claimId: string;
  title: string;
  importance: FindingImportance;
  confidence: FindingConfidence;
  summary: string;
  evidence?: {
    path: string;
    contentDigest: string;
    span?: { startLine: number; endLine: number };
    excerpt?: string;
  };
}

export interface ModelCodeAnalysisPayload {
  reportMarkdown: string;
  findings: ModelCodeFinding[];
  coverage?: {
    confirmed?: string[];
    inferred?: string[];
    uncovered?: string[];
  };
}

export interface ValidatedCodeAnalysis {
  reportMarkdown: string;
  evidence: CodeAnalysisEvidenceFile;
  findings: ModelCodeFinding[];
  stats: {
    findingCount: number;
    importantCount: number;
    evidenceCount: number;
    evidenceHitRate: number;
    fabricatedPathCount: number;
    absolutePathLeakCount: number;
    secretLeakCount: number;
  };
}

export class CodeAnalysisValidationError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'CodeAnalysisValidationError';
    this.reason = reason;
  }
}

export function parseModelCodeAnalysisPayload(raw: string): ModelCodeAnalysisPayload {
  const text = raw.trim();
  if (!text) {
    throw new CodeAnalysisValidationError('empty_response', '模型返回空响应');
  }
  const jsonText = extractJsonObject(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    try {
      parsed = JSON.parse(repairJsonText(jsonText));
    } catch {
      throw new CodeAnalysisValidationError('invalid_json', '模型返回无法解析的结构化结果');
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CodeAnalysisValidationError('invalid_shape', '模型返回结构非法');
  }
  const obj = parsed as Record<string, unknown>;
  const reportMarkdown = String(
    obj.reportMarkdown || obj.report || obj.markdown || obj.report_markdown || '',
  ).trim();
  let assembledReport = reportMarkdown;
  if (!assembledReport && obj.sections && typeof obj.sections === 'object') {
    const sections = obj.sections as Record<string, unknown>;
    const order: Array<[string, string]> = [
      ['overview', '项目概览'],
      ['stack', '技术栈与运行方式'],
      ['modules', '目录和模块边界'],
      ['execution', '关键执行链'],
      ['risks', '架构风险'],
      ['complexity', '复杂度与维护风险'],
      ['recommendations', '与用户目标相关的建议'],
      ['coverage', '分析覆盖范围与限制'],
    ];
    const parts = ['# 代码项目分析', ''];
    for (const [key, title] of order) {
      const body = String(sections[key] || '').trim();
      if (!body) continue;
      parts.push(`## ${title}`, '', body, '');
    }
    assembledReport = parts.join('\n').trim();
  }
  if (!assembledReport) {
    throw new CodeAnalysisValidationError('missing_report', '缺少 reportMarkdown');
  }
  const findingsRaw = Array.isArray(obj.findings)
    ? obj.findings
    : Array.isArray(obj.Findings)
      ? obj.Findings
      : null;
  if (!findingsRaw) {
    throw new CodeAnalysisValidationError('missing_findings', '缺少 findings 列表');
  }
  const findings: ModelCodeFinding[] = [];
  for (const row of findingsRaw) {
    if (!row || typeof row !== 'object') continue;
    const f = row as Record<string, unknown>;
    const claimId = String(f.claimId || '').trim();
    const title = String(f.title || '').trim();
    const summary = String(f.summary || '').trim();
    const importance = normalizeImportance(f.importance);
    const confidence = normalizeConfidence(f.confidence);
    if (!claimId || !title) continue;
    const finding: ModelCodeFinding = {
      claimId,
      title,
      importance,
      confidence,
      summary,
    };
    if (f.evidence && typeof f.evidence === 'object') {
      const ev = f.evidence as Record<string, unknown>;
      const path = String(ev.path || '').trim().replace(/\\/g, '/');
      const contentDigest = String(ev.contentDigest || '').trim();
      if (path && contentDigest) {
        const evidence: NonNullable<ModelCodeFinding['evidence']> = { path, contentDigest };
        if (ev.span && typeof ev.span === 'object') {
          const span = ev.span as Record<string, unknown>;
          const startLine = Number(span.startLine);
          const endLine = Number(span.endLine);
          if (Number.isFinite(startLine) && Number.isFinite(endLine)) {
            evidence.span = { startLine, endLine };
          }
        }
        if (typeof ev.excerpt === 'string' && ev.excerpt.trim()) {
          evidence.excerpt = ev.excerpt;
        }
        finding.evidence = evidence;
      }
    }
    findings.push(finding);
  }
  if (findings.length === 0) {
    throw new CodeAnalysisValidationError('empty_findings', 'findings 为空');
  }
  const coverage =
    obj.coverage && typeof obj.coverage === 'object'
      ? (obj.coverage as ModelCodeAnalysisPayload['coverage'])
      : undefined;
  return { reportMarkdown: assembledReport, findings, ...(coverage ? { coverage } : {}) };
}

export function validateCodeAnalysisPayload(
  payload: ModelCodeAnalysisPayload,
  snapshot: ContextSnapshot,
  selectedTexts: Map<string, string>,
): ValidatedCodeAnalysis {
  const byPath = indexSnapshot(snapshot);
  const claimIds = new Set<string>();
  let fabricatedPathCount = 0;
  let absolutePathLeakCount = 0;
  let secretLeakCount = 0;
  let evidenceHits = 0;
  let evidenceAttempts = 0;

  const normalizedFindings: ModelCodeFinding[] = [];
  const evidenceItems: CodeAnalysisEvidenceRef[] = [];

  for (const finding of payload.findings) {
    if (claimIds.has(finding.claimId)) {
      throw new CodeAnalysisValidationError('duplicate_claim', `重复 claimId: ${finding.claimId}`);
    }
    claimIds.add(finding.claimId);

    const textBlob = `${finding.title}\n${finding.summary}`;
    if (hasSecretLeak(textBlob)) secretLeakCount += 1;
    if (hasAbsolutePath(textBlob)) absolutePathLeakCount += 1;

    let confidence = finding.confidence;
    let evidence = finding.evidence;

    if (evidence) {
      evidenceAttempts += 1;
      if (hasAbsolutePath(evidence.path) || evidence.path.startsWith('/') || evidence.path.includes('..')) {
        absolutePathLeakCount += 1;
        fabricatedPathCount += 1;
        evidence = undefined;
      } else {
        const item = byPath.get(evidence.path);
        if (!item || !item.contentDigest) {
          fabricatedPathCount += 1;
          evidence = undefined;
        } else {
          // 路径命中快照时,以快照 digest 为准(纠正模型对 digest 的幻觉,仍禁止虚构路径)
          if (item.contentDigest !== evidence.contentDigest) {
            evidence = { ...evidence, contentDigest: item.contentDigest };
          }
          const body = selectedTexts.get(evidence.path) ?? '';
          if (evidence.span) {
            const lines = body.split('\n');
            if (
              evidence.span.startLine < 1 ||
              evidence.span.endLine < evidence.span.startLine ||
              (body.length > 0 && evidence.span.endLine > Math.max(lines.length, 1))
            ) {
              const { span: _s, ...rest } = evidence;
              evidence = rest;
            }
          }
          if (evidence.excerpt !== undefined) {
            const scrubbed = scrubText(evidence.excerpt).slice(0, EVIDENCE_EXCERPT_MAX_CHARS);
            if (hasSecretLeak(evidence.excerpt)) secretLeakCount += 1;
            evidence = { ...evidence, excerpt: scrubbed };
          }
          evidenceHits += 1;
          evidenceItems.push({
            claimId: finding.claimId,
            path: evidence.path,
            contentDigest: evidence.contentDigest,
            ...(evidence.span ? { span: evidence.span } : {}),
            ...(evidence.excerpt !== undefined ? { excerpt: evidence.excerpt } : {}),
          });
        }
      }
    }

    const important = finding.importance === 'high' || finding.importance === 'medium';
    if (important && !evidence) {
      // 重要结论无有效证据:不得静默接受为已证实 → 降级为推测
      if (confidence === 'confirmed') confidence = 'inferred';
    }
    if (finding.importance === 'high' && confidence === 'confirmed' && !evidence) {
      throw new CodeAnalysisValidationError(
        'missing_evidence',
        `重要结论 ${finding.claimId} 缺少可校验证据`,
      );
    }

    normalizedFindings.push({
      ...finding,
      confidence,
      title: scrubText(finding.title),
      summary: scrubText(finding.summary),
      ...(evidence ? { evidence } : {}),
    });
  }

  // 不因报告措辞误伤;由下方附录统一列出 claimId
  void payload.reportMarkdown;

  if (hasAbsolutePath(payload.reportMarkdown)) absolutePathLeakCount += 1;
  if (hasSecretLeak(payload.reportMarkdown)) secretLeakCount += 1;

  if (fabricatedPathCount > 0) {
    throw new CodeAnalysisValidationError(
      'fabricated_path',
      `存在 ${fabricatedPathCount} 处无法在快照中核对的文件引用`,
    );
  }
  if (secretLeakCount > 0) {
    throw new CodeAnalysisValidationError('secret_leak', '输出含疑似敏感内容');
  }
  if (absolutePathLeakCount > 0) {
    throw new CodeAnalysisValidationError('absolute_path', '输出含绝对路径');
  }

  const importantCount = normalizedFindings.filter(
    (f) => f.importance === 'high' || f.importance === 'medium',
  ).length;
  if (importantCount < 5) {
    throw new CodeAnalysisValidationError(
      'too_few_findings',
      `重要 findings 仅 ${importantCount} 条,少于 5 条`,
    );
  }

  const evidenceHitRate = evidenceAttempts === 0 ? 0 : evidenceHits / evidenceAttempts;
  // 对声称有 evidence 的条目,命中率必须够高
  if (evidenceAttempts > 0 && evidenceHitRate < 0.9) {
    throw new CodeAnalysisValidationError(
      'low_evidence_hit_rate',
      `evidence 命中率 ${(evidenceHitRate * 100).toFixed(0)}% < 90%`,
    );
  }

  const reportMarkdown = ensureReportDistinctions(
    scrubText(payload.reportMarkdown),
    normalizedFindings,
    payload.coverage,
  );

  return {
    reportMarkdown,
    evidence: {
      schemaVersion: CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
      items: evidenceItems,
    },
    findings: normalizedFindings,
    stats: {
      findingCount: normalizedFindings.length,
      importantCount,
      evidenceCount: evidenceItems.length,
      evidenceHitRate: evidenceAttempts === 0 ? 1 : evidenceHitRate,
      fabricatedPathCount: 0,
      absolutePathLeakCount: 0,
      secretLeakCount: 0,
    },
  };
}

function ensureReportDistinctions(
  report: string,
  findings: ModelCodeFinding[],
  coverage: ModelCodeAnalysisPayload['coverage'],
): string {
  const hasConfirmed = /已证实|confirmed/i.test(report);
  const hasInferred = /推测|inferred/i.test(report);
  const hasUncovered = /未覆盖|uncovered/i.test(report);
  if (hasConfirmed && hasInferred && hasUncovered) return report;

  const confirmed = [
    ...(coverage?.confirmed || []),
    ...findings.filter((f) => f.confidence === 'confirmed').map((f) => `${f.claimId}: ${f.title}`),
  ];
  const inferred = [
    ...(coverage?.inferred || []),
    ...findings.filter((f) => f.confidence === 'inferred').map((f) => `${f.claimId}: ${f.title}`),
  ];
  const uncovered = [
    ...(coverage?.uncovered || []),
    ...findings.filter((f) => f.confidence === 'uncovered').map((f) => `${f.claimId}: ${f.title}`),
  ];

  return [
    report.trim(),
    '',
    '## 结论置信度区分',
    '',
    '### 已证实',
    ...(confirmed.length ? confirmed.map((x) => `- ${x}`) : ['- （无）']),
    '',
    '### 推测',
    ...(inferred.length ? inferred.map((x) => `- ${x}`) : ['- （无）']),
    '',
    '### 未覆盖',
    ...(uncovered.length ? uncovered.map((x) => `- ${x}`) : ['- （无）']),
    '',
  ].join('\n');
}

function indexSnapshot(snapshot: ContextSnapshot): Map<string, SnapshotItem> {
  const map = new Map<string, SnapshotItem>();
  for (const item of snapshot.items) {
    if (item.status !== 'ok' || !item.contentDigest) continue;
    const rel = (item.relativePath || '').replace(/\\/g, '/');
    if (rel) map.set(rel, item);
  }
  return map;
}

function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

/** 尝试修复模型常见的 JSON 瑕疵(尾逗号、智能引号)。 */
export function repairJsonText(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

function normalizeImportance(value: unknown): FindingImportance {
  const v = String(value || '').toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'medium';
}

function normalizeConfidence(value: unknown): FindingConfidence {
  const v = String(value || '').toLowerCase();
  if (v === 'confirmed' || v === 'inferred' || v === 'uncovered') return v;
  return 'inferred';
}

export function hasAbsolutePath(text: string): boolean {
  return /(?:[A-Za-z]:\\|\/Users\/|\/home\/|\\\\)/.test(text);
}

export function hasSecretLeak(text: string): boolean {
  return /sk-[A-Za-z0-9_-]{8,}/.test(text) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text);
}
