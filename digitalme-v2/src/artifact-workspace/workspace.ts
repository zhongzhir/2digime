import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import type { ObjectStore } from '../runtime/ports';
import type { ContentStore } from '../infrastructure/content-store';
import { exportDocx, exportMarkdown } from '../infrastructure/export';
import { newId, nowIso } from '../shared/ids';
import type { ArtifactWorkspacePort, ExportFormat } from './contracts';
import {
  headVersion,
  type Artifact,
  type ArtifactContent,
  type ArtifactVersion,
} from '../work-runtime/artifact';
import { InMemoryEventBus } from '../work-runtime/event-bus';
import { extractEditEvidence } from '../subject-core/diff-evidence';
import type { GrowthEvent } from '../subject-core/growth-event';
import type { SubjectService } from '../subject-core/subject-service';
import type { ChatMessage } from '../infrastructure/model-http';
import { deriveJobEffectiveGoal } from '../execution/effective-goal';

function excerptsFromUnifiedDiff(
  diff: string,
  files: string[],
): Array<{ path: string; excerpt: string }> {
  const text = String(diff || '');
  const out: Array<{ path: string; excerpt: string }> = [];
  for (const file of files.slice(0, 8)) {
    const norm = String(file || '').replace(/\\/g, '/');
    if (!norm) continue;
    const base = norm.split('/').pop() || norm;
    const idx = text.indexOf(base);
    if (idx < 0) continue;
    out.push({
      path: norm,
      excerpt: text.slice(Math.max(0, idx - 40), idx + 560),
    });
  }
  return out;
}

function dropStaleLocateItems(items: string[]): string[] {
  return items.filter((item) => !/无需修改|当前代码已满足目标/.test(String(item || '')));
}

export interface ArtifactWorkspaceOptions {
  artifactStore: ObjectStore<Artifact>;
  contentStore: ContentStore;
  subjectService: SubjectService;
  eventBus: InMemoryEventBus;
  /** 从 Task 取主题词,写入 candidate tags 以便相似任务命中。 */
  resolveTaskTopics?: (taskId: string) => Promise<string[]>;
  /** D11-C 独立 CTO 验收模型通道；缺省时明确返回无法独立验收。 */
  ctoReviewChat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
}

/**
 * Artifact Workspace — 查看/编辑/导出。
 * saveEdit 追加 user 版本;后台确定性提炼 candidate GrowthEvent。
 * 回流失败不影响已保存的 Artifact / Job。
 */
export class ArtifactWorkspace implements ArtifactWorkspacePort {
  private readonly artifactStore: ObjectStore<Artifact>;
  private readonly contentStore: ContentStore;
  private readonly subjectService: SubjectService;
  private readonly eventBus: InMemoryEventBus;
  private readonly resolveTaskTopics?: (taskId: string) => Promise<string[]>;
  private readonly ctoReviewChat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
  /** 同一成果版本+核对摘要只跑一次 AI CTO，避免每次 getContent 重放。 */
  private readonly ctoSummaryCache = new Map<string, unknown>();

  constructor(options: ArtifactWorkspaceOptions) {
    this.artifactStore = options.artifactStore;
    this.contentStore = options.contentStore;
    this.subjectService = options.subjectService;
    this.eventBus = options.eventBus;
    if (options.resolveTaskTopics) this.resolveTaskTopics = options.resolveTaskTopics;
    if (options.ctoReviewChat) this.ctoReviewChat = options.ctoReviewChat;
  }

