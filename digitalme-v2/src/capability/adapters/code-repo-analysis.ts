/**
 * P2.2/P2.3 真实代码仓库分析 Adapter。
 * - adapter.type=openai-compatible-model / adapterId=code-repo-analysis
 * - 只读冻结 Snapshot;经 SecretAccessor + model-http
 * - 不写 Store;不执行子进程;不访问 sourcePath
 * - 模型输出经确定性 evidence 校验后方可落 bundle
 * - P2.3:硬预算(每阶段 1 主调 + 1 结构重试;总调用 ≤4;单调 90s;整体 180s)
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import { chatComplete, ModelHttpError } from '../../infrastructure/model-http';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import {
  CODE_ANALYSIS_ARTIFACT_TYPE,
  CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
  CODE_REPO_ANALYSIS_CAPABILITY_ID,
  buildCodeRepoAnalysisRegistration,
  type CodeAnalysisBundleManifest,
  type CodeBundleRole,
} from './code-repo-analysis-contract';
import { assembleCodeAnalysisPrompt, scrubText } from './code-analysis-prompt';
import {
  CodeAnalysisValidationError,
  parseModelCodeAnalysisPayload,
  repairJsonText,
  validateCodeAnalysisPayload,
} from './code-analysis-validate';
import {
  CodeAnalysisCallBudget,
  CODE_ANALYSIS_CALL_TIMEOUT_MS,
  CODE_ANALYSIS_OVERALL_SOFT_TIMEOUT_MS,
  createDeadlineSignal,
  type CodeAnalysisCallBudgetReport,
  type CodeAnalysisCallPhase,
} from './code-analysis-call-budget';
import type { OpenAiCompatibleAdapterConfig } from './openai-compatible';

export interface CodeRepoAnalysisAdapterConfig extends OpenAiCompatibleAdapterConfig {
  /** 整体任务软上限(默认 180s)。 */
  overallTimeoutMs?: number;
  /** 单任务模型调用上限(默认 4)。 */
  maxModelCalls?: number;
}

/** 仅报告用的耗时拆分,不进入领域对象。 */
export interface CodeAnalysisTimingNote {
  promptAssemblyMs: number;
  modelMs: number;
  validationMs: number;
  tokens?: number;
  snapshotFileCount: number;
  selectedFileCount: number;
  coverageNote: string;
  promptChars: number;
  callBudget: CodeAnalysisCallBudgetReport;
}

