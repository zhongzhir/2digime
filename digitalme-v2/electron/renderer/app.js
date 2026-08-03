(() => {
  const api = window.digitalMe;
  if (!api) {
    document.body.textContent = "应用桥接未就绪。请通过 npm run dev 启动。";
    return;
  }

  const els = {
    welcome: document.getElementById("view-welcome"),
    workspace: document.getElementById("view-workspace"),
    settings: document.getElementById("view-settings"),
    pkgName: document.getElementById("pkg-name"),
    createPkg: document.getElementById("btn-create-pkg"),
    openPkg: document.getElementById("btn-open-pkg"),
    welcomeStatus: document.getElementById("welcome-status"),
    welcomeModelStatus: document.getElementById("welcome-model-status"),
    openSettingsWelcome: document.getElementById("btn-open-settings-welcome"),
    openSettings: document.getElementById("btn-open-settings"),
    settingsBack: document.getElementById("btn-settings-back"),
    gotoSettings: document.getElementById("btn-goto-settings"),
    modelGate: document.getElementById("model-gate"),
    modelProvider: document.getElementById("model-provider"),
    modelBaseUrl: document.getElementById("model-base-url"),
    modelId: document.getElementById("model-id"),
    modelApiKey: document.getElementById("model-api-key"),
    modelKeyState: document.getElementById("model-key-state"),
    saveModel: document.getElementById("btn-save-model"),
    testModel: document.getElementById("btn-test-model"),
    deleteModel: document.getElementById("btn-delete-model"),
    settingsStatus: document.getElementById("settings-status"),
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
  /** @type {'welcome'|'workspace'|'settings'} */
  let currentView = "welcome";
  let returnView = "welcome";
  let modelReady = false;
  let modelMeta = null;
  let modelStatusPayload = null;
  const presets = {
    deepseek: {
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
    },
    "openai-compatible": {
      baseUrl: "",
      model: "",
    },
  };

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

  function setView(view) {
    currentView = view;
    els.welcome.hidden = view !== "welcome";
    els.workspace.hidden = view !== "workspace";
    els.settings.hidden = view !== "settings";
  }

  function openSettings() {
    returnView = currentView === "settings" ? returnView : currentView;
    fillSettingsForm();
    setView("settings");
  }

  function applyModelStatus(info) {
    modelReady = !!(info && info.modelReady && info.modelMeta);
    modelMeta = (info && info.modelMeta) || null;
    modelStatusPayload = (info && info.status) || null;
    if (modelStatusPayload && modelStatusPayload.presets) {
      if (modelStatusPayload.presets.deepseek) {
        presets.deepseek.baseUrl = modelStatusPayload.presets.deepseek.baseUrl || presets.deepseek.baseUrl;
        presets.deepseek.model = modelStatusPayload.presets.deepseek.model || presets.deepseek.model;
      }
    }

    const connectedText = modelReady
      ? `已连接模型 · ${modelMeta.model}`
      : "未连接模型";
    els.modelStatus.textContent = connectedText;
    els.welcomeModelStatus.textContent = modelReady
      ? connectedText
      : "未连接模型。请先在设置中连接真实模型。";
    els.welcomeModelStatus.classList.toggle("error", !modelReady);

    els.modelGate.hidden = modelReady;
    els.submit.disabled = !modelReady;
    els.retry.disabled = els.retry.disabled || !modelReady;
    if (!modelReady) {
      els.submit.title = "请先连接模型";
    } else {
      els.submit.title = "";
    }

    const configured = !!(modelStatusPayload && modelStatusPayload.credentialConfigured) || modelReady;
    els.modelKeyState.textContent = configured ? "凭证状态：已配置" : "凭证状态：未配置";
    els.deleteModel.disabled = !configured;
  }

  function fillSettingsForm() {
    const status = modelStatusPayload || {};
    const preset = status.providerPreset || (status.baseUrl && String(status.baseUrl).includes("deepseek")
      ? "deepseek"
      : "openai-compatible");
    els.modelProvider.value = preset === "deepseek" ? "deepseek" : "openai-compatible";
    els.modelBaseUrl.value = status.baseUrl || presets[els.modelProvider.value].baseUrl || "";
    els.modelId.value = status.model || presets[els.modelProvider.value].model || "";
    els.modelApiKey.value = "";
    const configured = !!(status.credentialConfigured) || modelReady;
    els.modelKeyState.textContent = configured ? "凭证状态：已配置" : "凭证状态：未配置";
    els.deleteModel.disabled = !configured;
    showStatus(els.settingsStatus, "");
  }

  function applyProviderPreset() {
    const key = els.modelProvider.value;
    const preset = presets[key] || presets["openai-compatible"];
    if (key === "deepseek") {
      els.modelBaseUrl.value = preset.baseUrl;
      if (!els.modelId.value.trim()) els.modelId.value = preset.model;
    }
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
    els.retry.disabled = !modelReady || detail.state !== "attention";
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
    setView("workspace");
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

  els.openSettingsWelcome.addEventListener("click", () => openSettings());
  els.openSettings.addEventListener("click", () => openSettings());
  els.gotoSettings.addEventListener("click", () => openSettings());
  els.settingsBack.addEventListener("click", () => setView(returnView || "welcome"));

  els.modelProvider.addEventListener("change", () => applyProviderPreset());

  els.saveModel.addEventListener("click", async () => {
    try {
      const apiKey = (els.modelApiKey.value || "").trim();
      const baseUrl = (els.modelBaseUrl.value || "").trim();
      const model = (els.modelId.value || "").trim();
      if (!apiKey) {
        showStatus(els.settingsStatus, "请输入 API Key 后再保存", true);
        return;
      }
      if (!baseUrl || !model) {
        showStatus(els.settingsStatus, "请填写 Base URL 与 Model ID", true);
        return;
      }
      els.saveModel.disabled = true;
      const result = await api.saveModelCredential({
        apiKey,
        baseUrl,
        model,
        providerPreset: els.modelProvider.value,
        providerId: "openai-compatible",
      });
      els.modelApiKey.value = "";
      applyModelStatus(result);
      showStatus(els.settingsStatus, `已保存。当前模型：${result.modelMeta.model}`);
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
    } finally {
      els.saveModel.disabled = false;
    }
  });

  els.testModel.addEventListener("click", async () => {
    try {
      els.testModel.disabled = true;
      const payload = {
        baseUrl: (els.modelBaseUrl.value || "").trim(),
        model: (els.modelId.value || "").trim(),
        providerId: "openai-compatible",
      };
      const typedKey = (els.modelApiKey.value || "").trim();
      if (typedKey) payload.apiKey = typedKey;
      const result = await api.testModelConnection(payload);
      showStatus(els.settingsStatus, `连接成功 · ${result.model}`);
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
    } finally {
      els.testModel.disabled = false;
    }
  });

  els.deleteModel.addEventListener("click", async () => {
    try {
      els.deleteModel.disabled = true;
      const result = await api.deleteModelCredential({});
      els.modelApiKey.value = "";
      applyModelStatus(result);
      showStatus(els.settingsStatus, "已删除模型凭证。请重新连接后再开始处理。");
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
    } finally {
      els.deleteModel.disabled = !(modelReady || (modelStatusPayload && modelStatusPayload.credentialConfigured));
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
      if (!modelReady) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        els.jobActionable.textContent = "前往设置连接真实模型后再开始处理。";
        return;
      }
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
      els.submit.disabled = !modelReady;
    }
  });

  els.cancel.addEventListener("click", async () => {
    if (!activeJobId) return;
    await api.invoke("work.cancelJob", { jobId: activeJobId });
    if (activeTaskId) await selectTask(activeTaskId);
  });

  els.retry.addEventListener("click", async () => {
    if (!activeTaskId) return;
    if (!modelReady) {
      els.jobStatus.textContent = "请先连接模型";
      els.jobStatus.classList.add("error");
      return;
    }
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
          els.retry.disabled = !modelReady || detail.state !== "attention";
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
    applyModelStatus(info || {});
    if (currentView === "settings") fillSettingsForm();
  });

  // 初始拉取一次状态(防止 boot 事件早于监听)
  if (typeof api.getModelStatus === "function") {
    api.getModelStatus().then(applyModelStatus).catch(() => {
      applyModelStatus({ modelReady: false, needsCredentialSetup: true });
    });
  } else {
    applyModelStatus({ modelReady: false, needsCredentialSetup: true });
  }
})();
