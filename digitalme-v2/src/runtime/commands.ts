import type { ContextRef, Task } from '../work-runtime/task';
import type { TaskState } from '../work-runtime/derive';
import type { JobStatus } from '../work-runtime/execution-job';
import type { ArtifactContent } from '../work-runtime/artifact';
import type { CapabilityRegistration } from '../capability/registration';
import type { ExportFormat } from '../artifact-workspace/contracts';

/**
 * 命令总线契约(runtime contracts §1.1)。
 * UI ↔ 领域层唯一通道;上限 20 条。
 * 新增命令必须对应新的用户决策或新的领域用例,且经 CTO 复核。
 * subject.captureInput:使用即构建 — 多来源自然语言→候选(非表单门禁)。
 */
export type SubjectCaptureSourceKind =
  | 'initial_self_description'
  | 'imported_material'
  | 'conversation'
  | 'task_requirement'
  | 'artifact_edit'
  | 'artifact_acceptance'
  | 'artifact_rejection'
  | 'repeated_correction'
  | 'explicit_boundary';

export interface CommandMap {
  'subject.createPackage': {
    input: {
      displayName: string;
      targetDir: string;
      /** 一句话自我说明即可;不要求档案完整。 */
      initialSelfDescription?: string;
    };
    output: { subjectId: string };
  };
  'subject.openPackage': {
    input: { dir: string };
    output: { subjectId: string; displayName: string };
  };
  'subject.getOverview': {
    input: Record<string, never>;
    output: {
      subjectId: string;
      displayName: string;
      confirmedExperienceCount: number;
      /** 待确认的要点(用户面用「还不确定」等用语,勿展示内部 type)。 */
      candidateExperiences: Array<{
        eventId: string;
        title: string;
        detail: string;
        type?: string;
        /** 是否建议打扰确认(C 类);低风险可为 false。 */
        requiresConfirmation?: boolean;
      }>;
      /** C 类建议确认的 eventId;不得要求一次确认全部。 */
      confirmationSuggestedEventIds?: string[];
      readiness?: 'empty' | 'needs_confirmation' | 'usable';
      /** 恒为 false:readiness 仅为派生提示,不得阻断 Task。 */
      readinessBlocksTasks?: boolean;
      summaryLine?: string;
      knowledgeGapCount?: number;
      /** 现在的我 — 已确认且可能影响任务的少量要点。 */
      activeUnderstandings?: Array<{ eventId: string; text: string }>;
      /** 最近学到 — 过程中捕捉、待轻量处理的要点。 */
      recentLearnings?: Array<{
        eventId: string;
        text: string;
        suggestConfirm: boolean;
        /** 自然语言来源说明，非内部路径 */
        sourceNote?: string;
      }>;
      /** 最近已沉淀、可供下次做事的少量要点（自然语言，无内部机制词）。 */
      recentConfirmedLearnings?: Array<{ eventId: string; text: string }>;
      /** 还不确定 — 对后续任务有帮助的缺口提问(可忽略)。 */
      helpfulQuestions?: Array<{ eventId: string; text: string }>;
      /** SubjectPackage/materials 中已添加资料的轻量列表。 */
      materials?: Array<{
        materialRef: string;
        fileName: string;
        addedAt: string;
        absolutePath: string;
      }>;
    };
  };
  'subject.confirmExperience': {
    input: { eventIds: string[] };
    output: { confirmedCount: number };
  };
  /**
   * 对「最近学到 / 现在的我」条目的轻量响应。
   * adopt=以后这样做; dismiss=暂时不要; retire=不再使用; revise=修改一下。
   */
  'subject.respondToLearning': {
    input: {
      eventId: string;
      action:
        | 'adopt'
        | 'dismiss'
        | 'retire'
        | 'revise'
        | 'use_a_once'
        | 'use_b_once'
        | 'prefer_a'
        | 'prefer_b'
        | 'defer';
      revisionText?: string;
      /** JIT 冲突另一方（自然语言确认用，不展示 id） */
      peerEventId?: string;
      taskId?: string;
    };
    output: { ok: boolean };
  };
  /**
   * 从自然语言捕获候选 — 来源含自我说明/对话/任务/材料/成果反馈等。
   * 本切片允许显式测试调用模拟提炼;不构成完整自动蒸馏管线。
   */
  'subject.captureInput': {
    input: {
      text: string;
      sourceKind: SubjectCaptureSourceKind;
      materialRef?: string;
      taskId?: string;
      artifactId?: string;
      /** 采用/不采用必须锚定实际版本；编辑后 head 变化则状态回到未决定。 */
      artifactVersionId?: string;
      /** 用于相关任务经验选择（如 document），非用户面文案。 */
      requestedArtifactType?: string;
      /** 可选能力溯源（验收/冻结证据用，不进用户面）。 */
      capabilityId?: string;
      capabilityVersion?: string;
      sourceCapabilityKind?: 'local' | 'external_capability';
      /** 幂等键；写入事件 tags，用于重放去重。 */
      captureKey?: string;
      revisionRequest?: string;
      rejectionReason?: string;
      /** 版本差异短摘要（非全文）。 */
      editSummary?: string;
      /** 助手回复截断，仅作上下文，不得归因 Owner。 */
      assistantContext?: string;
    };
    output: {
      candidateEventIds: string[];
      confirmationSuggestedEventIds: string[];
      /** 采用/不采用自动确认后的事件 id。 */
      confirmedEventIds?: string[];
      /** 同版本同决策重复调用时为 true，未新写事件。 */
      idempotent?: boolean;
      ownerDecision?: 'undecided' | 'accepted' | 'rejected';
      /**
       * 捕获结果语义（用户面只映射中性文案，不展示枚举名）：
       * learned / pending_confirmation / nothing_to_learn / distill_failed
       */
      captureOutcome: 'learned' | 'pending_confirmation' | 'nothing_to_learn' | 'distill_failed';
      /** 验收追溯：蒸馏模式（不上用户面） */
      distillMode?: 'model' | 'contract' | 'model_fallback_contract' | 'none';
      normalizeTrace?: unknown[];
    };
  };
  /** 导入单文件到主体 materials/,可选产生候选。 */
  'subject.importMaterial': {
    input: { sourcePath: string; distillCandidates?: boolean };
    output: { materialRef: string; candidateEventIds: string[] };
  };
  /**
   * 移除包内资料副本与对应引用；不得删除包外原始文件。
   */
  'subject.removeMaterial': {
    input: { materialRef: string };
    output: { removed: boolean };
  };
  'work.submitTask': {
    input: {
      goal: string;
      contextRefs: ContextRef[];
      /**
       * 期望产出族；可省略，由 Runtime 按意图派生。
       * 显式传入时不得与不可用的代码分析意图冲突地伪装成功。
       */
      requestedArtifactType?: string;
      /** 可选；省略时由 deriveWorkIntent 写入。 */
      intentKind?: import('../work-runtime/work-intent').TaskIntentKind;
      capabilityId?: string;
      /** 本机协作子任务溯源（可选）；由协作编排写入，非 UI 自建状态。 */
      authorization?: {
        grantId: string;
        issuerSubjectId: string;
        granteeSubjectId: string;
      };
      /** 可选：提交前已做的 JIT 选择 */
      jitChoice?: {
        action: 'use_a_once' | 'use_b_once' | 'prefer_a' | 'prefer_b' | 'defer';
        eventIdA: string;
        eventIdB: string;
      };
      /**
       * D11-A：复用对话中枢已建立的理解任务（不新建 Task）。
       * 提供时表示确定性开始 = 用户对该任务当前规划的确认。
       */
      existingTaskId?: string;
      /**
       * D11-B：用户确认的规划版本。若与 Task.meta.plan.version 不一致则拒绝执行。
       */
      confirmedPlanVersion?: number;
      /**
       * 代码修改授权（用户确认卡通过后传入）。
       * 缺省且意图为 modify_code 时，不创建 Job，仅返回 needsExecutionConfirm。
       */
      executionAuthorization?: {
        confirmed: true;
        workingDirectory: string;
        readScope?: string[];
        writeScope?: string[];
        projectOrigin?: 'digitalme_created' | 'user_selected' | 'unknown';
      };
    };
    output: {
      taskId: string;
      jobId: string;
      intentKind?: import('../work-runtime/work-intent').TaskIntentKind;
      /** 用户可理解的一句说明（如自动选择代码分析时）。 */
      userFacingNotice?: string;
      /** 需要先确认写权限时返回；此时 taskId/jobId 为空字符串。 */
      needsExecutionConfirm?: {
        title?: string;
        notice: string;
        projectName?: string;
        workingDirectory: string;
        readScope: string[];
        writeScope: string[];
        allowed?: string[];
        forbidden: string[];
        acceptancePreview: {
          goals: string[];
          tests: string[];
          doNotDo: string[];
        };
        executorDisplayName: string;
        /** 实际选用的能力（高级设置可见；确认卡主文案仍用自然名称）。 */
        selectedCapabilityId?: string;
        selectedCapabilityDisplayName?: string;
        projectOrigin?: 'digitalme_created' | 'user_selected' | 'unknown';
        /** 执行前理解摘要（用户面）；不可靠时含「尚未定位到可靠改动位置」。 */
        understandingSummary?: string[];
        /** false 时确认按钮应为「仍要继续」。 */
        understandingReliable?: boolean;
      };
      /**
       * 软件开发意图已识别，但代码执行能力尚未连接。
       * 不得回退为普通文档生成。
       */
      needsExecutorSetup?: {
        message: string;
        settingsHint?: string;
        title?: string;
        description?: string;
        actions?: Array<'use_installed' | 'install_recommended' | 'connect_later' | 'use_cloud'>;
        capabilities?: Array<{
          capabilityId: string;
          displayName: string;
          providerKind: string;
          invocationKind: string;
          availability: string;
          connectionStatus: string;
          supportsAutomaticExecution: boolean;
          supportsProgress: boolean;
          supportsRevision: boolean;
          supportsResultCollection: boolean;
          actionableMessage: string;
          canDo: string;
          executionModeLabel: string;
          installProvider?: string;
        }>;
        recommended?: {
          displayName: string;
          canDo: string;
          whyNeeded: string;
          permissions: string[];
          installProvider: string;
          noAutoCommitPushDeploy: true;
          installGuideUrl?: string;
        };
      };
      /**
       * 软件开发意图已识别，但尚未选择项目目录。
       * 不得回退为普通文档生成，也不得创建 Task。
       */
      needsProjectFolder?: {
        message: string;
        allowEmptyFolder?: boolean;
        /** 新软件任务优先「由 Digital Me 创建新项目」 */
        preferCreateNew?: boolean;
      };
    };
  };
  'work.retryTask': {
    input: {
      taskId: string;
      /** restore_baseline：恢复最近一次外部执行前状态（不新建 Job）。 */
      action?: 'retry' | 'restore_baseline';
      /** 指定恢复所依据的 Job；缺省取最近 succeeded/failed 外部执行 Job。 */
      jobId?: string;
    };
    output: {
      jobId: string;
      restored?: boolean;
      message?: string;
      conflicts?: string[];
    };
  };
  /**
   * 对已有成果提出修改要求:同 Task 新 Job,成功后向同一 Artifact 追加 capability 版本。
   * 失败不破坏当前 head。
   */
  'work.reviseArtifact': {
    input: {
      taskId: string;
      artifactId: string;
      revisionRequest: string;
      /** 不采用理由；进入修订模型输入，可与 revisionRequest 并存。 */
      rejectionReason?: string;
      /** 截图等附件绝对路径。 */
      attachmentPaths?: string[];
    };
    output: { jobId: string };
  };
  'work.cancelJob': {
    input: { jobId: string };
    output: { cancelled: boolean };
  };
  'work.getTask': {
    input: { taskId: string };
    output: {
      task: Task;
      state: TaskState;
      userFacingLabel: string;
      displayState?: string;
      activityTime?: string;
      projectDir?: string;
      latestJob?: {
        jobId: string;
        status: JobStatus;
        progressNote?: string;
        createdAt?: string;
        startedAt?: string;
        /** succeeded 时绑定的成果（修订 Job 为 target Artifact）。 */
        artifactId?: string;
        targetArtifactId?: string;
        /** 失败时面向用户的可行动说明。 */
        actionable?: string;
        /** 本次 Job 的修改要求（来自 Job.revisionRequest）。 */
        revisionRequest?: string;
        /** 外部代码执行投影（白话由 UI 映射）。 */
        externalExecution?: {
          workingDirectory?: string;
          lastExecutorStatus?: string;
          needsUserQuestion?: boolean;
          afterScopeDigest?: string;
        };
      };
      artifactIds: string[];
      /** 轻量成长反馈;默认收起「使用了什么」,不含内部链路。 */
      appliedUnderstanding?: {
        notice: string;
        items: Array<{ text: string }>;
      };
      /**
       * 本次任务材料纳入摘要 — 由最新 Job 的 ContextSnapshot 派生，非永久 Store。
       */
      materialSummary?: {
        readCount: number;
        skippedCount: number;
        summaryLine: string;
        included: Array<{ path: string; displayName: string }>;
        skipped: Array<{ path: string; displayName: string; reason: string }>;
      };
      /**
       * 即将使用前的自然语言选择（无内部 id 展示义务由 UI 承担）。
       * 平时不弹；仅相关任务返回。
       */
      ownerChoicePrompt?: {
        question: string;
        labelA: string;
        labelB: string;
        eventIdA: string;
        eventIdB: string;
        highRisk: boolean;
      };
    };
  };
  'work.listTasks': {
    input: { limit?: number };
    output: {
      tasks: Array<{
        taskId: string;
        goal: string;
        state: TaskState;
        userFacingLabel?: string;
        displayState?: string;
        activityTime?: string;
        projectDir?: string;
      }>;
    };
  };
  /**
   * D11-A AI 意图与对话中枢：自然语言输入先得到 Digital Me 的理解与回应。
   * 本命令永不创建 Job；执行只能经 work.submitTask / work.reviseArtifact 确定性发生。
   * 模型不可用时降级为明确提示，不做关键词路由。
   */
  'work.converse': {
    input: {
      /** 缺省时创建理解阶段的新任务（无 Job）。 */
      taskId?: string;
      text: string;
      /** 首轮建任务时可携带材料/项目引用。 */
      contextRefs?: ContextRef[];
      /** 薄主链：执行失败后由 Runtime 触发的结果说明，不作为 Owner 新决策。 */
      silentOutcomeExplain?: boolean;
    };
    output: {
      taskId: string;
      createdTask: boolean;
      intent: string;
      confidence: number;
      /** Digital Me 的自然语言回复（已持久化到 Task.meta.conversation）。 */
      reply: string;
      needsClarification: boolean;
      /** 模型不可用降级。 */
      degraded: boolean;
      /** 薄主链标记（若该 Task 走 thin_v1）。 */
      runtimePath?: 'legacy' | 'thin_v1';
      newTurns: Array<{
        turnId: string;
        role: 'user' | 'digital_me';
        content: string;
        createdAt: string;
        intentId?: string;
      }>;
      plan?: {
        version: number;
        status: 'draft' | 'confirmed';
        content: string;
        source?: 'model' | 'seed_internal';
      };
      /** 规划生成失败（模型合同失败）；Task 仍已持久化。 */
      planGenerationFailed?: boolean;
      /** 渲染层据此走确定性执行入口；不表示已执行。 */
      startAuthorized: boolean;
      startMode?: 'new_execution' | 'revision';
      /** 确认开始后由模型瞬时给出的执行族（不持久化）。 */
      executionIntentKind?: string;
      executionRequestedArtifactType?: string;
      adoptRequested: boolean;
      pauseRequested: boolean;
    };
  };
  'artifact.getContent': {
    input: {
      artifactId: string;
      versionId?: string;
      /** 可选：要求 Artifact 必须属于该 Task，防止跨任务串线。 */
      expectedTaskId?: string;
      /** 评价失败后重试同一通用入口；不新增命令。 */
      retryAcceptance?: boolean;
    };
    output: {
      content: ArtifactContent;
      /** text 类内容直接内联返回,供页面直显与编辑。bundle 时为主报告 Markdown。 */
      text?: string;
      headVersionId: string;
      versionCount: number;
      /** 成果所属任务；用于前端防串线校验。 */
      artifactTaskId?: string;
      /**
       * 当前 head 版本的采用状态 — 由已落盘 GrowthEvent 派生，非 UI 本地布尔。
       * undecided | accepted | rejected
       */
      ownerDecision?: {
        status: 'undecided' | 'accepted' | 'rejected';
        artifactVersionId: string;
        decidedAt?: string;
      };
      /** bundle 成果的条目与摘要(不新增命令)。 */
      bundle?: {
        entries: Array<{ role?: string; mediaType: string; text?: string }>;
        manifestSummary?: {
          fileCountScanned: number;
          languages: Array<{ language: string; files: number; bytes: number }>;
          truncated: boolean;
          skippedSensitiveCount: number;
          warnings: string[];
          quality?: { grade: string; reasons: string[] };
        };
      };
      /**
       * 报告为人工编辑，清单/依据仍为旧版；不得冒充已同步。
       */
      evidenceStale?: boolean;
      /**
       * 当前 CTO 结论（Artifact.acceptance 权威位置）。
       * 历史成果可从 codeChange.acceptanceSummary 只读回退。
       */
      acceptanceSummary?: {
        title: string;
        headline?: string;
        executionStatusLabel?: string;
        goalLabel: string;
        goalVerdict?: string;
        recommendation: string;
        bullets: string[];
        technicalBullets?: string[];
        adoptWarnings?: string[];
        canAdoptSuggested: boolean;
        ctoReport?: string;
        primaryAction?: string;
        userFacingNextStep?: string;
        revisionDirective?: string;
        ctoReview?: unknown;
        ctoContractDegraded?: boolean;
      };
      acceptanceStatus?: 'ready' | 'failed' | 'pending';
      acceptanceFailureMessage?: string;
      /** code-change 成果：工作目录与验收摘要（非第二 Store）。 */
      codeChange?: {
        workingDirectory?: string;
        projectName?: string;
        verificationOverall?: string;
        verificationLabel?: string;
        summary?: string;
        changedFiles?: string[];
        changes?: Array<{
          path: string;
          status: 'added' | 'modified' | 'deleted' | 'unknown';
        }>;
        unifiedDiff?: string;
        testResults?: Array<{
          command: string;
          passed: boolean;
          summary?: string;
          logExcerpt?: string;
        }>;
        unresolvedItems?: string[];
        afterScopeDigest?: string;
        directoryChangedSinceResult?: boolean;
        digitalMeVerified?: boolean;
        agentClaimedSuccess?: boolean;
        acceptanceSummary?: {
          title: string;
          headline?: string;
          executionStatusLabel?: string;
          goalLabel: string;
          goalVerdict?: string;
          recommendation: string;
          bullets: string[];
          technicalBullets?: string[];
          adoptWarnings?: string[];
          canAdoptSuggested: boolean;
          ctoReport?: string;
        };
        /** 本版本对应的修改要求（version.note / Job lineage）。 */
        revisionRequest?: string;
        /** 试运行探测（派生，不持久化）。 */
        runInfo?: {
          runnable: boolean;
          kind?: string;
          label?: string;
          command?: string;
          entryPath?: string;
          reason?: string;
          canSuggestTryRun?: boolean;
        };
      };
    };
  };
  'artifact.saveEdit': {
    input: { artifactId: string; text: string };
    output: { versionId: string };
  };
  'artifact.export': {
    input: { artifactId: string; format: ExportFormat; targetPath?: string };
    output: { path: string };
  };
  'artifact.revealInFolder': {
    input: { artifactId: string };
    output: { opened: boolean };
  };
  'capability.list': {
    input: {
      /** 可选：预览外部能力授权确认（结果来自确定性投影，非 UI 自拟）。 */
      previewAuthorization?: {
        goal: string;
        allowedMaterialPaths?: string[];
        capabilityId?: string;
        extraNote?: string;
      };
      /** 可选：探测外部能力当前是否可用（不暴露协议细节）。 */
      includeAvailability?: boolean;
      /**
       * 代码执行能力动作（复用 capability.list，不新增命令位）。
       */
      codingAction?:
        | { type: 'set_default'; capabilityId: string }
        | {
            type: 'save_pending';
            goal: string;
            contextRefs: Array<{ kind: 'file' | 'folder'; path: string }>;
            acceptanceNotes?: string;
          }
        | { type: 'clear_pending' }
        | { type: 'get_pending' };
    };
    output: {
      capabilities: CapabilityRegistration[];
      authorizationPreview?: {
        confirmPoints: string[];
        projection: {
          purpose: string;
          allowedMaterials: string[];
          allowRemotePersist: boolean;
          allowRedelegate: boolean;
          maxRuntimeMs: number;
        };
        capabilityDisplayName: string;
      };
      externalCapabilityCard?: {
        capabilityId: string;
        displayName: string;
        shortDescription: string;
        suitableFor: string;
        shareSummary: string;
        estimatedDuration: string;
        available: boolean;
        availabilityLabel: string;
      };
      /** 代码执行能力（设置页）；非能力市场。 */
      executorCapabilityCard?: {
        capabilityId: string;
        displayName: string;
        shortDescription: string;
        canDo: string;
        allowedScope: string;
        available: boolean;
        availabilityLabel: string;
        detail?: string;
        executionModeLabel?: string;
        connectionStatus?: string;
        supportsAutomaticExecution?: boolean;
      };
      /** 统一代码执行能力状态列表（派生自 Registry）。 */
      codingCapabilities?: Array<{
        capabilityId: string;
        displayName: string;
        providerKind: string;
        invocationKind: string;
        availability: string;
        connectionStatus: string;
        supportsAutomaticExecution: boolean;
        supportsProgress: boolean;
        supportsRevision: boolean;
        supportsResultCollection: boolean;
        actionableMessage: string;
        canDo: string;
        executionModeLabel: string;
        installProvider?: string;
      }>;
      preferredCodingCapabilityId?: string;
      codingRecommendation?: {
        displayName: string;
        canDo: string;
        whyNeeded: string;
        permissions: string[];
        installProvider: string;
        noAutoCommitPushDeploy: true;
        installGuideUrl?: string;
      };
      pendingSoftwareTask?: {
        goal: string;
        contextRefs: Array<{ kind: 'file' | 'folder'; path: string }>;
        acceptanceNotes?: string;
        status: string;
        userFacingNotice: string;
        savedAt: string;
      } | null;
    };
  };
  /**
   * 主体协作（原 collab.simulateInteraction）：
   * propose / evaluate / respond / fulfill / requestRevision / decideResult /
   * revoke / status / list / resolvePeer / assertMaterialAccess / reconcile。
   * 仍占 1 个命令位。兼容旧 action 名 issue/execute/acceptReturn。
   */
  'collab.interact': {
    input: {
      action?:
        | 'propose'
        | 'evaluate'
        | 'respond'
        | 'fulfill'
        | 'requestRevision'
        | 'decideResult'
        | 'revoke'
        | 'status'
        | 'list'
        | 'resolvePeer'
        | 'assertMaterialAccess'
        | 'reconcile'
        /** @deprecated 映射到 propose */
        | 'issue'
        /** @deprecated 映射到 fulfill */
        | 'execute'
        /** @deprecated 映射到 decideResult */
        | 'acceptReturn';
      recordId?: string;
      grantId?: string;
      granteePackageDir?: string;
      issuerTaskId?: string;
      intent?: string;
      expectedOutcome?: string;
      acceptanceCriteria?: string[];
      deadline?: string;
      costTerms?: string;
      /** 兼容旧字段 */
      subtaskGoal?: string;
      allowedMaterialPaths?: string[];
      attemptMaterialPath?: string;
      extraMaterialPaths?: string[];
      decision?: 'accept' | 'reject' | 'counter_propose' | 'request_clarification' | 'revise';
      note?: string;
      skipAutoEvaluate?: boolean;
      terms?: {
        intent: string;
        expectedOutcome: string;
        offeredMaterials: Array<{ path: string; summary?: string }>;
        deadline?: string;
        costTerms?: string;
        acceptanceCriteria: string[];
      };
    };
    output: {
      recordId?: string;
      requestId?: string;
      grantId?: string;
      status?: string;
      artifactId?: string;
      artifactText?: string;
      localArtifactId?: string;
      jobId?: string;
      denied?: boolean;
      reason?: string;
      allowed?: boolean;
      issuerEventId?: string;
      granteeEventId?: string;
      reachedModel?: boolean;
      capabilityId?: string;
      integratedIntoArtifactId?: string;
      ownerDecision?: 'accept' | 'reject' | 'revise';
      role?: 'initiator' | 'responder';
      peerDisplayName?: string;
      displayName?: string;
      packageDir?: string;
      brief?: string;
      subjectId?: string;
      endpointRef?: string;
      evaluationBasis?: string[];
      requiresOwnerConfirmation?: boolean;
      verificationSatisfied?: boolean;
      termsDigest?: string;
      items?: Array<{
        recordId: string;
        grantId?: string;
        status: string;
        role?: 'initiator' | 'responder';
        peerDisplayName?: string;
        ownerDecision?: 'accept' | 'reject' | 'revise';
        subtaskGoal?: string;
        granteeDisplayName?: string;
        allowedMaterials: string[];
        returnedExcerpt?: string;
        issuerTaskId?: string;
        failureMessage?: string;
        reachedModel?: boolean;
        localArtifactId?: string;
        evaluationBasis?: string[];
      }>;
      grant?: {
        id: string;
        status: string;
        subtaskGoal?: string;
        granteeDisplayName?: string;
        returnedExcerpt?: string;
        reachedModel?: boolean;
        allowedMaterials?: string[];
        issuerTaskId?: string;
        failureMessage?: string;
        ownerDecision?: 'accept' | 'reject' | 'revise';
        localArtifactId?: string;
        termsDigest?: string;
        evaluationBasis?: string[];
      };
    };
  };

