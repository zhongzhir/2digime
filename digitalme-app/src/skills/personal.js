"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PRESET_RESEARCH_SKILLS } = require("./research-presets");
const { PRESET_CODE_SKILLS } = require("./code-presets");

function storePath(userData) {
  return path.join(userData, "personal-skills.json");
}

function emptyStore() {
  return { version: 1, items: [], activeByScene: {} };
}

function readStore(userData) {
  const p = storePath(userData);
  try {
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !Array.isArray(raw.items)) return emptyStore();
    return {
      version: raw.version || 1,
      items: raw.items,
      activeByScene: raw.activeByScene || {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(userData, store) {
  fs.writeFileSync(storePath(userData), JSON.stringify(store, null, 2), "utf8");
}

function listSkills(userData, scene) {
  const items = readStore(userData).items.slice();
  if (!scene) return items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return items
    .filter((s) => !s.sceneTags || !s.sceneTags.length || s.sceneTags.includes(scene) || s.sceneTags.includes("all"))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function getSkill(userData, id) {
  return readStore(userData).items.find((x) => x.id === id) || null;
}

function saveSkill(userData, skill) {
  const store = readStore(userData);
  const now = new Date().toISOString();
  const id = skill.id || "psk_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000);
  const next = {
    id,
    title: String(skill.title || "未命名 Skill").trim(),
    blurb: String(skill.blurb || "").trim(),
    systemHint: String(skill.systemHint || "").trim(),
    prompt: String(skill.prompt || "").trim(),
    sceneTags: Array.isArray(skill.sceneTags) ? skill.sceneTags : skill.scene ? [skill.scene] : ["all"],
    recommendedExtensions: Array.isArray(skill.recommendedExtensions) ? skill.recommendedExtensions : [],
    steps: Array.isArray(skill.steps) ? skill.steps : [],
    createdAt: skill.createdAt || now,
    updatedAt: now,
  };
  const i = store.items.findIndex((x) => x.id === id);
  if (i >= 0) store.items[i] = { ...store.items[i], ...next, createdAt: store.items[i].createdAt };
  else store.items.unshift(next);
  writeStore(userData, store);
  return next;
}

function deleteSkill(userData, id) {
  const store = readStore(userData);
  store.items = store.items.filter((x) => x.id !== id);
  for (const scene of Object.keys(store.activeByScene || {})) {
    if (store.activeByScene[scene] === id) delete store.activeByScene[scene];
  }
  writeStore(userData, store);
  return { ok: true };
}

function setActiveSkill(userData, scene, skillId) {
  const store = readStore(userData);
  if (skillId && !store.items.find((x) => x.id === skillId)) throw new Error("Skill 不存在。");
  store.activeByScene = store.activeByScene || {};
  if (!skillId) delete store.activeByScene[scene];
  else store.activeByScene[scene] = skillId;
  writeStore(userData, store);
  return { ok: true, activeId: store.activeByScene[scene] || null };
}

function getActiveSkill(userData, scene) {
  const store = readStore(userData);
  const id = store.activeByScene && store.activeByScene[scene];
  if (!id) return null;
  return store.items.find((x) => x.id === id) || null;
}

/** Create skill from current research/write context */
function saveFromContext(userData, payload) {
  const scene = payload.scene || "all";
  const title = String(payload.title || "").trim() || (scene === "research" ? "研究流程 Skill" : "写作流程 Skill");
  const systemHint =
    String(payload.systemHint || "").trim() ||
    (scene === "research"
      ? "【本人 Skill · 研究】按课题阶段推进；结论须标明依据与待核实；优先使用已挂载资料。"
      : "【本人 Skill · 写作】按本人表达风格与判断框架改写；用 Markdown 输出完整正文。");
  return saveSkill(userData, {
    title,
    blurb: payload.blurb || "由当前工作台流程保存",
    systemHint,
    prompt: payload.prompt || "",
    sceneTags: payload.sceneTags || [scene],
    recommendedExtensions: payload.recommendedExtensions || [],
    steps: payload.steps || [],
  });
}

function ensurePresetResearchSkills(userData) {
  const store = readStore(userData);
  let changed = false;
  const now = new Date().toISOString();
  for (const preset of PRESET_RESEARCH_SKILLS) {
    if (!store.items.find((x) => x.id === preset.id)) {
      store.items.push({
        ...preset,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
  }
  if (!store.activeByScene?.research && PRESET_RESEARCH_SKILLS[0]) {
    store.activeByScene = store.activeByScene || {};
    store.activeByScene.research = PRESET_RESEARCH_SKILLS[0].id;
    changed = true;
  }
  if (changed) writeStore(userData, store);
  return { changed, activeId: store.activeByScene?.research || null };
}

function ensurePresetCodeSkills(userData) {
  const store = readStore(userData);
  let changed = false;
  const now = new Date().toISOString();
  for (const preset of PRESET_CODE_SKILLS) {
    if (!store.items.find((x) => x.id === preset.id)) {
      store.items.push({
        ...preset,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
  }
  if (!store.activeByScene?.code && PRESET_CODE_SKILLS[0]) {
    store.activeByScene = store.activeByScene || {};
    store.activeByScene.code = PRESET_CODE_SKILLS[0].id;
    changed = true;
  }
  if (changed) writeStore(userData, store);
  return { changed, activeId: store.activeByScene?.code || null };
}

module.exports = {
  listSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  setActiveSkill,
  getActiveSkill,
  saveFromContext,
  ensurePresetResearchSkills,
  ensurePresetCodeSkills,
};
