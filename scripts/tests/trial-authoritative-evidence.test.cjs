/**
 * DIGITALME-REAL-TRIAL-OBSERVABILITY-FIX-01
 * 判定必须跟 Job / Subject derived / freeze 内容一致，不得被 overview 字段或错误目录带偏。
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolvePkgDir,
  judgeSearchFromJob,
  judgePreferenceLearned,
  judgePreferenceInJobContext,
  judgeHistoricalContextFromJob,
  waitForTaskJob,
} = require("../lib/trial-authoritative-evidence.cjs");

const SEARCH_JOB = {
  id: "job_mtaxssf882b66b1445df",
  taskId: "task_mtaxsm4a3aaaad514d4b",
  capabilityId: "cap_baseline_web_search",
  status: "succeeded",
  snapshotId: "snap_search",
  materialUse: {
    usedPaths: ["external-information://search-evidence"],
    items: [{ path: "external-information://search-evidence", completeness: "full", sourceChars: 10, usedChars: 10 }],
  },
};

const DOC_JOB = {
  id: "job_doc",
  taskId: "task_doc",
  capabilityId: "cap_model_openai_compatible",
  status: "succeeded",
  materialUse: { usedPaths: [], items: [] },
};

const T5_JOB = {
  id: "job_mtaxxblkea96e0246a58",
  taskId: "task_mtaxx2ek52b9af2d5506",
  capabilityId: "cap_model_openai_compatible",
  status: "succeeded",
  snapshotId: "snap_t5",
  materialUse: {
    usedPaths: ["historical-artifact:NORTHSTAR_OKR_ALPHA 项目阶段说明与后续工作指引"],
    items: [
      {
        path: "historical-artifact:NORTHSTAR_OKR_ALPHA 项目阶段说明与后续工作指引",
        completeness: "full",
        sourceChars: 758,
        usedChars: 758,
      },
    ],
  },
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makePkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-obs-"));
  const pkgDir = path.join(root, "subjects", "default");
  fs.mkdirSync(path.join(pkgDir, "runtime", "jobs"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "runtime", "snapshots"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "runtime", "content", "text", "ad"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "derived"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "growth"), { recursive: true });
  return { root, pkgDir };
}

test("search: authoritative job capabilityId wins; empty jobs dir is not search:false-by-guess", () => {
  const fromJob = judgeSearchFromJob(SEARCH_JOB);
  assert.equal(fromJob.search_used, true);
  assert.equal(fromJob.capabilityId, "cap_baseline_web_search");
  assert.equal(fromJob.material_search_evidence, true);

  const doc = judgeSearchFromJob(DOC_JOB);
  assert.equal(doc.search_used, false);
  assert.equal(doc.capabilityId, "cap_model_openai_compatible");

  const { pkgDir } = makePkg();
  assert.equal(judgeSearchFromJob(null).search_used, false);
  assert.ok(fs.existsSync(path.join(pkgDir, "runtime", "jobs")));
});

test("search: wrong jobs/ directory must not be treated as the store", () => {
  const { root, pkgDir } = makePkg();
  writeJson(path.join(pkgDir, "jobs", "ignored.json"), DOC_JOB);
  writeJson(path.join(pkgDir, "runtime", "jobs", "job_mtaxssf882b66b1445df.json"), SEARCH_JOB);
  const resolved = resolvePkgDir(root);
  assert.equal(resolved, pkgDir);
  const { loadJobs } = require("../lib/trial-authoritative-evidence.cjs");
  const jobs = loadJobs(resolved);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].capabilityId, "cap_baseline_web_search");
  assert.equal(judgeSearchFromJob(jobs[0]).search_used, true);
});

test("T4: preference adopted from derived + confirmed event, not confirmedExperienceCount", () => {
  const { pkgDir } = makePkg();
  writeJson(path.join(pkgDir, "derived", "preferences.json"), {
    entries: [
      {
        eventId: "gevt_pref",
        title: "看周报时结论先行",
        detail: "看周报时最有效的是先看到结论，依据放后面",
      },
    ],
  });
  writeJson(path.join(pkgDir, "derived", "confirmed-experiences.json"), { entries: [] });
  fs.writeFileSync(
    path.join(pkgDir, "growth", "events.ndjson"),
    [
      JSON.stringify({
        id: "gevt_pref",
        type: "preference_observed",
        confidence: "confirmed",
        payload: { title: "看周报时结论先行", detail: "看周报时最有效的是先看到结论，依据放后面" },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  const learned = judgePreferenceLearned(pkgDir);
  assert.equal(learned.preference_adopted, true);
  assert.equal(learned.knowledge_gap_rewrite, false);
});

test("T4: freeze content (not snapshot JSON shell) proves next weekly context", () => {
  const { pkgDir } = makePkg();
  const freeze = {
    selectedEventIds: ["gevt_pref"],
    entries: [
      {
        eventId: "gevt_pref",
        kind: "preference",
        title: "看周报时结论先行",
        detail: "看周报时最有效的是先看到结论，依据放后面",
      },
    ],
  };
  const freezeRef = "text/ad/ad51f059f0ca1471e621ef29e0a7e0567916b7161b2b0c8a23aa7f0a4306a9ab.txt";
  fs.writeFileSync(path.join(pkgDir, "runtime", "content", freezeRef), `${JSON.stringify(freeze)}\n`, "utf8");
  const job = {
    id: "job_weekly",
    taskId: "task_weekly",
    capabilityId: "cap_model_openai_compatible",
    status: "succeeded",
    snapshotId: "snap_weekly",
  };
  writeJson(path.join(pkgDir, "runtime", "snapshots", "snap_weekly.json"), {
    id: "snap_weekly",
    subjectContextRef: freezeRef,
  });
  const learned = {
    matchingDerived: [{ eventId: "gevt_pref" }],
    matchingConfirmed: [{ id: "gevt_pref" }],
  };
  const ctx = judgePreferenceInJobContext(pkgDir, job, learned);
  assert.equal(ctx.preference_in_context, true);
  const snapShell = fs.readFileSync(path.join(pkgDir, "runtime", "snapshots", "snap_weekly.json"), "utf8");
  assert.equal(/结论/.test(snapShell), false, "snapshot JSON is a content ref; judge must read freeze bytes");
});

test("T5: historical context from materialUse, not artifact prose", () => {
  const hit = judgeHistoricalContextFromJob(T5_JOB);
  assert.equal(hit.historical_context_used, true);
  assert.ok(hit.usedPaths.some((p) => /NORTHSTAR_OKR_ALPHA/.test(p)));

  const miss = judgeHistoricalContextFromJob({
    ...T5_JOB,
    materialUse: { usedPaths: ["file://unrelated.md"], items: [] },
  });
  assert.equal(miss.historical_context_used, false);
});

test("T5: plan relevantContextIds resolve to NORTHSTAR artifact even without artifact: prefix", () => {
  const { pkgDir } = makePkg();
  const taskId = "task_open";
  const artId = "art_seed";
  writeJson(path.join(pkgDir, "runtime", "artifacts", `${artId}.json`), {
    id: artId,
    title: "NORTHSTAR_OKR_ALPHA 项目阶段说明与后续工作指引",
    taskId: "task_seed",
  });
  writeJson(path.join(pkgDir, "runtime", "tasks", `${taskId}.json`), {
    id: taskId,
    meta: { plan: { semantic: { relevantContextIds: [artId] } } },
  });
  const job = {
    id: "job_open",
    taskId,
    capabilityId: "cap_model_openai_compatible",
    status: "succeeded",
    snapshotId: "snap_open",
    materialUse: { usedPaths: [] },
  };
  writeJson(path.join(pkgDir, "runtime", "snapshots", "snap_open.json"), { id: "snap_open", items: [] });
  const { judgeHistoricalContext } = require("../lib/trial-authoritative-evidence.cjs");
  const judged = judgeHistoricalContext(pkgDir, job);
  assert.equal(judged.planned, true);
  assert.equal(judged.assembled, false);
  assert.equal(judged.historical_context_used, true);
});

test("waitForTaskJob waits until persisted succeeded job exists", async () => {
  const { pkgDir } = makePkg();
  const taskId = "task_late";
  setTimeout(() => {
    writeJson(path.join(pkgDir, "runtime", "jobs", "job_late.json"), {
      id: "job_late",
      taskId,
      capabilityId: "cap_baseline_web_search",
      status: "succeeded",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
  }, 250);
  const job = await waitForTaskJob(pkgDir, taskId, 4000);
  assert.ok(job);
  assert.equal(job.status, "succeeded");
  assert.equal(job.capabilityId, "cap_baseline_web_search");
});
