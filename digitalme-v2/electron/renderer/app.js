(() => {
  const api = window.digitalMe;
  if (!api) {
    document.body.textContent = "应用桥接未就绪。请通过 npm run dev 启动。";
    return;
  }

  const els = {
    welcome: document.getElementById("view-welcome"),
    workspace: document.getElementById("view-workspace"),
    pkgName: document.getElementById("pkg-name"),
    createPkg: document.getElementById("btn-create-pkg"),
    openPkg: document.getElementById("btn-open-pkg"),
    welcomeStatus: document.getElementById("welcome-status"),
    pkgTitle: document.getElementById("pkg-title"),
    modelStatus: document.getElementById("model-status"),
    taskList: document.getElementById("task-list"),
    taskEmpty: document.getElementById("task-empty"),
    goal: document.getElementById("goal"),
    materialList: document.getElementById("material-list"),
    addFiles: document.getElementById("btn-add-files"),
    addFolder: document.getElementById("btn-add-folder"),
    clearMaterials: document.getElementById("btn-clear-materials"),
    submit: document.getElementById("btn-submit"),
    cancel: document.getElementById("btn-cancel"),
    retry: document.getElementById("btn-retry"),
    jobStatus: document.getElementById("job-status"),
    jobActionable: document.getElementById("job-actionable"),
    experiencePanel: document.getElementById("experience-panel"),
    experienceList: document.getElementById("experience-list"),
    artifactPanel: document.getElementById("artifact-panel"),
    artifactEditor: document.getElementById("artifact-editor"),
    saveStatus: document.getElementById("save-status"),
    copy: document.getElementById("btn-copy"),
    exportMd: document.getElementById("btn-export-md"),
    exportDocx: document.getElementById("btn-export-docx"),
    reveal: document.getElementById("btn-reveal"),
  };

  /** @type {{ kind: 'file'|'folder', path: string }[]} */
  let materials = [];
  let activeTaskId = null;
  let activeJobId = null;
  let activeArtifactId = null;
  let saveTimer = null;
  let suppressSave = false;

  function showStatus(el, text, isError) {
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("error");
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  function setWorkspaceVisible(visible) {
    els.welcome.hidden = visible;
    els.workspace.hidden = !visible;
  }

  function renderMaterials() {
    els.materialList.innerHTML = "";
    for (const item of materials) {
      const li = document.createElement("li");
      const kind = item.kind === "folder" ? "文件夹" : "文件";
      li.innerHTML = `<strong>${kind}</strong><div class="muted">${escapeHtml(item.path)}</div>`;
      els.materialList.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function refreshTasks() {
    const { tasks } = await api.invoke("work.listTasks", { limit: 50 });
    els.taskList.innerHTML = "";
    els.taskEmpty.hidden = tasks.length > 0;
    for (const t of tasks) {
      const li = document.createElement("li");
      if (t.taskId === activeTaskId) li.classList.add("active");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "linkish";
      btn.innerHTML = `<div class="task-goal">${escapeHtml(t.goal.slice(0, 80))}</div>
        <div class="task-state">${escapeHtml(labelForState(t.state))}</div>`;
      btn.addEventListener("click", () => selectTask(t.taskId));
      li.appendChild(btn);
      els.taskList.appendChild(li);
    }
  }

  function labelForState(state) {
    switch (state) {
      case "waiting":
        return "等待开始";
      case "processing":
        return "正在处理";
      case "completed":
        return "已完成";
      case "attention":
        return "需要处理";
      default:
        return "进行中";
    }
  }

  async function selectTask(taskId) {
    activeTaskId = taskId;
    const detail = await api.invoke("work.getTask", { taskId });
    activeJobId = detail.latestJob ? detail.latestJob.jobId : null;
    const note = detail.latestJob && detail.latestJob.progressNote;
    els.jobStatus.textContent = note
      ? `${detail.userFacingLabel} · ${note}`
      : detail.userFacingLabel;
    els.jobStatus.classList.toggle("error", detail.state === "attention");
    els.jobActionable.textContent = "";
    els.cancel.disabled = !(
      detail.latestJob &&
      (detail.state === "waiting" || detail.state === "processing")
    );
    els.retry.disabled = detail.state !== "attention";
    if (detail.state === "attention") {
      els.jobActionable.textContent = "可以重试，或调整目标与材料后再试。";
    }
    activeArtifactId = detail.artifactIds[0] || null;
    if (activeArtifactId) {
      await loadArtifact(activeArtifactId);
    } else {
      els.artifactPanel.hidden = true;
    }
    await refreshTasks();
    await refreshExperiences();
  }

  async function loadArtifact(artifactId) {
    const content = await api.invoke("artifact.getContent", { artifactId });
    suppressSave = true;
    els.artifactEditor.value = content.text || "";
    suppressSave = false;
    els.artifactPanel.hidden = false;
    els.saveStatus.textContent = "已载入最新内容";
  }

  async function refreshExperiences() {
    const overview = await api.invoke("subject.getOverview", {});
    const list = overview.candidateExperiences || [];
    els.experiencePanel.hidden = list.length === 0;
    els.experienceList.innerHTML = "";
    for (const item of list) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(item.title)}</strong>
        <div class="muted">${escapeHtml(item.detail)}</div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "保存这条经验";
      btn.addEventListener("click", async () => {
        await api.invoke("subject.confirmExperience", { eventIds: [item.eventId] });
        await refreshExperiences();
      });
      li.appendChild(btn);
      els.experienceList.appendChild(li);
    }
  }

  async function enterWorkspace() {
    const overview = await api.invoke("subject.getOverview", {});
    els.pkgTitle.textContent = overview.displayName;
    setWorkspaceVisible(true);
    await refreshTasks();
    await refreshExperiences();
  }

  els.createPkg.addEventListener("click", async () => {
    try {
      const name = (els.pkgName.value || "").trim() || "我的主体";
      const dir = await api.dialogs.pickSaveDirectory();
      if (!dir) return;
      await api.invoke("subject.createPackage", { displayName: name, targetDir: dir });
      showStatus(els.welcomeStatus, "");
      await enterWorkspace();
    } catch (err) {
      showStatus(els.welcomeStatus, err.message || String(err), true);
    }
  });

  els.openPkg.addEventListener("click", async () => {
    try {
      const dir = await api.dialogs.pickOpenDirectory();
      if (!dir) return;
      await api.invoke("subject.openPackage", { dir });
      showStatus(els.welcomeStatus, "");
      await enterWorkspace();
    } catch (err) {
      showStatus(els.welcomeStatus, err.message || String(err), true);
    }
  });

  els.addFiles.addEventListener("click", async () => {
    const files = await api.dialogs.pickOpenFiles();
    for (const p of files) materials.push({ kind: "file", path: p });
    renderMaterials();
  });

  els.addFolder.addEventListener("click", async () => {
    const folder = await api.dialogs.pickOpenDirectory();
    if (folder) materials.push({ kind: "folder", path: folder });
    renderMaterials();
  });

  els.clearMaterials.addEventListener("click", () => {
    materials = [];
    renderMaterials();
  });

  els.submit.addEventListener("click", async () => {
    try {
      const goal = (els.goal.value || "").trim();
      if (!goal) {
        els.jobStatus.textContent = "请先填写任务目标";
        els.jobStatus.classList.add("error");
        return;
      }
      els.submit.disabled = true;
      const result = await api.invoke("work.submitTask", {
        goal,
        contextRefs: materials.map((m) => ({ kind: m.kind, path: m.path })),
        requestedArtifactType: "document",
      });
      activeTaskId = result.taskId;
      activeJobId = result.jobId;
      els.jobStatus.textContent = "等待开始";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "";
      els.cancel.disabled = false;
      els.retry.disabled = true;
      await refreshTasks();
    } catch (err) {
      els.jobStatus.textContent = err.message || String(err);
      els.jobStatus.classList.add("error");
    } finally {
      els.submit.disabled = false;
    }
  });

  els.cancel.addEventListener("click", async () => {
    if (!activeJobId) return;
    await api.invoke("work.cancelJob", { jobId: activeJobId });
    if (activeTaskId) await selectTask(activeTaskId);
  });

  els.retry.addEventListener("click", async () => {
    if (!activeTaskId) return;
    const { jobId } = await api.invoke("work.retryTask", { taskId: activeTaskId });
    activeJobId = jobId;
    els.cancel.disabled = false;
    els.retry.disabled = true;
    els.jobStatus.textContent = "等待开始";
    await refreshTasks();
  });

  els.artifactEditor.addEventListener("input", () => {
    if (suppressSave || !activeArtifactId) return;
    els.saveStatus.textContent = "正在保存…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.invoke("artifact.saveEdit", {
          artifactId: activeArtifactId,
          text: els.artifactEditor.value,
        });
        els.saveStatus.textContent = "已自动保存";
        await refreshExperiences();
      } catch (err) {
        els.saveStatus.textContent = err.message || "保存失败";
      }
    }, 500);
  });

  els.copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.artifactEditor.value || "");
    els.saveStatus.textContent = "已复制到剪贴板";
  });

  els.exportMd.addEventListener("click", async () => {
    if (!activeArtifactId) return;
    const out = await api.invoke("artifact.export", {
      artifactId: activeArtifactId,
      format: "md",
    });
    els.saveStatus.textContent = `已导出：${out.path}`;
  });

  els.exportDocx.addEventListener("click", async () => {
    if (!activeArtifactId) return;
    const out = await api.invoke("artifact.export", {
      artifactId: activeArtifactId,
      format: "docx",
    });
    els.saveStatus.textContent = `已导出：${out.path}`;
  });

  els.reveal.addEventListener("click", async () => {
    if (!activeArtifactId) return;
    await api.invoke("artifact.revealInFolder", { artifactId: activeArtifactId });
  });

  api.onEvent(async (event) => {
    if (event.kind === "job.updated") {
      if (event.taskId === activeTaskId || !activeTaskId) {
        activeTaskId = event.taskId;
        activeJobId = event.jobId;
        try {
          const detail = await api.invoke("work.getTask", { taskId: event.taskId });
          const note = event.progressNote || (detail.latestJob && detail.latestJob.progressNote);
          els.jobStatus.textContent = note
            ? `${detail.userFacingLabel} · ${note}`
            : detail.userFacingLabel;
          els.jobStatus.classList.toggle("error", detail.state === "attention");
          els.cancel.disabled = !(
            detail.latestJob &&
            (detail.state === "waiting" || detail.state === "processing")
          );
          els.retry.disabled = detail.state !== "attention";
          els.jobActionable.textContent =
            detail.state === "attention"
              ? "可以重试，或调整目标与材料后再试。"
              : "";
          if (detail.artifactIds[0]) {
            activeArtifactId = detail.artifactIds[0];
            if (event.status === "succeeded") await loadArtifact(activeArtifactId);
          }
        } catch {
          /* ignore transient */
        }
        await refreshTasks();
      }
    }
    if (event.kind === "artifact.updated" && event.artifactId === activeArtifactId) {
      els.saveStatus.textContent = "内容已更新";
    }
    if (event.kind === "subject.updated") {
      await refreshExperiences();
    }
  });

  api.onBoot((info) => {
    if (info && info.modelReady && info.modelMeta) {
      els.modelStatus.textContent = `已连接模型 · ${info.modelMeta.model}`;
    } else {
      els.modelStatus.textContent = "当前为本地演示能力（未检测到可用模型凭证）";
    }
  });
})();
