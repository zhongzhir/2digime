import React, { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ARTIFACT_PREVIEW_TRUNCATE_NOTICE,
  USER_RETURN_BLOCK,
  type ActiveRequest,
  type ChatEvent,
  type MessageView,
  type R2Api,
  type SessionListItem,
  type SessionView,
} from "./r2/types";
import { codePointCount, foldPlan, sliceCodePoints } from "./r2/text";

type Stamp = {
  ok?: boolean;
  gitHead?: string | null;
  builtAt?: string;
  apiVersion?: number;
};

type EntryState = {
  preferredEntry?: string;
  effectiveEntry?: string;
  fallbackLatched?: boolean;
  navigationGeneration?: number;
};

type RuntimeFacade = {
  getStamp: () => Promise<Stamp>;
  getRendererEntry: () => Promise<{ ok: boolean } & EntryState>;
  requestRendererEntry: (
    entry: string,
    reason?: string
  ) => Promise<{ ok: boolean; code?: string; message?: string }>;
  signalReady: (generation?: number) => Promise<{ ok: boolean; code?: string }>;
  getBoundGeneration: () => Promise<{ ok: boolean; generation: number | null }>;
  failReadyEnabled?: boolean;
  injectErrorBoundary?: boolean;
};

declare global {
  interface Window {
    digitalMe?: {
      runtime?: RuntimeFacade;
      getRuntimeStamp?: () => Promise<Stamp>;
      r2?: R2Api;
    };
  }
}

function getR2(): R2Api | null {
  return window.digitalMe?.r2 || null;
}

/** Harness-only: throws during render so Error Boundary must catch via getDerivedStateFromError. */
function InjectRenderThrow(): ReactNode {
  throw new Error("injected_shell_render_error");
}

class ShellErrorBoundary extends Component<
  { children: ReactNode; injectFail?: boolean },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="shell-error" data-testid="shell-error">
          <h1>界面暂时无法显示</h1>
          <p>请返回经典界面后重试。</p>
        </div>
      );
    }
    return (
      <>
        {this.props.injectFail ? <InjectRenderThrow /> : null}
        {this.props.children}
      </>
    );
  }
}