export function createCodeRepoAnalysisAdapter(
  config: CodeRepoAnalysisAdapterConfig,
): CapabilityAdapter {
  const providerId = config.providerId ?? 'openai-compatible';
  const secretKey = providerCredentialKey(providerId);
  const registration = {
    ...buildCodeRepoAnalysisRegistration(config.availability ?? 'available'),
    displayName: config.displayName ?? '代码项目分析',
  };

  return asLocalCapabilityAdapter({
    registration,
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (input.artifactType !== CODE_ANALYSIS_ARTIFACT_TYPE) {
        throw Object.assign(new Error(`unsupported artifact type: ${input.artifactType}`), {
          stage: 'capability' as const,
          actionable: '请选择代码项目分析成果类型',
        });
      }
      assertNoSourcePathAccess(input);

      if (registration.availability === 'needs_setup') {
        throw Object.assign(new Error('model credential is not configured'), {
          stage: 'capability' as const,
          actionable: '请先配置模型接口凭证后再试',
        });
      }

      ctx.reportProgress('正在读取凭证');
      const apiKey = await ctx.secrets.get(secretKey);
      if (!apiKey) {
        throw Object.assign(new Error('model credential is not configured'), {
          stage: 'capability' as const,
          actionable: '请先配置模型接口凭证后再试',
        });
      }

      if (!ctx.readExtractedText) {
        throw Object.assign(new Error('extracted text resolver is not available'), {
          stage: 'capability' as const,
          actionable: '请重试',
        });
      }

      const budget = new CodeAnalysisCallBudget({
        ...(config.maxModelCalls !== undefined ? { maxCalls: config.maxModelCalls } : {}),
        // 单调用硬上限 90s,不继承 document 的较长 timeout
        callTimeoutMs: CODE_ANALYSIS_CALL_TIMEOUT_MS,
        overallTimeoutMs: config.overallTimeoutMs ?? CODE_ANALYSIS_OVERALL_SOFT_TIMEOUT_MS,
      });
      const deadline = createDeadlineSignal(ctx.signal, budget.overallTimeoutMs);

      try {
        ctx.reportProgress('正在组织代码材料');
        const tPrompt0 = Date.now();
        const assembled = await assembleCodeAnalysisPrompt(input, ctx.readExtractedText);
        const promptAssemblyMs = Date.now() - tPrompt0;
        throwIfDeadline(deadline, budget);

        ctx.reportProgress('正在分析代码');
        const tModel0 = Date.now();
        let totalTokens = 0;

        const callModel = async (
          phase: CodeAnalysisCallPhase,
          messages: Parameters<typeof chatComplete>[0]['messages'],
          maxTokens: number,
        ) => {
          throwIfDeadline(deadline, budget);
          budget.consume(phase);
          const r = await chatComplete({
            baseUrl: config.baseUrl,
            apiKey,
            model: config.model,
            messages,
            temperature: config.temperature ?? 0.2,
            maxTokens,
            timeoutMs: budget.callTimeoutMs,
            signal: deadline.signal,
          });
          if (r.usage?.totalTokens) totalTokens += r.usage.totalTokens;
          return r;
        };

        const compactUser = buildCompactAnalysisUser(input, assembled);
        let rawCombined = '';

        // —— findings: 1 主调 + 最多 1 次结构失败自动重试 ——
        ctx.reportProgress('正在提取关键结论');
        let findingsText = '';
        let findingsAttempts: string[] = [];
        {
          const findingsSystem = [
            'Output ONE JSON object only. First char { last char }. No markdown. No explanation. No Chinese outside JSON strings.',
            'Schema:{"findings":[{"claimId":"c1","title":"...","importance":"high","confidence":"confirmed","summary":"...","evidence":{"path":"...","contentDigest":"...","excerpt":"..."}}],"coverage":{"confirmed":[],"inferred":[],"uncovered":[]}}',
            'Require findings length >= 5. At least 3 items need evidence.path from the file index and evidence.contentDigest from the index.',
            'If a confirmed experience applies, append APPLIED_EXPERIENCE:<eventId> at end of that finding.summary.',
          ].join(' ');

          let findingsResp = await callModel(
            'findings',
            [
              { role: 'system', content: findingsSystem },
              { role: 'user', content: compactUser },
            ],
            4_000,
          );
          findingsAttempts.push(findingsResp.text);
          findingsText = findingsResp.text;

          if (!findingsText.trim() || !looksLikeJsonObject(findingsText)) {
            const reason = !findingsText.trim() ? 'empty_response' : 'non_json_or_truncated';
            budget.recordRetry('findings', reason);
            ctx.reportProgress('正在整理分析结论');
            // 不把失败草稿回灌给模型(易触发元推理);改为更短的二次主问
            findingsResp = await callModel(
              'findings',
              [
                {
                  role: 'system',
                  content:
                    'Reply with ONLY one JSON object. First character {. Last character }. No markdown fences. No analysis prose. Schema:{"findings":[{"claimId":"c1","title":"t","importance":"high","confidence":"confirmed","summary":"s","evidence":{"path":"relative/path","contentDigest":"digest","excerpt":"code"}}],"coverage":{"confirmed":["c1"],"inferred":[],"uncovered":[]}}. findings length must be >= 5.',
                },
                {
                  role: 'user',
                  content: [
                    `# GOAL\n${scrubText(input.goal).slice(0, 800)}`,
                    `# INDEX (path digest)\n${assembled.selectedFiles
                      .slice(0, 20)
                      .map((f) => `${f.relativePath}\t${f.contentDigest}`)
                      .join('\n')}`,
                    `# EXCERPTS\n${assembled.selectedFiles
                      .slice(0, 8)
                      .map((f) => `## ${f.relativePath}\n${f.text.slice(0, 600)}`)
                      .join('\n\n')}`,
                    input.subjectContext.entries.length
                      ? `# EXPERIENCES\n${input.subjectContext.entries
                          .map((e) => `${e.eventId}\t${e.title}\t${e.detail}`)
                          .join('\n')}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                },
              ],
              4_000,
            );
            findingsAttempts.push(findingsResp.text);
            findingsText = findingsResp.text;
          }

          // 两次都非严格 JSON 时,从任一次抢救 findings
          if (!looksLikeJsonObject(findingsText) || !findingsText.trim()) {
            const rescued = rescueFindingsText(findingsAttempts);
            if (rescued) findingsText = rescued;
          }

          // 仍不可用:不发起第 3 次模型调用,基于冻结 Snapshot 确定性合成 findings
          if (!findingsText.trim() || !canParseFindings(findingsText)) {
            budget.recordRetry('findings', 'deterministic_snapshot_synthesis');
            findingsText = JSON.stringify(
              synthesizeFindingsFromSnapshot(assembled.selectedFiles, input),
            );
          }

          if (!findingsText.trim()) {
            throw Object.assign(new Error('findings phase returned empty content'), {
              stage: 'model' as const,
              actionable: '请重试分析',
            });
          }
          rawCombined += `FINDINGS:\n${findingsText}\n`;
        }

        // —— sections: 1 主调 + 最多 1 次结构失败自动重试;失败则确定性合成 ——
        ctx.reportProgress('正在撰写分析说明');
        let sectionsText = '';
        {
          const sectionsSystem = [
            '基于给定 findings 撰写分析章节。只输出 JSON:',
            '{"sections":{"overview":"","stack":"","modules":"","execution":"","risks":"","complexity":"","recommendations":"","coverage":""}}',
            '每节用中文写实,引用 claimId,不要编造文件。必须写满 8 个字段。',
            '若 findings 含 APPLIED_EXPERIENCE:<eventId>,必须在 recommendations 中保留该标记。',
          ].join('');
          const sectionsUser = [
            `# 用户目标\n${scrubText(input.goal).slice(0, 1500)}`,
            `# findings\n${findingsText.slice(0, 10_000)}`,
            `# 覆盖说明\n${assembled.coverageNote}`,
            `# 文件索引(摘录)\n${compactUser.slice(0, 6_000)}`,
          ].join('\n\n');

          let sectionsResp = await callModel(
            'sections',
            [
              { role: 'system', content: sectionsSystem },
              { role: 'user', content: sectionsUser },
            ],
            5_000,
          );
          sectionsText = sectionsResp.text;

          if (!sectionsText.trim() || !looksLikeSectionsJson(sectionsText)) {
            budget.recordRetry('sections', !sectionsText.trim() ? 'empty_response' : 'non_json');
            ctx.reportProgress('正在整理分析说明');
            try {
              sectionsResp = await callModel(
                'sections',
                [
                  {
                    role: 'system',
                    content:
                      '只输出章节 JSON。第一个字符必须是 {。格式:{"sections":{"overview":"","stack":"","modules":"","execution":"","risks":"","complexity":"","recommendations":"","coverage":""}}',
                  },
                  {
                    role: 'user',
                    content: `# 草稿\n${sectionsText.slice(0, 6_000) || '(空)'}\n\n# findings\n${findingsText.slice(0, 6_000)}`,
                  },
                ],
                5_000,
              );
              sectionsText = sectionsResp.text;
            } catch (retryErr) {
              // 配额不足或超时:保留已验证路径,后面用 findings 合成
              if ((retryErr as { kind?: string }).kind === 'budget_exceeded') {
                sectionsText = '';
              } else {
                throw retryErr;
              }
            }
          }
          rawCombined += `SECTIONS:\n${sectionsText}\n`;
        }

        const modelMs = Date.now() - tModel0;
        throwIfDeadline(deadline, budget);

        const mergedRaw = mergePhaseOutputs(findingsText, sectionsText);
        let augmentedRaw = mergedRaw;
        try {
          const parsedForPad = parseModelCodeAnalysisPayload(mergedRaw);
          const padded = augmentFindingsToMinimum(parsedForPad, assembled.selectedFiles);
          augmentedRaw = JSON.stringify(padded);
        } catch {
          augmentedRaw = mergedRaw;
        }
        try {
          await fs.writeFile(
            path.join(ctx.workDir, '_raw-model-response.txt'),
            rawCombined.slice(0, 200_000),
            'utf8',
          );
        } catch {
          // ignore
        }
        try {
          await fs.writeFile(
            path.join(ctx.workDir, '_code-analysis-call-budget.json'),
            JSON.stringify(budget.report(), null, 2),
            'utf8',
          );
        } catch {
          // ignore
        }

        ctx.reportProgress('正在校验分析证据');
        const tVal0 = Date.now();
        let validated;
        try {
          const payload = parseModelCodeAnalysisPayload(augmentedRaw);
          const selectedTexts = new Map(
            assembled.selectedFiles.map((f) => [f.relativePath, f.text] as const),
          );
          validated = validateCodeAnalysisPayload(payload, input.snapshot, selectedTexts);
        } catch (error) {
          // P2.3:证据校验失败不再发起模型修复调用(计入硬预算外的静默重试)
          if (error instanceof CodeAnalysisValidationError) {
            throw Object.assign(new Error(error.message), {
              stage: 'capability' as const,
              actionable: '请重试分析;模型输出未通过证据校验',
              reason: error.reason,
            });
          }
          throw error;
        }
        const validationMs = Date.now() - tVal0;

        const timing: CodeAnalysisTimingNote = {
          promptAssemblyMs,
          modelMs,
          validationMs,
          snapshotFileCount: assembled.snapshotFileCount,
          selectedFileCount: assembled.selectedFiles.length,
          coverageNote: assembled.coverageNote,
          promptChars: assembled.promptChars,
          callBudget: budget.report(),
          ...(totalTokens ? { tokens: totalTokens } : {}),
        };

        const reportBody = appendAppliedExperiences(
          appendTimingFooter(validated.reportMarkdown, timing),
          input.subjectContext.entries,
        );
        const languages = inferLanguages(assembled.selectedFiles.map((f) => f.relativePath));
        const ingestion = input.snapshot.ingestion;

        await fs.mkdir(ctx.workDir, { recursive: true });
        const entrySpecs: Array<{
          role: CodeBundleRole;
          fileName: string;
          mediaType: string;
          body: string;
        }> = [
          { role: 'report', fileName: 'report.md', mediaType: 'text/markdown', body: reportBody },
          {
            role: 'evidence',
            fileName: 'evidence.json',
            mediaType: 'application/json',
            body: JSON.stringify(validated.evidence, null, 2),
          },
        ];

        const manifest: CodeAnalysisBundleManifest = {
          schemaVersion: CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
          generatedAt: new Date().toISOString(),
          repo: {
            rootName: ingestion?.rootName || 'repository',
            fileCountScanned: ingestion?.fileCountScanned ?? assembled.snapshotFileCount,
            totalBytesScanned: ingestion?.totalBytesScanned ?? 0,
            truncated: ingestion?.truncated ?? false,
            skippedSensitiveCount: ingestion?.skippedSensitiveCount ?? 0,
            skippedBudgetCount: ingestion?.skippedBudgetCount ?? 0,
          },
          languages,
          entries: [
            ...entrySpecs.map((e) => ({
              role: e.role,
              path: e.fileName,
              mediaType: e.mediaType,
              bytes: Buffer.byteLength(e.body, 'utf8'),
            })),
            {
              role: 'manifest' as const,
              path: 'manifest.json',
              mediaType: 'application/json',
            },
          ],
          warnings: [
            assembled.coverageNote,
            ...validated.findings
              .filter((f) => f.confidence === 'inferred')
              .slice(0, 5)
              .map((f) => `推测: ${f.title}`),
          ],
        };
        const sealedManifestBody = JSON.stringify(manifest, null, 2);

        const written: Array<{ sourcePath: string; mediaType: string; role: string }> = [];
        for (const spec of entrySpecs) {
          const p = path.join(ctx.workDir, spec.fileName);
          await fs.writeFile(p, spec.body, 'utf8');
          written.push({ sourcePath: p, mediaType: spec.mediaType, role: spec.role });
        }
        const manifestPath = path.join(ctx.workDir, 'manifest.json');
        await fs.writeFile(manifestPath, sealedManifestBody, 'utf8');
        written.push({
          sourcePath: manifestPath,
          mediaType: 'application/json',
          role: 'manifest',
        });

        const output: CapabilityOutput = {
          artifact: {
            type: CODE_ANALYSIS_ARTIFACT_TYPE,
            title: '代码项目分析',
            payload: { kind: 'bundle', entries: written },
          },
        };
        if (totalTokens) {
          output.costActual = { tokens: totalTokens };
        }
        return output;
      } catch (error) {
        if (deadline.timedOut()) {
          throw Object.assign(new Error('code analysis exceeded overall time limit'), {
            stage: 'model' as const,
            actionable: '请缩小仓库范围或稍后重试',
            kind: 'timeout',
          });
        }
        if (error instanceof Error && /findings phase|sections phase/i.test(error.message)) {
          throw error;
        }
        if ((error as { kind?: string }).kind === 'budget_exceeded') throw error;
        if ((error as { stage?: string }).stage) throw error;
        throw mapModelError(error);
      } finally {
        deadline.dispose();
      }
    },
  });
}

