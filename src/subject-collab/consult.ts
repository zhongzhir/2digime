import { randomUUID } from 'node:crypto';
import { checkDisclosure, threadPlainText } from './disclosure';
import { appendExchange, bodyDigest } from './exchange-store';
import {
  issuePersonalContextContract,
  revokePersonalContextGrant,
  verifyPersonalContextContract,
} from './personal-context-contract';
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
  contextUnderstandingIds?: string[];
}): Promise<ConsultResult> {
  const cards = await input.network.listCards(input.selfSubjectId);
  const card = cards.find((item) => item.subjectId === input.subjectId);
  const exchangeId = `ex_${randomUUID()}`;
  if (!card || !card.reachable) {
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'delivery_failed',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: input.subjectId,
      threadId: input.threadId,
      summary: '对方不可达，未发送个人上下文',
      body: '',
    });
    return {
      ok: false,
      received: false,
      exchangeId,
      disclosed: '',
      reply: '对方当前不可达。',
      failureReason: '对方当前不可达。',
    };
  }

  let issued;
  try {
    issued = await issuePersonalContextContract({
      packageRoot: input.packageRoot,
      issuerSubjectId: input.selfSubjectId,
      recipientSubjectId: card.subjectId,
      recipientEndpointRef: card.endpointRef,
      taskRef: exchangeId,
      purpose: input.goal,
      taskContext: input.disclosure,
      understandingIds: input.contextUnderstandingIds || [],
      issuedAt: input.now,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : '无法编译本次个人上下文';
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'disclosure_blocked',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: input.subjectId,
      threadId: input.threadId,
      summary: reason,
      body: '',
    });
    return {
      ok: false,
      received: false,
      exchangeId,
      disclosed: '',
      reply: reason,
      failureReason: reason,
    };
  }
  const disclosure = issued.disclosure;
  const gate = checkDisclosure({
    disclosure,
    selfContext: input.selfContext,
    threadText: threadPlainText(input.threadTurns),
  });
  if (!gate.ok) {
    await revokePersonalContextGrant({
      packageRoot: input.packageRoot,
      grant: issued.grant,
      revokedAt: input.now,
    });
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'disclosure_blocked',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: input.subjectId,
      threadId: input.threadId,
      summary: gate.reason,
      body: '',
      protocolRef: issued.contract.id,
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
  const contractGate = verifyPersonalContextContract({
    contract: issued.contract,
    expectedTaskRef: exchangeId,
    expectedIssuerSubjectId: input.selfSubjectId,
    expectedRecipientSubjectId: card.subjectId,
    expectedRecipientEndpointRef: card.endpointRef,
    expectedPurpose: input.goal,
    expectedDisclosure: disclosure,
    now: input.now,
    grant: issued.grant,
  });
  if (!contractGate.ok) {
    await revokePersonalContextGrant({
      packageRoot: input.packageRoot,
      grant: issued.grant,
      revokedAt: input.now,
    });
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'disclosure_blocked',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: card.subjectId,
      threadId: input.threadId,
      summary: contractGate.reason,
      body: '',
      protocolRef: issued.contract.id,
    });
    return {
      ok: false,
      received: false,
      exchangeId,
      disclosed: '',
      reply: contractGate.reason,
      failureReason: contractGate.reason,
    };
  }

  const request = {
    exchangeId,
    fromSubjectId: input.selfSubjectId,
    toSubjectId: card.subjectId,
    at: input.now,
    goal: input.goal,
    hopedContribution: input.hopedContribution,
    disclosure,
    contextContract: issued.contract,
    threadId: input.threadId,
  };
  const fallbackBody = JSON.stringify(request);
  const delivered = await input.network.deliverWithReceipt(request);
  const response = delivered.response;

  if (delivered.receipt.delivered) {
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'request_sent',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: card.subjectId,
      threadId: input.threadId,
      summary: `向 ${card.displayName} 发出合作请求`,
      body: delivered.receipt.actualBodyDigest === bodyDigest(fallbackBody) ? fallbackBody : '',
      // Relay transports the standard A2A Message rather than the legacy
      // CollaborationRequest JSON. Preserve the digest of the bytes that were
      // actually sent even when the semantic event body is deliberately blank.
      bodyDigest: delivered.receipt.actualBodyDigest,
      protocolRef: `a2a:message:${exchangeId}`,
      disclosureAudit: {
        contractId: issued.contract.id,
        contentDigest: issued.contract.contentDigest,
        actualBodyDigest: delivered.receipt.actualBodyDigest,
        actualBytes: delivered.receipt.actualBytes,
        recipientEndpointRef: delivered.receipt.recipientEndpointRef,
        fieldRefs: issued.contract.fields.map((field) => field.ref),
      },
    });
  } else {
    await revokePersonalContextGrant({
      packageRoot: input.packageRoot,
      grant: issued.grant,
      revokedAt: input.now,
    });
    await appendExchange(input.packageRoot, {
      exchangeId,
      kind: 'delivery_failed',
      at: input.now,
      fromSubjectId: input.selfSubjectId,
      toSubjectId: card.subjectId,
      threadId: input.threadId,
      summary: '个人上下文未发送到接收端点',
      body: '',
      protocolRef: issued.contract.id,
    });
  }

  const unreachable = response.reply === '对方当前不可达。' && response.decision === 'decline';
  const received = !unreachable;
  const ok = response.decision === 'accept';
  if (received) await appendExchange(input.packageRoot, {
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
      evidenceDigest: response.evidenceDigest || '',
    }),
    peerDecision: response.decision,
    ...(response.usedOwnCapability ? { usedOwnCapability: true } : {}),
    protocolRef: `a2a:task:${exchangeId}`,
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
