/**
 * Pure chat:event acceptance — mirrors src/r2/chat-event-accept.js
 */
import type { ChatEvent, MessageView } from "./types";

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

export function acceptChatEvent(state: ChatEventState, ev: ChatEvent | null | undefined): ChatEventState {
  const prev: ChatEventState = state || {
    triple: null,
    seqCursor: 0,
    streamByMessageId: {},
    messages: null,
    active: true,
    error: null,
  };

  if (!ev || typeof ev !== "object") {
    return { ...prev, accepted: false, reason: "invalid_event" };
  }

  const triple = prev.triple;
  if (!triple) {
    return { ...prev, accepted: false, reason: "no_triple" };
  }

  if (
    ev.requestId !== triple.requestId ||
    ev.sessionId !== triple.sessionId ||
    ev.messageId !== triple.messageId
  ) {
    return { ...prev, accepted: false, reason: "triple_mismatch" };
  }

  if (typeof ev.sequence !== "number" || ev.sequence <= prev.seqCursor) {
    return { ...prev, accepted: false, reason: "sequence_stale" };
  }

  const next: ChatEventState = {
    ...prev,
    seqCursor: ev.sequence,
    accepted: true,
    reason: null,
    streamByMessageId: { ...(prev.streamByMessageId || {}) },
    messages: prev.messages ? prev.messages.slice() : null,
  };

  if (ev.type === "delta") {
    const id = ev.messageId;
    next.streamByMessageId[id] = (next.streamByMessageId[id] || "") + String(ev.textDelta || "");
    return next;
  }

  if (ev.type === "complete" || ev.type === "stopped" || ev.type === "error") {
    const finalText = String(ev.displayText || "");
    delete next.streamByMessageId[ev.messageId];
    if (next.messages) {
      next.messages = next.messages.map((m) =>
        m && m.id === ev.messageId
          ? { ...m, displayText: finalText || m.displayText || "" }
          : m
      );
    }
    next.triple = null;
    next.active = false;
    if (ev.type === "error") {
      next.error = String(ev.message || "回复失败");
    }
    next.terminal = ev.type;
    next.finalDisplayText = finalText;
    return next;
  }

  return { ...prev, accepted: false, reason: "unknown_type" };
}
