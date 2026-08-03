/**
 * P2.1 确定性 code-analysis Adapter — 仅供工程验证,不进入 production 注册。
 * 只消费冻结 Snapshot;不访问 sourcePath、不调模型、不读 SecretStore、
 * 不执行仓库命令、不写用户仓库。报告明确标识为「代码项目结构扫描结果」。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import type { SnapshotItem } from '../../work-runtime/context-snapshot';
import { sanitizeMessage } from '../../work-runtime/snapshot-builder';
import {
  CODE_ANALYSIS_ARTIFACT_TYPE,
  CODE_ANALYSIS_CONTEXT_POLICY,
  CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
  CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
  CODE_REPO_ANALYSIS_CAPABILITY_ID,
  EVIDENCE_EXCERPT_MAX_CHARS,
  type CodeAnalysisBundleManifest,
  type CodeAnalysisEvidenceFile,
  type CodeAnalysisEvidenceRef,
  type CodeBundleRole,
} from './code-repo-analysis-contract';

export const DETERMINISTIC_CODE_ANALYSIS_ADAPTER_ID = 'code-repo-analysis-deterministic';

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.c': 'C',
  '.h': 'C/C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.html': 'HTML',
  '.vue': 'Vue',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.sh': 'Shell',
  '.ps1': 'PowerShell',
};

const CONFIG_BASENAMES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'dockerfile',
  'electron-builder.yml',
  'electron-builder.yaml',
  'electron-builder.json',
]);

export function buildDeterministicCodeAnalysisRegistration(): CapabilityRegistration {
  return {
    id: CODE_REPO_ANALYSIS_CAPABILITY_ID,
    kind: 'tool',
    displayName: '代码项目分析',
    description: '基于冻结材料快照生成代码项目结构扫描结果（工程验证）',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: [CODE_ANALYSIS_ARTIFACT_TYPE],
    /** 确定性验证 Adapter:不触网、不读密钥、不读用户仓库。 */
    permissions: [],
    cost: { estimate: '本地计算,无调用费用' },
    latencyEstimate: '数秒内',
    location: 'local',
    availability: 'available',
    adapter: { type: 'local-tool', adapterId: DETERMINISTIC_CODE_ANALYSIS_ADAPTER_ID },
    contextPolicy: CODE_ANALYSIS_CONTEXT_POLICY,
  };
}

export function createDeterministicCodeAnalysisAdapter(): CapabilityAdapter {
  return {
    registration: buildDeterministicCodeAnalysisRegistration(),
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (ctx.signal.aborted) throw abortError();
      ctx.reportProgress('正在整理代码项目结构');

      const okItems = input.snapshot.items.filter(
        (i) => i.status === 'ok' && i.extractedTextRef && i.contentDigest,
      );
      const warningItems = input.snapshot.items.filter((i) => i.status === 'warning');
      const ingestion = input.snapshot.ingestion;

      const fileViews = await Promise.all(
        okItems.map(async (item) => {
          const text = ctx.readExtractedText
            ? await ctx.readExtractedText(item.extractedTextRef!)
            : '';
          return { item, text: scrubText(text) };
        }),
      );

      if (ctx.signal.aborted) throw abortError();

      const languages = computeLanguages(fileViews.map((f) => f.item));
      const configs = detectConfigs(fileViews);
      const scripts = detectNpmScripts(fileViews);
      const topDirs = detectTopDirs(fileViews.map((f) => f.item));
      const electronShell = detectElectronShell(fileViews);

      const evidence = buildEvidence({ fileViews, languages, configs, scripts });
      const report = buildReport({
        goal: input.goal,
        fileViews,
        languages,
        configs,
        scripts,
        topDirs,
        electronShell,
        ingestion,
        warningItems,
        evidence,
      });

      const entrySpecs: Array<{
        role: CodeBundleRole;
        fileName: string;
        mediaType: string;
        body: string;
      }> = [
        { role: 'report', fileName: 'report.md', mediaType: 'text/markdown', body: report },
        {
          role: 'evidence',
          fileName: 'evidence.json',
          mediaType: 'application/json',
          body: JSON.stringify(evidence, null, 2),
        },
      ];

      // manifest 最后写,entries 必须与最终 bundle 一致
      const manifest: CodeAnalysisBundleManifest = {
        schemaVersion: CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        repo: {
          rootName: ingestion?.rootName || inferRootName(fileViews.map((f) => f.item)),
          fileCountScanned: ingestion?.fileCountScanned ?? okItems.length,
          totalBytesScanned:
            ingestion?.totalBytesScanned ??
            okItems.reduce((sum, i) => sum + (i.bytes ?? 0), 0),
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
        warnings: collectWarnings(ingestion, warningItems),
      };

      assertManifestConsistent(manifest, [...entrySpecs.map((e) => e.role), 'manifest']);
      const sealedManifestBody = JSON.stringify(manifest, null, 2);

      await fs.mkdir(ctx.workDir, { recursive: true });
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

      return {
        artifact: {
          type: CODE_ANALYSIS_ARTIFACT_TYPE,
          title: '代码项目结构扫描结果',
          payload: { kind: 'bundle', entries: written },
        },
      };
    },
  };
}