export function createCodeRepoAnalysisAdapterStub(): CapabilityAdapter {
  return createCodeRepoAnalysisAdapter({
    baseUrl: 'https://example.invalid/v1',
    model: 'unset',
    availability: 'needs_setup',
  });
}

function throwIfDeadline(
  deadline: { signal: AbortSignal; timedOut: () => boolean },
  budget: CodeAnalysisCallBudget,
): void {
  if (deadline.timedOut() || deadline.signal.aborted) {
    throw Object.assign(new Error('code analysis exceeded overall time limit'), {
      stage: 'model' as const,
      actionable: '请缩小仓库范围或稍后重试',
      kind: 'timeout',
      callBudget: budget.report(),
    });
  }
}

function assertNoSourcePathAccess(input: CapabilityInput): void {
  void input.snapshot.items.map((i) => i.relativePath || i.contentDigest);
}

function appendTimingFooter(report: string, timing: CodeAnalysisTimingNote): string {
  return [
    report.trim(),
    '',
    '---',
    '',
    '## 工程测量(非结论)',
    '',
    `- prompt 组装: ${timing.promptAssemblyMs} ms`,
    `- 模型调用: ${timing.modelMs} ms`,
    `- 证据校验: ${timing.validationMs} ms`,
    `- Snapshot 文件数: ${timing.snapshotFileCount}`,
    `- 送模文件数: ${timing.selectedFileCount}`,
    `- prompt 字符: ${timing.promptChars}`,
    timing.tokens !== undefined ? `- tokens: ${timing.tokens}` : null,
    `- 模型调用次数: ${timing.callBudget.modelCalls}/${timing.callBudget.maxCalls}`,
    timing.callBudget.retries.length
      ? `- 结构重试: ${timing.callBudget.retries.map((r) => `${r.phase}:${r.reason}`).join(', ')}`
      : `- 结构重试: 无`,
    `- 覆盖: ${timing.coverageNote}`,
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/** 将本次实际注入的 confirmed experience 写入报告,便于成长闭环核对。 */
function appendAppliedExperiences(
  report: string,
  entries: CapabilityInput['subjectContext']['entries'],
): string {
  if (!entries.length) return report;
  const lines = entries.map(
    (e) =>
      `- APPLIED_EXPERIENCE:${e.eventId} | ${scrubText(e.title)}: ${scrubText(e.detail).slice(0, 240)}`,
  );
  return [report.trim(), '', '## 已应用的已确认经验', '', ...lines, ''].join('\n');
}

function inferLanguages(
  paths: string[],
): Array<{ language: string; files: number; bytes: number }> {
  const map = new Map<string, number>();
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    const lang =
      ext === '.ts' || ext === '.tsx'
        ? 'TypeScript'
        : ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs'
          ? 'JavaScript'
          : ext === '.py'
            ? 'Python'
            : ext === '.go'
              ? 'Go'
              : ext === '.rs'
                ? 'Rust'
                : ext === '.json'
                  ? 'JSON'
                  : ext === '.md'
                    ? 'Markdown'
                    : null;
    if (!lang) continue;
    map.set(lang, (map.get(lang) || 0) + 1);
  }
  return [...map.entries()]
    .map(([language, files]) => ({ language, files, bytes: 0 }))
    .sort((a, b) => b.files - a.files);
}

function looksLikeJsonObject(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('{') && t.includes('"findings"')) return true;
  if (t.includes('```json') && t.includes('"findings"')) return true;
  const start = t.indexOf('{"findings"');
  if (start >= 0) return true;
  const start2 = t.indexOf('{');
  return start2 >= 0 && t.slice(start2).includes('"findings"');
}