function MessageBubble({
  message,
  streamingText,
}: {
  message: MessageView;
  streamingText?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = streamingText != null ? streamingText : message.displayText || "";
  const plan = foldPlan(text, { forbidExpand: message.forbidExpand || message.role === "user" });
  const shown = plan.needsFold && !expanded ? plan.preview : plan.expanded;

  return (
    <div
      className={`msg msg-${message.role}`}
      data-testid={`msg-${message.role}`}
      data-message-id={message.id}
    >
      <div className="msg-role">{message.role === "user" ? "我" : "助手"}</div>
      <div className="msg-body" data-testid="msg-display-text">
        {shown}
      </div>
      {message.attachmentRefs?.length ? (
        <ul className="msg-refs" data-testid="msg-attachment-refs">
          {message.attachmentRefs.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
      ) : null}
      {plan.needsFold ? (
        <button
          type="button"
          className="linkish"
          data-testid="msg-fold-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开全文"}
        </button>
      ) : null}
    </div>
  );
}

function ChatWorkbench() {
  const r2 = getR2();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string>("");
  const [banner, setBanner] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [streamBuf, setStreamBuf] = useState<Record<string, string>>({});
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingAttachNames, setPendingAttachNames] = useState<string[]>([]);
  const [artifactPreviewNotice, setArtifactPreviewNotice] = useState<string | null>(null);
  const seqCursor = useRef(0);
  const tripleRef = useRef<{ requestId: string; sessionId: string; messageId: string } | null>(
    null
  );
  const sendingLock = useRef(false);

  const busy = !!activeRequest;

  const refreshList = useCallback(async () => {
    if (!r2) return;
    const listed = await r2.listSessions();
    if (listed.recovery?.latched) {
      setBanner("会话存档当前无法安全写入。可新建对话前请返回经典界面处理，或稍后重试。");
    }
    if (!listed.ok && listed.error) {
      setError(listed.error.message);
    }
    setSessions(listed.sessions || []);
    setActiveId(listed.activeId);
    return listed;
  }, [r2]);

  const loadSession = useCallback(
    async (id: string) => {
      if (!r2 || !id) return;
      const res = await r2.getSession(id);
      if (!res.ok || !res.session) {
        setError(res.message || "无法加载对话");
        return;
      }
      // Ensure DTO never leaks into DOM via accidental fields — only displayText
      const cleaned: SessionView = {
        ...res.session,
        messages: (res.session.messages || []).map((m) => ({
          id: m.id,
          role: m.role,
          displayText: m.displayText,
          attachmentRefs: (m.attachmentRefs || []).map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            size: r.size,
          })),
          createdAt: m.createdAt,
          forbidExpand: m.forbidExpand,
          _broken: m._broken,
        })),
      };
      setSession(cleaned);
      setActiveId(cleaned.id);
      setArtifactPreviewNotice(null);
    },
    [r2]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!r2) {
        setError("对话接口不可用");
        return;
      }
      const listed = await refreshList();
      if (cancelled) return;
      const id = listed?.activeId || listed?.sessions?.[0]?.id;
      if (id) await loadSession(id);
      const ar = await r2.getActiveRequest();
      if (!cancelled) setActiveRequest(ar.activeRequest);
    })();
    return () => {
      cancelled = true;
    };
  }, [r2, refreshList, loadSession]);

  useEffect(() => {
    if (!r2) return;
    const unsub = r2.onChatEvent((ev: ChatEvent) => {
      const t = tripleRef.current;
      if (!t) return;
      if (
        ev.requestId !== t.requestId ||
        ev.sessionId !== t.sessionId ||
        ev.messageId !== t.messageId
      ) {
        return;
      }
      if (typeof ev.sequence !== "number" || ev.sequence <= seqCursor.current) {
        return;
      }
      seqCursor.current = ev.sequence;
      if (ev.type === "delta") {
        setStreamBuf((prev) => ({
          ...prev,
          [ev.messageId]: (prev[ev.messageId] || "") + String(ev.textDelta || ""),
        }));
      } else if (ev.type === "complete" || ev.type === "stopped" || ev.type === "error") {
        const finalText = String(ev.displayText || "");
        setStreamBuf((prev) => {
          const next = { ...prev };
          delete next[ev.messageId];
          return next;
        });
        setSession((prev) => {
          if (!prev || prev.id !== ev.sessionId) return prev;
          return {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === ev.messageId ? { ...m, displayText: finalText || m.displayText } : m
            ),
          };
        });
        if (ev.type === "error") setError(ev.message || "回复失败");
        setActiveRequest(null);
        tripleRef.current = null;
        void refreshList();
      }
    });
    return unsub;
  }, [r2, refreshList]);

  async function onNewSession() {
    if (!r2 || busy) {
      if (busy) setError("请先停止当前回复，再新建对话。");
      return;
    }
    setError("");
    const res = await r2.createSession({ title: "新对话" });
    if (!res.ok) {
      setError(res.message || "无法新建对话");
      return;
    }
    await refreshList();
    if (res.session) {
      setSession(res.session);
      setActiveId(res.session.id);
    }
  }

  async function onSwitch(id: string) {
    if (!r2 || busy) {
      if (busy) setError("请先停止当前回复，再切换对话。");
      return;
    }
    if (id === activeId) return;
    setError("");
    const res = await r2.setCurrentSession(id);
    if (!res.ok) {
      setError(res.message || "无法切换对话");
      return;
    }
    await loadSession(id);
    await refreshList();
    setMenuId(null);
  }

  async function commitRename(id: string) {
    if (!r2 || busy) return;
    const title = renameDraft.trim().slice(0, 60) || "未命名";
    const res = await r2.renameSession({ id, title });
    setRenamingId(null);
    if (!res.ok) {
      setError(res.message || "改名未保存");
      return;
    }
    setError("");
    await refreshList();
    if (session?.id === id && res.session) setSession(res.session);
  }

  async function confirmDelete(id: string) {
    if (!r2 || busy) {
      if (busy) setError("请先停止当前回复，再删除对话。");
      return;
    }
    const res = await r2.deleteSession(id);
    setDeleteConfirmId(null);
    if (!res.ok) {
      setError(res.message || "删除未完成");
      return;
    }
    setError("");
    const listed = await refreshList();
    const nextId = res.activeId || listed?.sessions?.[0]?.id || null;
    if (nextId) await loadSession(nextId);
    else setSession(null);
  }

  async function onSend() {
    if (!r2 || !session || busy || sendingLock.current) return;
    const text = draft;
    if (!text.trim()) {
      setError("请输入要发送的内容。");
      return;
    }
    if (codePointCount(text.trim()) > 2000) {
      setError("内容过长，请将输入控制在 2000 字以内。");
      return;
    }
    sendingLock.current = true;
    setError("");
    try {
      const res = await r2.sendChat({
        sessionId: session.id,
        inputText: text,
        attachmentSelectionToken: pendingToken || undefined,
        linkedArtifactId: session.linkedArtifact?.libraryId || undefined,
        scenarioHint: "general_chat",
      });
      if (!res.ok) {
        setError(res.message || "发送失败");
        // keep draft
        return;
      }
      setDraft("");
      setPendingToken(null);
      setPendingAttachNames([]);
      seqCursor.current = 0;
      if (res.requestId && res.assistantMessageId) {
        tripleRef.current = {
          requestId: res.requestId,
          sessionId: session.id,
          messageId: res.assistantMessageId,
        };
        setActiveRequest({
          requestId: res.requestId,
          originSessionId: session.id,
          assistantMessageId: res.assistantMessageId,
          startedAt: new Date().toISOString(),
          status: "running",
        });
      }
      await loadSession(session.id);
      await refreshList();
    } finally {
      sendingLock.current = false;
    }
  }

  async function onStop() {
    if (!r2 || !activeRequest) return;
    await r2.stopChat({ requestId: activeRequest.requestId });
  }

  async function onPickAttachments() {
    if (!r2 || !session || busy) return;
    const res = await r2.pickAttachments({ sessionId: session.id });
    if (!res.ok) {
      setError(res.message || "无法添加材料");
      return;
    }
    if (res.canceled) return;
    setPendingToken(res.token || null);
    setPendingAttachNames((res.attachments || []).map((a) => a.name));
  }

  async function onClearArtifact() {
    if (!r2 || !session || busy) {
      if (busy) setError("请先停止当前回复，再清除关联文稿。");
      return;
    }
    const prev = session;
    setSession({ ...session, linkedArtifact: null });
    const res = await r2.clearLinkedArtifact({ sessionId: session.id });
    if (!res.ok) {
      setSession(prev);
      setError(res.message || "清除未保存");
      return;
    }
    if (res.session) setSession(res.session);
  }

  async function onOpenArtifact() {
    if (!r2 || !session?.linkedArtifact?.libraryId || busy) {
      if (busy) setError("请先停止当前回复，再打开关联文稿。");
      return;
    }
    const res = await r2.openLinkedArtifact({
      sessionId: session.id,
      libraryId: session.linkedArtifact.libraryId,
    });
    if (!res.ok) setError(res.message || "未能打开关联文稿");
  }

  /** Controlled preview helper for tests / future artifact peek — never spills overflow. */
  function showControlledPreview(full: string) {
    const max = 8000;
    if (codePointCount(full) <= max) {
      setArtifactPreviewNotice(null);
      return sliceCodePoints(full, max);
    }
    setArtifactPreviewNotice(ARTIFACT_PREVIEW_TRUNCATE_NOTICE);
    return sliceCodePoints(full, max);
  }

  // Expose for E2E harness checks without putting overflow in DOM dataset
  useEffect(() => {
    (window as unknown as { __r2Preview?: typeof showControlledPreview }).__r2Preview =
      showControlledPreview;
    return () => {
      delete (window as unknown as { __r2Preview?: unknown }).__r2Preview;
    };
  });

  if (!r2) {
    return (
      <div className="chat-root" data-testid="chat-unavailable">
        <p>对话接口不可用</p>
      </div>
    );
  }

  return (
    <div className="chat-root" data-testid="r2-chat-root">
      <aside className="session-sidebar" data-testid="session-sidebar">
        <div className="sidebar-toolbar">
          <button
            type="button"
            data-testid="btn-new-session"
            disabled={busy}
            onClick={() => void onNewSession()}
          >
            新对话
          </button>
        </div>
        {sessions.length === 0 ? (
          <div className="empty-sessions" data-testid="sessions-empty">
            还没有对话。点击「新对话」开始。
          </div>
        ) : (
          <ul className="session-list" data-testid="session-list">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={s.id === activeId ? "active" : ""}
                data-testid="session-row"
                data-session-id={s.id}
              >
                {renamingId === s.id ? (
                  <input
                    data-testid="session-rename-input"
                    value={renameDraft}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value.slice(0, 60))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(s.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => void commitRename(s.id)}
                  />
                ) : (
                  <button
                    type="button"
                    className="session-title-btn"
                    disabled={busy}
                    onClick={() => void onSwitch(s.id)}
                  >
                    <span className="session-title">{s.broken ? "无法显示的对话" : s.title}</span>
                    {s.preview ? <span className="session-preview">{s.preview}</span> : null}
                  </button>
                )}
                <div className="session-menu-wrap">
                  <button
                    type="button"
                    className="menu-trigger"
                    data-testid="session-menu-trigger"
                    aria-label="更多"
                    disabled={busy}
                    onClick={() => setMenuId(menuId === s.id ? null : s.id)}
                  >
                    ⋯
                  </button>
                  {menuId === s.id ? (
                    <div className="session-menu" data-testid="session-menu">
                      <button
                        type="button"
                        data-testid="session-rename"
                        onClick={() => {
                          setRenamingId(s.id);
                          setRenameDraft(s.title || "");
                          setMenuId(null);
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        data-testid="session-delete"
                        onClick={() => {
                          setDeleteConfirmId(s.id);
                          setMenuId(null);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="chat-main" data-testid="chat-main">
        <header className="chat-header">
          <h1 data-testid="chat-title">{session?.title || "对话"}</h1>
          <span className="status-tag" data-testid="capability-status">
            预览
          </span>
        </header>

        {banner ? (
          <div className="banner warn" data-testid="recovery-banner">
            {banner}
          </div>
        ) : null}
        {error ? (
          <div className="banner error" data-testid="chat-error" role="alert">
            {error}
          </div>
        ) : null}

        {session?.linkedArtifact ? (
          <div className="artifact-card" data-testid="linked-artifact-card">
            <div className="artifact-card-meta">
              <span className="artifact-label">{session.linkedArtifact.label}</span>
              <strong data-testid="linked-artifact-title">{session.linkedArtifact.title}</strong>
            </div>
            <div className="artifact-card-actions">
              <button
                type="button"
                data-testid="btn-open-artifact"
                disabled={busy}
                onClick={() => void onOpenArtifact()}
              >
                打开文稿
              </button>
              <button
                type="button"
                data-testid="btn-clear-artifact"
                disabled={busy}
                onClick={() => void onClearArtifact()}
              >
                关闭关联
              </button>
            </div>
          </div>
        ) : null}
        {artifactPreviewNotice ? (
          <p className="truncate-notice" data-testid="artifact-truncate-notice">
            {artifactPreviewNotice}
          </p>
        ) : null}

        <div className="messages" data-testid="messages">
          {!session ? (
            <p className="muted">请选择或新建一个对话。</p>
          ) : session.messages.length === 0 ? (
            <p className="muted" data-testid="messages-empty">
              开始提问吧。
            </p>
          ) : (
            session.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                streamingText={streamBuf[m.id]}
              />
            ))
          )}
        </div>

        {pendingAttachNames.length ? (
          <div className="pending-attach" data-testid="pending-attachments">
            已选择：{pendingAttachNames.join("、")}
          </div>
        ) : null}

        <div className="composer" data-testid="composer">
          <textarea
            data-testid="chat-input"
            value={draft}
            rows={3}
            disabled={busy}
            placeholder="输入消息…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <div className="composer-actions">
            <button
              type="button"
              data-testid="btn-attach"
              disabled={busy || !session}
              onClick={() => void onPickAttachments()}
            >
              添加材料
            </button>
            {busy ? (
              <button type="button" data-testid="btn-stop" onClick={() => void onStop()}>
                停止
              </button>
            ) : (
              <button
                type="button"
                data-testid="btn-send"
                disabled={!session}
                onClick={() => void onSend()}
              >
                发送
              </button>
            )}
          </div>
          {busy ? (
            <p className="muted" data-testid="request-in-progress">
              正在回复…可点「停止」。此间不能切换或新建对话。
            </p>
          ) : null}
        </div>
      </section>

      {deleteConfirmId ? (
        <div className="modal-backdrop" data-testid="delete-confirm-modal">
          <div className="modal">
            <p>确定删除这个对话吗？删除后无法从本界面恢复。</p>
            <div className="modal-actions">
              <button type="button" data-testid="delete-cancel" onClick={() => setDeleteConfirmId(null)}>
                取消
              </button>
              <button
                type="button"
                data-testid="delete-confirm"
                onClick={() => void confirmDelete(deleteConfirmId)}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NextShell() {
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [readyCode, setReadyCode] = useState<string>("pending");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const runtime = window.digitalMe?.runtime;
      if (!runtime) {
        setMessage("运行时接口不可用");
        return;
      }

      const stampResult = await runtime.getStamp();
      const entryResult = await runtime.getRendererEntry();
      if (cancelled) return;
      setStamp(stampResult || null);
      setEntry(entryResult || null);

      if (runtime.failReadyEnabled) {
        setReadyCode("fail_injected");
        return;
      }

      const bound = await runtime.getBoundGeneration();
      const generation = bound?.generation ?? undefined;
      const ready = await runtime.signalReady(generation ?? undefined);
      if (cancelled) return;
      setReadyCode(ready?.ok ? "ok" : ready?.code || "failed");
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onReturnLegacy() {
    const runtime = window.digitalMe?.runtime;
    const r2 = getR2();
    if (!runtime) return;
    if (r2) {
      const ar = await r2.getActiveRequest();
      if (ar.activeRequest) {
        setMessage(USER_RETURN_BLOCK);
        return;
      }
    }
    const result = await runtime.requestRendererEntry("legacy", "user_return");
    if (!result?.ok && result?.code === "request_in_progress") {
      setMessage(result.message || USER_RETURN_BLOCK);
      return;
    }
    setMessage(result?.ok ? "正在返回经典界面" : `无法返回：${result?.code || "unknown"}`);
  }

  const stampText = stamp?.gitHead
    ? String(stamp.gitHead).slice(0, 12)
    : stamp?.builtAt
      ? String(stamp.builtAt)
      : "未提供";

  return (
    <div className="shell" data-testid="renderer-next-shell">
      <header className="shell-header">
        <div className="brand">Digital Me</div>
        <div className="header-right">
          <span className="meta-inline" data-testid="runtime-stamp">
            <span data-testid="runtime-stamp-value">{stampText}</span>
            <span data-testid="effective-entry">{entry?.effectiveEntry || "—"}</span>
            <span data-testid="ready-status">{readyCode}</span>
          </span>
          <button type="button" data-testid="return-legacy" onClick={() => void onReturnLegacy()}>
            返回经典界面
          </button>
        </div>
      </header>
      {message ? (
        <p className="message top-msg" data-testid="shell-message">
          {message}
        </p>
      ) : null}
      <ChatWorkbench />
    </div>
  );
}

export function AppShell() {
  const injectFail = Boolean(window.digitalMe?.runtime?.injectErrorBoundary);
  return (
    <ShellErrorBoundary injectFail={injectFail}>
      <NextShell />
    </ShellErrorBoundary>
  );
}
