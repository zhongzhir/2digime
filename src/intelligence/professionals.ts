import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CapabilityAdapter, CapabilityInput, ExecutionContext, SecretAccessor } from '../capability/adapter';
import type { CapabilityRegistry } from '../capability/registry';
import type { CapabilityRegistration } from '../capability/registration';
import type { ProfessionalAgent, ProfessionalResult } from './types';
import { classifyAuthorizedPaths } from './mechanical-tools';
import {
  diffWorkTree,
  snapshotWorkTree,
  workTreeDeltaPaths,
  type WorkTreeDelta,
  type WorkTreeFileState,
} from '../execution/baseline';

/** 本次 Talk 附带的已存在目录才算授权 workspace；不猜父目录、不用 runs/{execId}。 */
export function resolveAuthorizedWorkingDirectory(paths?: string[]): string | undefined {
  return classifyAuthorizedPaths(paths).folders[0];
}

/**
 * 把当前可调用的外部能力写成机械事实：id、能做什么、授权、runtime 是否已准备好。
 * 不推荐何时使用、不写「适合复杂代码」、不把未获取的 runtime 说成已连接。
 */
export function describeProfessionals(agents: ProfessionalAgent[]): string {
  if (!agents.length) {
    return '当前没有可调用的外部能力。';
  }
  return agents
    .map((agent) => {
      const lines = [
        `- id: ${agent.id}`,
        `  能做什么：${agent.description}`,
        '  可调用：是',
      ];
      if (agent.authNeeded) lines.push(`  需要授权：${agent.authNeeded}`);
      if (agent.runtimeStatus === 'ready') lines.push('  专业 runtime：已准备好');
      if (agent.runtimeStatus === 'acquirable') lines.push('  专业 runtime：可获得（尚未准备好）');
      return lines.join('\n');
    })
    .join('\n');
}

/**
 * 向 talk 暴露当前 available、可从本环境真实调用的外部能力（Agent / Tool 等）。
 *
 * 不是专业语义预筛选：不再要求 outputArtifactTypes 含 document。
 */
export function agentsFromRegistry(
  registry: CapabilityRegistry,
  input: { subjectId: string; secrets?: SecretAccessor; authorizedWorkingDirectory?: string },
): ProfessionalAgent[] {
  const out: ProfessionalAgent[] = [];
  for (const reg of registry.list()) {
    if (!isCallableProfessional(reg, input.authorizedWorkingDirectory)) continue;
    const adapter = registry.get(reg.id);
    if (!adapter) continue;
    out.push(wrapAdapter(adapter, input));
  }
  return out;
}

function writesFilesystem(reg: CapabilityRegistration): boolean {
  return (reg.permissions || []).includes('filesystem_write');
}

function isCallableProfessional(reg: CapabilityRegistration, authorizedWorkingDirectory?: string): boolean {
  if (reg.availability && reg.availability !== 'available') return false;
  if (reg.kind === 'model') return false;
  if (reg.adapter.type === 'openai-compatible-model') return false;
  if (reg.id === 'cap_fake_document' || reg.adapter.adapterId === 'fake-document') {
    return (
      process.env.DIGITALME_V2_UX_ACCEPTANCE === '1' || process.env.DIGITALME_V2_ELECTRON_TEST === '1'
    );
  }
  if (reg.codingExecution && reg.codingExecution.supportsAutomaticExecution === false) return false;
  if (writesFilesystem(reg) && !authorizedWorkingDirectory) return false;
  return true;
}

function factualDescription(reg: CapabilityRegistration): string {
  return String(reg.description || '').trim() || '可按完整文字目标执行一次已连接能力。';
}

function authNeededFor(reg: CapabilityRegistration): string {
  return (reg.permissions || []).includes('filesystem_write')
    ? '需要本次已授权工作目录'
    : '不需要工作目录授权';
}

function readRuntimeStatus(adapter: CapabilityAdapter): 'ready' | 'acquirable' | undefined {
  const probe = (
    adapter as CapabilityAdapter & { mechanicalRuntimeStatus?: () => 'ready' | 'acquirable' }
  ).mechanicalRuntimeStatus;
  return typeof probe === 'function' ? probe() : undefined;
}