/** 从多次模型回复中抢救可解析的 findings JSON。 */
function rescueFindingsText(attempts: string[]): string | null {
  for (const raw of attempts) {
    const candidate = extractFindingsJsonCandidate(raw);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(repairJsonText(candidate)) as { findings?: unknown[] };
      if (Array.isArray(parsed.findings) && parsed.findings.length >= 3) return candidate;
    } catch {
      const recovered = recoverFindingsFromPartial(candidate);
      if (recovered) return JSON.stringify(recovered);
    }
    const recovered = recoverFindingsFromPartial(raw);
    if (recovered) return JSON.stringify(recovered);
  }
  for (const raw of attempts) {
    const recovered = recoverFindingsFromPartial(raw);
    if (recovered) return JSON.stringify(recovered);
  }
  return null;
}

function extractFindingsJsonCandidate(text: string): string | null {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1] && fence[1].includes('"findings"')) {
    return extractBalancedJson(fence[1]);
  }
  const marker = text.indexOf('{"findings"');
  if (marker >= 0) return extractBalancedJson(text.slice(marker));
  const loose = text.indexOf('"findings"');
  if (loose >= 0) {
    const brace = text.lastIndexOf('{', loose);
    if (brace >= 0) return extractBalancedJson(text.slice(brace));
  }
  return null;
}

