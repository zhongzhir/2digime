export type Result<T, E = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface DomainError {
  code: string;
  message: string;
  /** 面向用户的可行动信息;禁止后台机制词汇。 */
  actionable?: string;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err(code: string, message: string, actionable?: string): Result<never, DomainError> {
  return { ok: false, error: actionable ? { code, message, actionable } : { code, message } };
}
