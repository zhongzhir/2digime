import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CapabilityAdapter, CapabilityInput, ExecutionContext, SecretAccessor } from '../capability/adapter';
import type { CapabilityRegistry } from '../capability/registry';
import type { CapabilityRegistration } from '../capability/registration';
import type { ProfessionalAgent, ProfessionalResult } from './types';

/**
 * 把已注册、当前可真实调用的外部能力/资源描述成自然语言合同。
 * 不做 intent / WorkIntent / outputFamily / artifactType 路由。
 * 由 2digime 模型选择是否调用。接口可统一；产品上 Agent / Tool / Skill 不要混称。
 */
export function describeProfessionals(agents: ProfessionalAgent[]): string {
  if (!agents.length) {
    return '当前没有已连接的外部能力。只能交流或询问用户，不得假装已经做完外部行动。';
  }
  return agents
    .map((agent) => {
      const lines = [
        `- 名字：${agent.label}`,
        `  id: ${agent.id}`,
        `  能做什么：${agent.description}`,
      ];
      if (agent.cannotDo) lines.push(`  不能做什么：${agent.cannotDo}`);
      if (agent.effects) lines.push(`  真实效果：${agent.effects}`);
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
  input: { subjectId: string; secrets?: SecretAccessor },
): ProfessionalAgent[] {
  const out: ProfessionalAgent[] = [];
  for (const reg of registry.list()) {
    if (!isCallableProfessional(reg)) continue;
    const adapter = registry.get(reg.id);
    if (!adapter) continue;
    out.push(wrapAdapter(adapter, input));
  }
  return out;
}

function isCallableProfessional(reg: CapabilityRegistration): boolean {
  if (reg.availability && reg.availability !== 'available') return false;
  if (reg.kind === 'model') return false;
  if (reg.adapter.type === 'openai-compatible-model') return false;
  if (reg.id === 'cap_fake_document' || reg.adapter.adapterId === 'fake-document') {
    return (
      process.env.DIGITALME_V2_UX_ACCEPTANCE === '1' || process.env.DIGITALME_V2_ELECTRON_TEST === '1'
    );
  }
  if (reg.codingExecution && reg.codingExecution.supportsAutomaticExecution === false) return false;
  return true;
}

function naturalContract(reg: CapabilityRegistration): {
  description: string;
  cannotDo: string;
  effects: string;
} {
  const perms = new Set(reg.permissions || []);
  const writes = perms.has('filesystem_write');
  const reads = perms.has('filesystem_read');
  const net = perms.has('network');
  const cliAgent = reg.adapter.type === 'external-executor-cli' && reg.kind === 'agent';
  const modelApiExec = reg.adapter.type === 'external-executor-model-api';
  const searchLike = net && !writes && reg.kind === 'tool';

  const effects: string[] = [];
  if (writes) effects.push('会在本次已授权的工作目录里真实创建或修改文件，不要向用户再要路径');
  if (reads && !writes) effects.push('会读取授权范围内的文件');
  if (net && writes) effects.push('执行过程中可能访问网络');
  if (net && !writes) effects.push('会访问公开网络检索来源');
  if (!effects.length) effects.push('不产生磁盘或网络上的外部效果，只返回文字');

  let description = String(reg.description || '').trim();
  if (cliAgent) {
    description =
      '在本次授权的工作目录里真实创建、修改文件，并可运行测试。这是已连接的专业代码执行能力，不是聊天里生成的一段文字。';
  } else if (modelApiExec) {
    description =
      '用已连接的同一套对话模型，在本次授权目录里做一次小改文件。有落盘效果，但不是独立专业代码 Agent。';
  } else if (searchLike) {
    description =
      '检索当前公开网页并返回来源与摘录，供核验训练记忆可能过时的公开事实。来源清单不是给用户的最终答案，也不会在磁盘上创建用户文件。';
  } else if (!description) {
    description = '可按完整文字目标执行一次已连接能力。';
  }

  let cannotDo =
    '不能发送邮件，不能扩大授权，不能改授权目录之外的路径，不能代替用户确认高风险操作。';
  if (cliAgent) {
    cannotDo = `不能仅靠对话假装已经改了文件。${cannotDo}`;
  } else if (modelApiExec) {
    cannotDo = `不是独立专业代码 Agent。${cannotDo}`;
  } else if (searchLike) {
    cannotDo = '不能改文件、不能发邮件、不能登录需要账号的站点；只检索公开网页。';
  }

  return { description, cannotDo, effects: effects.join('；') };
}

function wrapAdapter(
  adapter: CapabilityAdapter,
  input: { subjectId: string; secrets?: SecretAccessor },
): ProfessionalAgent {
  const reg = adapter.registration;
  const contract = naturalContract(reg);
  const writes = (reg.permissions || []).includes('filesystem_write');
  const searchLike =
    (reg.permissions || []).includes('network') && !writes && reg.kind === 'tool';
  const artifactType = reg.outputArtifactTypes[0] || 'document';
  return {
    id: reg.id,
    label: reg.displayName,
    description: contract.description,
    cannotDo: contract.cannotDo,
    effects: contract.effects,
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
          items: writes
            ? [{ sourcePath: runInput.workDir, kind: 'folder-entry', status: 'ok' }]
            : [],
        },
        subjectContext: {
          subjectId: input.subjectId,
          derivedAt: new Date().toISOString(),
          entries: [],
        },
        ...(writes
          ? {
              executionAuthorization: {
                confirmed: true,
                workingDirectory: runInput.workDir,
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
        const before = writes ? await snapshotWorkFiles(runInput.workDir) : new Map<string, WorkFileSnap>();
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
          const created = await listUserFacingFiles(runInput.workDir);
          outputPath = created[0];
          rawText = [
            output.artifact.title || '外部执行返回',
            created.length ? `已产生文件：${created.join('；')}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        } else {
          rawText = output.artifact.title || '外部执行返回';
        }
        const after = await snapshotWorkFiles(runInput.workDir);
        const changed = writes ? userFacingChanges(runInput.workDir, before, after) : [];
        const userFiles = searchLike ? [] : writes ? changed : await listUserFacingFiles(runInput.workDir);
        if (!searchLike && !writes) {
          if (!outputPath) outputPath = userFiles[0];
          if (userFiles.length && !/已产生文件/.test(rawText)) {
            rawText = `${rawText}\n已产生文件：${userFiles.join('；')}`;
          }
        }
        if (writes && userFiles.length) {
          outputPath = userFiles[0];
          if (!/已产生文件/.test(rawText)) {
            rawText = `${rawText}\n已产生文件：${userFiles.join('；')}`;
          }
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
        if (!searchLike) {
          const userFiles = await listUserFacingFiles(runInput.workDir);
          const firstFile = userFiles[0];
          if (firstFile) {
            return {
              ok: true,
              summary: `已产生文件：${userFiles.join('；')}`.slice(0, 4000),
              producedOutputs: userFiles,
              outputPath: firstFile,
              rawText: userFiles.join('\n'),
            };
          }
        }
        const failureReason = err instanceof Error ? err.message : String(err);
        const actionable =
          err && typeof err === 'object' && 'actionable' in err
            ? String((err as { actionable?: string }).actionable || '')
            : '';
        return {
          ok: false,
          failureReason,
          producedOutputs: [],
          summary: [failureReason, actionable].filter(Boolean).join(' ').slice(0, 4000),
          rawText: failureReason,
        };
      }
    },
  };
}

type WorkFileSnap = { size: number; mtimeMs: number };

function isSkippedWorkName(name: string): boolean {
  return name === 'node_modules' || name === 'external-execution';
}

async function snapshotWorkFiles(dir: string): Promise<Map<string, WorkFileSnap>> {
  const out = new Map<string, WorkFileSnap>();
  const walk = async (cur: string): Promise<void> => {
    let ents;
    try {
      ents = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (isSkippedWorkName(ent.name)) continue;
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) await walk(p);
      else {
        try {
          const st = await fs.stat(p);
          out.set(p, { size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  };
  await walk(dir);
  return out;
}

function userFacingChanges(
  workDir: string,
  before: Map<string, WorkFileSnap>,
  after: Map<string, WorkFileSnap>,
): string[] {
  const changed: string[] = [];
  for (const [file, snap] of after) {
    const prev = before.get(file);
    if (!prev || prev.size !== snap.size || prev.mtimeMs !== snap.mtimeMs) changed.push(file);
  }
  const preferred = changed.filter((p) => /\.(md|txt)$/i.test(p));
  const rest = changed.filter((p) => !preferred.includes(p));
  return preferred.concat(rest).filter((p) => p.startsWith(workDir));
}

async function listUserFacingFiles(dir: string): Promise<string[]> {
  const snap = await snapshotWorkFiles(dir);
  const out = [...snap.keys()];
  const preferred = out.filter((p) => /\.(md|txt)$/i.test(p));
  return preferred.length ? preferred.concat(out.filter((p) => !preferred.includes(p))) : out;
}
