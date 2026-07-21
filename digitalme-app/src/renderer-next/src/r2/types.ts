export type SessionListItem = {
  id: string;
  title: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  preview?: string;
  broken?: boolean;
};

export type AttachmentRefView = {
  id: string;
  name: string;
  type?: string;
  size?: number;
};

export type MessageView = {
  id: string;
  role: "user" | "assistant";
  displayText: string;
  attachmentRefs: AttachmentRefView[];
  createdAt: string;
  forbidExpand?: boolean;
  _broken?: boolean;
};

export type LinkedArtifactCard = {
  libraryId: string | null;
  title: string;
  label: string;
};

export type SessionView = {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  messages: MessageView[];
  linkedArtifact: LinkedArtifactCard | null;
};

export type ActiveRequest = {
  requestId: string;
  originSessionId: string;
  assistantMessageId: string;
  startedAt: string;
  status: string;
  sequence?: number;
};

export type ChatEvent = {
  requestId: string;
  sessionId: string;
  messageId: string;
  sequence: number;
  type: "delta" | "complete" | "stopped" | "error";
  textDelta?: string;
  displayText?: string;
  message?: string;
};

export type R2Api = {
  listSessions: () => Promise<{
    ok: boolean;
    activeId: string | null;
    sessions: SessionListItem[];
    error?: { code: string; message: string } | null;
    recovery?: { latched: boolean };
  }>;
  getSession: (id: string) => Promise<{ ok: boolean; session?: SessionView; code?: string; message?: string }>;
  createSession: (opts?: { title?: string }) => Promise<{
    ok: boolean;
    session?: SessionView;
    code?: string;
    message?: string;
  }>;
  renameSession: (payload: { id: string; title: string }) => Promise<{
    ok: boolean;
    session?: SessionView;
    code?: string;
    message?: string;
  }>;
  deleteSession: (id: string) => Promise<{ ok: boolean; activeId?: string | null; code?: string; message?: string }>;
  setCurrentSession: (id: string) => Promise<{
    ok: boolean;
    session?: SessionView;
    code?: string;
    message?: string;
  }>;
  sendChat: (payload: {
    sessionId: string;
    inputText: string;
    attachmentSelectionToken?: string;
    linkedArtifactId?: string;
    scenarioHint?: string;
  }) => Promise<{
    ok: boolean;
    requestId?: string;
    assistantMessageId?: string;
    displayText?: string;
    stopped?: boolean;
    code?: string;
    message?: string;
  }>;
  stopChat: (payload?: { requestId?: string }) => Promise<{ ok: boolean; code?: string; message?: string }>;
  getActiveRequest: () => Promise<{ ok: boolean; activeRequest: ActiveRequest | null }>;
  pickAttachments: (payload: { sessionId: string }) => Promise<{
    ok: boolean;
    canceled?: boolean;
    token?: string | null;
    attachments?: Array<{ id: string; name: string; type?: string; size?: number; note?: string; ok?: boolean }>;
    code?: string;
    message?: string;
  }>;
  clearLinkedArtifact: (payload: { sessionId: string }) => Promise<{
    ok: boolean;
    session?: SessionView;
    code?: string;
    message?: string;
  }>;
  openLinkedArtifact: (payload: { sessionId: string; libraryId: string }) => Promise<{
    ok: boolean;
    code?: string;
    message?: string;
  }>;
  onChatEvent: (cb: (ev: ChatEvent) => void) => () => void;
};

export const ARTIFACT_PREVIEW_TRUNCATE_NOTICE =
  "内容较长，当前仅展示前 8000 字。完整内容未写入聊天记录；需要查看时，请打开关联文稿。";

export const FOLD_PREVIEW = 1600;
export const FOLD_EXPAND_MAX = 8000;
export const USER_RETURN_BLOCK = "请先停止当前回复，再返回经典界面。";
