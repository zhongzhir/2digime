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
    artifactType: document.getElementById("artifact-type"),
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
    bundleView: document.getElementById("bundle-view"),
    bundleReport: document.getElementById("bundle-report"),
    bundleManifest: document.getElementById("bundle-manifest"),
    bundleEntries: document.getElementById("bundle-entries"),
    saveStatus: document.getElementById("save-status"),
    versionMeta: document.getElementById("version-meta"),
    revisionRequest: document.getElementById("revision-request"),
    revise: document.getElementById("btn-revise"),
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
  /** 设置页/展示用元数据;连接态不以本地 flag 为准。 */
  let shellStatus = null;
  let displayModelName = null;
  /** 防止并发 capability.list 回写乱序。 */
  let connectionRefreshSeq = 0;
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

  /**
   * 顶部与任务区唯一派生函数。
   * available → 不显示横幅; unavailable / needs_setup / 无文档能力 → 显示横幅。
   */
  function deriveModelAvailability(capabilities) {
    const list = Array.isArray(capabilities) ? capabilities : [];
    const documentCaps = list.filter(
      (c) =>
        c &&
        Array.isArray(c.outputArtifactTypes) &&
        c.outputArtifactTypes.includes("document"),
    );
    const codeCaps = list.filter(
      (c) =>
        c &&
        Array.isArray(c.outputArtifactTypes) &&
        c.outputArtifactTypes.includes("code-analysis"),
    );
    const available = documentCaps.some((c) => c.availability === "available");
    const codeAvailable = codeCaps.some((c) => c.availability === "available");
    const needsSetup = documentCaps.some((c) => c.availability === "needs_setup");
    return {
      available,
      codeAvailable,
      needsSetup: !available && needsSetup,
      /** 文档任务未就绪时渲染横幅;代码分析若本地可用则不挡提交 */
      showGate: !available,
      capabilities: list,
    };
  }

  function selectedArtifactType() {
    return (els.artifactType && els.artifactType.value) || "document";
  }

  function canSubmit(state) {
    const type = selectedArtifactType();
    if (type === "code-analysis") return !!(state && state.codeAvailable);
    return !!(state && state.available);
  }

  /** 唯一连接态来源:CapabilityRegistration.availability。 */
  async function refreshConnectionFromCapabilities() {
    const seq = ++connectionRefreshSeq;
    let capabilities = [];
    try {
      const result = await api.invoke("capability.list", {});
      capabilities = (result && result.capabilities) || [];
    } catch {
      capabilities = [];
    }
    if (seq !== connectionRefreshSeq) {
      return deriveModelAvailability(capabilities).available;
    }
    const state = deriveModelAvailability(capabilities);
    applyConnectionUi(state);
    return state.available;
  }

  let lastConnectionState = { available: false, codeAvailable: false, showGate: true };

  function applyConnectionUi(state) {
    lastConnectionState = state || lastConnectionState;
    const available = !!(state && state.available);
    const submitReady = canSubmit(state);
    const type = selectedArtifactType();
    const showGate =
      type === "code-analysis"
        ? !submitReady
        : state
          ? !!state.showGate
          : !available;
    const name = displayModelName || (shellStatus && shellStatus.model) || "";
    const connectedText = available
      ? name
        ? `已连接模型 · ${name}`
        : "已连接模型"
      : state && state.codeAvailable
        ? "代码项目分析可用（结构扫描）"
        : "未连接模型";

    // 顶部与欢迎区、任务横幅共用同一派生结果
    els.modelStatus.textContent = connectedText;
    els.welcomeModelStatus.textContent = available
      ? connectedText
      : "未连接模型。请先在设置中连接真实模型。";
    els.welcomeModelStatus.classList.toggle("error", !available);

    // available 时横幅完全不渲染(hidden + 显式 display,避免 CSS grid 覆盖)
    if (showGate) {
      els.modelGate.hidden = false;
      els.modelGate.removeAttribute("hidden");
      els.modelGate.style.display = "";
      if (type === "code-analysis") {
        els.modelGate.querySelector("p").textContent =
          "当前环境未启用代码项目分析。请改选文档，或使用工程模式。";
      } else {
        els.modelGate.querySelector("p").textContent =
          "请先连接模型，才能开始处理任务。";
      }
    } else {
      els.modelGate.hidden = true;
      els.modelGate.setAttribute("hidden", "");
      els.modelGate.style.display = "none";
    }

    els.submit.disabled = !submitReady;
    if (!submitReady) {
      els.submit.title =
        type === "code-analysis" ? "代码项目分析不可用" : "请先连接模型";
      els.retry.disabled = true;
      els.revise.disabled = true;
    } else {
      els.submit.title = "";
      els.revise.disabled = !activeArtifactId || type === "code-analysis";
    }
    const configured = !!(shellStatus && shellStatus.credentialConfigured) || available;
    els.modelKeyState.textContent = configured ? "凭证状态：已配置" : "凭证状态：未配置";
    els.deleteModel.disabled = !configured;
  }

  function rememberShellMeta(info) {
    shellStatus = (info && info.status) || shellStatus;
    if (info && info.modelMeta && info.modelMeta.model) {
      displayModelName = info.modelMeta.model;
    } else if (shellStatus && shellStatus.model) {
      displayModelName = shellStatus.model;
    } else if (info && info.modelReady === false) {
      displayModelName = null;
    }
    if (shellStatus && shellStatus.presets && shellStatus.presets.deepseek) {
      presets.deepseek.baseUrl =
        shellStatus.presets.deepseek.baseUrl || presets.deepseek.baseUrl;
      presets.deepseek.model = shellStatus.presets.deepseek.model || presets.deepseek.model;
    }
  }

  function fillSettingsForm() {
    const status = shellStatus || {};
    const preset =
      status.providerPreset ||
      (status.baseUrl && String(status.baseUrl).includes("deepseek")
        ? "deepseek"
        : "openai-compatible");
    els.modelProvider.value = preset === "deepseek" ? "deepseek" : "openai-compatible";
    els.modelBaseUrl.value = status.baseUrl || presets[els.modelProvider.value].baseUrl || "";
    els.modelId.value = status.model || presets[els.modelProvider.value].model || "";
    els.modelApiKey.value = "";
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

  function labelForState(state, userFacingLabel) {
    if (userFacingLabel) return userFacingLabel;
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

  function renderJobStatus(detail) {
    // 用户面只显示派生标签,禁止拼接内部 progress / phase。
    els.jobStatus.textContent = detail.userFacingLabel || labelForState(detail.state);
    els.jobStatus.classList.toggle("error", detail.state === "attention");
    els.jobActionable.textContent = "";
    if (detail.state === "attention") {
      els.jobActionable.textContent = "可以重试，或调整目标与材料后再试。";
    }
  }

  async function selectTask(taskId) {
    activeTaskId = taskId;
    const detail = await api.invoke("work.getTask", { taskId });
    activeJobId = detail.latestJob ? detail.latestJob.jobId : null;
    renderJobStatus(detail);
    els.cancel.disabled = !(
      detail.latestJob &&
      (detail.state === "waiting" || detail.state === "processing")
    );
    const connected = await refreshConnectionFromCapabilities();
    els.retry.disabled = !connected || detail.state !== "attention";
    activeArtifactId = detail.artifactIds[0] || null;
    if (activeArtifactId) {
      await loadArtifact(activeArtifactId);
    } else {
      els.artifactPanel.hidden = true;
      els.revise.disabled = true;
    }
    await refreshTasks();
    await refreshExperiences();
  }

  async function loadArtifact(artifactId) {
    const content = await api.invoke("artifact.getContent", { artifactId });
    const isBundle = !!(content.content && content.content.kind === "bundle");
    activeArtifactId = artifactId;
    els.artifactPanel.hidden = false;
    els.versionMeta.textContent = `版本 ${content.versionCount}`;

    if (isBundle) {
      els.bundleView.hidden = false;
      els.bundleView.removeAttribute("hidden");
      els.artifactEditor.hidden = true;
      els.artifactEditor.setAttribute("hidden", "");
      els.revise.closest(".revise-box").hidden = true;
      els.exportMd.hidden = true;
      els.exportDocx.hidden = true;
      els.bundleReport.textContent = content.text || "";
      const summary = (content.bundle && content.bundle.manifestSummary) || null;
      if (summary) {
        const langs = (summary.languages || [])
          .map((l) => `${l.language} ${l.files}`)
          .join(" · ");
        els.bundleManifest.textContent = [
          `文件数 ${summary.fileCountScanned}`,
          langs ? `语言 ${langs}` : null,
          summary.truncated ? "已截断" : "未截断",
          `敏感跳过 ${summary.skippedSensitiveCount}`,
          (summary.warnings || []).length
            ? `提示：${summary.warnings.join("；")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
      } else {
        els.bundleManifest.textContent = "";
      }
      els.bundleEntries.innerHTML = "";
      for (const entry of (content.bundle && content.bundle.entries) || []) {
        const li = document.createElement("li");
        li.textContent = `${entry.role || "条目"} · ${entry.mediaType}`;
        els.bundleEntries.appendChild(li);
      }
      els.saveStatus.textContent = "代码项目结构扫描结果（只读）";
      els.revise.disabled = true;
    } else {
      els.bundleView.hidden = true;
      els.bundleView.setAttribute("hidden", "");
      els.artifactEditor.hidden = false;
      els.artifactEditor.removeAttribute("hidden");
      els.revise.closest(".revise-box").hidden = false;
      els.exportMd.hidden = false;
      els.exportDocx.hidden = false;
      suppressSave = true;
      els.artifactEditor.value = content.text || "";
      suppressSave = false;
      els.saveStatus.textContent = "已载入最新内容";
      const connected = await refreshConnectionFromCapabilities();
      els.revise.disabled = !connected;
    }
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
    await refreshConnectionFromCapabilities();
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
      rememberShellMeta(result);
      const connected = await refreshConnectionFromCapabilities();
      showStatus(
        els.settingsStatus,
        connected
          ? `已保存。当前模型：${(result.modelMeta && result.modelMeta.model) || model}`
          : "已保存，但能力尚未可用",
      );
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
      rememberShellMeta(result);
      displayModelName = null;
      await refreshConnectionFromCapabilities();
      showStatus(els.settingsStatus, "已删除模型凭证。请重新连接后再开始处理。");
    } catch (err) {
      showStatus(els.settingsStatus, err.message || String(err), true);
    } finally {
      await refreshConnectionFromCapabilities();
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

  if (els.artifactType) {
    els.artifactType.addEventListener("change", () => {
      applyConnectionUi(lastConnectionState);
    });
  }

  els.submit.addEventListener("click", async () => {
    try {
      await refreshConnectionFromCapabilities();
      const type = selectedArtifactType();
      if (!canSubmit(lastConnectionState)) {
        els.jobStatus.textContent =
          type === "code-analysis" ? "代码项目分析不可用" : "请先连接模型";
        els.jobStatus.classList.add("error");
        els.jobActionable.textContent =
          type === "code-analysis"
            ? "当前环境未启用该能力。"
            : "前往设置连接真实模型后再开始处理。";
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
        requestedArtifactType: type,
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
      await refreshConnectionFromCapabilities();
    }
  });

  els.revise.addEventListener("click", async () => {
    try {
      if (!activeTaskId || !activeArtifactId) return;
      const connected = await refreshConnectionFromCapabilities();
      if (!connected) {
        els.jobStatus.textContent = "请先连接模型";
        els.jobStatus.classList.add("error");
        return;
      }
      const revisionRequest = (els.revisionRequest.value || "").trim();
      if (!revisionRequest) {
        els.jobStatus.textContent = "请填写修改要求";
        els.jobStatus.classList.add("error");
        return;
      }
      els.revise.disabled = true;
      const { jobId } = await api.invoke("work.reviseArtifact", {
        taskId: activeTaskId,
        artifactId: activeArtifactId,
        revisionRequest,
      });
      activeJobId = jobId;
      els.jobStatus.textContent = "正在修改";
      els.jobStatus.classList.remove("error");
      els.jobActionable.textContent = "";
      els.cancel.disabled = false;
      els.revisionRequest.value = "";
      await refreshTasks();
    } catch (err) {
      els.jobStatus.textContent = err.message || String(err);
      els.jobStatus.classList.add("error");
    } finally {
      await refreshConnectionFromCapabilities();
    }
  });

  els.cancel.addEventListener("click", async () => {
    if (!activeJobId) return;
    await api.invoke("work.cancelJob", { jobId: activeJobId });
    if (activeTaskId) await selectTask(activeTaskId);
  });

  els.retry.addEventListener("click", async () => {
    if (!activeTaskId) return;
    const connected = await refreshConnectionFromCapabilities();
    if (!connected) {
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
          renderJobStatus(detail);
          els.cancel.disabled = !(
            detail.latestJob &&
            (detail.state === "waiting" || detail.state === "processing")
          );
          const connected = await refreshConnectionFromCapabilities();
          els.retry.disabled = !connected || detail.state !== "attention";
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
      if (activeArtifactId) await loadArtifact(activeArtifactId);
    }
    if (event.kind === "subject.updated") {
      await refreshExperiences();
    }
  });

  api.onBoot(async (info) => {
    rememberShellMeta(info || {});
    await refreshConnectionFromCapabilities();
    if (currentView === "settings") fillSettingsForm();
  });

  if (typeof api.getModelStatus === "function") {
    api
      .getModelStatus()
      .then(async (info) => {
        rememberShellMeta(info || {});
        await refreshConnectionFromCapabilities();
      })
      .catch(async () => {
        await refreshConnectionFromCapabilities();
      });
  } else {
    refreshConnectionFromCapabilities();
  }
})();
