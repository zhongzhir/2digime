/**
 * 把当前 Registry 探测结果与本次授权编译成给模型的能力现实。
 * 只陈述事实。不推荐能力、不规划安装、不决定下一步。
 */
import type { CapabilityRegistry } from '../capability/registry';
import type { CapabilityRegistration } from '../capability/registration';
import { classifyAuthorizedPaths } from './mechanical-tools';

type Slot = 'search' | 'code' | 'desktop' | 'mcp';

function isHiddenFromReality(reg: CapabilityRegistration): boolean {
  if (reg.kind === 'model') return true;
  if (reg.adapter.type === 'openai-compatible-model') return true;
  if (reg.adapter.type === 'external-executor-model-api') return true;
  if (reg.id === 'cap_fake_document' || reg.adapter.adapterId === 'fake-document') return true;
  if (reg.id === 'cap_baseline_web_search' || reg.adapter.adapterId === 'baseline-bing-search') return true;
  if (reg.id === 'cap_code_repo_analysis' || reg.adapter.adapterId === 'code-repo-analysis') return true;
  return false;
}

function slotOf(reg: CapabilityRegistration): Slot | null {
  if (isHiddenFromReality(reg)) return null;
  if (reg.adapter.type === 'mcp-stdio') return 'mcp';
  if (reg.codingExecution?.invocationKind === 'desktop_handoff') return 'desktop';
  if (reg.codingExecution && reg.codingExecution.supportsAutomaticExecution === false) return 'desktop';
  if (reg.adapter.type === 'external-executor-cli' && (reg.permissions || []).includes('filesystem_write')) {
    return 'code';
  }
  if (reg.codingExecution?.supportsAutomaticExecution) return 'code';
  const perms = new Set(reg.permissions || []);
  if (perms.has('network') && !perms.has('filesystem_write') && reg.kind === 'tool') return 'search';
  return null;
}

async function liveAvailable(
  registry: CapabilityRegistry,
  reg: CapabilityRegistration,
): Promise<boolean> {
  const adapter = registry.get(reg.id);
  if (!adapter) return reg.availability === 'available';
  try {
    const check = await adapter.checkAvailability();
    return check.available === true;
  } catch {
    return false;
  }
}

function searchLine(available: boolean): string {
  return available
    ? '联网搜索：已连接，可使用'
    : '联网搜索：当前尚未连接或配置。用户可以在「设置 → 联网搜索」中连接。';
}

function codeLine(available: boolean, authorizedFolder?: string): string {
  if (available && !authorizedFolder) {
    return '代码执行：已安装，但本轮尚未授权工作目录。要实际使用，需要用户通过当前对话的“+”附加项目文件夹作为本次工作目录。';
  }
  if (available) return '代码执行：已连接，可在授权工作目录中使用';
  return '代码执行：当前尚未连接或配置';
}

function desktopLine(available: boolean): string {
  return available ? '桌面应用操作：已连接，可使用' : '桌面应用操作：当前没有已连接的可执行能力';
}

function mcpLine(available: boolean): string {
  return available ? '资料查询：已连接，可使用' : '资料查询：当前尚未连接或配置';
}

function filesLine(contextPaths?: string[]): string {
  const auth = classifyAuthorizedPaths(contextPaths);
  if (!auth.folders.length && !auth.files.length) {
    return '本地文件读取：本轮尚未通过“+”授权文件或文件夹';
  }
  const granted = [...auth.folders, ...auth.files];
  return `本地文件读取：已授权 ${granted.join('、')}，可读取`;
}

export async function compileCapabilityReality(input: {
  registry?: CapabilityRegistry;
  contextPaths?: string[];
}): Promise<string> {
  const bySlot = new Map<Slot, boolean>();
  const registry = input.registry;
  if (registry) {
    for (const reg of registry.list()) {
      const slot = slotOf(reg);
      if (!slot) continue;
      const available = await liveAvailable(registry, reg);
      const prev = bySlot.get(slot);
      if (prev === undefined || (available && !prev)) bySlot.set(slot, available);
    }
  }

  const folder = classifyAuthorizedPaths(input.contextPaths).folders[0];
  const lines = [
    '当前能力：',
    searchLine(bySlot.get('search') === true),
    filesLine(input.contextPaths),
    codeLine(bySlot.get('code') === true, folder),
    desktopLine(bySlot.get('desktop') === true),
  ];
  if (bySlot.has('mcp')) lines.push(mcpLine(bySlot.get('mcp') === true));
  lines.push('这些是当前事实。是否使用、如何向用户说明缺口，由你判断。未授权或未连接的能力不能当成已经做成。');
  return lines.join('\n');
}