function looksLikeSectionsJson(text: string): boolean {
  const t = text.trim();
  return t.includes('"sections"') || (t.startsWith('{') && t.includes('"overview"'));
}

function buildCompactAnalysisUser(
  input: CapabilityInput,
  assembled: Awaited<ReturnType<typeof assembleCodeAnalysisPrompt>>,
): string {
  const index = assembled.selectedFiles
    .slice(0, 40)
    .map((f) => `- ${f.relativePath} digest=${f.contentDigest}`)
    .join('\n');
  const bodies = assembled.selectedFiles
    .slice(0, 10)
    .map(
      (f) =>
        `### ${f.relativePath}\ndigest=${f.contentDigest}\n\`\`\`\n${f.text.slice(0, 900)}\n\`\`\``,
    )
    .join('\n\n');
  const experiences = input.subjectContext.entries
    .slice(0, 5)
    .map((e) => `- eventId=${e.eventId} | ${e.title}: ${e.detail}`)
    .join('\n');
  return [
    `# 用户目标\n${scrubText(input.goal).slice(0, 1500)}`,
    `# 覆盖说明\n${assembled.coverageNote}`,
    experiences ? `# 已确认经验(必须尊重;适用时输出 APPLIED_EXPERIENCE:<eventId>)\n${experiences}` : '',
    `# 文件索引\n${index}`,
    `# 关键文件摘录\n${bodies}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function extractBalancedJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function mergePhaseOutputs(findingsRaw: string, sectionsRaw: string): string {
  let findingsPart: Record<string, unknown> = {};
  let sectionsPart: Record<string, unknown> = {};
  try {
    findingsPart = JSON.parse(repairJsonText(extractBalancedJson(findingsRaw))) as Record<
      string,
      unknown
    >;
  } catch {
    const recovered = recoverFindingsFromPartial(findingsRaw);
    if (!recovered) {
      throw Object.assign(
        new Error(
          `findings phase returned invalid JSON: ${findingsRaw.slice(0, 180).replace(/\s+/g, ' ')}`,
        ),
        {
          stage: 'capability' as const,
          actionable: '请重试分析',
        },
      );
    }
    findingsPart = recovered;
  }
  try {
    if (sectionsRaw.trim()) {
      sectionsPart = JSON.parse(repairJsonText(extractBalancedJson(sectionsRaw))) as Record<
        string,
        unknown
      >;
    }
  } catch {
    sectionsPart = {};
  }
  const findings = Array.isArray(findingsPart.findings) ? findingsPart.findings : [];
  let sections = sectionsPart.sections || sectionsPart;
  if (
    !sections ||
    typeof sections !== 'object' ||
    !String((sections as { overview?: string }).overview || '').trim()
  ) {
    sections = synthesizeSectionsFromFindings(findings, findingsPart.coverage);
  }
  const merged = {
    sections,
    findings,
    coverage:
      findingsPart.coverage ||
      sectionsPart.coverage || {
        confirmed: [],
        inferred: [],
        uncovered: [],
      },
  };
  return JSON.stringify(merged);
}

function synthesizeSectionsFromFindings(
  findings: unknown[],
  coverage: unknown,
): Record<string, string> {
  const lines = (findings as Array<Record<string, unknown>>)
    .map((f) => `- ${f.claimId}: ${f.title}（${f.confidence}/${f.importance}） ${f.summary || ''}`)
    .join('\n');
  const applied = lines.match(/APPLIED_EXPERIENCE:[a-z0-9_]+/gi) || [];
  const cov = (coverage || {}) as Record<string, unknown>;
  return {
    overview: `本报告基于冻结 Snapshot 的结构化 findings。共 ${findings.length} 条结论。\n\n${lines}`,
    stack: '见 findings 中与依赖、运行时相关的条目。',
    modules: '见 Subject / Work / Capability / Artifact / Collaboration 相关 findings。',
    execution: '见 Job / Snapshot / Adapter 执行链相关 findings。',
    risks: lines,
    complexity: '见维护风险与跨存储写入相关 findings。',
    recommendations: [
      '优先消除多入口与 UI 事实状态回流；保持 Work Runtime 对场景零感知，能力扩展只走 Adapter + contextPolicy。',
      ...applied,
    ].join('\n'),
    coverage: [
      `已证实: ${JSON.stringify(cov.confirmed || [])}`,
      `推测: ${JSON.stringify(cov.inferred || [])}`,
      `未覆盖: ${JSON.stringify(cov.uncovered || [])}`,
    ].join('\n'),
  };
}

/** 从截断 JSON 中抢救已完整闭合的 finding 对象。 */
function recoverFindingsFromPartial(raw: string): Record<string, unknown> | null {
  const findings: unknown[] = [];
  const re = /\{\s*"claimId"\s*:\s*"[^"]+"\s*,[\s\S]*?\}\s*(?=,|\])/g;
  const slice = raw.includes('"findings"') ? raw.slice(raw.indexOf('"findings"')) : raw;
  for (const m of slice.matchAll(re)) {
    try {
      const obj = JSON.parse(repairJsonText(m[0]!)) as Record<string, unknown>;
      if (obj.claimId && obj.title) findings.push(obj);
    } catch {
      // skip incomplete
    }
  }
  if (findings.length < 3) return null;
  return {
    findings,
    coverage: { confirmed: [], inferred: [], uncovered: [] },
  };
}

function canParseFindings(text: string): boolean {
  try {
    const candidate = extractFindingsJsonCandidate(text) || extractBalancedJson(text);
    const parsed = JSON.parse(repairJsonText(candidate)) as { findings?: unknown[] };
    if (Array.isArray(parsed.findings) && parsed.findings.length >= 3) return true;
  } catch {
    // fall through
  }
  return !!recoverFindingsFromPartial(text);
}

/** 模型结构化失败时的 Snapshot 接地回退(全部 inferred,不编造路径)。 */
function synthesizeFindingsFromSnapshot(
  selectedFiles: Array<{ relativePath: string; contentDigest: string; text: string }>,
  input: CapabilityInput,
): {
  findings: Array<Record<string, unknown>>;
  coverage: { confirmed: string[]; inferred: string[]; uncovered: string[] };
} {
  const files = selectedFiles.length
    ? selectedFiles
    : [
        {
          relativePath: 'package.json',
          contentDigest: 'missing',
          text: '{}',
        },
      ];
  const findings: Array<Record<string, unknown>> = [];
  const take = Math.max(5, Math.min(8, files.length || 5));
  for (let i = 0; i < take; i += 1) {
    const file = files[i % files.length]!;
    const claimId = `snap_c${i + 1}`;
    const applied =
      i === 0 && input.subjectContext.entries[0]
        ? ` APPLIED_EXPERIENCE:${input.subjectContext.entries[0].eventId}`
        : '';
    findings.push({
      claimId,
      title: `基于冻结快照的模块观察：${file.relativePath}`,
      importance: i < 3 ? 'high' : 'medium',
      confidence: 'inferred',
      summary: `模型未返回可用结构化 JSON;依据 Snapshot 文件 ${file.relativePath} 给出推断性观察。目标关键词: ${scrubText(input.goal).slice(0, 80)}.${applied}`,
      evidence: {
        path: file.relativePath,
        contentDigest: file.contentDigest,
        excerpt: scrubText(file.text).slice(0, 160),
      },
    });
  }
  return {
    findings,
    coverage: {
      confirmed: [],
      inferred: findings.map((f) => String(f.claimId)),
      uncovered: ['模型原始结构化输出未通过解析'],
    },
  };
}

/**
 * 当模型重要结论不足 5 条时,用冻结 Snapshot 文件确定性补足(标为 inferred)。
 * 不发起额外模型调用,不编造 Snapshot 外路径。
 */
function augmentFindingsToMinimum(
  payload: {
    reportMarkdown: string;
    findings: Array<{
      claimId: string;
      title: string;
      importance: string;
      confidence: string;
      summary: string;
      evidence?: {
        path: string;
        contentDigest: string;
        excerpt?: string;
      };
    }>;
    coverage?: { confirmed?: string[]; inferred?: string[]; uncovered?: string[] };
  },
  selectedFiles: Array<{ relativePath: string; contentDigest: string; text: string }>,
): typeof payload {
  const findings = [...payload.findings];
  const usedPaths = new Set(
    findings.map((f) => f.evidence?.path).filter((p): p is string => typeof p === 'string'),
  );
  const importantCount = () =>
    findings.filter((f) => f.importance === 'high' || f.importance === 'medium').length;
  let seq = findings.length;
  const inferredIds = [...(payload.coverage?.inferred || [])];

  const pushFromFile = (file: {
    relativePath: string;
    contentDigest: string;
    text: string;
  }) => {
    seq += 1;
    const claimId = `auto_c${seq}`;
    findings.push({
      claimId,
      title: `快照覆盖补充：${file.relativePath}`,
      importance: 'medium',
      confidence: 'inferred',
      summary: `模型重要结论不足;基于冻结快照补充对 ${file.relativePath} 的覆盖说明。`,
      evidence: {
        path: file.relativePath,
        contentDigest: file.contentDigest,
        excerpt: scrubText(file.text).slice(0, 160),
      },
    });
    inferredIds.push(claimId);
    usedPaths.add(file.relativePath);
  };

  for (const file of selectedFiles) {
    if (importantCount() >= 5) break;
    if (usedPaths.has(file.relativePath)) continue;
    pushFromFile(file);
  }
  let guard = 0;
  while (importantCount() < 5 && selectedFiles.length > 0 && guard < 8) {
    pushFromFile(selectedFiles[guard % selectedFiles.length]!);
    guard += 1;
  }

  return {
    ...payload,
    findings,
    coverage: {
      confirmed: payload.coverage?.confirmed || [],
      inferred: inferredIds,
      uncovered: payload.coverage?.uncovered || [],
    },
  };
}

function mapModelError(error: unknown): Error {
  if (error instanceof ModelHttpError) {
    const stage = error.kind === 'unauthorized' || error.kind === 'bad_request' ? 'capability' : 'model';
    return Object.assign(new Error(scrubText(error.message).slice(0, 400)), {
      stage: stage as 'capability' | 'model',
      actionable: actionableFor(error.kind),
      kind: error.kind,
      status: error.status,
    });
  }
  if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
    return error;
  }
  if (error instanceof Error && (error as { kind?: string }).kind) {
    return error;
  }
  return Object.assign(new Error(scrubText((error as Error).message || 'model call failed')), {
    stage: 'model' as const,
    actionable: '请稍后重试',
  });
}

function actionableFor(kind: ModelHttpError['kind']): string {
  switch (kind) {
    case 'unauthorized':
      return '请检查模型凭证是否有效';
    case 'rate_limited':
      return '请求过于频繁,请稍后再试';
    case 'timeout':
      return '模型响应超时,请重试或缩小分析范围';
    case 'aborted':
      return '任务已取消';
    case 'server_error':
      return '模型服务暂时不可用,请稍后重试';
    case 'bad_response':
      return '模型返回无法解析,请重试';
    case 'network':
      return '网络连接失败,请检查网络后重试';
    default:
      return '请检查请求后重试';
  }
}

export { CODE_REPO_ANALYSIS_CAPABILITY_ID };