  async getContent(
    artifactId: string,
    versionId?: string,
    expectedTaskId?: string,
  ): Promise<{
    artifact: Artifact;
    content: ArtifactContent;
    text?: string;
    /** 人工改过报告但证据/清单仍为旧版时为 true。 */
    evidenceStale?: boolean;
    bundle?: {
      entries: Array<{ role?: string; mediaType: string; text?: string }>;
      manifestSummary?: {
        fileCountScanned: number;
        languages: Array<{ language: string; files: number; bytes: number }>;
        truncated: boolean;
        skippedSensitiveCount: number;
        warnings: string[];
        quality?: { grade: string; reasons: string[] };
      };
    };
  }> {
    const artifact = await this.requireArtifact(artifactId);
    if (expectedTaskId && artifact.taskId !== expectedTaskId) {
      throw new Error('这项成果不属于当前任务');
    }
    const version = versionId
      ? artifact.versions.find((v) => v.versionId === versionId)
      : headVersion(artifact);
    if (!version) throw new Error(`version not found: ${versionId}`);
    const result: {
      artifact: Artifact;
      content: ArtifactContent;
      text?: string;
      evidenceStale?: boolean;
      bundle?: {
        entries: Array<{ role?: string; mediaType: string; text?: string }>;
        manifestSummary?: {
          fileCountScanned: number;
          languages: Array<{ language: string; files: number; bytes: number }>;
          truncated: boolean;
          skippedSensitiveCount: number;
          warnings: string[];
          quality?: { grade: string; reasons: string[] };
        };
      };
    } = {
      artifact,
      content: version.content,
    };
    if (
      version.content.kind === 'bundle' &&
      version.author === 'user' &&
      (version.note === 'manual_report_edit' || !version.note)
    ) {
      result.evidenceStale = true;
    }
    if (version.content.kind === 'text') {
      result.text = await this.contentStore.getText(version.content);
    } else if (version.content.kind === 'bundle') {
      const entries: Array<{ role?: string; mediaType: string; text?: string }> = [];
      for (const entry of version.content.entries) {
        const item: { role?: string; mediaType: string; text?: string } = {
          mediaType: entry.mediaType,
        };
        if (entry.role !== undefined) item.role = entry.role;
        if (
          entry.mediaType.startsWith('text/') ||
          entry.mediaType === 'application/json' ||
          entry.mediaType === 'text/markdown'
        ) {
          try {
            item.text = (await this.contentStore.readBytes(entry.ref)).toString('utf8');
          } catch {
            // 单条失败不影响整体
          }
        }
        entries.push(item);
      }
      const report =
        entries.find((e) => e.role === 'execution-summary') ||
        entries.find((e) => e.role === 'report');
      if (report?.text) result.text = report.text;
      let manifestSummary:
        | {
            fileCountScanned: number;
            languages: Array<{ language: string; files: number; bytes: number }>;
            truncated: boolean;
            skippedSensitiveCount: number;
            warnings: string[];
            quality?: { grade: string; reasons: string[] };
          }
        | undefined;
      let codeChange:
        | {
            workingDirectory?: string;
            projectName?: string;
            verificationOverall?: string;
            verificationLabel?: string;
            summary?: string;
            changedFiles?: string[];
            changes?: Array<{
              path: string;
              status: 'added' | 'modified' | 'deleted' | 'unknown';
            }>;
            unifiedDiff?: string;
            testResults?: Array<{
              command: string;
              passed: boolean;
              summary?: string;
              logExcerpt?: string;
            }>;
            unresolvedItems?: string[];
            risks?: string[];
            understanding?: {
              goal?: string;
              keyFiles?: Array<{ path: string; reason: string }>;
              planSteps?: string[];
              proposedTests?: string[];
              risks?: string[];
              subjectConstraints?: string[];
            };
            afterScopeDigest?: string;
            directoryChangedSinceResult?: boolean;
            digitalMeVerified?: boolean;
            agentClaimedSuccess?: boolean;
            revisionRequest?: string;
            checks?: Array<{
              id: string;
              title: string;
              verdict: string;
              detail?: string;
            }>;
            runInfo?: {
              runnable: boolean;
              kind?: string;
              label?: string;
              command?: string;
              entryPath?: string;
              reason?: string;
              canSuggestTryRun?: boolean;
            };
            acceptanceSummary?: {
              title: string;
              headline?: string;
              executionStatusLabel?: string;
              goalLabel: string;
              goalVerdict?: string;
              recommendation: string;
              bullets: string[];
              technicalBullets?: string[];
              adoptWarnings?: string[];
              canAdoptSuggested: boolean;
              ctoReport?: string;
              primaryAction?: string;
              userFacingNextStep?: string;
              revisionDirective?: string;
            };
          }
        | undefined;
      const manifestEntry = entries.find((e) => e.role === 'manifest');
      if (manifestEntry?.text) {
        try {
          const parsed = JSON.parse(manifestEntry.text) as {
            repo?: {
              fileCountScanned?: number;
              truncated?: boolean;
              skippedSensitiveCount?: number;
            };
            languages?: Array<{ language: string; files: number; bytes: number }>;
            warnings?: string[];
            quality?: { grade: string; reasons: string[] };
            workingDirectory?: string;
            verificationOverall?: string;
            changedFiles?: string[];
            afterScopeDigest?: string;
            artifactType?: string;
            writeScope?: string[];
            digitalMeVerified?: boolean;
            agentClaimedSuccess?: boolean;
            outOfScopeChanges?: string[];
            risks?: string[];
            checks?: Array<{
              id: string;
              title: string;
              verdict: 'satisfied' | 'partially_satisfied' | 'unsatisfied' | 'unverifiable';
              detail?: string;
            }>;
          };
          if (parsed.artifactType === 'code-change' || parsed.workingDirectory) {
            const { userFacingVerification } = await import(
              '../execution/external-executor-contract'
            );
            const { buildOwnerAcceptanceSummaryAsync } = await import(
              '../execution/acceptance-summary'
            );
            const { computeScopeDigest } = await import('../execution/baseline');
            let directoryChangedSinceResult = false;
            if (parsed.workingDirectory && parsed.afterScopeDigest && parsed.writeScope) {
              try {
                const nowDigest = await computeScopeDigest(
                  parsed.workingDirectory,
                  parsed.writeScope as string[],
                );
                directoryChangedSinceResult = nowDigest !== parsed.afterScopeDigest;
              } catch {
                directoryChangedSinceResult = false;
              }
            } else if (parsed.workingDirectory && parsed.afterScopeDigest) {
              try {
                const nowDigest = await computeScopeDigest(parsed.workingDirectory, ['.']);
                directoryChangedSinceResult = nowDigest !== parsed.afterScopeDigest;
              } catch {
                directoryChangedSinceResult = false;
              }
            }

            const summaryEntry = entries.find((e) => e.role === 'execution-summary');
            const changedEntry = entries.find((e) => e.role === 'changed-files');
            const diffEntry = entries.find((e) => e.role === 'diff');
            const testsEntry = entries.find((e) => e.role === 'tests');
            const evidenceEntry = entries.find((e) => e.role === 'evidence');
            const unresolvedEntry = entries.find(
              (e) => e.role === 'unresolved' || e.role === 'unresolved-items',
            );

            let changes: Array<{
              path: string;
              status: 'added' | 'modified' | 'deleted' | 'unknown';
            }> = [];
            let outOfScopeFromBundle: string[] = [];
            if (changedEntry?.text) {
              try {
                const cf = JSON.parse(changedEntry.text) as {
                  changes?: Array<{ relativePath?: string; path?: string; changeType?: string; status?: string }>;
                  changedFiles?: string[];
                  outOfScopeChanges?: string[];
                };
                if (Array.isArray(cf.outOfScopeChanges)) {
                  outOfScopeFromBundle = cf.outOfScopeChanges.map(String).filter(Boolean);
                }
                if (Array.isArray(cf.changes) && cf.changes.length) {
                  changes = cf.changes.map((c) => {
                    const st = String(c.changeType || c.status || '').toLowerCase();
                    const status: 'added' | 'modified' | 'deleted' | 'unknown' =
                      st === 'added' || st === 'created'
                        ? 'added'
                        : st === 'deleted' || st === 'removed'
                          ? 'deleted'
                          : st === 'modified' || st === 'changed'
                            ? 'modified'
                            : 'unknown';
                    return {
                      path: String(c.relativePath || c.path || ''),
                      status,
                    };
                  }).filter((c) => c.path);
                } else if (Array.isArray(cf.changedFiles)) {
                  changes = cf.changedFiles.map((p) => ({
                    path: String(p),
                    status: 'modified' as const,
                  }));
                }
              } catch {
                /* ignore */
              }
            }

            let testResults: Array<{
              command: string;
              passed: boolean;
              summary?: string;
              logExcerpt?: string;
            }> = [];
            if (testsEntry?.text) {
              try {
                const tj = JSON.parse(testsEntry.text) as {
                  results?: Array<{
                    command?: string;
                    passed?: boolean;
                    summary?: string;
                    logExcerpt?: string;
                    logRel?: string;
                  }>;
                };
                testResults = (tj.results || []).map((r) => ({
                  command: String(r.command || ''),
                  passed: !!r.passed,
                  ...(r.summary ? { summary: String(r.summary).slice(0, 400) } : {}),
                  ...(r.logExcerpt
                    ? { logExcerpt: String(r.logExcerpt).slice(0, 4000) }
                    : {}),
                }));
              } catch {
                /* ignore */
              }
            }

            let unresolvedItems: string[] = [];
            if (unresolvedEntry?.text) {
              unresolvedItems = unresolvedEntry.text
                .split(/\r?\n/)
                .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
                .filter(
                  (l) =>
                    l &&
                    l !== '（无）' &&
                    !l.startsWith('#') &&
                    l !== '警告' &&
                    l !== '提问' &&
                    l !== '风险',
                );
            }

            let risks: string[] = Array.isArray(parsed.risks)
              ? parsed.risks.map((r) => String(r || '').trim()).filter(Boolean).slice(0, 12)
              : [];
            if (!risks.length && unresolvedEntry?.text) {
              const riskSection = unresolvedEntry.text.match(
                /##\s*风险\s*([\s\S]*?)(?=\n##\s|$)/,
              );
              if (riskSection?.[1]) {
                risks = riskSection[1]
                  .split(/\r?\n/)
                  .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
                  .filter((l) => l && l !== '（无）' && l !== '（无额外风险说明）')
                  .slice(0, 12);
              }
            }
            if (!risks.length && summaryEntry?.text) {
              const riskSection = summaryEntry.text.match(/##\s*风险\s*([\s\S]*?)(?=\n##\s|$)/);
              if (riskSection?.[1]) {
                risks = riskSection[1]
                  .split(/\r?\n/)
                  .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
                  .filter((l) => l && l !== '（无）' && l !== '（无额外风险说明）')
                  .slice(0, 12);
              }
            }

            let understanding:
              | {
                  goal?: string;
                  keyFiles?: Array<{ path: string; reason: string }>;
                  planSteps?: string[];
                  proposedTests?: string[];
                  risks?: string[];
                  subjectConstraints?: string[];
                }
              | undefined;
            if (evidenceEntry?.text) {
              try {
                const ev = JSON.parse(evidenceEntry.text) as {
                  understanding?: {
                    goal?: string;
                    keyFiles?: Array<{ path: string; reason: string }>;
                    planSteps?: string[];
                    proposedTests?: string[];
                    risks?: string[];
                    subjectConstraints?: string[];
                  };
                };
                if (ev.understanding) {
                  const uParsed = ev.understanding;
                  understanding = {
                    ...(uParsed.goal ? { goal: String(uParsed.goal).slice(0, 400) } : {}),
                    ...(Array.isArray(uParsed.keyFiles)
                      ? {
                          keyFiles: uParsed.keyFiles
                            .map((f) => ({
                              path: String(f.path || ''),
                              reason: String(f.reason || ''),
                            }))
                            .filter((f) => f.path)
                            .slice(0, 12),
                        }
                      : {}),
                    ...(Array.isArray(uParsed.planSteps)
                      ? {
                          planSteps: uParsed.planSteps
                            .map((s) => String(s || '').trim())
                            .filter(Boolean)
                            .slice(0, 8),
                        }
                      : {}),
                    ...(Array.isArray(uParsed.proposedTests)
                      ? {
                          proposedTests: uParsed.proposedTests
                            .map((s) => String(s || '').trim())
                            .filter(Boolean)
                            .slice(0, 6),
                        }
                      : {}),
                    ...(Array.isArray(uParsed.risks)
                      ? {
                          risks: uParsed.risks
                            .map((s) => String(s || '').trim())
                            .filter(Boolean)
                            .slice(0, 12),
                        }
                      : {}),
                    ...(Array.isArray(uParsed.subjectConstraints)
                      ? {
                          subjectConstraints: uParsed.subjectConstraints
                            .map((s) => String(s || '').trim())
                            .filter(Boolean)
                            .slice(0, 8),
                        }
                      : {}),
                  };
                  if (!risks.length && understanding.risks?.length) {
                    risks = understanding.risks;
                  }
                }
              } catch {
                /* ignore */
              }
            }
            if (!understanding && summaryEntry?.text) {
              const goalSec = summaryEntry.text.match(/##\s*任务理解\s*([\s\S]*?)(?=\n##\s|$)/);
              const planSec = summaryEntry.text.match(/##\s*方案\s*([\s\S]*?)(?=\n##\s|$)/);
              if (goalSec?.[1] || planSec?.[1]) {
                const goalBody = (goalSec?.[1] || '').trim();
                const goalLine = goalBody.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
                const keyFiles = (goalBody.match(/^\s*[-*]\s*([^：:]+)[：:](.+)$/gm) || [])
                  .map((line) => {
                    const m = line.match(/^\s*[-*]\s*([^：:]+)[：:](.+)$/);
                    return {
                      path: String(m?.[1] || '').trim(),
                      reason: String(m?.[2] || '').trim(),
                    };
                  })
                  .filter((f) => f.path);
                const planSteps = (planSec?.[1] || '')
                  .split(/\r?\n/)
                  .map((l) => l.replace(/^\s*\d+\.\s*/, '').trim())
                  .filter(Boolean)
                  .slice(0, 8);
                understanding = {
                  ...(goalLine ? { goal: goalLine.slice(0, 400) } : {}),
                  ...(keyFiles.length ? { keyFiles } : {}),
                  ...(planSteps.length ? { planSteps } : {}),
                  ...(risks.length ? { risks } : {}),
                };
              }
            }

            const projectName = parsed.workingDirectory
              ? parsed.workingDirectory.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || undefined
              : undefined;

            codeChange = {
              ...(parsed.workingDirectory
                ? { workingDirectory: parsed.workingDirectory }
                : {}),
              ...(projectName ? { projectName } : {}),
              ...(parsed.verificationOverall
                ? {
                    verificationOverall: parsed.verificationOverall,
                    verificationLabel: userFacingVerification(
                      parsed.verificationOverall as
                        | 'satisfied'
                        | 'partially_satisfied'
                        | 'unsatisfied'
                        | 'unverifiable',
                    ),
                  }
                : {}),
              ...(typeof parsed.digitalMeVerified === 'boolean'
                ? { digitalMeVerified: parsed.digitalMeVerified }
                : {}),
              ...(typeof parsed.agentClaimedSuccess === 'boolean'
                ? { agentClaimedSuccess: parsed.agentClaimedSuccess }
                : {}),
              ...(summaryEntry?.text
                ? {
                    summary: summaryEntry.text
                      .replace(/^#\s*执行摘要\s*/m, '')
                      .trim()
                      .slice(0, 6000),
                  }
                : {}),
              ...(parsed.changedFiles ? { changedFiles: parsed.changedFiles } : {}),
              ...(changes.length ? { changes } : {}),
              ...(diffEntry?.text ? { unifiedDiff: diffEntry.text.slice(0, 200_000) } : {}),
              ...(testResults.length ? { testResults } : {}),
              ...(unresolvedItems.length ? { unresolvedItems } : {}),
              ...(risks.length ? { risks } : {}),
              ...(understanding ? { understanding } : {}),
              ...(parsed.afterScopeDigest
                ? { afterScopeDigest: parsed.afterScopeDigest }
                : {}),
              directoryChangedSinceResult,
            };
            if (
              version.note &&
              version.author === 'capability' &&
              version.note !== 'manual_report_edit'
            ) {
              codeChange.revisionRequest = version.note;
            } else {
              // 回退：从同 Task 的 Job lineage 取（由上层 command-bus 可再补）
            }
            if (parsed.workingDirectory) {
              try {
                const { detectProjectRunInfo } = await import('../execution/run-detection');
                const knownCommands = (testResults || [])
                  .map((t) => t.command)
                  .filter(Boolean);
                codeChange.runInfo = await detectProjectRunInfo(parsed.workingDirectory, {
                  knownCommands,
                });
              } catch {
                codeChange.runInfo = { runnable: false, reason: '还不能可靠自动打开这个程序' };
              }
            }
            if (parsed.verificationOverall) {
              const checks = Array.isArray(parsed.checks)
                ? parsed.checks.map((c) => ({
                    id: c.id,
                    title: c.title,
                    verdict: c.verdict,
                    detail: c.detail ?? '',
                  }))
                : [];
              const changedFileCount = changes.length || (parsed.changedFiles || []).length;
              const effectiveGoal = deriveJobEffectiveGoal({
                taskGoal: String(understanding?.goal || '').trim(),
                confirmedPlan: (understanding?.planSteps || []).join('\n'),
                ...(codeChange.revisionRequest
                  ? { revisionRequest: codeChange.revisionRequest }
                  : {}),
                currentPlan: (understanding?.planSteps || []).join('\n'),
              });
              const ctoCacheKey = [
                artifactId,
                version.versionId,
                parsed.verificationOverall,
                checks.map((c) => `${c.id}:${c.verdict}`).join(','),
                String(directoryChangedSinceResult),
                String(changedFileCount),
                effectiveGoal.currentRoundAuthority,
                effectiveGoal.acceptanceTarget.slice(0, 240),
              ].join('|');
              const ctoCacheFile = path.join(
                os.tmpdir(),
                'digitalme-cto-summary',
                `${createHash('sha256').update(ctoCacheKey).digest('hex').slice(0, 24)}.json`,
              );
              let acceptanceSummary = this.ctoSummaryCache.get(ctoCacheKey) as
                | Awaited<ReturnType<typeof buildOwnerAcceptanceSummaryAsync>>
                | undefined;
              if (!acceptanceSummary) {
                try {
                  const raw = await fs.readFile(ctoCacheFile, 'utf8');
                  acceptanceSummary = JSON.parse(raw) as Awaited<
                    ReturnType<typeof buildOwnerAcceptanceSummaryAsync>
                  >;
                } catch {
                  acceptanceSummary = undefined;
                }
              }
              if (!acceptanceSummary) {
                acceptanceSummary = await buildOwnerAcceptanceSummaryAsync({
                verification: {
                  overall: parsed.verificationOverall as
                    | 'satisfied'
                    | 'partially_satisfied'
                    | 'unsatisfied'
                    | 'unverifiable',
                  checks,
                  digitalMeVerified: !!parsed.digitalMeVerified,
                  agentClaimedSuccess: !!parsed.agentClaimedSuccess,
                },
                changedFileCount,
                directoryChangedSinceResult,
                unresolvedItems: dropStaleLocateItems(unresolvedItems),
                ...(summaryEntry?.text ? { summaryExcerpt: summaryEntry.text } : {}),
                evidence: {
                  changedFiles: parsed.changedFiles || changes.map((c) => c.path),
                  changes,
                  ...(diffEntry?.text ? { unifiedDiff: diffEntry.text } : {}),
                  ...(outOfScopeFromBundle.length
                    ? { outOfScopeChanges: outOfScopeFromBundle }
                    : Array.isArray(parsed.outOfScopeChanges)
                      ? { outOfScopeChanges: parsed.outOfScopeChanges as string[] }
                      : {}),
                },
                ...(effectiveGoal.acceptanceTarget
                  ? { userGoal: effectiveGoal.acceptanceTarget }
                  : understanding?.goal
                    ? { userGoal: understanding.goal }
                    : {}),
                ...(effectiveGoal.originalTaskGoal
                  ? { originalTaskGoal: effectiveGoal.originalTaskGoal }
                  : {}),
                ...(effectiveGoal.revisionRequest
                  ? { revisionRequest: effectiveGoal.revisionRequest }
                  : {}),
                currentRoundAuthority: effectiveGoal.currentRoundAuthority,
                ...(understanding?.keyFiles?.length || effectiveGoal.background
                  ? {
                      ...(understanding?.keyFiles?.length
                        ? {
                            understandingKeyFiles: understanding.keyFiles.map((k) => k.path),
                          }
                        : {}),
                      understandingBrief: [
                        effectiveGoal.background,
                        ...(understanding?.keyFiles?.length
                          ? [
                              understanding.keyFiles
                                .map((k) => {
                                  const reason = String(k.reason || '');
                                  if (/无需修改|当前代码已满足目标/.test(reason)) return k.path;
                                  return reason ? `${k.path}：${reason}` : k.path;
                                })
                                .join('；'),
                            ]
                          : []),
                      ]
                        .filter(Boolean)
                        .join('\n'),
                    }
                  : {}),
                ...(understanding?.planSteps?.length
                  ? { planSteps: understanding.planSteps }
                  : {}),
                artifactVersionId: version.versionId,
                jobId: artifact.jobId,
                ...(testResults.length
                  ? {
                      testResults: testResults.map((t) => ({
                        command: t.command,
                        passed: t.passed,
                        ...(t.summary ? { summary: t.summary } : {}),
                      })),
                    }
                  : {}),
                ...(diffEntry?.text
                  ? {
                      changedFileExcerpts: excerptsFromUnifiedDiff(
                        diffEntry.text,
                        parsed.changedFiles || changes.map((c) => c.path),
                      ),
                    }
                  : {}),
                }, this.ctoReviewChat);
                this.ctoSummaryCache.set(ctoCacheKey, acceptanceSummary);
                try {
                  await fs.mkdir(path.dirname(ctoCacheFile), { recursive: true });
                  await fs.writeFile(ctoCacheFile, JSON.stringify(acceptanceSummary), 'utf8');
                } catch {
                  /* 缓存失败不影响验收 */
                }
              } else {
                this.ctoSummaryCache.set(ctoCacheKey, acceptanceSummary);
                const diagDir = String(process.env.DIGITALME_20A_EVIDENCE || '').trim();
                if (diagDir) {
                  try {
                    await fs.appendFile(
                      path.join(diagDir, 'AI_CTO_CACHE.jsonl'),
                      `${JSON.stringify({
                        at: new Date().toISOString(),
                        cacheHit: true,
                        versionId: version.versionId,
                        jobId: artifact.jobId,
                        reusedOldCtoConclusion: false,
                      })}\n`,
                    );
                  } catch {
                    /* ignore */
                  }
                }
              }
              codeChange.acceptanceSummary = acceptanceSummary;
              codeChange.checks = checks;
              const startup = checks.find((c) => c.id === 'run_startup_check');
              if (codeChange.runInfo) {
                // 只有 Digital Me 启动检查明确通过时才允许「可以试用」
                codeChange.runInfo = {
                  ...codeChange.runInfo,
                  canSuggestTryRun: !!(
                    codeChange.runInfo.runnable && startup && startup.verdict === 'satisfied'
                  ),
                };
              }
            } else if (codeChange.runInfo) {
              codeChange.runInfo = {
                ...codeChange.runInfo,
                canSuggestTryRun: false,
              };
            }
          } else {
            manifestSummary = {
              fileCountScanned: parsed.repo?.fileCountScanned ?? 0,
              languages: parsed.languages ?? [],
              truncated: parsed.repo?.truncated ?? false,
              skippedSensitiveCount: parsed.repo?.skippedSensitiveCount ?? 0,
              warnings: parsed.warnings ?? [],
              ...(parsed.quality ? { quality: parsed.quality } : {}),
            };
          }
        } catch {
          // ignore
        }
      }
      result.bundle = {
        entries: entries.map((e) => ({
          ...(e.role !== undefined ? { role: e.role } : {}),
          mediaType: e.mediaType,
          ...(e.text !== undefined ? { text: e.text } : {}),
        })),
        ...(manifestSummary ? { manifestSummary } : {}),
      };
      if (codeChange) {
        (result as { codeChange?: typeof codeChange }).codeChange = codeChange;
      }
    }
    return result;
  }

  async saveEdit(artifactId: string, text: string): Promise<{ version: ArtifactVersion }> {
    const artifact = await this.requireArtifact(artifactId);
    const previous = headVersion(artifact);
    let previousText = '';
    let nextContent: ArtifactContent;

    if (previous.content.kind === 'text') {
      previousText = await this.contentStore.getText(previous.content);
      const stored = await this.contentStore.putText(text, previous.content.format);
      nextContent = stored.content;
    } else if (previous.content.kind === 'bundle') {
      // P2.2:允许修改 bundle 中的 report 文本以回流成长;其他条目保持不变。
      const tmpDir = path.join(artifact.storageDir, '_edit-tmp');
      await fs.mkdir(tmpDir, { recursive: true });
      const rebuilt: Array<{ sourcePath: string; mediaType: string; role?: string }> = [];
      for (const entry of previous.content.entries) {
        const role = entry.role || 'entry';
        const fileName =
          role === 'report'
            ? 'report.md'
            : role === 'manifest'
              ? 'manifest.json'
              : role === 'evidence'
                ? 'evidence.json'
                : `${role}.bin`;
        const target = path.join(tmpDir, fileName);
        if (role === 'report') {
          previousText = (await this.contentStore.readBytes(entry.ref)).toString('utf8');
          await fs.writeFile(target, text, 'utf8');
        } else {
          const bytes = await this.contentStore.readBytes(entry.ref);
          await fs.writeFile(target, bytes);
        }
        const item: { sourcePath: string; mediaType: string; role?: string } = {
          sourcePath: target,
          mediaType: entry.mediaType,
        };
        if (entry.role !== undefined) item.role = entry.role;
        rebuilt.push(item);
      }
      nextContent = await this.contentStore.putBundle(rebuilt);
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    } else {
      throw new Error('only text or bundle(report) artifacts can be edited in this release');
    }

    const version: ArtifactVersion = {
      versionId: newId('artifactVersion'),
      createdAt: nowIso(),
      author: 'user',
      content: nextContent,
      ...(previous.content.kind === 'bundle' ? { note: 'manual_report_edit' } : {}),
    };
    const next: Artifact = {
      ...artifact,
      versions: [...artifact.versions, version],
      headVersionId: version.versionId,
    };
    await this.artifactStore.put(next);
    this.eventBus.publish({
      kind: 'artifact.updated',
      artifactId: artifact.id,
      taskId: artifact.taskId,
      headVersionId: version.versionId,
    });

    try {
      await this.recordFeedbackCandidate({
        artifact: next,
        fromVersionId: previous.versionId,
        toVersionId: version.versionId,
        beforeText: previousText,
        afterText: text,
      });
    } catch {
      // learning must not affect delivery
    }

    return { version };
  }

  async export(
    artifactId: string,
    format: ExportFormat,
    targetPath?: string,
  ): Promise<{ path: string }> {
    const { text, artifact } = await this.getContent(artifactId);
    if (text === undefined) throw new Error('export requires text content');
    const dir = targetPath ? path.dirname(targetPath) : artifact.storageDir;
    const base = targetPath
      ? path.basename(targetPath).replace(/\.(md|docx)$/i, '')
      : artifact.title || artifact.id;
    const outBase = path.join(dir, base);
    if (format === 'md') return exportMarkdown(text, outBase);
    return exportDocx(text, outBase);
  }

  /**
   * 打开所在目录前，将当前 head 成果物化到 artifact.storageDir（导出视图，非第二事实源）。
   * - document(text): result.md + manifest.json
   * - code-analysis bundle: report.md / manifest.json / evidence.json
   * 重复调用覆盖同名文件，幂等；内容取自当前 head，与页面一致。
   */
  async revealInFolder(artifactId: string): Promise<void> {
    const artifact = await this.requireArtifact(artifactId);
    await fs.mkdir(artifact.storageDir, { recursive: true });
    const got = await this.getContent(artifactId);

    if (got.content.kind === 'text') {
      const text = got.text ?? '';
      await fs.writeFile(path.join(artifact.storageDir, 'result.md'), text, 'utf8');
      const existingDocx = (await fs.readdir(artifact.storageDir)).filter((n) =>
        /\.docx$/i.test(n),
      );
      const manifest: Record<string, unknown> = {
        schemaVersion: 'document-delivery/1',
        artifactType: artifact.type,
        title: artifact.title,
        headVersionId: artifact.headVersionId,
        primaryFile: 'result.md',
        generatedAt: nowIso(),
      };
      if (existingDocx.length > 0) {
        manifest.relatedFiles = existingDocx.map((name) => ({ name, role: 'docx_export' }));
      }
      await fs.writeFile(
        path.join(artifact.storageDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
    } else if (got.content.kind === 'bundle' && got.bundle) {
      const byRole = new Map(
        got.bundle.entries
          .filter((e) => e.role && e.text !== undefined)
          .map((e) => [e.role as string, e.text as string]),
      );
      const report = byRole.get('report');
      const manifest = byRole.get('manifest');
      const evidence = byRole.get('evidence');
      if (report !== undefined) {
        await fs.writeFile(path.join(artifact.storageDir, 'report.md'), report, 'utf8');
      }
      if (manifest !== undefined) {
        await fs.writeFile(path.join(artifact.storageDir, 'manifest.json'), manifest, 'utf8');
      }
      if (evidence !== undefined) {
        await fs.writeFile(path.join(artifact.storageDir, 'evidence.json'), evidence, 'utf8');
      }
    }
    await fs.access(artifact.storageDir);
  }

  private async recordFeedbackCandidate(input: {
    artifact: Artifact;
    fromVersionId: string;
    toVersionId: string;
    beforeText: string;
    afterText: string;
  }): Promise<void> {
    const evidence = extractEditEvidence(input.beforeText, input.afterText);
    if (evidence.facts.length === 0) return;

    const topicTags = this.resolveTaskTopics
      ? await this.resolveTaskTopics(input.artifact.taskId)
      : [];
    const tags = [...new Set([...evidence.tags, ...topicTags])];

    const event: GrowthEvent = {
      id: newId('growthEvent'),
      subjectId: input.artifact.subjectId,
      occurredAt: nowIso(),
      type: 'feedback_recorded',
      source: {
        kind: 'artifact_edit',
        taskId: input.artifact.taskId,
        artifactId: input.artifact.id,
        jobId: input.artifact.jobId,
      },
      payload: {
        title: evidence.title,
        detail: evidence.detail,
        tags,
        evidence: {
          artifactId: input.artifact.id,
          fromVersionId: input.fromVersionId,
          toVersionId: input.toVersionId,
        },
      },
      confidence: 'candidate',
    };
    await this.subjectService.appendGrowthEvent(event);
  }

  private async requireArtifact(id: string): Promise<Artifact> {
    const artifact = await this.artifactStore.get(id);
    if (!artifact) throw new Error(`artifact not found: ${id}`);
    return artifact;
  }
}
