/**
 * 代码执行能力 — 统一用户态状态（派生自 Capability Registry，不建第二 Store）。
 * 合同字段不绑定任何具体供应商专有结构。
 */

export type CodingCapabilityAvailability =
  | 'ready'
  | 'needs_login'
  | 'needs_setup'
  | 'unavailable'
  | 'unsupported'
  | 'degraded_handoff';

export type CodingInvocationKind =
  | 'cli'
  | 'api'
  | 'mcp'
  | 'desktop_handoff'
  | 'managed_remote';

export type CodingProviderKind =
  | 'local_coding_agent'
  | 'desktop_product'
  | 'managed_service'
  | 'unknown';

export interface CodingExecutionProfile {
  providerKind: CodingProviderKind;
  invocationKind: CodingInvocationKind;
  supportsAutomaticExecution: boolean;
  supportsProgress: boolean;
  supportsRevision: boolean;
  supportsResultCollection: boolean;
}

export interface CodingCapabilityStatus {
  capabilityId: string;
  displayName: string;
  providerKind: CodingProviderKind;
  invocationKind: CodingInvocationKind;
  availability: CodingCapabilityAvailability;
  connectionStatus: string;
  supportsAutomaticExecution: boolean;
  supportsProgress: boolean;
  supportsRevision: boolean;
  supportsResultCollection: boolean;
  actionableMessage: string;
  canDo: string;
  executionModeLabel: string;
  /** 安装说明提供方（用户面，非内部 id）。 */
  installProvider?: string;
}

export interface CodingCapabilityRecommendation {
  displayName: string;
  canDo: string;
  whyNeeded: string;
  permissions: string[];
  installProvider: string;
  noAutoCommitPushDeploy: true;
  installGuideUrl?: string;
}

export interface CodingOnboardingPayload {
  title: string;
  description: string;
  message: string;
  settingsHint?: string;
  actions: Array<'use_installed' | 'install_recommended' | 'connect_later' | 'use_cloud'>;
  capabilities: CodingCapabilityStatus[];
  recommended: CodingCapabilityRecommendation;
  pendingDraftSaved?: boolean;
}

export interface CodingCapabilityPrefs {
  defaultCapabilityId?: string;
}

const CONNECTION_LABEL: Record<CodingCapabilityAvailability, string> = {
  ready: '已连接',
  needs_login: '需要登录',
  needs_setup: '尚未配置',
  unavailable: '当前不可用',
  unsupported: '当前无法自动使用',
  degraded_handoff: '需要外部操作',
};

const ACTIONABLE: Record<CodingCapabilityAvailability, string> = {
  ready: '可以使用此能力继续软件开发任务。',
  needs_login: '代码执行能力需要连接后才能继续。',
  needs_setup: '尚未检测到可用的代码执行能力。',
  unavailable: '当前代码执行能力版本过旧，请更新后重新检查。',
  unsupported: '检测到该工具，但当前还不能由 Digital Me 自动调用。',
  degraded_handoff:
    '当前需要你在外部工具中完成修改。完成后回到这里，Digital Me 会检查变化和测试结果。',
};

/** 当前产品真实支持并通过验收的推荐能力（首轮仅一项）。 */
export function recommendedCodingCapability(): CodingCapabilityRecommendation {
  return {
    displayName: '代码执行能力',
    canDo: '在你确认的项目目录中创建或修改代码，并运行本地测试。',
    whyNeeded: '软件开发任务需要可自动执行的代码能力，才能在确认范围内改文件并跑测试。',
    permissions: [
      '读取你确认的项目文件夹',
      '在确认范围内创建或修改文件',
      '运行本地测试或构建命令',
    ],
    installProvider: '由该能力的官方安装渠道提供；Digital Me 不会替你静默安装。',
    noAutoCommitPushDeploy: true,
    installGuideUrl: 'https://github.com/openai/codex',
  };
}

export function connectionStatusLabel(availability: CodingCapabilityAvailability): string {
  return CONNECTION_LABEL[availability];
}

export function actionableForCodingAvailability(
  availability: CodingCapabilityAvailability,
  custom?: string,
): string {
  const text = String(custom || '').trim();
  if (text && !/cli|adapter|registry|provider|executorid|codex\.js/i.test(text)) {
    return text;
  }
  return ACTIONABLE[availability];
}

export function mapProbeToCodingAvailability(input: {
  available: boolean;
  reason?: string;
  detail?: string;
}): CodingCapabilityAvailability {
  if (input.available) return 'ready';
  const reason = String(input.reason || '').toLowerCase();
  const detail = String(input.detail || '').toLowerCase();
  if (reason === 'needs_login' || /auth|login|未登录|需要登录/.test(detail)) {
    return 'needs_login';
  }
  if (
    reason === 'unsupported' ||
    reason === 'desktop_unsupported' ||
    /不能自动调用|不支持自动/.test(detail)
  ) {
    return 'unsupported';
  }
  if (reason === 'degraded_handoff' || reason === 'desktop_handoff') {
    return 'degraded_handoff';
  }
  if (
    reason === 'unavailable' ||
    reason === 'version_incompatible' ||
    /outdated|过旧|不兼容|version/.test(detail)
  ) {
    return 'unavailable';
  }
  if (reason === 'needs_setup' || reason === 'not_found') {
    return 'needs_setup';
  }
  return 'needs_setup';
}

