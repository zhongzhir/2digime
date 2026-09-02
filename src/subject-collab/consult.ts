import { randomUUID } from 'node:crypto';
import { checkDisclosure, threadPlainText } from './disclosure';
import { appendExchange } from './exchange-store';
import type { SubjectCollabNetwork } from './network';
import type { ConsultResult, PublicSubjectCard } from './types';

export async function consultSubject(input: {
  network: SubjectCollabNetwork;
  packageRoot: string;
  selfSubjectId: string;
  threadId: string;
  threadTurns: Array<{ role: string; text: string }>;
  selfContext: string;
  now: string;
  subjectId: string;
  goal: string;
  hopedContribution: string;
  disclosure: string;
}): Promise<ConsultResult> {
  const cards = await input.network.listCards(input.selfSubjectId);
  const card = cards.find((item) => item.subjectId === input.subjectId);
  const exchangeId = `ex_${randomUUID()}`;
  const disclosure = String(input.disclosure || '').trim();
  const gate = checkDisclosure({
    disclosure,
    selfContext: input.selfContext,
    threadText: threadPlainText(input.threadTurns),
  });
  if (!gate.ok) {
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'disclosure_blocked',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: input.subjectId,
      threadId: input.threadId,
      summary: gate.reason,
      body: disclosure.slice(0, 2000),
    });
    return {
      ok: false,
      received: false,
      exchangeId,
      disclosed: '',
      reply: gate.reason,
      failureReason: gate.reason,
    };
  }
  if (!card || !card.reachable) {
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'request_sent',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: input.subjectId,
      threadId: input.threadId,
      summary: '对方不可达',
      body: disclosure,
    });
    return {
      ok: false,
      received: false,
      exchangeId,
      disclosed: disclosure,
      reply: '对方当前不可达。',
      failureReason: '对方当前不可达。',
    };
  }

  const requestBody = JSON.stringify({
    goal: input.goal,
    hopedContribution: input.hopedContribution,
    disclosure,
  });
  await appendExchange(input.packageRoot, {
    exchangeId,
    kind: 'request_sent',
    at: input.now,
    fromSubjectId: input.selfSubjectId,
    toSubjectId: card.subjectId,
    threadId: input.threadId,
    summary: `向 ${card.displayName} 发出合作请求`,
    body: requestBody,
  });

  const response = await input.network.deliver({
    exchangeId,
    fromSubjectId: input.selfSubjectId,
    toSubjectId: card.subjectId,
    at: input.now,
    goal: input.goal,
    hopedContribution: input.hopedContribution,
    disclosure,
    threadId: input.threadId,
  });

  const unreachable = response.reply === '对方当前不可达。' && response.decision === 'decline';
  const received = !unreachable;
  const ok = response.decision === 'accept';
  await appendExchange(input.packageRoot, {
    exchangeId,
    kind: 'response_received',
    at: input.now,
    fromSubjectId: card.subjectId,
    toSubjectId: input.selfSubjectId,
    threadId: input.threadId,
    summary: `对方决定：${response.decision}`,
    body: JSON.stringify({
      decision: response.decision,
      reply: response.reply,
      contribution: response.contribution || '',
    }),
    peerDecision: response.decision,
    ...(response.usedOwnCapability ? { usedOwnCapability: true } : {}),
    ...(response.evidenceDigest ? { protocolRef: response.evidenceDigest } : {}),
  });

  return {
    ok,
    received,
    decision: response.decision,
    reply: response.reply,
    exchangeId,
    disclosed: disclosure,
    ...(response.contribution ? { contribution: response.contribution } : {}),
    ...(ok ? {} : { failureReason: response.reply }),
    ...(response.usedOwnCapability ? { usedOwnCapability: true } : {}),
  };
}

export function cardKnown(cards: PublicSubjectCard[], subjectId: string): boolean {
  return cards.some((card) => card.subjectId === subjectId && card.reachable);
}
