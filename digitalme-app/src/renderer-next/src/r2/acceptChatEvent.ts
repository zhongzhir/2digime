/**
 * Typed facade over the single production acceptChatEvent implementation
 * in src/r2/chat-event-accept.js (shared with main/contracts tests).
 */
import type { ChatEvent, MessageView } from "./types";
import { acceptChatEvent as acceptChatEventImpl } from "../../../r2/chat-event-accept.js";

export type ChatEventState = {
  triple: { requestId: string; sessionId: string; messageId: string } | null;
  seqCursor: number;
  streamByMessageId: Record<string, string>;
  messages: MessageView[] | null;
  active: boolean;
  error: string | null;
  accepted?: boolean;
  reason?: string | null;
  terminal?: string;
  finalDisplayText?: string;
};

export function acceptChatEvent(
  state: ChatEventState,
  ev: ChatEvent | null | undefined
): ChatEventState {
  return acceptChatEventImpl(state, ev) as ChatEventState;
}