function assertManifestConsistent(
  manifest: CodeAnalysisBundleManifest,
  roles: string[],
): void {
  if (manifest.entries.length !== roles.length) {
    throw new Error('manifest entries count mismatch');
  }
  for (let i = 0; i < roles.length; i += 1) {
    if (manifest.entries[i]?.role !== roles[i]) {
      throw new Error('manifest entries role mismatch');
    }
    const p = manifest.entries[i]!.path;
    if (p.includes(':') || p.startsWith('/') || p.includes('..')) {
      throw new Error('manifest path must be relative and safe');
    }
  }
}

function computeLanguages(
  items: SnapshotItem[],
): Array<{ language: string; files: number; bytes: number }> {
  const map = new Map<string, { files: number; bytes: number }>();
  for (const item of items) {
    const rel = item.relativePath || path.basename(item.sourcePath);
    const ext = path.extname(rel).toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (!lang) continue;
    const cur = map.get(lang) ?? { files: 0, bytes: 0 };
    cur.files += 1;
    cur.bytes += item.bytes ?? 0;
    map.set(lang, cur);
  }
  return [...map.entries()]
    .map(([language, v]) => ({ language, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

function detectConfigs(
  fileViews: Array<{ item: SnapshotItem; text: string }>,
): Array<{ path: string; digest: string; kind: string }> {
  const out: Array<{ path: string; digest: string; kind: string }> = [];
  for (const { item } of fileViews) {
    const rel = (item.relativePath || path.basename(item.sourcePath)).replace(/\\/g, '/');
    const base = path.basename(rel).toLowerCase();
    if (CONFIG_BASENAMES.has(base) || base.endsWith('config.json') || base.endsWith('config.js')) {
      out.push({
        path: rel,
        digest: item.contentDigest!,
        kind: base,
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function detectNpmScripts(
  fileViews: Array<{ item: SnapshotItem; text: string }>,
): Array<{ name: string; command: string; path: string; digest: string; excerpt: string }> {
  const pkg = fileViews.find((f) => {
    const rel = (f.item.relativePath || '').replace(/\\/g, '/');
    return rel === 'package.json' || rel.endsWith('/package.json');
  });
  if (!pkg) return [];
  try {
    const parsed = JSON.parse(pkg.text) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts || {};
    return Object.entries(scripts)
      .slice(0, 20)
      .map(([name, command]) => ({
        name,
        command: scrubText(String(command)).slice(0, 120),
        path: (pkg.item.relativePath || 'package.json').replace(/\\/g, '/'),
        digest: pkg.item.contentDigest!,
        excerpt: scrubText(`"${name}": "${command}"`).slice(0, EVIDENCE_EXCERPT_MAX_CHARS),
      }));
  } catch {
    return [];
  }
}

function detectTopDirs(items: SnapshotItem[]): string[] {
  const dirs = new Set<string>();
  for (const item of items) {
    const rel = (item.relativePath || '').replace(/\\/g, '/');
    const first = rel.split('/')[0];
    if (first && first.includes('.')) continue;
    if (first) dirs.add(first);
  }
  return [...dirs].sort();
}

function detectElectronShell(
  fileViews: Array<{ item: SnapshotItem; text: string }>,
): boolean {
  return fileViews.some((f) => {
    const rel = (f.item.relativePath || '').replace(/\\/g, '/').toLowerCase();
    if (rel.startsWith('electron/') || rel.includes('/electron/')) return true;
    if (rel === 'package.json' || rel.endsWith('/package.json')) {
      return /electron/i.test(f.text);
    }
    return false;
  });
}

function buildEvidence(input: {
  fileViews: Array<{ item: SnapshotItem; text: string }>;
  languages: Array<{ language: string; files: number; bytes: number }>;
  configs: Array<{ path: string; digest: string; kind: string }>;
  scripts: Array<{
    name: string;
    command: string;
    path: string;
    digest: string;
    excerpt: string;
  }>;
}): CodeAnalysisEvidenceFile {
  const items: CodeAnalysisEvidenceRef[] = [];
  const digestSet = new Set(
    input.fileViews.map((f) => f.item.contentDigest).filter(Boolean) as string[],
  );

  if (input.languages[0]) {
    const sample = input.fileViews.find((f) => {
      const ext = path.extname(f.item.relativePath || '').toLowerCase();
      return LANGUAGE_BY_EXT[ext] === input.languages[0]!.language;
    });
    if (sample?.item.contentDigest && digestSet.has(sample.item.contentDigest)) {
      items.push({
        claimId: 'lang_primary',
        path: (sample.item.relativePath || path.basename(sample.item.sourcePath)).replace(
          /\\/g,
          '/',
        ),
        contentDigest: sample.item.contentDigest,
        excerpt: scrubText(sample.text).slice(0, EVIDENCE_EXCERPT_MAX_CHARS),
      });
    }
  }

  for (const [i, cfg] of input.configs.slice(0, 8).entries()) {
    if (!digestSet.has(cfg.digest)) continue;
    items.push({
      claimId: `config_${i}`,
      path: cfg.path,
      contentDigest: cfg.digest,
    });
  }

  for (const [i, script] of input.scripts.slice(0, 8).entries()) {
    if (!digestSet.has(script.digest)) continue;
    items.push({
      claimId: `script_${i}`,
      path: script.path,
      contentDigest: script.digest,
      excerpt: script.excerpt.slice(0, EVIDENCE_EXCERPT_MAX_CHARS),
    });
  }

  return {
    schemaVersion: CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
    items,
  };
}

function buildReport(input: {
  goal: string;
  fileViews: Array<{ item: SnapshotItem; text: string }>;
  languages: Array<{ language: string; files: number; bytes: number }>;
  configs: Array<{ path: string; digest: string; kind: string }>;
  scripts: Array<{ name: string; command: string }>;
  topDirs: string[];
  electronShell: boolean;
  ingestion: CapabilityInput['snapshot']['ingestion'];
  warningItems: SnapshotItem[];
  evidence: CodeAnalysisEvidenceFile;
}): string {
  const lines: string[] = [];
  lines.push('# 代码项目结构扫描结果');
  lines.push('');
  lines.push(
    '> 本报告为基于冻结材料的确定性结构扫描，不是完整架构审查或代码质量结论。',
  );
  lines.push('');
  lines.push(`任务目标：${scrubText(input.goal).slice(0, 200)}`);
  lines.push('');
  lines.push('## 概览');
  lines.push('');
  lines.push(
    `- 扫描文件数：${input.ingestion?.fileCountScanned ?? input.fileViews.length}`,
  );
  lines.push(
    `- 扫描字节数：${input.ingestion?.totalBytesScanned ?? 0}`,
  );
  lines.push(`- 是否截断：${input.ingestion?.truncated ? '是' : '否'}`);
  lines.push(
    `- 敏感跳过：${input.ingestion?.skippedSensitiveCount ?? 0}`,
  );
  lines.push(
    `- 预算跳过：${input.ingestion?.skippedBudgetCount ?? 0}`,
  );
  lines.push('');
  lines.push('## 目录概览');
  lines.push('');
  if (input.topDirs.length === 0) {
    lines.push('（未识别到顶层目录）');
  } else {
    for (const d of input.topDirs) {
      lines.push(`- \`${d}/\`（证据：目录枚举）`);
    }
  }
  if (input.electronShell) {
    lines.push('- 识别到 Electron 壳相关文件或依赖');
  }
  lines.push('');
  lines.push('## 语言分布');
  lines.push('');
  if (input.languages.length === 0) {
    lines.push('（未识别到主要语言）');
  } else {
    for (const lang of input.languages) {
      lines.push(
        `- ${lang.language}：${lang.files} 个文件，约 ${lang.bytes} 字节` +
          (lang === input.languages[0] ? '（证据 claimId=`lang_primary`）' : ''),
      );
    }
  }
  lines.push('');
  lines.push('## 关键配置文件');
  lines.push('');
  if (input.configs.length === 0) {
    lines.push('（未识别）');
  } else {
    for (const [i, cfg] of input.configs.entries()) {
      lines.push(`- \`${cfg.path}\`（证据 claimId=\`config_${i}\`）`);
    }
  }
  lines.push('');
  lines.push('## 启动/测试脚本摘要');
  lines.push('');
  if (input.scripts.length === 0) {
    lines.push('（未识别到 npm scripts）');
  } else {
    for (const [i, s] of input.scripts.entries()) {
      lines.push(`- \`${s.name}\`: ${s.command}（证据 claimId=\`script_${i}\`）`);
    }
  }
  lines.push('');
  lines.push('## 截断、跳过与警告');
  lines.push('');
  const warns = collectWarnings(input.ingestion, input.warningItems);
  if (warns.length === 0) {
    lines.push('无');
  } else {
    for (const w of warns) lines.push(`- ${w}`);
  }
  lines.push('');
  lines.push(`证据条目数：${input.evidence.items.length}`);
  lines.push('');
  return lines.join('\n');
}

function collectWarnings(
  ingestion: CapabilityInput['snapshot']['ingestion'],
  warningItems: SnapshotItem[],
): string[] {
  const out: string[] = [];
  if (ingestion?.skippedSensitiveCount) {
    out.push(`已跳过 ${ingestion.skippedSensitiveCount} 个敏感或凭证类文件`);
  }
  if (ingestion?.skippedBudgetCount) {
    out.push(`因预算限制跳过 ${ingestion.skippedBudgetCount} 个文件`);
  }
  if (ingestion?.truncated) {
    out.push('扫描结果为部分结果（已截断）');
  }
  for (const w of warningItems.slice(0, 20)) {
    if (w.warning) out.push(sanitizeMessage(w.warning));
  }
  return out;
}

function inferRootName(items: SnapshotItem[]): string {
  if (items.length === 0) return 'repository';
  const first = items[0]!.sourcePath;
  const parts = first.split(/[/\\]/);
  return parts.length >= 2 ? parts[parts.length - 2]! : 'repository';
}

function scrubText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=[redacted]');
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
