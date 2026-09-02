import type { TalkChatFn } from '../intelligence/types';
import type { CollaborationDecision, CollaborationRequest, CollaborationResponse } from './types';

function parseDecision(text: string): {
  decision: CollaborationDecision;
  reply: string;
  contribution?: string;
} {
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : '';
  try {
    const parsed = JSON.parse(raw) as {
      decision?: string;
      reply?: string;
      contribution?: string;
    };
    const decision = parsed.decision;
    const allowed: CollaborationDecision[] = ['accept', 'decline', 'clarify', 'alternative'];
    const picked = allowed.includes(decision as CollaborationDecision)
      ? (decision as CollaborationDecision)
      : 'decline';
    const reply = String(parsed.reply || '').trim() || (picked === 'accept' ? '可以合作。' : '这次无法合作。');
    const contribution = String(parsed.contribution || '').trim();
    return contribution ? { decision: picked, reply, contribution } : { decision: picked, reply };
  } catch {
    return { decision: 'decline', reply: '无法判断这次合作请求。' };
  }
}

export async function decideIncomingRequest(input: {
  chat: TalkChatFn;
  selfContext: string;
  request: CollaborationRequest;
  now: string;
}): Promise<CollaborationResponse> {
  const result = await input.chat({
    messages: [
      {
        role: 'system',
        content: [
          '你是一个独立的 2digime。另一主体发来合作请求。你根据自己的数字之我与边界决定。',
          '你可以接受、拒绝、要求澄清，或提出另一种合作方式。你不是对方的工具或下属。',
          '只输出 JSON：{"decision":"accept|decline|clarify|alternative","reply":"...","contribution":""}',
          'accept 时 contribution 填写你能提供的合作结果（用人话，不要内部机制词）。',
          '不要编造未写入数字之我的私人事实。不要索取对方完整 Digital Self。',
          '当前数字之我：',
          input.selfContext,
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `希望共同完成：${input.request.goal}`,
          `希望你贡献：${input.request.hopedContribution}`,
          `对方提供的必要上下文：${input.request.disclosure}`,
        ].join('\n'),
      },
    ],
  });
  const judged = parseDecision(result.text);
  return {
    exchangeId: input.request.exchangeId,
    fromSubjectId: input.request.toSubjectId,
    toSubjectId: input.request.fromSubjectId,
    at: input.now,
    decision: judged.decision,
    reply: judged.reply,
    ...(judged.contribution ? { contribution: judged.contribution } : {}),
  };
}
