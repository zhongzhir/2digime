export function checkDisclosure(input: {
  disclosure: string;
  selfContext: string;
  threadText: string;
}): { ok: true } | { ok: false; reason: string } {
  const disclosure = String(input.disclosure || '').trim();
  if (!disclosure) return { ok: false, reason: '没有可发送的合作上下文' };
  if (disclosure.length > 6000) return { ok: false, reason: '披露过长，超出本次授权' };

  const self = String(input.selfContext || '').trim();
  if (self.length >= 80 && disclosure.includes(self)) {
    return { ok: false, reason: '不得把完整 Digital Self 发给对方' };
  }

  const thread = String(input.threadText || '').trim();
  if (thread.length >= 200 && disclosure.includes(thread)) {
    return { ok: false, reason: '不得把完整交流线程发给对方' };
  }

  if (/护照|身份证号|密钥|private key|BEGIN [A-Z ]*PRIVATE KEY/i.test(disclosure)) {
    return { ok: false, reason: '敏感身份或密钥不在当前授权内' };
  }
  if (/支付|转账|汇款/.test(disclosure) && /账号|卡号|钱包/.test(disclosure)) {
    return { ok: false, reason: '支付信息不在当前授权内' };
  }
  return { ok: true };
}

export function threadPlainText(turns: Array<{ role: string; text: string }>): string {
  return turns.map((turn) => `${turn.role}: ${turn.text}`).join('\n');
}
