/**
 * Managed AI allowance ledger。只记能力结算身份与 token 用量。
 * 不存 Digital Self / 对话正文 / 偏好画像。
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';

export type AiAllowanceSource = 'TRIAL' | 'INSTITUTION' | 'BYOK';
export type AiAllowanceStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';

export interface AiAllowance {
  allowanceId: string;
  principalId: string;
  source: AiAllowanceSource;
  issuerId?: string;
  poolId?: string;
  provider: string;
  model: string;
  tokenLimit: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  validFrom: string;
  expiresAt?: string;
  status: AiAllowanceStatus;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface IdempotencyRecord {
  requestId: string;
  principalId: string;
  usage: TokenUsage;
  at: string;
}

export interface GlobalSpend {
  version: 1;
  tokensUsed: number;
  requestCount: number;
  day: string;
  dayRequests: number;
}

export interface InstitutionUsageSummary {
  issuerId: string;
  poolId: string;
  principalCount: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export function hashInstallTokenToPrincipalId(installToken: string): string {
  return createHash('sha256').update(String(installToken || '').trim(), 'utf8').digest('hex').slice(0, 32);
}

export function remainingTokens(row: AiAllowance): number {
  return Math.max(0, row.tokenLimit - row.tokensUsed);
}

export function remainingPercent(row: AiAllowance): number {
  if (row.tokenLimit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((remainingTokens(row) / row.tokenLimit) * 100)));
}

export function refreshAllowanceStatus(row: AiAllowance, nowIso: string): AiAllowance {
  if (row.expiresAt && row.expiresAt <= nowIso) {
    return { ...row, status: 'EXPIRED' };
  }
  if (row.tokensUsed >= row.tokenLimit) {
    return { ...row, status: 'EXHAUSTED' };
  }
  return { ...row, status: 'ACTIVE' };
}

export function createTrialAllowance(input: {
  principalId: string;
  tokenLimit: number;
  provider: string;
  model: string;
  nowIso: string;
}): AiAllowance {
  return {
    allowanceId: `alw_${randomUUID()}`,
    principalId: input.principalId,
    source: 'TRIAL',
    provider: input.provider,
    model: input.model,
    tokenLimit: Math.max(0, Math.floor(input.tokenLimit)),
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    validFrom: input.nowIso,
    status: input.tokenLimit > 0 ? 'ACTIVE' : 'EXHAUSTED',
  };
}

function dayKey(nowIso: string): string {
  return nowIso.slice(0, 10);
}

export function createFileAiAllowanceStore(dataDir: string): {
  dir: string;
  get: (principalId: string) => Promise<AiAllowance | null>;
  put: (row: AiAllowance) => Promise<void>;
  list: () => Promise<AiAllowance[]>;
  getIdempotency: (requestId: string) => Promise<IdempotencyRecord | null>;
  putIdempotency: (row: IdempotencyRecord) => Promise<void>;
  readGlobal: () => Promise<GlobalSpend>;
  putGlobal: (row: GlobalSpend) => Promise<void>;
  summarizeInstitution: (issuerId: string, poolId: string) => Promise<InstitutionUsageSummary>;
} {
  const dir = path.join(dataDir, 'ai-allowance');
  const idempDir = path.join(dataDir, 'ai-idempotency');
  const globalFile = path.join(dataDir, 'ai-global.json');

  function fileFor(principalId: string): string {
    return path.join(dir, `${principalId}.json`);
  }

  function idempFile(requestId: string): string {
    const hash = createHash('sha256').update(requestId, 'utf8').digest('hex').slice(0, 40);
    return path.join(idempDir, `${hash}.json`);
  }

  async function get(principalId: string): Promise<AiAllowance | null> {
    try {
      const raw = await fs.readFile(fileFor(principalId), 'utf8');
      const parsed = JSON.parse(raw) as AiAllowance;
      if (!parsed || typeof parsed.principalId !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async function put(row: AiAllowance): Promise<void> {
    await atomicWriteFile(fileFor(row.principalId), `${JSON.stringify(row, null, 2)}\n`);
  }

  async function list(): Promise<AiAllowance[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: AiAllowance[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const parsed = JSON.parse(raw) as AiAllowance;
        if (parsed && typeof parsed.principalId === 'string') out.push(parsed);
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async function getIdempotency(requestId: string): Promise<IdempotencyRecord | null> {
    try {
      const raw = await fs.readFile(idempFile(requestId), 'utf8');
      const parsed = JSON.parse(raw) as IdempotencyRecord;
      if (!parsed || parsed.requestId !== requestId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async function putIdempotency(row: IdempotencyRecord): Promise<void> {
    await atomicWriteFile(idempFile(row.requestId), `${JSON.stringify(row)}\n`);
  }

  async function readGlobal(): Promise<GlobalSpend> {
    try {
      const raw = await fs.readFile(globalFile, 'utf8');
      const parsed = JSON.parse(raw) as GlobalSpend;
      if (parsed && parsed.version === 1) return parsed;
    } catch {
      /* empty */
    }
    return { version: 1, tokensUsed: 0, requestCount: 0, day: '', dayRequests: 0 };
  }

  async function putGlobal(row: GlobalSpend): Promise<void> {
    await atomicWriteFile(globalFile, `${JSON.stringify(row, null, 2)}\n`);
  }

  async function summarizeInstitution(issuerId: string, poolId: string): Promise<InstitutionUsageSummary> {
    const rows = await list();
    const matched = rows.filter(
      (row) => row.source === 'INSTITUTION' && row.issuerId === issuerId && row.poolId === poolId,
    );
    return {
      issuerId,
      poolId,
      principalCount: matched.length,
      tokensUsed: matched.reduce((sum, row) => sum + (row.tokensUsed || 0), 0),
      inputTokens: matched.reduce((sum, row) => sum + (row.inputTokens || 0), 0),
      outputTokens: matched.reduce((sum, row) => sum + (row.outputTokens || 0), 0),
      requestCount: matched.reduce((sum, row) => sum + (row.requestCount || 0), 0),
    };
  }

  return {
    dir,
    get,
    put,
    list,
    getIdempotency,
    putIdempotency,
    readGlobal,
    putGlobal,
    summarizeInstitution,
  };
}

export function bumpGlobalSpend(
  current: GlobalSpend,
  usage: TokenUsage,
  nowIso: string,
): GlobalSpend {
  const day = dayKey(nowIso);
  const dayRequests = current.day === day ? current.dayRequests + 1 : 1;
  return {
    version: 1,
    tokensUsed: current.tokensUsed + usage.totalTokens,
    requestCount: current.requestCount + 1,
    day,
    dayRequests,
  };
}
