/**
 * 当前任务咨询与 CTO 结论（纠偏 18）。
 * 从已有 Task / Job / Artifact / 验收事实派生面向用户的回答；
 * 不创建 Job，不构成第二状态机。
 */

export interface ConsultTaskContext {
  goal: string;
  stageLabel: string;
  hasArtifact: boolean;
  jobRunning: boolean;
  latestJobStatus?: string;
  ownerDecision?: 'undecided' | 'accepted' | 'rejected';
  canAdoptSuggested?: boolean;
  ctoReport?: string;
  lastFailure?: string;
}

const CONSULT_RE =
  /能不能用|能用吗|现在能用|要不要改|还需不需要改|还要改吗|有什么风险|有哪些风险|现在怎么样|现在什么状态|看到哪了|看不懂|这份结果|用几句人话|是否达到|达标了吗|建议采用|可不可以用来/;

/** 用户在问当前任务进展/判断，而不是要求开始执行或采用。 */
export function isCurrentTaskConsult(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/按你说的|开始(开发|吧|做)|就这么干|采用这|确认采用/.test(t) && !CONSULT_RE.test(t)) {
    return false;
  }
  return CONSULT_RE.test(t);
}

/**
 * 用当前任务事实回答：能不能用、是否达标、要不要改、风险、下一步。
 * 不得退回「没听懂，请再说一次」。
 */
export function buildGroundedConsultReply(ctx: ConsultTaskContext): string {
  const running = ctx.jobRunning || ctx.latestJobStatus === 'queued' || ctx.latestJobStatus === 'running';
  if (running) {
    return [
      '现在还在开发中，还不能用。',
      '是否达到目标：还在做，尚未验收完毕。',
      '还需不需要修改：等这轮结束后我会告诉你。',
      '风险：开发完成前不会自动提交、推送或发布。',
      '建议下一步：稍等这轮结束；你也可以随时补充要求。',
    ].join('\n');
  }

  if (ctx.ownerDecision === 'accepted') {
    return [
      '现在能不能用：你已经采用了这份成果，可以按右侧说明查看或试用。',
      '是否达到目标：采用时已按当时的验收结论收下。',
      '还需不需要修改：若还要改，直接在对话里说即可。',
      '需要你知道的风险：采用后仍不会自动提交或发布。',
      '建议下一步：试用一下；有问题直接告诉我。',
    ].join('\n');
  }

  if (ctx.ownerDecision === 'rejected') {
    return [
      '现在能不能用：这份成果你未采用，不应当作已交付结果。',
      '是否达到目标：未作为达标版本收下。',
      '还需不需要修改：需要。请说明你希望怎样改。',
      '需要你知道的风险：未采用的版本不会自动覆盖你的最终决定。',
      '建议下一步：用几句话告诉我哪里不对。',
    ].join('\n');
  }

  if (!ctx.hasArtifact) {
    return [
      '现在能不能用：还没有可交付成果。',
      '是否达到目标：尚未开始或尚未完成开发。',
      '还需不需要修改：先确认右侧开发规划，再开始。',
      '需要你知道的风险：未确认前不会改你的项目文件。',
      '建议下一步：看右侧规划是否符合你的目标；可以的话确认并开始开发，或直接告诉我要改哪里。',
    ].join('\n');
  }

  const suggestAdopt = ctx.canAdoptSuggested === true;
  const suggestRevise = ctx.canAdoptSuggested === false;
  const usable = suggestAdopt ? '可以试用，但尚未采用。' : suggestRevise ? '现在还不建议当作可用版本。' : '已有成果，请先看我的结论再决定。';
  const attained = suggestAdopt ? '对照目标，我建议可以收下。' : suggestRevise ? '对照目标仍未达标。' : '还不能完全认定已达标。';
  const needChange = suggestAdopt ? '不是必须再改；若你还有意见，直接说。' : '需要。下面是我的修改建议。';
  const next = suggestAdopt
    ? '建议采用这份成果；也可以先试用再决定。'
    : '按我的修改建议继续，或告诉我你更在意哪一点。';

  const extra = String(ctx.ctoReport || '').trim();
  const lines = [
    `现在能不能用：${usable}`,
    `是否达到目标：${attained}`,
    `还需不需要修改：${needChange}`,
    '需要你知道的风险：不会自动提交、推送或发布；未采用前这只是待你决定的一版。',
    `建议下一步：${next}`,
  ];
  if (extra) {
    lines.push('');
    lines.push(extra.length > 400 ? extra.slice(0, 400) + '…' : extra);
  }
  return lines.join('\n');
}

export function formatCtoUserConclusion(input: {
  canUse: string;
  goalAttained: string;
  needChange: string;
  risks: string;
  nextStep: string;
}): string {
  return [
    `现在能不能用：${input.canUse}`,
    `是否达到目标：${input.goalAttained}`,
    `还需不需要修改：${input.needChange}`,
    `需要你知道的风险：${input.risks}`,
    `建议下一步：${input.nextStep}`,
  ].join('\n');
}
