"use strict";

const fs = require("node:fs");
const path = require("node:path");

function sessionsPath(userData) {
  return path.join(userData, "workbench-sessions.json");
}

function loadStore(userData) {
  const p = sessionsPath(userData);
  if (!fs.existsSync(p)) {
    return { version: 1, activeId: null, sessions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { version: 1, activeId: null, sessions: [] };
  }
}

function saveStore(userData, store) {
  fs.writeFileSync(sessionsPath(userData), JSON.stringify(store, null, 2), "utf8");
}

function newId() {
  return "s_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e4);
}

function createSession(userData, opts = {}) {
  const store = loadStore(userData);
  const s = {
    id: newId(),
    title: opts.title || "新对话",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    attachments: [],
    artifacts: [],
    packagePath: opts.packagePath || null,
  };
  store.sessions.unshift(s);
  store.activeId = s.id;
  saveStore(userData, store);
  return s;
}

function listSessions(userData) {
  const store = loadStore(userData);
  return {
    activeId: store.activeId,
    sessions: store.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
      preview: (s.messages.find((m) => m.role === "user") || {}).content?.slice(0, 40) || "",
    })),
  };
}

function getSession(userData, id) {
  const store = loadStore(userData);
  return store.sessions.find((s) => s.id === id) || null;
}

function saveSession(userData, session) {
  const store = loadStore(userData);
  const i = store.sessions.findIndex((s) => s.id === session.id);
  session.updatedAt = new Date().toISOString();
  if (i >= 0) store.sessions[i] = session;
  else store.sessions.unshift(session);
  store.activeId = session.id;
  // keep newest first
  store.sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  saveStore(userData, store);
  return session;
}

function renameSession(userData, id, title) {
  const store = loadStore(userData);
  const s = store.sessions.find((x) => x.id === id);
  if (!s) throw new Error("找不到该对话");
  s.title = String(title || "未命名").slice(0, 60);
  s.updatedAt = new Date().toISOString();
  saveStore(userData, store);
  return s;
}

function deleteSession(userData, id) {
  const store = loadStore(userData);
  store.sessions = store.sessions.filter((s) => s.id !== id);
  if (store.activeId === id) store.activeId = store.sessions[0]?.id || null;
  saveStore(userData, store);
  return { activeId: store.activeId };
}

function setActive(userData, id) {
  const store = loadStore(userData);
  if (!store.sessions.some((s) => s.id === id)) throw new Error("找不到该对话");
  store.activeId = id;
  saveStore(userData, store);
  return getSession(userData, id);
}

module.exports = {
  loadStore,
  listSessions,
  getSession,
  createSession,
  saveSession,
  renameSession,
  deleteSession,
  setActive,
};