export function buildCodingCapabilityStatus(input: {
  capabilityId: string;
  displayName: string;
  profile: CodingExecutionProfile;
  availability: CodingCapabilityAvailability;
  canDo?: string;
  actionableMessage?: string;
  installProvider?: string;
}): CodingCapabilityStatus {
  const auto = !!input.profile.supportsAutomaticExecution && input.availability === 'ready';
  return {
    capabilityId: input.capabilityId,
    displayName: input.displayName,
    providerKind: input.profile.providerKind,
    invocationKind: input.profile.invocationKind,
    availability: input.availability,
    connectionStatus: connectionStatusLabel(input.availability),
    supportsAutomaticExecution: !!input.profile.supportsAutomaticExecution,
    supportsProgress: !!input.profile.supportsProgress,
    supportsRevision: !!input.profile.supportsRevision,
    supportsResultCollection: !!input.profile.supportsResultCollection,
    actionableMessage: actionableForCodingAvailability(
      input.availability,
      input.actionableMessage,
    ),
    canDo:
      input.canDo ||
      '在你确认的项目目录中修改代码并运行测试，由 Digital Me 独立验收。',
    executionModeLabel: auto
      ? '自动执行'
      : input.availability === 'degraded_handoff'
        ? '需要外部操作'
        : input.availability === 'unsupported'
          ? '不能自动调用'
          : '当前不可自动执行',
    ...(input.installProvider ? { installProvider: input.installProvider } : {}),
  };
}

/** 多 ready 能力时的默认选择（无第二绑定 Store；偏好仅作提示）。 */
export function selectPreferredCodingCapability(
  statuses: readonly CodingCapabilityStatus[],
  prefs?: CodingCapabilityPrefs,
): CodingCapabilityStatus | null {
  const readyAuto = statuses.filter(
    (s) => s.availability === 'ready' && s.supportsAutomaticExecution,
  );
  if (readyAuto.length === 0) return null;
  const preferredId = String(prefs?.defaultCapabilityId || '').trim();
  if (preferredId) {
    const hit = readyAuto.find((s) => s.capabilityId === preferredId);
    if (hit) return hit;
  }
  const scored = [...readyAuto].sort((a, b) => scoreCodingCapability(b) - scoreCodingCapability(a));
  return scored[0] || null;
}

function scoreCodingCapability(s: CodingCapabilityStatus): number {
  let score = 0;
  if (s.supportsAutomaticExecution) score += 40;
  if (s.supportsRevision) score += 20;
  if (s.supportsResultCollection) score += 20;
  if (s.supportsProgress) score += 10;
  if (s.availability === 'ready') score += 30;
  return score;
}

export function buildCodingOnboardingPayload(
  statuses: readonly CodingCapabilityStatus[],
  opts?: { includeCloudAction?: boolean },
): CodingOnboardingPayload {
  const hasManagedRemoteReady = statuses.some(
    (s) =>
      s.invocationKind === 'managed_remote' &&
      s.availability === 'ready' &&
      s.supportsAutomaticExecution,
  );
  const actions: CodingOnboardingPayload['actions'] = [
    'use_installed',
    'install_recommended',
    'connect_later',
  ];
  if (opts?.includeCloudAction || hasManagedRemoteReady) {
    actions.push('use_cloud');
  }
  const unsupported = statuses.filter((s) => s.availability === 'unsupported');
  let message: string;
  if (statuses.some((s) => s.availability === 'needs_login')) {
    message = actionableForCodingAvailability('needs_login');
  } else if (unsupported.length > 0 && !statuses.some((s) => s.availability === 'ready')) {
    // 已检测到但暂不能自动调用时，不得被同场的 needs_setup 盖成「尚未检测到」
    const name = String(unsupported[0]?.displayName || '').trim();
    message = name
      ? `已检测到「${name}」，但当前还不能由 Digital Me 自动调用。`
      : actionableForCodingAvailability('unsupported');
  } else {
    message = actionableForCodingAvailability('needs_setup');
  }
  return {
    title: '完成这项任务需要代码执行能力',
    description:
      'Digital Me 会使用它在你确认的项目目录中创建或修改代码，并运行测试。',
    message,
    settingsHint: '可在设置中查看代码执行能力状态与说明。',
    actions,
    capabilities: statuses.map(sanitizeCodingStatusForUi),
    recommended: recommendedCodingCapability(),
  };
}

export function sanitizeCodingStatusForUi(
  status: CodingCapabilityStatus,
): CodingCapabilityStatus {
  return {
    ...status,
    actionableMessage: stripInternalTerms(status.actionableMessage),
    canDo: stripInternalTerms(status.canDo),
  };
}

export function stripInternalTerms(text: string): string {
  return String(text || '')
    .replace(/\bCLI\b/gi, '本地组件')
    .replace(/\bAdapter\b/gi, '能力')
    .replace(/\bRegistry\b/gi, '能力列表')
    .replace(/\bprovider\b/gi, '来源')
    .replace(/\bexecutorId\b/gi, '能力')
    .replace(/codex\.js/gi, '执行组件')
    .trim();
}

export function userFacingNaturalExecutorName(): string {
  return '代码执行能力';
}

export function isAutomaticReady(status: CodingCapabilityStatus | null | undefined): boolean {
  return !!(
    status &&
    status.availability === 'ready' &&
    status.supportsAutomaticExecution
  );
}