  /**
   * 主体通讯：Signal / 机会发现（正式协作之前）。
   * 传输经 SubjectTransport；不替代 collab.interact。
   */
  'subject.communicate': {
    input: {
      action?:
        | 'sendSignal'
        | 'listOpportunities'
        | 'continueInterest'
        | 'decline'
        | 'discloseBrief'
        | 'startCollaboration'
        | 'listInbox'
        | 'acknowledge'
        | 'processInbox'
        | 'health'
        | 'configureRelay'
        | 'createInvite'
        | 'acceptInvite'
        | 'listPeers'
        | 'retryOutbox'
        | 'pullRemote';
      peerPackageDir?: string;
      peerEndpointRef?: string;
      opportunityId?: string;
      envelopeId?: string;
      intent?: string;
      relayUrl?: string;
      inviteJson?: string;
      signal?: {
        intent: string;
        seeking: string[];
        offering: string[];
        constraints?: string[];
        disclosureLevel?: 'minimal' | 'brief';
        expiresAt?: string;
      };
    };
    output: {
      ok?: boolean;
      envelopeId?: string;
      opportunityId?: string;
      recordId?: string;
      status?: string;
      processed?: number;
      collabSynced?: number;
      delivered?: boolean;
      duplicate?: boolean;
      mode?: string;
      reachable?: boolean;
      capabilities?: string[];
      connectionLabel?: string;
      inviteJson?: string;
      peerDisplayName?: string;
      submitted?: number;
      failed?: number;
      /** outbox 中仍待投递（pending|failed）的条数；0 表示已全部提交到 Relay */
      remaining?: number;
      fetched?: number;
      rejected?: number;
      items?: Array<{
        id: string;
        peerDisplayName: string;
        stage: string;
        seekingSummary: string;
        offeringSummary: string;
        whyWorthKnowing: string;
        privacyNote: string;
        peerBrief?: string;
        localBrief?: string;
        collaborationRecordId?: string;
      }>;
      item?: {
        id: string;
        peerDisplayName: string;
        stage: string;
        seekingSummary: string;
        offeringSummary: string;
        whyWorthKnowing: string;
        privacyNote: string;
        peerBrief?: string;
        localBrief?: string;
        collaborationRecordId?: string;
      };
      peers?: Array<{ displayName: string; endpointRef?: string; statusLabel: string }>;
      relayUrl?: string;
      inbox?: Array<{
        envelopeId: string;
        kind: string;
        fromDisplayName: string;
        acked: boolean;
        createdAt: string;
      }>;
    };
  };
}

export type CommandName = keyof CommandMap;

export const COMMAND_NAMES = [
  'subject.createPackage',
  'subject.openPackage',
  'subject.getOverview',
  'subject.confirmExperience',
  'subject.respondToLearning',
  'subject.captureInput',
  'subject.importMaterial',
  'subject.removeMaterial',
  'work.submitTask',
  'work.retryTask',
  'work.reviseArtifact',
  'work.cancelJob',
  'work.getTask',
  'work.listTasks',
  'work.converse',
  'artifact.getContent',
  'artifact.saveEdit',
  'artifact.export',
  'artifact.revealInFolder',
  'capability.list',
  'collab.interact',
  'subject.communicate',
] as const satisfies readonly CommandName[];

/**
 * 命令面硬上限(architecture §4;超出即架构违规)。含 subject.communicate。
 * 2026-08-11 D11-A:新增 work.converse(AI 意图与对话中枢,Owner 授权的新领域用例),上限 21→22。
 */
export const COMMAND_COUNT_LIMIT = 22;

export interface CommandBus {
  invoke<K extends CommandName>(
    name: K,
    input: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output']>;
}
