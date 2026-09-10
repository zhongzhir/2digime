/**
 * 历史能力槽位作文。Talk 主链不再调用。
 * 保留空实现以免外部 import 立即崩；不要再向模型注入「已连接 / 适合复杂」策略。
 */
export async function compileCapabilityReality(_input?: unknown): Promise<string> {
  return '';
}
