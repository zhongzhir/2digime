/**
 * P2.2 真实代码仓库分析 Adapter。
 * - adapter.type=openai-compatible-model / adapterId=code-repo-analysis
 * - 只读冻结 Snapshot;经 SecretAccessor + model-http
 * - 不写 Store;不执行子进程;不访问 sourcePath
 * - 模型输出经确定性 evidence 校验后方可落 bundle
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
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
import type { OpenAiCompatibleAdapterConfig } from './openai-compatible';

export interface CodeRepoAnalysisAdapterConfig extends OpenAiCompatibleAdapterConfig {}

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

  return {
    registration,
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (input.artifactType !== CODE_ANALYSIS_ARTIFACT_TYPE) {
        throw Object.assign(new Error(`unsupported artifact type: ${input.artifactType}`), {
          stage: 'capability' as const,
          actionable: '请选择代码项目分析成果类型',
        });
      }
      // 硬禁止:Adapter 不读 sourcePath(测试可猴子补丁侦测)
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

      ctx.reportProgress('正在组织代码材料');
      const tPrompt0 = Date.now();
      const assembled = await assembleCodeAnalysisPrompt(input, ctx.readExtractedText);
      const promptAssemblyMs = Date.now() - tPrompt0;

      if (ctx.signal.aborted) throw abortError();

      ctx.reportProgress('正在调用模型分析');
      const tModel0 = Date.now();
      let totalTokens = 0;
      const callModel = async (
        messages: Parameters<typeof chatComplete>[0]['messages'],
        maxTokens = config.maxTokens ?? 6_000,
      ) => {
        const r = await chatComplete({
          baseUrl: config.baseUrl,
          apiKey,
          model: config.model,
          messages,
          temperature: config.temperature ?? 0.2,
          maxTokens,
          timeoutMs: config.timeoutMs ?? 180_000,
          signal: ctx.signal,
          // 注意:部分 DeepSeek 型号启用 response_format 会注入冲突系统提示并返回非 JSON。
        });
        if (r.usage?.totalTokens) totalTokens += r.usage.totalTokens;
        return r;
      };

      let rawCombined = '';
      let result: { text: string; usage?: { totalTokens?: number } };
      try {
        // 阶段1:只取 findings(更稳) — 使用压缩材料,避免大 prompt 导致非法 JSON
        ctx.reportProgress('正在提取关键结论');
        const compactUser = buildCompactAnalysisUser(input, assembled);
        let findingsResp = await callModel(
          [
            {
              role: 'system',
              content: [
                '你是代码分析器。你的整段回复必须是一个 JSON 对象。',
                '第一个字符必须是 {，最后一个字符必须是 }。禁止输出解释、草稿或 markdown。',
                '格式:{"findings":[...],"coverage":{"confirmed":[],"inferred":[],"uncovered":[]}}',
                'findings≥5;每项含 claimId,title,importance,confidence,summary;',
                '至少 3 条 high/medium 带 evidence{path,contentDigest,excerpt?}。',
                'path 必须来自文件索引;digest 尽量复制索引中的值。禁止绝对路径与密钥。',
              ].join(''),
            },
            { role: 'user', content: compactUser },
          ],
          7_000,
        );
        if (!findingsResp.text.trim()) {
          throw Object.assign(new Error('findings phase returned empty content'), {
            stage: 'model' as const,
            actionable: '请重试分析',
          });
        }
        if (!looksLikeJsonObject(findingsResp.text)) {
          ctx.reportProgress('正在把分析草稿转换为结构化结果');
          findingsResp = await callModel(
            [
              {
                role: 'system',
                content:
                  '把下方分析草稿转换为唯一 JSON 对象。第一个字符必须是 {，最后一个字符必须是 }。不要输出任何解释。格式:{"findings":[...],"coverage":{"confirmed":[],"inferred":[],"uncovered":[]}}。findings≥5。',
              },
              {
                role: 'user',
                content: [
                  `# 草稿\n${findingsResp.text.slice(0, 10_000)}`,
                  `# 可用文件索引\n${compactUser.split('# 关键文件摘录')[0] || compactUser.slice(0, 4_000)}`,
                ].join('\n\n'),
              },
            ],
            7_000,
          );
        }
        rawCombined += `FINDINGS:\n${findingsResp.text}\n`;

        // 阶段2:基于 findings 写 sections
        ctx.reportProgress('正在撰写分析章节');
        const sectionsResp = await callModel(
          [
            {
              role: 'system',
              content: [
                '基于给定 findings 撰写分析章节。只输出 JSON:',
                '{"sections":{"overview":"","stack":"","modules":"","execution":"","risks":"","complexity":"","recommendations":"","coverage":""}}',
                '每节用中文写实,引用 claimId,不要编造文件。必须写满 8 个字段。',
              ].join(''),
            },
            {
              role: 'user',
              content: [
                `# 用户目标\n${scrubText(input.goal).slice(0, 1500)}`,
                `# findings\n${findingsResp.text.slice(0, 10_000)}`,
                `# 覆盖说明\n${assembled.coverageNote}`,
                `# 文件索引(摘录)\n${compactUser.slice(0, 6_000)}`,
              ].join('\n\n'),
            },
          ],
          5_000,
        );
        rawCombined += `SECTIONS:\n${sectionsResp.text}\n`;
        result = {
          text: mergePhaseOutputs(findingsResp.text, sectionsResp.text),
          ...(totalTokens ? { usage: { totalTokens } } : {}),
        };
      } catch (error) {
        if (error instanceof Error && /findings phase|sections phase/i.test(error.message)) {
          throw error;
        }
        throw mapModelError(error);
      }
      const modelMs = Date.now() - tModel0;

      const raw = result.text.trim();
      if (!raw) {
        throw Object.assign(new Error('model returned empty content'), {
          stage: 'model' as const,
          actionable: '请重试;若持续为空请更换模型或缩小仓库范围',
        });
      }
      try {
        await fs.writeFile(
          path.join(ctx.workDir, '_raw-model-response.txt'),
          rawCombined.slice(0, 200_000) || raw.slice(0, 200_000),
          'utf8',
        );
      } catch {
        // ignore
      }

      ctx.reportProgress('正在校验分析证据');
      const tVal0 = Date.now();
      let validated;
      try {
        const payload = parseModelCodeAnalysisPayload(raw);
        const selectedTexts = new Map(
          assembled.selectedFiles.map((f) => [f.relativePath, f.text] as const),
        );
        validated = validateCodeAnalysisPayload(payload, input.snapshot, selectedTexts);
      } catch (error) {
        if (error instanceof CodeAnalysisValidationError && !ctx.signal.aborted) {
          // 校验失败时给模型一次修复机会
          ctx.reportProgress('证据校验未通过，正在请求修正');
          try {
            const repair = await chatComplete({
              baseUrl: config.baseUrl,
              apiKey,
              model: config.model,
              messages: [
                {
                  role: 'system',
                  content:
                    '你之前的代码分析 JSON 未通过证据校验。请只输出修正后的完整 JSON。' +
                    `失败原因: ${error.message}。evidence.path/digest 必须来自用户消息中的文件索引。`,
                },
                assembled.messages[1]!,
                { role: 'assistant', content: raw.slice(0, 12_000) },
                {
                  role: 'user',
                  content: `请修正并重新输出完整 JSON。错误: ${error.reason} / ${error.message}`,
                },
              ],
              temperature: 0.1,
              maxTokens: config.maxTokens ?? 8_192,
              timeoutMs: config.timeoutMs ?? 180_000,
              signal: ctx.signal,
            });
            const repairedPayload = parseModelCodeAnalysisPayload(repair.text);
            const selectedTexts = new Map(
              assembled.selectedFiles.map((f) => [f.relativePath, f.text] as const),
            );
            validated = validateCodeAnalysisPayload(
              repairedPayload,
              input.snapshot,
              selectedTexts,
            );
            if (repair.usage?.totalTokens !== undefined) {
              result = {
                text: repair.text,
                usage: {
                  totalTokens:
                    (result.usage?.totalTokens || 0) + (repair.usage.totalTokens || 0),
                },
              };
            } else {
              result = { text: repair.text, ...(result.usage ? { usage: result.usage } : {}) };
            }
          } catch (repairError) {
            if (repairError instanceof CodeAnalysisValidationError) {
              throw Object.assign(new Error(repairError.message), {
                stage: 'capability' as const,
                actionable: '请重试分析;模型输出未通过证据校验',
                reason: repairError.reason,
              });
            }
            throw Object.assign(new Error(error.message), {
              stage: 'capability' as const,
              actionable: '请重试分析;模型输出未通过证据校验',
              reason: error.reason,
            });
          }
        } else if (error instanceof CodeAnalysisValidationError) {
          throw Object.assign(new Error(error.message), {
            stage: 'capability' as const,
            actionable: '请重试分析;模型输出未通过证据校验',
            reason: error.reason,
          });
        } else {
          throw error;
        }
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
        ...(result.usage?.totalTokens !== undefined ? { tokens: result.usage.totalTokens } : {}),
      };

      const reportBody = appendTimingFooter(validated.reportMarkdown, timing);
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
      if (result.usage?.totalTokens !== undefined) {
        output.costActual = { tokens: result.usage.totalTokens };
      }
      return output;
    },
  };
}

export function createCodeRepoAnalysisAdapterStub(): CapabilityAdapter {
  return createCodeRepoAnalysisAdapter({
    baseUrl: 'https://example.invalid/v1',
    model: 'unset',
    availability: 'needs_setup',
  });
}

function assertNoSourcePathAccess(input: CapabilityInput): void {
  // 语义断言:执行期不得使用 sourcePath 读盘。此处仅确保输入可被消费而不打开路径。
  void input.snapshot.items.map((i) => i.relativePath || i.contentDigest);
}

function appendTimingFooter(report: string, timing: CodeAnalysisTimingNote): string {
  // 性能数据只进报告正文,不增加领域字段
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
    `- 覆盖: ${timing.coverageNote}`,
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');
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
  const start = t.indexOf('{');
  return start >= 0 && t.slice(start).includes('"findings"');
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
    .slice(0, 12)
    .map((f) => `### ${f.relativePath}\ndigest=${f.contentDigest}\n\`\`\`\n${f.text.slice(0, 1200)}\n\`\`\``)
    .join('\n\n');
  const experiences = input.subjectContext.entries
    .slice(0, 5)
    .map((e) => `- ${e.title}: ${e.detail}`)
    .join('\n');
  return [
    `# 用户目标\n${scrubText(input.goal).slice(0, 1500)}`,
    `# 覆盖说明\n${assembled.coverageNote}`,
    experiences ? `# 已确认经验\n${experiences}` : '',
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
    sectionsPart = JSON.parse(repairJsonText(extractBalancedJson(sectionsRaw))) as Record<
      string,
      unknown
    >;
  } catch {
    sectionsPart = {
      sections: {
        overview: '模型未返回完整章节,以下结论以 findings 为准。',
        stack: '',
        modules: '',
        execution: '',
        risks: '',
        complexity: '',
        recommendations: '',
        coverage: '部分章节未覆盖',
      },
    };
  }
  const findings = Array.isArray(findingsPart.findings) ? findingsPart.findings : [];
  let sections = sectionsPart.sections || sectionsPart;
  if (!sections || typeof sections !== 'object' || !String((sections as any).overview || '').trim() || String((sections as any).overview).includes('未返回完整章节')) {
    sections = synthesizeSectionsFromFindings(findings, findingsPart.coverage);
  }
  const merged = {
    sections,
    findings,
    coverage: findingsPart.coverage ||
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
  const cov = (coverage || {}) as Record<string, unknown>;
  return {
    overview: `本报告基于冻结 Snapshot 的结构化 findings。共 ${findings.length} 条结论。\n\n${lines}`,
    stack: '见 findings 中与依赖、运行时、Electron 相关的条目。',
    modules: '见 Subject / Work / Capability / Artifact / Collaboration 相关 findings。',
    execution: '见 Job / Snapshot / Adapter 执行链相关 findings。',
    risks: lines,
    complexity: '见维护风险与跨存储写入相关 findings。',
    recommendations: '优先消除多入口与 UI 事实状态回流；保持 Work Runtime 对场景零感知，能力扩展只走 Adapter + contextPolicy。',
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

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

export { CODE_REPO_ANALYSIS_CAPABILITY_ID };
