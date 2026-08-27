/**
 * Trial / Electron driver 只读权威落盘产物。
 * 不读 UI 文案、按钮、overview.confirmedExperienceCount 作为终裁。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SEARCH_CAP_RE = /search/i;
const SEARCH_MATERIAL_RE = /search-evidence|external-information:\/\//i;
const HISTORICAL_CTX_RE = /historical-artifact:|artifact:/i;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function tryReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return readJson(file);
  } catch {
    return null;
  }
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !n.endsWith(".bak"))
    .map((n) => path.join(dir, n));
}

function resolvePkgDir(userData) {
  const subjects = path.join(userData, "subjects");
  const preferred = path.join(subjects, "default");
  if (fs.existsSync(path.join(preferred, "runtime", "jobs")) || fs.existsSync(path.join(preferred, "manifest.json"))) {
    return preferred;
  }
  if (!fs.existsSync(subjects)) return preferred;
  for (const name of fs.readdirSync(subjects)) {
    const candidate = path.join(subjects, name);
    if (fs.existsSync(path.join(candidate, "runtime", "jobs"))) return candidate;
  }
  return preferred;
}

function jobsDir(pkgDir) {
  return path.join(pkgDir, "runtime", "jobs");
}

function loadJobs(pkgDir) {
  return listJsonFiles(jobsDir(pkgDir))
    .map((file) => {
      const job = tryReadJson(file);
      if (!job || typeof job !== "object") return null;
      return job;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function jobsForTask(pkgDir, taskId) {
  return loadJobs(pkgDir).filter((j) => j.taskId === taskId);
}

function latestJobForTask(pkgDir, taskId) {
  const jobs = jobsForTask(pkgDir, taskId);
  return jobs.length ? jobs[jobs.length - 1] : null;
}

function materialUsedPaths(job) {
  const use = job && job.materialUse;
  const fromField = Array.isArray(use && use.usedPaths) ? use.usedPaths.map(String) : [];
  const fromItems = Array.isArray(use && use.items)
    ? use.items.map((it) => String((it && it.path) || "")).filter(Boolean)
    : [];
  return [...new Set([...fromField, ...fromItems])];
}

function judgeSearchFromJob(job) {
  const capabilityId = String((job && job.capabilityId) || "");
  const usedPaths = materialUsedPaths(job);
  const searchCapability = SEARCH_CAP_RE.test(capabilityId);
  const searchMaterial = usedPaths.some((p) => SEARCH_MATERIAL_RE.test(p));
  return {
    search_used: searchCapability,
    capabilityId: capabilityId || null,
    material_search_evidence: searchMaterial,
    usedPaths,
    jobId: (job && job.id) || null,
    jobStatus: (job && job.status) || null,
  };
}

function loadPreferences(pkgDir) {
  return tryReadJson(path.join(pkgDir, "derived", "preferences.json"));
}

function loadGrowthEvents(pkgDir) {
  const file = path.join(pkgDir, "growth", "events.ndjson");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function adoptedPreferences(pkgDir) {
  const derived = loadPreferences(pkgDir);
  const derivedEntries = (derived && derived.entries) || [];
  const events = loadGrowthEvents(pkgDir).filter(
    (e) => e.type === "preference_observed" && e.confidence === "confirmed",
  );
  return {
    derivedEntries,
    confirmedEvents: events,
    adopted: derivedEntries.length > 0 && events.length > 0,
  };
}

function judgePreferenceLearned(pkgDir, cueRe) {
  const cue = cueRe || /结论|依据放后面/;
  const { derivedEntries, confirmedEvents } = adoptedPreferences(pkgDir);
  const matchingDerived = derivedEntries.filter((e) => cue.test(JSON.stringify(e)));
  const matchingConfirmed = confirmedEvents.filter((e) =>
    cue.test(JSON.stringify({ title: e.payload && e.payload.title, detail: e.payload && e.payload.detail, type: e.type })),
  );
  const knowledgeGap = loadGrowthEvents(pkgDir).filter(
    (e) => e.type === "knowledge_gap_noted" && cue.test(JSON.stringify(e.payload || {})),
  );
  return {
    preference_adopted: matchingDerived.length > 0 && matchingConfirmed.length > 0,
    matchingDerived,
    matchingConfirmed,
    knowledge_gap_rewrite: knowledgeGap.length > 0 && matchingConfirmed.length === 0,
  };
}

function loadSnapshot(pkgDir, snapshotId) {
  if (!snapshotId) return null;
  return tryReadJson(path.join(pkgDir, "runtime", "snapshots", `${snapshotId}.json`));
}

function readContentRef(pkgDir, ref) {
  if (!ref || typeof ref !== "string") return null;
  const normalized = ref.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) return null;
  const abs = path.join(pkgDir, "runtime", "content", normalized);
  const root = path.join(pkgDir, "runtime", "content");
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function loadFreezeForJob(pkgDir, job) {
  const snap = loadSnapshot(pkgDir, job && job.snapshotId);
  if (!snap) return { snapshot: null, freeze: null, freezeText: null };
  const freezeText = readContentRef(pkgDir, snap.subjectContextRef);
  let freeze = null;
  if (freezeText) {
    try {
      freeze = JSON.parse(freezeText);
    } catch {
      freeze = null;
    }
  }
  return { snapshot: snap, freeze, freezeText };
}

function judgePreferenceInJobContext(pkgDir, job, learned) {
  const { freeze, freezeText } = loadFreezeForJob(pkgDir, job);
  const ids = new Set(
    [
      ...((learned && learned.matchingDerived) || []).map((e) => e.eventId),
      ...((learned && learned.matchingConfirmed) || []).map((e) => e.id),
    ].filter(Boolean),
  );
  const selected = (freeze && freeze.selectedEventIds) || [];
  const entries = (freeze && freeze.entries) || [];
  const idHit = selected.some((id) => ids.has(id)) || entries.some((e) => ids.has(e.eventId));
  const textHit = /结论|依据放后面/.test(String(freezeText || "")) && entries.some((e) => e.kind === "preference");
  return {
    preference_in_context: idHit || textHit,
    selectedEventIds: selected,
    freezeEntries: entries.map((e) => ({ eventId: e.eventId, kind: e.kind, title: e.title })),
  };
}

function loadTask(pkgDir, taskId) {
  if (!taskId) return null;
  return tryReadJson(path.join(pkgDir, "runtime", "tasks", `${taskId}.json`));
}

function snapshotSourcePaths(pkgDir, job) {
  const snap = loadSnapshot(pkgDir, job && job.snapshotId);
  const items = (snap && snap.items) || [];
  return items.map((it) => String((it && (it.sourcePath || it.path)) || "")).filter(Boolean);
}

function resolvePlanContextArtifacts(pkgDir, task) {
  const ids =
    (task &&
      task.meta &&
      task.meta.plan &&
      task.meta.plan.semantic &&
      task.meta.plan.semantic.relevantContextIds) ||
    [];
  const out = [];
  for (const raw of ids) {
    const artId = String(raw || "")
      .trim()
      .replace(/^artifact:/, "");
    if (!artId) continue;
    const art = tryReadJson(path.join(pkgDir, "runtime", "artifacts", `${artId}.json`));
    if (art) out.push({ id: art.id, title: art.title || "", taskId: art.taskId || "" });
  }
  return out;
}

function judgeHistoricalContextFromJob(job, cues, extra) {
  const hint = cues || [/NORTHSTAR/i, /权限收敛/];
  const usedPaths = [
    ...materialUsedPaths(job),
    ...((extra && extra.snapshotPaths) || []),
  ];
  const selected = (extra && extra.selectedArtifacts) || [];
  const pathBlob = usedPaths.join("\n");
  const selectedBlob = JSON.stringify(selected);
  const assembled = usedPaths.some((p) => HISTORICAL_CTX_RE.test(p));
  const planned = selected.length > 0;
  const cueHit = hint.some((re) => re.test(pathBlob) || re.test(selectedBlob));
  return {
    historical_context_used: assembled || planned,
    assembled,
    planned,
    cueHit,
    usedPaths,
    selectedArtifacts: selected,
    capabilityId: (job && job.capabilityId) || null,
    jobId: (job && job.id) || null,
  };
}

function judgeHistoricalContext(pkgDir, job, cues) {
  const task = loadTask(pkgDir, job && job.taskId);
  return judgeHistoricalContextFromJob(job, cues, {
    snapshotPaths: snapshotSourcePaths(pkgDir, job),
    selectedArtifacts: resolvePlanContextArtifacts(pkgDir, task),
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTaskJob(pkgDir, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = latestJobForTask(pkgDir, taskId);
    if (last && (last.status === "succeeded" || last.status === "failed") && last.capabilityId) {
      return last;
    }
    await sleep(400);
  }
  return last;
}

async function waitForAdoptedPreference(pkgDir, cueRe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = judgePreferenceLearned(pkgDir, cueRe);
    if (last.preference_adopted) return last;
    await sleep(400);
  }
  return last;
}

module.exports = {
  resolvePkgDir,
  jobsDir,
  loadJobs,
  jobsForTask,
  latestJobForTask,
  materialUsedPaths,
  judgeSearchFromJob,
  loadPreferences,
  loadGrowthEvents,
  adoptedPreferences,
  judgePreferenceLearned,
  loadSnapshot,
  readContentRef,
  loadFreezeForJob,
  judgePreferenceInJobContext,
  loadTask,
  snapshotSourcePaths,
  resolvePlanContextArtifacts,
  judgeHistoricalContextFromJob,
  judgeHistoricalContext,
  waitForTaskJob,
  waitForAdoptedPreference,
};
