#!/usr/bin/env node
/**
 * MCP-READONLY-ADAPTER-01 fixture 只读服务器（JSON-RPC over stdio，CI 友好，零网络）。
 *
 * 提供只读工具：list_notes / lookup_note。
 * 另提供写工具 write_note：适配器必须拒绝调用（本服务器若被调用会返回明确错误，不落盘）。
 *
 * 协议为最小 JSON-RPC 2.0（逐行 stdio）：
 *   -> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
 *   <- {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}
 *   -> {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
 *   -> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lookup_note","arguments":{"note":"note-001.md"}}}
 *
 * 通用相对路径，禁止引用 Owner 主目录 / SubjectPackage / 密钥 / 真实简历。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const NOTES_DIR = path.resolve(__dirname, 'notes');

function loadNotes() {
  const out = [];
  const names = fs.readdirSync(NOTES_DIR);
  for (const name of names.sort()) {
    if (!/\.md$/.test(name)) continue;
    const full = path.join(NOTES_DIR, name);
    const text = fs.readFileSync(full, 'utf8');
    out.push({ name, text });
  }
  return out;
}

function lookupNote(note) {
  const name = String(note || '').trim();
  if (!name) return null;
  const resolved = path.resolve(NOTES_DIR, name);
  const prefix = NOTES_DIR.endsWith(path.sep) ? NOTES_DIR : NOTES_DIR + path.sep;
  if (resolved !== NOTES_DIR && !resolved.startsWith(prefix)) return null;
  try {
    const text = fs.readFileSync(resolved, 'utf8');
    return { name, text };
  } catch {
    return null;
  }
}

function toolsList() {
  return {
    tools: [
      {
        name: 'list_notes',
        description: '列出资料库中的所有资料条目',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'lookup_note',
        description: '按名称读取一篇资料内容',
        inputSchema: {
          type: 'object',
          properties: { note: { type: 'string' } },
          required: ['note'],
        },
      },
      {
        name: 'write_note',
        description: '写入/追加一篇资料（只读能力必须拒绝）',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' }, content: { type: 'string' } },
          required: ['name', 'content'],
        },
      },
    ],
  };
}

function callTool(name, args = {}) {
  if (name === 'list_notes') {
    return { result: { notes: loadNotes().map((n) => n.name) } };
  }
  if (name === 'lookup_note') {
    const found = lookupNote(args.note);
    if (!found) {
      return { error: { code: -32002, message: 'note not found' } };
    }
    return { result: { note: found.name, content: found.text } };
  }
  if (name === 'write_note') {
    // 只读能力：写工具必须被拒绝，且绝不落盘。
    return { error: { code: -32601, message: 'write tool is not allowed for readonly capability' } };
  }
  return { error: { code: -32601, message: `unknown tool: ${name}` } };
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  const id = req.id;
  const method = String(req.method || '');
  if (method === 'initialize' || method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: toolsList() });
    return;
  }
  if (method === 'tools/call') {
    const params = req.params || {};
    const callResult = callTool(String(params.name || ''), params.arguments || {});
    send({ jsonrpc: '2.0', id, ...callResult });
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
});