function wrapAdapter(
  adapter: CapabilityAdapter,
  input: { subjectId: string; secrets?: SecretAccessor; authorizedWorkingDirectory?: string },
): ProfessionalAgent {
  const reg = adapter.registration;
  const writes = (reg.permissions || []).includes('filesystem_write');
  const searchLike =
    (reg.permissions || []).includes('network') && !writes && reg.kind === 'tool';
  const artifactType = reg.outputArtifactTypes[0] || 'document';
  const projectDir = writes ? input.authorizedWorkingDirectory : undefined;
  const runtimeStatus = readRuntimeStatus(adapter);
  return {
    id: reg.id,
    label: reg.displayName,
    description: factualDescription(reg),
    authNeeded: authNeededFor(reg),
    ...(runtimeStatus ? { runtimeStatus } : {}),
    ...(searchLike ? { returnsEvidence: true } : {}),
    async run(runInput): Promise<ProfessionalResult> {
      await fs.mkdir(runInput.workDir, { recursive: true });
      const ctx: ExecutionContext = {
        jobId: path.basename(runInput.workDir),
        reportProgress: () => undefined,
        signal: runInput.signal,
        secrets: input.secrets || { get: async () => null },
        workDir: runInput.workDir,
      };
      const capInput: CapabilityInput = {
        goal: runInput.instruction,
        artifactType,
        snapshot: {
          id: ctx.jobId,
          taskId: 'talk',
          createdAt: new Date().toISOString(),
          items: writes && projectDir
            ? [{ sourcePath: projectDir, kind: 'folder-entry', status: 'ok' }]
            : [],
        },
        subjectContext: {
          subjectId: input.subjectId,
          derivedAt: new Date().toISOString(),
          entries: [],
        },
        ...(writes && projectDir
          ? {
              executionAuthorization: {
                confirmed: true,
                workingDirectory: projectDir,
                readScope: ['.'],
                writeScope: ['.'],
                projectOrigin: 'digitalme_created' as const,
              },
            }
          : {}),
      };
      try {
        if (runInput.signal.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        const changeRoot = writes && projectDir ? projectDir : runInput.workDir;
        const before = writes ? await snapshotWorkTree(changeRoot) : new Map<string, WorkTreeFileState>();
        const output = await adapter.execute(capInput, ctx);
        const payload = output.artifact.payload;
        let rawText = output.artifact.title || '';
        let outputPath: string | undefined;
        if (payload.kind === 'text') {
          rawText = payload.text;
          if (!searchLike && !writes) {
            outputPath = path.join(runInput.workDir, 'result.md');
            await fs.writeFile(outputPath, rawText, 'utf8');
          }
        } else if (payload.kind === 'file') {
          outputPath = payload.sourcePath;
          rawText = `已生成文件：${payload.sourcePath}`;
        } else if (payload.kind === 'bundle') {
          rawText = await bundleObservationText(output.artifact.title, payload.entries);
        } else {
          rawText = output.artifact.title || '外部执行返回';
        }
        const after = writes ? await snapshotWorkTree(changeRoot) : new Map<string, WorkTreeFileState>();
        const delta = writes
          ? diffWorkTree(before, after)
          : emptyDelta();
        const userFiles = searchLike
          ? []
          : writes
            ? workTreeDeltaPaths(delta).map((rel) => path.resolve(changeRoot, rel))
            : await listUserFacingFiles(runInput.workDir);
        if (!searchLike && !writes) {
          if (!outputPath) outputPath = userFiles[0];
          if (userFiles.length && !/已产生文件/.test(rawText)) {
            rawText = `${rawText}\n已产生文件：${userFiles.join('；')}`;
          }
        }
        if (writes) {
          rawText = appendWriteDeltaObservation(rawText, delta);
          if (userFiles.length) outputPath = userFiles[0];
        }
        const ok = searchLike
          ? Boolean(String(rawText || '').trim())
          : writes
            ? userFiles.length > 0
            : payload.kind === 'text' || payload.kind === 'file' || userFiles.length > 0;
        const failureReason = ok
          ? undefined
          : writes
            ? '外部执行没有在授权目录留下真实的用户文件或修改。'
            : '外部执行没有在授权目录留下用户要的文件。';
        return {
          ok,
          summary: (ok ? rawText : `${failureReason}${rawText ? `\n${rawText}` : ''}`).slice(0, 4000),
          ...(failureReason ? { failureReason } : {}),
          producedOutputs: userFiles,
          ...(outputPath && !searchLike ? { outputPath } : {}),
          ...(searchLike ? { evidenceOnly: true } : {}),
          rawText,
        };
      } catch (err) {
        if (
          (err instanceof Error && err.name === 'AbortError') ||
          runInput.signal.aborted
        ) {
          const abort = err instanceof Error && err.name === 'AbortError' ? err : new Error('aborted');
          abort.name = 'AbortError';
          throw abort;
        }
        const failureReason = err instanceof Error ? err.message : String(err);
        const actionable =
          err && typeof err === 'object' && 'actionable' in err
            ? String((err as { actionable?: string }).actionable || '')
            : '';
        const safeDetail =
          err && typeof err === 'object' && 'safeDetail' in err
            ? String((err as { safeDetail?: string }).safeDetail || '')
            : '';
        return {
          ok: false,
          failureReason,
          producedOutputs: [],
          summary: [failureReason, actionable].filter(Boolean).join(' ').slice(0, 4000),
          rawText: failureReason,
          ...(safeDetail ? { safeDetail } : {}),
        };
      }
    },
  };
}

async function bundleObservationText(
  title: string | undefined,
  entries: Array<{ sourcePath: string; mediaType: string; role?: string }>,
): Promise<string> {
  const parts = [title || '外部执行返回'];
  for (const entry of entries || []) {
    if (entry.role !== 'execution-summary' || !entry.sourcePath) continue;
    try {
      const text = (await fs.readFile(entry.sourcePath, 'utf8')).trim();
      if (text) parts.push(text.slice(0, 2500));
    } catch {
      /* 摘要文件读不到时仍返回 title，不把目录里的旧文件当成成果 */
    }
  }
  return parts.filter(Boolean).join('\n');
}

function emptyDelta(): WorkTreeDelta {
  return { created: [], modified: [], deleted: [], unchanged: [] };
}

function appendWriteDeltaObservation(rawText: string, delta: WorkTreeDelta): string {
  const lines: string[] = [];
  for (const rel of delta.created) lines.push(`- created: ${rel}`);
  for (const rel of delta.modified) lines.push(`- modified: ${rel}`);
  for (const rel of delta.deleted) lines.push(`- deleted: ${rel}`);
  const deltaBlock = lines.length ? `本次实际修改：\n${lines.join('\n')}` : '本次没有改动授权目录中的文件。';
  return `${rawText}\n${deltaBlock}`.trim();
}

async function listUserFacingFiles(dir: string): Promise<string[]> {
  const snap = await snapshotWorkTree(dir);
  return [...snap.keys()].map((rel) => path.resolve(dir, rel));
}
